// Native settlement_progression.cpp. Guidance/UI rules are intentionally separate from Town::place.
import type { Town } from './town';
import { Product, Structure, structureSpec } from './building-catalog';
import { heldAmount } from './carried-resources';
import { resourceAmount } from './construction-materials';
import { Tool, toolStructure } from './game-tools';
import rows from '../data/settlement-goals.json';
import { belongsToFaction } from './faction';
import { sealProgress } from './gate-seals';
import { Activity, Calling, Role, type Person } from './person';
import { equipmentSlots, equippedItem, itemSpec } from './equipment';
import type { Building } from './town-models';
import { point, type Point } from './geometry';
export interface Unlock {
  available: boolean;
  reason: string;
}
/** One condition for placing a building, as the build menu lists it. */
export interface UnlockRequirement {
  text: string;
  done: boolean;
}
export enum GoalKind {
  Building,
  Road,
  Field,
  Population,
  /** `count` floors cleared beyond any gates. */
  Floor,
  /** `count` gates sealed; 0 means every gate. */
  Seal,
  /** `count` of the deed named by `deed` (see `deedCount`). */
  Deed,
  /** `count` different items of `items` owned by residents. */
  Craft,
  /** `count` residents with a tool or weapon in hand. */
  Equip,
}
/** Core is one ordered chain; the others advance side by side in any order. */
export enum GoalBranch {
  Core,
  Trade,
  Arms,
  Faith,
  Saga,
}
export const goalBranchName = (branch: GoalBranch): string =>
  ['Founding', 'Trade', 'Arms', 'Faith', 'Saga'][branch] ?? '';
const deedKeys = [
  'raidsRepelled',
  'guardiansSlain',
  'partiesLed',
  'largestParty',
  'rescues',
  'weaponsForged',
  'monstersSlain',
  'sworn',
  'floors',
  'seals',
] as const;
/** Deeds a goal or an unlock can ask for. `sworn` counts living residents with a calling from the guild. */
export type DeedKey = (typeof deedKeys)[number];
const deedKey = (value: string): DeedKey => {
  const key = deedKeys.find((k) => k === value);
  if (!key) throw new Error('Unknown deed ' + value);
  return key;
};
export interface SettlementGoal {
  title: string;
  description: string;
  kind: GoalKind;
  building: Structure;
  /** The number the goal asks for (residents, floors, gates or deeds); same as `count`. */
  residents: number;
  count: number;
  /** The deed a `GoalKind.Deed` goal counts; '' for other kinds. */
  deed: DeedKey | '';
  /** Item ids a `GoalKind.Craft` goal accepts; empty for other kinds. */
  items: readonly string[];
  branch: GoalBranch;
}
const itemIds = (ids: readonly string[] | undefined): string[] =>
  (ids ?? []).map((id) => {
    if (!itemSpec(id)) throw new Error('Unknown item ' + id);
    return id;
  });
const goals: SettlementGoal[] = rows.map((row) => ({
  title: row.title,
  description: row.description,
  kind: GoalKind[row.kind as keyof typeof GoalKind],
  building: Structure[row.building as keyof typeof Structure],
  residents: row.residents,
  count: row.residents,
  deed: row.deed ? deedKey(row.deed) : '',
  items: itemIds('items' in row ? row.items : undefined),
  branch: GoalBranch[row.branch as keyof typeof GoalBranch],
}));
const ownResidents = (town: Town): Person[] =>
  town.folk.filter((p) => p.role === Role.Resident && p.faction === town.controlFaction && p.health > 0);
/** How many of `ids` some living resident owns. */
export function itemsOwned(town: Town, ids: readonly string[]): number {
  const owned = new Set<string>();
  for (const p of ownResidents(town)) for (const stack of p.inventory) if (stack) owned.add(stack.item);
  return ids.filter((id) => owned.has(id)).length;
}
/** Residents holding a tool or a weapon. */
export function residentsEquipped(town: Town): number {
  return ownResidents(town).filter((p) =>
    equipmentSlots.some((slot) => {
      const item = equippedItem(p, slot);
      return item?.category === 'tool' || item?.category === 'weapon';
    }),
  ).length;
}
/** A raw material a site still lacks that nobody can get: none stored, carried, or in sight on the map. */
export function unsourcedMaterial(town: Town, site: Building): Product.Wood | Product.Stone | null {
  const reach = Math.hypot(town.map().width(), town.map().height());
  for (const product of [Product.Stone, Product.Wood] as const) {
    if (site.materials.missing(product) <= 0) continue;
    if (resourceAmount(town.stock(town.settlementOf(site)), product) > 0) continue;
    if (ownResidents(town).some((p) => heldAmount(p, product) > 0)) continue;
    if (!town.resourceNearby(site.center, reach, product)) return product;
  }
  return null;
}
/** The nearest unexplored, reachable ground around `from`, in widening rings. */
export function scoutPoint(town: Town, from: Point): Point | null {
  for (let radius = 8; radius <= 40; radius += 4)
    for (let i = 0; i < 24; ++i) {
      const angle = (i * Math.PI) / 12,
        at = point(from.x + radius * Math.cos(angle), from.y + radius * Math.sin(angle));
      if (!town.map().inside(at) || town.map().revealed(at)) continue;
      const step = town.grid.nearestWalkable(at);
      if (town.grid.path(from, step).length) return step;
    }
  return null;
}
export function completedFacility(town: Town, kind: Structure): boolean {
  for (const b of town.buildings())
    if (b.built() && belongsToFaction(b, town.controlFaction))
      for (let stage = kind; stage !== Structure.Count; stage = structureSpec(stage).next)
        if (b.kind === stage) return true;
  return false;
}
/** How many times the settlement has done a deed. Never decreases except `sworn`, which counts the living. */
export function deedCount(town: Town, deed: DeedKey): number {
  switch (deed) {
    case 'sworn':
      return town.folk.filter(
        (p) =>
          p.role === Role.Resident &&
          p.faction === town.controlFaction &&
          p.health > 0 &&
          p.calling >= Calling.Warrior,
      ).length;
    case 'floors':
      return town.depth.reduce((sum, floors) => sum + floors, 0);
    case 'seals':
      return sealProgress(town).sealed;
    default:
      return town.chronicle[deed];
  }
}
const roadDone = (town: Town): boolean =>
  town
    .roads()
    .roads()
    .some(
      (r) =>
        r.built >= 1 && !!town.camp(r.village) && belongsToFaction(town.camp(r.village)!, town.controlFaction),
    );
interface UnlockRule {
  after: Structure[];
  deeds: [DeedKey, number, string][];
  population: number;
  road: boolean;
}
const raidBeaten: [DeedKey, number, string] = ['raidsRepelled', 1, 'Beat off a raid'],
  floorCleared: [DeedKey, number, string] = ['floors', 1, 'Clear a floor beyond a gate'],
  gateSealed: [DeedKey, number, string] = ['seals', 1, 'Seal a gate'];
function unlockRule(kind: Structure): UnlockRule {
  const rule: UnlockRule = { after: [Structure.Camp], deeds: [], population: 0, road: false };
  const set = (after: Structure[], population = 0, deeds: [DeedKey, number, string][] = []): UnlockRule => {
    rule.after = after;
    rule.population = population;
    rule.deeds = deeds;
    return rule;
  };
  switch (kind) {
    case Structure.Camp:
      return set([]);
    // Timber and stone yards haul along a road; shelter, food and water need only the camp.
    case Structure.Torch:
    case Structure.Lumberyard:
    case Structure.Quarry:
      rule.road = true;
      return rule;
    case Structure.Sawmill:
    case Structure.WoodStore:
      return set([Structure.Lumberyard]);
    case Structure.Stoneworks:
    case Structure.StoneStore:
      return set([Structure.Quarry]);
    case Structure.Granary:
      return set([Structure.Farm]);
    case Structure.Hostel:
      return set([Structure.Tent]);
    case Structure.Storehouse:
      return set([Structure.Quarry], 4);
    case Structure.Tavern:
      return set([Structure.Hostel], 4);
    case Structure.MarketStalls:
      return set([Structure.Hostel]);
    // Arms: each step asks for something the settlement has done.
    case Structure.Guild:
      return set([Structure.Quarry], 6);
    case Structure.TrainingYard:
      return set([Structure.Guild]);
    // The smith forges tools as well as weapons: it follows the guild, not the drill yard.
    case Structure.Weaponsmith:
      return set([Structure.Guild], 10);
    case Structure.Watchtower:
      return set([Structure.TrainingYard], 0, [raidBeaten]);
    case Structure.Armorer:
      return set([Structure.Weaponsmith], 12, [floorCleared]);
    // The altar asks for a home and a food supply for the newcomer it shapes.
    case Structure.Shrine:
      return set([Structure.Tent, Structure.Farm]);
    case Structure.Runestone:
      return set([Structure.Camp]);
    case Structure.Chapel:
      return set([Structure.Shrine], 10);
    // Faith: healing comes early, before the first wounds pile up.
    case Structure.Apothecary:
      return set([Structure.Shrine], 6);
    case Structure.MageTower:
      return set([Structure.Apothecary]);
    case Structure.Portal:
      return set([Structure.MageTower, Structure.Guild], 0, [gateSealed]);
    default:
      return rule;
  }
}
/** Every condition for placing `kind`, in the order `buildingUnlock` checks them. */
export function unlockRequirements(town: Town, kind: Structure): UnlockRequirement[] {
  const rule = unlockRule(kind),
    out: UnlockRequirement[] = [];
  if (kind === Structure.Camp) return out;
  const facility = (stage: Structure): void => {
    const text = 'Complete ' + structureSpec(stage).name;
    if (!out.some((r) => r.text === text)) out.push({ text, done: completedFacility(town, stage) });
  };
  for (const stage of rule.after) facility(stage);
  for (const [deed, count, text] of rule.deeds) out.push({ text, done: deedCount(town, deed) >= count });
  if (rule.road) out.push({ text: 'Complete a road', done: roadDone(town) });
  const cost = structureSpec(kind).cost;
  if (cost.planks) facility(Structure.Sawmill);
  if (cost.cutStone) facility(Structure.Stoneworks);
  const population = Math.max(rule.population, structureSpec(kind).requiredPopulation);
  if (population)
    out.push({ text: 'Needs ' + population + ' residents', done: town.population() >= population });
  return out;
}
export function buildingUnlock(town: Town, kind: Structure): Unlock {
  const missing = unlockRequirements(town, kind).find((r) => !r.done);
  return missing ? { available: false, reason: missing.text } : { available: true, reason: '' };
}
export function toolAvailable(town: Town, tool: Tool): boolean {
  const kind = toolStructure(tool);
  if (kind !== undefined) return buildingUnlock(town, kind).available;
  if (tool === Tool.Road || tool === Tool.Pave) return completedFacility(town, Structure.Camp);
  if (tool === Tool.Field) return completedFacility(town, Structure.Farm);
  return true;
}
export const settlementGoals = (): readonly SettlementGoal[] => goals;
export function goalComplete(town: Town, goal: SettlementGoal): boolean {
  switch (goal.kind) {
    case GoalKind.Building:
      return completedFacility(town, goal.building);
    case GoalKind.Road:
      return roadDone(town);
    case GoalKind.Field:
      return town.fieldAcres() > 0;
    case GoalKind.Population:
      return town.population() >= goal.count;
    case GoalKind.Floor:
      return deedCount(town, 'floors') >= goal.count;
    case GoalKind.Seal: {
      const { sealed, total } = sealProgress(town);
      return goal.count ? sealed >= goal.count : total > 0 && sealed === total;
    }
    case GoalKind.Deed:
      return !!goal.deed && deedCount(town, goal.deed) >= goal.count;
    case GoalKind.Craft:
      return itemsOwned(town, goal.items) >= goal.count || lessonPassed(town, goal);
    case GoalKind.Equip:
      return residentsEquipped(town) >= goal.count || lessonPassed(town, goal);
    default:
      return false;
  }
}
/** Gear leaves with its owner; once a later building of the chain stands, the crafting lesson stays learned. */
function lessonPassed(town: Town, goal: SettlementGoal): boolean {
  return goals
    .slice(goals.indexOf(goal) + 1)
    .some((later) => later.branch === goal.branch && later.kind === GoalKind.Building && completedFacility(town, later.building));
}
/** A goal's progress for display: `have` of `need`, and a ready line such as "1 / 3 raids beaten off". */
export interface GoalProgress {
  have: number;
  need: number;
  label: string;
}
const deedLabel = (deed: DeedKey, have: number, need: number): string => {
  switch (deed) {
    case 'raidsRepelled':
      return `${have} / ${need} raids beaten off`;
    case 'guardiansSlain':
      return `${have} / ${need} guardians slain`;
    case 'partiesLed':
      return `${have} / ${need} parties led`;
    case 'largestParty':
      return `Largest party ${have} / ${need}`;
    case 'rescues':
      return `${have} / ${need} downed residents revived`;
    case 'weaponsForged':
      return `${have} / ${need} weapons forged`;
    case 'monstersSlain':
      return `${have} / ${need} monsters slain`;
    case 'sworn':
      return `${have} / ${need} residents sworn to a calling`;
    case 'floors':
      return `${have} / ${need} floors cleared`;
    case 'seals':
      return `${have} / ${need} gates sealed`;
  }
};
export function goalProgress(town: Town, goal: SettlementGoal): GoalProgress {
  switch (goal.kind) {
    case GoalKind.Building: {
      const have = completedFacility(town, goal.building) ? 1 : 0,
        started = town
          .buildings()
          .some((b) => b.kind === goal.building && !b.built() && belongsToFaction(b, town.controlFaction));
      return { have, need: 1, label: have ? 'Built' : started ? 'Under construction' : 'Not built yet' };
    }
    case GoalKind.Road: {
      const have = roadDone(town) ? 1 : 0;
      return { have, need: 1, label: have ? 'Road complete' : 'No completed road yet' };
    }
    case GoalKind.Field: {
      const have = town.fieldAcres() > 0 ? 1 : 0;
      return { have, need: 1, label: have ? 'Field planted' : 'No field yet' };
    }
    case GoalKind.Population: {
      const have = town.population();
      return { have, need: goal.count, label: `${have} / ${goal.count} residents` };
    }
    case GoalKind.Floor:
      return progressOfDeed(town, 'floors', goal.count);
    case GoalKind.Seal: {
      const { sealed, total } = sealProgress(town),
        need = goal.count || total;
      return { have: sealed, need, label: deedLabel('seals', sealed, need) };
    }
    case GoalKind.Deed:
      if (goal.deed) return progressOfDeed(town, goal.deed, goal.count);
      break;
    case GoalKind.Craft:
      return craftProgress(town, goal);
    case GoalKind.Equip: {
      const have = lessonPassed(town, goal) ? Math.max(goal.count, residentsEquipped(town)) : residentsEquipped(town);
      return { have, need: goal.count, label: `${have} / ${goal.count} residents with gear in hand` };
    }
  }
  return { have: 0, need: 1, label: '' };
}
function craftProgress(town: Town, goal: SettlementGoal): GoalProgress {
  const have = itemsOwned(town, goal.items),
    need = goal.count;
  if (have >= need || lessonPassed(town, goal)) return { have: Math.max(have, need), need, label: 'Crafted' };
  const crafting = ownResidents(town).find(
    (p) => p.task === Activity.Crafting && !!p.craftItem && goal.items.includes(p.craftItem),
  );
  if (crafting) {
    const item = itemSpec(crafting.craftItem!)!;
    return {
      have: have + crafting.craftProgress / item.seconds,
      need,
      label: `Crafting ${item.name} · ${Math.trunc((crafting.craftProgress / item.seconds) * 100)}%`,
    };
  }
  // Point at the cheapest missing recipe and what the camp and the best-stocked resident still lack.
  const camp = town.camp(),
    village = camp ? town.settlementOf(camp) : -1,
    stock = camp ? town.stock(village) : null,
    missing = goal.items
      .filter((id) => itemsOwned(town, [id]) === 0)
      .map((id) => itemSpec(id)!)
      .sort((a, b) => a.cost.wood + a.cost.stone - (b.cost.wood + b.cost.stone))[0];
  const prefix = need > 1 ? `${have} / ${need} crafted · ` : '';
  if (!missing || !stock) return { have, need, label: `${have} / ${need} crafted` };
  const ready = (product: Product): number =>
    resourceAmount(stock, product) +
    Math.max(0, ...ownResidents(town).filter((p) => town.settlementOf(p) === village).map((p) => heldAmount(p, product)));
  const wood = ready(Product.Wood),
    stone = ready(Product.Stone);
  if (wood < missing.cost.wood) return { have, need, label: `${prefix}Wood ${wood} / ${missing.cost.wood} for ${missing.name}` };
  if (stone < missing.cost.stone)
    return { have, need, label: `${prefix}Stone ${stone} / ${missing.cost.stone} for ${missing.name}` };
  return { have, need, label: `${prefix}Ready to craft ${missing.name}` };
}
function progressOfDeed(town: Town, deed: DeedKey, need: number): GoalProgress {
  const have = deedCount(town, deed);
  return { have, need, label: deedLabel(deed, have, need) };
}
/** Index of the first unfinished goal on a branch, or -1 when the branch is done. */
export function currentGoal(town: Town, branch: GoalBranch): number {
  return goals.findIndex((goal) => goal.branch === branch && !goalComplete(town, goal));
}
