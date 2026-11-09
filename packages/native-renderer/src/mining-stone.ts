// Exact shared stone geometry from src/game/mining.h (2026-11-09).
import { point, type Point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { ShapeNode, type Rgb } from './paint';
import { appendPolygon } from './vector-paint';
export const stoneLit: Rgb = [92, 90, 96];
export const stoneShade: Rgb = [60, 58, 66];
export function appendStone(lit: ShapeNode, shade: ShapeNode, b: Point, s: number): void {
  appendPolygon(lit, [
    point(f32(b.x - s), b.y),
    point(f32(b.x - f32(s * f32(0.3))), f32(b.y - f32(s * f32(1.1)))),
    point(f32(b.x + f32(s * f32(0.2))), f32(b.y + f32(s * f32(0.2)))),
  ]);
  appendPolygon(shade, [
    point(f32(b.x + f32(s * f32(0.2))), f32(b.y + f32(s * f32(0.2)))),
    point(f32(b.x - f32(s * f32(0.3))), f32(b.y - f32(s * f32(1.1)))),
    point(f32(b.x + s), f32(b.y - f32(s * f32(0.1)))),
  ]);
}
