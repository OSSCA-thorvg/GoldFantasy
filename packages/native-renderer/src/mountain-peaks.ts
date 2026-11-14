import { lerp, project, unproject, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { Layer, Terrain } from '../../engine/src/world-types';
import type { WorldMap } from '../../engine/src/world-map';
import { ShapeNode } from './paint';
import { appendPolygon, fill, opaque, verticalShade } from './vector-paint';
import type { Climate } from './render-types';
const f = Math.fround;
export interface Peak {
  foot: Point;
  rise: number;
  volcanic: boolean;
  lean: number;
  /** Screen pixels from foot to apex. */
  height: number;
  /** Half the base on screen, in pixels. */
  half: number;
  /** How far the base reaches forward of the foot, in pixels. */
  drop: number;
  /** Tiles to the nearest ground that is not mountain: 1 on the edge of a range. */
  depth: number;
  /** One of a range's dominant summits: shoulders on its flanks and always a snow cap. */
  summit: boolean;
}
/** What the painter needs; the layout fields fall back to a lone high peak. */
export type PeakShape = Pick<Peak, 'foot' | 'rise' | 'volcanic' | 'lean'> &
  Partial<Pick<Peak, 'height' | 'half' | 'drop' | 'summit'>>;
/** The old proportions: the walls of a world beyond a gate keep them, so a party in a lane stays in view. */
export const lowPeak = (rise: number): number => f(30 + f(80 * rise));
const lowHalf = (rise: number): number => f(20 + f(20 * rise));
/** A grown fir: a peak no taller than this may be a little steeper than one that stands over the forest. */
export const grownFir = 78;
/** Highest a peak may stand on a base this wide: no needles. */
export const slopeLimit = (base: number): number => Math.max(base, Math.min(f(1.3 * base), grownFir));
/** How far a base may reach past the mountain tiles under it: a quarter of a tile. */
export const baseSlack = 16;
/** Height wanted at a depth into the range: foothills on the edge, summits deep in a broad massif. */
export function depthHeight(depth: number, roll: number): number {
  if (depth <= 1) return f(100 + 25 * roll);
  if (depth === 2) return f(145 + 25 * roll);
  if (depth === 3) return f(185 + 30 * roll);
  return f(220 + 40 * roll);
}
const lowGround = new WeakMap<object, { x: number; y: number; size: number }>();
interface Layout {
  print: number;
  area: string;
  peaks: Map<number, Peak>;
}
const layouts = new WeakMap<WorldMap, Layout>();
const areaKey = (map: WorldMap) => {
  const a = lowGround.get(map);
  return a ? `${a.x}:${a.y}:${a.size}` : '';
};
/** A cheap print of where the mountains are, so a stamped or edited map lays its ranges out again. */
function terrainPrint(map: WorldMap): number {
  let h = 0x811c9dc5;
  for (let y = 0; y < map.height(); y++)
    for (let x = 0; x < map.width(); x++)
      if (map.at(x, y).terrain === Terrain.Mountain) h = Math.imul(h ^ (y * map.width() + x), 0x01000193);
  return h >>> 0;
}
/** The square of the world beyond a gate, if a party is there: its walls stay low. */
export function settlePeaks(map: WorldMap, area: { x: number; y: number; size: number } | null): void {
  if (area) lowGround.set(map, area);
  else lowGround.delete(map);
  const layout = layouts.get(map);
  if (layout && (layout.area !== areaKey(map) || layout.print !== terrainPrint(map))) layouts.delete(map);
}
/** No taller than the drop from its foot to anything it stands in front of, so it never hides a gate or the statue. */
function ceiling(map: WorldMap, foot: Point, half: number): number {
  const at = project(foot.x, foot.y),
    giant = map.giant(),
    marks = map.dungeons().map((d) => ({ x: f(d.origin.x + 1), y: f(d.origin.y + 1) }));
  if (giant) marks.push(giant.center());
  let most = Infinity;
  for (const mark of marks) {
    const p = project(mark.x, mark.y);
    if (p.y < at.y && Math.abs(f(p.x - at.x)) < f(half + 64)) most = Math.min(most, f(at.y - p.y));
  }
  return most;
}
export const volcanicPeak = (map: WorldMap, foot: Point): boolean => map.value(Layer.Heat, foot) > f(0.62);
/** Mountain ground a peak may stand on: not under the statue or the volcano, whose own art rises there. */
function rock(map: WorldMap, x: number, y: number): boolean {
  if (!map.inside(x, y) || map.at(x, y).terrain !== Terrain.Mountain) return false;
  const middle = { x: f(x + f(0.5)), y: f(y + f(0.5)) };
  return !map.giant()?.covers(middle) && !map.volcano()?.covers(middle);
}
/** Tiles from every mountain tile to the nearest other ground (8 neighbours, the map's edge counts as other). */
export function mountainDepth(map: WorldMap): Uint8Array {
  const w = map.width(),
    h = map.height(),
    depth = new Uint8Array(w * h),
    queue = new Int32Array(w * h);
  let head = 0,
    tail = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (rock(map, x, y)) {
        let edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        for (let dy = -1; dy <= 1 && !edge; dy++)
          for (let dx = -1; dx <= 1 && !edge; dx++) if (!rock(map, x + dx, y + dy)) edge = true;
        if (!edge) continue;
        depth[y * w + x] = 1;
        queue[tail++] = y * w + x;
      }
  while (head < tail) {
    const at = queue[head++],
      x = at % w,
      y = (at - x) / w;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy,
          next = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || depth[next] || !rock(map, nx, ny)) continue;
        depth[next] = Math.min(255, depth[at] + 1);
        queue[tail++] = next;
      }
  }
  return depth;
}
/** Screen pixels of mountain to the left and to the right of a point, along its screen row. */
function run(map: WorldMap, at: Point, reach: number): { left: number; right: number } {
  const solid = (sx: number) => {
    const t = unproject(sx, at.y);
    return rock(map, Math.floor(t.x), Math.floor(t.y));
  };
  let left = 0,
    right = 0;
  while (left < reach && solid(at.x - left - 4)) left += 4;
  while (right < reach && solid(at.x + right + 4)) right += 4;
  return { left, right };
}
/** The walls of a world beyond a gate: one low peak on about half its mountain tiles, as before. */
function wallPeak(map: WorldMap, x: number, y: number): Peak | undefined {
  if (hash01(map.seed(), x, y, 62) >= f(0.55)) return;
  const foot = {
      x: f(f(x + f(0.3)) + f(hash01(map.seed(), x, y, 63) * f(0.4))),
      y: f(f(y + f(0.3)) + f(hash01(map.seed(), x, y, 64) * f(0.4))),
    },
    rise = Math.max(0, Math.min(1, f(map.value(Layer.Ridge, foot) * 7))),
    half = lowHalf(rise);
  return {
    foot,
    rise,
    volcanic: volcanicPeak(map, foot),
    lean: f(f(hash01(map.seed(), x, y, 65) - f(0.5)) * f(0.4)),
    height: lowPeak(rise),
    half,
    drop: f(half * f(0.26)),
    depth: 1,
    summit: false,
  };
}
const inTriangle = (p: Point, a: Point, b: Point, c: Point): boolean => {
  const s = (u: Point, v: Point) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x),
    d1 = s(a, b),
    d2 = s(b, c),
    d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const outline = (p: Peak) => {
  const b = project(p.foot.x, p.foot.y);
  return {
    left: { x: f(b.x - p.half), y: b.y },
    right: { x: f(b.x + p.half), y: b.y },
    apex: { x: f(b.x + f(f(p.lean * p.half) * f(0.6))), y: f(b.y - p.height) },
  };
};
/** Every peak of the map, laid out once: summits on a coarse lattice deep in each range, foothills on its edge. */
function layOut(map: WorldMap): Map<number, Peak> {
  const w = map.width(),
    seed = map.seed(),
    depth = mountainDepth(map),
    low = lowGround.get(map),
    walled = (x: number, y: number) =>
      !!low && x >= low.x && y >= low.y && x < low.x + low.size && y < low.y + low.size,
    peaks = new Map<number, Peak>();
  // One summit candidate per 4 x 4 cell: its deepest tile.
  const cell = 4,
    ox = Math.floor(hash01(seed, 0, 0, 66) * cell),
    oy = Math.floor(hash01(seed, 0, 0, 67) * cell),
    best = new Map<number, { x: number; y: number; score: number }>();
  for (let y = 0; y < map.height(); y++)
    for (let x = 0; x < w; x++) {
      const d = depth[y * w + x];
      if (d < 2 || walled(x, y)) continue;
      const key = Math.floor((y + oy) / cell) * 1024 + Math.floor((x + ox) / cell),
        score = d + f(0.8) * hash01(seed, x, y, 68),
        old = best.get(key);
      if (!old || score > old.score) best.set(key, { x, y, score });
    }
  const summits: { x: number; y: number }[] = [];
  for (const c of [...best.values()].sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x))
    if (summits.every((s) => Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)) >= 3)) summits.push(c);
  const isSummit = new Set(summits.map((s) => s.y * w + s.x));
  for (let y = 0; y < map.height(); y++)
    for (let x = 0; x < w; x++) {
      const d = depth[y * w + x];
      if (!d) continue;
      if (walled(x, y)) {
        const wall = wallPeak(map, x, y);
        if (wall) peaks.set(y * w + x, wall);
        continue;
      }
      const summit = isSummit.has(y * w + x);
      if (!summit && hash01(seed, x, y, 62) >= (d === 1 ? f(0.5) : f(0.3))) continue;
      // Feet scatter along the screen row and barely across it, where a tile is widest.
      const along = f(f(hash01(seed, x, y, 63) - f(0.5)) * (summit ? f(0.3) : f(0.5))),
        across = f(f(hash01(seed, x, y, 64) - f(0.5)) * f(0.12)),
        foot = { x: f(f(x + f(0.5)) + f(along + across)), y: f(f(y + f(0.5)) + f(across - along)) },
        // Between the summits the range stands a tier lower, so they rise out of it.
        wanted = depthHeight(summit ? d : Math.max(1, d - 1), hash01(seed, x, y, 69)),
        at = project(foot.x, foot.y),
        room = run(map, at, f(wanted * f(0.62))),
        // The widest base that stays on the mountain, the foot slid along its row to the middle if need be.
        span = f(f(room.left + room.right) / 2 + baseSlack),
        half = Math.min(f(wanted * (summit ? f(0.62) : f(0.55))), span),
        middle = f(f(at.x - room.left - baseSlack) + half),
        slid = Math.min(Math.max(at.x, middle), f(f(at.x + room.right + baseSlack) - half)),
        moved = unproject(slid, at.y),
        height = Math.min(wanted, slopeLimit(f(2 * half)), ceiling(map, moved, half));
      peaks.set(y * w + x, {
        foot: moved,
        rise: Math.max(0, Math.min(1, f(map.value(Layer.Ridge, moved) * 7))),
        volcanic: volcanicPeak(map, moved),
        lean: f(f(hash01(seed, x, y, 65) - f(0.5)) * f(0.8)),
        height,
        half,
        drop: Math.min(f(half * f(0.26)), f(6 + f((d - 1) * 28))),
        depth: d,
        summit,
      });
    }
  const big = [...peaks]
    .filter(([, p]) => p.summit)
    .map(([key, p]) => ({ p, o: outline(p), x: key % w, y: Math.floor(key / w) }));
  for (const [key, p] of peaks) {
    const x = key % w,
      y = Math.floor(key / w);
    if (p.summit || walled(x, y)) continue;
    for (const s of big) {
      if (Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) > 3) continue;
      if (s.p.foot.x + s.p.foot.y <= p.foot.x + p.foot.y) {
        // What stands in front of a summit stays under it, so the summit rises out of the range.
        p.height = Math.min(p.height, f(s.p.height * f(0.85)));
        continue;
      }
      const o = outline(p);
      // A lesser peak hidden whole behind a summit's body is not drawn.
      if ([o.left, o.right, o.apex].every((q) => inTriangle(q, s.o.left, s.o.apex, s.o.right))) {
        peaks.delete(key);
        break;
      }
    }
  }
  return peaks;
}
export function peakAt(map: WorldMap, x: number, y: number): Peak | undefined {
  let layout = layouts.get(map);
  if (!layout) {
    layout = { print: terrainPrint(map), area: areaKey(map), peaks: new Map() };
    layout.peaks = layOut(map);
    layouts.set(map, layout);
  }
  return layout.peaks.get(y * map.width() + x);
}
const BackLit = 0,
  BackShade = 1,
  BackCapLit = 2,
  BackCapShade = 3,
  Lit = 4,
  Shade = 5,
  CapLit = 6,
  CapShade = 7,
  BasaltBackLit = 8,
  BasaltBackShade = 9,
  BasaltLit = 10,
  BasaltShade = 11;
/** Where a polyline (top to bottom) crosses a height, and the part of it above. */
function above(line: readonly Point[], y: number): { points: Point[]; at: Point } {
  const points = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i];
    if (b.y < y) {
      points.push(b);
      continue;
    }
    const t = b.y === a.y ? 0 : f(f(y - a.y) / f(b.y - a.y));
    return { points, at: lerp(a, b, Math.max(0, Math.min(1, t))) };
  }
  return { points, at: line[line.length - 1] };
}
/** A ragged run of teeth from one point to another. */
function teeth(from: Point, to: Point, count: number, depth: number, seed: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= count; i++) {
    const p = lerp(from, to, f(i / (count + 1)));
    out.push({ x: p.x, y: f(p.y + f(f(i % 2 ? -1 : 1) * depth * f(0.6 + 0.4 * hash01(seed, i, count, 70)))) });
  }
  return out;
}
export class PeakBatch {
  private parts = Array.from({ length: 12 }, () => new ShapeNode());
  private snowy: boolean;
  // The shading span grows with the peak, so a summit and a foot keep their colours.
  private span = 130;
  constructor(climate: Climate) {
    this.snowy = climate.snow > f(0.3);
  }
  /** Height above which rock carries snow; lower in a snowy climate. */
  private get snowLine(): number {
    return this.snowy ? 85 : 132;
  }
  add(peak: PeakShape): void {
    const b = project(peak.foot.x, peak.foot.y),
      top = peak.height ?? f(100 + f(160 * peak.rise)),
      w = peak.half ?? Math.max(lowHalf(peak.rise), f(top * f(0.55))),
      drop = peak.drop ?? f(w * f(0.26)),
      seed = Math.trunc(f(f(b.x * 7) + f(b.y * 13))),
      roll = (k: number) => hash01(seed, k, 0, 71);
    this.span = Math.max(this.span, top);
    const volcanic = peak.volcanic;
    if (peak.summit) {
      // Shoulders: lower summits on the flanks, behind the main body.
      for (const side of [-1, 1]) {
        if (side > 0 && roll(1) < f(0.25)) continue;
        const reach = f(0.5 + 0.12 * roll(2 + side)),
          rise = f(0.55 + 0.1 * roll(4 + side)),
          sx = f(b.x + f(f(side * reach) * w)),
          sh = f(w * f(0.5)),
          lo = Math.max(f(sx - sh), f(b.x - w)),
          hi = Math.min(f(sx + sh), f(b.x + w)),
          base = f(b.y - 3),
          apex = { x: sx, y: f(base - Math.min(f(top * rise), f(hi - lo))) },
          ridge = { x: f(sx + f(sh * f(0.18))), y: f(base + 2) };
        this.body(
          volcanic ? BasaltBackLit : BackLit,
          volcanic ? BasaltBackShade : BackShade,
          volcanic ? -1 : BackCapLit,
          volcanic ? -1 : BackCapShade,
          [{ x: lo, y: base }],
          apex,
          [ridge],
          [{ x: hi, y: base }],
          f(base - apex.y),
          false,
          seed + side,
        );
      }
    }
    const apex = { x: f(b.x + f(f(peak.lean * w) * f(0.6))), y: f(b.y - top) },
      front = { x: f(b.x + f(w * f(0.12))), y: f(b.y + drop) },
      // A ridge line that bends, never a plumb line.
      bend = lerp(apex, front, f(0.45)),
      kink = { x: f(bend.x + f(f(roll(6) - f(0.5)) * f(w * f(0.24)))), y: bend.y },
      flank = (side: number, k: number) => {
        const p = lerp(apex, { x: f(b.x + f(side * w)), y: b.y }, f(0.55));
        return { x: f(p.x + f(f(side * w) * f(0.05 * k))), y: f(p.y + f(top * f(0.02 * k))) };
      };
    this.body(
      volcanic ? BasaltLit : Lit,
      volcanic ? BasaltShade : Shade,
      volcanic ? -1 : CapLit,
      volcanic ? -1 : CapShade,
      // Only a summit's flanks break; a lesser peak keeps its points few.
      peak.summit ? [flank(-1, roll(7) - 0.5), { x: f(b.x - w), y: b.y }] : [{ x: f(b.x - w), y: b.y }],
      apex,
      [kink, front],
      peak.summit ? [flank(1, roll(8) - 0.5), { x: f(b.x + w), y: b.y }] : [{ x: f(b.x + w), y: b.y }],
      top,
      !!peak.summit,
      seed,
    );
  }
  /** Two faces meeting at a ridge, and a snow cap with a ragged lower edge when the rock reaches the snow. */
  private body(
    lit: number,
    shade: number,
    capLit: number,
    capShade: number,
    left: Point[],
    apex: Point,
    ridge: Point[],
    right: Point[],
    height: number,
    summit: boolean,
    seed: number,
  ): void {
    const leftLine = [apex, ...left],
      ridgeLine = [apex, ...ridge],
      rightLine = [apex, ...right];
    appendPolygon(this.parts[lit], [...[...leftLine].reverse(), ...ridge]);
    appendPolygon(this.parts[shade], [...[...ridgeLine].reverse(), ...right]);
    if (capLit < 0) return;
    const share = Math.min(f(0.4), Math.max(summit ? f(0.24) : 0, f(f(height - this.snowLine) / height)));
    if (share < f(0.12)) return;
    const snow = f(apex.y + f(height * share)),
      jag = f(height * f(0.07)),
      l = above(leftLine, snow),
      m = above(ridgeLine, f(snow + jag)),
      r = above(rightLine, f(snow - f(jag * f(0.3))));
    appendPolygon(this.parts[capLit], [
      ...l.points,
      l.at,
      ...teeth(l.at, m.at, summit ? 3 : 2, jag, seed),
      m.at,
      ...[...m.points].reverse().slice(0, -1),
    ]);
    appendPolygon(this.parts[capShade], [
      ...m.points,
      m.at,
      ...teeth(m.at, r.at, summit ? 2 : 1, jag, seed + 5),
      r.at,
      ...[...r.points].reverse().slice(0, -1),
    ]);
  }
  finish(base: number): ShapeNode[] {
    const span = this.span,
      [backLit, backShade, backCapLit, backCapShade, lit, shade, capLit, capShade] = this.parts,
      [bBackLit, bBackShade, bLit, bShade] = this.parts.slice(BasaltBackLit);
    for (const part of [backLit, lit])
      verticalShade(part, [90, 88, 100], f(base - span), f(base + 10), f(1.3), f(0.7));
    for (const part of [backShade, shade])
      verticalShade(part, [56, 54, 68], f(base - span), f(base + 10), f(1.3), f(0.7));
    for (const part of [backCapLit, capLit]) fill(part, opaque([208, 214, 226]));
    for (const part of [backCapShade, capShade]) fill(part, opaque([146, 154, 174]));
    for (const part of [bBackLit, bLit])
      verticalShade(part, [82, 68, 64], f(base - span), f(base + 10), f(1.25), f(0.75));
    for (const part of [bBackShade, bShade])
      verticalShade(part, [48, 40, 42], f(base - span), f(base + 10), f(1.25), f(0.75));
    const drawn = this.parts.filter((part) => part.commands.length > 0);
    this.parts = [];
    this.span = 130;
    return drawn;
  }
}
