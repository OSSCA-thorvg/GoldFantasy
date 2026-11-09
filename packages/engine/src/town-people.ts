// Resident arrivals and guest activities; resident priorities live in unit-scheduler.
import { TownState } from './town-state';
import { Person, Activity, Role, Calling, adventurer } from './person';
import { Building } from './town-models';
import { Product, Structure, Resources, isOutfitter, isLodging, isHome } from './building-catalog';
import { Point, point, add, distance } from './geometry';
import { f32 as f } from './numeric';
import { DungeonKind, Dungeon } from './world-types';
import { CampEconomy } from './camp-economy';
import { enter } from './town-residents';
import { harvestTiming } from './work-timing';
import { prepareFarmWork } from './farm-work';
import { buildingWorkSpot } from './person-navigation';
import type { Town } from './town';
import { resourceAmount, resourceBundle } from './construction-materials';
export interface PeopleTown extends TownState {
  fetchConstructionMaterials(p: Person): void;
  deliverConstructionMaterials(p: Person): void;
  resumeOrder(p: Person): boolean;
  walkTo(p: Person, at: Point): boolean;
  changeRenown(village: number, amount: number): void;
  settlementOf(p: Person | Building): number;
  gateway(village?: number): Point;
  scheduleAutomatic(p: Person): boolean;
  takeBreak(p: Person): boolean;
  eat(p: Person): boolean;
  haulCargo(p: Person): boolean;
  nearest(at: Point, match: (b: Building) => boolean): Building | null;
  roadReady(id: number): boolean;
  layRoadFirst(p: Person, site: number): boolean;
  startHarvest(p: Person, around: Point, reach: number, kind?: Product): boolean;
  workHours(): boolean;
  camp(id?: number): Building | null;
  site(id: number): Building | null;
  reserves(village: number): Resources;
  economy(village: number): CampEconomy;
  charge(p: Person, b: Building | null, gold: number): boolean;
  capacity(village?: number): Resources;
  store(gain: Resources, village: number): void;
}
export function think(this: PeopleTown, p: Person): void {
  if (p.role === Role.Resident && !p.autoMode && p.task === Activity.Idle && !p.ordered) {
    p.activity = Activity.Holding;
    p.path = [];
    p.until = Infinity;
    return;
  }
  if (p.role === Role.Resident) {
    if (p.ordered && p.task === Activity.Idle) { p.ordered = false; p.autoMode = true; }
    if (p.ordered && this.resumeOrder(p)) return;
    this.scheduleAutomatic(p);
    return;
  }
  p.target = -1;
  p.tree = -1;
  if (
    p.ordered &&
    (p.task === Activity.Moving || p.task === Activity.Holding) &&
    distance(p.position, p.goal) > f(0.2)
  ) {
    this.resumeOrder(p);
    return;
  }
  const start = (activity: Activity, place: Building | null, at: Point): boolean => {
    if (!this.walkTo(p, at)) {
      p.activity = Activity.Idle;
      p.until = this.time + 3;
      return false;
    }
    p.activity = activity;
    p.target = place?.id ?? -1;
    return true;
  };
  if (p.role === Role.Guest) {
    const done = p.calling === Calling.Traveller ? p.days >= 4 : p.days >= 8;
    if (p.stress > f(0.9) || p.health < f(0.3) || done) {
      this.notify(p.name + (done ? ' moves on' : ' leaves, unhappy'));
      this.changeRenown(this.settlementOf(p), done ? f(1.5) : -2);
      start(Activity.Leaving, null, this.gateway(this.settlementOf(p)));
      return;
    }
  }
  if (p.ordered && this.resumeOrder(p)) return;
  if (this.takeBreak(p)) return;
  if (this.resumeOrder(p)) return;
  if (p.food < f(0.35) && this.eat(p)) return;
  if (p.carrying > 0) {
    if (!this.haulCargo(p)) {
      p.activity = Activity.Idle;
      p.until = this.time + 2;
    }
    return;
  }
  if (p.stress > f(0.35) && this.time - p.prayedAt > TownState.secondsPerDay * 0.5) {
    let chapel: Building | null = null;
    for (const item of this.placed)
      if (
        item.kind === Structure.Chapel &&
        item.built() &&
        (!chapel || (item.faith === p.faith && chapel.faith !== p.faith))
      )
        chapel = item;
    if (
      chapel &&
      (chapel.faith === p.faith || p.stress > f(0.55)) &&
      start(Activity.Praying, chapel, chapel.door())
    )
      return;
  }
  if (p.role === Role.Guest && adventurer(p) && p.purse >= 12 && p.loot > 0 && p.gear < 3) {
    let shop: Building | null = null;
    for (const item of this.placed)
      if (
        isOutfitter(item.kind) &&
        item.built() &&
        item.workers > 0 &&
        (!shop || distance(item.center, p.position) < distance(shop.center, p.position))
      )
        shop = item;
    if (shop && start(Activity.Shopping, shop, shop.door())) return;
  }
  const tavern = this.nearest(p.position, (b) => b.built() && b.kind === Structure.Tavern);
  if (tavern && p.stress > f(0.5) && this.time - p.relaxedAt > TownState.secondsPerDay * 0.5) {
    start(Activity.Relaxing, tavern, tavern.door());
    return;
  }

  if (
    p.role === Role.Guest &&
    tavern &&
    p.stress > f(0.25) &&
    this.time - p.relaxedAt > TownState.secondsPerDay * 0.5
  ) {
    start(Activity.Relaxing, tavern, tavern.door());
    return;
  }

  let anchor = p.calling === Calling.Bard ? tavern : null;
  if (!anchor) anchor = this.building(p.bed);
  if (!anchor && p.role === Role.Guest)
    anchor = this.nearest(
      p.position,
      (b) => b.built() && (b.kind === Structure.Tavern || b.kind === Structure.Guild || isLodging(b.kind)),
    );
  if (!anchor) anchor = this.camp(this.settlementOf(p));
  const around = anchor ? anchor.door() : p.position;
  p.activity = Activity.Idle;
  this.walkTo(
    p,
    this.grid.nearestWalkable(
      add(around, point(f(f(this.roll() * 3) - f(1.5)), f(f(this.roll() * 3) - f(1.5)))),
    ),
  );
  p.until = this.time + 3 + f(this.roll() * 5);
}
export function arrive(this: PeopleTown, p: Person): void {
  if (p.approachingOrder) {
    p.approachingOrder = false;
    this.resumeOrder(p);
    return;
  }
  const place = this.site(p.target),
    village = this.settlementOf(place ?? p),
    treasury = this.reserves(village),
    today = this.economy(village).today,
    atBuilding =
      [
        Activity.Treating,
        Activity.Eating,
        Activity.Drinking,
        Activity.Sleeping,
        Activity.Relaxing,
        Activity.Praying,
        Activity.Shopping,
        Activity.Hauling,
        Activity.Building,
        Activity.Working,
      ].includes(p.activity) && !(p.activity === Activity.Working && place?.kind === Structure.Farm && p.workField >= 0) ||
      (p.activity === Activity.FetchingMaterials && p.target >= 0) ||
      (p.activity === Activity.DeliveringMaterials && !p.supplyRoad);
  const arrival = place && (p.activity === Activity.Building || p.activity === Activity.Working)
    ? buildingWorkSpot(this,p,place) : place?.door();
  if (atBuilding && place && arrival && distance(p.position, arrival) > f(0.02)) {
    if (!this.walkTo(p, arrival)) {
      p.activity = Activity.Idle;
      p.until = this.time + 3;
    }
    return;
  }
  switch (p.activity) {
    case Activity.FetchingMaterials:
      this.fetchConstructionMaterials(p);
      break;
    case Activity.DeliveringMaterials:
      this.deliverConstructionMaterials(p);
      break;
    case Activity.Idle:
      if (p.role === Role.Resident && p.autoMode && p.job < 0) p.until = this.time + 1 + f(this.roll() * 2);
      break;
    case Activity.Moving:
      p.activity = Activity.Holding;
      p.until = p.task !== Activity.Idle ? this.time : this.time + 10;
      break;
    case Activity.Eating:
      if (treasury.food > 0 && place) {
        --treasury.food;
        ++today.eaten;
        p.food = 1;
        if (p.role === Role.Guest) this.charge(p, place, 2);
        // Food can be served at a residential doorway, but a meal does not grant
        // residency or permission to enter somebody else's home.
        if (p.role === Role.Guest || !isHome(place.kind) || p.home === place.id)
          enter(p, place.threshold());
        p.until = this.time + 3;
      } else p.activity = Activity.Idle;
      break;
    case Activity.Drinking:
      if (place?.built() && place.kind === Structure.Well) {
        p.hydration = 1;
        if (treasury.water > 0) --treasury.water;
        ++today.drunk;
        p.until = this.time + 2;
      } else { p.activity = Activity.Idle; p.until = this.time; }
      break;
    case Activity.Treating:
      if (place && place.built() && place.kind === Structure.Apothecary && place.workers > 0)
        enter(p, place.threshold());
      else {
        p.activity = Activity.Idle;
        p.target = -1;
      }
      break;
    case Activity.Sleeping:
      if (place && (p.role === Role.Guest || place.id === p.home)) enter(p, place.threshold());
      else if (place) { p.activity = Activity.Idle; break; }
      p.sleptOutside = !place;
      if (place && p.role === Role.Guest && isLodging(place.kind) && !this.charge(p, place, 2))
        p.stress = Math.min(1, f(p.stress + f(0.05)));
      break;
    case Activity.Relaxing:
    case Activity.Praying:
      if (!place) {
        p.activity = Activity.Idle;
        break;
      }
      enter(p, place.threshold());
      p.until = this.time + (p.activity === Activity.Praying ? 5 : 6);
      break;
    case Activity.Shopping:
      if (!place) {
        p.activity = Activity.Idle;
        break;
      }
      enter(p, place.threshold());
      p.until = this.time + 3;
      break;
    case Activity.Hauling: {
      if (p.carrying > 0 && (!place || !place.built())) {
        p.activity = Activity.Idle;
        p.until = this.time;
        break;
      }
      p.load = 0;
      const limit = this.capacity(village),
        room = resourceAmount(limit, p.carriedProduct) - resourceAmount(treasury, p.carriedProduct),
        delivered = Math.min(p.carrying, Math.max(0, room));
      this.store(resourceBundle(p.carriedProduct, delivered), village);
      p.carrying -= delivered;
      p.activity = Activity.Idle;
      p.until = this.time + (p.carrying ? 2 : 0);
      break;
    }
    case Activity.Felling:
      p.until = this.time + harvestTiming.duration;
      break;
    case Activity.Mining:
      p.until = this.time + harvestTiming.duration;
      break;
    case Activity.Leaving:
      p.health = -1;
      break;
    case Activity.Arriving:
      p.activity = Activity.Idle;
      break;
    case Activity.Working:
      // Assigning a workplace completes upon arrival. The job remains assigned,
      // while Auto can handle its meals, sleep, threats and higher-priority roads.
      if (p.task === Activity.Working) { p.ordered = false; p.autoMode = true; }
      if (place?.kind === Structure.Farm) prepareFarmWork(this as Town,p,place);
      if (!place) p.activity = Activity.Idle;
      break;
    case Activity.Building:
      if (!place) p.activity = Activity.Idle;
      break;
    case Activity.Roadwork:
      if (!this.network.road(p.target)) p.activity = Activity.Idle;
      break;
    case Activity.Expedition:
      enter(p, add(p.position, point(0, -0.3)));
      break;
    default:
      break;
  }
}
