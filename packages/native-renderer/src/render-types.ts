import type { Point } from './vector-paint';
export interface Climate {
  summer: number;
  autumn: number;
  snow: number;
  frost: number;
  night?: number;
  intensity?: number;
  wind?: number;
  temperature?: number;
  weather?: number;
}
export interface TileRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface River {
  path: Point[];
  width: number[];
}
export interface Sight {
  center: Point;
  radius: number;
}
export interface TerrainMap {
  width(): number;
  height(): number;
  sample(layer: number, i: number, j: number): number;
  value(layer: number, p: Point): number;
  terrainAt(p: Point): number;
  river(): River;
  sights(): Sight[];
}
