import { canControl } from './faction';
import type { Town } from './town';
import { Person, Role, Activity } from './person';
import { Building } from './town-models';
import { Structure } from './building-catalog';
import { add, distance, normalized, point, rotated, scale, sub } from './geometry';
import { f32 as f } from './numeric';
import { automaticConstructionAllowed, hasUnfinishedRoadwork, registerAutomaticConstruction } from './automatic-work';

export function orderAutomatic(this: Town, ids: number[]): void {
  for (const p of this.folk) {
    if (!canControl(p, this.controlFaction) || !ids.includes(p.id)) continue;
    p.autoMode = true;
    p.ordered = p.approachingOrder = p.hunting = false;
    p.recoveringRest = p.recoveringHealth = false;
    p.trainingCalling = -1;
    p.task = Activity.Idle; p.taskSite = p.supplyTarget = p.attackPerson = p.foe = p.tree = -1;
    p.supplyRoad = false; p.path = []; p.activity = Activity.Idle; p.until = this.time;
    p.scheduleAt = this.time + .5;
    this.scheduleAutomatic(p);
  }
}

// Resident policy has one entry point. An active enemy interrupts everything;
// direct targets otherwise run to completion. Auto keeps a construction/supply
// chain intact, and selects roads before buildings. Once road work is accepted,
// ordinary needs wait for completion; only combat or a new player order interrupts.
// Explicit Stop/Auto OFF is the sole idle hold.
export function scheduleAutomatic(this: Town, p: Person): boolean {
  if (p.role !== Role.Resident || p.health <= 0 || p.activity === Activity.Expedition || p.activity === Activity.Leaving) return false;
  if (p.faction !== this.controlFaction) return false;
  if (p.stressRecovery) return true;
  if (p.activity === Activity.Fighting) return true;
  if (hasUnfinishedRoadwork(this, p)) {
    // Keep the requested road through clearing, fetching and delivery, including
    // a connected prerequisite road. Also recover old saves suspended in care.
    if ([Activity.Idle, Activity.Holding, Activity.Sleeping, Activity.Eating,
      Activity.Drinking, Activity.Treating].includes(p.activity) ||
      (p.activity === Activity.WaitingMaterials && this.time >= p.until)) this.resumeOrder(p);
    return true;
  }
  if (p.ordered || p.approachingOrder) return true;
  if (!p.autoMode) return false;
  const night = this.climate().night > f(.5);
  if (p.health >= 1) p.recoveringHealth = false;
  if (p.rest >= f(.95)) p.recoveringRest = false;
  const care = (place: Building | null, activity: Activity): boolean => {
    if (p.activity === activity && p.target === (place?.id ?? -1)) return true;
    if (place && !this.walkTo(p, place.door())) return false;
    if (!place) { p.path = []; p.inside = false; p.sleptOutside = true; }
    p.activity = activity; p.target = place?.id ?? -1; p.tree = -1;
    if (!p.moving()) this.arrive(p);
    return true;
  };
  if (p.activity === Activity.Eating || p.activity === Activity.Drinking) return true;
  if (p.activity === Activity.Treating) {
    const clinic = this.building(p.target);
    if (p.health < 1 && clinic?.built() && clinic.workers > 0) return true;
    p.activity = Activity.Idle;
  }
  // Hunger may interrupt recovery; its stored flags survive the meal.
  if (p.food < f(.25) && (p.food < f(.05) || p.recoveringHealth || p.recoveringRest || p.activity === Activity.Sleeping) && (this.eat(p) || this.huntFood(p))) return true;
  // Dehydration must not keep a wounded sleeper trapped in slow recovery.
  // A short visit to an existing Well preserves both recovery flags and work.
  if (p.hydration < f(.1) && (p.recoveringHealth || p.recoveringRest || p.health < f(.4)) &&
      this.placed.some(b => b.built() && b.kind === Structure.Well && this.settlementOf(b) === this.settlementOf(p)) &&
      this.drink(p)) return true;
  if (p.health < f(.4)) p.recoveringHealth = true;
  if (p.rest < f(.2)) p.recoveringRest = true;
  if (p.recoveringHealth || p.recoveringRest || night) {
    if (p.recoveringHealth) {
      const clinic = this.nearest(p.position, b => b.faction === p.faction && b.kind === Structure.Apothecary && b.built() && b.workers > 0);
      if (clinic && care(clinic, Activity.Treating)) return true;
    }
    const home = this.building(p.home);
    if (home?.built() && home.faction === p.faction && care(home, Activity.Sleeping)) return true;
    // Homeless residents recover outside; they never enter somebody else's home.
    if ((p.recoveringHealth || p.recoveringRest) && care(null, Activity.Sleeping)) return true;
  }
  if (p.activity === Activity.Sleeping) {
    p.activity = Activity.Idle; p.until = this.time;
  }

  const buildingTask = p.task === Activity.Building ? this.building(p.taskSite) : null;
  if (buildingTask && (!buildingTask.built() || buildingTask.health < 1)) {
    if ([Activity.Idle, Activity.Holding].includes(p.activity) || (p.activity === Activity.WaitingMaterials && this.time >= p.until)) this.resumeOrder(p);
    // An unavailable supply chain keeps its target, but does not forbid eating
    // or drinking while waiting. Successful delivery resumes this same site.
    if (p.activity === Activity.WaitingMaterials) {
      if (p.food < f(.25) && (this.eat(p) || this.huntFood(p))) return true;
      if (p.hydration < f(.25) && this.drink(p)) return true;
    }
    return true;
  }
  if (p.task === Activity.Building || p.task === Activity.Roadwork) {
    if (this.resumeOrder(p) && Number(p.task) !== Activity.Idle) return true;
  }
  if (p.activity === Activity.Collecting || p.activity === Activity.Hauling) return true;
  if (p.carrying > 0 && this.haulCargo(p)) return true;
  const automatic = (accepted: boolean): boolean => {
    if (accepted) {
      registerAutomaticConstruction(this, p, p.task, p.taskSite);
      p.ordered = false;
    }
    return accepted;
  };
  for (const road of this.network.roads())
    if ((road.built < 1 || road.paving >= 0 || road.wear > 0) && automaticConstructionAllowed(this,p,Activity.Roadwork,road.id) && automatic(this.orderRoadwork([p.id], road.id))) return true;
  for (const b of this.placed)
    if ((!b.built() || b.health < 1) && automaticConstructionAllowed(this,p,Activity.Building,b.id) && automatic(this.orderBuild([p.id], b.id))) return true;

  if (p.food < f(.25) && (this.eat(p) || this.huntFood(p))) return true;
  if (p.hydration < f(.25) && this.drink(p)) return true;

  // The selected resource is a finite transaction: gather, deliver, then reevaluate.
  if ((p.task === Activity.Felling || p.task === Activity.Mining) && p.rest >= f(2 / 3)) {
    if (p.activity === p.task) return true;
    if (this.resumeOrder(p) && Number(p.task) !== Activity.Idle) return true;
  }
  const job = this.building(p.job);
  if (job?.built() && (p.rest >= f(2 / 3) || (job.kind !== Structure.Lumberyard && job.kind !== Structure.Quarry))) {
    if (p.task !== Activity.Working || p.taskSite !== job.id) {
      p.task = Activity.Working; p.taskSite = job.id; p.activity = Activity.Idle;
    }
    if (p.activity === Activity.Working || ((p.activity === Activity.Felling || p.activity === Activity.Mining) && p.tree >= 0)) return true;
    return this.resumeOrder(p);
  }
  if (p.task !== Activity.Idle) { p.task = Activity.Idle; p.taskSite = -1; p.tree = -1; p.path = []; p.activity = Activity.Idle; }
  if (!this.titleAutoplay && p.rest >= f(2 / 3) && this.startHarvest(p, p.position, 5)) {
    p.task = p.activity; p.taskSite = p.tree; p.goal = { ...p.position }; return true;
  }
  // Keep an existing wander route until its destination; reevaluation never
  // creates a fresh random waypoint every half second.
  if (p.moving() || this.time < p.until) return true;
  const home = this.building(p.home), seat = this.camp(this.settlementOf(p)),
    anchor = home?.door() ?? seat?.door() ?? this.world.camp();
  p.activity = Activity.Idle; p.until = this.time + 3;
  for (let attempt = 0; attempt < 8; ++attempt) {
    const angle = f(this.roll() * f(6.2831853)), radius = f(2 + f(this.roll() * f(2.5)));
    let goal = add(p.position, rotated(point(radius, 0), angle));
    if (distance(goal, anchor) > 10) goal = add(anchor, scale(normalized(sub(goal, anchor)), 4));
    goal = this.grid.nearestWalkable(goal);
    if (distance(goal, p.position) >= .8 && this.walkTo(p, goal)) break;
  }
  return true;
}
