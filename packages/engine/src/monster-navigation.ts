import type { TownState } from './town-state';
import type { Monster } from './person';
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
  const beasts = town.beasts.filter(beast => beast.health > 0 && !beast.insideLair && !beast.giant());
  const shifts = beasts.map(() => point());
  for (let i = 0; i < beasts.length; ++i)
    for (let j = i + 1; j < beasts.length; ++j) {
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
