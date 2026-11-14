// Closed vector outlines authored as on-curve points, shared by the portrait and the street figure.
import { ShapeNode } from './paint';

export interface Dot {
  x: number;
  y: number;
}
interface Bend {
  c1: Dot;
  c2: Dot;
  to: Dot;
}
export interface Contour {
  start: Dot;
  bends: Bend[];
  /** Cut out of the form instead of added to it. */
  hole?: boolean;
}
/** A union of contours; every one is wound the same way so overlaps never cancel. */
export type Form = Contour[];

const dot = (x: number, y: number): Dot => ({ x, y });
const lerp = (a: Dot, b: Dot, t: number): Dot => dot(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

/** Draws one contour: straight runs, exact cubics, and smooth runs through on-curve points. */
export class Pen {
  private readonly start: Dot;
  private at: Dot;
  private bends: Bend[] = [];
  constructor(x: number, y: number) {
    this.start = this.at = dot(x, y);
  }
  line(x: number, y: number): this {
    const to = dot(x, y);
    this.bends.push({ c1: lerp(this.at, to, 1 / 3), c2: lerp(this.at, to, 2 / 3), to });
    this.at = to;
    return this;
  }
  cubic(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.at = dot(x, y);
    this.bends.push({ c1: dot(x1, y1), c2: dot(x2, y2), to: this.at });
    return this;
  }
  /** A smooth run from the pen through each point; consecutive runs meet in a corner. */
  curve(...points: [number, number][]): this {
    const p = [this.at, ...points.map(([x, y]) => dot(x, y))],
      n = p.length - 1,
      slope = (i: number): Dot =>
        i === 0
          ? dot(p[1].x - p[0].x, p[1].y - p[0].y)
          : i === n
            ? dot(p[n].x - p[n - 1].x, p[n].y - p[n - 1].y)
            : dot((p[i + 1].x - p[i - 1].x) / 2, (p[i + 1].y - p[i - 1].y) / 2);
    for (let i = 0; i < n; i++) {
      const a = slope(i),
        b = slope(i + 1);
      this.bends.push({
        c1: dot(p[i].x + a.x / 3, p[i].y + a.y / 3),
        c2: dot(p[i + 1].x - b.x / 3, p[i + 1].y - b.y / 3),
        to: p[i + 1],
      });
    }
    this.at = p[n];
    return this;
  }
  /** Rounded lobes from the pen to a point, each swelling to the left of travel: curls and fur. */
  lobes(x: number, y: number, count: number, swell: number): this {
    const from = this.at,
      to = dot(x, y),
      length = Math.hypot(to.x - from.x, to.y - from.y) || 1,
      normal = dot(((to.y - from.y) / length) * swell, (-(to.x - from.x) / length) * swell);
    for (let i = 0; i < count; i++) {
      const a = lerp(from, to, i / count),
        b = lerp(from, to, (i + 1) / count);
      this.bends.push({
        c1: dot(a.x + normal.x * 1.33, a.y + normal.y * 1.33),
        c2: dot(b.x + normal.x * 1.33, b.y + normal.y * 1.33),
        to: b,
      });
    }
    this.at = to;
    return this;
  }
  close(): Contour {
    if (Math.hypot(this.at.x - this.start.x, this.at.y - this.start.y) > 1e-6)
      this.line(this.start.x, this.start.y);
    return { start: this.start, bends: this.bends };
  }
}
export const pen = (x: number, y: number): Pen => new Pen(x, y);

export function oval(cx: number, cy: number, rx: number, ry = rx): Contour {
  const k = 0.5523;
  return new Pen(cx - rx, cy)
    .cubic(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry)
    .cubic(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy)
    .cubic(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry)
    .cubic(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy)
    .close();
}
/** A capsule between two points: braids, locks, limbs. */
export function capsule(ax: number, ay: number, bx: number, by: number, ra: number, rb = ra): Contour {
  const length = Math.hypot(bx - ax, by - ay) || 1,
    ux = (bx - ax) / length,
    uy = (by - ay) / length,
    nx = -uy,
    ny = ux,
    k = 1.33;
  return new Pen(ax + nx * ra, ay + ny * ra)
    .line(bx + nx * rb, by + ny * rb)
    .cubic(
      bx + nx * rb + ux * rb * k,
      by + ny * rb + uy * rb * k,
      bx - nx * rb + ux * rb * k,
      by - ny * rb + uy * rb * k,
      bx - nx * rb,
      by - ny * rb,
    )
    .line(ax - nx * ra, ay - ny * ra)
    .cubic(
      ax - nx * ra - ux * ra * k,
      ay - ny * ra - uy * ra * k,
      ax + nx * ra - ux * ra * k,
      ay + ny * ra - uy * ra * k,
      ax + nx * ra,
      ay + ny * ra,
    )
    .close();
}
const mapped = (c: Contour, f: (p: Dot) => Dot): Contour => ({
  start: f(c.start),
  bends: c.bends.map((b) => ({ c1: f(b.c1), c2: f(b.c2), to: f(b.to) })),
  hole: c.hole,
});
export const moved = (form: Form, dx: number, dy: number): Form =>
  form.map((c) => mapped(c, (p) => dot(p.x + dx, p.y + dy)));
export const scaled = (form: Form, sx: number, sy = sx): Form =>
  form.map((c) => mapped(c, (p) => dot(p.x * sx, p.y * sy)));
export const mirrored = (form: Form): Form => form.map((c) => mapped(c, (p) => dot(-p.x, p.y)));
/** Both the form and its mirror image across the vertical axis. */
export const paired = (form: Form): Form => [...form, ...mirrored(form)];
export const turned = (form: Form, radians: number, cx = 0, cy = 0): Form => {
  const co = Math.cos(radians),
    si = Math.sin(radians);
  return form.map((c) =>
    mapped(c, (p) => dot(cx + (p.x - cx) * co - (p.y - cy) * si, cy + (p.x - cx) * si + (p.y - cy) * co)),
  );
};
export const pierced = (c: Contour): Contour => ({ ...c, hole: true });

/** Signed area from a coarse sampling of each cubic: ample for telling which way a contour winds. */
function area(c: Contour): number {
  let sum = 0,
    from = c.start,
    last = c.start;
  for (const b of c.bends) {
    for (let i = 1; i <= 6; i++) {
      const t = i / 6,
        u = 1 - t,
        at = dot(
          u * u * u * from.x + 3 * u * u * t * b.c1.x + 3 * u * t * t * b.c2.x + t * t * t * b.to.x,
          u * u * u * from.y + 3 * u * u * t * b.c1.y + 3 * u * t * t * b.c2.y + t * t * t * b.to.y,
        );
      sum += last.x * at.y - at.x * last.y;
      last = at;
    }
    from = b.to;
  }
  return sum / 2;
}
function reversed(c: Contour): Contour {
  const points = [c.start, ...c.bends.map((b) => b.to)],
    bends: Bend[] = [];
  for (let i = c.bends.length - 1; i >= 0; i--)
    bends.push({ c1: c.bends[i].c2, c2: c.bends[i].c1, to: points[i] });
  return { start: points[points.length - 1], bends, hole: c.hole };
}
/** Appends the form to a shape, winding solids one way and holes the other. */
export function trace(shape: ShapeNode, form: Form): ShapeNode {
  for (const raw of form) {
    const positive = area(raw) > 0,
      c = positive === !raw.hole ? raw : reversed(raw);
    shape.moveTo(c.start.x, c.start.y);
    for (const b of c.bends) shape.cubicTo(b.c1.x, b.c1.y, b.c2.x, b.c2.y, b.to.x, b.to.y);
    shape.close();
  }
  return shape;
}
export const shapeOf = (form: Form): ShapeNode => trace(new ShapeNode(), form);
/** A box that holds the form (control points included, so it may sit a little wide). */
export function boxOf(form: Form): { x: number; y: number; w: number; h: number } {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const take = (p: Dot) => {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  };
  for (const contour of form) {
    take(contour.start);
    for (const bend of contour.bends) {
      take(bend.c1);
      take(bend.c2);
      take(bend.to);
    }
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
