// Native town_people.cpp activity selection and arrival handlers.
import { TownState } from './town-state';
import { Person, Activity, Role, Calling, adventurer } from './person';
import { Building } from './town-models';
import { Product, Structure, Resources, isOutfitter, isLodging } from './building-catalog';
import { Point, point, add, sub, scale, normalized, rotated, distance } from './geometry';
import { f32 as f } from './numeric';
import { DungeonKind, Dungeon } from './world-types';
import { CampEconomy } from './camp-economy';
import { enter } from './town-residents';
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
  } else if (p.autoMode && p.breaking > f(0.5)) {
    this.notify(p.name + ' could not bear it any longer and left');
    start(Activity.Leaving, null, this.gateway(this.settlementOf(p)));
    return;
  }
  if (p.ordered && this.resumeOrder(p)) return;
  if (this.scheduleAutomatic(p)) return;
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
  if (p.role === Role.Resident) {
    let best: Building | null = null;
    for (const item of this.placed) {
      if (item.built() && item.health >= 1) continue;
      const builders = this.folk.filter(
        (o) => o.activity === Activity.Building && o.target === item.id,
      ).length;
      if (builders < 3 && (!best || distance(item.center, p.position) < distance(best.center, p.position)))
        best = item;
    }
    let lane: ReturnType<TownState['network']['road']> = null;
    for (const road of this.network.roads()) {
      if ((road.built >= 1 && road.paving < 0 && road.wear <= 0) || !this.roadReady(road.id)) continue;
      const crew = this.folk.filter((o) => o.activity === Activity.Roadwork && o.target === road.id).length;
      if (
        crew < 2 &&
        (!lane || distance(road.workPoint(), p.position) < distance(lane.workPoint(), p.position))
      )
        lane = road;
    }
    const laneFront = lane ? lane.workPoint() : point();
    if (lane && (!best || distance(laneFront, p.position) < distance(best.center, p.position))) {
      p.activity = Activity.Roadwork;
      p.target = lane.id;
      if (this.walkTo(p, laneFront)) return;
    }
    const job = this.building(p.job);
    if (best && (this.layRoadFirst(p, best.id) || start(Activity.Building, best, best.door()))) return;
    if (job && job.built() && start(Activity.Working, job, job.door())) return;
    if (
      !this.titleAutoplay &&
      p.job < 0 &&
      p.task === Activity.Idle &&
      !p.ordered &&
      this.startHarvest(p, p.position, 5)
    )
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
  if (p.role === Role.Resident) {
    const home = this.building(p.home),
      seat = this.camp(this.settlementOf(p)),
      anchor = home ? home.door() : seat ? seat.door() : this.world.camp();
    p.activity = Activity.Idle;
    p.path = [];
    p.until = this.time + 2;
    if (p.job < 0)
      for (let attempt = 0; attempt < 8; ++attempt) {
        const angle = f(this.roll() * f(6.2831853)),
          radius = f(2 + f(this.roll() * f(2.5)));
        let goal = add(p.position, rotated(point(radius, 0), angle));
        if (distance(goal, anchor) > 10)
          goal = add(anchor, scale(normalized(sub(goal, anchor)), f(4 + f(this.roll() * 4))));
        goal = this.grid.nearestWalkable(goal);
        if (distance(goal, p.position) < f(0.8) || !this.walkTo(p, goal)) continue;
        p.until = this.time + 0.8;
        break;
      }
    return;
  }
  let anchor = p.calling === Calling.Bard ? tavern : null;
  if (!anchor) anchor = this.building(Number(p.role) === Role.Resident ? p.home : p.bed);
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
        Activity.Sleeping,
        Activity.Relaxing,
        Activity.Praying,
        Activity.Shopping,
        Activity.Hauling,
        Activity.Building,
        Activity.Working,
      ].includes(p.activity) ||
      (p.activity === Activity.FetchingMaterials && p.target >= 0) ||
      (p.activity === Activity.DeliveringMaterials && !p.supplyRoad);
  if (atBuilding && place && distance(p.position, place.door()) > f(0.02)) {
    if (!this.walkTo(p, place.door())) {
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
        enter(p, place.threshold());
        p.until = this.time + 3;
      } else p.activity = Activity.Idle;
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
      if (place) enter(p, place.threshold());
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
      const stone = p.carriedProduct === Product.Stone,
        limit = this.capacity(village),
        room = stone ? limit.stone - treasury.stone : limit.wood - treasury.wood,
        delivered = Math.min(p.carrying, Math.max(0, room));
      this.store(new Resources(0, stone ? 0 : delivered, stone ? delivered : 0), village);
      p.carrying -= delivered;
      p.activity = Activity.Idle;
      p.until = this.time + (p.carrying ? 2 : 0);
      break;
    }
    case Activity.Felling:
      p.until = this.time + 6;
      break;
    case Activity.Mining:
      p.until = this.time + 6;
      break;
    case Activity.Leaving:
      p.health = -1;
      break;
    case Activity.Arriving:
      p.activity = Activity.Idle;
      break;
    case Activity.Building:
    case Activity.Working:
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
