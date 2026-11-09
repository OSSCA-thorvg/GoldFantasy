import { TownState } from './town-state';
import { Person, Role, Activity, Monster } from './person';
import { Building } from './town-models';
import { Structure } from './building-catalog';
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
    p.task = Activity.Idle;
    p.taskSite = -1;
    p.supplyTarget = -1;
    p.supplyRoad = false;
    p.foe = p.tree = -1;
    p.path = [];
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
    p.ordered ||
    p.health <= 0 ||
    p.activity === Activity.Expedition ||
    p.activity === Activity.Leaving
  )
    return false;
  if (p.activity === Activity.Fighting && p.foe >= 0) {
    const target = this.creature(p.foe);
    if (target && target.health > 0 && !target.insideLair) return true;
  }
  if (p.activity === Activity.Eating) return true;
  if (p.autoMode && p.food < f(0.25) && this.eat(p)) return true;
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
    const job = this.building(p.job);
    if (job && job.built()) {
      if (p.activity === Activity.Idle || p.activity === Activity.Holding) this.resumeOrder(p);
      return true;
    }
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
  if (p.health < f(0.999)) {
    const clinic = this.nearest(
      p.position,
      (b) => b.kind === Structure.Apothecary && b.built() && b.workers > 0,
    );
    if (clinic && enterTask(clinic, Activity.Treating)) return true;
  }
  if (p.autoMode && (p.rest < f(0.2) || (p.activity === Activity.Sleeping && p.rest < f(0.95)))) {
    if (p.activity === Activity.Sleeping && !p.moving()) return true;
    const home = this.building(p.home);
    if (home && home.built() && enterTask(home, Activity.Sleeping)) return true;
    p.activity = Activity.Sleeping;
    p.target = -1;
    p.path = [];
    p.task = Activity.Idle;
    p.sleptOutside = true;
    return true;
  }
  if (p.task === Activity.Working && (p.activity === Activity.Felling || p.activity === Activity.Mining))
    return true;
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
