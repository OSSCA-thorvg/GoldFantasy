import { Giant, Volcano, WorldMap, type Tile } from '../../engine/src';

export interface DocumentFiles {
  read(path: string, maxBytes: number): Promise<string>;
  write(path: string, text: string, maxBytes: number): Promise<void>;
}

export class TileRegion {
  constructor(
    public left = 0,
    public top = 0,
    public right = 0,
    public bottom = 0,
  ) {}
  empty(): boolean {
    return this.left >= this.right || this.top >= this.bottom;
  }
  intersects(other: TileRegion): boolean {
    return (
      this.left < other.right && this.right > other.left && this.top < other.bottom && this.bottom > other.top
    );
  }
  include(other: TileRegion): void {
    if (other.empty()) return;
    if (this.empty()) {
      Object.assign(this, other);
      return;
    }
    this.left = Math.min(this.left, other.left);
    this.top = Math.min(this.top, other.top);
    this.right = Math.max(this.right, other.right);
    this.bottom = Math.max(this.bottom, other.bottom);
  }
}

export function cloneMap(source: WorldMap): WorldMap {
  const map = new WorldMap();
  map.columns = source.columns;
  map.rows = source.rows;
  map.mapSeed = source.mapSeed;
  map.origin = { ...source.origin };
  map.tiles = source.tiles.map((tile) => ({ ...tile }));
  map.layers = source.layers.map((layer) => layer.slice());
  map.stream = structuredClone(source.stream);
  map.seen = structuredClone(source.seen);
  map.sites = structuredClone(source.sites);
  map.ymir = source.ymir ? new Giant({ ...source.ymir.origin }) : null;
  map.fire = source.fire ? new Volcano({ ...source.fire.origin }) : null;
  map.laidOut = source.laidOut;
  return map;
}

export { nativeFloat, quoted, NativeReader, utf8Bytes, validNativeName } from '../../engine/src/native-text';
export interface TilePatch {
  x: number;
  y: number;
  width: number;
  height: number;
  values: Tile[];
}
export interface SamplePatch {
  x: number;
  y: number;
  width: number;
  height: number;
  values: Float32Array[];
}
