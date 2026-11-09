import type { Footprint, Point } from './geometry';

/** Only the small square under a resident's feet participates in collision. */
export const footBounds = { halfX: 0.04, halfY: 0.04, epsilon: 1e-5 } as const;

export function footBoxesOverlap(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) < footBounds.halfX * 2 - footBounds.epsilon &&
    Math.abs(a.y - b.y) < footBounds.halfY * 2 - footBounds.epsilon
  );
}

/** Four separating axes describe the Minkowski sum of a foot box and a wall. */
const axesCache = new WeakMap<
  Footprint,
  { half: number; angle: number; axes: readonly [number, number, number][] }
>();
function wallAxes(wall: Footprint): readonly [number, number, number][] {
  const cached = axesCache.get(wall);
  if (cached?.half === wall.half && cached.angle === wall.angle) return cached.axes;
  const c = Math.cos(wall.angle),
    s = Math.sin(wall.angle),
    radius = wall.half * (Math.abs(c) + Math.abs(s));
  const axes: readonly [number, number, number][] = [
    [1, 0, radius + footBounds.halfX],
    [0, 1, radius + footBounds.halfY],
    [c, s, wall.half + footBounds.halfX * Math.abs(c) + footBounds.halfY * Math.abs(s)],
    [-s, c, wall.half + footBounds.halfX * Math.abs(s) + footBounds.halfY * Math.abs(c)],
  ];
  axesCache.set(wall, { half: wall.half, angle: wall.angle, axes });
  return axes;
}

export function footBlockedBy(at: Point, wall: Footprint): boolean {
  if (wall.half <= 0) return false;
  const x = at.x - wall.center.x,
    y = at.y - wall.center.y;
  const broad = wall.half * Math.SQRT2 + Math.max(footBounds.halfX, footBounds.halfY);
  if (Math.abs(x) > broad || Math.abs(y) > broad) return false;
  return wallAxes(wall).every(([nx, ny, radius]) => Math.abs(x * nx + y * ny) < radius - footBounds.epsilon);
}

/** Sweep the foot box, rather than just its center, without rasterizing a whole tile. */
export function footSegmentBlockedBy(a: Point, b: Point, wall: Footprint): boolean {
  if (wall.half <= 0) return false;
  const x = a.x - wall.center.x,
    y = a.y - wall.center.y,
    dx = b.x - a.x,
    dy = b.y - a.y;
  const broad = wall.half * Math.SQRT2 + Math.max(footBounds.halfX, footBounds.halfY);
  if (
    Math.max(a.x, b.x) < wall.center.x - broad ||
    Math.min(a.x, b.x) > wall.center.x + broad ||
    Math.max(a.y, b.y) < wall.center.y - broad ||
    Math.min(a.y, b.y) > wall.center.y + broad
  )
    return false;
  let enter = 0,
    leave = 1;
  for (const [nx, ny, extent] of wallAxes(wall)) {
    const radius = extent - footBounds.epsilon,
      origin = x * nx + y * ny,
      delta = dx * nx + dy * ny;
    if (Math.abs(delta) < 1e-12) {
      if (Math.abs(origin) >= radius) return false;
      continue;
    }
    let first = (-radius - origin) / delta,
      last = (radius - origin) / delta;
    if (first > last) [first, last] = [last, first];
    enter = Math.max(enter, first);
    leave = Math.min(leave, last);
    if (enter > leave) return false;
  }
  return enter <= leave;
}

/** Minimal lateral translation which separates two overlapping foot boxes. */
export function footSeparation(delta: Point, direction: Point): number {
  let required = Infinity;
  for (const [value, velocity, span] of [
    [delta.x, direction.x, footBounds.halfX * 2],
    [delta.y, direction.y, footBounds.halfY * 2],
  ]) {
    if (Math.abs(velocity) < 1e-12) continue;
    required = Math.min(required, ((velocity > 0 ? span : -span) - value) / velocity);
  }
  return Math.max(0, required);
}
