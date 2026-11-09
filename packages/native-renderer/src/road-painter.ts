import { add, sub, scale, normalized, distance, lerp, type Point } from '../../engine/src/geometry';
import { fractalNoise } from '../../engine/src/world-map';
import { Terrain } from '../../engine/src/world-types';
import { ShapeNode, SceneNode, type Rgb, type Rgba } from './paint';
import { fill, opaque } from './vector-paint';
const f = Math.fround;
export interface RoadAnchor {
  point: Point;
  in: Point;
  out: Point;
}
export type RoadPath = RoadAnchor[];
export interface RenderRoad {
  id: number;
  line: Point[];
  built: number;
  paved: boolean;
  paving: number;
  wear: number;
  length(): number;
  laidBegin(): number;
  laidEnd(): number;
}
export interface RenderRoadNetwork {
  roads(): readonly RenderRoad[];
}
const dirt: Rgb = [88, 72, 52],
  cobble: Rgb = [98, 94, 92],
  cobbleJoint: Rgb = [66, 62, 62];
export function appendRoad(shape: ShapeNode, path: RoadPath): void {
  if (!path.length) return;
  shape.moveTo(path[0].point.x, path[0].point.y);
  for (let i = 1; i < path.length; i++)
    shape.cubicTo(
      path[i - 1].out.x,
      path[i - 1].out.y,
      path[i].in.x,
      path[i].in.y,
      path[i].point.x,
      path[i].point.y,
    );
}
export function roadStrokes(scene: SceneNode, paths: RoadPath[], alpha: number, surface: Rgb = dirt): void {
  const shape = new ShapeNode();
  for (const path of paths) appendRoad(shape, path);
  shape
    .strokeWidth(f(0.46))
    .strokeCap('round')
    .strokeJoin('round')
    .strokeFill(...surface, alpha);
  scene.add(shape);
}
export function wornCourse(road: RenderRoad): Point[] {
  const out: Point[] = [],
    total = road.length(),
    sway = road.paved ? f(0.05) : f(0.16);
  let walked = 0;
  for (let i = 0; i < road.line.length; i++) {
    if (i) walked = f(walked + distance(road.line[i - 1], road.line[i]));
    const ahead = normalized(sub(road.line[Math.min(i + 1, road.line.length - 1)], road.line[i ? i - 1 : 0])),
      taper = Math.min(1, f(walked / f(1.2)), f(f(total - walked) / f(1.2)));
    const offset = f(
      f(
        f(f(fractalNoise((19 + Math.imul(road.id, 31)) >>> 0, f(walked * f(0.55)), f(1.7)) - f(0.5)) * 2) *
          sway,
      ) * taper,
    );
    out.push(add(road.line[i], scale({ x: -ahead.y, y: ahead.x }, offset)));
  }
  return out;
}
export function stretch(course: Point[], share: number, fromStart: boolean): Point[] {
  if (!course.length) return [];
  if (share <= 0) return fromStart ? [course[0]] : [...course];
  if (share >= 1) return fromStart ? [...course] : [course[course.length - 1]];
  let total = 0;
  for (let i = 1; i < course.length; i++) total = f(total + distance(course[i - 1], course[i]));
  const cut = f(total * Math.max(0, Math.min(1, share))),
    head: Point[] = [course[0]],
    tail: Point[] = [];
  let walked = 0;
  for (let i = 1; i < course.length; i++) {
    const leg = distance(course[i - 1], course[i]);
    if (f(walked + leg) < cut) head.push(course[i]);
    else if (walked < cut) {
      const mid = lerp(course[i - 1], course[i], f(f(cut - walked) / leg));
      head.push(mid);
      tail.push(mid);
      tail.push(course[i]);
    } else tail.push(course[i]);
    walked = f(walked + leg);
  }
  if (!tail.length) tail.push(course[course.length - 1]);
  return fromStart ? head : tail;
}
export function appendLine(shape: ShapeNode, points: Point[]): void {
  if (points.length < 2) return;
  shape.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i].x, points[i].y);
}
export function paintRoads(
  scene: SceneNode,
  network: RenderRoadNetwork,
  map: { terrainAt(point: Point): Terrain },
): void {
  const worn = new ShapeNode(),
    stone = new ShapeNode(),
    joints = new ShapeNode(),
    plans = new ShapeNode(),
    torn = new ShapeNode(),
    spans: Point[][] = [];
  for (const road of network.roads()) {
    const course = wornCourse(road);
    let laid = stretch(course, road.laidEnd(), true);
    if (road.laidEnd() > 0) laid = stretch(laid, f(road.laidBegin() / road.laidEnd()), false);
    if (road.built <= 0) laid = [];
    const pavedShare = road.paved ? 1 : road.paving >= 0 ? road.paving : 0;
    if (road.wear >= 1) appendLine(torn, laid);
    else appendLine(worn, stretch(laid, pavedShare, false));
    if (pavedShare > 0 && road.wear < 1) {
      appendLine(stone, stretch(course, pavedShare, true));
      appendLine(joints, stretch(course, pavedShare, true));
    }
    if (road.laidBegin() > 0) appendLine(plans, stretch(course, road.laidBegin(), true));
    if (road.laidEnd() < 1) appendLine(plans, stretch(course, road.laidEnd(), false));
    let run: Point[] = [];
    const close = () => {
      if (run.length >= 2) spans.push(run);
      run = [];
    };
    for (let i = 0; i < laid.length; i++) {
      const wet = map.terrainAt(laid[i]) === Terrain.Water;
      if (wet && !run.length && i) run.push(laid[i - 1]);
      if (wet || run.length) run.push(laid[i]);
      if (!wet && run.length > 1) close();
    }
    close();
  }
  const style = (shape: ShapeNode, width: number, color: Rgba) => {
    shape
      .strokeWidth(f(width))
      .strokeCap('round')
      .strokeJoin('round')
      .strokeFill(...color);
    scene.add(shape);
  };
  style(worn, 0.46, opaque(dirt));
  style(stone, 0.5, opaque(cobble));
  joints.strokeDash([f(0.07), f(0.1)]);
  style(joints, 0.36, opaque(cobbleJoint));
  torn.strokeDash([f(0.3), f(0.22)]);
  style(torn, 0.4, [98, 76, 52, 200]);
  plans.strokeDash([f(0.22), f(0.16)]);
  style(plans, 0.07, [214, 186, 120, 190]);
  const shadow = new ShapeNode(),
    deck = new ShapeNode(),
    planks = new ShapeNode(),
    rails = new ShapeNode(),
    posts = new ShapeNode();
  for (const span of spans) {
    const sunk: Point[] = [],
      left: Point[] = [],
      right: Point[] = [];
    for (let i = 0; i < span.length; i++) {
      const ahead = normalized(sub(span[Math.min(i + 1, span.length - 1)], span[i ? i - 1 : 0])),
        side = { x: f(-ahead.y * f(0.27)), y: f(ahead.x * f(0.27)) };
      sunk.push(add(span[i], { x: f(0.12), y: f(0.12) }));
      left.push(add(span[i], side));
      right.push(sub(span[i], side));
    }
    appendLine(shadow, sunk);
    appendLine(deck, span);
    appendLine(planks, span);
    appendLine(rails, left);
    appendLine(rails, right);
    let walked = 0,
      next = 0;
    for (let i = 0; i < span.length; i++) {
      if (i) walked = f(walked + distance(span[i - 1], span[i]));
      if (walked < next) continue;
      next = f(walked + f(0.7));
      for (const p of [left[i], right[i]]) posts.appendCircle(p.x, p.y, f(0.08), f(0.08));
    }
  }
  const plank = (shape: ShapeNode, width: number, color: Rgba) => {
    shape
      .strokeWidth(f(width))
      .strokeCap('butt')
      .strokeJoin('round')
      .strokeFill(...color);
    scene.add(shape);
  };
  plank(shadow, 0.62, [6, 10, 16, 140]);
  plank(deck, 0.52, opaque([132, 98, 64]));
  planks.strokeDash([f(0.035), f(0.07)]);
  plank(planks, 0.5, opaque([88, 62, 40]));
  style(rails, 0.08, opaque([74, 52, 34]));
  fill(posts, opaque([54, 38, 26]));
  scene.add(posts);
}
