// What the title settlement does next: the quest chain's current step, read from the goals the quest panel shows,
// with the settlement's own needs (beds, fields, roads to every door, food) kept up beside it.
import { Activity, type Person } from '../../../../packages/engine/src/person';
import { Product, Resources, Structure, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { altarCap } from '../../../../packages/engine/src/altar-cap';
import { stationLevel, stationStep } from '../../../../packages/engine/src/craft-stations';
import { heldAmount } from '../../../../packages/engine/src/carried-resources';
import {
  GoalBranch,
  GoalKind,
  buildingUnlock,
  currentGoal,
  scoutPoint,
  settlementGoals,
  type SettlementGoal,
} from '../../../../packages/engine/src/settlement-progression';
import { bestGear, isFighter, makeable, stationBusy } from './title-gear';
import { besideRoad, branchRoad, fieldBeside, firstRoad, plotFor, roadToDoor, routedRoad } from './title-placement';
import { living, order, putOff, waiting, type TitleContext } from './title-roster';
import type { Town } from '../../../../packages/engine/src/town';

/** Branches after the founding chain, in the order the title player follows them. */
const branchOrder = [GoalBranch.Core, GoalBranch.Arms, GoalBranch.Trade, GoalBranch.Faith, GoalBranch.Saga];
const own = (town: Town, kind: Structure, built = true) =>
  town.buildings().find((b) => isPlayerBuilding(b) && b.kind === kind && b.built() === built) ?? null;
const sites = (town: Town) => town.buildings().filter((b) => isPlayerBuilding(b) && !b.built());

/** The goal the player works toward: the founding chain's, then the first open goal on the other branches it can act on. */
export function chosenGoal(town: Town, skip: (goal: SettlementGoal) => boolean = () => false): SettlementGoal | null {
  const goals = settlementGoals();
  for (const branch of branchOrder) {
    const index = currentGoal(town, branch);
    if (index < 0) continue;
    const goal = goals[index];
    if (skip(goal)) continue;
    if (branch === GoalBranch.Core) return goal;
    // Off the founding chain, only goals the settlement can work on directly; the rest come with play.
    if (goal.kind === GoalKind.Building && buildingUnlock(town, goal.building).available) return goal;
    if (goal.kind === GoalKind.Station || goal.kind === GoalKind.Craft) return goal;
  }
  return null;
}
/** Wood and stone the plan still has to find beyond what is stored and carried. */
export interface Shortfall {
  wood: number;
  stone: number;
}
function shortfallOf(town: Town, cost: Resources): Shortfall {
  const folk = living(town),
    stock = town.stock(),
    held = (product: Product) => folk.reduce((sum, p) => sum + heldAmount(p, product), 0);
  return {
    wood: Math.max(0, cost.wood - stock.wood - held(Product.Wood)),
    stone: Math.max(0, cost.stone - stock.stone - held(Product.Stone)),
  };
}
/** Places a site for `kind` unless one is already waiting; false when there is no room or it is locked. */
function startBuilding(ctx: TitleContext, kind: Structure): boolean {
  const { town } = ctx;
  if (sites(town).some((b) => b.kind === kind)) return true;
  if (kind !== Structure.Camp && !buildingUnlock(town, kind).available) return false;
  // A few sites at once; more would spread the builders thin.
  if (sites(town).length >= 1 + Math.floor(town.population() / 4)) return false;
  if (waiting(ctx, `plot:${kind}`)) return false;
  const spot = plotFor(town, kind, ctx.seed, ctx.step);
  if (!spot) {
    // No ground for it in sight: someone walks out to see more, and the search waits a while.
    putOff(ctx, `plot:${kind}`, 30);
    explore(ctx);
    return false;
  }
  // The streets are full: a branch road first, so the village keeps growing along roads.
  if (!besideRoad(town, kind, spot) && !town.roads().empty() && kind !== Structure.Camp && extendStreets(ctx)) return false;
  return order(ctx, `place:${kind}:${Math.round(spot.center.x * 4)}:${Math.round(spot.center.y * 4)}`, [], () =>
    town.place(kind, spot.center, spot.angle),
  );
}
/** Has the quest's items made: the cheapest missing one by whoever is free, as the quest button does. */
function craftGoal(ctx: TitleContext, goal: SettlementGoal): Shortfall {
  const { town } = ctx,
    items =
      goal.kind === GoalKind.Equip
        ? []
        : goal.items;
  const choice = bestGear(town, ctx.free.slice(0, 4), goal.kind === GoalKind.Equip ? undefined : items);
  if (choice)
    order(ctx, `craft:${choice.person.id}:${choice.station.id}:${choice.item.id}`, [choice.person], () =>
      town.orderCraft(choice.person.id, choice.station.id, choice.item.id),
    );
  const someone = ctx.free[0] ?? living(town)[0];
  if (!someone) return { wood: 0, stone: 0 };
  const next = makeable(town, someone, items.length ? items : ['wooden-axe', 'wooden-sword', 'wooden-hoe'])[0];
  return next ? shortfallOf(town, next.cost) : { wood: 4, stone: 0 };
}
function upgradeStation(ctx: TitleContext, kind: Structure): Shortfall {
  const { town } = ctx,
    station = own(town, kind);
  if (!station) return { wood: 0, stone: 0 };
  if (!stationBusy(town, station)) {
    const crafter = ctx.free.find((p) => !town.stationUpgradeReason(p.id, station.id));
    if (crafter)
      order(ctx, `upgrade:${crafter.id}:${station.id}:${stationLevel(station)}`, [crafter], () => town.orderStationUpgrade(crafter.id, station.id));
  }
  const step = stationStep(station.kind, stationLevel(station) + 1);
  return step ? shortfallOf(town, step.cost) : { wood: 0, stone: 0 };
}
function plantField(ctx: TitleContext): void {
  const { town } = ctx;
  if (waiting(ctx, 'field')) return;
  let outline = null;
  for (const farm of town.buildings().filter((b) => isPlayerBuilding(b) && b.kind === Structure.Farm && b.built()))
    if ((outline = fieldBeside(town, farm, ctx.seed, ctx.step))) break;
  // No room beside any farmhouse: the search waits instead of running every step.
  if (!outline) putOff(ctx, 'field', 30);
  else
    order(ctx, `field:${Math.round(outline[0].x * 4)}:${Math.round(outline[0].y * 4)}`, [], () => town.plantField(outline));
}
const roadUnderWay = (town: Town) => town.roads().roads().some((r) => r.faction === 0 && r.built < 1);
function layRoad(ctx: TitleContext): void {
  const { town } = ctx,
    seat = town.camp();
  if (!seat || waiting(ctx, 'street') || roadUnderWay(town) || town.roads().roads().some((r) => r.faction === 0)) return;
  // Straight out of the door, else along the walking path to the nearest building.
  let path = firstRoad(town, ctx.seed);
  for (const b of town.buildings().filter((b) => isPlayerBuilding(b) && b !== seat && b.built()).slice(0, 4))
    path ??= routedRoad(town, seat.door(), b.door());
  if (path) order(ctx, `street:${ctx.step}`, [], () => town.buildRoad(path));
  else putOff(ctx, 'street', 40);
}
/** Lays a branch street unless one is still being built; true when one is under way. */
function extendStreets(ctx: TitleContext): boolean {
  const { town } = ctx;
  if (roadUnderWay(town)) return true;
  // A village has a street for every few houses, not one per house.
  const streets = town.roads().roads().filter((r) => r.faction === 0).length;
  if (streets > 2 + town.buildings().filter(isPlayerBuilding).length / 3 || waiting(ctx, 'branch')) return false;
  putOff(ctx, 'branch', 20);
  const path = branchRoad(town, ctx.seed, ctx.step);
  return !!path && order(ctx, `branch:${ctx.step}`, [], () => town.buildRoad(path));
}
/** Sends one free resident to the nearest unexplored ground, as the quest's scouting button does. */
function explore(ctx: TitleContext): void {
  const { town } = ctx;
  if (waiting(ctx, 'explore') || living(town).some((p) => p.task === Activity.Moving && p.ordered)) return;
  const p = ctx.free.find((q) => !ctx.party.has(q.id) && q.job < 0) ?? ctx.free.find((q) => !ctx.party.has(q.id)),
    at = p && scoutPoint(town, town.camp()?.center ?? p.position);
  if (!p || !at) return;
  putOff(ctx, 'explore', 40);
  order(ctx, `explore:${p.id}:${Math.round(at.x)}:${Math.round(at.y)}`, [p], () => (town.orderMove([p.id], at), true));
}
/** Joins one door a step to the roads, so the village grows along its streets. */
function connectDoors(ctx: TitleContext): void {
  const { town } = ctx;
  // Routing walks the grid, so doors are looked at only now and then.
  if (ctx.step % 10 || town.roads().empty() || roadUnderWay(town)) return;
  for (const b of town.buildings()) {
    if (!isPlayerBuilding(b) || b.kind === Structure.Torch || !b.built()) continue;
    const path = roadToDoor(town, b);
    if (path && order(ctx, `door-road:${b.id}`, [], () => town.buildRoad(path))) return;
  }
}
/** The settlement's own needs beside the quest: food, beds for the altar, fields and roads. */
function keepUp(ctx: TitleContext): Shortfall {
  const { town } = ctx,
    population = town.population();
  let want: Structure | null = null;
  if (!own(town, Structure.Farm) && !own(town, Structure.Farm, false) && population >= 3)
    want = Structure.Farm;
  else if (
    own(town, Structure.Shrine) &&
    population < altarCap(town) &&
    town.housing() <= population + 1 &&
    !sites(town).some((b) => structureSpec(b.kind).residents > 0)
  )
    want = Structure.Tent;
  const farms = town.buildings().filter((b) => isPlayerBuilding(b) && b.kind === Structure.Farm).length;
  if (want === null && population >= 8 && farms < 2 && town.stock().food < population * 3) want = Structure.Farm;
  // A tavern before the settlement works itself into breakdowns.
  if (want === null && population >= 5 && !own(town, Structure.Tavern) && !own(town, Structure.Tavern, false))
    want = Structure.Tavern;
  if (own(town, Structure.Farm) && town.fieldAcres() < Math.min(40, 8 + population * 3)) plantField(ctx);
  connectDoors(ctx);
  if (want !== null && startBuilding(ctx, want)) return shortfallOf(town, structureSpec(want).cost);
  return { wood: 0, stone: 0 };
}
/** What the step decided, for the log and the tests. */
export interface PlanReport {
  goal: string;
  shortfall: Shortfall;
}
export function planSettlement(ctx: TitleContext): PlanReport {
  const { town } = ctx;
  if (!town.camp()) {
    startBuilding(ctx, Structure.Camp);
    return { goal: 'Found a camp', shortfall: { wood: 12, stone: 0 } };
  }
  // The main street goes down once there are hands to spare, so the village grows along it.
  if (town.camp()!.built() && town.population() >= 3) layRoad(ctx);
  const needs = keepUp(ctx),
    goal = chosenGoal(
      town,
      (g) => (g.kind === GoalKind.Building && waiting(ctx, `plot:${g.building}`)) || (g.kind === GoalKind.Road && waiting(ctx, 'street')),
    );
  let shortfall: Shortfall = { wood: 0, stone: 0 };
  if (goal)
    switch (goal.kind) {
      case GoalKind.Building:
        if (startBuilding(ctx, goal.building)) shortfall = shortfallOf(town, structureSpec(goal.building).cost);
        break;
      case GoalKind.Craft:
      case GoalKind.Equip:
        shortfall = craftGoal(ctx, goal);
        break;
      case GoalKind.Station:
        shortfall = upgradeStation(ctx, goal.building);
        break;
      case GoalKind.Field:
        plantField(ctx);
        break;
      case GoalKind.Road:
        break;
      default:
        break;
    }
  // Sites under way set what the gatherers fetch.
  for (const site of sites(town)) {
    const { required, delivered } = site.materials;
    shortfall.wood += Math.max(0, required.wood - delivered.wood);
    shortfall.stone += Math.max(0, required.stone - delivered.stone);
  }
  return {
    goal: goal?.title ?? 'Grow the settlement',
    shortfall: { wood: shortfall.wood + needs.wood, stone: shortfall.stone + needs.stone },
  };
}
/** Free residents not needed elsewhere get the gear that helps them most; what it would cost is remembered so the
 * gatherers fetch it. Returns the materials the most wanted piece still lacks. */
export function equipFree(ctx: TitleContext, last: Shortfall): Shortfall {
  // Reading every recipe for everyone is the dearest look the player takes; it takes it now and then.
  if (ctx.step % 4) return last;
  const { town } = ctx,
    folk = ctx.free.filter((p: Person) => p.task === Activity.Idle || p.job >= 0);
  const choice = bestGear(town, folk);
  if (choice)
    order(ctx, `craft:${choice.person.id}:${choice.station.id}:${choice.item.id}`, [choice.person], () =>
      town.orderCraft(choice.person.id, choice.station.id, choice.item.id),
    );
  if (ctx.step % 8) return last;
  const wish = bestGear(town, living(town).filter(isFighter), undefined, true);
  return wish && wish.worth >= 25 ? shortfallOf(town, wish.item.cost) : { wood: 0, stone: 0 };
}
