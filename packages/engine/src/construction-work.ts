import { nativeSort } from './native-sort';
// Literal construction_work.cpp supply additions; geometry clearing remains in resource-harvesting.ts.
import type { Town } from './town';
import { Activity, Person } from './person';
import { isSeat, Product } from './building-catalog';
import {
  ConstructionMaterials,
  constructionProducts,
  resourceAmount,
  resourceBundle,
} from './construction-materials';
import { distance, point, type Point } from './geometry';
import { f32 as f } from './numeric';
import { TownState } from './town-state';
export function constructionMaterials(this: Town, work: Activity, id: number): ConstructionMaterials | null {
  return work === Activity.Roadwork
    ? (this.network.road(id)?.materials ?? null)
    : (this.site(id)?.materials ?? null);
}
export function constructionPoint(this: Town, work: Activity, id: number): Point {
  return work === Activity.Roadwork
    ? (this.network.road(id)?.workPoint() ?? point())
    : (this.building(id)?.door() ?? point());
}
export function constructionSupplyCamp(this: Town, workOrId: number, target?: number): number {
  const work = target === undefined ? Activity.Building : workOrId,
    id = target ?? workOrId;
  if (work === Activity.Roadwork) {
    const road = this.network.road(id),
      seat = road ? this.camp(road.village) : null;
    return seat &&
      seat.built() &&
      this.roadReady(id) &&
      distance(road!.workPoint(), seat.center) <= TownState.campReach
      ? seat.id
      : -1;
  }
  const place = this.building(id);
  if (!place) return -1;
  let result = -1,
    best = 3.4028234663852886e38;
  for (const road of this.network.roads()) {
    const seat = this.camp(road.village);
    if (
      !seat ||
      !seat.built() ||
      seat.id === place.id ||
      road.built < 1 ||
      road.wear >= 1 ||
      !this.roadReady(road.id)
    )
      continue;
    const gap = distance(place.center, seat.center);
    if (gap > TownState.campReach) continue;
    let beside = false;
    for (const p of road.line) beside ||= place.footprint().contains(p, f(TownState.roadHalfWidth + f(0.7)));
    if (beside && gap < best) {
      best = gap;
      result = seat.id;
    }
  }
  return result;
}
export function reserveConstructionMaterials(this: Town, work: Activity, id: number): void {
  const supplier = this.constructionSupplyCamp(work, id),
    materials = this.constructionMaterials(work, id);
  if (supplier < 0 || !materials) return;
  for (const product of constructionProducts) {
    const take = Math.min(materials.missing(product), resourceAmount(this.stock(supplier), product)),
      cargo = resourceBundle(product, take);
    this.reserves(supplier).subtract(cargo);
    materials.delivered.add(cargo);
  }
}
export function prepareConstruction(this: Town, p: Person, work: Activity, id: number): boolean {
  const materials = this.constructionMaterials(work, id);
  if (!materials) return false;
  this.reserveConstructionMaterials(work, id);
  const at = this.constructionPoint(work, id);
  p.supplyTarget = id;
  p.supplyRoad = work === Activity.Roadwork;
  const go = (activity: Activity, target: number, where: Point): boolean => {
    if (!this.walkTo(p, where)) return false;
    p.activity = activity;
    p.target = target;
    p.until = this.time;
    if (!p.moving()) this.arrive(p);
    return true;
  };
  if (p.carrying > 0) {
    if (go(Activity.DeliveringMaterials, id, at)) return true;
    p.activity = Activity.WaitingMaterials;
    p.path = [];
    p.until = this.time + 3;
    return true;
  }
  const road = work === Activity.Roadwork ? this.network.road(id)! : null;
  const progress = road ? (road.paving >= 0 ? road.paving : road.built) : this.building(id)!.progress;
  if (f(progress + f(0.0001)) < materials.limit() || materials.limit() >= 1) return false;
  let wanted = Product.None,
    smallest = 2,
    outstanding = false;
  for (const product of constructionProducts)
    if (materials.missing(product) > 0) {
      outstanding = true;
      let committed = 0;
      for (const other of this.folk) {
        if (
          other.id === p.id ||
          other.health <= 0 ||
          (other.task !== Activity.Building && other.task !== Activity.Roadwork) ||
          other.supplyTarget !== id ||
          other.supplyRoad !== p.supplyRoad ||
          other.carriedProduct !== product
        )
          continue;
        const gathering =
          other.activity === Activity.Felling ||
          other.activity === Activity.Mining ||
          other.activity === Activity.FetchingMaterials;
        const carrying =
          other.activity === Activity.Collecting || other.activity === Activity.DeliveringMaterials;
        if (gathering || carrying) committed += other.carrying > 0 ? other.carrying : 3;
      }
      if (materials.missing(product) <= committed) continue;
      const share = f(
        f(resourceAmount(materials.delivered, product)) /
          Math.max(1, resourceAmount(materials.required, product)),
      );
      if (share < smallest) {
        smallest = share;
        wanted = product;
      }
    }
  if (wanted === Product.None) {
    if (!outstanding) return false;
    p.activity = Activity.WaitingMaterials;
    p.path = [];
    p.until = this.time + 0.75;
    return true;
  }
  p.carriedProduct = wanted;
  const reuse: { id: number; at: Point }[] = [];
  for (const b of this.placed)
    if (
      !(work === Activity.Building && b.id === id) &&
      b.materials.surplus(wanted) > 0 &&
      distance(b.center, at) <= TownState.campReach
    )
      reuse.push({ id: b.id, at: b.door() });
  for (const lane of this.network.roads())
    if (
      !(work === Activity.Roadwork && lane.id === id) &&
      lane.materials.surplus(wanted) > 0 &&
      distance(lane.workPoint(), at) <= TownState.campReach
    )
      reuse.push({ id: -lane.id - 2, at: lane.workPoint() });
  nativeSort(reuse, (a, b) => distance(p.position, a.at) < distance(p.position, b.at));
  for (const source of reuse) if (go(Activity.FetchingMaterials, source.id, source.at)) return true;
  if (
    (wanted === Product.Wood || wanted === Product.Stone) &&
    this.startHarvest(p, at, TownState.campReach, wanted)
  )
    return true;
  const sources = this.placed.filter(
    (b) => isSeat(b.kind) && b.built() && resourceAmount(this.stock(b.id), wanted) > 0,
  );
  nativeSort(sources, (a, b) => distance(p.position, a.center) < distance(p.position, b.center));
  for (const source of sources) if (go(Activity.FetchingMaterials, source.id, source.door())) return true;
  if (
    (wanted === Product.Wood || wanted === Product.Stone) &&
    this.startHarvest(p, at, f(Math.hypot(f(this.world.width()), f(this.world.height()))), wanted)
  )
    return true;
  if (this.titleAutoplay && this.seekTitleMaterials(p, wanted)) return true;
  p.activity = Activity.WaitingMaterials;
  p.target = id;
  p.path = [];
  p.until = this.time + 3;
  return true;
}
export function collectConstructionSurplus(this: Town, p: Person, work: Activity, id: number): boolean {
  const materials = this.constructionMaterials(work, id);
  if (!materials || p.carrying) return false;
  for (const product of constructionProducts)
    if (materials.surplus(product) > 0) {
      if (!this.walkTo(p, this.constructionPoint(work, id))) return false;
      p.supplyTarget = id;
      p.supplyRoad = work === Activity.Roadwork;
      p.carriedProduct = product;
      p.target = p.supplyRoad ? -id - 2 : id;
      p.activity = Activity.FetchingMaterials;
      p.until = this.time;
      if (!p.moving()) this.arrive(p);
      return true;
    }
  return false;
}
export function fetchConstructionMaterials(this: Town, p: Person): void {
  const work = p.supplyRoad ? Activity.Roadwork : Activity.Building,
    target = this.constructionMaterials(work, p.supplyTarget),
    source =
      p.target < -1
        ? this.constructionMaterials(Activity.Roadwork, -p.target - 2)
        : this.constructionMaterials(Activity.Building, p.target);
  let wanted = target ? target.missing(p.carriedProduct) : 0;
  if (source === target && source) wanted = source.surplus(p.carriedProduct);
  let count = 0;
  if (source && source.surplus(p.carriedProduct) > 0) {
    count = Math.min(3, wanted, source.surplus(p.carriedProduct));
    source.delivered.subtract(resourceBundle(p.carriedProduct, count));
  } else if (this.camp(p.target)) {
    count = Math.min(3, wanted, resourceAmount(this.stock(p.target), p.carriedProduct));
    this.reserves(p.target).subtract(resourceBundle(p.carriedProduct, count));
  }
  p.carrying += count;
  p.activity = Activity.Idle;
  p.until = this.time + (count ? 0 : 3);
}
export function deliverConstructionMaterials(this: Town, p: Person): void {
  const target = this.constructionMaterials(
    p.supplyRoad ? Activity.Roadwork : Activity.Building,
    p.supplyTarget,
  );
  if (target && p.carrying > 0) {
    target.delivered.add(resourceBundle(p.carriedProduct, p.carrying));
    p.carrying = 0;
    ++this.changes;
  }
  p.activity = Activity.Idle;
  p.until = this.time;
}
