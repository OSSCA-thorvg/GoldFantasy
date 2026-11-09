import { Footprint, distance, type Point } from '../../engine/src/geometry';
import { f32, clamp } from '../../engine/src/numeric';
import { Giant, Volcano } from '../../engine/src/world-types';
import { WorldMap } from '../../engine/src/world-map';
import { Town } from '../../engine/src/town';
import { structureSpec } from '../../engine/src/building-catalog';
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
