import {
  WorldMap,
  Layer,
  Terrain,
  DungeonKind,
  Giant,
  Volcano,
  isWater,
  isStone,
  impassable,
  lavaFloor,
  makeTile,
  distance,
  point,
  sub,
  scale,
  clamp,
  f32 as f,
  wildTrees,
  type Point,
  type TileCoord,
} from '../../engine/src';
import {
  TileRegion,
  cloneMap,
  NativeReader,
  nativeFloat,
  quoted,
  utf8Bytes,
  validNativeName,
  type DocumentFiles,
  type TilePatch,
  type SamplePatch,
} from './documents';

export const maxMapBytes = 40 * 1024 * 1024;
const dry = (terrain: Terrain) => !isWater(terrain) && !isStone(terrain) && !impassable(terrain);
const dungeonGround = (terrain: Terrain) => !isWater(terrain) && !impassable(terrain);
function doorstep(map: WorldMap, origin: TileCoord): boolean {
  return (
    map.inside(origin.x + 1, origin.y + 2) &&
    dungeonGround(map.terrainAt(point(origin.x + 1.5, origin.y + 2.5)))
  );
}
function clearing(map: WorldMap, at: TileCoord, radius: number): boolean {
  for (let y = at.y - radius; y <= at.y + radius; y++)
    for (let x = at.x - radius; x <= at.x + radius; x++)
      if (!map.inside(x, y) || !dry(map.terrainAt(point(x + 0.5, y + 0.5))) || map.at(x, y).dungeon >= 0)
        return false;
  return true;
}
class BrushSegment {
  delta: Point;
  inverseLengthSquared: number;
  constructor(
    readonly from: Point,
    readonly to: Point,
  ) {
    this.delta = sub(to, from);
    const squared = f(f(this.delta.x * this.delta.x) + f(this.delta.y * this.delta.y));
    this.inverseLengthSquared = squared > 0 ? f(1 / squared) : 0;
  }
  distanceSquared(p: Point): number {
    const offset = sub(p, this.from),
      t = clamp(
        f(f(f(offset.x * this.delta.x) + f(offset.y * this.delta.y)) * this.inverseLengthSquared),
        0,
        1,
      ),
      d = sub(offset, scale(this.delta, t));
    return f(f(d.x * d.x) + f(d.y * d.y));
  }
  bounds(radius: number): TileRegion {
    return new TileRegion(
      Math.floor(f(Math.min(this.from.x, this.to.x) - radius)),
      Math.floor(f(Math.min(this.from.y, this.to.y) - radius)),
      Math.ceil(f(Math.max(this.from.x, this.to.x) + radius)),
      Math.ceil(f(Math.max(this.from.y, this.to.y) + radius)),
    );
  }
  columns(top: number, bottom: number, radius: number): [number, number] {
    let first = 0,
      last = 1;
    if (Math.abs(this.delta.y) > f(0.00001)) {
      const a = f(f(f(top - radius) - this.from.y) / this.delta.y),
        b = f(f(f(bottom + radius) - this.from.y) / this.delta.y);
      first = clamp(Math.min(a, b), 0, 1);
      last = clamp(Math.max(a, b), 0, 1);
    }
    const a = f(this.from.x + f(this.delta.x * first)),
      b = f(this.from.x + f(this.delta.x * last));
    return [f(Math.min(a, b) - radius), f(Math.max(a, b) + radius)];
  }
}
interface Snapshot {
  map: WorldMap;
  id: number;
  partial: boolean;
  tiles: TilePatch[];
  samples: SamplePatch[];
  capturedTiles: Uint8Array;
  capturedSamples: Uint8Array;
}
const snapshot = (map = new WorldMap(), id = 0): Snapshot => ({
  map,
  id,
  partial: false,
  tiles: [],
  samples: [],
  capturedTiles: new Uint8Array(),
  capturedSamples: new Uint8Array(),
});

/** Literal MapDocument model, including block snapshots and continuous soft-edge brushes. */
export class MapDocument {
  private landscape: WorldMap;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private before: Snapshot | undefined;
  private nextId = 1;
  private currentId = 0;
  private savedId = 0;
  private visualRevision = 1;
  private strokeChanged = false;
  private dirtyArea: TileRegion;
  constructor(map: WorldMap) {
    this.landscape = cloneMap(map);
    this.dirtyArea = new TileRegion(0, 0, map.width(), map.height());
  }
  map(): WorldMap {
    return this.landscape;
  }
  revision(): number {
    return this.visualRevision;
  }
  changed(): boolean {
    return this.currentId !== this.savedId || this.strokeChanged;
  }
  canUndo(): boolean {
    return !!this.past.length;
  }
  canRedo(): boolean {
    return !!this.future.length;
  }
  stroking(): boolean {
    return !!this.before;
  }
  takeDirtyArea(): TileRegion {
    const area = this.dirtyArea;
    this.dirtyArea = new TileRegion();
    return area;
  }
  static validSize(value: number): boolean {
    return Number.isInteger(value) && value >= 32 && value <= 256;
  }
  private remember(value: Snapshot): void {
    if (this.past.length === 24) this.past.shift();
    this.past.push(value);
    this.future = [];
    this.currentId = this.nextId++;
  }
  private touch(area: TileRegion): void {
    this.dirtyArea.include(area);
    this.strokeChanged = true;
    this.visualRevision++;
  }
  private invalidateAll(): void {
    this.dirtyArea = new TileRegion(-2, -2, this.landscape.width() + 2, this.landscape.height() + 2);
    this.visualRevision++;
  }
  beginStroke(): void {
    if (this.before) return;
    this.before = snapshot(new WorldMap(), this.currentId);
    this.before.partial = true;
    this.before.map.origin = { ...this.landscape.origin };
    this.before.map.stream = structuredClone(this.landscape.stream);
    this.before.map.sites = structuredClone(this.landscape.sites);
    this.strokeChanged = false;
  }
  private capture(area: TileRegion, samples = true): void {
    const map = this.landscape,
      history = this.before,
      tileBlock = 16,
      sampleBlock = 32;
    const left = clamp(area.left, 0, map.columns),
      right = clamp(area.right, 0, map.columns),
      top = clamp(area.top, 0, map.rows),
      bottom = clamp(area.bottom, 0, map.rows);
    if (!history || left >= right || top >= bottom) return;
    let columns = Math.trunc((map.columns + tileBlock - 1) / tileBlock),
      rows = Math.trunc((map.rows + tileBlock - 1) / tileBlock);
    if (!history.capturedTiles.length) history.capturedTiles = new Uint8Array(columns * rows);
    for (let by = Math.trunc(top / tileBlock); by <= Math.trunc((bottom - 1) / tileBlock); by++)
      for (let bx = Math.trunc(left / tileBlock); bx <= Math.trunc((right - 1) / tileBlock); bx++) {
        const index = by * columns + bx;
        if (history.capturedTiles[index]) continue;
        history.capturedTiles[index] = 1;
        const patch: TilePatch = {
          x: bx * tileBlock,
          y: by * tileBlock,
          width: Math.min(tileBlock, map.columns - bx * tileBlock),
          height: Math.min(tileBlock, map.rows - by * tileBlock),
          values: [],
        };
        for (let y = 0; y < patch.height; y++)
          for (let x = 0; x < patch.width; x++) patch.values.push({ ...map.at(patch.x + x, patch.y + y) });
        history.tiles.push(patch);
      }
    if (!samples) return;
    const stride = map.columns * 2 + 1,
      height = map.rows * 2 + 1;
    columns = Math.trunc((stride + sampleBlock - 1) / sampleBlock);
    rows = Math.trunc((height + sampleBlock - 1) / sampleBlock);
    if (!history.capturedSamples.length) history.capturedSamples = new Uint8Array(columns * rows);
    for (let by = Math.trunc((top * 2) / sampleBlock); by <= Math.trunc((bottom * 2) / sampleBlock); by++)
      for (let bx = Math.trunc((left * 2) / sampleBlock); bx <= Math.trunc((right * 2) / sampleBlock); bx++) {
        const index = by * columns + bx;
        if (history.capturedSamples[index]) continue;
        history.capturedSamples[index] = 1;
        const patch: SamplePatch = {
          x: bx * sampleBlock,
          y: by * sampleBlock,
          width: Math.min(sampleBlock, stride - bx * sampleBlock),
          height: Math.min(sampleBlock, height - by * sampleBlock),
          values: [],
        };
        for (let layer = 0; layer < Layer.Count; layer++) {
          const values = new Float32Array(patch.width * patch.height);
          for (let y = 0; y < patch.height; y++) {
            const offset = (patch.y + y) * stride + patch.x;
            values.set(map.layers[layer].subarray(offset, offset + patch.width), y * patch.width);
          }
          patch.values.push(values);
        }
        history.samples.push(patch);
      }
  }
  private captureSegment(from: Point, to: Point, radius: number, samples = true): void {
    const block = 16,
      brush = new BrushSegment(from, to),
      area = brush.bounds(radius),
      top = Math.trunc(Math.max(0, area.top) / block) * block,
      bottom = Math.min(this.landscape.rows, area.bottom);
    for (let y = top; y < bottom; y += block) {
      const [left, right] = brush.columns(y, y + block, radius);
      this.capture(
        new TileRegion(Math.floor(left), y, Math.ceil(right), Math.min(y + block, this.landscape.rows)),
        samples,
      );
    }
  }
  private restore(history: Snapshot): void {
    if (!history.partial) [this.landscape, history.map] = [history.map, this.landscape];
    else {
      const map = this.landscape;
      for (const patch of history.tiles)
        for (let y = 0; y < patch.height; y++)
          for (let x = 0; x < patch.width; x++) {
            const index = (patch.y + y) * map.columns + patch.x + x,
              old = y * patch.width + x;
            [map.tiles[index], patch.values[old]] = [patch.values[old], map.tiles[index]];
          }
      const stride = map.columns * 2 + 1;
      for (const patch of history.samples)
        for (let layer = 0; layer < Layer.Count; layer++)
          for (let y = 0; y < patch.height; y++)
            for (let x = 0; x < patch.width; x++) {
              const index = (patch.y + y) * stride + patch.x + x,
                old = y * patch.width + x;
              [map.layers[layer][index], patch.values[layer][old]] = [
                patch.values[layer][old],
                map.layers[layer][index],
              ];
            }
      [map.origin, history.map.origin] = [history.map.origin, map.origin];
      [map.stream, history.map.stream] = [history.map.stream, map.stream];
      [map.sites, history.map.sites] = [history.map.sites, map.sites];
    }
    [this.currentId, history.id] = [history.id, this.currentId];
  }
  endStroke(): void {
    if (!this.before) return;
    if (this.strokeChanged) this.remember(this.before);
    this.before = undefined;
    this.strokeChanged = false;
  }
  cancelStroke(): void {
    if (!this.before) return;
    this.restore(this.before);
    this.before = undefined;
    this.strokeChanged = false;
    this.invalidateAll();
  }
  paint(at: Point, radius: number, terrain: Terrain): boolean {
    return this.paintSegment(at, at, radius, terrain);
  }
  paintSegment(from: Point, to: Point, radius: number, terrain: Terrain): boolean {
    radius = f(radius);
    const map = this.landscape;
    if (
      !map.inside(from) ||
      !map.inside(to) ||
      !Number.isFinite(radius) ||
      radius < f(0.5) ||
      radius > 16 ||
      !Number.isInteger(terrain) ||
      terrain < 0 ||
      terrain >= 12
    )
      return false;
    const ownStroke = !this.stroking();
    this.beginStroke();
    const brush = new BrushSegment(from, to),
      radiusSquared = f(radius * radius),
      innerSquared = f(f(radiusSquared * f(0.75)) * f(0.75));
    const target = [0.5, 0.48, 0.45, 0, 0.1, -0.2, 0.35].map(f);
    switch (terrain) {
      case Terrain.Meadow:
        target[2] = f(0.22);
        break;
      case Terrain.Forest:
        target[2] = f(0.75);
        break;
      case Terrain.Water:
        target[1] = f(0.14);
        break;
      case Terrain.Rock:
        target[1] = f(0.88);
        break;
      case Terrain.Sand:
        target[0] = f(0.025);
        target[4] = f(0.85);
        break;
      case Terrain.Sea:
        target[0] = f(-0.4);
        break;
      case Terrain.Mountain:
        target[1] = f(0.62);
        target[5] = f(0.16);
        break;
      case Terrain.Ash:
        target[2] = f(0.22);
        target[6] = f(0.85);
        break;
      case Terrain.Frost:
        target[6] = f(0.12);
        break;
      case Terrain.Ice:
        target[1] = f(0.66);
        target[6] = f(0.1);
        break;
      case Terrain.Lava:
        target[5] = f(0.05);
        target[6] = f(0.9);
        break;
    }
    const dirty = brush.bounds(f(radius + 2)),
      riverDirty = new TileRegion(),
      carved: number[] = [];
    if (terrain !== Terrain.Water)
      for (let i = 0; i < map.stream.path.length; i++) {
        const reach = f(radius + f(map.stream.width[i] / 2));
        if (map.stream.width[i] > 0 && brush.distanceSquared(map.stream.path[i]) <= f(reach * reach)) {
          carved.push(i);
          for (let n = i > 0 ? i - 1 : 0; n <= Math.min(i + 1, map.stream.path.length - 1); n++) {
            const p = map.stream.path[n],
              reach = f(Math.max(map.stream.width[i], map.stream.width[n]) + 2);
            riverDirty.include(
              new TileRegion(
                Math.floor(f(p.x - reach)),
                Math.floor(f(p.y - reach)),
                Math.ceil(f(p.x + reach)),
                Math.ceil(f(p.y + reach)),
              ),
            );
          }
        }
      }
    this.captureSegment(from, to, f(radius + 2));
    this.capture(riverDirty, false);
    dirty.include(riverDirty);
    let changed = !!carved.length;
    for (const i of carved) map.stream.width[i] = 0;
    const stride = map.columns * 2 + 1,
      samples = brush.bounds(radius),
      top = Math.max(0, samples.top * 2),
      bottom = Math.min(map.rows * 2, samples.bottom * 2);
    for (let y = top; y <= bottom; y++) {
      const sampleY = f(y / 2),
        [low, high] = brush.columns(sampleY, sampleY, radius),
        left = Math.max(0, Math.floor(f(low * 2))),
        right = Math.min(map.columns * 2, Math.ceil(f(high * 2)));
      for (let x = left; x <= right; x++) {
        const d = brush.distanceSquared(point(f(x / 2), sampleY));
        if (d > radiusSquared) continue;
        let weight = d <= innerSquared ? 1 : clamp(f(f(1 - f(f(Math.sqrt(d)) / radius)) / f(0.25)), 0, 1);
        weight = f(f(weight * weight) * f(3 - f(2 * weight)));
        for (let layer = 0; layer < Layer.Count; layer++) {
          if (layer === Layer.Shade) continue;
          const index = y * stride + x,
            value = map.layers[layer][index],
            next = f(value + f(f(target[layer] - value) * weight));
          if (Math.abs(f(next - value)) > f(0.00001)) {
            map.layers[layer][index] = next;
            changed = true;
          }
        }
      }
    }
    const x0 = Math.max(0, dirty.left),
      x1 = Math.min(map.columns, dirty.right),
      y0 = Math.max(0, dirty.top),
      y1 = Math.min(map.rows, dirty.bottom),
      cacheSquared = f(f(radius + 1) * f(radius + 1));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const d = brush.distanceSquared(point(x + 0.5, y + 0.5)),
          byRiver =
            x >= riverDirty.left && x < riverDirty.right && y >= riverDirty.top && y < riverDirty.bottom;
        if (d > cacheSquared && !byRiver) continue;
        const tile = map.at(x, y),
          next = map.terrainAt(point(x + 0.5, y + 0.5));
        changed = tile.terrain !== next || changed;
        tile.terrain = next;
        if (d > radiusSquared) continue;
        if (tile.quarried) {
          tile.quarried = false;
          changed = true;
        }
        const trees = tile.terrain === terrain ? wildTrees(map, x, y) : 0;
        if (tile.trees !== trees || tile.wild !== trees) {
          tile.trees = tile.wild = trees;
          changed = true;
        }
      }
    if (changed) this.touch(dirty);
    if (ownStroke) this.endStroke();
    return changed;
  }
  clearTrees(at: Point, radius: number): boolean {
    return this.clearTreesSegment(at, at, radius);
  }
  clearTreesSegment(from: Point, to: Point, radius: number): boolean {
    radius = f(radius);
    const map = this.landscape;
    if (!map.inside(from) || !map.inside(to) || !Number.isFinite(radius) || radius < f(0.5) || radius > 16)
      return false;
    const ownStroke = !this.stroking();
    this.beginStroke();
    let changed = false;
    const brush = new BrushSegment(from, to),
      dirty = brush.bounds(f(radius + 1)),
      squared = f(radius * radius);
    this.captureSegment(from, to, f(radius + 1), false);
    for (let y = Math.max(0, dirty.top); y < Math.min(map.rows, dirty.bottom); y++)
      for (let x = Math.max(0, dirty.left); x < Math.min(map.columns, dirty.right); x++) {
        const tile = map.at(x, y);
        if (brush.distanceSquared(point(x + 0.5, y + 0.5)) <= squared && (tile.trees || tile.wild)) {
          tile.trees = tile.wild = 0;
          changed = true;
        }
      }
    if (changed) this.touch(dirty);
    if (ownStroke) this.endStroke();
    return changed;
  }
  private indexDungeons(): void {
    const map = this.landscape;
    this.capture(new TileRegion(0, 0, map.columns, map.rows), false);
    for (const tile of map.tiles) tile.dungeon = -1;
    map.sites.forEach((site, i) => {
      for (let y = site.origin.y; y < site.origin.y + 2; y++)
        for (let x = site.origin.x; x < site.origin.x + 2; x++) map.at(x, y).dungeon = i;
    });
  }
  setStart(at: Point): boolean {
    const map = this.landscape;
    if (!map.inside(at)) return false;
    const next = { x: Math.trunc(at.x), y: Math.trunc(at.y) };
    if (!clearing(map, next, 2)) return false;
    this.beginStroke();
    const moved = next.x !== map.origin.x || next.y !== map.origin.y;
    map.origin = next;
    const cleared = this.clearTrees(map.camp(), f(3.6));
    if (moved) this.touch(new TileRegion(next.x - 4, next.y - 4, next.x + 5, next.y + 5));
    this.endStroke();
    return moved || cleared;
  }
  addDungeon(at: Point, kind: DungeonKind): boolean {
    const map = this.landscape;
    if (
      !map.inside(at) ||
      !Number.isInteger(kind) ||
      kind < 0 ||
      kind > DungeonKind.GiantHall ||
      map.sites.length >= 64
    )
      return false;
    const origin = { x: Math.trunc(at.x), y: Math.trunc(at.y) };
    if (
      !map.inside(origin.x + 1, origin.y + 1) ||
      distance(map.camp(), point(origin.x + 1, origin.y + 1)) < 4
    )
      return false;
    for (let y = origin.y; y < origin.y + 2; y++)
      for (let x = origin.x; x < origin.x + 2; x++)
        if (!dungeonGround(map.terrainAt(point(x + 0.5, y + 0.5))) || map.at(x, y).dungeon >= 0) return false;
    if (!doorstep(map, origin)) return false;
    // Native names[4] was undefined for GiantHall; use its existing editor label.
    const names = ['Cave', 'Crypt', 'Portal', 'Ruin', 'Giant hall'];
    this.beginStroke();
    map.sites.push({ name: `${names[kind]} ${map.sites.length + 1}`, kind, origin, discovered: false });
    this.indexDungeons();
    this.clearTrees(point(origin.x + 1, origin.y + 1), 2);
    this.touch(new TileRegion(origin.x - 2, origin.y - 2, origin.x + 4, origin.y + 4));
    this.endStroke();
    return true;
  }
  removeDungeon(at: Point): boolean {
    const map = this.landscape,
      tile = map.cell(at);
    if (!tile || tile.dungeon < 0) return false;
    const id = tile.dungeon,
      origin = map.sites[id].origin;
    this.beginStroke();
    map.sites.splice(id, 1);
    this.indexDungeons();
    this.touch(new TileRegion(origin.x - 2, origin.y - 2, origin.x + 4, origin.y + 4));
    this.endStroke();
    return true;
  }
  regenerate(seed: number, size: number): boolean {
    if (!MapDocument.validSize(size)) return false;
    this.endStroke();
    const next = new MapDocument(WorldMap.generate(seed, size, size));
    const hasHome = (at: Point) =>
      next.map().sites.some((site) => distance(at, point(site.origin.x + 1, site.origin.y + 1)) <= 12);
    if (!clearing(next.map(), next.map().start(), 2) || !hasHome(next.map().camp())) {
      let best = next.map().camp(),
        nearest = 3.4028234663852886e38,
        found = false;
      for (let y = 3; y < size - 3; y++)
        for (let x = 3; x < size - 3; x++) {
          const at = point(x + 0.5, y + 0.5),
            gap = distance(at, next.map().camp());
          if (gap >= nearest || !hasHome(at) || !clearing(next.map(), { x, y }, 2)) continue;
          nearest = gap;
          best = at;
          found = true;
        }
      if (!found) next.paint(best, 5, Terrain.Grass);
      next.setStart(best);
      if (!hasHome(next.map().camp())) {
        const home = point(best.x + (best.x < size / 2 ? 8 : -8), best.y);
        next.paint(home, 3, Terrain.Grass);
        next.addDungeon(home, DungeonKind.Ruin);
      }
    }
    this.remember(snapshot(this.landscape, this.currentId));
    this.landscape = next.landscape;
    this.invalidateAll();
    return true;
  }
  undo(): void {
    this.endStroke();
    const value = this.past.pop();
    if (!value) return;
    this.restore(value);
    this.future.push(value);
    this.invalidateAll();
  }
  redo(): void {
    this.endStroke();
    const value = this.future.pop();
    if (!value) return;
    this.restore(value);
    this.past.push(value);
    this.invalidateAll();
  }
  validation(): string {
    const map = this.landscape;
    if (!clearing(map, map.origin, 2)) return 'Start needs a dry, level 5 x 5 clearing.';
    for (let y = map.origin.y - 2; y <= map.origin.y + 2; y++)
      for (let x = map.origin.x - 2; x <= map.origin.x + 2; x++)
        if (map.at(x, y).trees) return 'Clear the trees around the start before playing.';
    let nearby = false;
    for (const site of map.sites) {
      const at = site.origin;
      for (let y = at.y; y < at.y + 2; y++)
        for (let x = at.x; x < at.x + 2; x++)
          if (!dungeonGround(map.terrainAt(point(x + 0.5, y + 0.5))))
            return 'Dungeon entrances need dry ground away from mountains, ice and lava.';
      if (!doorstep(map, at))
        return 'Dungeon doorsteps (south of the entrance) need ground delvers can walk.';
      nearby = distance(map.camp(), point(at.x + 1, at.y + 1)) <= 12 || nearby;
    }
    return nearby ? '' : 'Place a dungeon within 12 tiles of the start.';
  }
  gameMap(): WorldMap {
    const map = cloneMap(this.landscape);
    map.seen = [];
    for (const tile of map.tiles) tile.revealed = false;
    for (const site of map.sites) site.discovered = false;
    if (map.sites.length) {
      let nearest = 0;
      for (let i = 1; i < map.sites.length; i++)
        if (
          distance(map.camp(), point(map.sites[i].origin.x + 1, map.sites[i].origin.y + 1)) <
          distance(map.camp(), point(map.sites[nearest].origin.x + 1, map.sites[nearest].origin.y + 1))
        )
          nearest = i;
      [map.sites[0], map.sites[nearest]] = [map.sites[nearest], map.sites[0]];
      map.sites[0].discovered = true;
      for (const tile of map.tiles) tile.dungeon = -1;
      map.sites.forEach((site, i) => {
        for (let y = 0; y < 2; y++)
          for (let x = 0; x < 2; x++) map.at(site.origin.x + x, site.origin.y + y).dungeon = i;
      });
    }
    map.revealStart();
    map.discover();
    return map;
  }
  previewMap(): WorldMap {
    const map = cloneMap(this.landscape);
    map.seen = [{ center: point(map.width() / 2, map.height() / 2), radius: f(map.width() + map.height()) }];
    for (const tile of map.tiles) tile.revealed = true;
    for (const site of map.sites) site.discovered = true;
    return map;
  }
  updatePreview(map: WorldMap, area: TileRegion): WorldMap {
    const source = this.landscape;
    if (map.width() !== source.width() || map.height() !== source.height() || map.seed() !== source.seed())
      return this.previewMap();
    const left = clamp(area.left, 0, source.width()),
      right = clamp(area.right, 0, source.width()),
      top = clamp(area.top, 0, source.height()),
      bottom = clamp(area.bottom, 0, source.height());
    if (left < right && top < bottom) {
      for (let y = top; y < bottom; y++)
        for (let x = left; x < right; x++)
          map.tiles[y * map.columns + x] = { ...source.at(x, y), revealed: true };
      const stride = source.columns * 2 + 1,
        sampleLeft = left * 2,
        count = (right - left) * 2 + 1;
      for (let layer = 0; layer < Layer.Count; layer++)
        for (let y = top * 2; y <= bottom * 2; y++) {
          const offset = y * stride + sampleLeft;
          map.layers[layer].set(source.layers[layer].subarray(offset, offset + count), offset);
        }
    }
    map.origin = { ...source.origin };
    map.stream = structuredClone(source.stream);
    map.ymir = source.ymir ? new Giant({ ...source.ymir.origin }) : null;
    map.fire = source.fire ? new Volcano({ ...source.fire.origin }) : null;
    for (const site of map.sites)
      for (let y = site.origin.y; y < site.origin.y + 2; y++)
        for (let x = site.origin.x; x < site.origin.x + 2; x++) map.at(x, y).dungeon = -1;
    map.sites = structuredClone(source.sites);
    map.sites.forEach((site, i) => {
      site.discovered = true;
      for (let y = site.origin.y; y < site.origin.y + 2; y++)
        for (let x = site.origin.x; x < site.origin.x + 2; x++) map.at(x, y).dungeon = i;
    });
    return map;
  }
  encode(): string {
    const map = this.landscape,
      giant = map.ymir?.origin ?? { x: -1, y: -1 };
    const lines = [
      `hearthold-map 4`,
      `${map.mapSeed} ${map.columns} ${map.rows} ${map.origin.x} ${map.origin.y} ${Number(map.laidOut)} ${giant.x} ${giant.y}`,
    ];
    for (const layer of map.layers) lines.push(Array.from(layer, nativeFloat).join(' ') + ' ');
    lines.push(map.tiles.map((tile) => `${tile.trees} ${tile.wild} ${Number(tile.quarried)} `).join(''));
    lines.push(String(map.stream.path.length));
    map.stream.path.forEach((p, i) =>
      lines.push(`${nativeFloat(p.x)} ${nativeFloat(p.y)} ${nativeFloat(map.stream.width[i])}`),
    );
    lines.push(String(map.sites.length));
    for (const site of map.sites)
      lines.push(`${quoted(site.name)} ${site.kind} ${site.origin.x} ${site.origin.y}`);
    return lines.join('\n') + '\n';
  }
  static decode(text: string): WorldMap {
    const error = 'Invalid or incomplete Hearthold map file.';
    if (utf8Bytes(text) > maxMapBytes) throw new Error('Map file exceeds 40 MiB.');
    const input = new NativeReader(text, error),
      map = new WorldMap();
    input.key('hearthold-map');
    const version = input.integer(1, 4);
    map.mapSeed = input.integer(0, 4294967295);
    map.columns = input.integer(32, 256);
    map.rows = input.integer(32, 256);
    map.origin = { x: input.integer(0, map.columns - 1), y: input.integer(0, map.rows - 1) };
    const regions = version >= 2 ? input.integer(0, 1) : 0;
    map.laidOut = regions === 1 && version >= 3;
    if (map.laidOut) map.fire = Volcano.around(map.fireMountain());
    if (version >= 3) {
      const giant = { x: input.integer(-1, map.columns - 1), y: input.integer(-1, map.rows - 1) };
      if (giant.x !== -1 || giant.y !== -1) {
        if (!map.inside(giant.x, giant.y) || !map.inside(giant.x + Giant.size - 1, giant.y + Giant.size - 1))
          throw new Error(error);
        map.ymir = new Giant(giant);
      }
    }
    const count = (map.columns * 2 + 1) * (map.rows * 2 + 1);
    map.layers = Array.from({ length: Layer.Count }, () => {
      const layer = new Float32Array(count);
      for (let i = 0; i < count; i++) layer[i] = input.float(-8, 8);
      return layer;
    });
    if (version === 1) {
      const heat = map.layers[Layer.Heat],
        moisture = map.layers[Layer.Moisture];
      for (let i = 0; i < count; i++)
        heat[i] =
          moisture[i] < f(0.45)
            ? clamp(f(heat[i] + f(0.02)), f(0.3), f(lavaFloor - f(0.01)))
            : clamp(heat[i], f(0.3), f(0.62));
      map.laidOut = false;
    }
    map.tiles = Array.from({ length: map.columns * map.rows }, () => ({
      ...makeTile(),
      trees: input.integer(0, 3),
      wild: input.integer(0, 3),
      quarried: version >= 4 ? input.integer(0, 1) !== 0 : false,
    }));
    const rivers = input.integer(0, 4096);
    for (let i = 0; i < rivers; i++) {
      map.stream.path.push(point(input.float(0, map.width()), input.float(0, map.height())));
      map.stream.width.push(input.float(0, 16));
    }
    const sites = input.integer(0, 64);
    for (let i = 0; i < sites; i++) {
      const name = input.token();
      if (!validNativeName(name)) throw new Error(error);
      map.sites.push({
        name,
        kind: input.integer(0, DungeonKind.GiantHall),
        origin: { x: input.integer(0, map.columns - 2), y: input.integer(0, map.rows - 2) },
        discovered: false,
      });
    }
    input.end();
    for (let y = 0; y < map.height(); y++)
      for (let x = 0; x < map.width(); x++) {
        const tile = map.at(x, y);
        tile.terrain = map.terrainAt(point(x + 0.5, y + 0.5));
        tile.shade = Math.trunc(clamp(f(map.value(Layer.Shade, point(x + 0.5, y + 0.5)) * 4), 0, 3));
      }
    map.sites.forEach((site, i) => {
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          const tile = map.at(site.origin.x + x, site.origin.y + y);
          if (tile.dungeon >= 0) throw new Error(error);
          tile.dungeon = i;
        }
    });
    return map;
  }
  loadText(text: string): void {
    const next = MapDocument.decode(text);
    this.endStroke();
    this.remember(snapshot(this.landscape, this.currentId));
    this.landscape = next;
    this.savedId = this.currentId;
    this.invalidateAll();
  }
  async save(path: string, files: DocumentFiles): Promise<void> {
    this.endStroke();
    if (!path) throw new Error('Enter a map file path.');
    const id = this.currentId;
    await files.write(path, this.encode(), maxMapBytes);
    this.savedId = id;
  }
  async load(path: string, files: DocumentFiles): Promise<void> {
    this.loadText(await files.read(path, maxMapBytes));
  }
}
