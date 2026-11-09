// Semantic translation of road_graph.cpp, including deterministic bucket traversal and tie order.
import { Point, point, distance, lerp } from './geometry';
import { clamp, f32 } from './numeric';
import { RoadSegment } from './road-network';
import { PairMinHeap } from './priority-queue';
const mergeDistance = f32(.08), joinDistance = f32(.75), infinite = 3.4028234663852886e38;
type Cell = {
    x: number;
    y: number;
};
const key = (x: number, y: number): string => `${x},${y}`;
class PointIndex {
    buckets = new Map<string, number[]>();
    // Native explicitly promotes point to double before dividing by float mergeDistance.
    cell(p: Point): Cell { return { x: Math.floor(p.x / mergeDistance), y: Math.floor(p.y / mergeDistance) }; }
    add(p: Point, id: number): void { const at = this.cell(p), k = key(at.x, at.y), ids = this.buckets.get(k); if (ids)
        ids.push(id);
    else
        this.buckets.set(k, [id]); }
    nearby(p: Point, visit: (id: number) => void): void { const at = this.cell(p); for (let y = f32(at.y - 1); y <= f32(at.y + 1); ++y)
        for (let x = f32(at.x - 1); x <= f32(at.x + 1); ++x)
            for (const id of this.buckets.get(key(x, y)) ?? [])
                visit(id); }
}
class SegmentIndex {
    buckets = new Map<string, number[]>();
    longSegments: number[] = [];
    count: number;
    constructor(segments: RoadSegment[]) { this.count = segments.length; for (let i = 0; i < segments.length; ++i) {
        const [low, high] = this.bounds(segments[i].a, segments[i].b, 0);
        if (this.large(low, high)) {
            this.longSegments.push(i);
            continue;
        }
        for (let y = low.y; y <= high.y; ++y)
            for (let x = low.x; x <= high.x; ++x) {
                const k = key(x, y), ids = this.buckets.get(k);
                if (ids)
                    ids.push(i);
                else
                    this.buckets.set(k, [i]);
            }
    } }
    bounds(a: Point, b: Point, margin: number): [
        Cell,
        Cell
    ] { return [{ x: Math.floor(f32(f32(Math.min(a.x, b.x) - margin) / 2)), y: Math.floor(f32(f32(Math.min(a.y, b.y) - margin) / 2)) }, { x: Math.floor(f32(f32(Math.max(a.x, b.x) + margin) / 2)), y: Math.floor(f32(f32(Math.max(a.y, b.y) + margin) / 2)) }]; }
    large(low: Cell, high: Cell): boolean { const width = f32(f32(high.x - low.x) + 1), height = f32(f32(high.y - low.y) + 1); return width > 4096 || height > 4096 || f32(width * height) > 4096; }
    nearby(a: Point, b: Point, margin = 0): number[] { const [low, high] = this.bounds(a, b, margin); if (this.large(low, high))
        return Array.from({ length: this.count }, (_, i) => i); const result = [...this.longSegments]; for (let y = low.y; y <= high.y; ++y)
        for (let x = low.x; x <= high.x; ++x)
            result.push(...this.buckets.get(key(x, y)) ?? []); return [...new Set(result.sort((a, b) => f32(a - b)))]; }
}
function project(p: Point, a: Point, b: Point): number { const dx = f32(b.x - a.x), dy = f32(b.y - a.y), length = f32(f32(dx * dx) + f32(dy * dy)); return length > 0 ? clamp(f32((f32(f32((f32(p.x - a.x)) * dx) + f32((f32(p.y - a.y)) * dy))) / length), 0, 1) : 0; }
function intersect(p: RoadSegment, q: RoadSegment): [
    number,
    number
] | null { const rx = f32(p.b.x - p.a.x), ry = f32(p.b.y - p.a.y), sx = f32(q.b.x - q.a.x), sy = f32(q.b.y - q.a.y), cross = f32(f32(rx * sy) - f32(ry * sx)); if (Math.abs(cross) < f32(1e-6))
    return null; const qx = f32(q.a.x - p.a.x), qy = f32(q.a.y - p.a.y), t = f32((f32(f32(qx * sy) - f32(qy * sx))) / cross), u = f32((f32(f32(qx * ry) - f32(qy * rx))) / cross); return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null; }
interface Link {
    to: number;
    length: number;
}
interface Snap {
    a: number;
    b: number;
    point: Point;
    distance: number;
}
export class RoadGraph {
    points: Point[] = [];
    links: Link[][] = [];
    empty(): boolean { return !this.points.length; }
    nodes(): readonly Point[] { return this.points; }
    degree(node: number): number { return this.links[node].length; }
    connect(a: number, b: number): void { if (a === b || this.links[a].some(link => link.to === b))
        return; const length = distance(this.points[a], this.points[b]); this.links[a].push({ to: b, length }); this.links[b].push({ to: a, length }); }
    static build(segments: RoadSegment[]): RoadGraph {
        const graph = new RoadGraph(), cuts = segments.map(() => [0, 1]), joins: [
            Point,
            Point
        ][] = [], endpoints = new PointIndex(), nodes = new PointIndex(), pieces = new SegmentIndex(segments);
        for (let i = 0; i < segments.length; ++i) {
            endpoints.add(segments[i].a, f32(i * 2));
            endpoints.add(segments[i].b, f32(f32(i * 2) + 1));
        }
        const node = (p: Point): number => { let best = graph.points.length; nodes.nearby(p, i => { if (i < best && distance(graph.points[i], p) < mergeDistance)
            best = i; }); if (best < graph.points.length)
            return best; nodes.add(p, best); graph.points.push(p); graph.links.push([]); return best; };
        const loose = (end: Point): boolean => { let count = 0; endpoints.nearby(end, i => { const s = segments[Math.floor(f32(i / 2))]; count = f32(count + Number(distance(i % 2 ? s.b : s.a, end) < mergeDistance)); }); return count === 1; };
        const looseA = segments.map(s => loose(s.a)), looseB = segments.map(s => loose(s.b));
        for (let i = 0; i < segments.length; ++i)
            for (const j of pieces.nearby(segments[i].a, segments[i].b)) {
                if (j <= i)
                    continue;
                const hit = intersect(segments[i], segments[j]);
                if (hit) {
                    cuts[i].push(hit[0]);
                    cuts[j].push(hit[1]);
                }
            }
        for (let j = 0; j < segments.length; ++j)
            for (let side = 0; side < 2; ++side) {
                if (!(side ? looseB[j] : looseA[j]))
                    continue;
                const end = side ? segments[j].b : segments[j].a;
                let best = segments.length, bestT = 0, bestGap = joinDistance;
                for (const i of pieces.nearby(end, end, joinDistance)) {
                    if (i === j || segments[i].road >= 0 && segments[i].road === segments[j].road)
                        continue;
                    const t = project(end, segments[i].a, segments[i].b), gap = distance(lerp(segments[i].a, segments[i].b, t), end);
                    if (gap <= bestGap) {
                        best = i;
                        bestT = t;
                        bestGap = gap;
                    }
                }
                if (best === segments.length)
                    continue;
                cuts[best].push(bestT);
                const on = lerp(segments[best].a, segments[best].b, bestT);
                if (bestGap > mergeDistance)
                    joins.push([end, on]);
            }
        for (let i = 0; i < segments.length; ++i) {
            const list = cuts[i];
            list.sort((a, b) => f32(a - b));
            let previous = node(lerp(segments[i].a, segments[i].b, list[0]));
            for (let k = 1; k < list.length; ++k) {
                const next = node(lerp(segments[i].a, segments[i].b, list[k]));
                graph.connect(previous, next);
                previous = next;
            }
        }
        for (const [end, on] of joins)
            graph.connect(node(end), node(on));
        return graph;
    }
    snap(p: Point): Snap { let best: Snap = { a: 0, b: 0, point: p, distance: infinite }; for (let a = 0; a < this.points.length; ++a) {
        if (!this.links[a].length && distance(this.points[a], p) < best.distance)
            best = { a, b: a, point: this.points[a], distance: distance(this.points[a], p) };
        for (const link of this.links[a]) {
            if (link.to < a)
                continue;
            const on = lerp(this.points[a], this.points[link.to], project(p, this.points[a], this.points[link.to]));
            if (distance(on, p) < best.distance)
                best = { a, b: link.to, point: on, distance: distance(on, p) };
        }
    } return best; }
    nearest(p: Point): Point { return this.empty() ? p : this.snap(p).point; }
    route(from: Point, to: Point): Point[] { if (this.empty())
        return []; const start = this.snap(from), goal = this.snap(to); if (start.a === goal.a && start.b === goal.b || start.a === goal.b && start.b === goal.a)
        return [from, start.point, goal.point, to]; const cost = new Float32Array(this.points.length).fill(infinite), previous = new Int32Array(this.points.length).fill(-1), open = new PairMinHeap(); for (const n of [start.a, start.b]) {
        const c = distance(start.point, this.points[n]);
        if (c < cost[n]) {
            cost[n] = c;
            open.push([c, n]);
        }
    } while (!open.empty()) {
        const [c, n] = open.pop();
        if (c > cost[n])
            continue;
        for (const link of this.links[n])
            if (f32(c + link.length) < cost[link.to]) {
                cost[link.to] = f32(c + link.length);
                previous[link.to] = n;
                open.push([cost[link.to], link.to]);
            }
    } const viaA = cost[goal.a] === infinite ? infinite : f32(cost[goal.a] + distance(this.points[goal.a], goal.point)), viaB = cost[goal.b] === infinite ? infinite : f32(cost[goal.b] + distance(this.points[goal.b], goal.point)); if (viaA === infinite && viaB === infinite)
        return []; const path = [to, goal.point]; for (let n = viaA <= viaB ? goal.a : goal.b; n !== -1; n = previous[n])
        path.push(this.points[n]); path.push(start.point, from); path.reverse(); return path; }
}
