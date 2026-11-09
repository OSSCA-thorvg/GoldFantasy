import { PaintNode, ShapeNode, SceneNode, type Rgb, type Rgba, type Blend } from './paint';
import { add, sub, scale as mul, normalized, type Point } from '../../engine/src/geometry';
export type { Point } from '../../engine/src/geometry';
const f = Math.fround;
export const SUN_PASSES = [
  { method: 'softLight', color: [255, 246, 228, 255] },
  { method: 'add', color: [34, 30, 22, 255] },
] as const;
export const FIGURE_LIGHT = [
  { method: 'multiply', color: [165, 199, 210, 255] },
  { method: 'add', color: [91, 70, 57, 255] },
] as const;
export function opaque(color: Rgb, a = 255): Rgba {
  return [color[0], color[1], color[2], a];
}
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.trunc(f(a[0] + f((b[0] - a[0]) * t))) & 255,
    Math.trunc(f(a[1] + f((b[1] - a[1]) * t))) & 255,
    Math.trunc(f(a[2] + f((b[2] - a[2]) * t))) & 255,
  ];
}
export function scale(c: Rgb, k: number): Rgb {
  return [
    Math.trunc(Math.min(255, f(c[0] * k))) & 255,
    Math.trunc(Math.min(255, f(c[1] * k))) & 255,
    Math.trunc(Math.min(255, f(c[2] * k))) & 255,
  ];
}
export function fill(shape: ShapeNode, c: Rgba): void {
  shape.fill(...c);
}
export function blendLayer(paint: PaintNode, method: Blend): SceneNode {
  return new SceneNode().add(paint).blend(method);
}
export function appendStrip(shape: ShapeNode, path: Point[], wide: number, narrow: number): void {
  if (path.length < 2) return;
  const left: Point[] = [],
    right: Point[] = [];
  for (let i = 0; i < path.length; i++) {
    const along = normalized(sub(path[Math.min(i + 1, path.length - 1)], path[i > 0 ? i - 1 : 0]));
    const half = f(f(wide + f(f(f(narrow - wide) * i) / (path.length - 1))) / 2),
      normal = { x: -along.y, y: along.x };
    left.push(add(path[i], mul(normal, half)));
    right.push(sub(path[i], mul(normal, half)));
  }
  shape.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) shape.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) shape.lineTo(right[i].x, right[i].y);
  shape.close();
}
export function appendPolygon(shape: ShapeNode, points: Point[]): void {
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i) shape.lineTo(p.x, p.y);
    else shape.moveTo(p.x, p.y);
  }
  shape.close();
}
export function polygon(points: Point[], color: Rgba): ShapeNode {
  const shape = new ShapeNode();
  appendPolygon(shape, points);
  fill(shape, color);
  return shape;
}
export function ellipse(center: Point, rx: number, ry: number, color: Rgba): ShapeNode {
  return new ShapeNode().appendCircle(center.x, center.y, rx, ry).fill(...color);
}
export function line(a: Point, b: Point, width: number, color: Rgba): ShapeNode {
  return new ShapeNode()
    .moveTo(a.x, a.y)
    .lineTo(b.x, b.y)
    .strokeWidth(width)
    .strokeCap('round')
    .strokeFill(...color);
}
export function sightDisc(radius: number): ShapeNode {
  return new ShapeNode().appendCircle(0, 0, radius, radius).fillGradient({
    type: 'radial',
    coordinates: [0, 0, f(radius), 0, 0, 0],
    stops: [
      { offset: 0, color: [255, 255, 255, 255] },
      { offset: f(0.7), color: [255, 255, 255, 255] },
      { offset: f(0.86), color: [255, 255, 255, 110] },
      { offset: 1, color: [255, 255, 255, 0] },
    ],
  });
}
export function softDisc(radius: number, color: Rgb, alpha: number): ShapeNode {
  return new ShapeNode().appendCircle(0, 0, radius, radius).fillGradient({
    type: 'radial',
    coordinates: [0, 0, f(radius), 0, 0, 0],
    stops: [
      { offset: 0, color: opaque(color, alpha) },
      { offset: f(0.3), color: opaque(color, Math.trunc(f(alpha * f(0.55)))) },
      { offset: f(0.65), color: opaque(color, Math.trunc(f(alpha * f(0.18)))) },
      { offset: 1, color: opaque(color, 0) },
    ],
  });
}
export function glow(center: Point, rx: number, ry: number, color: Rgb, alpha: number): SceneNode {
  return new SceneNode()
    .add(softDisc(rx, color, alpha))
    .transform([1, 0, center.x, 0, f(ry / rx), center.y, 0, 0, 1]);
}
export function verticalShade(
  shape: ShapeNode,
  color: Rgb,
  top: number,
  bottom: number,
  lift: number,
  sink: number,
): void {
  shape.fillGradient({
    type: 'linear',
    coordinates: [0, f(top), 0, f(bottom)],
    stops: [
      { offset: 0, color: opaque(scale(color, lift)) },
      { offset: 1, color: opaque(scale(color, sink)) },
    ],
  });
}
export function clear(scene: SceneNode): void {
  scene.remove();
}
export function detach(scene: SceneNode, paint: PaintNode): void {
  scene.remove(paint);
}
