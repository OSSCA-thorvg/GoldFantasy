import type { Town } from './town';
import { Activity, Role, type Person } from './person';
import { f32 } from './numeric';
import { distance } from './geometry';
import { defect } from './neutral-settlements';
import { TownState } from './town-state';

export const stressPolicy = {
  breakdown: 0.85,
  recovered: 0.35,
  repeatWindowDays: 7,
  recoveryPerDay: 0.65,
} as const;

/** True consumes work/combat scheduling; the caller still advances doorway/walking. */
export function updateStress(this: Town, p: Person, dt: number): boolean {
  if (p.faction !== 0 || p.role !== Role.Resident || p.health <= 0 || p.activity === Activity.Expedition)
    return false;
  if (!p.stressRecovery && p.stress >= f32(stressPolicy.breakdown)) {
    const elapsed = this.time - p.lastBreakdownAt;
    if (
      p.lastBreakdownAt >= 0 &&
      elapsed >= 0 &&
      elapsed <= stressPolicy.repeatWindowDays * TownState.secondsPerDay
    ) {
      defect.call(this, p);
      return true;
    }
    p.lastBreakdownAt = this.time;
    p.stressRecovery = true;
    p.task = Activity.Idle;
    p.taskSite = p.supplyTarget = p.foe = p.tree = p.attackPerson = -1;
    p.ordered = p.approachingOrder = p.aggressive = p.hunting = p.supplyRoad = false;
    p.path = [];
    p.activity = Activity.Idle;
    this.notify(`${p.name} is overwhelmed and needs time to rest.`);
  }
  if (!p.stressRecovery) return false;
  p.stress = Math.max(0, f32(p.stress - (stressPolicy.recoveryPerDay * dt) / TownState.secondsPerDay));
  if (p.stress <= f32(stressPolicy.recovered)) {
    p.stressRecovery = false;
    p.autoMode = true;
    p.activity = Activity.Idle;
    p.until = this.time;
    p.scheduleAt = this.time;
    this.notify(`${p.name} feels ready to work again.`);
    return false;
  }
  const home = this.building(p.home);
  if (home?.built() && home.faction === p.faction) {
    if (p.inside && this.shelterOf(p) === home.id) {
      p.activity = Activity.Sleeping;
      p.target = home.id;
      // A stocked own home can serve a meal during quiet recovery without
      // assigning an errand or returning control before the stress has passed.
      const village = this.settlementOf(p),
        stock = this.stock(village);
      if (!p.crossingDoorway() && p.food < f32(0.25) && stock.food > 0) {
        --stock.food;
        ++this.economy(village).today.eaten;
        p.food = 1;
      }
    } else if (
      p.activity !== Activity.Sleeping ||
      p.target !== home.id ||
      (!p.moving() && distance(p.position, home.door()) > 0.02)
    ) {
      if (this.walkTo(p, home.door())) {
        p.activity = Activity.Sleeping;
        p.target = home.id;
        if (!p.moving() && !p.crossingDoorway()) this.arrive(p);
      } else {
        p.activity = Activity.Idle;
        p.path = [];
      }
    }
  } else {
    p.activity = Activity.Sleeping;
    p.target = -1;
    p.path = [];
    p.inside = false;
    p.sleptOutside = true;
  }
  return true;
}
