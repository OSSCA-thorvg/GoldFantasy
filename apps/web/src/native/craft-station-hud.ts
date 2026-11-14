import { Rect, Align, ButtonStyle, button } from '../../../../packages/native-ui/src';
import { Structure, describe } from '../../../../packages/engine/src/building-catalog';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, Role, type Person } from '../../../../packages/engine/src/person';
import { distance, project } from '../../../../packages/engine/src/geometry';
import { f32 } from '../../../../packages/engine/src/numeric';
import { canControl, isPlayerBuilding } from '../../../../packages/engine/src/faction';
import {
  craftsAt,
  gearEffect,
  isCraftStation,
  itemCatalog,
  itemSpec,
  type ItemSpec,
} from '../../../../packages/engine/src/equipment';
import {
  GoalBranch,
  GoalKind,
  currentGoal,
  settlementGoals,
} from '../../../../packages/engine/src/settlement-progression';
import type { GameHudApp } from './game-hud-contract';
import type { InspectorRows } from './game-progress-hud';
import { actionButton } from './hud-actions';
import { itemIcon } from './game-equipment-panel';

// The resident the player chose to work each station, the recipe group and its page shown; transient, per app.
const picks = new WeakMap<object, Map<number, number>>(),
  pages = new WeakMap<object, Map<number, number>>(),
  groups = new WeakMap<object, Map<number, RecipeGroup>>(),
  recipesPerPage = 10;
export type RecipeGroup = 'Tools' | 'Weapons' | 'Gear';
const groupOrder: readonly RecipeGroup[] = ['Tools', 'Weapons', 'Gear'];
/** Tools speed a kind of work; weapons are held to fight; gear is the rest (armour, a knife, a basket). */
export const recipeGroup = (item: ItemSpec): RecipeGroup =>
  item.work.length ? 'Tools' : item.category === 'weapon' ? 'Weapons' : 'Gear';
const materialRank = (item: ItemSpec): number => ['wood', 'stone', 'iron'].indexOf(item.material ?? 'iron');
/** A station's recipes by group, each tool shape's tiers side by side (wood, stone, iron). */
export function stationRecipes(kind: Structure): Map<RecipeGroup, ItemSpec[]> {
  const recipes = itemCatalog.filter((i) => craftsAt(i, kind)),
    shape = (item: ItemSpec) => recipes.findIndex((other) => other.visual === item.visual),
    out = new Map<RecipeGroup, ItemSpec[]>();
  for (const group of groupOrder) {
    const list = recipes
      .filter((item) => recipeGroup(item) === group)
      .sort((a, b) => shape(a) - shape(b) || materialRank(a) - materialRank(b));
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
/** Residents who can be sent to work `station`, nearest first. */
export function crafters(town: Town, station: Building): Person[] {
  const village = town.settlementOf(station);
  return town
    .people()
    .filter((p) => p.role === Role.Resident && canControl(p) && town.settlementOf(p) === village)
    .sort(
      (a, b) => distance(a.position, station.center) - distance(b.position, station.center) || a.id - b.id,
    );
}
/** The chosen crafter, else a selected resident, else the nearest one not busy crafting elsewhere. */
export function stationCrafter(app: GameHudApp, station: Building): Person | null {
  const able = crafters(app.town, station),
    picked = picks.get(app)?.get(station.id);
  return (
    able.find((p) => p.id === picked) ??
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
  const index = currentGoal(town, GoalBranch.Core),
    goal = index >= 0 ? settlementGoals()[index] : null;
  return goal?.kind === GoalKind.Craft ? goal.items : [];
}
const percent = (p: Person): number => {
  const item = p.craftItem ? itemSpec(p.craftItem) : null;
  return item ? Math.min(1, p.craftProgress / item.seconds) : 0;
};
/** Inspector rows of a workbench, weaponsmith or armorer: who works, who waits, and every recipe. */
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
  // Who will do the work, with a way to change it here.
  {
    const at = out.y,
      index = crafter ? able.indexOf(crafter) : -1,
      step = (by: number) => () => {
        const next = able[(index + by + able.length) % able.length];
        if (next) pickCrafter(app, station.id, next.id);
      };
    out.rows.push(() => {
      const y = f32(top + at);
      c.text(new Rect(left, y, 70, 26), 'Crafter', t.muted, 11, false, Align.Start);
      actionButton(
        c,
        `station-crafter-prev-${station.id}`,
        new Rect(f32(left + 70), y, 26, 26),
        'back',
        'Previous resident',
        step(-1),
        false,
        able.length > 1,
      );
      c.text(
        new Rect(f32(left + 100), y, f32(inner - 134), 26),
        c.elideText(
          crafter ? `${crafter.name} · Lv ${crafter.level}` : 'No resident can work here',
          f32(inner - 134),
          12,
          true,
        ),
        crafter ? t.text : t.danger,
        12,
        true,
      );
      actionButton(
        c,
        `station-crafter-next-${station.id}`,
        new Rect(f32(left + inner - 28), y, 26, 26),
        'next',
        'Next resident',
        step(1),
        false,
        able.length > 1,
      );
    });
    out.y = f32(out.y + 32);
  }
  const cancelW = 66,
    cancel = (p: Person, id: string, y: number) =>
      button(
        c,
        id,
        new Rect(f32(left + inner - cancelW), y, cancelW, 26),
        'Cancel',
        () => {
          const item = itemSpec(p.craftItem ?? '');
          if (town.cancelCraft(p.id) && item) app.status = `${p.name} stopped making the ${item.name}`;
        },
        ButtonStyle.Default,
        owned,
        undefined,
        false,
        { fontSize: 11 },
      );
  if (working) {
    const item = itemSpec(working.craftItem ?? ''),
      at = out.y,
      text = `${working.name} is making ${item?.name ?? ''} · ${Math.trunc(percent(working) * 100)}%`;
    out.rows.push(() => {
      const y = f32(top + at),
        w = f32(inner - cancelW - 6);
      c.text(new Rect(left, y, w, 26), c.elideText(text, w, 12, true), t.accent, 12, true);
      cancel(working, `station-cancel-${station.id}`, y);
    });
    out.y = f32(out.y + 30);
    const barAt = out.y,
      done = percent(working);
    out.rows.push(() => {
      c.rect(new Rect(left, f32(top + barAt), inner, 6), t.raised, 3);
      c.rect(new Rect(left, f32(top + barAt), Math.max(6, f32(inner * done)), 6), t.accent, 3);
    });
    out.y = f32(out.y + 12);
    // A crafter at the bench without the materials stands still: say why.
    const stuck = item ? town.craftReason(working.id, station.id, item.id) : '';
    if (stuck) line(stuck, t.danger, 11);
  } else line('Nobody is working here', t.muted, 11);
  // Each resident in line can be called off on their own; nothing is spent until an item is done.
  for (const p of waiting) {
    const at = out.y,
      item = itemSpec(p.craftItem ?? ''),
      text = `${p.name} waits to make ${item?.name ?? ''}`;
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
    narrow = inner < 360,
    perPage = narrow ? 7 : recipesPerPage,
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
      reason = crafter ? town.craftReason(crafter.id, station.id, item.id) : 'Select a controllable resident',
      quest = wanted.includes(item.id),
      making =
        !!crafter &&
        crafter.task === Activity.Crafting &&
        crafter.craftItem === item.id &&
        crafter.craftWorkshop === station.id;
    out.rows.push(() => {
      const y = f32(top + at),
        r = new Rect(left, y, inner, rowH),
        // On a phone the icon and button sit beside the name and cost, leaving the effect line the whole row.
        buttonY = f32(y + (narrow ? 4 : (rowH - 26) / 2));
      c.rect(r, t.raised, 3, quest ? t.accent : t.border);
      itemIcon(
        c,
        narrow
          ? new Rect(f32(left + 5), f32(y + 3), 28, 28)
          : new Rect(f32(left + 3), f32(y + (rowH - 32) / 2), 32, 32),
        item,
      );
      let nameX = f32(left + 40);
      if (quest) {
        const w = f32(c.textWidth('Quest', 8, true) + 10),
          mark = new Rect(nameX, f32(y + 5), w, 13);
        c.rect(mark, t.accent, 6);
        c.text(mark, 'Quest', t.accentText, 8, true, Align.Center);
        nameX = f32(nameX + w + 6);
      }
      const effect = gearEffect(item);
      if (narrow) {
        const textW = f32(inner - 40 - 66),
          paid = describe(item.cost) + (reason ? ` · ${reason}` : '');
        c.text(
          new Rect(nameX, f32(y + 2), f32(textW - (nameX - left - 40)), 18),
          c.elideText(item.name, f32(textW - (nameX - left - 40)), 12, true),
          reason ? t.muted : t.text,
          12,
          true,
        );
        c.text(
          new Rect(f32(left + 40), f32(y + 18), textW, 16),
          c.elideText(paid, textW, 10),
          reason ? t.danger : t.accent,
          10,
        );
        const wide = f32(inner - 16);
        c.text(new Rect(f32(left + 8), f32(y + 33), wide, 16), c.elideText(effect, wide, 9), t.muted, 9);
      } else {
        const split = f32(inner * 0.62),
          textW = f32(split - (nameX - left));
        c.text(
          new Rect(nameX, f32(y + 2), textW, 18),
          c.elideText(item.name, textW, 12, true),
          reason ? t.muted : t.text,
          12,
          true,
        );
        c.text(
          new Rect(f32(left + 40), f32(y + 19), f32(split - 40), 16),
          c.elideText(effect, f32(split - 40), 9),
          t.muted,
          9,
        );
        const rightX = f32(left + split),
          rightW = f32(inner - split - 70);
        c.text(
          new Rect(rightX, f32(y + 2), rightW, 18),
          c.elideText(describe(item.cost), rightW, 10),
          t.accent,
          10,
          false,
          Align.End,
        );
        c.text(
          new Rect(rightX, f32(y + 19), rightW, 16),
          c.elideText(reason || 'Ready to craft', rightW, 9),
          reason ? t.danger : t.muted,
          9,
          false,
          Align.End,
        );
      }
      // The chosen crafter's own order can be stopped from the row it was started on.
      if (making)
        button(
          c,
          `station-cancel-${item.id}`,
          new Rect(f32(left + inner - 62), buttonY, 58, 26),
          'Cancel',
          () => {
            if (crafter && town.cancelCraft(crafter.id))
              app.status = `${crafter.name} stopped making the ${item.name}`;
          },
          ButtonStyle.Default,
          owned,
        );
      else
        button(
          c,
          `station-craft-${item.id}`,
          new Rect(f32(left + inner - 62), buttonY, 58, 26),
          'Craft',
          () => {
            const p = stationCrafter(app, station);
            if (p && town.orderCraft(p.id, station.id, item.id))
              app.status = `${p.name} goes to make ${item.name}`;
          },
          ButtonStyle.Primary,
          owned && !reason,
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
  for (const b of app.town.buildings()) {
    if (!isCraftStation(b.kind) || !b.built() || !isPlayerBuilding(b)) continue;
    const p = app.town.craftingAt(b.id);
    if (!p || !app.town.map().revealed(b.center)) continue;
    const roof = app.camera.toScreen(
        app.renderer.buildingRoof(b) ?? project(b.center.x, b.center.y, 24),
        width,
        height,
      ),
      w = 52,
      r = new Rect(f32(roof.x - w / 2), f32(roof.y - 16), w, 8);
    if (r.x < -w || r.x > width || r.y < 0 || r.y > height) continue;
    c.rect(r, t.surface, 4, t.border);
    c.rect(new Rect(f32(r.x + 1), f32(r.y + 1), Math.max(4, f32((w - 2) * percent(p))), 6), t.accent, 3);
    c.requestFrameAt(c.time() + 0.25);
  }
}
