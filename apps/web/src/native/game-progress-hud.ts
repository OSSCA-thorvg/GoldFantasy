import { Rect, Align, ButtonStyle, button, type Context, type Color } from '../../../../packages/native-ui/src';
import { openExpedition } from './expedition-window';
import { translate } from '../../../../packages/localization/src/index';
import { Tool, toolStructure } from '../../../../packages/engine/src/game-tools';
import {
  toolAvailable,
  GoalKind,
  scoutPoint,
  unsourcedMaterial,
  type SettlementGoal,
  type UnlockRequirement,
} from '../../../../packages/engine/src/settlement-progression';
import { Structure, Product, structureSpec } from '../../../../packages/engine/src/building-catalog';
import type { Building } from '../../../../packages/engine/src/town-models';
import { Activity, Role, callingName, type Person } from '../../../../packages/engine/src/person';
import { distance, project } from '../../../../packages/engine/src/geometry';
import { f32 } from '../../../../packages/engine/src/numeric';
import { canControl, isPlayerBuilding } from '../../../../packages/engine/src/faction';
import {
  equipmentSlots,
  equippedItem,
  carriedTools,
  gearEffect,
  isCraftStation,
  itemSpec,
  workItem,
  type ItemSpec,
  type WorkKind,
} from '../../../../packages/engine/src/equipment';
import type { Town } from '../../../../packages/engine/src/town';
import { craftCovered } from '../../../../packages/engine/src/town-equipment';
import { marketTier } from '../../../../packages/engine/src/economy-rules';
import { Boon, boon, boonOfWorld, boonName, boonText, boonsHeld } from '../../../../packages/engine/src/gate-boons';
import { gateSealed, sealable } from '../../../../packages/engine/src/gate-seals';
import { drillRules } from '../../../../packages/engine/src/progression-rules';
import { DungeonKind } from '../../../../packages/engine/src/world-types';
import { DockView } from './game-app-state';
import type { GameHudApp } from './game-hud-contract';
import { buildMenuGroups, toolName } from './build-menu-tools';
import { nearestStation, openStation, stationRows } from './craft-station-hud';

/** Breaks translated text into at most `lines` rows that fit `width`. */
export function wrapText(context: Context, text: string, width: number, size: number, lines = 3): string[] {
  // Translate before breaking: a line of a sentence is not a phrase the tables know.
  text = translate(text);
  const rows: string[] = [];
  let row = '',
    word = '';
  const flush = () => {
    const candidate = row ? `${row} ${word}` : word;
    if (row && context.textWidth(candidate, size) > width) {
      rows.push(row);
      row = word;
    } else row = candidate;
    word = '';
  };
  for (const c of text) {
    if (c === ' ') flush();
    else word = `${word}${c}`;
  }
  flush();
  if (row) rows.push(row);
  return rows.slice(0, lines);
}

// Unlocks: a toast once per newly available building and a "new" mark until the player has seen it.
const menuTools = (): Tool[] => buildMenuGroups.flatMap((group) => group.tools);
/** Call once per HUD frame. A new or loaded town is read silently. */
export function trackUnlocks(app: GameHudApp): void {
  const town = app.town;
  trackGearUse(app);
  if (app.unlockTown !== town) {
    app.unlockTown = town;
    app.unlockKnown = new Set(menuTools().filter((tool) => toolAvailable(town, tool)));
    app.unlockFresh.clear();
    app.unlockViewed.clear();
    app.buildHint = null;
    return;
  }
  const opened: string[] = [];
  for (const tool of menuTools())
    if (!app.unlockKnown.has(tool) && toolAvailable(town, tool)) {
      app.unlockKnown.add(tool);
      app.unlockFresh.add(tool);
      opened.push(toolName(tool));
    }
  if (opened.length) town.notify('Unlocked: ' + opened.join(', '));
  // A kind the settlement already has a site or building of is no longer new, however it got there.
  if (app.unlockFresh.size) {
    const owned = new Set(town.buildings().filter(isPlayerBuilding).map((b) => b.kind));
    for (const tool of [...app.unlockFresh]) {
      const kind = toolStructure(tool);
      if (kind !== undefined && owned.has(kind)) {
        app.unlockFresh.delete(tool);
        app.unlockViewed.delete(tool);
      }
    }
  }
  if (app.dockView !== DockView.Build) {
    noteBuildPage(app, []);
    app.buildHint = null;
  }
}
/** The build menu shows `shown` now: new tools seen on a page the player has left lose their mark. */
export function noteBuildPage(app: GameHudApp, shown: readonly Tool[]): void {
  for (const tool of [...app.unlockViewed])
    if (!shown.includes(tool)) {
      app.unlockViewed.delete(tool);
      app.unlockFresh.delete(tool);
    }
  for (const tool of shown) if (app.unlockFresh.has(tool)) app.unlockViewed.add(tool);
}
export const freshGroup = (app: GameHudApp, tools: readonly Tool[]): boolean =>
  tools.some((tool) => app.unlockFresh.has(tool));
/** A "New" tag in a build card's corner, or a dot on a group button. */
export function freshMark(app: GameHudApp, bounds: Rect, tag: boolean): void {
  const c = app.context,
    t = app.theme;
  if (!tag) {
    c.rect(new Rect(f32(f32(bounds.x + bounds.w) - 11), f32(bounds.y + 4), 7, 7), t.accent, 3.5);
    return;
  }
  const w = f32(c.textWidth('New', 8, true) + 8),
    r = new Rect(f32(f32(bounds.x + bounds.w) - w - 3), f32(bounds.y + 3), w, 12);
  c.rect(r, t.accent, 6);
  c.text(r, 'New', t.accentText, 8, true, Align.Center);
}
/** A small padlock in a locked build card's corner. */
export function lockMark(app: GameHudApp, bounds: Rect): void {
  const c = app.context,
    ink = app.theme.muted,
    x = f32(bounds.x + 6),
    y = f32(bounds.y + 5);
  c.line(f32(x + 2), f32(y + 5), f32(x + 2), f32(y + 2), ink, 1.2);
  c.line(f32(x + 2), f32(y + 2), f32(x + 7), f32(y + 2), ink, 1.2);
  c.line(f32(x + 7), f32(y + 2), f32(x + 7), f32(y + 5), ink, 1.2);
  c.rect(new Rect(x, f32(y + 5), 9, 7), ink, 1);
}
/** Lists every requirement of a locked card, ticked or open, beside the card with control `id`. */
export function requirementTip(app: GameHudApp, id: string, tool: Tool, needs: readonly UnlockRequirement[]): void {
  const c = app.context,
    t = app.theme,
    title = toolName(tool);
  c.deferOverlay(
    (area, controls) => {
      const anchor = controls.find((control) => control.id === id)?.bounds;
      if (!anchor || anchor.w <= 0 || anchor.h <= 0) return;
      const widest = Math.max(c.textWidth(title, 11, true), ...needs.map((need) => c.textWidth(need.text, 11))),
        w = Math.min(f32(area.w - 8), f32(widest + 40)),
        h = f32(30 + 18 * needs.length),
        x = Math.max(f32(area.x + 4), Math.min(f32(f32(area.x + area.w) - w - 4), f32(anchor.x + f32(anchor.w / 2) - w / 2))),
        above = f32(anchor.y - h - 6),
        y = above >= area.y + 4 ? above : Math.min(f32(anchor.y + anchor.h + 6), f32(area.y + area.h - h - 4)),
        box = new Rect(x, y, w, h);
      c.rect(box, { ...t.raised, a: 255 }, t.radius, t.border);
      c.text(new Rect(f32(x + 10), f32(y + 6), f32(w - 20), 16), c.elideText(title, f32(w - 20), 11, true), t.text, 11, true);
      needs.forEach((need, i) => {
        const row = f32(y + 26 + 18 * i),
          mark = new Rect(f32(x + 10), f32(row + 4), 9, 9);
        if (need.done) {
          c.line(mark.x, f32(mark.y + 4), f32(mark.x + 3), f32(mark.y + 8), t.success, 1.6);
          c.line(f32(mark.x + 3), f32(mark.y + 8), f32(mark.x + 9), mark.y, t.success, 1.6);
        } else c.rect(mark, { ...t.surface, a: 0 }, 2, t.accent);
        c.text(
          new Rect(f32(x + 26), row, f32(w - 36), 17),
          c.elideText(need.text, f32(w - 36), 11),
          need.done ? t.muted : t.text,
          11,
        );
      });
    },
    'build-requirements',
    1,
  );
}

// The first time a piece of gear does its work, say what it changed.
const gearSeen = new WeakMap<Town, Set<string>>();
function gearAtWork(p: Person): ItemSpec | null {
  if (p.moving()) return null;
  const kind: WorkKind | null =
    p.activity === Activity.Felling
      ? 'woodcutting'
      : p.activity === Activity.Mining
        ? 'mining'
        : p.activity === Activity.Building || p.activity === Activity.Roadwork
          ? 'construction'
          : p.activity === Activity.Crafting
            ? 'crafting'
            : null;
  return kind ? workItem(p, kind) : null;
}
/** A new or loaded town counts the gear already in hand as seen. */
export function trackGearUse(app: GameHudApp): void {
  const town = app.town;
  let seen = gearSeen.get(town);
  if (!seen) {
    seen = new Set();
    for (const p of town.people())
      for (const item of [...carriedTools(p), ...equipmentSlots.map((slot) => equippedItem(p, slot))]) if (item) seen.add(item.id);
    gearSeen.set(town, seen);
  }
  for (const p of town.people()) {
    const item = canControl(p) ? gearAtWork(p) : null;
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    town.notify(`First use of the ${item.name} · ${gearEffect(item)}`);
  }
}

// Quests: one useful action per goal, or none.
export interface QuestAction {
  label: string;
  run: () => void;
}
const gateDeeds = new Set(['guardiansSlain', 'partiesLed', 'largestParty', 'monstersSlain', 'floors', 'seals']);
const toolOf = (kind: Structure): Tool | undefined => {
  for (let tool = 0; tool < Tool.Count; tool++) if (toolStructure(tool) === kind) return tool;
  return undefined;
};
/** Opens the build menu on the group holding `tool`, with its requirements listed when it is locked. */
export function openBuildFor(app: GameHudApp, tool: Tool): void {
  const page = buildMenuGroups.findIndex((group) => group.tools.includes(tool)) + 1;
  app.selectTool(Tool.Select, true);
  app.selected =
    app.selectedDungeon =
    app.selectedTree =
    app.selectedTreeInstance =
    app.selectedRock =
    app.selectedAnimal =
      -1;
  app.selectedObjects = [];
  app.card = app.chosen.length ? page : -1;
  app.globalCard = app.chosen.length ? -1 : page;
  app.drawerPinned = true;
  app.drawerSuppressed = false;
  app.buildHint = toolAvailable(app.town, tool) ? null : tool;
}
function placeAction(app: GameHudApp, tool: Tool): QuestAction {
  return toolAvailable(app.town, tool)
    ? { label: 'Place ' + toolName(tool), run: () => app.selectTool(tool) }
    : { label: 'Show requirements', run: () => openBuildFor(app, tool) };
}
function look(app: GameHudApp, x: number, y: number): void {
  const p = project(x, y);
  app.camera.x = p.x;
  app.camera.y = p.y;
}
/** Selects a finished building of `kind`, or offers to place one. */
function visitAction(app: GameHudApp, kind: Structure, label: string): QuestAction | null {
  const site = app.town.buildings().find((b) => b.kind === kind && b.built() && isPlayerBuilding(b));
  if (site)
    return {
      label,
      run: () => {
        app.selectBuilding(site.id);
        look(app, site.center.x, site.center.y);
      },
    };
  const tool = toolOf(kind);
  return tool === undefined ? null : placeAction(app, tool);
}
/** Centres the nearest found, unsealed gate and opens its expedition window with the selection chosen. */
export function jumpToGate(app: GameHudApp): void {
  const town = app.town,
    from = town.camp()?.center ?? town.map().camp();
  let best = -1,
    nearest = Infinity;
  town
    .map()
    .dungeons()
    .forEach((site, index) => {
      const gap = Math.hypot(site.origin.x + 1 - from.x, site.origin.y + 1 - from.y);
      if (!site.discovered || !sealable(site) || gateSealed(town, index) || gap >= nearest) return;
      best = index;
      nearest = gap;
    });
  if (best < 0) {
    app.status = 'Explore to discover a gate';
    return;
  }
  const site = town.map().dungeons()[best];
  look(app, f32(site.origin.x + 1), f32(site.origin.y + 1));
  app.selectTool(Tool.Select, true);
  openExpedition(app, best, app.chosen);
}
// Tools work from the pack; a weapon counts once it is in hand.
const inHand = (p: Person): boolean => carriedTools(p).length > 0 || !!equippedItem(p, 'weapon');
/** The resident to craft for a quest: the selected one, else the nearest to the camp still lacking `items`. */
export function questCrafter(app: GameHudApp, items: readonly string[], bare = false): Person | null {
  const town = app.town,
    camp = town.camp();
  if (!camp?.built()) return null;
  const able = town
    .people()
    .filter((p) => p.role === Role.Resident && canControl(p) && town.settlementOf(p) === town.settlementOf(camp));
  const lacking = (p: Person) =>
      bare ? !inHand(p) : !p.inventory.some((stack) => stack && items.includes(stack.item)),
    stock = town.stock(town.settlementOf(camp)),
    // Whoever already carries the wood for a recipe can start at once.
    ready = (p: Person) =>
      items.some((id) => {
        const item = itemSpec(id);
        return !!item && craftCovered(stock, p, item.cost);
      })
        ? 0
        : 1;
  return (
    able.find((p) => app.chosen.length === 1 && app.chosen[0] === p.id && lacking(p)) ??
    able
      .filter(lacking)
      .sort(
        (a, b) =>
          ready(a) - ready(b) ||
          distance(a.position, camp.center) - distance(b.position, camp.center) ||
          a.id - b.id,
      )[0] ??
    able.find((p) => app.chosen.includes(p.id)) ??
    able[0] ??
    null
  );
}
function craftAction(app: GameHudApp, goal: SettlementGoal): QuestAction | null {
  const equip = goal.kind === GoalKind.Equip,
    camp = app.town.camp(),
    // The station that makes the goal's items: the smithy for weapons, shields and armor.
    kind = goal.kind === GoalKind.Station ? goal.building : (itemSpec(goal.items[0] ?? '')?.workshop ?? Structure.Workbench),
    bench = camp ? nearestStation(app.town, camp.center, kind) : null;
  if (!bench) {
    const site = app.town
      .buildings()
      .find((b) => b.kind === kind && !b.built() && isPlayerBuilding(b));
    if (site)
      return {
        label: 'Find construction site',
        run: () => {
          app.selectBuilding(site.id);
          look(app, site.center.x, site.center.y);
        },
      };
    const tool = toolOf(kind);
    return app.town.camp() && tool !== undefined ? placeAction(app, tool) : placeAction(app, Tool.Camp);
  }
  const p = questCrafter(app, goal.items, equip);
  if (!p) return null;
  // The station's own list opens with the best crafter chosen; the player starts the work there.
  return {
    label: equip ? `Craft gear for ${p.name}` : `Open the ${structureSpec(kind).name.toLowerCase()}`,
    run: () => {
      openStation(app, bench, p.id);
      look(app, bench.center.x, bench.center.y);
    },
  };
}
/** Sends the selected resident, or the nearest idle one, onto unexplored ground near the camp. */
export function scout(app: GameHudApp): void {
  const town = app.town,
    camp = town.camp(),
    able = town.people().filter((p) => p.role === Role.Resident && canControl(p)),
    from = camp?.center ?? able[0]?.position;
  if (!from) return;
  const p =
    able.find((q) => app.chosen.includes(q.id)) ??
    able
      .slice()
      .sort(
        (a, b) =>
          Number(a.task !== Activity.Idle) - Number(b.task !== Activity.Idle) ||
          distance(a.position, from) - distance(b.position, from),
      )[0],
    at = p ? scoutPoint(town, p.position) : null;
  if (!p || !at) {
    app.status = 'Nothing left to explore nearby';
    return;
  }
  town.orderMove([p.id], at);
  app.selectPeople([p.id]);
  look(app, at.x, at.y);
}
export function questAction(app: GameHudApp, goal: SettlementGoal): QuestAction | null {
  const town = app.town;
  switch (goal.kind) {
    case GoalKind.Craft:
    case GoalKind.Equip:
    case GoalKind.Station:
      return craftAction(app, goal);
    case GoalKind.Building: {
      const site = town.buildings().find((b) => b.kind === goal.building && !b.built() && isPlayerBuilding(b));
      const lacking = site ? unsourcedMaterial(town, site) : null;
      if (site && lacking !== null)
        return { label: lacking === Product.Stone ? 'Scout for stone' : 'Scout for trees', run: () => scout(app) };
      if (site)
        return {
          label: 'Find construction site',
          run: () => {
            app.selectBuilding(site.id);
            look(app, site.center.x, site.center.y);
          },
        };
      const tool = toolOf(goal.building);
      return tool === undefined ? null : placeAction(app, tool);
    }
    case GoalKind.Road:
      return toolAvailable(town, Tool.Road)
        ? { label: 'Draw a road', run: () => app.selectTool(Tool.Road) }
        : placeAction(app, Tool.Road);
    case GoalKind.Field:
      return toolAvailable(town, Tool.Field)
        ? { label: 'Plant a field', run: () => app.selectTool(Tool.Field) }
        : placeAction(app, Tool.Field);
    case GoalKind.Population: {
      // New residents come from the altar while a bed is free; otherwise the answer is housing.
      if (town.housing() > town.population()) {
        const altar = visitAction(app, Structure.Shrine, "Open Odin's altar");
        if (altar) return altar;
      }
      return toolAvailable(town, Tool.Tent)
        ? { label: 'Build housing', run: () => app.selectTool(Tool.Tent) }
        : { label: 'Build housing', run: () => openBuildFor(app, Tool.Tent) };
    }
    case GoalKind.Floor:
    case GoalKind.Seal:
      return { label: 'Plan an expedition', run: () => jumpToGate(app) };
    case GoalKind.Deed:
      if (gateDeeds.has(goal.deed)) return { label: 'Plan an expedition', run: () => jumpToGate(app) };
      if (goal.deed === 'sworn') return visitAction(app, Structure.Guild, 'Open the guild');
      if (goal.deed === 'weaponsForged') return visitAction(app, Structure.Weaponsmith, 'Open the smithy');
      return null;
    default:
      return null;
  }
}
/** Boons held, for a hover list beside the gates counter. */
export function boonTip(app: GameHudApp, anchor: Rect): void {
  const held = boonsHeld(app.town);
  if (!held.length) return;
  const c = app.context,
    t = app.theme;
  c.deferOverlay(
    (area) => {
      const lines = held.map((b) => `${boonName(b)}: ${boonText(b)}`),
        w = Math.min(f32(area.w - 8), 320),
        h = f32(28 + 17 * lines.length),
        box = new Rect(
          Math.max(f32(area.x + 4), Math.min(f32(anchor.x + anchor.w - w), f32(f32(area.x + area.w) - w - 4))),
          f32(anchor.y + anchor.h + 4),
          w,
          h,
        );
      c.rect(box, { ...t.raised, a: 255 }, t.radius, t.border);
      c.text(new Rect(f32(box.x + 10), f32(box.y + 5), f32(w - 20), 16), 'Boons of the sealed worlds', t.accent, 10, true);
      lines.forEach((line, i) =>
        c.text(
          new Rect(f32(box.x + 10), f32(box.y + 23 + 17 * i), f32(w - 20), 16),
          c.elideText(line, f32(w - 20), 10),
          t.text,
          10,
        ),
      );
    },
    'quest-boons',
    1,
  );
}

// Inspector sections for the market, mage tower, runestone, watchtower, training yard and gates.
export interface InspectorRows {
  rows: (() => void)[];
  left: number;
  inner: number;
  top: number;
  y: number;
}
function textLine(app: GameHudApp, out: InspectorRows, text: string, color: Color, size = 12, bold = false): void {
  const at = out.y,
    { left, inner, top } = out,
    c = app.context;
  out.rows.push(() =>
    c.text(new Rect(left, f32(top + at), inner, f32(size + 8)), c.elideText(text, inner, size, bold), color, size, bold),
  );
  out.y = f32(out.y + f32(size + 9));
}
function wrappedLines(app: GameHudApp, out: InspectorRows, text: string, color: Color, size = 12, lines = 3): void {
  for (const line of wrapText(app.context, text, out.inner, size, lines)) textLine(app, out, line, color, size);
}
const tradeStep = 5;
const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
function marketRows(app: GameHudApp, building: Building, out: InspectorRows): void {
  const c = app.context,
    t = app.theme,
    town = app.town,
    village = town.settlementOf(building),
    day = town.marketDay(village),
    owned = isPlayerBuilding(building);
  out.y = f32(out.y + 4);
  if (!day) {
    textLine(app, out, town.canTrade(village, Product.Food, 1).reason, t.danger, 12, true);
    return;
  }
  textLine(
    app,
    out,
    `Trade today: ${day.left} of ${day.limit} goods left · ${town.stock(village).gold} gold`,
    t.accent,
    12,
    true,
  );
  if (day.market !== building.id) textLine(app, out, `Trading through the ${day.name.toLowerCase()}`, t.muted, 11);
  const amount = day.left > 0 ? Math.min(tradeStep, day.left) : tradeStep,
    wide = out.inner >= 380,
    touch = app.touchMode,
    rowH = touch ? 44 : 28,
    buttonW = touch ? 80 : 70,
    { left, inner, top } = out;
  let hint = '',
    refused = false;
  if (wide) {
    const at = out.y;
    out.rows.push(() => {
      const columns: [string, number][] = [
        ['Goods', 0],
        ['Stored', 92],
        ['Buy', 158],
        ['Sell', 210],
      ];
      for (const [label, x] of columns)
        c.text(new Rect(f32(left + x), f32(top + at), 60, 16), label, t.muted, 10);
    });
    out.y = f32(out.y + 18);
  }
  for (const offer of town.tradeOffers(village)) {
    const at = out.y;
    out.rows.push(() => {
      const buy = town.canTrade(village, offer.product, amount),
        sell = town.canTrade(village, offer.product, -amount),
        y = f32(top + at),
        buttonsY = wide ? y : f32(y + 20),
        sellBox = new Rect(f32(left + inner - buttonW), buttonsY, buttonW, rowH),
        buyBox = new Rect(f32(sellBox.x - buttonW - 6), buttonsY, buttonW, rowH),
        name = capitalized(offer.name);
      if (wide) {
        const middle = f32(y + f32((rowH - 18) / 2));
        c.text(new Rect(left, middle, 88, 18), name, t.text, 12, true);
        c.text(new Rect(f32(left + 92), middle, 60, 18), String(offer.stored), t.text, 12);
        c.text(new Rect(f32(left + 158), middle, 48, 18), `${offer.buy} g`, t.text, 12);
        c.text(new Rect(f32(left + 210), middle, 48, 18), `${offer.sell} g`, t.text, 12);
      } else
        c.text(
          new Rect(left, y, inner, 18),
          c.elideText(`${name} · ${offer.stored} stored · buy ${offer.buy} g · sell ${offer.sell} g`, inner, 11),
          t.text,
          11,
        );
      button(
        c,
        'market-buy-' + offer.product,
        buyBox,
        `Buy ${amount}`,
        () => {
          if (isPlayerBuilding(town.building(building.id))) town.trade(village, offer.product, amount);
        },
        ButtonStyle.Default,
        owned && buy.ok,
      );
      button(
        c,
        'market-sell-' + offer.product,
        sellBox,
        `Sell ${amount}`,
        () => {
          if (isPlayerBuilding(town.building(building.id))) town.trade(village, offer.product, -amount);
        },
        ButtonStyle.Default,
        owned && sell.ok,
      );
      for (const [box, check, text] of [
        [buyBox, buy, `Buy ${amount} ${offer.name} for ${buy.cost.gold} gold`],
        [sellBox, sell, `Sell ${amount} ${offer.name} for ${amount * offer.sell} gold`],
      ] as const)
        if (box.contains(app.mouse.x, app.mouse.y)) {
          hint = check.ok ? text : check.reason;
          refused = !check.ok;
        }
    });
    out.y = f32(out.y + (wide ? rowH + 4 : rowH + 24));
  }
  // The refusal reason of the button under the pointer, else a general note.
  const at = out.y;
  out.rows.push(() => {
    c.text(
      new Rect(left, f32(top + at), inner, 18),
      c.elideText(hint || `Buy or sell ${amount} at a time; prices change daily`, inner, 11),
      refused ? t.danger : t.muted,
      11,
    );
  });
  out.y = f32(out.y + 20);
}
function riteRows(app: GameHudApp, building: Building, out: InspectorRows): void {
  const c = app.context,
    t = app.theme,
    town = app.town,
    village = town.settlementOf(building),
    owned = isPlayerBuilding(building),
    touch = app.touchMode;
  out.y = f32(out.y + 4);
  textLine(app, out, `Rites · ${town.stock(village).mana} mana stored`, t.accent, 12, true);
  for (const rite of town.rites()) {
    const check = town.canPerformRite(rite.id, village),
      at = out.y,
      { left, inner, top } = out,
      rowH = touch ? 44 : 26;
    out.rows.push(() => {
      const y = f32(top + at),
        middle = f32(y + f32((rowH - 20) / 2));
      c.text(new Rect(left, middle, 110, 20), rite.name, t.text, 13, true);
      c.text(new Rect(f32(left + 112), middle, 90, 20), `${rite.mana} mana`, t.muted, 11);
      button(
        c,
        'rite-' + rite.id,
        new Rect(f32(left + inner - 96), y, 96, rowH),
        'Perform',
        () => {
          if (isPlayerBuilding(town.building(building.id))) town.performRite(rite.id, village);
        },
        ButtonStyle.Primary,
        owned && check.ok,
      );
    });
    out.y = f32(out.y + rowH + 2);
    const saved = out.inner;
    out.inner = f32(out.inner - 4);
    wrappedLines(app, out, rite.description, t.muted, 11, 2);
    out.inner = saved;
    if (!check.ok) textLine(app, out, check.reason, t.danger, 11);
    out.y = f32(out.y + 4);
  }
}
const fallenPage = 4;
function memorialRows(app: GameHudApp, out: InspectorRows): void {
  const c = app.context,
    t = app.theme,
    fallen = [...app.town.rememberedFallen()].reverse();
  out.y = f32(out.y + 4);
  if (!fallen.length) {
    textLine(app, out, 'No names are carved here yet.', t.muted, 12);
    return;
  }
  textLine(app, out, `Remembered here: ${fallen.length}`, t.accent, 12, true);
  const pages = Math.ceil(fallen.length / fallenPage);
  app.residentPage = Math.min(app.residentPage, pages - 1);
  for (const dead of fallen.slice(app.residentPage * fallenPage, (app.residentPage + 1) * fallenPage)) {
    textLine(app, out, `${dead.name} · ${callingName(dead.calling)} · level ${dead.level}`, t.text, 12, true);
    textLine(
      app,
      out,
      // The record keeps the day index; the calendar and the memorial card count from day 1.
      `Day ${dead.day + 1} · ${dead.cause}` + (dead.place && dead.place !== 'Midgard' ? ` · ${dead.place}` : ''),
      t.muted,
      11,
    );
  }
  if (pages > 1) {
    const at = out.y,
      page = app.residentPage,
      { left, top } = out;
    out.rows.push(() => {
      button(c, 'fallen-prev', new Rect(left, f32(top + at), 80, 26), 'Previous', () => app.residentPage--, ButtonStyle.Quiet, page > 0);
      c.text(new Rect(f32(left + 88), f32(top + at), 80, 26), `${page + 1} / ${pages}`, t.muted, 12);
      button(
        c,
        'fallen-next',
        new Rect(f32(left + 174), f32(top + at), 80, 26),
        'Next',
        () => app.residentPage++,
        ButtonStyle.Quiet,
        page + 1 < pages,
      );
    });
    out.y = f32(out.y + 30);
  }
}
function watchRows(app: GameHudApp, building: Building, out: InspectorRows): void {
  const t = app.theme,
    keeper = app.town.people().find((p) => p.job === building.id && p.health > 0);
  out.y = f32(out.y + 4);
  if (app.town.watchtowerManned(building.id) && keeper)
    textLine(app, out, `${keeper.name} keeps watch`, t.success, 12, true);
  else if (keeper) textLine(app, out, `${keeper.name} cannot keep watch now`, t.danger, 12, true);
  else textLine(app, out, 'No one keeps watch: assign a worker', t.danger, 12, true);
  if (boon(app.town, Boon.Bulwark)) textLine(app, out, 'Bulwark: its arrows strike harder', t.accent, 11);
}
function drillRows(app: GameHudApp, building: Building, out: InspectorRows): void {
  const t = app.theme,
    drillers = app.town.people().filter((p) => p.job === building.id && p.health > 0);
  out.y = f32(out.y + 4);
  wrappedLines(
    app,
    out,
    `A day of drilling eases stress and gives experience to residents below level ${drillRules.levelCap}.`,
    t.muted,
    11,
    2,
  );
  if (!drillers.length) {
    textLine(app, out, 'No one drills here: assign workers', t.danger, 12, true);
    return;
  }
  textLine(
    app,
    out,
    `Last day: ${Math.round(building.attendance * 100)}% attendance`,
    t.accent,
    12,
    true,
  );
  for (const p of drillers)
    textLine(
      app,
      out,
      `${p.name} · level ${p.level}` + (p.level >= drillRules.levelCap ? ' · learns nothing more here' : ''),
      p.level >= drillRules.levelCap ? t.muted : t.text,
      12,
    );
}
function gateRows(app: GameHudApp, gate: number, out: InspectorRows): void {
  const t = app.theme,
    town = app.town,
    site = town.map().dungeons()[gate];
  if (!site || site.kind === DungeonKind.Return || !sealable(site)) return;
  const gift = boonOfWorld(town.map().destination(site)),
    held = boon(town, gift);
  out.y = f32(out.y + 4);
  textLine(
    app,
    out,
    held ? `Boon held: ${boonName(gift)}` : `Sealing grants the boon of ${boonName(gift)}`,
    held ? t.success : t.accent,
    12,
    true,
  );
  wrappedLines(app, out, boonText(gift), t.muted, 11, 2);
  const others = boonsHeld(town).filter((b) => b !== gift);
  if (others.length) textLine(app, out, 'Also held: ' + others.map(boonName).join(', '), t.muted, 11);
}
/** Adds the rows of the newer building and gate systems to the inspector; `out.y` advances. */
export function progressInspector(app: GameHudApp, building: Building | null, gate: number, out: InspectorRows): void {
  if (!building) {
    if (gate >= 0) gateRows(app, gate, out);
    return;
  }
  if (!building.built()) {
    const lacking = isPlayerBuilding(building) ? unsourcedMaterial(app.town, building) : null;
    if (lacking === null) return;
    out.y = f32(out.y + 4);
    textLine(app, out, lacking === Product.Stone ? 'No rock in sight' : 'No trees in sight', app.theme.danger, 12, true);
    wrappedLines(
      app,
      out,
      lacking === Product.Stone
        ? 'Send a resident out to explore. Builders break grey rock by hand, faster with a wooden pick; a quarry needs a road.'
        : 'Send a resident out to explore. Builders fell trees by hand, faster with a wooden axe.',
      app.theme.muted,
      11,
      3,
    );
    return;
  }
  if (isCraftStation(building.kind)) stationRows(app, building, out);
  else if (marketTier(building.kind)) marketRows(app, building, out);
  else if (building.kind === Structure.MageTower) riteRows(app, building, out);
  else if (building.kind === Structure.Runestone) memorialRows(app, out);
  else if (building.kind === Structure.Watchtower) watchRows(app, building, out);
  else if (building.kind === Structure.TrainingYard) drillRows(app, building, out);
}
