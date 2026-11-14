// Clearing: a building, field or road marked for tearing down, and the residents sent to do it.
import type { Town } from './town';
import { Activity, Person, Role, TreeWorkKind } from './person';
import { Check } from './town-models';
import { buildWork, isSeat } from './building-catalog';
import { isCraftStation, workEfficiency } from './equipment';
import { Point, area, centroid, distance, point } from './geometry';
import { TownState } from './town-state';
import { beyondOrders, canControl } from './faction';
import { f32 } from './numeric';
import { hammerTiming, workElapsed, workImpactBetween } from './work-timing';

export type ClearKind = 'building' | 'field' | 'road';
export interface ClearTarget {
  kind: ClearKind;
  id: number;
}
export interface ClearMark extends ClearTarget {
  serial: number;
  /** Share torn down, 0 to 1. */
  done: number;
  /** Worker seconds the whole job takes. */
  work: number;
  crew: number[];
  /** Crew members who were on Auto and go back to it when the job ends. */
  wasAuto: number[];
  callAt: number;
}
export interface ClearResult {
  check: Check;
  /** The thing went at once (an empty blueprint). */
  removed: boolean;
  mark: ClearMark | null;
}
const marks = new WeakMap<object, ClearMark[]>();
let nextSerial = 1;
const autoCrew = 3;
const reach = f32(1.1);

export function clearMarks(town: Town): ClearMark[] {
  let list = marks.get(town);
  if (!list) marks.set(town, (list = []));
  return list;
}
export function clearMarkOf(town: Town, kind: ClearKind, id: number): ClearMark | null {
  return clearMarks(town).find((m) => m.kind === kind && m.id === id) ?? null;
}
export function clearTargetAt(town: Town, p: Point): ClearTarget | null {
  const building = town.buildingAt(p);
  if (building >= 0) return { kind: 'building', id: building };
  const field = town.fieldAt(p);
  if (field >= 0) return { kind: 'field', id: field };
  const match = town.network.distance(p),
    road = town.network.road(match.id ?? -1);
  if (road && match.distance < f32(TownState.roadHalfWidth + f32(0.15))) return { kind: 'road', id: road.id };
  return null;
}
const refuse = (reason: string): Check => new Check(false, reason);
/** Whether the player may clear this thing; the reason is shown to the player when not. */
export function canClear(town: Town, kind: ClearKind, id: number): Check {
  if (kind === 'building') {
    const b = town.building(id);
    if (!b) return refuse('Nothing to clear');
    if (b.faction !== town.controlFaction) return refuse('This building belongs to a neutral settlement');
    if (isSeat(b.kind)) return refuse('The seat of the settlement stays');
    if (isCraftStation(b.kind) && town.folk.some((p) => p.craftWorkshop === id && p.craftItem !== null))
      return refuse('Someone is working at this station');
  } else if (kind === 'field') {
    const field = town.field(id);
    if (!field) return refuse('Nothing to clear');
    if (field.faction !== town.controlFaction) return refuse('This field belongs to a neutral settlement');
  } else {
    const road = town.network.road(id);
    if (!road) return refuse('Nothing to clear');
    if (road.faction !== town.controlFaction) return refuse('This road belongs to a neutral settlement');
  }
  return new Check(true);
}
/** Removes the thing now. Shared by the tool's final step and the crew finishing a job. */
export function clearNow(town: Town, kind: ClearKind, id: number): boolean {
  if (!canClear(town, kind, id).ok) return false;
  if (kind === 'building') town.raze(id);
  else if (kind === 'field') town.farmland = town.farmland.filter((f) => f.id !== id);
  else {
    town.network.remove(id);
    ++town.roadChanges;
    for (const person of town.folk)
      if (person.activity === Activity.Roadwork && person.target === id) person.activity = Activity.Idle;
  }
  ++town.changes;
  return true;
}
/** Where crews stand to work, and the worker seconds the job takes. */
function site(town: Town, t: ClearTarget): { at: Point; work: number } | null {
  if (t.kind === 'building') {
    const b = town.building(t.id);
    if (!b) return null;
    const share = b.built() ? Math.max(f32(0.25), b.health) : b.progress;
    return { at: b.door(), work: Math.max(2, f32(f32(buildWork(b.kind) * f32(0.5)) * share)) };
  }
  if (t.kind === 'field') {
    const field = town.field(t.id);
    return field ? { at: centroid(field.outline), work: Math.max(2, f32(area(field.outline) * f32(0.4))) } : null;
  }
  const road = town.network.road(t.id);
  return road ? { at: road.along(0.5), work: Math.max(2, f32(road.length() * road.built * f32(0.6))) } : null;
}
function spotFor(town: Town, mark: ClearMark): Point | null {
  if (mark.kind === 'road') {
    const road = town.network.road(mark.id);
    return road ? road.along(0.5) : null;
  }
  return site(town, mark)?.at ?? null;
}
function closestOnRoad(town: Town, mark: ClearMark, p: Person): Point | null {
  const road = town.network.road(mark.id);
  if (!road) return null;
  let best = road.along(0),
    gap = distance(best, p.position);
  for (let i = 1; i <= 8; ++i) {
    const at = road.along(i / 8),
      d = distance(at, p.position);
    if (d < gap) [best, gap] = [at, d];
  }
  return best;
}
const free = (town: Town, p: Person): boolean =>
  canControl(p, town.controlFaction) &&
  p.role === Role.Resident &&
  p.autoMode &&
  !p.ordered &&
  p.task === Activity.Idle &&
  p.clearing < 0 &&
  p.craftItem === null &&
  p.activity !== Activity.Sleeping;
function enlist(town: Town, mark: ClearMark, p: Person): boolean {
  if (!canControl(p, town.controlFaction) || beyondOrders(p)) return false;
  const spot = mark.kind === 'road' ? closestOnRoad(town, mark, p) : spotFor(town, mark);
  if (!spot) return false;
  const auto = p.autoMode;
  town.setOrder(p, Activity.Holding);
  if (!town.walkTo(p, town.grid.nearestWalkable(spot))) return false;
  p.goal = { ...(p.path.length ? p.path[p.path.length - 1] : p.position) };
  p.activity = Activity.Moving;
  p.autoMode = false;
  p.clearing = mark.serial;
  mark.crew.push(p.id);
  if (auto) mark.wasAuto.push(p.id);
  return true;
}
function callFreeHands(town: Town, mark: ClearMark): void {
  const spot = spotFor(town, mark);
  if (!spot) return;
  const hands = town.folk
    .filter((p) => free(town, p))
    .sort((a, b) => distance(a.position, spot) - distance(b.position, spot));
  for (const p of hands) {
    if (mark.crew.length >= autoCrew) break;
    enlist(town, mark, p);
  }
}
function release(town: Town, mark: ClearMark, id: number): void {
  const p = town.person(id);
  if (p && p.clearing === mark.serial) {
    p.clearing = -1;
    if (p.task === Activity.Holding || p.task === Activity.Idle) {
      p.task = Activity.Idle;
      p.ordered = false;
      p.activity = Activity.Idle;
      p.path = [];
      p.until = town.time;
      if (mark.wasAuto.includes(id)) p.autoMode = true;
    }
  }
  mark.crew = mark.crew.filter((other) => other !== id);
}
/**
 * Marks the thing for clearing and sends `ids` (or, with none, the nearest free residents on Auto) to tear it down.
 * A blueprint with nothing built goes at once.
 */
export function markClear(town: Town, kind: ClearKind, id: number, ids: readonly number[] = []): ClearResult {
  const check = canClear(town, kind, id);
  if (!check.ok) return { check, removed: false, mark: null };
  const b = kind === 'building' ? town.building(id) : null;
  if (b && !b.built() && b.progress <= 0) return { check, removed: clearNow(town, kind, id), mark: null };
  let mark = clearMarkOf(town, kind, id);
  if (!mark) {
    const job = site(town, { kind, id });
    if (!job) return { check: refuse('Nothing to clear'), removed: false, mark: null };
    mark = { kind, id, serial: nextSerial++, done: 0, work: job.work, crew: [], wasAuto: [], callAt: town.time };
    clearMarks(town).push(mark);
  }
  town.commanded();
  for (const pid of ids) {
    const p = town.person(pid);
    if (p && p.clearing !== mark.serial) {
      for (const other of clearMarks(town)) if (other.crew.includes(pid)) release(town, other, pid);
      enlist(town, mark, p);
    }
  }
  if (!mark.crew.length) callFreeHands(town, mark);
  ++town.changes;
  return { check, removed: false, mark };
}
/** "Keep it": the mark is lifted and the crew go back to what they did before. */
export function keepClear(town: Town, kind: ClearKind, id: number): boolean {
  const mark = clearMarkOf(town, kind, id);
  if (!mark) return false;
  for (const pid of [...mark.crew]) release(town, mark, pid);
  marks.set(town, clearMarks(town).filter((m) => m !== mark));
  ++town.changes;
  return true;
}
function hammer(town: Town, p: Person, dt: number): void {
  const contact = workImpactBetween(workElapsed(town.time - dt, p.id), workElapsed(town.time, p.id), hammerTiming);
  if (contact === null) return;
  town.timberEvents.push({
    serial: town.nextTreeEvent++, kind: TreeWorkKind.Hammer, person: p.id,
    cell: Math.floor(p.position.y) * town.world.width() + Math.floor(p.position.x),
    index: 0, worker: { ...p.position }, at: contact - workElapsed(0, p.id),
  });
}
/** Runs once a tick: crews walk to the site, work it down and remove it. */
export function advanceClearing(town: Town, dt: number): void {
  const list = clearMarks(town);
  if (!list.length) return;
  for (const mark of [...list]) {
    if (!canClear(town, mark.kind, mark.id).ok) {
      keepClear(town, mark.kind, mark.id);
      continue;
    }
    for (const pid of [...mark.crew]) {
      const p = town.person(pid);
      if (!p || p.clearing !== mark.serial || !canControl(p, town.controlFaction)) {
        if (p?.clearing === mark.serial) p.clearing = -1;
        mark.crew = mark.crew.filter((other) => other !== pid);
        continue;
      }
      if (p.moving() || p.activity === Activity.Fighting) continue;
      const spot = mark.kind === 'road' ? closestOnRoad(town, mark, p) : spotFor(town, mark);
      if (!spot) continue;
      if (distance(p.position, spot) > reach && distance(p.position, p.goal) > f32(0.3)) {
        const target = town.grid.nearestWalkable(spot);
        if (!town.walkTo(p, target)) {
          release(town, mark, pid);
          continue;
        }
        p.goal = { ...(p.path.length ? p.path[p.path.length - 1] : p.position) };
        p.activity = Activity.Moving;
        continue;
      }
      // Standing at the site: tear it down.
      p.task = Activity.Holding;
      p.activity = Activity.Holding;
      p.until = town.time + 1;
      mark.done = Math.min(1, f32(mark.done + f32(f32(dt * workEfficiency(p, 'construction')) / mark.work)));
      hammer(town, p, dt);
    }
    if (mark.done >= 1) {
      keepClear(town, mark.kind, mark.id);
      clearNow(town, mark.kind, mark.id);
      continue;
    }
    if (!mark.crew.length && town.time >= mark.callAt) {
      mark.callAt = town.time + 2;
      callFreeHands(town, mark);
    }
  }
}
/** Names of the residents on the job, for the inspector. */
export function clearCrewNames(town: Town, mark: ClearMark): string[] {
  return mark.crew.map((id) => town.person(id)?.name ?? '').filter(Boolean);
}
export const clearTargetPoint = (town: Town, t: ClearTarget): Point => site(town, t)?.at ?? point();
