import { Rect, Align, ButtonStyle, button, type Color } from '../../../../packages/native-ui/src';
import { Structure, describe, structureSpec, type Resources } from '../../../../packages/engine/src/building-catalog';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, Role, callingName, type Person } from '../../../../packages/engine/src/person';
import { distance, project } from '../../../../packages/engine/src/geometry';
import { f32 } from '../../../../packages/engine/src/numeric';
import { canControl, isPlayerBuilding } from '../../../../packages/engine/src/faction';
import {
  craftsAt,
  equippedItem,
  carriedTools,
  gearEffect,
  isCraftStation,
  isShield,
  itemCatalog,
  lacksKind,
  ownedMake,
  upgradeCost,
  type ItemSpec,
} from '../../../../packages/engine/src/equipment';
import { stationLevel, stationStep, stationTitle, topLevel } from '../../../../packages/engine/src/craft-stations';
import { craftOrder, orderItem, stationOrder, upgradeOrder } from '../../../../packages/engine/src/craft-orders';
import { upgradeSource } from '../../../../packages/engine/src/town-equipment';
import {
  GoalBranch,
  GoalKind,
  currentGoal,
  settlementGoals,
} from '../../../../packages/engine/src/settlement-progression';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import type { GameHudApp } from './game-hud-contract';
import type { InspectorRows } from './game-progress-hud';
import { actionButton } from './hud-actions';
import { itemIcon } from './game-equipment-panel';
import { hudPaint } from './hud-paint';
import { wrapText } from './game-combat-hud';

// The resident the player chose to work each station, the recipe group and its page shown; transient, per app.
const picks = new WeakMap<object, Map<number, number>>(),
  pages = new WeakMap<object, Map<number, number>>(),
  groups = new WeakMap<object, Map<number, RecipeGroup>>(),
  // The resident the player selected last; it outlives selecting a station, which clears the unit selection.
  lastSelected = new WeakMap<object, number>(),
  // Fits under the crafter and level rows in a laptop-height panel.
  recipesPerPage = 7;
export type RecipeGroup = 'Tools' | 'Weapons' | 'Shields' | 'Armor' | 'Gear';
const groupOrder: readonly RecipeGroup[] = ['Tools', 'Weapons', 'Shields', 'Armor', 'Gear'];
/** Tools speed a kind of work; weapons are held to fight; shields and armor guard; gear is the rest (a knife, a basket). */
export const recipeGroup = (item: ItemSpec): RecipeGroup =>
  item.work.length
    ? 'Tools'
    : item.category === 'weapon'
      ? 'Weapons'
      : isShield(item)
        ? 'Shields'
        : item.category === 'armor' && (item.slots.includes('body') || item.slots.includes('head'))
          ? 'Armor'
          : 'Gear';
/** A station's recipes by group, each kind's makes side by side (wood, stone, iron). */
export function stationRecipes(kind: Structure): Map<RecipeGroup, ItemSpec[]> {
  const recipes = itemCatalog.filter((i) => craftsAt(i, kind)),
    shape = (item: ItemSpec) => recipes.findIndex((other) => other.visual === item.visual && other.slots.join() === item.slots.join()),
    out = new Map<RecipeGroup, ItemSpec[]>();
  for (const group of groupOrder) {
    const list = recipes
      .filter((item) => recipeGroup(item) === group)
      .sort((a, b) => shape(a) - shape(b) || a.tier - b.tier);
    if (list.length) out.set(group, list);
  }
  return out;
}
/** The group shown: the player's pick, else the one holding the current quest's item, else the first. */
function shownGroup(
  app: object,
  station: Building,
  recipes: Map<RecipeGroup, ItemSpec[]>,
  wanted: readonly string[],
) {
  const picked = groups.get(app)?.get(station.id);
  if (picked && recipes.has(picked)) return picked;
  for (const [group, list] of recipes) if (list.some((item) => wanted.includes(item.id))) return group;
  return [...recipes.keys()][0] ?? 'Tools';
}
interface StationApp {
  town: Town;
  selectBuilding(id: number): void;
}
/** Remembers `personId` as the crafter at `stationId`. */
export function pickCrafter(app: object, stationId: number, personId: number): void {
  let map = picks.get(app);
  if (!map) picks.set(app, (map = new Map()));
  map.set(stationId, personId);
}
/** Keeps the record of the resident selected last; a new selection overrides earlier picks at the stations. */
export function noteSelection(app: { town: Town; chosen: readonly number[] }): void {
  const id = app.chosen.find((one) => {
    const p = app.town.person(one);
    return !!p && p.role === Role.Resident && canControl(p);
  });
  if (id === undefined || lastSelected.get(app) === id) return;
  lastSelected.set(app, id);
  picks.delete(app);
}
/** Residents who can be sent to work `station`, nearest first. */
export function crafters(town: Town, station: Building): Person[] {
  const village = town.settlementOf(station);
  return town
    .people()
    .filter((p) => p.role === Role.Resident && canControl(p) && p.health > 0 && town.settlementOf(p) === village)
    .sort(
      (a, b) => distance(a.position, station.center) - distance(b.position, station.center) || a.id - b.id,
    );
}
/** The chosen crafter, else the resident selected last, else a selected one, else the nearest not crafting elsewhere. */
export function stationCrafter(app: GameHudApp, station: Building): Person | null {
  const able = crafters(app.town, station),
    picked = picks.get(app)?.get(station.id),
    last = lastSelected.get(app);
  return (
    able.find((p) => p.id === picked) ??
    able.find((p) => p.id === last) ??
    able.find((p) => app.chosen.includes(p.id)) ??
    able.find((p) => p.task !== Activity.Crafting) ??
    able[0] ??
    null
  );
}
/** Selects a station with `crafterId` chosen as the one to work it; nothing starts by itself. */
export function openStation(app: StationApp, station: Building, crafterId?: number): void {
  if (crafterId !== undefined) pickCrafter(app, station.id, crafterId);
  app.selectBuilding(station.id);
}
/** The nearest finished station of `kind` in the player's settlement, or null. */
export function nearestStation(
  town: Town,
  from: { x: number; y: number },
  kind = Structure.Workbench,
): Building | null {
  return (
    town
      .buildings()
      .filter((b) => b.kind === kind && b.built() && isPlayerBuilding(b))
      .sort((a, b) => distance(a.center, from) - distance(b.center, from) || a.id - b.id)[0] ?? null
  );
}
function questItems(town: Town): readonly string[] {
  const out: string[] = [];
  for (const branch of [GoalBranch.Core, GoalBranch.Arms]) {
    const index = currentGoal(town, branch),
      goal = index >= 0 ? settlementGoals()[index] : null;
    if (goal?.kind === GoalKind.Craft) out.push(...goal.items);
  }
  return out;
}
/** What the row offers the chosen crafter. */
export interface RecipeOffer {
  /** 'craft' makes it new; 'upgrade' turns the crafter's weaker make into it; 'switch' picks another crafter. */
  action: 'craft' | 'upgrade' | 'switch' | 'spare';
  /** Who the order or the switch goes to. */
  who: Person | null;
  cost: Resources;
  /** Why it cannot be done now (danger), or ''. */
  reason: string;
  /** A short mark when the crafter already has one: 'Has one', 'In hand', 'Worn', 'Has a better one'. */
  mark: string;
  /** A plain hint about who it is for. */
  hint: string;
}
const markOf = (item: ItemSpec, owned: ReturnType<typeof ownedMake>): string =>
  owned === 'held'
    ? item.category === 'armor' && !isShield(item)
      ? 'Worn'
      : 'In hand'
    : owned === 'owned'
      ? 'Has one'
      : owned === 'better'
        ? 'Has a better one'
        : '';
/** What a recipe row offers: an upgrade of the crafter's weaker make, a tool for someone who lacks one, or a plain craft. */
export function recipeOffer(town: Town, station: Building, crafter: Person | null, item: ItemSpec): RecipeOffer {
  if (!crafter)
    return { action: 'craft', who: null, cost: item.cost, reason: 'Select a controllable resident', mark: '', hint: '' };
  const owned = ownedMake(crafter, item),
    mark = markOf(item, owned),
    craft = (who: Person, hint = '', action: RecipeOffer['action'] = 'craft'): RecipeOffer => ({
      action,
      who,
      cost: item.cost,
      reason: town.craftReason(who.id, station.id, item.id),
      mark,
      hint,
    });
  if (!owned && upgradeSource(crafter, item))
    return {
      action: 'upgrade',
      who: crafter,
      cost: upgradeCost(item),
      reason: town.upgradeReason(crafter.id, station.id, item.id),
      mark,
      hint: '',
    };
  if (!owned) return craft(crafter);
  // The crafter has one: a tool goes to someone without; fitted gear points at who lacks it.
  const lacking = crafters(town, station).find(
    (p) => p !== crafter && lacksKind(p, item) && (p.task !== Activity.Crafting || p.craftWorkshop === station.id),
  );
  if (item.category === 'tool')
    return lacking
      ? craft(lacking, `${lacking.name} has none: ${lacking.name} will make it`)
      : craft(crafter, 'Everyone has one', 'spare');
  if (lacking)
    return { action: 'switch', who: lacking, cost: item.cost, reason: '', mark, hint: `${lacking.name} has none` };
  return craft(crafter, 'Everyone has one');
}
/** Inspector rows of a workbench or smithy: who works, the station's level, who waits, and every recipe. */
export function stationRows(app: GameHudApp, station: Building, out: InspectorRows): void {
  if (!isCraftStation(station.kind)) return;
  const c = app.context,
    t = app.theme,
    town = app.town,
    owned = isPlayerBuilding(station),
    { left, inner, top } = out,
    able = crafters(town, station),
    crafter = stationCrafter(app, station),
    working = town.craftingAt(station.id),
    waiting = town.craftQueue(station.id),
    wanted = questItems(town),
    narrow = inner < 360,
    line = (text: string, color = t.text, size = 12, bold = false) => {
      const at = out.y;
      out.rows.push(() =>
        c.text(
          new Rect(left, f32(top + at), inner, size + 8),
          c.elideText(text, inner, size, bold),
          color,
          size,
          bold,
        ),
      );
      out.y = f32(out.y + size + 9);
    };
  out.y = f32(out.y + 4);
  // Who will do the work: face, name and gear, with arrows to change it.
  {
    const at = out.y,
      index = crafter ? able.indexOf(crafter) : -1,
      step = (by: number) => () => {
        const next = able[(index + by + able.length) % able.length];
        if (next) pickCrafter(app, station.id, next.id);
      },
      face = 44,
      textX = f32(left + face + 8),
      textW = f32(inner - face - 8 - 60);
    out.rows.push(() => {
      const y = f32(top + at),
        frame = new Rect(left, y, face, face);
      c.rect(frame, t.raised, 3, t.border);
      if (crafter)
        c.paint(JSON.stringify(['station-face', crafter.id, crafter.look, crafter.race, String(crafter.lookRevision), crafter.calling, moodOf(crafter), face, left, y]), () => {
          const paint = hudPaint(
            c,
            personPortrait(crafter, moodOf(crafter), face - 2, face - 2, portraitBackdrop(town.map(), crafter.position, town.climate())),
          );
          paint.translate(f32(left + 1), f32(y + 1));
          return paint;
        });
      c.text(new Rect(textX, y, textW, 16), 'Crafter', t.muted, 10);
      c.text(
        new Rect(textX, f32(y + 13), textW, 18),
        c.elideText(crafter ? `${crafter.name} · ${callingName(crafter.calling)} · Lv ${crafter.level}` : 'No resident can work here', textW, 12, true),
        crafter ? t.text : t.danger,
        12,
        true,
      );
      if (crafter) {
        const hands = [equippedItem(crafter, 'weapon')?.name, equippedItem(crafter, 'offhand')?.name].filter(Boolean),
          worn = [equippedItem(crafter, 'body')?.name, equippedItem(crafter, 'head')?.name].filter(Boolean),
          tools = carriedTools(crafter).length,
          gear = [
            `In hand: ${hands.join(', ') || 'nothing'}`,
            ...(worn.length ? [`Worn: ${worn.join(', ')}`] : []),
            tools ? `Tools: ${tools}` : 'No tools',
          ].join(' · ');
        c.text(new Rect(textX, f32(y + 30), textW, 14), c.elideText(gear, textW, 9), t.muted, 9);
      }
      actionButton(c, `station-crafter-prev-${station.id}`, new Rect(f32(left + inner - 58), f32(y + 9), 26, 26), 'back', 'Previous resident', step(-1), false, able.length > 1);
      actionButton(c, `station-crafter-next-${station.id}`, new Rect(f32(left + inner - 28), f32(y + 9), 26, 26), 'next', 'Next resident', step(1), false, able.length > 1);
    });
    out.y = f32(out.y + face + 8);
  }
  const cancelW = 66,
    cancel = (p: Person, id: string, y: number) =>
      button(
        c,
        id,
        new Rect(f32(left + inner - cancelW), y, cancelW, 26),
        'Cancel',
        () => {
          const name = town.orderName(p);
          if (town.cancelCraft(p.id) && name) app.status = `${p.name} stopped making the ${name}`;
        },
        ButtonStyle.Default,
        owned,
        undefined,
        false,
        { fontSize: 11 },
      );
  // The station's level, what the next one opens and what it asks.
  {
    const level = stationLevel(station),
      next = stationStep(station.kind, level + 1),
      name = structureSpec(station.kind).name;
    line(stationTitle(name, level), t.accent, 12, true);
    if (!next) line(level >= topLevel(station.kind) ? 'Highest level: everything here can be made' : '', t.muted, 10);
    else {
      for (const text of wrapText(c, `Next level makes ${next.opens}`, inner, 10, 2)) line(text, t.text, 10);
      const reason = crafter ? town.stationUpgradeReason(crafter.id, station.id) : 'Select a controllable resident',
        upgrading = !!crafter && crafter.task === Activity.Crafting && crafter.craftWorkshop === station.id && crafter.craftItem === stationOrder(next.level),
        at = out.y,
        buttonW = 78;
      out.rows.push(() => {
        const y = f32(top + at),
          w = f32(inner - buttonW - 6);
        c.text(new Rect(left, y, w, 14), c.elideText(`Upgrade: ${describe(next.cost)}`, w, 10), t.accent, 10);
        c.text(new Rect(left, f32(y + 14), w, 14), c.elideText(reason || 'Ready to upgrade', w, 9), reason ? t.danger : t.muted, 9);
        if (upgrading) cancel(crafter!, `station-level-cancel-${station.id}`, y);
        else
          button(
            c,
            `station-upgrade-${station.id}`,
            new Rect(f32(left + inner - buttonW), y, buttonW, 26),
            'Upgrade',
            () => {
              if (crafter && town.orderStationUpgrade(crafter.id, station.id))
                app.status = `${crafter.name} goes to upgrade the ${name.toLowerCase()}`;
            },
            ButtonStyle.Primary,
            owned && !reason,
            undefined,
            false,
            { fontSize: 11 },
          );
      });
      out.y = f32(out.y + 32);
    }
  }
  if (working) {
    const at = out.y,
      share = town.craftShare(working),
      text = `${working.name} is making ${town.orderName(working)} · ${Math.trunc(share * 100)}%`;
    out.rows.push(() => {
      const y = f32(top + at),
        w = f32(inner - cancelW - 6);
      c.text(new Rect(left, y, w, 26), c.elideText(text, w, 12, true), t.accent, 12, true);
      cancel(working, `station-cancel-${station.id}`, y);
    });
    out.y = f32(out.y + 30);
    const barAt = out.y;
    out.rows.push(() => {
      c.rect(new Rect(left, f32(top + barAt), inner, 6), t.raised, 3);
      c.rect(new Rect(left, f32(top + barAt), Math.max(6, f32(inner * share)), 6), t.accent, 3);
    });
    out.y = f32(out.y + 12);
    // A crafter at the bench without the materials stands still: say why.
    const order = craftOrder(working.craftItem),
      stuck = !order
        ? ''
        : order.kind === 'station'
          ? town.stationUpgradeReason(working.id, station.id)
          : order.kind === 'upgrade'
            ? town.upgradeReason(working.id, station.id, order.item.id)
            : town.craftReason(working.id, station.id, order.item.id);
    if (stuck) line(stuck, t.danger, 11);
  } else line('Nobody is working here', t.muted, 11);
  // Each resident in line can be called off on their own; nothing is spent until an item is done.
  for (const p of waiting) {
    const at = out.y,
      text = `${p.name} waits to make ${town.orderName(p)}`;
    out.rows.push(() => {
      const y = f32(top + at),
        w = f32(inner - cancelW - 6);
      c.text(new Rect(left, y, w, 26), c.elideText(text, w, 11), t.muted, 11);
      cancel(p, `station-cancel-${station.id}-${p.id}`, y);
    });
    out.y = f32(out.y + 30);
  }
  if (working || waiting.length) line('Nothing is spent until the item is done.', t.muted, 10);
  out.y = f32(out.y + 4);
  // Recipes come in groups the player switches between; a long group still pages.
  const grouped = stationRecipes(station.kind),
    group = shownGroup(app, station, grouped, wanted),
    recipes = grouped.get(group) ?? [],
    // A phone-width panel stacks name, cost and effect so none is cut, and shows fewer rows a page.
    perPage = narrow ? 6 : recipesPerPage,
    rowH = narrow ? 52 : 38,
    pageCount = Math.ceil(recipes.length / perPage),
    page = Math.max(0, Math.min(pages.get(app)?.get(station.id) ?? 0, pageCount - 1));
  if (grouped.size > 1) {
    const at = out.y,
      tabs = [...grouped.keys()],
      gap = 6,
      w = f32((inner - gap * (tabs.length - 1)) / tabs.length);
    out.rows.push(() =>
      tabs.forEach((tab, i) => {
        const quest = grouped.get(tab)!.some((item) => wanted.includes(item.id));
        button(
          c,
          `station-group-${tab.toLowerCase()}-${station.id}`,
          new Rect(f32(left + i * (w + gap)), f32(top + at), w, 26),
          quest && tab !== group ? `${tab} · Quest` : tab,
          () => {
            let map = groups.get(app);
            if (!map) groups.set(app, (map = new Map()));
            map.set(station.id, tab);
            pages.get(app)?.set(station.id, 0);
          },
          ButtonStyle.Default,
          true,
          undefined,
          tab === group,
          { fontSize: 11 },
        );
      }),
    );
    out.y = f32(out.y + 32);
  }
  for (const item of recipes.slice(page * perPage, (page + 1) * perPage)) {
    const at = out.y,
      offer = recipeOffer(town, station, crafter, item),
      quest = wanted.includes(item.id),
      faded = !!offer.mark,
      making =
        !!crafter &&
        crafter.task === Activity.Crafting &&
        crafter.craftWorkshop === station.id &&
        orderItem(crafter.craftItem)?.id === item.id,
      label =
        offer.action === 'upgrade' ? 'Upgrade' : offer.action === 'switch' ? 'Switch' : offer.action === 'spare' ? 'Spare' : 'Craft',
      status = offer.reason || offer.hint || (offer.action === 'upgrade' ? 'Ready to upgrade' : 'Ready to craft'),
      statusColor = offer.reason ? t.danger : offer.hint ? t.accent : t.muted,
      paidText = offer.action === 'upgrade' ? `Upgrade: ${describe(offer.cost)}` : describe(offer.cost),
      // An owned make is drawn faded with its mark; a recipe that cannot be made keeps full contrast and says why.
      nameColor = faded ? t.muted : offer.reason ? t.muted : t.text,
      run = () => {
        const who = offer.who;
        if (!who) return;
        if (offer.action === 'switch') {
          pickCrafter(app, station.id, who.id);
          return;
        }
        const ok =
          offer.action === 'upgrade'
            ? town.orderUpgrade(who.id, station.id, item.id)
            : town.orderCraft(who.id, station.id, item.id);
        if (ok)
          app.status =
            offer.action === 'upgrade' ? `${who.name} goes to upgrade to the ${item.name}` : `${who.name} goes to make ${item.name}`;
      };
    out.rows.push(() => {
      const y = f32(top + at),
        r = new Rect(left, y, inner, rowH),
        // On a phone the icon and button sit beside the name and cost, leaving the effect line the whole row.
        buttonY = f32(y + (narrow ? 4 : (rowH - 26) / 2));
      c.rect(r, faded ? t.surface : t.raised, 3, quest ? t.accent : t.border);
      itemIcon(
        c,
        narrow
          ? new Rect(f32(left + 5), f32(y + 3), 28, 28)
          : new Rect(f32(left + 3), f32(y + (rowH - 32) / 2), 32, 32),
        item,
        faded,
      );
      let nameX = f32(left + 40);
      const chip = (text: string, fill: Color, ink: Color, border?: Color) => {
        const w = f32(c.textWidth(text, 8, true) + 10),
          mark = new Rect(nameX, f32(y + 5), w, 13);
        c.rect(mark, fill, 6, border);
        c.text(mark, text, ink, 8, true, Align.Center);
        nameX = f32(nameX + w + 6);
      };
      if (quest) chip('Quest', t.accent, t.accentText);
      if (offer.mark) chip(offer.mark, t.surface, t.muted, t.border);
      const effect = gearEffect(item);
      if (narrow) {
        const textW = f32(inner - 40 - 66),
          paid = paidText + ` · ${status}`;
        c.text(
          new Rect(nameX, f32(y + 2), f32(textW - (nameX - left - 40)), 18),
          c.elideText(item.name, f32(textW - (nameX - left - 40)), 12, true),
          nameColor,
          12,
          true,
        );
        c.text(new Rect(f32(left + 40), f32(y + 18), textW, 16), c.elideText(paid, textW, 10), offer.reason ? t.danger : faded ? t.muted : t.accent, 10);
        const wide = f32(inner - 16);
        c.text(new Rect(f32(left + 8), f32(y + 33), wide, 16), c.elideText(effect, wide, 9), t.muted, 9);
      } else {
        const split = f32(inner * 0.55),
          textW = f32(split - (nameX - left));
        c.text(new Rect(nameX, f32(y + 2), textW, 18), c.elideText(item.name, textW, 12, true), nameColor, 12, true);
        c.text(new Rect(f32(left + 40), f32(y + 19), f32(split - 40), 16), c.elideText(effect, f32(split - 40), 9), t.muted, 9);
        const rightX = f32(left + split),
          rightW = f32(inner - split - 70);
        c.text(new Rect(rightX, f32(y + 2), rightW, 18), c.elideText(paidText, rightW, 10), faded ? t.muted : t.accent, 10, false, Align.End);
        c.text(new Rect(rightX, f32(y + 19), rightW, 16), c.elideText(status, rightW, 9), statusColor, 9, false, Align.End);
      }
      // The chosen crafter's own order can be stopped from the row it was started on.
      if (making)
        button(
          c,
          `station-cancel-${item.id}`,
          new Rect(f32(left + inner - 62), buttonY, 58, 26),
          'Cancel',
          () => {
            if (crafter && town.cancelCraft(crafter.id)) app.status = `${crafter.name} stopped making the ${item.name}`;
          },
          ButtonStyle.Default,
          owned,
        );
      else
        button(
          c,
          `station-${offer.action}-${item.id}`,
          new Rect(f32(left + inner - 62), buttonY, 58, 26),
          label,
          run,
          offer.action === 'switch' ? ButtonStyle.Default : ButtonStyle.Primary,
          owned && !offer.reason && !!offer.who,
          undefined,
          false,
          { fontSize: 11 },
        );
    });
    out.y = f32(out.y + rowH + 4);
  }
  if (pageCount > 1) {
    const at = out.y,
      turn = (to: number) => () => {
        let map = pages.get(app);
        if (!map) pages.set(app, (map = new Map()));
        map.set(station.id, to);
      };
    out.rows.push(() => {
      const y = f32(top + at);
      actionButton(
        c,
        `station-page-prev-${station.id}`,
        new Rect(f32(left + inner - 92), y, 28, 26),
        'back',
        'Previous recipes',
        turn(page - 1),
        false,
        page > 0,
      );
      c.text(
        new Rect(f32(left + inner - 62), y, 28, 26),
        `${page + 1}/${pageCount}`,
        t.muted,
        10,
        false,
        Align.Center,
      );
      actionButton(
        c,
        `station-page-next-${station.id}`,
        new Rect(f32(left + inner - 30), y, 28, 26),
        'next',
        'Next recipes',
        turn(page + 1),
        false,
        page < pageCount - 1,
      );
    });
    out.y = f32(out.y + 30);
  }
}
/** A progress bar over each station while someone works it, in the HUD's own style. */
export function craftBars(app: GameHudApp, width: number, height: number): void {
  const c = app.context,
    t = app.theme;
  noteSelection(app);
  for (const b of app.town.buildings()) {
    if (!isCraftStation(b.kind) || !b.built() || !isPlayerBuilding(b)) continue;
    const p = app.town.craftingAt(b.id);
    if (!p || !app.town.map().revealed(b.center)) continue;
    const share = app.town.craftShare(p);
    const roof = app.camera.toScreen(
        app.renderer.buildingRoof(b) ?? project(b.center.x, b.center.y, 24),
        width,
        height,
      ),
      w = 52,
      r = new Rect(f32(roof.x - w / 2), f32(roof.y - 16), w, 8);
    if (r.x < -w || r.x > width || r.y < 0 || r.y > height) continue;
    c.rect(r, t.surface, 4, t.border);
    c.rect(new Rect(f32(r.x + 1), f32(r.y + 1), Math.max(4, f32((w - 2) * share)), 6), t.accent, 3);
    c.requestFrameAt(c.time() + 0.25);
  }
}
