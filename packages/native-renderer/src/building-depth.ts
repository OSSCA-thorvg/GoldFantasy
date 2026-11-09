import { f32 as f } from '../../engine/src/numeric';
import { FaceStyle, type Face, type Vertex, type Polygon } from './building-faces';
export interface DepthFragment {
  source: number;
  polygon: Polygon;
  line: boolean;
}
export interface DepthBatch {
  source: number;
  line: boolean;
  polygons: Polygon[];
}
const epsilon = 1e-5,
  maximumFragments = 65536,
  maximumWork = 16000000,
  maximumDepth = 256;
class Budget {
  fragments = 0;
  work = 0;
  fragment(): void {
    if (++this.fragments > maximumFragments) throw new RangeError('building depth fragment limit exceeded');
  }
  inspect(count: number): void {
    if ((this.work += count) > maximumWork) throw new RangeError('building depth work limit exceeded');
  }
}
class Plane {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly offset: number,
  ) {}
  distance(v: Vertex): number {
    return this.x * v.x + this.y * v.y + this.z * v.depth + this.offset;
  }
}
interface Node {
  plane: Plane;
  coplanar: DepthFragment[];
  back: Node | undefined;
  front: Node | undefined;
}
const cross = (a: Vertex, b: Vertex, c: Vertex) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function area(points: Polygon): number {
  let result = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    result += a.x * b.y - a.y * b.x;
  }
  return result * 0.5;
}
function hasArea(points: Polygon): boolean {
  if (points.length < 3) return false;
  let x0 = points[0].x,
    x1 = x0,
    y0 = points[0].y,
    y1 = y0;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  return Math.abs(area(points)) > epsilon * Math.max(1, f(f(f(x1 - x0) + y1) - y0));
}
function same(a: Vertex, b: Vertex): boolean {
  return (
    Math.abs(f(a.x - b.x)) < epsilon &&
    Math.abs(f(a.y - b.y)) < epsilon &&
    Math.abs(f(a.depth - b.depth)) < epsilon
  );
}
function append(points: Polygon, p: Vertex): void {
  if (!points.length || !same(points[points.length - 1], p)) points.push(p);
}
function clean(points: Polygon): void {
  if (points.length > 1 && same(points[0], points[points.length - 1])) points.pop();
}
function intersection(a: Vertex, b: Vertex, da: number, db: number): Vertex {
  const t = da / (da - db);
  return {
    x: f(a.x + (b.x - a.x) * t),
    y: f(a.y + (b.y - a.y) * t),
    depth: f(a.depth + (b.depth - a.depth) * t),
  };
}
function plane(fragment: DepthFragment): Plane | undefined {
  const p = fragment.polygon;
  if (fragment.line) {
    const a = p[0],
      b = p[p.length - 1],
      dx = b.x - a.x,
      dy = b.y - a.y,
      dd = b.depth - a.depth,
      length = dx * dx + dy * dy;
    if (length <= epsilon * epsilon) return new Plane(0, 0, 1, -Math.max(a.depth, b.depth));
    const x = (-dd * dx) / length,
      y = (-dd * dy) / length,
      norm = Math.sqrt(x * x + y * y + 1);
    return new Plane(x / norm, y / norm, 1 / norm, -(x * a.x + y * a.y + a.depth) / norm);
  }
  for (let i = 1; i + 1 < p.length; i++) {
    const ax = p[i].x - p[0].x,
      ay = p[i].y - p[0].y,
      az = p[i].depth - p[0].depth,
      bx = p[i + 1].x - p[0].x,
      by = p[i + 1].y - p[0].y,
      bz = p[i + 1].depth - p[0].depth;
    let x = ay * bz - az * by,
      y = az * bx - ax * bz,
      z = ax * by - ay * bx;
    if (Math.abs(z) <= epsilon) continue;
    const norm = Math.sqrt(x * x + y * y + z * z) * (z < 0 ? -1 : 1);
    x /= norm;
    y /= norm;
    z /= norm;
    return new Plane(x, y, z, -(x * p[0].x + y * p[0].y + z * p[0].depth));
  }
  return;
}
function side(points: Polygon, p: Plane, budget: Budget): number {
  budget.inspect(points.length);
  let result = 0;
  for (const point of points) {
    const distance = p.distance(point);
    if (distance < -epsilon) result |= 1;
    else if (distance > epsilon) result |= 2;
  }
  return result;
}
function split(input: DepthFragment, p: Plane, budget: Budget): [DepthFragment, DepthFragment] {
  const back: DepthFragment = { source: input.source, polygon: [], line: input.line },
    front: DepthFragment = { source: input.source, polygon: [], line: input.line },
    points = input.polygon,
    count = input.line ? points.length - 1 : points.length;
  for (let i = 0; i < count; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      da = p.distance(a),
      db = p.distance(b);
    if (da <= epsilon) append(back.polygon, a);
    if (da >= -epsilon) append(front.polygon, a);
    if ((da < -epsilon && db > epsilon) || (da > epsilon && db < -epsilon)) {
      const point = intersection(a, b, da, db);
      append(back.polygon, point);
      append(front.polygon, point);
    }
  }
  if (input.line) {
    const last = points[points.length - 1],
      distance = p.distance(last);
    if (distance <= epsilon) append(back.polygon, last);
    if (distance >= -epsilon) append(front.polygon, last);
  } else {
    clean(back.polygon);
    clean(front.polygon);
  }
  budget.fragment();
  return [back, front];
}
const valid = (fragment: DepthFragment) =>
  fragment.line
    ? fragment.polygon.length >= 2 &&
      !same(fragment.polygon[0], fragment.polygon[fragment.polygon.length - 1])
    : hasArea(fragment.polygon);
function partition(fragments: DepthFragment[], budget: Budget, depth: number): Node | undefined {
  if (!fragments.length) return;
  if (depth > maximumDepth) throw new RangeError('building depth tree limit exceeded');
  let chosen: Plane | undefined,
    chosenIndex = 0,
    best = Infinity;
  let candidates = fragments.flatMap((fragment, i) => (fragment.line ? [] : [i]));
  if (!candidates.length) candidates = fragments.map((_, i) => i);
  const attempts = Math.min(8, candidates.length);
  for (let sample = 0; sample < attempts; sample++) {
    const index = candidates[Math.trunc((sample * candidates.length) / attempts)],
      candidate = plane(fragments[index]);
    if (!candidate) continue;
    let back = 0,
      front = 0,
      crossing = 0;
    for (const fragment of fragments) {
      const classification = side(fragment.polygon, candidate, budget);
      back += Number(classification === 1);
      front += Number(classification === 2);
      crossing += Number(classification === 3);
    }
    const score = crossing * 8 + (back > front ? back - front : front - back);
    if (score < best) {
      best = score;
      chosen = candidate;
      chosenIndex = index;
    }
    if (!score) break;
  }
  if (!chosen) throw new Error('building depth geometry has no valid plane');
  const node: Node = { plane: chosen, coplanar: [], back: undefined, front: undefined },
    back: DepthFragment[] = [],
    front: DepthFragment[] = [];
  for (let i = 0; i < fragments.length; i++) {
    const fragment = fragments[i];
    switch (i === chosenIndex ? 0 : side(fragment.polygon, node.plane, budget)) {
      case 0:
        node.coplanar.push(fragment);
        break;
      case 1:
        back.push(fragment);
        break;
      case 2:
        front.push(fragment);
        break;
      case 3: {
        const pieces = split(fragment, node.plane, budget);
        if (valid(pieces[0])) back.push(pieces[0]);
        if (valid(pieces[1])) front.push(pieces[1]);
        break;
      }
    }
  }
  node.coplanar.sort((a, b) =>
    a.source !== b.source ? a.source - b.source : Number(a.line) - Number(b.line),
  );
  node.back = partition(back, budget, depth + 1);
  node.front = partition(front, budget, depth + 1);
  return node;
}
function traverse(node: Node | undefined, output: DepthFragment[]): void {
  if (!node) return;
  traverse(node.back, output);
  output.push(...node.coplanar);
  traverse(node.front, output);
}
function fills(input: Polygon, source: number, output: DepthFragment[], budget: Budget): void {
  const points = [...input];
  clean(points);
  if (!hasArea(points)) return;
  const direction = area(points) > 0 ? 1 : -1;
  let convex = true;
  for (let i = 0; i < points.length; i++)
    if (
      cross(points[i], points[(i + 1) % points.length], points[(i + 2) % points.length]) * direction <
      -epsilon
    )
      convex = false;
  if (convex) {
    budget.fragment();
    output.push({ source, polygon: points, line: false });
    return;
  }
  while (points.length > 3) {
    let removed = false;
    for (let i = 0; i < points.length; i++) {
      const prev = (i + points.length - 1) % points.length,
        next = (i + 1) % points.length,
        a = points[prev],
        b = points[i],
        c = points[next];
      if (cross(a, b, c) * direction <= epsilon) continue;
      let occupied = false;
      for (let j = 0; j < points.length; j++)
        if (j !== prev && j !== i && j !== next) {
          budget.inspect(1);
          const p = points[j];
          if (
            cross(a, b, p) * direction >= -epsilon &&
            cross(b, c, p) * direction >= -epsilon &&
            cross(c, a, p) * direction >= -epsilon
          ) {
            occupied = true;
            break;
          }
        }
      if (occupied) continue;
      budget.fragment();
      output.push({ source, polygon: [a, b, c], line: false });
      points.splice(i, 1);
      removed = true;
      break;
    }
    if (!removed) throw new Error('building depth face is not a simple polygon');
  }
  budget.fragment();
  output.push({ source, polygon: points, line: false });
}
export function faceOpacity(face: Face, frame: number): number {
  if (!face.opacity.length) return 100;
  if (frame <= face.opacity[0][0]) return face.opacity[0][1];
  for (let i = 1; i < face.opacity.length; i++)
    if (frame < face.opacity[i][0]) {
      const [a, first] = face.opacity[i - 1],
        [b, last] = face.opacity[i];
      return f(first + f(f(f(last - first) * f(frame - a)) / f(b - a)));
    }
  return face.opacity[face.opacity.length - 1][1];
}
function halfspace(a: number, b: number, range: { low: number; high: number }): boolean {
  if (a >= 0 && b >= 0) return true;
  if (a < 0 && b < 0) return false;
  const crossing = a / (a - b);
  if (a < 0) range.low = Math.max(range.low, crossing);
  else range.high = Math.min(range.high, crossing);
  return range.high > range.low;
}
function visibleLines(input: DepthFragment[], faces: Face[], frame: number, budget: Budget): DepthFragment[] {
  const occluders: {
    polygon: Polygon;
    plane: Plane;
    source: number;
    direction: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }[] = [];
  for (const fragment of input)
    if (!fragment.line && faceOpacity(faces[fragment.source], frame) >= 100 - epsilon) {
      const surface = plane(fragment);
      if (!surface) continue;
      const p = fragment.polygon[0],
        cover = {
          polygon: fragment.polygon,
          plane: surface,
          source: fragment.source,
          direction: area(fragment.polygon) > 0 ? 1 : -1,
          x0: p.x,
          y0: p.y,
          x1: p.x,
          y1: p.y,
        };
      for (const p of fragment.polygon) {
        cover.x0 = Math.min(cover.x0, p.x);
        cover.y0 = Math.min(cover.y0, p.y);
        cover.x1 = Math.max(cover.x1, p.x);
        cover.y1 = Math.max(cover.y1, p.y);
      }
      occluders.push(cover);
    }
  const output: DepthFragment[] = [];
  for (const fragment of input) {
    if (!fragment.line) {
      output.push(fragment);
      continue;
    }
    const a = fragment.polygon[0],
      b = fragment.polygon[fragment.polygon.length - 1];
    let intervals: [number, number][] = [[0, 1]];
    for (const cover of occluders) {
      if (
        cover.source === fragment.source ||
        Math.max(a.x, b.x) < cover.x0 ||
        Math.min(a.x, b.x) > cover.x1 ||
        Math.max(a.y, b.y) < cover.y0 ||
        Math.min(a.y, b.y) > cover.y1
      )
        continue;
      budget.inspect(cover.polygon.length + 1);
      const range = { low: 0, high: 1 };
      if (!halfspace(-cover.plane.distance(a) - epsilon, -cover.plane.distance(b) - epsilon, range)) continue;
      let intersects = true;
      for (let i = 0; i < cover.polygon.length; i++) {
        const p = cover.polygon[i],
          q = cover.polygon[(i + 1) % cover.polygon.length];
        if (!halfspace(cross(p, q, a) * cover.direction, cross(p, q, b) * cover.direction, range)) {
          intersects = false;
          break;
        }
      }
      const { low, high } = range;
      if (!intersects || high - low < epsilon) continue;
      const kept: [number, number][] = [];
      for (const [from, to] of intervals) {
        if (high <= from || low >= to) kept.push([from, to]);
        else {
          if (low > from + epsilon) kept.push([from, low]);
          if (high < to - epsilon) kept.push([high, to]);
        }
      }
      intervals = kept;
      if (!intervals.length) break;
    }
    const point = (t: number): Vertex => ({
      x: f(a.x + (b.x - a.x) * t),
      y: f(a.y + (b.y - a.y) * t),
      depth: f(a.depth + (b.depth - a.depth) * t),
    });
    for (let i = 0; i < intervals.length; i++) {
      if (i) budget.fragment();
      const [from, to] = intervals[i];
      output.push({ source: fragment.source, polygon: [point(from), point(to)], line: true });
    }
  }
  return output;
}
export function depthOrder(faces: Face[], frame: number): DepthFragment[] {
  frame = f(frame);
  if (!Number.isFinite(frame)) throw new Error('building depth frame must be finite');
  const budget = new Budget(),
    input: DepthFragment[] = [];
  for (let source = 0; source < faces.length; source++) {
    const face = faces[source];
    if (faceOpacity(face, frame) <= 0) continue;
    const points = face.shape(frame);
    budget.inspect(points.length);
    for (const p of points)
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.depth))
        throw new Error('building depth vertex must be finite');
    if (face.style !== FaceStyle.Line) fills(points, source, input, budget);
    if (face.style !== FaceStyle.Filled && points.length >= 2) {
      const count = face.style === FaceStyle.Line ? points.length - 1 : points.length;
      for (let i = 0; i < count; i++) {
        const a = points[i],
          b = points[(i + 1) % points.length];
        if (!same(a, b)) {
          budget.fragment();
          input.push({ source, polygon: [a, b], line: true });
        }
      }
    }
  }
  const tree = partition(visibleLines(input, faces, frame, budget), budget, 0),
    output: DepthFragment[] = [];
  traverse(tree, output);
  return output;
}
export function depthBatches(faces: Face[], frame: number): DepthBatch[] {
  const fragments = depthOrder(faces, frame),
    batches: DepthBatch[] = [];
  for (const fragment of fragments) {
    let batch = batches[batches.length - 1];
    if (!batch || batch.source !== fragment.source || batch.line !== fragment.line) {
      batch = { source: fragment.source, line: fragment.line, polygons: [] };
      batches.push(batch);
    }
    batch.polygons.push(fragment.polygon);
  }
  return batches;
}
