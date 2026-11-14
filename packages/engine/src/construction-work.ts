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
import { belongsToFaction, sameFaction } from './faction';
import { deferAutomaticConstruction } from './automatic-work';
import {
  drawFromPack,
  handoverReach,
  handoverSearch,
  heldAmount,
  packAmount,
  stowCargo,
  carriedWeight,
  carryLimit,
  takeHeld,
} from './carried-resources';

function constructionOwner(town: Town, work: Activity, id: number): { faction: number } | null {
  return work === Activity.Roadwork ? town.network.road(id) : town.building(id);
}
function ownConstruction(town: Town, work: Activity, id: number, person?: Person): boolean {
  const owner = constructionOwner(town, work, id);
  return !!owner && belongsToFaction(owner, town.controlFaction) && (!person || sameFaction(person, owner));
}
function cancelForeignSupply(town: Town, person: Person): void {
  // A saved/in-transit order can outlive the ownership of its source or target.
  // Keep carried goods with their owner instead of gifting or deleting them.
  person.task = person.activity = Activity.Idle;
  person.target = person.taskSite = person.supplyTarget = -1;
  person.supplyRoad = person.ordered = person.aggressive = person.approachingOrder = false;
  person.autoMode = true;
  person.path = [];
  person.inside = false;
  person.until = town.time;
}
/** Residents building or supplying one site, the asker included. */
function supplyCrew(town: Town, p: Person, work: Activity, id: number): Person[] {
  const road = work === Activity.Roadwork;
  return town.folk.filter(
    (other) =>
      other.id === p.id ||
      (other.health > 0 &&
        sameFaction(other, p) &&
        (other.task === Activity.Building || other.task === Activity.Roadwork) &&
        ((other.task === work && other.taskSite === id) ||
          (other.supplyTarget === id && other.supplyRoad === road))),
  );
}
/** Supplying or building right now, so what they hold will reach the site; a mate gone to eat or sleep is not. */
const onTheJob = (other: Person): boolean =>
  [
    Activity.Felling,
    Activity.Mining,
    Activity.Collecting,
    Activity.FetchingMaterials,
    Activity.DeliveringMaterials,
    Activity.WaitingMaterials,
    Activity.Building,
    Activity.Roadwork,
  ].includes(other.activity);
/** What one builder should bring so the crew together covers what the site lacks. */
function supplyShare(town: Town, p: Person, work: Activity, id: number, product: Product): number {
  const materials = town.constructionMaterials(work, id);
  if (!materials) return 0;
  const crew = supplyCrew(town, p, work, id).filter((other) => other.id === p.id || onTheJob(other));
  let coming = 0;
  for (const other of crew) if (other.id !== p.id) coming += heldAmount(other, product);
  const mine = heldAmount(p, product);
  // Never less than what is still uncovered once everyone else has delivered.
  return Math.max(
    Math.ceil(materials.missing(product) / crew.length),
    Math.min(materials.missing(product) - coming, mine + 3),
  );
}
/** A builder keeps what the site they are supplying still lacks. */
function needsOwnCargo(town: Town, person: Person, product: Product): boolean {
  if (person.task !== Activity.Building && person.task !== Activity.Roadwork) return false;
  const materials = town.constructionMaterials(
    person.supplyRoad ? Activity.Roadwork : Activity.Building,
    person.supplyTarget,
  );
  return !!materials && materials.missing(product) > 0;
}
/** Completes a hand-to-hand delivery once the two residents stand together. */
function receiveHandover(town: Town, p: Person): void {
  const giver = town.person(p.giver),
    target = town.constructionMaterials(p.supplyRoad ? Activity.Roadwork : Activity.Building, p.supplyTarget),
    done = (wait: number): void => {
      p.giver = -1;
      p.activity = Activity.Idle;
      p.until = town.time + wait;
    };
  if (!giver || giver.health <= 0 || giver.inside || !target || heldAmount(giver, p.carriedProduct) <= 0)
    return done(0);
  if (distance(giver.position, p.position) > handoverReach) {
    if (!town.walkTo(p, giver.position)) done(1);
    return;
  }
  const room = Math.max(1, Math.floor(carryLimit(p) - carriedWeight(p))),
    count = Math.min(target.missing(p.carriedProduct), heldAmount(giver, p.carriedProduct), room);
  p.carrying += takeHeld(giver, p.carriedProduct, count);
  done(0);
}
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
  if (!ownConstruction(this, work, id)) return -1;
  if (work === Activity.Roadwork) {
    const road = this.network.road(id),
      seat = road ? this.camp(road.village) : null;
    return seat &&
      seat.built() &&
      sameFaction(seat, road!) &&
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
      !sameFaction(seat, place) ||
      !sameFaction(road, place) ||
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
  if (!belongsToFaction(p, this.controlFaction)) return true;
  if (!ownConstruction(this, work, id, p)) {
    cancelForeignSupply(this, p);
    return true;
  }
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
    // Raw inputs gathered for a refined material go straight to the depot the
    // workshop draws from. Anything else the site does not lack stays with the
    // builder: into the pack, or to storage only when the pack is full.
    const spare = materials.missing(p.carriedProduct) <= 0,
      refined = p.carriedProduct === Product.Wood ? Product.Planks : Product.CutStone,
      feedsWorkshop =
        spare &&
        (p.carriedProduct === Product.Wood || p.carriedProduct === Product.Stone) &&
        materials.missing(refined) > 0;
    if (feedsWorkshop && this.haulCargo(p)) return true;
    if (spare && !this.keepCargo(p) && this.haulCargo(p)) return true;
    if (p.carrying > 0) {
      // One trip, not one load: keep gathering into the pack until this
      // builder's share of what the site lacks is in hand, then walk it back.
      const product = p.carriedProduct,
        raw = product === Product.Wood || product === Product.Stone;
      if (
        raw &&
        heldAmount(p, product) < supplyShare(this, p, work, id, product) &&
        carriedWeight(p) + 3 <= carryLimit(p) &&
        stowCargo(p) &&
        this.startHarvest(p, at, TownState.campReach, product)
      )
        return true;
      // This product is covered: fetch the other raw material on the same outing.
      if (raw && carriedWeight(p) + 3 <= carryLimit(p)) {
        const other = product === Product.Wood ? Product.Stone : Product.Wood;
        if (
          materials.missing(other) > 0 &&
          heldAmount(p, other) < supplyShare(this, p, work, id, other) &&
          stowCargo(p)
        ) {
          p.carriedProduct = other;
          if (this.startHarvest(p, at, TownState.campReach, other)) return true;
        }
      }
      p.carriedProduct = product;
      p.carrying += drawFromPack(p, product, Math.max(0, materials.missing(product) - p.carrying));
      if (p.carrying > 0 && go(Activity.DeliveringMaterials, id, at)) return true;
    }
  }
  if (p.carrying > 0) {
    // A changed obstacle can invalidate the delivery leg after collection.
    // Retain the cargo. Roads retry this leg; impossible building jobs yield.
    if (deferAutomaticConstruction(this, p)) return true;
    p.activity = Activity.WaitingMaterials;
    p.path = [];
    p.until = this.time + 3;
    return true;
  }
  const road = work === Activity.Roadwork ? this.network.road(id)! : null;
  const progress = road ? (road.paving >= 0 ? road.paving : road.built) : this.building(id)!.progress;
  if (materials.limit() >= 1) return false;
  // Materials come first so that building, once started, is not broken up by
  // supply trips. A builder hammers on what is already delivered only while
  // crew mates are out fetching the rest, or when nothing more can be had.
  const canWork = f(progress + f(0.0001)) < materials.limit();
  let wanted = Product.None,
    smallest = 2,
    outstanding = false;
  for (const product of constructionProducts) {
    const missing = materials.missing(product);
    if (missing <= 0) continue;
    outstanding = true;
    let coming = 0,
      fetching = false;
    for (const other of supplyCrew(this, p, work, id)) {
      if (other.id === p.id || !onTheJob(other)) continue;
      coming += heldAmount(other, product);
      fetching ||=
        other.carriedProduct === product &&
        [
          Activity.Felling,
          Activity.Mining,
          Activity.Collecting,
          Activity.FetchingMaterials,
          Activity.DeliveringMaterials,
        ].includes(other.activity);
    }
    // What a builder already holds goes in first. Counting on the others' packs instead
    // left a crew that each held a part of it waiting on one another for good.
    if (packAmount(p, product) <= 0 && (missing <= coming || (canWork && fetching))) continue;
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
    if (!outstanding || canWork) return false;
    p.activity = Activity.WaitingMaterials;
    p.path = [];
    p.until = this.time + 0.75;
    return true;
  }
  p.carriedProduct = wanted;
  p.giver = -1;
  const own = drawFromPack(p, wanted, materials.missing(wanted));
  if (own > 0) {
    p.carrying = own;
    if (go(Activity.DeliveringMaterials, id, at)) return true;
  }
  const reuse: { id: number; at: Point }[] = [];
  for (const b of this.placed)
    if (
      !(work === Activity.Building && b.id === id) &&
      sameFaction(b, p) &&
      b.materials.surplus(wanted) > 0 &&
      distance(b.center, at) <= TownState.campReach
    )
      reuse.push({ id: b.id, at: b.door() });
  for (const lane of this.network.roads())
    if (
      !(work === Activity.Roadwork && lane.id === id) &&
      ownConstruction(this, Activity.Roadwork, lane.id, p) &&
      lane.materials.surplus(wanted) > 0 &&
      distance(lane.workPoint(), at) <= TownState.campReach
    )
      reuse.push({ id: -lane.id - 2, at: lane.workPoint() });
  nativeSort(reuse, (a, b) => distance(p.position, a.at) < distance(p.position, b.at));
  for (const source of reuse) if (go(Activity.FetchingMaterials, source.id, source.at)) return true;
  // A neighbour who already carries it hands it over before anyone walks to storage.
  const givers = this.folk.filter(
    (other) =>
      other.id !== p.id &&
      sameFaction(other, p) &&
      other.health > 0 &&
      !other.inside &&
      other.activity !== Activity.Leaving &&
      other.activity !== Activity.Expedition &&
      heldAmount(other, wanted) > 0 &&
      distance(other.position, p.position) <= handoverSearch &&
      !needsOwnCargo(this, other, wanted),
  );
  nativeSort(givers, (a, b) => distance(p.position, a.position) < distance(p.position, b.position));
  for (const giver of givers) {
    p.giver = giver.id;
    if (go(Activity.FetchingMaterials, -1, giver.position)) return true;
    p.giver = -1;
  }
  if (
    (wanted === Product.Wood || wanted === Product.Stone) &&
    this.startHarvest(p, at, TownState.campReach, wanted)
  )
    return true;
  const sources = this.placed.filter(
    (b) => isSeat(b.kind) && b.built() && sameFaction(b, p) && resourceAmount(this.stock(b.id), wanted) > 0,
  );
  nativeSort(sources, (a, b) => distance(p.position, a.center) < distance(p.position, b.center));
  for (const source of sources) if (go(Activity.FetchingMaterials, source.id, source.door())) return true;
  if (
    (wanted === Product.Wood || wanted === Product.Stone) &&
    this.startHarvest(p, at, f(Math.hypot(f(this.world.width()), f(this.world.height()))), wanted)
  )
    return true;
  if (this.produceConstructionMaterial(p, wanted)) return true;
  if (this.titleAutoplay && this.seekTitleMaterials(p, wanted)) return true;
  if (canWork) return false;
  if (deferAutomaticConstruction(this, p)) return true;
  p.activity = Activity.WaitingMaterials;
  p.target = id;
  p.path = [];
  p.until = this.time + 3;
  return true;
}
export function collectConstructionSurplus(this: Town, p: Person, work: Activity, id: number): boolean {
  if (!belongsToFaction(p, this.controlFaction) || !ownConstruction(this, work, id, p)) return false;
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
  if (!belongsToFaction(p, this.controlFaction)) return;
  if (p.giver >= 0) return receiveHandover(this, p);
  if (p.target === -1) {
    // A hand-over interrupted by a reload: plan again instead of treating it as foreign supply.
    p.activity = Activity.Idle;
    p.until = this.time;
    return;
  }
  const work = p.supplyRoad ? Activity.Roadwork : Activity.Building;
  const sourceWork = p.target < -1 ? Activity.Roadwork : Activity.Building,
    sourceId = p.target < -1 ? -p.target - 2 : p.target;
  if (!ownConstruction(this, work, p.supplyTarget, p) || !ownConstruction(this, sourceWork, sourceId, p)) {
    cancelForeignSupply(this, p);
    return;
  }
  const target = this.constructionMaterials(work, p.supplyTarget),
    source =
      p.target < -1
        ? this.constructionMaterials(Activity.Roadwork, -p.target - 2)
        : this.constructionMaterials(Activity.Building, p.target);
  let wanted = target ? target.missing(p.carriedProduct) : 0;
  // A Camp can supply its own maintenance batch from its treasury. Same-site
  // surplus collection applies only when that site's material need is already met.
  if (source === target && source && wanted === 0) wanted = source.surplus(p.carriedProduct);
  const load = Math.max(3, Math.floor(carryLimit(p) - carriedWeight(p)));
  let count = 0;
  if (source && source.surplus(p.carriedProduct) > 0) {
    count = Math.min(load, wanted, source.surplus(p.carriedProduct));
    source.delivered.subtract(resourceBundle(p.carriedProduct, count));
  } else if (this.camp(p.target)) {
    count = Math.min(load, wanted, resourceAmount(this.stock(p.target), p.carriedProduct));
    this.reserves(p.target).subtract(resourceBundle(p.carriedProduct, count));
  }
  p.carrying += count;
  p.activity = Activity.Idle;
  p.until = this.time + (count ? 0 : 3);
}
export function deliverConstructionMaterials(this: Town, p: Person): void {
  if (!belongsToFaction(p, this.controlFaction)) return;
  if (!ownConstruction(this, p.supplyRoad ? Activity.Roadwork : Activity.Building, p.supplyTarget, p)) {
    cancelForeignSupply(this, p);
    return;
  }
  const target = this.constructionMaterials(
    p.supplyRoad ? Activity.Roadwork : Activity.Building,
    p.supplyTarget,
  );
  if (target && p.carrying > 0) {
    // Only what is missing goes into the site; the rest stays in the builder's pack.
    const used = Math.min(p.carrying, target.missing(p.carriedProduct));
    target.delivered.add(resourceBundle(p.carriedProduct, used));
    p.carrying -= used;
    if (p.carrying > 0 && !this.keepCargo(p)) {
      target.delivered.add(resourceBundle(p.carriedProduct, p.carrying));
      p.carrying = 0;
    }
    ++this.changes;
  }
  p.activity = Activity.Idle;
  p.until = this.time;
}
