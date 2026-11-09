// Translated from src/game/mining.h.
import { point, type Point } from './geometry';
import { hash01, f32 as f } from './numeric';
import { Terrain } from './world-types';
import type { WorldMap } from './world-map';
export const workSeconds = 6,
  collectSeconds = 0.65,
  stonePerRock = 3;
export const position = (x: number, y: number): Point => point(f(x + f(0.5)), f(y + f(0.55)));
export const size = (map: WorldMap, x: number, y: number): number =>
  f(6 + f(hash01(map.seed(), x, y, 61) * 7));
export const deposit = (map: WorldMap, x: number, y: number): boolean =>
  map.inside(x, y) &&
  map.at(x, y).terrain === Terrain.Rock &&
  !map.at(x, y).quarried &&
  hash01(map.seed(), x, y, 60) < f(0.55);
