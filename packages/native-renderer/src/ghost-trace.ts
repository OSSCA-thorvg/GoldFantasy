// Outlines kept as flat lists in a figure's own space, and the draft a ghost layer is drawn from:
// placing an outline is one matrix away, and an unchanged draft costs no path upload.
import type { Command, Matrix, ShapeNode } from './paint';

/** Row-major 2x3 affine: a b tx / c d ty. */
export type Affine = readonly [number, number, number, number, number, number];
export const affineOf = (m: Matrix): Affine => [m[0], m[1], m[2], m[3], m[4], m[5]];
export const shift = (x: number, y: number): Affine => [1, 0, x, 0, 1, y];
export function times(p: Affine, q: Affine): Affine {
  return [
    p[0] * q[0] + p[1] * q[3],
    p[0] * q[1] + p[1] * q[4],
    p[0] * q[2] + p[1] * q[5] + p[2],
    p[3] * q[0] + p[4] * q[3],
    p[3] * q[1] + p[4] * q[4],
    p[3] * q[2] + p[4] * q[5] + p[5],
  ];
}

const move = 0,
  line = 1,
  curve = 2,
  close = 3,
  /** An upright ellipse: its centre, then its radii as the second pair. */
  oval = 4;
/** Points each op takes. */
const width = [1, 1, 3, 0, 2];

/** A path in its own space: op codes and the points they take, in order. */
export class Trace {
  readonly ops: number[] = [];
  readonly points: number[] = [];
  moveTo(x: number, y: number): this {
    this.ops.push(move);
    this.points.push(x, y);
    return this;
  }
  lineTo(x: number, y: number): this {
    this.ops.push(line);
    this.points.push(x, y);
    return this;
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.ops.push(curve);
    this.points.push(x1, y1, x2, y2, x, y);
    return this;
  }
  close(): this {
    this.ops.push(close);
    return this;
  }
  /** An open run of straight strokes through `xy` pairs. */
  polyline(...xy: number[]): this {
    for (let i = 0; i < xy.length; i += 2) i ? this.lineTo(xy[i], xy[i + 1]) : this.moveTo(xy[i], xy[i + 1]);
    return this;
  }
  polygon(...xy: number[]): this {
    return this.polyline(...xy).close();
  }
  /** An upright ellipse; placed under a turn it stays upright, which a face outline does not mind. */
  oval(x: number, y: number, rx: number, ry = rx): this {
    this.ops.push(oval);
    this.points.push(x, y, rx, ry);
    return this;
  }
  /** Adds `other` placed by `m`. */
  append(other: Trace, m: Affine): this {
    const { ops, points } = other;
    for (let i = 0, p = 0; i < ops.length; i++) {
      const op = ops[i];
      this.ops.push(op);
      if (op === oval) {
        const x = points[p],
          y = points[p + 1];
        this.points.push(
          m[0] * x + m[1] * y + m[2],
          m[3] * x + m[4] * y + m[5],
          points[p + 2] * Math.hypot(m[0], m[3]),
          points[p + 3] * Math.hypot(m[1], m[4]),
        );
        p += 4;
        continue;
      }
      for (let k = 0; k < width[op]; k++, p += 2) {
        const x = points[p],
          y = points[p + 1];
        this.points.push(m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]);
      }
    }
    return this;
  }
  /** Adds paint commands, such as a skinned path solved for one pose. */
  commands(commands: readonly Command[]): this {
    for (const c of commands)
      if (c[0] === 'M') this.moveTo(c[1], c[2]);
      else if (c[0] === 'L') this.lineTo(c[1], c[2]);
      else if (c[0] === 'C') this.cubicTo(c[1], c[2], c[3], c[4], c[5], c[6]);
      else if (c[0] === 'Z') this.close();
    return this;
  }
}

/** Ops and placed coordinates for one side of the layer, with the bounds of whatever the current unit added. */
export class Draft {
  private data = new Float64Array(4096);
  /** What was last drawn, to tell whether this frame changed anything. */
  private shown = new Float64Array(4096);
  private size = 0;
  private shownSize = -1;
  left = Infinity;
  top = Infinity;
  right = -Infinity;
  bottom = -Infinity;
  clear(): void {
    this.size = 0;
  }
  /** Starts a new bounds box. */
  begin(): void {
    this.left = this.top = Infinity;
    this.right = this.bottom = -Infinity;
  }
  /** Room for `more` numbers. */
  private room(more: number): Float64Array {
    if (this.size + more > this.data.length) {
      const grown = new Float64Array(Math.max(this.data.length * 2, this.size + more));
      grown.set(this.data.subarray(0, this.size));
      this.data = grown;
    }
    return this.data;
  }
  private bound(px: number, py: number): void {
    if (px < this.left) this.left = px;
    if (px > this.right) this.right = px;
    if (py < this.top) this.top = py;
    if (py > this.bottom) this.bottom = py;
  }
  /** Places `t` by `m`; the points of its first `bounded` ops grow the bounds box. */
  trace(t: Trace, m: Affine, bounded = Infinity): void {
    const { ops, points } = t,
      data = this.room(ops.length + points.length),
      [a, b, tx, c, d, ty] = m;
    let at = this.size;
    for (let i = 0, p = 0; i < ops.length; i++) {
      const op = ops[i];
      data[at++] = op;
      if (op === oval) {
        data[at++] = a * points[p] + b * points[p + 1] + tx;
        data[at++] = c * points[p] + d * points[p + 1] + ty;
        data[at++] = points[p + 2] * Math.hypot(a, c);
        data[at++] = points[p + 3] * Math.hypot(b, d);
        p += 4;
        continue;
      }
      for (let k = width[op]; k > 0; k--, p += 2) {
        const px = a * points[p] + b * points[p + 1] + tx,
          py = c * points[p] + d * points[p + 1] + ty;
        data[at++] = px;
        data[at++] = py;
        if (i < bounded) this.bound(px, py);
      }
    }
    this.size = at;
  }
  /** An open stroke through `count` points of `xy`, placed by `m` and bounded. */
  stroke(m: Affine, xy: readonly number[], count: number): void {
    const data = this.room(count * 3);
    let at = this.size;
    for (let i = 0; i < count; i++) {
      const x = xy[2 * i],
        y = xy[2 * i + 1],
        px = m[0] * x + m[1] * y + m[2],
        py = m[3] * x + m[4] * y + m[5];
      data[at++] = i ? line : move;
      data[at++] = px;
      data[at++] = py;
      this.bound(px, py);
    }
    this.size = at;
  }
  /**
   * Draws the draft into `shape` in place of what it held, unless it is what was drawn last time:
   * then nothing is sent again. Returns whether the shape changed.
   */
  present(shape: ShapeNode): boolean {
    const d = this.data,
      size = this.size;
    if (size === this.shownSize) {
      let i = 0;
      while (i < size && d[i] === this.shown[i]) i++;
      if (i === size) return false;
    }
    const commands: Command[] = [];
    for (let i = 0; i < size; ) {
      const op = d[i++];
      if (op === move) commands.push(['M', d[i++], d[i++]]);
      else if (op === line) commands.push(['L', d[i++], d[i++]]);
      else if (op === curve) {
        commands.push(['C', d[i], d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5]]);
        i += 6;
      } else if (op === oval) {
        commands.push(['E', d[i], d[i + 1], d[i + 2], d[i + 3]]);
        i += 4;
      } else commands.push(['Z']);
    }
    // As a rig skin swaps in its outlines: one new list, one version bump.
    shape.commands = commands;
    shape.pathVersion++;
    shape.version++;
    // The buffers swap: what was drawn is kept to compare, the old one is written next frame.
    const kept = this.shown;
    this.shown = d;
    this.shownSize = size;
    this.data = kept.length >= d.length ? kept : new Float64Array(d.length);
    this.size = 0;
    return true;
  }
}
