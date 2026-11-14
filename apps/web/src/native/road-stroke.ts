import { Town } from '../../../../packages/engine/src/town';
import { Structure } from '../../../../packages/engine/src/building-catalog';
import {
  add,
  distance,
  length,
  lerp,
  project,
  scale,
  sub,
  unproject,
  type Point,
} from '../../../../packages/engine/src/geometry';
import { f32 as f, clamp } from '../../../../packages/engine/src/numeric';
import { flatten, freehandRoad, sharpAnchor, type RoadPath } from '../../../../packages/engine/src/road-network';

/** A road gesture as the player made it. */
export interface RoadStroke {
  town: Town;
  /** World points sampled along the gesture, the press first. */
  stroke: readonly Point[];
  /** World point under the pointer now, and the pointer in screen pixels. */
  cursor: Point;
  mouse: Point;
  zoom: number;
  toScreen(world: Point): Point;
}
export const strokeRules = {
  /** Screen pixels a hand may waver without the road wavering with it. */
  fit: 8,
  /** Samples this close to either end are the press and release settling, not shape. */
  settle: 12,
  /** Screen pixels a stretch beside a road must run before a corner counts as leaving it. */
  stretch: 12,
  /** Tiles from a road's centre line within which the pointer is on that road. */
  onRoad: Town.roadHalfWidth,
  /** Screen pixels of stroke that tell which way it heads at an end. */
  heading: 28,
  /** Sine of the angle, as seen on screen, below which a stroke runs alongside a road and above which it heads into it. */
  alongside: 0.3,
  headOn: 0.6,
  /** Tiles a road keeps clear of a building it starts or ends at. */
  clearance: Town.roadHalfWidth - 0.08,
};

const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
const cosine = (a: Point, b: Point): number => {
  const product = length(a) * length(b);
  return product > 0 ? (a.x * b.x + a.y * b.y) / product : 1;
};
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Where a stroke that stops beside a road joins it. One heading into the road is carried on in a straight
 * line, one running alongside joins at the nearest point, and the two blend in between so that a small
 * change of angle never moves the junction far. */
function junction(from: Point, toward: Point, nearest: Point, tangent: Point, zoom: number): Point {
  const heading = sub(toward, from),
    seen = project(heading.x, heading.y),
    road = project(tangent.x, tangent.y),
    reach = length(seen) * zoom,
    turn = cross(heading, tangent);
  if (reach <= 0 || Math.abs(turn) < 1e-6) return nearest;
  const sine = Math.abs(cross(seen, road)) / (length(seen) * length(road)),
    share =
      smooth((sine - strokeRules.alongside) / (strokeRules.headOn - strokeRules.alongside)) *
      // A stroke only a few pixels long does not say where it is going yet.
      smooth((reach - strokeRules.settle) / (strokeRules.heading - strokeRules.settle));
  return lerp(nearest, add(from, scale(heading, cross(sub(nearest, from), tangent) / turn)), share);
}

/** Starts a stroke begun on a building at that building's edge; false when it began clear of one. */
function leaveBuilding(town: Town, list: Point[]): boolean {
  const hit = town
    .buildings()
    .find((b) => b.kind !== Structure.Torch && b.footprint().contains(list[0], strokeRules.clearance));
  if (!hit) return false;
  const inside = (p: Point) => hit.footprint().contains(p, strokeRules.clearance);
  let last = list[0];
  while (list.length > 1 && inside(list[0])) last = list.shift()!;
  if (inside(list[0])) return false;
  let a = last,
    b = list[0];
  for (let i = 0; i < 14; ++i) {
    const middle = lerp(a, b, 0.5);
    if (inside(middle)) a = middle;
    else b = middle;
  }
  list.unshift(b);
  return true;
}

/** Turns a hand-drawn gesture into the road the player meant. */
export function draftRoad(input: RoadStroke): RoadPath {
  const { town, cursor, mouse, toScreen, zoom } = input,
    roads = town.roads();
  if (!input.stroke.length) return [];
  let points = input.stroke.map((p) => ({ ...p }));
  const newest = points[points.length - 1];
  if (points.length > 1 && distance(toScreen(newest), mouse) < 3) points[points.length - 1] = { ...cursor };
  else if (newest.x !== cursor.x || newest.y !== cursor.y) points.push({ ...cursor });
  if (points.length < 2) return [];
  const tracing = (p: Point) => roads.distance(p).distance <= strokeRules.onRoad,
    // Sparse pointer events can land on existing roads while crossing new ground,
    // so the ground between two samples is checked as well.
    between = (a: Point, b: Point, test: (p: Point) => boolean) =>
      flatten([sharpAnchor(a), sharpAnchor(b)], f(0.2)).every(test);
  if (points.every((p, i) => tracing(p) && (!i || between(points[i - 1], p, tracing)))) return [];

  /** Index of the clear corner that ends a stretch drawn beside a road from the front of a stroke, or 0. */
  const turnsOff = (list: readonly Point[], road: number): number => {
    const px = list.map(toScreen),
      beside = (p: Point) => {
        const nearest = roads.distance(p);
        return nearest.distance <= Town.joinReach && nearest.id === road;
      },
      // Measured over a few pixels either side, so a trembling hand is not a corner.
      turn = (i: number) => {
        let a = i - 1,
          b = i + 1;
        while (a > 0 && distance(px[a], px[i]) < strokeRules.settle) --a;
        while (b + 1 < list.length && distance(px[b], px[i]) < strokeRules.settle) ++b;
        return cosine(sub(px[i], px[a]), sub(px[b], px[i]));
      };
    for (let i = 1; i + 1 < list.length; ++i) {
      if (!beside(list[i - 1]) || !beside(list[i]) || !between(list[i - 1], list[i], beside)) return 0;
      if (distance(px[i], px[0]) < strokeRules.stretch || turn(i) > Math.SQRT1_2) continue;
      let at = i,
        sharpest = turn(i),
        j = i + 1;
      for (; j + 1 < list.length && distance(px[j], px[i]) < strokeRules.settle; ++j) {
        const next = turn(j);
        if (next < sharpest) {
          sharpest = next;
          at = j;
        }
      }
      // Doubling back is an adjustment, and only a stretch that ran along the road was following it.
      const tangent = roads.distance(list[at]).tangent;
      if (
        sharpest >= -Math.SQRT1_2 &&
        beside(list[at]) &&
        tangent &&
        Math.abs(cosine(sub(list[at], list[0]), tangent)) >= Math.SQRT1_2
      )
        return at;
      i = j - 1;
    }
    return 0;
  };
  /** Where the front of a stroke begun beside a road joins it, after dropping what only follows existing roads. */
  const meetRoad = (list: Point[]): Point | null => {
    const beside = roads.distance(list[0]);
    if (beside.distance > Town.joinReach || beside.id === undefined) return null;
    const corner = turnsOff(list, beside.id);
    if (corner > 0) {
      list.splice(0, corner);
      return roads.distance(list[0]).onRoad ?? null;
    }
    while (list.length > 2 && tracing(list[0]) && tracing(list[1]) && between(list[0], list[1], tracing))
      list.shift();
    const nearest = roads.distance(list[0]);
    if (!nearest.onRoad || !nearest.tangent) return null;
    const from = toScreen(list[0]);
    let ahead = 1;
    while (ahead + 1 < list.length && distance(toScreen(list[ahead]), from) < strokeRules.heading) ++ahead;
    const meet = junction(list[0], list[ahead], nearest.onRoad, nearest.tangent, zoom);
    return roads.distance(meet).onRoad ?? nearest.onRoad;
  };
  // Each end keeps its samples as drawn and is eased onto where the road must begin
  // or end; replacing the end sample instead leaves a dog-leg beside every junction.
  const startAtBuilding = leaveBuilding(town, points),
    startTarget = points.length < 2 ? null : startAtBuilding ? { ...points[0] } : meetRoad(points);
  points.reverse();
  const endAtBuilding = leaveBuilding(town, points),
    endTarget = points.length < 2 ? null : endAtBuilding ? { ...points[0] } : meetRoad(points);
  points.reverse();
  if (points.length < 2) return [];

  const origin = points[0],
    screen = (p: Point) => {
      const delta = sub(p, origin);
      return scale(project(delta.x, delta.y), zoom);
    };
  const startAt = screen(startTarget ?? origin),
    endAt = screen(endTarget ?? points[points.length - 1]);
  points = points.map(screen);
  while (points.length > 2 && distance(points[1], points[0]) < strokeRules.settle) points.splice(1, 1);
  while (
    points.length > 2 &&
    distance(points[points.length - 2], points[points.length - 1]) < strokeRules.settle
  )
    points.splice(points.length - 2, 1);
  const startOffset = sub(startAt, points[0]),
    endOffset = sub(endAt, points[points.length - 1]);
  let total = 0;
  for (let i = 1; i < points.length; ++i) total = f(total + distance(points[i - 1], points[i]));
  if (total <= 0) return [];
  const blend = Math.min(total, Math.max(24, f(3 * Math.max(length(startOffset), length(endOffset)))));
  const weight = (along: number) => {
    const t = clamp(f(along / blend), 0, 1);
    return f(1 - f(f(t * t) * f(3 - f(2 * t))));
  };
  let walked = 0,
    previous = points[0];
  points = points.map((raw) => {
    walked = f(walked + distance(previous, raw));
    previous = raw;
    return add(add(raw, scale(startOffset, weight(walked))), scale(endOffset, weight(f(total - walked))));
  });
  const path = freehandRoad(points, strokeRules.fit);
  for (const anchor of path)
    for (const key of ['point', 'in', 'out'] as const) {
      const p = anchor[key];
      anchor[key] = add(origin, unproject(f(p.x / zoom), f(p.y / zoom)));
    }
  return path;
}
