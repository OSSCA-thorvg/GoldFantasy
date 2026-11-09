import { ConstructionMaterials } from './construction-materials';
// Semantic translation of native road_network.h/.cpp. Values are C++ float32.
import { Point, point, sub, add, scale, distance, length, normalized, lerp, cubic, segmentDistance, closestOnSegment } from './geometry';
import { f32, clamp } from './numeric';
export interface RoadAnchor {
    point: Point;
    in: Point;
    out: Point;
}
export type RoadPath = RoadAnchor[];
export const sharpAnchor = (p: Point): RoadAnchor => ({ point: { ...p }, in: { ...p }, out: { ...p } });
export interface RoadSegment {
    a: Point;
    b: Point;
    road: number;
}
const equal = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
export function freehandRoad(points: readonly Point[], tolerance: number): RoadPath {
    if (!Number.isFinite(tolerance))
        return [];
    const samples: Point[] = [];
    for (const p of points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
            return [];
        if (!samples.length || !equal(samples[f32(samples.length - 1)], p))
            samples.push({ ...p });
    }
    if (samples.length < 2)
        return [];
    const path: RoadPath = [];
    if (tolerance <= 0)
        return samples.map(sharpAnchor);
    const budget = f32(tolerance * f32(.5));
    const keep = new Uint8Array(samples.length);
    keep[0] = keep[f32(keep.length - 1)] = 1;
    const pending: [
        number,
        number
    ][] = [[0, f32(samples.length - 1)]];
    while (pending.length) {
        const [first, last] = pending.pop()!;
        let split = first, error = budget;
        for (let i = f32(first + 1); i < last; ++i) {
            const deviation = segmentDistance(samples[i], samples[first], samples[last]);
            if (deviation > error) {
                error = deviation;
                split = i;
            }
        }
        const chord = sub(samples[last], samples[first]), span = length(chord);
        if (span > 0) {
            const direction = scale(chord, f32(1 / span));
            let furthest = 0, peak = first;
            for (let i = f32(first + 1); i < last; ++i) {
                const relative = sub(samples[i], samples[first]), progress = f32(f32(relative.x * direction.x) + f32(relative.y * direction.y));
                if (peak > first && f32(furthest - progress) > error) {
                    error = f32(furthest - progress);
                    split = peak;
                }
                if (progress > furthest) {
                    furthest = progress;
                    peak = i;
                }
            }
        }
        if (split !== first) {
            keep[split] = 1;
            pending.push([first, split], [split, last]);
        }
    }
    for (let i = 0; i < samples.length; ++i)
        if (keep[i] && (!path.length || !equal(path[f32(path.length - 1)].point, samples[i])))
            path.push(sharpAnchor(samples[i]));
    if (path.length < 2)
        return [];
    path[0].out = lerp(path[0].point, path[1].point, f32(1 / 3));
    path[f32(path.length - 1)].in = lerp(path[f32(path.length - 1)].point, path[f32(path.length - 2)].point, f32(1 / 3));
    for (let i = 1; f32(i + 1) < path.length; ++i) {
        let before = sub(path[i].point, path[f32(i - 1)].point), after = sub(path[f32(i + 1)].point, path[i].point);
        const incoming = length(before), outgoing = length(after);
        if (incoming < f32(1e-6) || outgoing < f32(1e-6))
            continue;
        before = scale(before, f32(1 / incoming));
        after = scale(after, f32(1 / outgoing));
        if (f32(f32(before.x * after.x) + f32(before.y * after.y)) <= 0)
            continue;
        const tangent = normalized(add(before, after)), cross = (a: Point, b: Point) => f32(f32(a.x * b.y) - f32(a.y * b.x));
        const bend = Math.max(Math.abs(cross(tangent, before)), Math.abs(cross(tangent, after)));
        let handle = f32(Math.min(incoming, outgoing) / 3);
        if (bend > 0)
            handle = Math.min(handle, f32(budget / bend));
        path[i].in = sub(path[i].point, scale(tangent, handle));
        path[i].out = add(path[i].point, scale(tangent, handle));
    }
    return path;
}
export function flatten(path: RoadPath, step = f32(.3)): Point[] {
    if (!path.length)
        return [];
    const line: Point[] = [{ ...path[0].point }];
    for (let i = 1; i < path.length; ++i) {
        const p0 = path[f32(i - 1)].point, p1 = path[f32(i - 1)].out, p2 = path[i].in, p3 = path[i].point;
        const hull = f32(f32(distance(p0, p1) + distance(p1, p2)) + distance(p2, p3)), pieces = Math.max(1, Math.ceil(f32(hull / step)));
        for (let k = 1; k <= pieces; ++k)
            line.push(cubic(p0, p1, p2, p3, f32(k / pieces)));
    }
    return line;
}
export function pathLength(path: RoadPath): number { const line = flatten(path, f32(.1)); let total = 0; for (let i = 1; i < line.length; ++i)
    total = f32(total + distance(line[f32(i - 1)], line[i])); return total; }
export class Road {
    materials = new ConstructionMaterials();
    paved = false;
    paving = -1;
    wear = 0;
    constructionStart = 0;
    parent = -1;
    parentAt = 0;
    village = -1;
    constructor(public id: number, public path: RoadPath, public line: Point[], public built = 1) { }
    length(): number { let total = 0; for (let i = 1; i < this.line.length; ++i)
        total = f32(total + distance(this.line[f32(i - 1)], this.line[i])); return total; }
    along(share: number): Point { let left = f32(clamp(share, 0, 1) * this.length()); for (let i = 1; i < this.line.length; ++i) {
        const leg = distance(this.line[f32(i - 1)], this.line[i]);
        if (left <= leg && leg > 0)
            return lerp(this.line[f32(i - 1)], this.line[i], f32(left / leg));
        left = f32(left - leg);
    } return this.line.length ? { ...this.line[f32(this.line.length - 1)] } : point(); }
    laidBegin(): number { return Math.max(0, f32(this.constructionStart - Math.max(0, f32(this.built - (f32(1 - this.constructionStart)))))); }
    laidEnd(): number { return Math.min(1, f32(this.constructionStart + this.built)); }
    workPoint(): Point { if (this.built < 1)
        return this.constructionPoint(this.built); return this.along(this.paving >= 0 ? this.paving : f32(.5)); }
    constructionPoint(progress: number): Point { if (this.constructionStart <= 0)
        return this.along(progress); return this.along(progress < f32(1 - this.constructionStart) ? f32(this.constructionStart + progress) : f32(1 - progress)); }
    laidLine(): Point[] { if (this.built <= 0 || !this.line.length)
        return []; const total = this.length(), first = f32(this.laidBegin() * total), last = f32(this.laidEnd() * total); let walked = 0; const out: Point[] = []; for (let i = 1; i < this.line.length && walked < last; ++i) {
        const leg = distance(this.line[f32(i - 1)], this.line[i]);
        if (leg > 0 && f32(walked + leg) > first) {
            if (!out.length)
                out.push(lerp(this.line[f32(i - 1)], this.line[i], f32(Math.max(0, f32(first - walked)) / leg)));
            out.push(lerp(this.line[f32(i - 1)], this.line[i], f32(Math.min(leg, f32(last - walked)) / leg)));
        }
        walked = f32(walked + leg);
    } return out; }
}
export interface RoadDistance {
    distance: number;
    onRoad?: Point;
    id?: number;
    tangent?: Point;
}
export class RoadNetwork {
    list: Road[] = [];
    nextId = 0;
    add(path: RoadPath, built = 0): number { this.list.push(new Road(this.nextId, structuredClone(path), flatten(path), built)); return this.nextId++; }
    road(id: number): Road | null { return this.list.find(r => r.id === id) ?? null; }
    remove(id: number): boolean { const before = this.list.length; this.list = this.list.filter(r => r.id !== id); return this.list.length !== before; }
    reshape(id: number, path: RoadPath): boolean { const road = this.road(id); if (!road)
        return false; road.line = flatten(path); road.path = structuredClone(path); road.built = 0; road.paved = false; road.paving = -1; return true; }
    roads(): readonly Road[] { return this.list; }
    segments(): RoadSegment[] { const out: RoadSegment[] = []; for (const road of this.list)
        for (let i = 1; i < road.line.length; ++i)
            out.push({ a: road.line[f32(i - 1)], b: road.line[i], road: road.id }); return out; }
    builtSegments(): RoadSegment[] { const out: RoadSegment[] = []; for (const road of this.list) {
        const laid = road.laidLine();
        for (let i = 1; i < laid.length; ++i)
            out.push({ a: laid[f32(i - 1)], b: laid[i], road: road.id });
    } return out; }
    distance(p: Point, ignore = -1): RoadDistance { const result: RoadDistance = { distance: 1e9 }; for (const road of this.list)
        for (let i = 1; road.id !== ignore && i < road.line.length; ++i) {
            const q = closestOnSegment(p, road.line[f32(i - 1)], road.line[i]), d = distance(p, q);
            if (d >= result.distance)
                continue;
            result.distance = d;
            result.onRoad = q;
            result.id = road.id;
            result.tangent = normalized(sub(road.line[i], road.line[f32(i - 1)]));
        } return result; }
    empty(): boolean { return !this.list.length; }
}
