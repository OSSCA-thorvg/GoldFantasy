import { add, point, type Point } from './geometry';
import { clamp, f32, lround } from './numeric';
export enum Terrain { Grass, Meadow, Forest, Water, Rock, Sand, Sea, Mountain, Ash, Frost, Ice, Lava }
export const terrainCount = Terrain.Lava + 1;
export const isWater = (terrain: Terrain): boolean => terrain === Terrain.Water || terrain === Terrain.Sea;
export const isStone = (terrain: Terrain): boolean => terrain === Terrain.Rock || terrain === Terrain.Mountain;
export const impassable = (terrain: Terrain): boolean => terrain === Terrain.Mountain || terrain === Terrain.Ice || terrain === Terrain.Lava;
export const crestRidge = f32(.085), lavaFloor = f32(.67), volcanoFoot = f32(12.4);
export const volcanicCrest = (land: number, heat: number, ridge: number): boolean => land > f32(.1) && heat > f32(.62) && ridge > crestRidge;
export function lavaLevel(land: number, heat: number, ridge: number): number { return Math.min(f32(f32(land - f32(.1)) + f32(f32(.1) * clamp(f32(heat - 1), 0, 1))), f32(f32(ridge + f32(.08)) - f32(Math.max(0, f32(f32(.75) - heat)) * 3)), f32(f32(heat - lavaFloor) * 4)); }
export interface Tile { terrain: Terrain; shade: number; trees: number; wild: number; revealed: boolean; dungeon: number; quarried: boolean; }
export const makeTile = (): Tile => ({ terrain: Terrain.Grass, shade: 0, trees: 0, wild: 0, revealed: false, dungeon: -1, quarried: false });
export interface TileCoord { x: number; y: number; }
export enum DungeonKind { Cave, Crypt, Portal, Ruin, GiantHall }
export interface Dungeon { name: string; kind: DungeonKind; origin: TileCoord; discovered: boolean; }
export enum Layer { Land, Elevation, Moisture, Shade, Beach, Ridge, Heat, Count }
export interface River { path: Point[]; width: number[]; }
export interface Sight { center: Point; radius: number; }
export enum Region { North, Middle, South, Count }
export enum World { Asgard, Vanaheim, Alfheim, Jotunheim, Svartalfheim, Niflheim, Muspelheim, Helheim, Count }
export class Giant {
  static readonly size = 6;
  constructor(public origin: TileCoord) {}
  covers(p: Point): boolean { return p.x >= this.origin.x && p.y >= this.origin.y && p.x < this.origin.x + Giant.size && p.y < this.origin.y + Giant.size; }
  center(): Point { return point(this.origin.x + Giant.size / 2, this.origin.y + Giant.size / 2); }
  sights(): Sight[] { const c = this.center(); return [{ center: c, radius: 13 }, { center: add(c, point(-9.9, -9.9)), radius: 10 }]; }
}
export class Volcano {
  static readonly size = 12;
  constructor(public origin: TileCoord) {}
  static around(center: Point): Volcano { return new Volcano({ x: lround(center.x) - Volcano.size / 2, y: lround(center.y) - Volcano.size / 2 }); }
  covers(p: Point): boolean { return p.x >= this.origin.x && p.y >= this.origin.y && p.x < this.origin.x + Volcano.size && p.y < this.origin.y + Volcano.size; }
  center(): Point { return point(this.origin.x + Volcano.size / 2, this.origin.y + Volcano.size / 2); }
  sights(): Sight[] { const c = this.center(); return [{ center: c, radius: 14 }, { center: add(c, point(-13, -13)), radius: 13 }]; }
}
