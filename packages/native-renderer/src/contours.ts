import { ShapeNode } from './paint';
import { lerp, type Point } from '../../engine/src/geometry';
import type { TerrainMap, TileRegion } from './render-types';
const f = Math.fround;
export const RESOLUTION = 2;
export const SAMPLE_STEP = f(1 / RESOLUTION);
export type Sample = (i: number, j: number) => number;
export interface ContourCell {
  inside: Point[];
  edges: { a: Point; b: Point; from: number; to: number }[];
  full: boolean;
}
const corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
export function contourCell(i: number, j: number, sample: Sample): ContourCell {
  const cell: ContourCell = { inside: [], edges: [], full: false };
  const values = corners.map(([x, y]) => f(sample(i + x, j + y))),
    inside = values.filter((value) => value >= 0).length;
  if (inside === 0) return cell;
  if (inside === 4) {
    cell.full = true;
    return cell;
  }
  let crossing = -1,
    crossingSide = 0,
    firstSide = 0;
  let first: Point = { x: 0, y: 0 };
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4,
      a = { x: f((i + corners[k][0]) * SAMPLE_STEP), y: f((j + corners[k][1]) * SAMPLE_STEP) },
      b = { x: f((i + corners[n][0]) * SAMPLE_STEP), y: f((j + corners[n][1]) * SAMPLE_STEP) };
    if (values[k] >= 0) cell.inside.push(a);
    if (values[k] >= 0 === values[n] >= 0) continue;
    const t = f(values[k] / f(values[k] - values[n])),
      p = lerp(a, b, t);
    cell.inside.push(p);
    if (values[k] >= 0) {
      crossing = cell.inside.length - 1;
      crossingSide = k;
    } else if (crossing >= 0) {
      cell.edges.push({ a: cell.inside[crossing], b: p, from: crossingSide, to: k });
      crossing = -1;
    } else {
      first = p;
      firstSide = k;
    }
  }
  if (crossing >= 0)
    cell.edges.push({ a: cell.inside[crossing], b: first, from: crossingSide, to: firstSide });
  return cell;
}
export function sampleArea(
  map: Pick<TerrainMap, 'width' | 'height'>,
  margin: number,
  area?: TileRegion,
): TileRegion {
  const result = {
    left: -margin,
    top: -margin,
    right: map.width() * RESOLUTION + margin,
    bottom: map.height() * RESOLUTION + margin,
  };
  if (area) {
    result.left = Math.max(result.left, area.left * RESOLUTION);
    result.top = Math.max(result.top, area.top * RESOLUTION);
    result.right = Math.min(result.right, area.right * RESOLUTION);
    result.bottom = Math.min(result.bottom, area.bottom * RESOLUTION);
  }
  return result;
}
export function eachCell(
  map: Pick<TerrainMap, 'width' | 'height'>,
  margin: number,
  sample: Sample,
  visit: (cell: ContourCell) => void,
  area?: TileRegion,
): void {
  const b = sampleArea(map, margin, area);
  for (let j = b.top; j < b.bottom; j++)
    for (let i = b.left; i < b.right; i++) {
      const cell = contourCell(i, j, sample);
      if (cell.inside.length) visit(cell);
    }
}
export function appendOutline(shape: ShapeNode, points: Point[], shift: Point = { x: 0, y: 0 }): void {
  if (!points.length) return;
  shape.moveTo(f(points[0].x + shift.x), f(points[0].y + shift.y));
  for (let k = 1; k < points.length; k++) shape.lineTo(f(points[k].x + shift.x), f(points[k].y + shift.y));
  shape.close();
}
export function region(
  map: Pick<TerrainMap, 'width' | 'height'>,
  margin: number,
  sample: Sample,
  shift: Point = { x: 0, y: 0 },
  area?: TileRegion,
): ShapeNode {
  const shape = new ShapeNode(),
    bounds = sampleArea(map, margin, area);
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return shape;
  interface Edge {
    a: Point;
    b: Point;
    from: string;
    to: string;
  }
  const edges: Edge[] = [],
    stride = bounds.right - bounds.left + 1;
  const node = (i: number, j: number) => (j - bounds.top) * stride + i - bounds.left;
  const vertex = (i: number, j: number) => `v${node(i, j)}`;
  const crossing = (i: number, j: number, side: number) => {
    if (side === 1) i++;
    if (side === 2) j++;
    return `e${node(i, j) * 2 + (side % 2)}`;
  };
  for (let j = bounds.top; j < bounds.bottom; j++)
    for (let i = bounds.left; i < bounds.right; i++)
      for (const edge of contourCell(i, j, sample).edges)
        edges.push({ a: edge.a, b: edge.b, from: crossing(i, j, edge.from), to: crossing(i, j, edge.to) });
  const border = (i: number, j: number, nextI: number, nextJ: number, edge: string) => {
    const a = f(sample(i, j)),
      b = f(sample(nextI, nextJ));
    if (a < 0 && b < 0) return;
    let from = { x: f(i * SAMPLE_STEP), y: f(j * SAMPLE_STEP) },
      to = { x: f(nextI * SAMPLE_STEP), y: f(nextJ * SAMPLE_STEP) },
      first = vertex(i, j),
      last = vertex(nextI, nextJ);
    if (a >= 0 !== b >= 0) {
      const intersection = lerp(from, to, f(a / f(a - b)));
      if (a < 0) {
        from = intersection;
        first = edge;
      } else {
        to = intersection;
        last = edge;
      }
    }
    edges.push({ a: from, b: to, from: first, to: last });
  };
  for (let i = bounds.left; i < bounds.right; i++) {
    border(i, bounds.top, i + 1, bounds.top, crossing(i, bounds.top, 0));
    border(i + 1, bounds.bottom, i, bounds.bottom, crossing(i, bounds.bottom - 1, 2));
  }
  for (let j = bounds.top; j < bounds.bottom; j++) {
    border(bounds.right, j, bounds.right, j + 1, crossing(bounds.right - 1, j, 1));
    border(bounds.left, j + 1, bounds.left, j, crossing(bounds.left, j, 3));
  }
  const outgoing = new Map<string, number>();
  for (let k = 0; k < edges.length; k++) if (!outgoing.has(edges[k].from)) outgoing.set(edges[k].from, k);
  const used = new Set<number>();
  for (let start = 0; start < edges.length; start++) {
    if (used.has(start)) continue;
    shape.moveTo(f(edges[start].a.x + shift.x), f(edges[start].a.y + shift.y));
    let current = start;
    do {
      used.add(current);
      const edge = edges[current];
      shape.lineTo(f(edge.b.x + shift.x), f(edge.b.y + shift.y));
      const next = outgoing.get(edge.to);
      if (next === undefined) break;
      current = next;
    } while (!used.has(current));
    shape.close();
  }
  return shape;
}
