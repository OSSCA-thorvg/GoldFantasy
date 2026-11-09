import { Footprint, distance, project, type Point } from '../../engine/src/geometry';
import { f32, clamp } from '../../engine/src/numeric';
import { Giant, Volcano } from '../../engine/src/world-types';
import { WorldMap } from '../../engine/src/world-map';
import { Town } from '../../engine/src/town';
import { structureSpec } from '../../engine/src/building-catalog';
import type { PaintNode } from './paint';
import type { WorldRendererState } from './world-renderer-state';
import { Rect } from '../../native-ui/src/types';

export interface GroundBaseline {
  left: Point;
  right: Point;
}
interface DepthItem {
  paint: PaintNode;
  baseline: GroundBaseline;
  key: string;
  bounds?: Rect;
}
const depthItems = new WeakMap<PaintNode, DepthItem>();

/** The left-to-right tile diagonal is the building's ground baseline, independent of roof height. */
export function footprintBaseline(footprint: Footprint): GroundBaseline {
  const corners = footprint.corners().map((p) => project(p.x, p.y));
  const diagonals = [
    [corners[0], corners[2]],
    [corners[1], corners[3]],
  ];
  diagonals.sort(
    (a, b) =>
      Math.abs((a[1].y - a[0].y) / (a[1].x - a[0].x || 1e-9)) -
      Math.abs((b[1].y - b[0].y) / (b[1].x - b[0].x || 1e-9)),
  );
  const [a, b] = diagonals[0];
  return a.x <= b.x ? { left: a, right: b } : { left: b, right: a };
}
export function groundBaseline(at: Point): GroundBaseline {
  const foot = project(at.x, at.y);
  return { left: foot, right: foot };
}
export function registerDepth(paint: PaintNode, at: Point | Footprint, key: string, bounds?: Rect): void {
  const baseline = at instanceof Footprint ? footprintBaseline(at) : groundBaseline(at),
    old = depthItems.get(paint);
  if (
    old &&
    old.key === key &&
    old.baseline.left.x === baseline.left.x &&
    old.baseline.left.y === baseline.left.y &&
    old.baseline.right.x === baseline.right.x &&
    old.baseline.right.y === baseline.right.y &&
    old.bounds?.x === bounds?.x &&
    old.bounds?.y === bounds?.y &&
    old.bounds?.w === bounds?.w &&
    old.bounds?.h === bounds?.h
  )
    return;
  depthItems.set(paint, { paint, baseline, key, bounds });
}
export const baselineDepthAt = (line: GroundBaseline, x: number): number => {
  const width = line.right.x - line.left.x;
  return width ? line.left.y + ((line.right.y - line.left.y) * (x - line.left.x)) / width : line.left.y;
};
/** Compare the overlapping ground baselines, not animated body bounds or creation order. */
export function compareBaselines(a: GroundBaseline, b: GroundBaseline): number {
  const left = Math.max(a.left.x, b.left.x),
    right = Math.min(a.right.x, b.right.x);
  if (left <= right) return baselineDepthAt(a, (left + right) / 2) - baselineDepthAt(b, (left + right) / 2);
  return (a.left.y + a.right.y - b.left.y - b.right.y) / 2;
}
const centerOrder = (a: DepthItem, b: DepthItem) =>
  (a.baseline.left.y + a.baseline.right.y - b.baseline.left.y - b.baseline.right.y) / 2 ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const orderCache = new WeakMap<WorldRendererState, { entries: DepthItem[]; order: PaintNode[] }>();
function orderedPaints(items: readonly DepthItem[]): PaintNode[] {
  const entries = [...items].sort(centerOrder),
    count = entries.length;
  const boxes = entries.map(
    (item) =>
      item.bounds ??
      new Rect(
        item.baseline.left.x - 28,
        Math.min(item.baseline.left.y, item.baseline.right.y) -
          (item.baseline.left.x === item.baseline.right.x ? 72 : 600),
        item.baseline.right.x - item.baseline.left.x + 56,
        Math.abs(item.baseline.right.y - item.baseline.left.y) +
          (item.baseline.left.x === item.baseline.right.x ? 88 : 640),
      ),
  );
  const edges: number[][] = Array.from({ length: count }, () => []),
    incoming = new Uint32Array(count);
  const sweep = entries.map((_, i) => i).sort((a, b) => boxes[a].x - boxes[b].x),
    active: number[] = [];
  for (const i of sweep) {
    const box = boxes[i];
    for (let a = active.length - 1; a >= 0; a--)
      if (boxes[active[a]].x + boxes[active[a]].w < box.x) active.splice(a, 1);
    for (const j of active) {
      const other = boxes[j];
      if (box.y > other.y + other.h || other.y > box.y + box.h) continue;
      const delta =
        compareBaselines(entries[i].baseline, entries[j].baseline) || centerOrder(entries[i], entries[j]);
      const before = delta < 0 ? i : j,
        after = delta < 0 ? j : i;
      edges[before].push(after);
      incoming[after]++;
    }
    active.push(i);
  }
  // Overlapping footprints are disallowed by the simulation. For unusual imported artwork
  // with cyclic overlap, break ties consistently instead of depending on Array.sort's probes.
  const ready: number[] = [],
    used = new Uint8Array(count),
    result: PaintNode[] = [];
  const enqueue = (id: number) => {
    let low = 0,
      high = ready.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ready[mid] < id) low = mid + 1;
      else high = mid;
    }
    ready.splice(low, 0, id);
  };
  for (let i = 0; i < count; i++) if (!incoming[i]) enqueue(i);
  while (result.length < count) {
    let id = ready.shift();
    if (id === undefined) {
      id = used.findIndex((value) => !value);
    }
    if (used[id]) continue;
    used[id] = 1;
    result.push(entries[id].paint);
    for (const next of edges[id]) if (incoming[next] && --incoming[next] === 0 && !used[next]) enqueue(next);
  }
  return result;
}

/** Rows are geometry caches only. All visible objects share one retained painter order. */
export function sortWorldObjects(s: WorldRendererState): void {
  const margin = 64 / s.view.zoom;
  const visible = new Rect(
    s.view.x - s.viewWidth / s.view.zoom / 2 - margin,
    s.view.y - s.viewHeight / s.view.zoom / 2 - margin,
    (s.viewWidth + 128) / s.view.zoom,
    (s.viewHeight + 128) / s.view.zoom,
  );
  const entries: DepthItem[] = [];
  for (const [category, rows] of [s.rowBuildings, s.rowLamps, s.rowTrees, s.rows].entries())
    rows.forEach((row, index) => {
      if (!row.alpha) return;
      row.children.forEach((paint, order) => {
        const item = depthItems.get(paint) ?? {
          paint,
          baseline: { left: { x: -1e8, y: (index + 1) * 16 }, right: { x: 1e8, y: (index + 1) * 16 } },
          key: `row:${index}:${category}:${order}`,
        };
        if (!depthItems.has(paint)) depthItems.set(paint, item);
        if (item.bounds) {
          const overlap = item.bounds.intersect(visible);
          if (overlap.w <= 0 || overlap.h <= 0) return;
        }
        entries.push(item);
      });
    });
  const cached = orderCache.get(s),
    unchanged =
      cached &&
      cached.entries.length === entries.length &&
      entries.every((item, i) => item === cached.entries[i]);
  const next = unchanged ? cached.order : orderedPaints(entries);
  if (!unchanged) orderCache.set(s, { entries, order: next });
  if (next.length !== s.objects.children.length || next.some((paint, i) => s.objects.children[i] !== paint)) {
    s.objects.children = next;
    s.objects.version++;
  }
}
export const giantFootprint = (g: Giant): Footprint => new Footprint(g.center(), f32(Giant.size / 2), 0);
export const volcanoFootprint = (v: Volcano): Footprint =>
  new Footprint(v.center(), f32(Volcano.size / 2), 0);
export function rowOf(value: Footprint | Point, rows: number): number {
  if (value instanceof Footprint) {
    let front = -1e9;
    for (const p of value.corners()) front = Math.max(front, f32(p.x + p.y));
    return clamp(f32(Math.floor(f32(front + f32(0.01))) - 2), 0, f32(rows - 1));
  }
  return clamp(f32(Math.floor(f32(value.x + value.y)) - 1), 0, f32(rows - 1));
}
export function drawRow(map: WorldMap, footprint: Footprint, rows: number): number {
  let row = rowOf(footprint, rows),
    low = 1e9,
    high = -1e9;
  for (const p of footprint.corners()) {
    low = Math.min(low, f32(p.x - p.y));
    high = Math.max(high, f32(p.x - p.y));
  }
  const u = f32(footprint.center.x - footprint.center.y),
    s = f32(footprint.center.x + footprint.center.y),
    before = (stone: Footprint, half: number) => {
      const column = f32(stone.center.x - stone.center.y);
      if (high <= f32(column - half) || low >= f32(column + half)) return;
      const front = f32(
        f32(f32(stone.center.x + stone.center.y) + half) - Math.min(Math.abs(f32(u - column)), half),
      );
      if (s > front) row = Math.max(row, rowOf(stone, rows));
    };
  const giant = map.giant(),
    volcano = map.volcano();
  if (giant) before(giantFootprint(giant), Giant.size);
  if (volcano) before(volcanoFootprint(volcano), Volcano.size);
  return row;
}
export function standingRow(town: Town, p: Point, rows: number): number {
  let row = rowOf(p, rows),
    atLeast = -1,
    atMost = rows,
    nearestFront = 1e9,
    nearestBehind = 1e9;
  const u = f32(p.x - p.y),
    s = f32(p.x + p.y);
  const weigh = (footprint: Footprint, size: number) => {
    const gap = distance(footprint.center, p);
    if (gap > f32(size + f32(1.5))) return;
    const corners = footprint.corners();
    let front = -1e9,
      back = 1e9;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i],
        b = corners[f32(i + 1) % corners.length],
        ua = f32(a.x - a.y),
        ub = f32(b.x - b.y);
      if (u < Math.min(ua, ub) || u > Math.max(ua, ub) || ua === ub) continue;
      const t = f32(f32(u - ua) / f32(ub - ua)),
        edge = f32(f32(a.x + a.y) + f32(f32(f32(b.x + b.y) - f32(a.x + a.y)) * t));
      front = Math.max(front, edge);
      back = Math.min(back, edge);
    }
    if (front < back) return;
    const own = drawRow(town.map(), footprint, rows);
    if (s >= f32(front - f32(0.02))) {
      atLeast = Math.max(atLeast, own);
      nearestFront = Math.min(nearestFront, gap);
    } else if (s > f32(back - f32(1.5))) {
      atMost = Math.min(atMost, f32(own - 1));
      nearestBehind = Math.min(nearestBehind, gap);
    }
  };
  for (const building of town.buildings()) weigh(building.footprint(), structureSpec(building.kind).size);
  const giant = town.map().giant(),
    volcano = town.map().volcano();
  if (giant) weigh(giantFootprint(giant), Giant.size);
  if (volcano) weigh(volcanoFootprint(volcano), Volcano.size);
  if (atLeast <= atMost) row = clamp(row, Math.max(atLeast, 0), Math.min(atMost, f32(rows - 1)));
  else row = nearestFront <= nearestBehind ? atLeast : atMost;
  return clamp(row, 0, f32(rows - 1));
}
