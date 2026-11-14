import type { TownState } from './town-state';
import type { Monster, Person } from './person';
import type { RealmArea } from './realm-layout';
import type { FlowField } from './combat-state';
import { PairMinHeap } from './priority-queue';
import { MonsterRank } from './combat-events';
import type { Building } from './town-models';
import { Structure, isSeat } from './building-catalog';
import { add, distance, point, rotated, scale, sub, type Point } from './geometry';
import { f32 as f } from './numeric';

const attackReach = f(0.7);
const spacing = f(0.6);
// Stable variation does not consume the simulation's gameplay random stream.
function variation(a: number, b: number): number {
  let bits = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b);
  bits ^= bits >>> 16;
  bits = Math.imul(bits, 0x7feb352d);
  bits ^= bits >>> 15;
  return (bits >>> 0) / 4294967296;
}
function attackPoints(building: Building): Point[] {
  const footprint = building.footprint(), extent = f(footprint.half + f(0.65));
  const count = Math.max(3, Math.ceil(2 * extent / spacing)), points: Point[] = [];
  for (let side = 0; side < 4; ++side)
    for (let slot = 0; slot < count; ++slot) {
      const along = f(-extent + slot * 2 * extent / count);
      const local = side === 0 ? point(along, extent) : side === 1 ? point(extent, -along)
        : side === 2 ? point(-along, -extent) : point(-extent, along);
      points.push(add(building.center, rotated(local, building.angle)));
    }
  return points;
}
function approach(town: TownState, beast: Monster, target: Building): Point[] | null {
  const reservations = town.beasts.filter(other => other !== beast && other.health > 0 &&
    other.raider && other.prey === target.id).map(other => other.path.at(-1) ?? other.position);
  const candidates = attackPoints(target).map((at, index) => {
    let crowd = 0;
    for (const taken of reservations) crowd += Math.max(0, 1 - distance(at, taken) / spacing) * 12;
    return { at, score: distance(beast.position, at) + crowd + variation(beast.id, index) * 0.35 };
  }).filter(candidate => town.grid.walkable(candidate.at));
  candidates.sort((a, b) => a.score - b.score);
  for (const { at } of candidates) {
    if (distance(beast.position, at) < f(0.02)) return [];
    const path = town.grid.clear(beast.position, at, Infinity)
      ? [{ ...beast.position }, at] : town.grid.path(beast.position, at);
    if (path.length) return path;
  }
  return null;
}
function useful(target: Building): boolean {
  return target.kind !== Structure.Torch && (!isSeat(target.kind) || target.health > f(0.1));
}

/** Keep the chosen building and perimeter slot until they become unavailable. */
export function planRaiderApproach(town: TownState, beast: Monster): void {
  const chosen = town.building(beast.prey);
  const end = beast.path.at(-1);
  const sharedEnd = end && town.beasts.some(other => other !== beast && other.health > 0 &&
    other.raider && other.id < beast.id && other.prey === beast.prey &&
    distance(end, other.path.at(-1) ?? other.position) < f(0.05));
  const valid = !!chosen && !sharedEnd && (!end
    ? chosen.footprint().contains(beast.position, attackReach)
    : chosen.footprint().contains(end, attackReach) && town.grid.walkable(end) &&
      town.grid.clear(beast.position, beast.path[0], Infinity));
  if (chosen) {
    // The Camp's existing minimum health still applies. Once reached, prefer
    // other damageable buildings, retaining the Camp if none can be reached.
    const seekAnother = !useful(chosen) && town.time >= beast.ready &&
      town.placed.some(building => building.id !== chosen.id && useful(building));
    if (!seekAnother && valid) return;
  }
  const candidates = town.placed.slice().sort((a, b) => {
    if (a.id === chosen?.id && useful(a)) return -1;
    if (b.id === chosen?.id && useful(b)) return 1;
    return Number(useful(b)) - Number(useful(a)) ||
      distance(a.center, beast.position) - distance(b.center, beast.position) || a.id - b.id;
  });
  for (const target of candidates) {
    if (target === chosen && valid) return;
    const path = approach(town, beast, target);
    if (path === null) continue;
    beast.prey = target.id;
    beast.path = path;
    return;
  }
  beast.prey = -1;
  beast.path = [];
}

/** A simultaneous, bounded displacement avoids order-dependent pushes or snaps. */
export function separateMonsters(town: TownState, dt: number): void {
  // Sorted along x, only neighbours within `spacing` are compared: a swarm stays cheap.
  const beasts = town.beasts.filter(beast => beast.health > 0 && !beast.insideLair && !beast.giant())
    .sort((a, b) => a.position.x - b.position.x || a.id - b.id);
  const shifts = beasts.map(() => point());
  for (let i = 0; i < beasts.length; ++i)
    for (let j = i + 1; j < beasts.length && beasts[j].position.x - beasts[i].position.x < spacing; ++j) {
      const delta = sub(beasts[i].position, beasts[j].position), gap = distance(point(), delta);
      if (gap >= spacing) continue;
      // IDs give coincident spawns a stable, opposite escape direction.
      const direction = gap > f(0.001) ? scale(delta, f(1 / gap))
        : rotated(point(beasts[i].id < beasts[j].id ? 1 : -1, 0),
          f(variation(Math.min(beasts[i].id, beasts[j].id), Math.max(beasts[i].id, beasts[j].id)) * Math.PI * 2));
      const push = scale(direction, Math.min(f((spacing - gap) * 0.5), f(dt * 0.35)));
      shifts[i] = add(shifts[i], push);
      shifts[j] = sub(shifts[j], push);
    }
  for (let i = 0; i < beasts.length; ++i) {
    if (beasts[i].rank === MonsterRank.Den) continue;
    const amount = distance(point(), shifts[i]);
    if (amount < f(0.001)) continue;
    const shift = scale(shifts[i], Math.min(1, f(dt * 0.35 / amount)));
    const at = add(beasts[i].position, shift);
    const target = beasts[i].raider && !beasts[i].path.length ? town.building(beasts[i].prey) : null;
    // An attacker already in place must not be pushed out of reach and forced
    // to plan its approach again on the next tick.
    if (target?.footprint().contains(beasts[i].position, attackReach) &&
      !target.footprint().contains(at, attackReach)) continue;
    if (town.grid.walkable(at) && town.grid.clear(beasts[i].position, at, Infinity))
      beasts[i].position = at;
  }
}

const flowAge = 0.4;
/** Cells along a route a hunting monster looks ahead for a waypoint it can walk to straight. */
const lookAhead = 5;
const steerPause = 0.3;
const neighbours = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
/** Walking distance to the prey's tile from every tile of `area`, shared by all who hunt it and kept a moment. */
export function flowTo(town: TownState, area: RealmArea, prey: Person): FlowField | null {
  const x = Math.floor(prey.position.x) - area.x,
    y = Math.floor(prey.position.y) - area.y;
  if (x < 0 || y < 0 || x >= area.size || y >= area.size) return null;
  const cell = y * area.size + x,
    cached = town.combatState.flows.get(prey.id);
  if (
    cached &&
    cached.distance.length === area.size * area.size &&
    (cached.cell === cell || town.time - cached.at < flowAge) &&
    town.time >= cached.at
  )
    return cached;
  const grid = town.grid,
    size = area.size,
    field = cached?.distance.length === size * size ? cached.distance : new Float32Array(size * size),
    open = new PairMinHeap(),
    cost = (cx: number, cy: number) => grid.cost(cx + area.x, cy + area.y);
  field.fill(Infinity);
  field[cell] = 0;
  open.push([0, cell]);
  while (!open.empty()) {
    const [d, n] = open.pop();
    if (d > field[n]) continue;
    const cx = n % size,
      cy = (n - cx) / size;
    for (const [dx, dy] of neighbours) {
      const nx = cx + dx,
        ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size || cost(nx, ny) <= 0) continue;
      if (dx && dy && (cost(cx + dx, cy) <= 0 || cost(cx, cy + dy) <= 0)) continue;
      const next = d + ((dx && dy ? 1.4142 : 1) * (cost(cx, cy) + cost(nx, ny))) / 2,
        m = ny * size + nx;
      if (next < field[m]) {
        field[m] = next;
        open.push([next, m]);
      }
    }
  }
  const flow = { cell, at: town.time, distance: field };
  town.combatState.flows.set(prey.id, flow);
  return flow;
}
/** The farthest tile down the route that can be walked to straight from where the monster stands. */
function waypoint(town: TownState, area: RealmArea, field: FlowField, from: Point): Point | null {
  const size = area.size;
  let x = Math.floor(from.x) - area.x,
    y = Math.floor(from.y) - area.y;
  if (x < 0 || y < 0 || x >= size || y >= size || !Number.isFinite(field.distance[y * size + x])) return null;
  const cells: Point[] = [];
  for (let i = 0; i < lookAhead; ++i) {
    let best = field.distance[y * size + x],
      bx = -1,
      by = -1;
    for (const [dx, dy] of neighbours) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (dx && dy && (!Number.isFinite(field.distance[y * size + nx]) || !Number.isFinite(field.distance[ny * size + x])))
        continue;
      const d = field.distance[ny * size + nx];
      if (d < best) {
        best = d;
        bx = nx;
        by = ny;
      }
    }
    if (bx < 0) break;
    x = bx;
    y = by;
    cells.push(point(x + area.x + 0.5, y + area.y + 0.5));
  }
  for (let i = cells.length - 1; i > 0; --i) if (town.grid.clear(from, cells[i], Infinity)) return cells[i];
  return cells[0] ?? null;
}
/** Moves a hunting monster up to `step` toward `goal`: straight while it sees it in the open, otherwise down the
 * shared route to its prey; the way is looked for again on a timer, never every tick. */
export function huntStep(
  town: TownState,
  beast: Monster,
  goal: Point,
  area: RealmArea | null,
  prey: Person | null,
  step: number,
): void {
  const steering = town.combatState.steering,
    way = steering.get(beast.id);
  if (!way || town.time >= way.at || !beast.path.length) {
    const direct = town.grid.clear(beast.position, goal, Infinity);
    let path: Point[] = [];
    if (direct) path = [{ ...goal }];
    else {
      const field = area && prey ? flowTo(town, area, prey) : null,
        next = field ? waypoint(town, area!, field, beast.position) : null;
      path = next ? [next] : town.grid.path(beast.position, goal).slice(1);
    }
    beast.path = path;
    // Spread out the looks so a swarm does not search all on one tick.
    steering.set(beast.id, { at: town.time + steerPause + (beast.id % 7) * 0.03, direct });
  } else if (way.direct) beast.path = [{ ...goal }];
  walkPath(beast, step);
}
/** Walks a monster along its path. */
export function walkPath(beast: Monster, step: number): void {
  while (step > 0 && beast.path.length) {
    const target = beast.path[0],
      gap = distance(beast.position, target);
    if (gap <= step) {
      beast.position = { ...target };
      beast.path.shift();
      step = f(step - gap);
    } else {
      beast.position = add(beast.position, scale(sub(target, beast.position), f(step / gap)));
      step = 0;
    }
  }
}
