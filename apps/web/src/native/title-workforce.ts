// Hands for the title player's plan: builders on every site, a worker on every unfinished road, staff for the
// workplaces the settlement needs, a hunter when food or bones run short, and gatherers for what the plan lacks.
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, AnimalKind, type Person } from '../../../../packages/engine/src/person';
import { Product, Structure, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { distance, type Point } from '../../../../packages/engine/src/geometry';
import { treePosition } from '../../../../packages/engine/src/world-map';
import * as mining from '../../../../packages/engine/src/mining';
import { heldAmount } from '../../../../packages/engine/src/carried-resources';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { scoutPoint, unsourcedMaterial } from '../../../../packages/engine/src/settlement-progression';
import { isFighter } from './title-gear';
import { living, order, take, type TitleContext } from './title-roster';

const reach = 24;
/** The nearest tree or rock in sight that nobody is already working, or -1. */
export function harvestCell(town: Town, from: Point, stone: boolean): number {
  const map = town.map(),
    width = map.width(),
    taken = new Set(town.people().map((p) => p.tree));
  let best = -1,
    gap = Infinity;
  for (let y = Math.max(0, Math.floor(from.y - reach)); y < Math.min(map.height(), from.y + reach); ++y)
    for (let x = Math.max(0, Math.floor(from.x - reach)); x < Math.min(width, from.x + reach); ++x) {
      if (stone ? !mining.deposit(map, x, y) : !map.at(x, y).trees) continue;
      const cell = y * width + x;
      if (taken.has(cell)) continue;
      const foot = stone ? mining.position(x, y) : treePosition(map, x, y, map.at(x, y).trees - 1),
        d = distance(from, foot);
      if (d < gap && map.revealed(foot)) [gap, best] = [d, cell];
    }
  return best;
}
export function gather(ctx: TitleContext, p: Person, stone: boolean): boolean {
  const { town } = ctx;
  if (p.task === (stone ? Activity.Mining : Activity.Felling)) {
    take(ctx, p);
    return true;
  }
  const cell = harvestCell(town, p.position, stone);
  if (cell < 0) return false;
  return order(ctx, `${stone ? 'mine' : 'chop'}:${p.id}:${cell}`, [p], () =>
    stone ? town.orderMine([p.id], cell) : town.orderChop([p.id], cell),
  );
}
const ownSites = (town: Town) => town.buildings().filter((b) => isPlayerBuilding(b) && !b.built());
/** Everyone not yet given a decision who is free of a workplace, the ones carrying most wood first. */
const handsFor = (ctx: TitleContext, product = Product.Wood): Person[] =>
  ctx.free
    .filter((p) => p.job < 0 && !ctx.party.has(p.id))
    .sort((a, b) => heldAmount(b, product) - heldAmount(a, product) || a.id - b.id);

/** One builder per site (two on a large one in a larger settlement); scouts when a material is nowhere in sight. */
export function staffSites(ctx: TitleContext): void {
  const { town } = ctx,
    folk = living(town);
  for (const site of ownSites(town).sort((a, b) => a.id - b.id)) {
    const crew = folk.filter((p) => p.task === Activity.Building && p.taskSite === site.id).length,
      wanted = folk.length >= 6 && structureSpec(site.kind).size >= 1.4 ? 2 : 1;
    if (crew >= wanted) continue;
    const lacking = unsourcedMaterial(town, site);
    if (lacking !== null) {
      if (folk.some((p) => p.task === Activity.Moving && p.ordered)) continue;
      const p = handsFor(ctx)[0] ?? ctx.free.find((q) => !ctx.party.has(q.id)),
        at = p && scoutPoint(town, p.position);
      if (p && at) order(ctx, `scout:${p.id}:${Math.round(at.x)}:${Math.round(at.y)}`, [p], () => (town.orderMove([p.id], at), true));
      continue;
    }
    const hands = handsFor(ctx);
    // A workplace's own staff build when nobody else is free, as a player would pull them.
    const pool = hands.length ? hands : ctx.free.filter((p) => !ctx.party.has(p.id));
    for (const p of pool.slice(0, wanted - crew)) order(ctx, `build:${p.id}:${site.id}`, [p], () => town.orderBuild([p.id], site.id));
  }
  for (const road of town.roads().roads()) {
    if (road.faction !== 0 || (road.built >= 1 && road.paving < 0 && road.wear <= 0)) continue;
    if (folk.some((p) => p.task === Activity.Roadwork && p.taskSite === road.id)) continue;
    const p = handsFor(ctx)[0];
    if (p) order(ctx, `road:${p.id}:${road.id}`, [p], () => town.orderRoadwork([p.id], road.id));
  }
}
/** How many should work at a finished workplace for a settlement of `population`. */
function staffWanted(town: Town, kind: Structure, population: number): number {
  const stock = town.stock(),
    jobs = structureSpec(kind).jobs;
  switch (kind) {
    case Structure.Farm:
      // Meals cost little; the farm's surplus is what the altar asks for.
      if (!town.fieldAcres()) return 0;
      return Math.min(jobs, stock.food < population * 4 ? 3 : population >= 6 && stock.food < 80 ? 2 : 1);
    case Structure.Well:
      return population >= 3 && stock.water < population * 3 ? 1 : 0;
    case Structure.Lumberyard:
      return population >= 7 ? 1 : 0;
    case Structure.Quarry:
      return population >= 7 ? 1 : 0;
    case Structure.Sawmill:
    case Structure.Stoneworks:
      return population >= 7 ? 1 : 0;
    case Structure.MarketStalls:
      return population >= 6 ? 1 : 0;
    case Structure.Watchtower:
      return population >= 6 ? 1 : 0;
    case Structure.Tavern:
    case Structure.Apothecary:
      return population >= 8 ? 1 : 0;
    default:
      return 0;
  }
}
/** Sets a workplace's staff count when the player's own wish for it changes; the town's later shuffles stand. */
function setStaff(ctx: TitleContext, id: number, count: number): void {
  if (ctx.staffed.get(id) === count) return;
  ctx.staffed.set(id, count);
  // The panel's count always takes; whether someone is free to fill it shows only later.
  order(ctx, `staff:${id}:${count}:${ctx.step}`, [], () => (ctx.town.setWorkers(id, count), true));
}
/** Sets each workplace's wanted staff, as the building panel's count does; the town fills it from idle hands.
 * Fighters below the drill cap are sent to a training yard instead. */
export function staffJobs(ctx: TitleContext): void {
  const { town } = ctx,
    population = town.population(),
    folk = living(town);
  for (const b of town.buildings()) {
    if (!isPlayerBuilding(b) || !b.built() || !structureSpec(b.kind).jobs) continue;
    if (b.kind === Structure.TrainingYard) {
      const eligible = folk.filter((p) => isFighter(p) && p.level < 10 && !ctx.party.has(p.id)).length,
        seats = Math.min(structureSpec(b.kind).jobs, eligible),
        drilling = folk.filter((p) => p.job === b.id).length;
      setStaff(ctx, b.id, seats);
      if (drilling >= seats) continue;
      const fighter = ctx.free.find((p) => isFighter(p) && p.job !== b.id && p.level < 10 && !ctx.party.has(p.id));
      if (fighter) order(ctx, `drill:${fighter.id}:${b.id}`, [fighter], () => town.assignJob([fighter.id], b.id));
      continue;
    }
    setStaff(ctx, b.id, staffWanted(town, b.kind, population));
  }
}
const prey = [AnimalKind.Chicken, AnimalKind.Pig, AnimalKind.Cow];
/** One hunter for the nearest livestock in sight when food or bones are wanted. */
export function hunt(ctx: TitleContext): boolean {
  const { town } = ctx,
    seat = town.camp();
  if (!seat || town.raiding() || living(town).some((p) => p.hunting)) return false;
  const target = town
    .wildlife()
    .filter((a) => a.health > 0 && a.animal !== null && prey.includes(a.animal) && town.map().revealed(a.position))
    .filter((a) => distance(a.position, seat.center) < 22)
    .sort((a, b) => distance(a.position, seat.center) - distance(b.position, seat.center))[0];
  if (!target) return false;
  const hunter = ctx.free
    .filter((p) => p.health > 0.7 && !ctx.party.has(p.id) && p.job < 0)
    .sort((a, b) => distance(a.position, target.position) - distance(b.position, target.position))[0];
  return !!hunter && order(ctx, `hunt:${hunter.id}:${target.id}`, [hunter], () => town.orderAttack([hunter.id], target.id));
}
/** Free hands fell trees or break rock, as many as the plan is short of. */
export function gatherShortfall(ctx: TitleContext, wood: number, stone: number): void {
  if (wood <= 0 && stone <= 0) return;
  // About one gatherer for every ten units still wanted.
  let wanted = Math.ceil((wood + stone) / 10),
    miners = stone > 0 ? Math.max(1, Math.round((wanted * stone) / (wood + stone))) : 0;
  for (const p of handsFor(ctx)) {
    if (wanted <= 0) break;
    if (p.task !== Activity.Idle && p.task !== Activity.Felling && p.task !== Activity.Mining) continue;
    const stoneNow = miners > 0;
    if (gather(ctx, p, stoneNow)) {
      --wanted;
      if (stoneNow) --miners;
    } else if (stoneNow && gather(ctx, p, false)) --wanted;
  }
}
