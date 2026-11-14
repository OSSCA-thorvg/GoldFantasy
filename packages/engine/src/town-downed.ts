import type { TownState } from './town-state';
import type { Town } from './town';
import { Activity, Role, type Person } from './person';
import { CombatCue, combatRules } from './combat-events';
import { add, distance, normalized, scale, sub } from './geometry';
import { f32 as f } from './numeric';
import { Boon, boon, boonRules } from './gate-boons';
import { beyondOrders, canControl, playerFaction } from './faction';
import { worldName } from './world-map';
import { Structure } from './building-catalog';

const tendReach = 0.9;
/** Idle allies come from this far; in Midgard, residents busy on Auto do too. */
const helperReach = 12;
const clearOfMonsters = 3;
const griefNear = 8;
const griefStress = { near: 0.25, far: 0.1 };

const bleedSeconds = (town: TownState, p: Person): number =>
  combatRules.bleedOut * (p.woundDays > 0 ? 0.5 : 1) * (boon(town, Boon.Barrow) ? boonRules.barrowBleedOut : 1);
const downed = (p: Person): boolean => p.downedAt >= 0 && p.health > -0.5;
/** Already killed this tick, waiting to be removed. */
const dead = (p: Person): boolean => p.activity === Activity.Leaving && p.health <= -1;

/** Residents lying downed, bleeding out until tended or dead. */
export function downedResidents(this: TownState): Person[] {
  return this.folk.filter((p) => downed(p) && p.activity === Activity.Downed);
}
/** Seconds a downed resident has left; 0 when not downed. */
export function bleedOutLeft(this: TownState, p: Person): number {
  return p.downedAt < 0 ? 0 : Math.max(0, p.downedAt + bleedSeconds(this, p) - this.time);
}
/** Full bleed-out time of a downed resident, for a draining ring; 0 when not downed. */
export function bleedOutTotal(this: TownState, p: Person): number {
  return p.downedAt < 0 ? 0 : bleedSeconds(this, p);
}
/** The one way a lethal blow lands: the player's residents go down and bleed out, anyone else dies. */
export function strikeDown(this: Town, p: Person, cause: string, notice = `${p.name}: ${cause.toLowerCase()}`): void {
  // Callers pass the blow that crossed zero, however deep it went.
  if (p.downedAt >= 0 || dead(p)) return;
  if (p.role !== Role.Resident || p.faction !== playerFaction) {
    this.killResident(p, cause, notice);
    return;
  }
  p.health = 0;
  p.downedAt = this.time;
  p.activity = Activity.Downed;
  p.path = [];
  p.foe = -1;
  p.hunting = false;
  p.approachingOrder = false;
  this.combatState.downedBy.set(p.id, cause);
  this.emit(CombatCue.Downed, p.position, { person: p.id, duration: bleedSeconds(this, p), text: cause });
  this.notify(`${p.name} is down and bleeding out`);
}
/** Death. A resident of the player is remembered, and the settlement grieves. */
export function killResident(this: Town, p: Person, cause: string, notice = `${p.name} has died`): void {
  if (dead(p)) return;
  const remembered = p.role === Role.Resident && p.faction === playerFaction,
    village = remembered ? this.settlementOf(p) : -1,
    at = { ...p.position },
    place =
      this.realmGate >= 0 && this.inRealm(at)
        ? worldName(this.world.destination(this.world.dungeons()[this.realmGate]))
        : 'Midgard';
  p.health = -1;
  p.downedAt = -1;
  p.activity = Activity.Leaving;
  p.path = [];
  this.combatState.downedBy.delete(p.id);
  this.notify(notice);
  if (!remembered) return;
  this.fallen.push({
    id: p.id,
    name: p.name,
    past: p.past,
    look: p.look,
    calling: p.calling,
    race: p.race,
    level: p.level,
    days: p.days,
    kills: p.kills,
    cause,
    place,
    day: this.days,
    at: this.time,
    position: at,
  });
  this.emit(CombatCue.Death, at, { person: p.id, text: cause });
  const comfort = this.memorialComfort();
  for (const other of this.folk)
    if (
      other !== p &&
      other.role === Role.Resident &&
      other.faction === p.faction &&
      other.health > -0.5 &&
      this.settlementOf(other) === village
    )
      other.stress = Math.min(
        1,
        f(other.stress + (distance(other.position, at) <= griefNear ? griefStress.near : griefStress.far) * comfort),
      );
}
/** Gets a downed resident up with a lasting wound. `health` overrides the usual revival health. */
export function revive(this: Town, p: Person, health = -1): void {
  if (!downed(p)) return;
  p.downedAt = -1;
  p.health = health >= 0 ? health : boon(this, Boon.Barrow) ? boonRules.barrowReviveHealth : combatRules.reviveHealth;
  p.woundDays = Math.max(p.woundDays, combatRules.woundDays);
  ++p.lookRevision;
  p.activity = Activity.Idle;
  p.until = this.time;
  p.path = [];
  this.combatState.downedBy.delete(p.id);
  ++this.chronicle.rescues;
  this.emit(CombatCue.Revived, p.position, { person: p.id, amount: Math.round(p.health * 100) });
  this.notify(`${p.name} is back on their feet`);
}
function startTending(town: Town, p: Person, hurt: Person, ordered: boolean): void {
  const kneeling = p.activity === Activity.Tending && p.target === hurt.id,
    until = p.until;
  town.setOrder(p, Activity.Tending, hurt.id);
  // A player's order ignores enemies like a Move; a helper who went on their own still defends.
  p.aggressive = !ordered;
  p.goal = { ...hurt.position };
  // Asked again while kneeling by them, the count carries on; a kneel by someone else does not count.
  if (kneeling) {
    p.until = until;
    return;
  }
  if (p.activity === Activity.Tending) p.activity = Activity.Idle;
  p.until = Infinity;
  town.tend(p);
}
function finishTending(town: Town, p: Person): void {
  p.task = Activity.Idle;
  p.taskSite = p.target = -1;
  p.ordered = p.aggressive = p.approachingOrder = false;
  p.path = [];
  p.activity = Activity.Idle;
  p.until = town.time + 1;
}
/** Sends the chosen residents to kneel by a downed one and get them up. */
export function orderTend(this: Town, ids: number[], target: number): boolean {
  const hurt = this.person(target);
  if (!hurt || !downed(hurt)) return false;
  let any = false;
  for (const p of this.folk) {
    if (!canControl(p, this.controlFaction) || beyondOrders(p) || !ids.includes(p.id) || p.id === target) continue;
    if (p.faction !== hurt.faction || this.inRealm(p.position) !== this.inRealm(hurt.position)) continue;
    startTending(this, p, hurt, true);
    any = any || p.task === Activity.Tending;
  }
  return any;
}
/** One step of a helper walking to, then kneeling by, a downed resident. */
export function tend(this: Town, p: Person): void {
  const hurt = this.person(p.taskSite);
  if (!hurt || !downed(hurt)) return finishTending(this, p);
  if (distance(p.position, hurt.position) > tendReach) {
    const away = sub(p.position, hurt.position),
      spot = this.grid.nearestWalkable(
        distance(p.position, hurt.position) > 0.01 ? add(hurt.position, scale(normalized(away), 0.45)) : hurt.position,
      );
    if (p.activity === Activity.Moving && p.path.length && distance(p.path[p.path.length - 1], spot) < 0.5) return;
    if (!this.walkTo(p, spot)) return finishTending(this, p);
    p.activity = Activity.Moving;
    p.goal = { ...spot };
    p.until = Infinity;
    return;
  }
  p.path = [];
  if (p.activity !== Activity.Tending) {
    p.activity = Activity.Tending;
    p.target = hurt.id;
    p.until = this.time + combatRules.tendSeconds;
    return;
  }
  if (this.time < p.until) return;
  this.revive(hurt);
  finishTending(this, p);
}
function helperFor(town: Town, hurt: Person): Person | null {
  const realm = town.inRealm(hurt.position);
  let best: Person | null = null;
  for (const a of town.folk) {
    if (
      a === hurt ||
      a.faction !== hurt.faction ||
      a.role !== Role.Resident ||
      a.health <= 0 ||
      a.downedAt >= 0 ||
      a.stressRecovery ||
      a.inside ||
      a.crossingDoorway() ||
      a.ordered ||
      a.approachingOrder ||
      [Activity.Fighting, Activity.Expedition, Activity.Leaving, Activity.Tending, Activity.Sleeping].includes(a.activity) ||
      town.inRealm(a.position) !== realm
    )
      continue;
    const gap = distance(a.position, hurt.position),
      idle = [Activity.Idle, Activity.Holding, Activity.Moving, Activity.Brooding].includes(a.activity);
    if (gap > helperReach || !(idle || (!realm && a.autoMode))) continue;
    if (!best || gap < distance(best.position, hurt.position)) best = a;
  }
  return best;
}
/** Bleeds the downed out and sends idle allies to tend those no monster stands over. */
export function advanceDowned(this: Town): void {
  for (const p of this.folk) {
    if (!downed(p)) continue;
    p.activity = Activity.Downed;
    if (this.bleedOutLeft(p) <= 0) {
      this.killResident(p, this.combatState.downedBy.get(p.id) ?? 'Died of wounds', `${p.name} has died of their wounds`);
      continue;
    }
    if (this.folk.some((a) => a.task === Activity.Tending && a.taskSite === p.id && a.downedAt < 0 && a.health > 0)) continue;
    const threatened = [...this.beasts, ...this.animals].some(
      (m) =>
        m.health > 0 &&
        !m.insideLair &&
        (m.animal === null || m.angry) &&
        distance(m.position, p.position) <= clearOfMonsters,
    );
    if (threatened) continue;
    const helper = helperFor(this, p);
    if (helper) startTending(this, helper, p, false);
  }
}
/** Wounds heal a day at a time, two a day while an apothecary is staffed. */
export function advanceWounds(this: Town): void {
  const state = this.combatState;
  if (state.woundDay === this.days) return;
  const passed = state.woundDay < 0 ? 0 : this.days - state.woundDay;
  state.woundDay = this.days;
  if (passed <= 0) return;
  const healed = passed * (this.staffed(Structure.Apothecary) ? 2 : 1);
  for (const p of this.folk)
    if (p.woundDays > 0 && p.downedAt < 0 && p.faction === this.controlFaction) {
      p.woundDays = Math.max(0, p.woundDays - healed);
      if (!p.woundDays) ++p.lookRevision;
    }
}
