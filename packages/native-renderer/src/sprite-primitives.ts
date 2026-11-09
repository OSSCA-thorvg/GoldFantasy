// Point-list syntax adaptation only; every coordinate remains native-authored.
import { point, type Point } from '../../engine/src/geometry';
import { type Rgb, type Rgba } from './paint';
import { polygon, ellipse, line, glow as nativeGlow } from './vector-paint';
export { opaque, scale, fill } from './vector-paint';
export type Coordinate = Point | readonly [number, number];
export const at = (p: Coordinate): Point => (Array.isArray(p) ? point(p[0], p[1]) : (p as Point));
const rgba = (c: Rgb | Rgba): Rgba => [c[0], c[1], c[2], c.length > 3 ? c[3]! : 255];
export const poly = (p: Coordinate[], c: Rgb | Rgba) => polygon(p.map(at), rgba(c));
export const oval = (p: Coordinate, rx: number, ry: number, c: Rgb | Rgba) => ellipse(at(p), rx, ry, rgba(c));
export const stroke = (a: Coordinate, b: Coordinate, width: number, c: Rgb | Rgba) =>
  line(at(a), at(b), width, rgba(c));

export const glow = (center: Coordinate, rx: number, ry: number, color: Rgb, alpha: number) =>
  nativeGlow(at(center), rx, ry, color, alpha);
