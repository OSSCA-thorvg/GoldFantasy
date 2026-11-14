import { roadWorkSpot } from './person-navigation';
import type { Road } from './road-network';
import { TownState } from './town-state';
import { Building } from './town-models';
import { Person, Activity } from './person';
import { Resources, Product, Structure, isSeat, isMarket, structureSpec } from './building-catalog';
import { Point, point, add, distance, segmentDistance } from './geometry';
import { f32 as f } from './numeric';
import { treePosition } from './world-map';
import * as mining from './mining';
import { acceptsCargo, processingRecipe } from './town-production';
import { stowCargo } from './carried-resources';
import { resourceAmount } from './construction-materials';
export interface HarvestTown extends TownState {
  settlementAt(p: Point): number;
  settlementOf(b: Building | Person): number;
  stock(id?: number): Resources;
  capacity(id?: number): Resources;
  walkTo(p: Person, at: Point): boolean;
  arrive(p: Person): void;
  cargoStorage(at: Point, kind?: Product): Building | null;
  storageFoundation(p: Person): boolean;
  harvest(p: Person, cell: number, kind: Product): boolean;
  startHarvest(p: Person, around: Point, reach: number, kind?: Product): boolean;
  constructionRoad(id: number): number;
}
export function cargoStorage(this: HarvestTown, from: Point, kind = Product.None): Building | null {
  const village = this.settlementAt(from),
    stock = this.stock(village),
    room = this.capacity(village);
  if (kind !== Product.None && resourceAmount(stock, kind) >= resourceAmount(room, kind)) return null;
  const depots = this.placed.filter(
    (b) =>
      b.built() &&
      this.settlementOf(b) === village &&
      (isSeat(b.kind) || b.kind === Structure.Storehouse || isMarket(b.kind) || acceptsCargo(b.kind, kind)),
  );
  depots.sort((a, b) => distance(from, a.door()) - distance(from, b.door()));
  for (const depot of depots)
    if (distance(from, depot.door()) < f(0.05) || this.grid.path(from, depot.door()).length) return depot;
  return null;
}
/** Cargo stays with its carrier unless the settlement lives off it: food feeds
 * everyone from the pantry, and a workshop can only process what is in store. */
export function keepCargo(this: HarvestTown, p: Person): boolean {
  if (p.carrying <= 0 || p.carriedProduct === Product.Food) return false;
  const job = this.building(p.job);
  if (job && processingRecipe(job.kind)?.input === p.carriedProduct) return false;
  return stowCargo(p);
}
export function haulCargo(this: HarvestTown, p: Person): boolean {
  const depot = this.cargoStorage(p.position, p.carriedProduct);
  if (!depot || !this.walkTo(p, depot.door())) return false;
  p.activity = Activity.Hauling;
  p.target = depot.id;
  p.until = this.time;
  if (!p.moving()) this.arrive(p);
  return true;
}
export function startFelling(this: HarvestTown, p: Person, around: Point, reach: number): boolean {
  return this.startHarvest(p, around, reach, Product.Wood);
}
export function startMining(this: HarvestTown, p: Person, around: Point, reach: number): boolean {
  return this.startHarvest(p, around, reach, Product.Stone);
}
export function fellTree(this: HarvestTown, p: Person, cell: number): boolean {
  return this.harvest(p, cell, Product.Wood);
}
export function resourceNearby(this: HarvestTown, around: Point, reach: number, kind: Product): boolean {
  for (
    let y = Math.max(0, Math.trunc(f(around.y - reach)));
    y <= Math.min(this.world.height() - 1, Math.trunc(f(around.y + reach)));
    ++y
  )
    for (
      let x = Math.max(0, Math.trunc(f(around.x - reach)));
      x <= Math.min(this.world.width() - 1, Math.trunc(f(around.x + reach)));
      ++x
    ) {
      const exists =
        kind === Product.Stone ? mining.deposit(this.world, x, y) : this.world.at(x, y).trees > 0;
      if (!exists) continue;
      const foot =
        kind === Product.Stone
          ? mining.position(x, y)
          : treePosition(this.world, x, y, this.world.at(x, y).trees - 1);
      if (distance(around, foot) <= reach && this.world.revealed(foot)) return true;
    }
  return false;
}
export function startHarvest(
  this: HarvestTown,
  p: Person,
  around: Point,
  reach: number,
  kind = Product.None,
): boolean {
  if (p.carrying) return false;
  const candidates: { gap: number; cell: number; product: Product }[] = [],
    x0 = Math.max(0, Math.floor(f(around.x - reach))),
    x1 = Math.min(this.world.width() - 1, Math.ceil(f(around.x + reach))),
    y0 = Math.max(0, Math.floor(f(around.y - reach))),
    y1 = Math.min(this.world.height() - 1, Math.ceil(f(around.y + reach))),
    village = this.settlementAt(around),
    room = this.capacity(village),
    treasury = this.stock(village);
  for (let y = y0; y <= y1; ++y)
    for (let x = x0; x <= x1; ++x) {
      const cell = y * this.world.width() + x,
        claimed = this.folk.some(
          (other) =>
            other.id !== p.id &&
            (other.activity === Activity.Felling || other.activity === Activity.Mining) &&
            other.tree === cell,
        );
      if (claimed) continue;
      for (const product of [Product.Wood, Product.Stone]) {
        if (kind !== Product.None && kind !== product) continue;
        const stone = product === Product.Stone,
          construction = p.task === Activity.Building || p.task === Activity.Roadwork;
        if (
          village >= 0 &&
          !construction &&
          (stone ? room.stone - treasury.stone : room.wood - treasury.wood) < 3
        )
          continue;
        if (stone ? !mining.deposit(this.world, x, y) : !this.world.at(x, y).trees) continue;
        const foot = stone
          ? mining.position(x, y)
          : treePosition(this.world, x, y, this.world.at(x, y).trees - 1);
        if (distance(foot, around) <= reach && this.world.revealed(foot))
          candidates.push({ gap: distance(p.position, foot), cell, product });
      }
    }
  candidates.sort((a, b) => a.gap - b.gap);
  for (const candidate of candidates) if (this.harvest(p, candidate.cell, candidate.product)) return true;
  return false;
}
export function harvest(this: HarvestTown, p: Person, cell: number, kind: Product): boolean {
  if (cell < 0 || cell >= this.world.width() * this.world.height()) return false;
  const x = cell % this.world.width(),
    y = Math.trunc(cell / this.world.width()),
    village = this.settlementAt(point(x + 0.5, y + 0.5)),
    treasury = this.stock(village),
    stone = kind === Product.Stone,
    foundation = !stone && this.storageFoundation(p),
    construction = p.task === Activity.Building || p.task === Activity.Roadwork,
    clearing = !stone && construction,
    stockpile =
      foundation &&
      (!p.carrying || p.carriedProduct === Product.Wood) &&
      (!this.cargoStorage(p.position) || treasury.wood >= this.capacity(village).wood),
    room = this.capacity(village),
    full = stone ? treasury.stone >= room.stone : treasury.wood >= room.wood;
  if ((p.carrying && !stockpile) || (village >= 0 && !construction && !foundation && !clearing && full))
    return false;
  if (
    (stone ? !mining.deposit(this.world, x, y) : !this.world.at(x, y).trees) ||
    this.folk.some(
      (other) =>
        other.id !== p.id &&
        (other.activity === Activity.Felling || other.activity === Activity.Mining) &&
        other.tree === cell,
    )
  )
    return false;
  const foot = stone ? mining.position(x, y) : treePosition(this.world, x, y, this.world.at(x, y).trees - 1);
  if (!this.world.revealed(foot)) return false;
  const approach = this.grid.nearestWalkable(add(foot, point(-0.18, 0.18)));
  if (distance(approach, foot) > f(0.8) || !this.walkTo(p, approach)) return false;
  p.activity = stone ? Activity.Mining : Activity.Felling;
  p.tree = cell;
  const job = this.building(p.job);
  p.target =
    job &&
    (p.task === Activity.Working || !p.ordered) &&
    job.kind === (stone ? Structure.Quarry : Structure.Lumberyard)
      ? p.job
      : -1;
  p.until = this.time + 1e9;
  if (!p.moving()) this.arrive(p);
  return true;
}
export function storageFoundation(this: HarvestTown, p: Person): boolean {
  const place = p.task === Activity.Building ? this.building(p.taskSite) : null;
  return (
    !!place &&
    !place.built() &&
    (isSeat(place.kind) || place.kind === Structure.Storehouse || isMarket(place.kind))
  );
}
export function layRoadFirst(this: HarvestTown, p: Person, site: number): boolean {
  const road = this.network.road(this.constructionRoad(site));
  if (!road || !this.walkTo(p, roadWorkSpot(this,p,road))) return false;
  if (p.task === Activity.Idle) {
    p.task = Activity.Building;
    p.taskSite = site;
  }
  p.activity = Activity.Roadwork;
  p.target = road.id;
  return true;
}
/** Trees standing on what is left of a road, nearest the work front first. Each
 * entry is a tile and how far along the unbuilt line (in tiles) it stands. */
function roadTrees(town: HarvestTown, road: Road): { cell: number; ahead: number }[] {
  const length = Math.max(f(0.1), road.length()),
    step = 0.25,
    found = new Map<number, number>();
  let before = road.workPoint();
  for (let ahead = step; ; ahead += step) {
    const share = Math.min(1, road.built + ahead / length),
      at = road.constructionPoint(share);
    for (let y = Math.floor(Math.min(before.y, at.y) - 1); y <= Math.floor(Math.max(before.y, at.y) + 1); ++y)
      for (let x = Math.floor(Math.min(before.x, at.x) - 1); x <= Math.floor(Math.max(before.x, at.x) + 1); ++x) {
        if (!town.world.inside(x, y)) continue;
        const cell = y * town.world.width() + x;
        if (found.has(cell)) continue;
        for (let index = 0; index < town.world.at(x, y).trees; ++index)
          if (
            segmentDistance(treePosition(town.world, x, y, index), before, at) <=
            f(TownState.roadHalfWidth + f(0.3))
          ) {
            found.set(cell, ahead - step);
            break;
          }
      }
    before = at;
    if (share >= 1) break;
  }
  return [...found].map(([cell, ahead]) => ({ cell, ahead })).sort((a, b) => a.ahead - b.ahead || a.cell - b.cell);
}
/** How close ahead of the work front a standing tree stops the laying. */
const roadTreeStop = 0.6;
export function constructionTree(this: HarvestTown, p: Person, activity: Activity, target: number): number {
  const place = activity === Activity.Building ? this.building(target) : null,
    road = activity === Activity.Roadwork ? this.network.road(target) : null;
  if (!place && (!road || road.built >= 1)) return -1;
  if (road) {
    // The whole way is cleared first, nearest the front first, so that laying is
    // one unbroken walk instead of a trip ahead and back for every tree.
    const felling = (cell: number): boolean =>
      this.folk.some((other) => other.id !== p.id && other.activity === Activity.Felling && other.tree === cell);
    // Whoever has just felled beside a tree goes on with that stand; a crew mate
    // farther off does not walk over to take it from under them.
    const nearerHand = (cell: number): boolean => {
      const x = cell % this.world.width(),
        y = Math.trunc(cell / this.world.width()),
        foot = treePosition(this.world, x, y, this.world.at(x, y).trees - 1),
        gap = distance(p.position, foot);
      return this.folk.some(
        (other) =>
          other.id !== p.id &&
          other.health > 0 &&
          other.activity === Activity.Collecting &&
          other.task === Activity.Roadwork &&
          other.faction === p.faction &&
          distance(other.position, foot) < Math.min(gap, 2.5),
      );
    };
    const trees = roadTrees(this, road),
      free = trees.find((tree) => !felling(tree.cell) && !nearerHand(tree.cell));
    if (free) return free.cell;
    // Someone else has every tree in hand: wait only for one that stops the front itself.
    return trees.find((tree) => tree.ahead <= roadTreeStop)?.cell ?? -1;
  }
  const from = place!.center,
    reach = structureSpec(place!.kind).size;
  let found = -1,
    claimed = -1,
    best = Infinity;
  for (
    let y = Math.max(0, Math.trunc(f(from.y - reach)));
    y <= Math.min(this.world.height() - 1, Math.trunc(f(from.y + reach)));
    ++y
  )
    for (
      let x = Math.max(0, Math.trunc(f(from.x - reach)));
      x <= Math.min(this.world.width() - 1, Math.trunc(f(from.x + reach)));
      ++x
    ) {
      let blocking = false;
      for (let index = 0; index < this.world.at(x, y).trees; ++index) {
        const foot = treePosition(this.world, x, y, index);
        blocking ||= place!.footprint().contains(foot, f(0.15));
      }
      if (!blocking) continue;
      const cell = y * this.world.width() + x;
      if (
        this.folk.some(
          (other) => other.id !== p.id && other.activity === Activity.Felling && other.tree === cell,
        )
      ) {
        claimed = cell;
        continue;
      }
      const gap = distance(p.position, treePosition(this.world, x, y, this.world.at(x, y).trees - 1));
      if (gap < best) {
        best = gap;
        found = cell;
      }
    }
  return found >= 0 ? found : claimed;
}
