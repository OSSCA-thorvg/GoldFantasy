import { clamp, f32 } from './numeric';
export interface Point { x: number; y: number; }
export type Outline = Point[];
export const point = (x = 0, y = 0): Point => ({ x: f32(x), y: f32(y) });
export const add = (a: Point, b: Point): Point => point(f32(a.x + b.x), f32(a.y + b.y));
export const sub = (a: Point, b: Point): Point => point(f32(a.x - b.x), f32(a.y - b.y));
export const scale = (a: Point, k: number): Point => point(f32(a.x * k), f32(a.y * k));
export const length = (p: Point): number => f32(Math.hypot(p.x, p.y));
export const distance = (a: Point, b: Point): number => length(sub(a, b));
export const normalized = (p: Point): Point => { const l = length(p); return l > f32(1e-6) ? scale(p, f32(1 / l)) : point(1, 0); };
export const lerp = (a: Point, b: Point, t: number): Point => add(a, scale(sub(b, a), t));
export function rotated(p: Point, angle: number): Point { const c = f32(Math.cos(angle)), s = f32(Math.sin(angle)); return point(f32(f32(p.x * c) - f32(p.y * s)), f32(f32(p.x * s) + f32(p.y * c))); }
export function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const d = sub(b, a), l = f32(f32(d.x * d.x) + f32(d.y * d.y));
  const t = l > 0 ? clamp(f32(f32(f32(f32(p.x - a.x) * d.x) + f32(f32(p.y - a.y) * d.y)) / l), 0, 1) : 0;
  return lerp(a, b, t);
}
export const segmentDistance = (p: Point, a: Point, b: Point): number => distance(p, closestOnSegment(p, a, b));
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point): number => f32(f32(f32(q.x - p.x) * f32(r.y - p.y)) - f32(f32(q.y - p.y) * f32(r.x - p.x)));
  const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}
export class Camera {
  constructor(public x = 0, public y = 0, public zoom = 1) {}
  toScreen(world: Point, width: number, height: number): Point { return point(f32(f32(f32(world.x - this.x) * this.zoom) + f32(width / 2)), f32(f32(f32(world.y - this.y) * this.zoom) + f32(height / 2))); }
  toWorld(screen: Point, width: number, height: number): Point { return point(f32(f32(f32(screen.x - f32(width / 2)) / this.zoom) + this.x), f32(f32(f32(screen.y - f32(height / 2)) / this.zoom) + this.y)); }
}
export class Footprint {
  constructor(public center: Point = point(), public half = .5, public angle = 0) {}
  corners(): Outline { return [point(-this.half, -this.half), point(this.half, -this.half), point(this.half, this.half), point(-this.half, this.half)].map(p => add(this.center, rotated(p, this.angle))); }
  contains(p: Point, margin = 0): boolean { const delta = sub(p, this.center), extent = f32(this.half + margin), bound = f32(2 * extent); if (Math.abs(delta.x) > bound || Math.abs(delta.y) > bound) return false; const local = rotated(delta, -this.angle); return Math.abs(local.x) <= extent && Math.abs(local.y) <= extent; }
  overlaps(other: Footprint): boolean { return overlaps(this.corners(), other.corners()); }
}
export function contains(outline: Outline, p: Point): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) { const a = outline[i], b = outline[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < f32(f32(f32(f32(b.x - a.x) * f32(p.y - a.y)) / f32(b.y - a.y)) + a.x)) inside = !inside; }
  return inside;
}
export function overlaps(a: Outline, b: Outline): boolean { for (const p of a) if (contains(b, p)) return true; for (const p of b) if (contains(a, p)) return true; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true; return false; }
export function area(outline: Outline): number { let sum = 0; for (let i = 0; i < outline.length; i++) { const a = outline[i], b = outline[(i + 1) % outline.length]; sum = f32(sum + f32(f32(a.x * b.y) - f32(b.x * a.y))); } return f32(Math.abs(sum) / 2); }
export function centroid(outline: Outline): Point { let sum = point(); for (const p of outline) sum = add(sum, p); return outline.length ? scale(sum, f32(1 / outline.length)) : sum; }
export function selfIntersects(outline: Outline): boolean { const n = outline.length; for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segmentsCross(outline[i], outline[(i + 1) % n], outline[j], outline[(j + 1) % n])) return true; } return false; }
export function outlineDistance(outline: Outline, p: Point): number { if (contains(outline, p)) return 0; let best = 1e9; for (let i = 0; i < outline.length; i++) best = Math.min(best, segmentDistance(p, outline[i], outline[(i + 1) % outline.length])); return best; }
export function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point { const u = f32(1 - t); return add(add(add(scale(p0, f32(f32(u * u) * u)), scale(p1, f32(f32(f32(3 * u) * u) * t))), scale(p2, f32(f32(f32(3 * u) * t) * t))), scale(p3, f32(f32(t * t) * t))); }
export const tileHalfWidth = 32, tileHalfHeight = 16;
export const project = (tx: number, ty: number, z = 0): Point => point(f32(f32(tx - ty) * tileHalfWidth), f32(f32(f32(tx + ty) * tileHalfHeight) - z));
export const unproject = (sx: number, sy: number): Point => { const u = f32(sx / tileHalfWidth), v = f32(sy / tileHalfHeight); return point(f32(f32(u + v) / 2), f32(f32(v - u) / 2)); };
export const isoMatrix = (): number[] => [tileHalfWidth, -tileHalfWidth, 0, tileHalfHeight, tileHalfHeight, 0, 0, 0, 1];
export const mul = scale;
