// Semantic translation of native walk_paths.cpp. Grid/graph iteration and A* ties retain native order.
import { Footprint, Point, point, sub, rotated, distance, lerp, segmentDistance } from './geometry';
import { f32 } from './numeric';
import { WorldMap } from './world-map';
import { Terrain, isWater, impassable } from './world-types';
import { RoadNetwork, RoadSegment } from './road-network';
import { RoadGraph } from './road-graph';
import { PairMinHeap } from './priority-queue';
const pavedCost = f32(.3), roadCost = f32(.4), forestCost = f32(1.4), rockCost = f32(1.8), searchLimit = 60000;
const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
class Search {
    score = new Float32Array();
    parent = new Int32Array();
    stamp = new Uint32Array();
    open = new PairMinHeap();
    current = 0;
    begin(cells: number): void { if (this.stamp.length < cells) {
        this.score = new Float32Array(cells);
        this.parent = new Int32Array(cells);
        this.stamp = new Uint32Array(cells);
    } this.current = (f32(this.current + 1)) >>> 0; if (!this.current) {
        this.stamp.fill(0);
        this.current = 1;
    } this.open.clear(); }
    scoreAt(n: number): number { return this.stamp[n] === this.current ? this.score[n] : f32(1e30); }
    parentAt(n: number): number { return this.stamp[n] === this.current ? this.parent[n] : -1; }
    set(n: number, value: number, from: number): void { this.stamp[n] = this.current; this.score[n] = value; this.parent[n] = from; }
}
const search = new Search();
export class WalkGrid {
    columns = 0;
    rows = 0;
    costs = new Float32Array();
    roadSegments: RoadSegment[] = [];
    roadGraph = new RoadGraph();
    obstacles: Footprint[] = [];
    regions = new Int32Array();
    nearObstacle = new Uint8Array();
    blocked = new BigUint64Array();
    labeled = new BigUint64Array();
    cost(x: number, y: number): number { return this.costs[f32(f32(y * this.columns) + x)]; }
    blockedBy(a: Point, b?: Point): boolean {
        if (!b) {
            const x = Math.floor(a.x), y = Math.floor(a.y);
            if (x >= 0 && y >= 0 && x < this.columns && y < this.rows && !this.nearObstacle[f32(f32(y * this.columns) + x)])
                return false;
            return this.obstacles.some(f => f.contains(a, -f32(.08)));
        }
        for (const footprint of this.obstacles) {
            const half = f32(footprint.half - f32(.08)), radius = f32(half * f32(1.414214));
            if (Math.max(a.x, b.x) < f32(footprint.center.x - radius) || Math.min(a.x, b.x) > f32(footprint.center.x + radius) || Math.max(a.y, b.y) < f32(footprint.center.y - radius) || Math.min(a.y, b.y) > f32(footprint.center.y + radius))
                continue;
            const start = rotated(sub(a, footprint.center), -footprint.angle), end = rotated(sub(b, footprint.center), -footprint.angle);
            let enter = 0, leave = 1;
            const clips = (origin: number, delta: number): boolean => { if (Math.abs(delta) < f32(1e-6))
                return Math.abs(origin) <= half; let first = f32((f32(-half - origin)) / delta), last = f32((f32(half - origin)) / delta); if (first > last)
                [first, last] = [last, first]; enter = Math.max(enter, first); leave = Math.min(leave, last); return enter <= leave; };
            if (half > 0 && clips(start.x, f32(end.x - start.x)) && clips(start.y, f32(end.y - start.y)))
                return true;
        }
        return false;
    }
    rebuild(map: WorldMap, roads: RoadNetwork, buildings: readonly Footprint[] = []): void {
        const sameShape = this.columns === map.width() && this.rows === map.height(), sameWalls = sameShape && this.obstacles.length === buildings.length && this.obstacles.every((f, i) => equal(f.center, buildings[i].center) && f.half === buildings[i].half && f.angle === buildings[i].angle);
        this.obstacles = buildings.map(b => new Footprint({ ...b.center }, b.half, b.angle));
        this.columns = map.width();
        this.rows = map.height();
        this.costs = new Float32Array(f32(this.columns * this.rows)).fill(1);
        this.blocked = new BigUint64Array(Math.floor(f32((f32(this.costs.length + 63)) / 64)));
        const block = (i: number): void => { this.blocked[Math.floor(f32(i / 64))] |= 1n << BigInt(i % 64); };
        for (let y = 0; y < this.rows; ++y)
            for (let x = 0; x < this.columns; ++x) {
                const tile = map.at(x, y), i = f32(f32(y * this.columns) + x);
                if (isWater(tile.terrain) || impassable(tile.terrain)) {
                    this.costs[i] = 0;
                    block(i);
                }
                else if (tile.terrain === Terrain.Rock)
                    this.costs[i] = rockCost;
                else if (tile.trees)
                    this.costs[i] = forestCost;
            }
        const laid = roads.builtSegments().filter(segment => { const road = roads.road(segment.road); return !(road && road.wear >= 1); });
        if (laid.length !== this.roadSegments.length || laid.some((s, i) => s.road !== this.roadSegments[i].road || !equal(s.a, this.roadSegments[i].a) || !equal(s.b, this.roadSegments[i].b))) {
            this.roadGraph = RoadGraph.build(laid);
            this.roadSegments = laid;
        }
        for (const segment of this.roadSegments) {
            const road = roads.road(segment.road), cost = road?.paved ? pavedCost : roadCost, samples = f32(1 + Math.ceil(f32(distance(segment.a, segment.b) / f32(.4))));
            for (let i = 0; i <= samples; ++i) {
                const p = lerp(segment.a, segment.b, f32(i / samples));
                for (let dy = -1; dy <= 1; ++dy)
                    for (let dx = -1; dx <= 1; ++dx) {
                        const x = f32(Math.floor(p.x) + dx), y = f32(Math.floor(p.y) + dy);
                        if (x < 0 || y < 0 || x >= this.columns || y >= this.rows)
                            continue;
                        const cell = f32(f32(y * this.columns) + x), c = this.costs[cell];
                        if (distance(point(f32(x + f32(.5)), f32(y + f32(.5))), p) >= f32(.75))
                            continue;
                        if (c <= 0)
                            this.blocked[Math.floor(f32(cell / 64))] &= ~(1n << BigInt(cell % 64));
                        this.costs[cell] = c > 0 && c < cost ? c : cost;
                    }
            }
        }
        for (const f of this.obstacles) {
            const x0 = Math.floor(f32(f.center.x - f32(f.half * f32(1.5)))), x1 = Math.floor(f32(f.center.x + f32(f.half * f32(1.5)))), y0 = Math.floor(f32(f.center.y - f32(f.half * f32(1.5)))), y1 = Math.floor(f32(f.center.y + f32(f.half * f32(1.5))));
            for (let y = Math.max(0, y0); y <= Math.min(f32(this.rows - 1), y1); ++y)
                for (let x = Math.max(0, x0); x <= Math.min(f32(this.columns - 1), x1); ++x)
                    if (f.contains(point(f32(x + f32(.5)), f32(y + f32(.5))), f32(.05))) {
                        this.costs[f32(f32(y * this.columns) + x)] = 0;
                        block(f32(f32(y * this.columns) + x));
                    }
        }
        if (!sameWalls) {
            this.nearObstacle = new Uint8Array(this.costs.length);
            for (const f of this.obstacles) {
                const reach = f32(f32(f.half * f32(1.415)) + 1), x0 = Math.max(0, Math.floor(f32(f.center.x - reach))), x1 = Math.min(f32(this.columns - 1), Math.floor(f32(f.center.x + reach))), y0 = Math.max(0, Math.floor(f32(f.center.y - reach))), y1 = Math.min(f32(this.rows - 1), Math.floor(f32(f.center.y + reach)));
                for (let y = y0; y <= y1; ++y)
                    for (let x = x0; x <= x1; ++x)
                        this.nearObstacle[f32(f32(y * this.columns) + x)] = 1;
            }
        }
        if (sameShape && this.regions.length === this.costs.length && this.blocked.length === this.labeled.length && this.blocked.every((v, i) => v === this.labeled[i]))
            return;
        this.labeled = this.blocked.slice();
        this.regions = new Int32Array(this.costs.length).fill(-1);
        const pending: number[] = [];
        for (let first = 0, label = 0; first < this.costs.length; ++first) {
            if (this.costs[first] <= 0 || this.regions[first] >= 0)
                continue;
            this.regions[first] = label;
            pending.push(first);
            while (pending.length) {
                const n = pending.pop()!, x = n % this.columns;
                for (const m of [x > 0 ? f32(n - 1) : -1, f32(x + 1) < this.columns ? f32(n + 1) : -1, f32(n - this.columns), f32(n + this.columns)])
                    if (m >= 0 && m < this.costs.length && this.costs[m] > 0 && this.regions[m] < 0) {
                        this.regions[m] = label;
                        pending.push(m);
                    }
            }
            ++label;
        }
    }
    walkable(p: Point): boolean { const x = Math.floor(p.x), y = Math.floor(p.y); return x >= 0 && y >= 0 && x < this.columns && y < this.rows && this.cost(x, y) > 0 && !this.blockedBy(p); }
    speedAt(p: Point): number { const x = Math.floor(p.x), y = Math.floor(p.y); if (x < 0 || y < 0 || x >= this.columns || y >= this.rows)
        return f32(1.1); const c = this.cost(x, y); return c === pavedCost ? f32(2.6) : c === roadCost ? f32(2.1) : c === forestCost ? f32(.85) : c === rockCost ? f32(.75) : f32(1.1); }
    nearestWalkable(p: Point): Point { if (this.walkable(p))
        return p; let nearest = p, gap = 1e30; for (let dy = -4; dy <= 4; ++dy)
        for (let dx = -4; dx <= 4; ++dx) {
            const q = point(f32(f32(Math.floor(p.x) + dx) + f32(.5)), f32(f32(Math.floor(p.y) + dy) + f32(.5))), candidate = distance(p, q);
            if (candidate < gap && this.walkable(q)) {
                nearest = q;
                gap = candidate;
            }
        } return nearest; }
    clear(a: Point, b: Point, limit: number): boolean { if (this.blockedBy(a, b))
        return false; const steps = Math.max(1, Math.trunc(f32(distance(a, b) / f32(.25)))); for (let i = 0; i <= steps; ++i) {
        const p = lerp(a, b, f32(i / steps)), x = Math.floor(p.x), y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= this.columns || y >= this.rows)
            return false;
        const c = this.cost(x, y);
        if (c <= 0 || c > f32(limit + f32(1e-4)))
            return false;
    } return true; }
    path(from: Point, to: Point): Point[] {
        if (!this.costs.length)
            return [];
        const origin = from;
        from = this.nearestWalkable(from);
        if (!this.walkable(from) || !this.walkable(to))
            return [];
        const sx = Math.floor(from.x), sy = Math.floor(from.y), gx = Math.floor(to.x), gy = Math.floor(to.y);
        if (sx < 0 || sy < 0 || sx >= this.columns || sy >= this.rows)
            return [];
        if (sx === gx && sy === gy) {
            if (this.blockedBy(from, to))
                return [];
            return equal(origin, from) ? [from, to] : [origin, from, to];
        }
        const index = (x: number, y: number): number => f32(f32(y * this.columns) + x), start = index(sx, sy), goal = index(gx, gy);
        if (this.regions[start] !== this.regions[goal])
            return [];
        const state = search;
        state.begin(f32(this.columns * this.rows));
        const open = state.open;
        const guess = (x: number, y: number): number => { const dx = Math.abs(f32(x - gx)), dy = Math.abs(f32(y - gy)); return f32((f32(Math.max(dx, dy) + f32((f32(f32(1.4142) - 1)) * Math.min(dx, dy)))) * pavedCost); };
        state.set(start, 0, -1);
        open.push([guess(sx, sy), start]);
        let expanded = 0;
        while (!open.empty() && expanded < searchLimit) {
            const [f, n] = open.pop();
            if (n === goal)
                break;
            const x = n % this.columns, y = Math.floor(f32(n / this.columns)), g = state.scoreAt(n);
            if (f32(f - guess(x, y)) > f32(g + f32(1e-3)))
                continue;
            ++expanded;
            for (let dy = -1; dy <= 1; ++dy)
                for (let dx = -1; dx <= 1; ++dx) {
                    if (!dx && !dy)
                        continue;
                    const nx = f32(x + dx), ny = f32(y + dy);
                    if (nx < 0 || ny < 0 || nx >= this.columns || ny >= this.rows || this.cost(nx, ny) <= 0)
                        continue;
                    if (dx && dy && (this.cost(f32(x + dx), y) <= 0 || this.cost(x, f32(y + dy)) <= 0))
                        continue;
                    const m = index(nx, ny), a = x === sx && y === sy ? from : point(f32(x + f32(.5)), f32(y + f32(.5))), b = nx === gx && ny === gy ? to : point(f32(nx + f32(.5)), f32(ny + f32(.5)));
                    if ((this.nearObstacle[n] || this.nearObstacle[m]) && this.blockedBy(a, b))
                        continue;
                    const step = f32(f32((dx && dy ? f32(1.4142) : 1) * (f32(this.cost(x, y) + this.cost(nx, ny)))) / 2);
                    if (f32(g + step) < state.scoreAt(m)) {
                        state.set(m, f32(g + step), n);
                        open.push([f32(f32(g + step) + guess(nx, ny)), m]);
                    }
                }
        }
        if (state.parentAt(goal) < 0)
            return [];
        const cellsOnPath: Point[] = [];
        for (let n = goal; n >= 0; n = state.parentAt(n))
            cellsOnPath.push(point(f32(n % this.columns + f32(.5)), f32(Math.floor(f32(n / this.columns)) + f32(.5))));
        cellsOnPath.reverse();
        cellsOnPath[0] = from;
        cellsOnPath[f32(cellsOnPath.length - 1)] = to;
        const costAt = (p: Point): number => this.cost(Math.floor(p.x), Math.floor(p.y)), smooth: Point[] = [];
        if (!equal(origin, from))
            smooth.push(origin);
        smooth.push(from);
        let i = 0;
        while (f32(i + 1) < cellsOnPath.length) {
            const ground = costAt(cellsOnPath[i]);
            if (ground <= roadCost && !this.roadGraph.empty()) {
                let end = i, span = 0;
                while (f32(end + 1) < cellsOnPath.length && costAt(cellsOnPath[f32(end + 1)]) <= roadCost) {
                    span = f32(span + distance(cellsOnPath[end], cellsOnPath[f32(end + 1)]));
                    ++end;
                }
                if (end > i) {
                    const route = this.roadGraph.route(cellsOnPath[i], cellsOnPath[end]);
                    let length = 0, valid = !!route.length;
                    for (let k = 1; k < route.length; ++k) {
                        length = f32(length + distance(route[f32(k - 1)], route[k]));
                        if (!this.clear(route[f32(k - 1)], route[k], roadCost)) {
                            valid = false;
                            break;
                        }
                    }
                    if (valid && length <= f32(f32(span * f32(1.25)) + f32(1.5))) {
                        const keep = new Uint8Array(route.length);
                        keep[0] = keep[f32(keep.length - 1)] = 1;
                        const pending: [
                            number,
                            number
                        ][] = [[0, f32(route.length - 1)]];
                        while (pending.length) {
                            const [first, last] = pending.pop()!;
                            let split = first, error = f32(.02);
                            for (let k = f32(first + 1); k < last; ++k) {
                                const gap = segmentDistance(route[k], route[first], route[last]);
                                if (gap > error) {
                                    error = gap;
                                    split = k;
                                }
                            }
                            if (split === first && last > f32(first + 1) && !this.clear(route[first], route[last], roadCost))
                                split = Math.floor(f32((f32(first + last)) / 2));
                            if (split !== first) {
                                keep[split] = 1;
                                pending.push([first, split], [split, last]);
                            }
                        }
                        for (let k = 1; k < route.length; ++k)
                            if (keep[k] && !equal(smooth[f32(smooth.length - 1)], route[k]))
                                smooth.push(route[k]);
                        i = end;
                        continue;
                    }
                }
            }
            let best = f32(i + 1);
            for (let j = f32(i + 1); j < cellsOnPath.length && f32(j - i) <= 24; ++j) {
                if (costAt(cellsOnPath[j]) !== ground)
                    break;
                if (this.clear(cellsOnPath[i], cellsOnPath[j], ground))
                    best = j;
            }
            smooth.push(cellsOnPath[best]);
            i = best;
        }
        return smooth;
    }
}
