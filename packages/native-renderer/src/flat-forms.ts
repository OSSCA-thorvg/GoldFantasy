// Lineless flat forms for the environment: rounded blobs and faceted polygons in local pixel offsets.
import { ShapeNode, type Rgb } from './paint';
import { opaque } from './vector-paint';
import type { Point } from '../../engine/src/geometry';
const f = Math.fround;
export type Local = readonly [number, number];
/** Base colour of the unlit side: the dusk indigo every shadow leans toward. */
export const duskShade: Rgb = [6, 7, 33];
/** A closed Catmull-Rom curve through the points: soft, rounded silhouettes. */
export function appendBlob(shape: ShapeNode, at: Point, points: readonly Local[]): ShapeNode {
  const n = points.length;
  if (n < 3) return shape;
  const p = (i: number) => points[((i % n) + n) % n];
  shape.moveTo(f(at.x + p(0)[0]), f(at.y + p(0)[1]));
  for (let i = 0; i < n; i++) {
    const a = p(i - 1),
      b = p(i),
      c = p(i + 1),
      d = p(i + 2);
    shape.cubicTo(
      f(at.x + f(b[0] + f(f(c[0] - a[0]) / 6))),
      f(at.y + f(b[1] + f(f(c[1] - a[1]) / 6))),
      f(at.x + f(c[0] - f(f(d[0] - b[0]) / 6))),
      f(at.y + f(c[1] - f(f(d[1] - b[1]) / 6))),
      f(at.x + c[0]),
      f(at.y + c[1]),
    );
  }
  shape.close();
  return shape;
}
export function appendFacet(shape: ShapeNode, at: Point, points: readonly Local[]): ShapeNode {
  points.forEach(([x, y], i) => (i ? shape.lineTo(f(at.x + x), f(at.y + y)) : shape.moveTo(f(at.x + x), f(at.y + y))));
  shape.close();
  return shape;
}
/** An arch: straight jambs and a round head, standing on `base`. */
export function arch(cx: number, base: number, half: number, height: number): Local[] {
  const spring = f(base - f(height - half)),
    out: Local[] = [
      [f(cx - half), base],
      [f(cx - half), spring],
    ];
  for (let k = 1; k < 8; k++) {
    const a = f(f(Math.PI) + f(f(k * f(Math.PI)) / 8));
    out.push([f(cx + f(f(Math.cos(a)) * half)), f(spring + f(f(Math.sin(a)) * half))]);
  }
  out.push([f(cx + half), spring], [f(cx + half), base]);
  return out;
}
export const blob = (at: Point, points: readonly Local[], color: Rgb, alpha = 255): ShapeNode =>
  appendBlob(new ShapeNode(), at, points).fill(...opaque(color, alpha));
export const facet = (at: Point, points: readonly Local[], color: Rgb, alpha = 255): ShapeNode =>
  appendFacet(new ShapeNode(), at, points).fill(...opaque(color, alpha));
/** A faceted stone: lit left face and an indigo-leaning right face. */
export function stone(lit: ShapeNode, shade: ShapeNode, at: Point, x: number, y: number, s: number): void {
  appendFacet(lit, at, [
    [f(x - s), y],
    [f(x - f(s * f(0.45))), f(y - f(s * f(1.05)))],
    [f(x + f(s * f(0.2))), f(y - f(s * f(0.9)))],
    [f(x + f(s * f(0.1))), f(y + f(s * f(0.25)))],
  ]);
  appendFacet(shade, at, [
    [f(x + f(s * f(0.1))), f(y + f(s * f(0.25)))],
    [f(x + f(s * f(0.2))), f(y - f(s * f(0.9)))],
    [f(x + f(s * f(0.7))), f(y - f(s * f(0.6)))],
    [f(x + s), f(y - f(s * f(0.05)))],
  ]);
}
