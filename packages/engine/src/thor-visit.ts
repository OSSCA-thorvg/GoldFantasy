// Thor, a god who visits Midgard now and then: by day a guest of the settlement, by night a hunter round it.
import type { TownState } from './town-state';
import { Structure } from './building-catalog';
import { Activity, Role, type Monster, type Person } from './person';
import type { Building } from './town-models';
import { MonsterRank } from './combat-events';
import { StrikeKind } from './skill-catalog';
import { add, distance, normalized, point, rotated, scale, sub, type Point } from './geometry';
import { f32 as f, hash01, lround } from './numeric';
import { playerFaction } from './faction';

export enum ThorDoing {
  Away,
  /** Just come down with a bolt; gets up. */
  Arriving,
  Strolling,
  Fireside,
  /** Looks on while a resident works. */
  Watching,
  /** Tests his strength on a boulder. */
  Lifting,
  Drinking,
  Hunting,
  Leaving,
}
export enum BoltKind {
  Arrival,
  Hammer,
  Departure,
}
export interface ThorBolt {
  serial: bigint;
  kind: BoltKind;
  at: number;
  position: Point;
}
export const thorRules = {
  /** Residents the settlement needs, with a finished altar, before he first comes. */
  residents: 4,
  /** Nights he stays: he comes one morning and goes the morning after the last. */
  stay: 3,
  /** Days in a month of the calendar (TownState.daysPerMonth); he is away about that long, give or take. */
  month: 5,
  gapLeast: 4,
  gapMost: 7,
  /** Time of day he comes down and sets off home. */
  arriveHour: f(0.3),
  /** Night strength at which he starts and stops hunting. */
  huntNight: f(0.5),
  restNight: f(0.3),
  /** He hunts only this many tiles round the settlement's fire. */
  huntReach: 16,
  throwReach: f(5.5),
  /** Seconds between throws; the swing before the hammer leaves his hand; its flight each way. */
  throwPause: f(3.4),
  windup: f(0.3),
  flight: f(0.35),
  blow: f(24),
  pace: f(0.8),
  huntPace: f(1.5),
  /** How much more often lightning strikes in rain while he is here. */
  thunder: 3,
  /** Chance that rain is a thunderstorm while he is here (otherwise only in summer, at 0.3). */
  storm: f(0.65),
  /** Seconds a departure may take before he is simply gone. */
  leaveSeconds: 45,
};
export class ThorVisit {
  present = false;
  /** Day he came on this visit, or of his last visit. */
  arrivedDay = -1;
  /** Day the next visit is due; -1 until the settlement has called him. */
  nextVisit = -1;
  visits = 0;
  position = point();
  // Transient: what he does now, re-chosen after a load.
  doing = ThorDoing.Away;
  since = 0;
  until = 0;
  goal: Point | null = null;
  path: Point[] = [];
  pathAt = -1;
  /** Where he looks: the fire, a resident at work, a monster. */
  look: Point | null = null;
  watched = -1;
  target = -1;
  /** Clock time he began a throw, or -1; where the hammer is going and whether it has struck. */
  throwAt = -1;
  throwFrom = point();
  throwTo = point();
  struck = false;
  readyAt = 0;
  bolts: ThorBolt[] = [];
  nextBolt = 0n;
}
export interface ThorTown extends TownState {
  camp(): Building | null;
  population(): number;
  dayFraction(): number;
  inRealm(p: Point): boolean;
  hurtCreature(foe: Monster, damage: number, by: Person | null): boolean;
}
const doingsByDay = [ThorDoing.Strolling, ThorDoing.Fireside, ThorDoing.Watching, ThorDoing.Lifting, ThorDoing.Drinking];
const inns = new Set([Structure.Tavern, Structure.Inn, Structure.GrandInn]);
/** True while Thor is in Midgard. */
export const thorPresent = (town: TownState): boolean => town.thor.present;
/** Lightning comes this many times as often in rain; thunder follows each strike. */
export const thunderFactor = (town: TownState): number => (town.thor.present ? thorRules.thunder : 1);
function called(town: ThorTown): boolean {
  return (
    town.population() >= thorRules.residents &&
    town.placed.some((b) => b.kind === Structure.Shrine && b.built() && b.faction === playerFaction)
  );
}
const hash = (town: TownState, a: number, b: number, salt: number) => hash01(town.world.seed(), a, b, salt);
/** A walkable spot `least`..`most` tiles from `around`, picked by `salt`; null when none is found. */
function spotNear(town: ThorTown, around: Point, least: number, most: number, salt: number): Point | null {
  for (let attempt = 0; attempt < 12; ++attempt) {
    const reach = f(least + f(f(most - least) * hash(town, salt, attempt, 7101))),
      turn = f(hash(town, salt, attempt, 7102) * f(6.2832)),
      at = add(around, rotated(point(reach, 0), turn));
    if (town.grid.walkable(at) && !town.inRealm(at)) return at;
  }
  return null;
}
function bolt(town: TownState, kind: BoltKind, at: Point): void {
  const thor = town.thor;
  thor.bolts = thor.bolts.filter((b) => town.time - b.at < 3);
  thor.bolts.push({ serial: thor.nextBolt++, kind, at: town.time, position: { ...at } });
}
function begin(town: TownState, doing: ThorDoing, seconds: number, goal: Point | null): void {
  const thor = town.thor;
  thor.doing = doing;
  thor.since = town.time;
  thor.until = town.time + seconds;
  thor.goal = goal ? { ...goal } : null;
  thor.path = [];
  thor.pathAt = -1;
  thor.look = null;
  thor.watched = -1;
}
function arrive(town: ThorTown, fire: Building): void {
  const thor = town.thor,
    at = spotNear(town, fire.center, 5, 7, thor.visits * 31 + 1) ?? town.grid.nearestWalkable(fire.center);
  thor.present = true;
  thor.arrivedDay = town.days;
  ++thor.visits;
  thor.position = { ...at };
  thor.target = -1;
  thor.throwAt = -1;
  begin(town, ThorDoing.Arriving, 3, null);
  bolt(town, BoltKind.Arrival, at);
  town.notify('Thor has come to Midgard');
}
function depart(town: ThorTown): void {
  const thor = town.thor;
  bolt(town, BoltKind.Departure, thor.position);
  thor.present = false;
  thor.doing = ThorDoing.Away;
  thor.target = -1;
  thor.throwAt = -1;
  const span = thorRules.gapMost - thorRules.gapLeast + 1;
  thor.nextVisit = town.days + thorRules.gapLeast + Math.floor(hash(town, thor.visits, town.days, 7103) * span);
  town.notify('Thor leaves Midgard');
}
/** Follows `thor.path` (or walks straight to `goal`) at `pace` tiles a second; true once there. */
function walk(town: ThorTown, goal: Point, pace: number, dt: number): boolean {
  const thor = town.thor;
  if (distance(thor.position, goal) < f(0.15)) return true;
  if (!thor.path.length || town.time - thor.pathAt > 1.5) {
    thor.pathAt = town.time;
    thor.path = town.grid.clear(thor.position, goal, Infinity) ? [{ ...goal }] : town.grid.path(thor.position, goal);
    if (!thor.path.length) return true;
  }
  let step = f(pace * dt);
  while (step > 0 && thor.path.length) {
    const next = thor.path[0],
      gap = distance(thor.position, next);
    if (gap <= step) {
      thor.position = { ...next };
      thor.path.shift();
      step = f(step - gap);
    } else {
      thor.position = add(thor.position, scale(sub(next, thor.position), f(step / gap)));
      step = 0;
    }
  }
  return !thor.path.length && distance(thor.position, goal) < f(0.3);
}
const working = (p: Person) =>
  p.role === Role.Resident &&
  p.faction === playerFaction &&
  p.health > 0 &&
  p.downedAt < 0 &&
  !p.inside &&
  [Activity.Building, Activity.Roadwork, Activity.Working, Activity.Felling, Activity.Mining, Activity.Collecting, Activity.Crafting].includes(p.activity);
/** Picks the next pastime by day: never the one just done, never one the settlement cannot host. */
function pastime(town: ThorTown, fire: Building): void {
  const thor = town.thor,
    beat = Math.trunc(town.time),
    worker = town.folk.filter((p) => working(p) && distance(p.position, fire.center) < thorRules.huntReach)[0],
    inn = town.placed.find((b) => inns.has(b.kind) && b.built() && b.faction === playerFaction),
    choices = doingsByDay.filter(
      (d) =>
        d !== thor.doing &&
        (d !== ThorDoing.Watching || worker) &&
        (d !== ThorDoing.Drinking || inn),
    ),
    doing = choices[Math.floor(hash(town, thor.visits, beat, 7104) * choices.length)] ?? ThorDoing.Strolling,
    linger = (least: number, most: number) => f(least + f(f(most - least) * hash(town, beat, thor.visits, 7105)));
  switch (doing) {
    case ThorDoing.Fireside: {
      const seat = spotNear(town, fire.center, f(1.7), f(2.2), beat);
      begin(town, ThorDoing.Fireside, linger(35, 50), seat);
      thor.look = { ...fire.center };
      break;
    }
    case ThorDoing.Watching: {
      const at = worker ? spotNear(town, worker.position, f(1.6), f(2.4), beat) : null;
      begin(town, ThorDoing.Watching, linger(25, 35), at);
      thor.watched = worker?.id ?? -1;
      break;
    }
    case ThorDoing.Lifting:
      begin(town, ThorDoing.Lifting, linger(22, 30), spotNear(town, fire.center, 4, 7, beat));
      break;
    case ThorDoing.Drinking:
      begin(town, ThorDoing.Drinking, linger(30, 45), inn ? town.grid.nearestWalkable(add(inn.door(), point(f(0.6), f(0.6)))) : null);
      if (inn) thor.look = { ...inn.center };
      break;
    default:
      begin(town, ThorDoing.Strolling, linger(14, 22), spotNear(town, fire.center, 3, 9, beat));
  }
}
/** A monster he may hunt: alive and out in Midgard near the settlement, never beyond a gate, never a giant. */
function quarry(town: ThorTown, m: Monster, fire: Building, slack = 0): boolean {
  return (
    m.animal === null &&
    m.health > 0 &&
    !m.insideLair &&
    !m.giant() &&
    m.rank !== MonsterRank.Den &&
    m.rank !== MonsterRank.Guardian &&
    !town.inRealm(m.home) &&
    !town.inRealm(m.position) &&
    distance(m.position, fire.center) <= thorRules.huntReach + slack
  );
}
function hunt(town: ThorTown, fire: Building, dt: number): void {
  const thor = town.thor;
  let foe = thor.target >= 0 ? (town.beasts.find((m) => m.id === thor.target) ?? null) : null;
  if (foe && !quarry(town, foe, fire, 2)) foe = null;
  if (!foe) {
    let best = Infinity;
    for (const m of town.beasts)
      if (quarry(town, m, fire) && distance(m.position, thor.position) < best) {
        best = distance(m.position, thor.position);
        foe = m;
      }
    thor.target = foe?.id ?? -1;
    thor.path = [];
  }
  if (!foe) {
    // Nothing to hunt: he walks the edge of the settlement and waits.
    if (!thor.goal || walk(town, thor.goal, thorRules.pace, dt)) {
      thor.goal = spotNear(town, fire.center, 4, 8, Math.trunc(town.time / 9) + thor.visits * 101);
      thor.path = [];
    }
    thor.look = null;
    return;
  }
  thor.look = { ...foe.position };
  if (thor.throwAt >= 0) return;
  if (distance(foe.position, thor.position) > thorRules.throwReach) {
    if (town.time - thor.pathAt > 0.6) thor.path = [];
    walk(town, foe.position, thorRules.huntPace, dt);
    return;
  }
  if (town.time < thor.readyAt) return;
  thor.throwAt = town.time;
  thor.throwFrom = { ...thor.position };
  thor.throwTo = { ...foe.position };
  thor.struck = false;
  thor.readyAt = town.time + thorRules.throwPause;
}
/** The hammer homes on its mark, strikes with a bolt, and flies back to his hand. */
function flyHammer(town: ThorTown): void {
  const thor = town.thor;
  if (thor.throwAt < 0) return;
  const foe = town.beasts.find((m) => m.id === thor.target && m.health > 0);
  if (!thor.struck) {
    if (foe) thor.throwTo = { ...foe.position };
    if (town.time < thor.throwAt + thorRules.windup + thorRules.flight) return;
    thor.struck = true;
    bolt(town, BoltKind.Hammer, thor.throwTo);
    if (foe && distance(foe.position, thor.throwTo) < 1.5) {
      town.blows.push({
        serial: town.nextBlow++,
        from: { ...thor.throwFrom },
        to: { ...foe.position },
        damage: lround(f(thorRules.blow * 10)),
        onPerson: false,
        ranged: true,
        at: town.time,
        person: -1,
        strike: StrikeKind.Crush,
        primary: true,
      });
      // No resident earns this kill: the corpse leaves only what any corpse leaves.
      town.combatState.slayers.delete(foe.id);
      town.hurtCreature(foe, thorRules.blow, null);
    }
  }
  if (town.time >= thor.throwAt + thorRules.windup + thorRules.flight * 2 + f(0.15)) thor.throwAt = -1;
}
/** One step of Thor's visits: when he comes, what he does by day and night, and when he goes. */
export function advanceThor(this: ThorTown, dt: number): void {
  const thor = this.thor,
    fire = this.camp();
  this.sky.stormChance = thor.present ? thorRules.storm : -1;
  if (thor.bolts.length && this.time - thor.bolts[0].at > 3) thor.bolts = thor.bolts.filter((b) => this.time - b.at < 3);
  if (!thor.present) {
    // A save from when his visits were weeks apart waits no longer than the rhythm now allows.
    if (thor.nextVisit > this.days + thorRules.gapMost) thor.nextVisit = this.days + thorRules.gapMost;
    if (thor.nextVisit < 0) {
      if (fire && called(this)) thor.nextVisit = this.days + 1;
      return;
    }
    const hour = this.dayFraction();
    if (fire && fire.built() && this.days >= thor.nextVisit && hour >= thorRules.arriveHour && hour < f(0.6) && called(this))
      arrive(this, fire);
    return;
  }
  if (!fire) {
    depart(this);
    return;
  }
  flyHammer(this);
  const night = this.climate().night,
    homeward = this.days >= thor.arrivedDay + thorRules.stay && this.dayFraction() >= thorRules.arriveHour;
  if (thor.doing === ThorDoing.Leaving) {
    if (walk(this, thor.goal ?? thor.position, thorRules.pace, dt) || this.time > thor.until) depart(this);
    return;
  }
  if (thor.doing === ThorDoing.Arriving && this.time < thor.until) return;
  if (thor.doing === ThorDoing.Hunting ? night > thorRules.restNight : night > thorRules.huntNight) {
    if (thor.doing !== ThorDoing.Hunting) begin(this, ThorDoing.Hunting, Infinity, null);
    hunt(this, fire, dt);
    return;
  }
  if (thor.throwAt >= 0) return;
  if (thor.doing === ThorDoing.Hunting) {
    thor.target = -1;
    thor.doing = ThorDoing.Away;
  }
  if (homeward) {
    const away = spotNear(this, fire.center, 11, 14, thor.visits * 31 + 2);
    begin(this, ThorDoing.Leaving, thorRules.leaveSeconds, away ?? thor.position);
    return;
  }
  if (thor.doing === ThorDoing.Away || thor.doing === ThorDoing.Arriving || this.time >= thor.until) {
    pastime(this, fire);
    if (thor.doing === ThorDoing.Watching) {
      const who = this.person(thor.watched);
      if (who) thor.look = { ...who.position };
    }
  }
  if (thor.doing === ThorDoing.Watching) {
    const who = this.person(thor.watched);
    if (!who || !working(who)) thor.until = Math.min(thor.until, this.time);
    else thor.look = { ...who.position };
  }
  if (thor.goal) walk(this, thor.goal, thorRules.pace, dt);
}
/** True when Thor stands at his pastime's place (not walking there). */
export function thorSettled(town: TownState): boolean {
  const thor = town.thor;
  return !thor.goal || distance(thor.position, thor.goal) < f(0.3);
}
/** Unit vector from Thor toward where he looks, or null. */
export function thorGaze(town: TownState): Point | null {
  const thor = town.thor;
  return thor.look && distance(thor.look, thor.position) > 0.05 ? normalized(sub(thor.look, thor.position)) : null;
}
