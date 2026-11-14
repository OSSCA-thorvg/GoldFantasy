import { Resources } from './building-catalog';
import { distance, point, segmentDistance, type Point } from './geometry';
import { clamp, hash01 } from './numeric';
import { Layer, Terrain, World, type TileCoord } from './world-types';
import type { WorldMap } from './world-map';

/** Square of open sea that the world beyond a gate is raised from and sunk back into. */
export interface RealmArea {
  x: number;
  y: number;
  size: number;
}
export enum ChamberKind {
  Entry,
  Den,
  Heart,
}
export interface Chamber {
  kind: ChamberKind;
  center: Point;
  radius: number;
  links: number[];
}
export interface RealmPlan {
  area: RealmArea;
  chambers: Chamber[];
  /** Tile origin of the two-by-two way home. */
  gate: TileCoord;
  /** Where the party stands on arrival, in front of the way home. */
  entry: Point;
}
export const realmSizes = { most: 44, least: 20, margin: 2 };
export const inArea = (area: RealmArea | null, p: Point): boolean =>
  !!area && p.x >= area.x && p.y >= area.y && p.x < area.x + area.size && p.y < area.y + area.size;

/** Largest all-sea square; deterministic for a map whose realm has been sunk again. */
export function findRealmArea(map: WorldMap): RealmArea | null {
  const width = map.width(),
    height = map.height(),
    span = new Int32Array(width * height);
  let best = { side: 0, x: 0, y: 0 };
  for (let y = 0; y < height; ++y)
    for (let x = 0; x < width; ++x) {
      if (map.at(x, y).terrain !== Terrain.Sea) continue;
      const side =
        1 +
        (x && y
          ? Math.min(span[(y - 1) * width + x], span[y * width + x - 1], span[(y - 1) * width + x - 1])
          : 0);
      span[y * width + x] = side;
      if (side > best.side) best = { side, x: x - side + 1, y: y - side + 1 };
    }
  const size = Math.min(realmSizes.most, best.side - realmSizes.margin * 2);
  if (size < realmSizes.least) return null;
  const inset = Math.floor((best.side - size) / 2);
  return { x: best.x + inset, y: best.y + inset, size };
}

/** Chambers and the links between them depend only on seed, gate and floor. */
export function planRealm(seed: number, gate: number, floor: number, area: RealmArea): RealmPlan {
  const n = area.size >= 40 ? 3 : 2,
    cell = (area.size - 8) / n,
    rnd = (i: number, salt: number) => hash01(seed, gate * 31 + floor, i, 500 + salt),
    chambers: Chamber[] = [],
    slots = new Map<number, number>(),
    add = (column: number, row: number, kind: ChamberKind): number => {
      const key = column * n + row,
        existing = slots.get(key);
      if (existing !== undefined) return existing;
      const jitter = cell * 0.1;
      chambers.push({
        kind,
        center: point(
          area.x + 4 + cell * (column + 0.5) + (rnd(key, 1) - 0.5) * 2 * jitter,
          area.y + 4 + cell * (row + 0.5) + (rnd(key, 2) - 0.5) * 2 * jitter,
        ),
        radius: cell * (kind === ChamberKind.Heart ? 0.36 : kind === ChamberKind.Entry ? 0.27 : 0.29),
        links: [],
      });
      slots.set(key, chambers.length - 1);
      return chambers.length - 1;
    },
    link = (a: number, b: number) => {
      if (a === b || chambers[a].links.includes(b)) return;
      chambers[a].links.push(b);
      chambers[b].links.push(a);
    };
  let row = Math.min(n - 1, Math.floor(rnd(0, 0) * n)),
    previous = add(0, row, ChamberKind.Entry);
  for (let column = 1; column < n; ++column) {
    const target = Math.min(n - 1, Math.floor(rnd(column, 3) * n));
    while (row !== target) {
      row += Math.sign(target - row);
      const turn = add(column - 1, row, ChamberKind.Den);
      link(previous, turn);
      previous = turn;
    }
    const next = add(column, row, column === n - 1 ? ChamberKind.Heart : ChamberKind.Den);
    link(previous, next);
    previous = next;
  }
  // Side dens hang off the main way so a floor has more to fight than its shortest path.
  for (let column = 0; column < n; ++column)
    for (let at = 0; at < n; ++at) {
      if (slots.has(column * n + at) || rnd(column * n + at, 4) < 0.25) continue;
      const near = [
        [column - 1, at],
        [column, at - 1],
        [column + 1, at],
        [column, at + 1],
      ]
        .map(([c, r]) => slots.get(c * n + r))
        .filter((index): index is number => index !== undefined && chambers[index].kind !== ChamberKind.Heart);
      if (!near.length) continue;
      link(near[Math.floor(rnd(column * n + at, 5) * near.length) % near.length], add(column, at, ChamberKind.Den));
    }
  const start = chambers[0].center,
    gateAt = { x: Math.round(start.x) - 1, y: Math.round(start.y) - 2 };
  return { area, chambers, gate: gateAt, entry: point(gateAt.x + 1, gateAt.y + 2.6) };
}

interface Theme {
  elevation: number;
  moisture: number;
  heat: number;
  wall: 'mountain' | 'lava' | 'ice' | 'water';
}
/** Every world is built from the terrain the overworld already paints. */
export function realmTheme(world: World): Theme {
  switch (world) {
    case World.Asgard:
      return { elevation: 0.5, moisture: 0.3, heat: 0.45, wall: 'mountain' };
    case World.Vanaheim:
      return { elevation: 0.5, moisture: 0.45, heat: 0.45, wall: 'water' };
    case World.Alfheim:
      return { elevation: 0.5, moisture: 0.6, heat: 0.45, wall: 'mountain' };
    case World.Jotunheim:
      return { elevation: 0.5, moisture: 0.3, heat: 0.22, wall: 'mountain' };
    case World.Svartalfheim:
      return { elevation: 0.8, moisture: 0.3, heat: 0.45, wall: 'mountain' };
    case World.Niflheim:
      return { elevation: 0.45, moisture: 0.3, heat: 0.22, wall: 'ice' };
    case World.Muspelheim:
      return { elevation: 0.5, moisture: 0.2, heat: 0.9, wall: 'lava' };
    default:
      return { elevation: 0.5, moisture: 0.3, heat: 0.7, wall: 'mountain' };
  }
}
const smooth = (seed: number, x: number, y: number, scale: number, salt: number): number => {
  const u = x / scale,
    v = y / scale,
    i = Math.floor(u),
    j = Math.floor(v),
    fx = u - i,
    fy = v - j,
    a = hash01(seed, i, j, salt),
    b = hash01(seed, i + 1, j, salt),
    c = hash01(seed, i, j + 1, salt),
    d = hash01(seed, i + 1, j + 1, salt);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
};
/** Signed distance to walkable floor: negative inside chambers and corridors. */
export function realmFloorDistance(plan: RealmPlan, p: Point): number {
  let gap = Infinity;
  plan.chambers.forEach((chamber, index) => {
    gap = Math.min(gap, distance(p, chamber.center) - chamber.radius);
    for (const next of chamber.links)
      if (next > index)
        gap = Math.min(gap, segmentDistance(p, chamber.center, plan.chambers[next].center) - 1.5);
  });
  return gap;
}
/** The ragged edge of the floor exactly as it is stamped: negative is walkable floor. */
export function realmGap(seed: number, plan: RealmPlan, p: Point): number {
  return realmFloorDistance(plan, p) + (smooth(seed, p.x, p.y, 2.5, 511) - 0.5) * 0.7;
}
function retile(map: WorldMap, area: RealmArea): void {
  for (let y = area.y; y < area.y + area.size; ++y)
    for (let x = area.x; x < area.x + area.size; ++x) {
      const tile = map.at(x, y),
        center = point(x + 0.5, y + 0.5);
      tile.terrain = map.terrainAt(center);
      tile.shade = Math.trunc(Math.min(3, map.value(Layer.Shade, center) * 4));
      tile.trees = tile.wild = 0;
      tile.dungeon = -1;
      tile.revealed = tile.quarried = false;
    }
  // Forget only what was seen from inside the square: a look from Midgard that merely reached over
  // the sea also covers land outside it, and dropping it would hide what it revealed there.
  map.seen = map.seen.filter((sight) => !inArea(area, sight.center));
}
/** Raises an island of the given world out of the sea square. */
export function stampRealm(map: WorldMap, plan: RealmPlan, world: World): void {
  const { area } = plan,
    theme = realmTheme(world),
    stride = map.width() * 2 + 1,
    middle = point(area.x + area.size / 2, area.y + area.size / 2),
    seed = map.seed();
  for (let j = area.y * 2; j <= (area.y + area.size) * 2; ++j)
    for (let i = area.x * 2; i <= (area.x + area.size) * 2; ++i) {
      const p = point(i / 2, j / 2),
        at = j * stride + i,
        dx = Math.abs(p.x - middle.x),
        dy = Math.abs(p.y - middle.y),
        rim = area.size / 2 - 2.2 + (smooth(seed, p.x, p.y, 4, 510) - 0.5) * 2.4,
        shore = clamp((rim - Math.pow(dx ** 4 + dy ** 4, 0.25)) / 2.5, -3, 0.7),
        gap = realmGap(seed, plan, p),
        floor = gap < 0,
        // Low ridges: tall peaks would hide the party walking between them.
        deep = Math.min(0.06, 0.02 + Math.max(0, gap - 2) * 0.02);
      let elevation = theme.elevation,
        heat = theme.heat,
        ridge = -0.5;
      if (!floor) {
        if (theme.wall === 'mountain') ridge = Math.min(0.06, 0.02 + gap * 0.02);
        else if (theme.wall === 'lava') ridge = gap < 2 ? 0 : deep + 0.08;
        else if (theme.wall === 'ice') {
          heat = 0.1;
          elevation = 0.62;
          if (gap >= 2.5) ridge = deep;
        } else {
          if (gap < 2) elevation = 0.12;
          else ridge = deep;
        }
      }
      map.layer(Layer.Land)[at] = floor ? Math.max(shore, 0.5) : shore;
      map.layer(Layer.Elevation)[at] = elevation;
      map.layer(Layer.Moisture)[at] = theme.moisture;
      map.layer(Layer.Heat)[at] = heat;
      map.layer(Layer.Ridge)[at] = ridge;
      map.layer(Layer.Beach)[at] = 0.8;
      map.layer(Layer.Shade)[at] = 0.3;
    }
  retile(map, area);
}
/** Sinks the island again; deep sea is uniform, so the square leaves no seam. */
export function sinkRealm(map: WorldMap, area: RealmArea): void {
  const stride = map.width() * 2 + 1;
  for (let j = area.y * 2; j <= (area.y + area.size) * 2; ++j)
    for (let i = area.x * 2; i <= (area.x + area.size) * 2; ++i) {
      map.layer(Layer.Land)[j * stride + i] = -3;
      map.layer(Layer.Ridge)[j * stride + i] = -0.5;
    }
  retile(map, area);
}

/** Each world pays in what it is made of, so the gate chosen decides the reward. */
export function worldHoard(world: World, floor: number, share = 1): Resources {
  const k = (1 + floor * 0.5) * share,
    n = (amount: number) => Math.round(amount * k);
  switch (world) {
    case World.Asgard:
      return new Resources(n(20), 0, 0, 0, n(4));
    case World.Vanaheim:
      return new Resources(n(8), 0, 0, n(24));
    case World.Alfheim:
      return new Resources(0, 0, 0, n(10), n(8));
    case World.Jotunheim:
      return new Resources(0, 0, n(16), 0, 0, 0, 0, 0, n(4));
    case World.Svartalfheim:
      return new Resources(n(14), 0, 0, 0, 0, 0, 0, n(6));
    case World.Niflheim:
      return new Resources(0, 0, 0, 0, n(6), n(12));
    case World.Muspelheim:
      return new Resources(n(22), 0, 0, 0, 0, 0, 0, n(3));
    default:
      return new Resources(0, 0, 0, 0, n(5), 0, 0, 0, n(10));
  }
}
