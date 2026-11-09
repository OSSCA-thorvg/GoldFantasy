import { TownState } from './town-state';
import { Person, Role, Activity, Monster } from './person';
import { Building } from './town-models';
import { Product, Structure } from './building-catalog';
import * as mining from './mining';
import { Point, distance } from './geometry';
import { f32 as f } from './numeric';
export interface SchedulerTown extends TownState {
  creature(id: number): Monster | null;
  haulCargo(p: Person): boolean;
  eat(p: Person): boolean;
  resumeOrder(p: Person): boolean;
  orderBuild(ids: number[], id: number): boolean;
  orderRoadwork(ids: number[], id: number): boolean;
  walkTo(p: Person, at: Point): boolean;
  arrive(p: Person): void;
  nearest(at: Point, match: (b: Building) => boolean): Building | null;
  startHarvest(p: Person, around: Point, reach: number): boolean;
  harvest(p: Person, cell: number, kind: Product): boolean;
  scheduleAutomatic(p: Person): boolean;
}
export function orderAutomatic(this: SchedulerTown, ids: number[]): void {
  for (const p of this.folk) {
    if (
      p.role !== Role.Resident ||
      p.health <= 0 ||
      p.activity === Activity.Expedition ||
      !ids.includes(p.id)
    )
      continue;
    p.ordered = p.approachingOrder = false;
    p.recoveringRest = p.recoveringHealth = false;
    p.task = Activity.Idle;
    p.taskSite = -1;
    p.supplyTarget = -1;
    p.supplyRoad = false;
    p.foe = p.tree = -1;
    p.path = [];
    p.activity = Activity.Idle;
    p.until = this.time;
    p.scheduleAt = this.time + 0.5;
    if (!this.scheduleAutomatic(p)) {
      p.activity = Activity.Holding;
      p.until = this.time + 0.5;
    }
  }
}
export function scheduleAutomatic(this: SchedulerTown, p: Person): boolean {
  if (
    p.role !== Role.Resident ||
    p.health <= 0 ||
    p.activity === Activity.Expedition ||
    p.activity === Activity.Leaving
  )
    return false;
  if (p.health >= 1) p.recoveringHealth = false;
  if (p.rest >= f(0.95)) p.recoveringRest = false;
  else if (p.activity === Activity.Sleeping && p.autoMode) p.recoveringRest = true;
  // Care interrupts an assignment, rather than replacing it. The assignment and its
  // construction cargo remain available when the resident has recovered.
  if (p.activity === Activity.Fighting && p.foe >= 0) {
    const target = this.creature(p.foe);
    if (target && target.health > 0 && !target.insideLair) return true;
    p.foe = -1;
    p.activity = Activity.Idle;
    p.path = [];
  }
  const enterCare = (b: Building, activity: Activity): boolean => {
    if (p.activity === activity && p.target === b.id) return true;
    if (!this.walkTo(p, b.door())) return false;
    if (activity === Activity.Sleeping && p.rest < f(0.95)) p.recoveringRest = true;
    p.activity = activity;
    p.target = b.id;
    p.tree = -1;
    p.approachingOrder = false;
    if (!p.moving()) this.arrive(p);
    return true;
  };
  const finishCare = (): void => {
    if (!p.ordered && (p.task === Activity.Treating || p.task === Activity.Sleeping)) {
      p.task = Activity.Idle;
      p.taskSite = -1;
    }
    p.activity = Activity.Idle;
    p.path = [];
    p.until = this.time;
  };
  if (p.activity === Activity.Treating) {
    const clinic = this.building(p.target);
    if (p.health < 1 && clinic?.built() && clinic.kind === Structure.Apothecary && clinic.workers > 0)
      return true;
    finishCare();
  }
  let committed =
    p.ordered ||
    p.recoveringRest ||
    p.recoveringHealth ||
    p.carrying > 0 ||
    [
      Activity.Eating,
      Activity.Collecting,
      Activity.Hauling,
      Activity.FetchingMaterials,
      Activity.DeliveringMaterials,
    ].includes(p.activity);
  if (p.task === Activity.Building) {
    const b = this.building(p.taskSite);
    committed ||= !!b && (!b.built() || b.health < 1);
  } else if (p.task === Activity.Roadwork) {
    const road = this.network.road(p.taskSite);
    committed ||= !!road && (road.built < 1 || road.paving >= 0 || road.wear > 0);
  } else if (p.task === Activity.Working) {
    const job = this.building(p.taskSite);
    committed ||= !!job && job.built() && job.id === p.job;
  } else if (p.task === Activity.Felling || p.task === Activity.Mining) {
    const x = p.taskSite % this.world.width(),
      y = Math.trunc(p.taskSite / this.world.width());
    committed ||=
      p.taskSite >= 0 &&
      this.world.inside(x, y) &&
      (p.task === Activity.Mining ? mining.deposit(this.world, x, y) : this.world.at(x, y).trees > 0);
  }
  // Match the existing severe-injury walking-speed threshold for interrupting
  // committed work. Minor cold damage must not send a worker back every two seconds.
  const treatmentThreshold = committed ? f(0.4) : f(0.999);
  if ((!p.ordered || p.autoMode) && (p.health < treatmentThreshold || p.recoveringHealth)) {
    if (p.health < f(0.4)) p.recoveringHealth = true;
    const clinic = this.nearest(
      p.position,
      (b) => b.kind === Structure.Apothecary && b.built() && b.workers > 0,
    );
    if (clinic && enterCare(clinic, Activity.Treating)) return true;
  }
  if (p.activity === Activity.Eating) return true;
  if (p.autoMode && p.food < f(0.25) && this.eat(p)) {
    p.approachingOrder = false;
    return true;
  }
  if (p.activity === Activity.Sleeping && !p.ordered) {
    const home = this.building(p.target);
    if (
      (p.rest < f(0.95) || (p.recoveringHealth && p.health < 1)) &&
      (p.target < 0 || (home?.built() && home.id === p.home))
    )
      return true;
    finishCare();
  }
  if (
    p.autoMode &&
    (p.rest < f(0.2) || (p.recoveringRest && p.rest < f(0.95)) || (p.recoveringHealth && p.health < 1))
  ) {
    const home = this.building(p.home);
    if (home?.built() && enterCare(home, Activity.Sleeping)) return true;
    if (p.rest < f(0.95)) p.recoveringRest = true;
    p.activity = Activity.Sleeping;
    p.target = -1;
    p.tree = -1;
    p.path = [];
    p.approachingOrder = false;
    p.inside = false;
    p.sleptOutside = true;
    return true;
  }
  if (p.ordered) return false;
  if (
    [Activity.Brooding, Activity.Relaxing, Activity.Praying, Activity.Shopping].includes(p.activity) &&
    (p.moving() || this.time < p.until)
  )
    return true;
  if (p.task === Activity.Building) {
    const b = this.building(p.taskSite);
    if (b && (!b.built() || b.health < 1)) {
      if (
        p.activity === Activity.Idle ||
        p.activity === Activity.Holding ||
        (p.activity === Activity.WaitingMaterials && this.time >= p.until)
      )
        this.resumeOrder(p);
      return true;
    }
  }
  if (p.task === Activity.Roadwork) {
    const road = this.network.road(p.taskSite);
    if (road && (road.built < 1 || road.paving >= 0 || road.wear > 0)) {
      if (
        p.activity === Activity.Idle ||
        p.activity === Activity.Holding ||
        (p.activity === Activity.WaitingMaterials && this.time >= p.until)
      )
        this.resumeOrder(p);
      return true;
    }
  }
  if (p.carrying > 0 || p.activity === Activity.Hauling || p.activity === Activity.Collecting) {
    if (p.activity === Activity.Hauling || p.activity === Activity.Collecting) return true;
    return this.haulCargo(p);
  }
  if (p.task === Activity.Working) {
    const job = this.building(p.taskSite);
    if (job && job.built() && job.id === p.job) {
      if (p.activity === Activity.Idle || p.activity === Activity.Holding) this.resumeOrder(p);
      return true;
    }
  }
  if (p.task === Activity.Felling || p.task === Activity.Mining) {
    const stone = p.task === Activity.Mining,
      x = p.taskSite % this.world.width(),
      y = Math.trunc(p.taskSite / this.world.width()),
      exists =
        p.taskSite >= 0 &&
        this.world.inside(x, y) &&
        (stone ? mining.deposit(this.world, x, y) : this.world.at(x, y).trees > 0);
    if (exists) {
      if (p.activity === p.task && p.tree === p.taskSite) return true;
      if (this.harvest(p, p.taskSite, stone ? Product.Stone : Product.Wood)) return true;
    }
    p.task = Activity.Idle;
    p.taskSite = -1;
  }
  const automatic = (accepted: boolean): boolean => {
    if (accepted) p.ordered = false;
    return accepted;
  };
  for (const b of this.placed)
    if (!b.built() || b.health < 1) {
      if (p.task === Activity.Building && p.taskSite === b.id) {
        if (p.activity === Activity.Idle || p.activity === Activity.Holding) this.resumeOrder(p);
        return true;
      }
      if (automatic(this.orderBuild([p.id], b.id))) return true;
    }
  for (const road of this.network.roads())
    if (road.built < 1 || road.paving >= 0 || road.wear > 0) {
      if (p.task === Activity.Roadwork && p.taskSite === road.id) {
        if (p.activity === Activity.Idle || p.activity === Activity.Holding) this.resumeOrder(p);
        return true;
      }
      if (automatic(this.orderRoadwork([p.id], road.id))) return true;
    }
  const enterTask = (b: Building, activity: Activity): boolean => {
    if (p.activity === activity && p.target === b.id) return true;
    if (!this.walkTo(p, b.door())) return false;
    p.task = activity;
    p.taskSite = b.id;
    p.activity = activity;
    p.target = b.id;
    if (!p.moving()) this.arrive(p);
    return true;
  };
  const job = this.building(p.job);
  if (job && job.built() && distance(p.position, job.door()) <= 5 && enterTask(job, Activity.Working))
    return true;
  if (this.titleAutoplay) {
    p.task = Activity.Idle;
    p.taskSite = -1;
    p.activity = Activity.Holding;
    p.path = [];
    p.tree = -1;
    p.until = this.time + 0.5;
    return true;
  }
  if (p.activity === Activity.Felling || p.activity === Activity.Mining) return true;
  p.task = Activity.Idle;
  p.taskSite = -1;
  if (!this.startHarvest(p, p.position, 5)) return false;
  p.task = p.activity;
  p.taskSite = p.tree;
  p.goal = { ...p.position };
  return true;
}
