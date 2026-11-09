import { add, sub, scale, point, length, distance, normalized, lerp, segmentDistance, cubic, type Point } from './geometry';
import { clamp, f32, hash01, lround, remainder, u32 } from './numeric';
import { DungeonKind, Giant, Layer, Region, Terrain, Volcano, World, impassable, isStone, isWater, lavaFloor, lavaLevel, makeTile, volcanicCrest, volcanoFoot, type Dungeon, type River, type Sight, type Tile, type TileCoord } from './world-types';
import { placeDungeons } from './dungeon-sites';
const smooth = (t: number): number => f32(f32(t * t) * (f32(3 - f32(2 * t))));
function valueNoise(seed: number, x: number, y: number): number {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(f32(x - ix)), fy = smooth(f32(y - iy));
    const a = hash01(seed, ix, iy), b = hash01(seed, ix + 1, iy), c = hash01(seed, ix, iy + 1), d = hash01(seed, ix + 1, iy + 1);
    return f32(f32(a + f32((f32(b - a)) * fx)) + f32((f32(f32(c + f32((f32(d - c)) * fx)) - (f32(a + f32((f32(b - a)) * fx))))) * fy));
}
export function fractalNoise(seed: number, x: number, y: number): number {
    let sum = 0, amplitude = f32(.5), total = 0;
    for (let octave = 0; octave < 4; octave++) {
        sum = f32(sum + f32(valueNoise(u32(seed + f32(octave * 101)), x, y) * amplitude));
        total = f32(total + amplitude);
        x = f32(x * f32(2.03));
        y = f32(y * f32(2.03));
        amplitude = f32(amplitude * f32(.5));
    }
    return f32(sum / total);
}
const screenOf = (p: Point, width: number, height: number): Point => { const u = f32(p.x / width), v = f32(p.y / height); return point(f32(u - v), f32(f32(u + v) - 1)); };
const mapOf = (s: Point, width: number, height: number): Point => point(f32(f32(width * (f32(f32(s.x + s.y) + 1))) / 2), f32(f32(height * (f32(f32(s.y - s.x) + 1))) / 2));
const tileSpan = (width: number, height: number): number => f32(f32(2.8284271) / (f32(width + height)));
const fromLogo = (p: Point): Point => point(f32((f32(p.x - f32(86.16))) * f32(.0043)), f32(f32(f32((f32(p.y - f32(92.5))) * f32(.0043)) * f32(1.7)) + f32(.1455)));
const springLogo = point(72, 24), fireLogo = point(89, 142), ymirShoreLogo = point(140, f32(52.9));
const spines = [[point(96, 71), point(80, 86), point(58, 101)], [point(130, 110), point(89, 142), point(70, 172)]];
const centreLogos = [point(110, 20), point(95, 80), point(88, 152)];
const bolt = (() => {
    const outline: Point[] = [], bay: Point[] = [];
    const curve = (out: Point[], p0: Point, p1: Point, p2: Point, p3: Point): void => { for (let i = 0; i <= 8; i++)
        out.push(fromLogo(cubic(p0, p1, p2, p3, f32(i / 8)))); };
    const tip = point(f32(164.743), f32(10.156)), bend1 = point(f32(144.373), f32(37.052)), bend2 = point(f32(112.597), f32(52.868)), end = point(f32(78.863), f32(52.909));
    curve(outline, tip, bend1, bend2, end);
    for (const p of [point(f32(160.583), f32(52.909)), point(f32(122.846), f32(105.667)), point(f32(146.915), f32(105.667)), point(f32(67.481), f32(184.849))])
        outline.push(fromLogo(p));
    curve(outline, point(f32(67.481), f32(146.468)), point(f32(67.481), f32(123.935)), point(f32(85.748), f32(105.668)), point(f32(108.281), f32(105.667)));
    for (const p of [point(f32(39.202), f32(105.667)), point(f32(69.953), f32(52.91)), point(0, f32(52.91)), point(f32(34.3), f32(.151)), point(f32(172.32), f32(.151))])
        outline.push(fromLogo(p));
    curve(bay, tip, bend1, bend2, end);
    for (const p of [point(f32(160.583), f32(52.909)), point(210, f32(52.909)), point(210, f32(10.156))])
        bay.push(fromLogo(p));
    return { outline, bay };
})();
function signedDistance(p: Point, polygon: Point[]): number {
    let nearest = 3.4028234663852886e38, inside = false;
    for (let i = 0, j = f32(polygon.length - 1); i < polygon.length; j = i++) {
        const a = polygon[j], b = polygon[i];
        nearest = Math.min(nearest, segmentDistance(p, a, b));
        if ((a.y > p.y) !== (b.y > p.y) && p.x < f32(a.x + f32(f32((f32(p.y - a.y)) / (f32(b.y - a.y))) * (f32(b.x - a.x)))))
            inside = !inside;
    }
    return inside ? nearest : -nearest;
}
const clearingRadius = (width: number, height: number): number => clamp(f32((f32(width + height)) * f32(.055)), 11, 15);
function border(seed: number, u: number, north: boolean): number {
    const salt = u32(seed + (north ? 710 : 720)), line = fromLogo(point(0, north ? 36 : f32(105.7))).y;
    const sway = f32((f32(fractalNoise(salt, f32(f32(u * f32(2.5)) + 20), north ? 3 : 9) - f32(.5))) * f32(.08));
    return f32(f32(line + sway) + f32((f32(fractalNoise(u32(salt + 5), f32(f32(u * 14) + 3), north ? 3 : 9) - f32(.5))) * f32(.06)));
}
const depthOf = (seed: number, s: Point): {
    north: number;
    south: number;
} => ({ north: f32(border(seed, s.x, true) - s.y), south: f32(s.y - border(seed, s.x, false)) });
const seam = (depth: number): number => smooth(clamp(f32(f32(depth / f32(.04)) + f32(.5)), 0, 1));
const within = (gap: number, radius: number, soft: number): number => smooth(clamp(f32((f32(f32(radius + soft) - gap)) / soft), 0, 1));
function landMask(seed: number, x: number, y: number, width: number, height: number): number {
    const s = screenOf(point(x, y), width, height);
    const bent = point(f32(f32(f32(s.x + f32((f32(fractalNoise(u32(seed + 310), f32(f32(s.x * 3) + 10), f32(f32(s.y * 3) + 10)) - f32(.5))) * f32(.08))) + f32((f32(fractalNoise(u32(seed + 312), f32(f32(s.x * 7) + 3), f32(f32(s.y * 7) + 3)) - f32(.5))) * f32(.04))) + f32((f32(fractalNoise(u32(seed + 314), f32(f32(s.x * 14) + 7), f32(f32(s.y * 14) + 7)) - f32(.5))) * f32(.035))), f32(f32(f32(s.y + f32((f32(fractalNoise(u32(seed + 311), f32(f32(s.x * 3) + 40), f32(f32(s.y * 3) + 40)) - f32(.5))) * f32(.08))) + f32((f32(fractalNoise(u32(seed + 313), f32(f32(s.x * 7) + 9), f32(f32(s.y * 7) + 9)) - f32(.5))) * f32(.04))) + f32((f32(fractalNoise(u32(seed + 315), f32(f32(s.x * 14) + 2), f32(f32(s.y * 14) + 2)) - f32(.5))) * f32(.035))));
    const spread = f32(f32(.075) + f32((f32(fractalNoise(u32(seed + 300), f32(f32(s.x * f32(2.5)) + 5), f32(f32(s.y * f32(2.5)) + 5)) - f32(.5))) * f32(.06)));
    const body = f32(signedDistance(bent, bolt.outline) + spread), open = -signedDistance(lerp(s, bent, f32(.3)), bolt.bay);
    const edge = f32((f32(f32(body + open) - f32(Math.sqrt(f32(f32((f32(body - open)) * (f32(body - open))) + f32(.0004)))))) / 2);
    let value = f32(f32(f32(edge * 5) + f32((f32(fractalNoise(u32(seed + 320), f32(x * f32(.06)), f32(y * f32(.06))) - f32(.5))) * f32(.5))) + f32((f32(fractalNoise(u32(seed + 321), f32(x * f32(.15)), f32(y * f32(.15))) - f32(.5))) * f32(.2)));
    value = f32(value + f32(f32(Math.max(0, f32(fractalNoise(u32(seed + 330), f32(x * f32(.13)), f32(y * f32(.13))) - f32(.68))) * 9) * within(-edge, f32(.045), f32(.04))));
    const fjord = f32(Math.max(0, f32(f32(1 - Math.abs(f32(f32(2 * fractalNoise(u32(seed + 331), f32(f32(s.x * 9) + 4), f32(f32(s.y * 9) + 4))) - 1))) - f32(.86))) * 7);
    const northShore = f32(smooth(clamp(f32(f32((f32(fromLogo(point(0, 30)).y - s.y)) * 12) + f32(.5)), 0, 1)) * smooth(clamp(f32(f32((f32(fromLogo(point(145, 0)).x - s.x)) * 12) + f32(.5)), 0, 1)));
    value = f32(value - f32(f32(f32(fjord * 3) * northShore) * within(edge, f32(.03), f32(.05))));
    const rim = f32(Math.min(x, y, f32(width - x), f32(height - y)) / (f32(width * f32(.1))));
    if (rim < 1)
        value = f32(value - f32((f32(1 - rim)) * f32(1.6)));
    if (rim < f32(.25))
        value = Math.min(value, f32((f32(rim - f32(.25))) * 8));
    return value;
}
function ridged(seed: number, x: number, y: number): number {
    const ridge = f32(1 - Math.abs(f32(f32(2 * fractalNoise(u32(seed + 500), f32(x * f32(.032)), f32(y * f32(.032)))) - 1))), range = fractalNoise(u32(seed + 510), f32(f32(x * f32(.022)) + 7), f32(y * f32(.022)));
    return f32(f32(ridge - f32(.86)) + f32((f32(range - f32(.5))) * f32(.35)));
}
function elivagar(seed: number, width: number, height: number): River {
    const river: River = { path: [], width: [] };
    for (const side of [-1, 1]) {
        if (river.path.length) {
            river.path.push({ ...river.path[f32(river.path.length - 1)] });
            river.width.push(0);
        }
        const a = fromLogo(add(springLogo, point(f32(side * 3), 0))), b = fromLogo(side < 0 ? point(50, 30) : point(100, 20)), c = fromLogo(side < 0 ? point(24, 37) : point(136, 13)), d = fromLogo(side < 0 ? point(-60, 44) : point(235, 2));
        const own = u32(seed + (side < 0 ? 900 : 950));
        let last = point(-1e9, -1e9);
        for (let step = 0; step <= 4000; step++) {
            const t = f32(step / 4000), r = f32(1 - t), at = cubic(a, b, c, d, t);
            const along = normalized(add(add(scale(sub(b, a), f32(f32(3 * r) * r)), scale(sub(c, b), f32(f32(6 * r) * t))), scale(sub(d, c), f32(f32(3 * t) * t))));
            const swing = f32(f32((f32(fractalNoise(own, f32(t * 7), 0) - f32(.5))) * f32(.07)) * Math.min(1, f32(t * 6))), p = mapOf(add(at, scale(point(-along.y, along.x), swing)), width, height);
            if (p.x < 0 || p.y < 0 || p.x > width || p.y > height || distance(p, last) < f32(.4))
                continue;
            last = p;
            river.path.push(p);
            river.width.push(f32(f32(.9) + f32(valueNoise(u32(own + 1), f32(t * 30), 3) * f32(1.3))));
        }
    }
    return river;
}
function clearing(map: WorldMap, cx: number, cy: number, radius: number): boolean {
    for (let y = f32(cy - radius); y <= f32(cy + radius); y++)
        for (let x = f32(cx - radius); x <= f32(cx + radius); x++) {
            if (!map.inside(x, y))
                return false;
            const terrain = map.at(x, y).terrain;
            if (isWater(terrain) || isStone(terrain) || impassable(terrain))
                return false;
        }
    return true;
}
export function lavaBearing(seed: number, k: number): number { return f32(f32(f32(.785) + f32((f32(k - 1)) * f32(.5))) + f32((f32(hash01(seed, k, 12, 781) - f32(.5))) * f32(.2))); }
export function wildTrees(map: WorldMap, x: number, y: number): number {
    const pick = hash01(map.seed(), x, y, 11), moisture = map.value(Layer.Moisture, point(f32(x + f32(.5)), f32(y + f32(.5))));
    switch (map.at(x, y).terrain) {
        case Terrain.Forest: return f32(1 + Math.trunc(f32(pick * 3)));
        case Terrain.Frost: return moisture > f32(.6) ? f32(1 + Math.trunc(f32(pick * 3))) : Number(moisture > f32(.4) && pick < f32(.16));
        case Terrain.Ash: return moisture > f32(.2) && pick < f32(.2) ? f32(1 + Number(pick < f32(.06))) : 0;
        default: return 0;
    }
}
export function treePosition(map: WorldMap, x: number, y: number, index: number): Point { return point(f32(f32(x + f32(.2)) + f32(hash01(map.seed(), x, y, 30 + index) * f32(.6))), f32(f32(y + f32(.2)) + f32(hash01(map.seed(), x, y, 40 + index) * f32(.6)))); }
export const worldName = (world: World): string => ['Asgard', 'Vanaheim', 'Alfheim', 'Jotunheim', 'Svartalfheim', 'Niflheim', 'Muspelheim', 'Helheim'][world] || '';
export class WorldMap {
    static readonly resolution = 2;
    columns = 0;
    rows = 0;
    mapSeed = 0;
    origin: TileCoord = { x: 0, y: 0 };
    tiles: Tile[] = [];
    layers: Float32Array[] = [];
    stream: River = { path: [], width: [] };
    seen: Sight[] = [];
    sites: Dungeon[] = [];
    ymir: Giant | null = null;
    fire: Volcano | null = null;
    laidOut = true;
    width(): number { return this.columns; }
    height(): number { return this.rows; }
    seed(): number { return this.mapSeed; }
    inside(x: number | Point, y?: number): boolean { if (typeof x !== 'number')
        return this.inside(x.x, x.y); return x >= 0 && y !== undefined && y >= 0 && x < this.columns && y < this.rows; }
    at(x: number, y: number): Tile { return this.tiles[f32(f32(y * this.columns) + x)]; }
    cell(p: Point): Tile | null { const x = Math.floor(p.x), y = Math.floor(p.y); return this.inside(x, y) ? this.at(x, y) : null; }
    start(): TileCoord { return this.origin; }
    camp(): Point { return point(f32(this.origin.x + f32(.5)), f32(this.origin.y + f32(.5))); }
    sights(): Sight[] { return this.seen; }
    dungeons(): Dungeon[] { return this.sites; }
    river(): River { return this.stream; }
    giant(): Giant | null { return this.ymir; }
    volcano(): Volcano | null { return this.fire; }
    hasRegions(): boolean { return this.laidOut; }
    layer(layer: Layer): Float32Array { return this.layers[layer]; }
    sample(layer: Layer, i: number, j: number): number { const stride = f32(f32(this.columns * 2) + 1); if (i < 0 || j < 0 || i >= stride || j > f32(this.rows * 2))
        return layer === Layer.Land ? -1 : 0; return this.layers[layer][f32(f32(j * stride) + i)]; }
    coast(i: number, j: number): number { return this.sample(Layer.Land, i, j); }
    value(layer: Layer, p: Point): number {
        const u = f32(p.x * 2), v = f32(p.y * 2), i = Math.floor(u), j = Math.floor(v), fx = f32(u - i), fy = f32(v - j);
        const a = this.sample(layer, i, j), b = this.sample(layer, f32(i + 1), j), c = this.sample(layer, i, f32(j + 1)), d = this.sample(layer, f32(i + 1), f32(j + 1));
        return f32(f32((f32(a + f32((f32(b - a)) * fx))) * (f32(1 - fy))) + f32((f32(c + f32((f32(d - c)) * fx))) * fy));
    }
    terrainAt(p: Point): Terrain {
        if (this.ymir?.covers(p) || this.fire?.covers(p))
            return Terrain.Mountain;
        const land = this.value(Layer.Land, p);
        if (land < 0)
            return Terrain.Sea;
        for (let i = 1; i < this.stream.path.length; i++)
            if (this.stream.width[f32(i - 1)] > 0 && this.stream.width[i] > 0 && Math.abs(f32(this.stream.path[i].x - p.x)) < 2 && segmentDistance(p, this.stream.path[f32(i - 1)], this.stream.path[i]) < f32(this.stream.width[i] / 2))
                return Terrain.Water;
        const elevation = this.value(Layer.Elevation, p), moisture = this.value(Layer.Moisture, p), heat = this.value(Layer.Heat, p);
        if (land < f32(.05) && this.value(Layer.Beach, p) > f32(.45))
            return Terrain.Sand;
        if (elevation < f32(.3) && land > f32(.12))
            return heat < f32(.2) ? Terrain.Ice : Terrain.Water;
        const ridge = this.value(Layer.Ridge, p);
        if (volcanicCrest(land, heat, ridge))
            return Terrain.Mountain;
        if (lavaLevel(land, heat, ridge) > 0)
            return Terrain.Lava;
        if (land > f32(.1) && ridge > 0)
            return Terrain.Mountain;
        if (heat < f32(.2) && elevation > f32(.55))
            return Terrain.Ice;
        if (elevation > f32(.7))
            return Terrain.Rock;
        if (heat > f32(.62) && moisture < f32(.5))
            return Terrain.Ash;
        if (heat < f32(.25))
            return Terrain.Frost;
        if (moisture > f32(.54))
            return Terrain.Forest;
        return moisture < f32(.38) ? Terrain.Meadow : Terrain.Grass;
    }
    regionAt(p: Point): Region { if (!this.columns || !this.rows)
        return Region.Middle; const depth = depthOf(this.mapSeed, screenOf(p, this.columns, this.rows)); return depth.north > 0 ? Region.North : depth.south > 0 ? Region.South : Region.Middle; }
    regionCenter(region: Region): Point { return mapOf(fromLogo(centreLogos[region]), this.columns, this.rows); }
    hvergelmir(): Point { return mapOf(fromLogo(springLogo), this.columns, this.rows); }
    fireMountain(): Point { return mapOf(fromLogo(fireLogo), this.columns, this.rows); }
    nameLabel(): Point | null {
        if (!this.laidOut || !this.columns || !this.rows)
            return null;
        const anchor = this.regionCenter(Region.Middle), cx = Math.floor(anchor.x), cy = Math.floor(anchor.y);
        let best: Point | null = null, nearest = f32(10.75);
        for (let y = f32(cy - 10); y <= f32(cy + 10); y++)
            for (let x = f32(cx - 10); x <= f32(cx + 10); x++) {
                if (!this.inside(x, y) || this.at(x, y).terrain === Terrain.Sea)
                    continue;
                const center = point(f32(x + f32(.5)), f32(y + f32(.5))), gap = distance(center, anchor);
                if (gap < nearest) {
                    nearest = gap;
                    best = center;
                }
            }
        return best;
    }
    onEasternCoast(p: Point, reach = 10): boolean {
        const tile = this.cell(p);
        if (!tile || isWater(tile.terrain) || impassable(tile.terrain) || f32(f32(p.x / this.columns) - f32(p.y / this.rows)) < f32(.12))
            return false;
        for (let step = 1; step <= reach; step++) {
            const shore = this.cell(add(p, point(step, f32(f32(-step * this.rows) / this.columns))));
            if (shore?.terrain === Terrain.Sea)
                return true;
        }
        return false;
    }
    destination(site: Dungeon): World {
        const region = this.regionAt(point(f32(site.origin.x + 1), f32(site.origin.y + 1)));
        switch (site.kind) {
            case DungeonKind.Cave: return region === Region.South ? World.Svartalfheim : World.Jotunheim;
            case DungeonKind.Crypt: return World.Helheim;
            case DungeonKind.Portal: return region === Region.North ? World.Niflheim : hash01(this.mapSeed, site.origin.x, site.origin.y, 97) < f32(.5) ? World.Alfheim : World.Vanaheim;
            case DungeonKind.Ruin: return region === Region.South ? World.Muspelheim : World.Asgard;
            case DungeonKind.GiantHall: return World.Jotunheim;
        }
        return World.Jotunheim;
    }
    reveal(cx: number, cy: number, radius: number): boolean {
        if (this.seen.some(s => f32(f32(Math.hypot(f32(s.center.x - cx), f32(s.center.y - cy))) + radius) <= s.radius))
            return false;
        this.seen.push({ center: point(cx, cy), radius });
        for (let y = f32(Math.trunc(f32(cy - radius)) - 1); y <= f32(Math.trunc(f32(cy + radius)) + 1); y++)
            for (let x = f32(Math.trunc(f32(cx - radius)) - 1); x <= f32(Math.trunc(f32(cx + radius)) + 1); x++)
                if (this.inside(x, y) && f32(Math.hypot(f32(f32(x + f32(.5)) - cx), f32(f32(y + f32(.5)) - cy))) <= radius)
                    this.at(x, y).revealed = true;
        if (this.fire && distance(point(cx, cy), this.fire.center()) <= radius)
            for (const sight of this.fire.sights())
                if (!this.revealedWithin(sight.center, sight.radius))
                    this.reveal(sight.center.x, sight.center.y, sight.radius);
        return true;
    }
    revealStart(): void { this.reveal(this.camp().x, this.camp().y, 7); }
    revealedWithin(p: Point, margin: number): boolean { return this.seen.some(s => f32(distance(s.center, p) + margin) <= s.radius); }
    revealed(p: Point): boolean { return this.seen.some(s => distance(s.center, p) <= s.radius); }
    discover(): number[] { const found: number[] = []; for (let i = 0; i < this.sites.length; i++) {
        const site = this.sites[i];
        if (site.discovered)
            continue;
        for (let dy = 0; dy < 2 && !site.discovered; dy++)
            for (let dx = 0; dx < 2; dx++)
                if (this.at(f32(site.origin.x + dx), f32(site.origin.y + dy)).revealed) {
                    site.discovered = true;
                    break;
                }
        if (site.discovered)
            found.push(i);
    } return found; }
    static generate(seed: number, width = 176, height = 176): WorldMap {
        const map = new WorldMap();
        map.columns = width;
        map.rows = height;
        map.mapSeed = seed >>> 0;
        map.tiles = Array.from({ length: f32(width * height) }, makeTile);
        const stride = f32(f32(width * 2) + 1);
        map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(f32(stride * (f32(f32(height * 2) + 1)))));
        const layer = (l: Layer): Float32Array => map.layers[l];
        const tile = tileSpan(width, height), clear = clearingRadius(width, height), stone = mapOf(add(fromLogo(ymirShoreLogo), point(0, f32(-7 * tile))), width, height);
        map.ymir = new Giant({ x: f32(lround(stone.x) - f32(Giant.size / 2)), y: f32(lround(stone.y) - f32(Giant.size / 2)) });
        const heart = map.ymir.center(), spring = mapOf(fromLogo(springLogo), width, height), fire = mapOf(fromLogo(fireLogo), width, height), lake = Math.max(f32(2.5), f32(f32(.045) / tile));
        map.fire = Volcano.around(fire);
        const mereWide = 6, mereFront = f32(5.5), mereBack = clamp(f32((f32(width + height)) * f32(.037)), f32(8.5), 13);
        for (let j = 0; j <= f32(height * 2); j++)
            for (let i = 0; i <= f32(width * 2); i++) {
                const x = f32(i / 2), y = f32(j / 2), depth = depthOf(seed, screenOf(point(x, y), width, height));
                const cold = seam(depth.north), hot = seam(depth.south), mild = f32((f32(1 - cold)) * (f32(1 - hot))), north = Math.max(0, depth.north), south = Math.max(0, depth.south);
                const n = f32(fractalNoise(u32(seed + 600), f32(x * f32(.05)), f32(y * f32(.05))) - f32(.5));
                let heat = f32(f32(f32((f32(f32(.45) + f32(n * f32(.12)))) * mild) + f32((f32(f32(f32(.245) - f32(north * f32(.5))) + f32(n * f32(.03)))) * cold)) + f32(Math.min(f32(f32(f32(.7) + f32(south * f32(.9))) + f32(n * f32(.1))), f32(lavaFloor - f32(.025))) * hot));
                let elevation = f32(f32(fractalNoise(seed, f32(x * f32(.07)), f32(y * f32(.07))) + f32(f32(cold * Math.max(0, f32(north - f32(.08)))) * f32(1.3))) + f32(mild * f32(.03)));
                elevation = f32(elevation + f32(hot * Math.max(0, f32(f32(.34) - elevation))));
                let moisture = f32(fractalNoise(u32(seed + 77), f32(f32(x * f32(.09)) + 40), f32(f32(y * f32(.09)) + 40)) - f32(hot * f32(.3)));
                let ridge = f32(f32(f32(ridged(seed, x, y) - f32(f32(.16) * mild)) - f32(f32(.06) * cold)) - f32(f32(.1) * hot));
                const here = screenOf(point(x, y), width, height);
                for (const spine of spines) {
                    const gap = Math.min(segmentDistance(here, fromLogo(spine[0]), fromLogo(spine[1])), segmentDistance(here, fromLogo(spine[1]), fromLogo(spine[2])));
                    const pass = smooth(clamp(f32((f32(fractalNoise(u32(seed + 850), f32(x * f32(.09)), f32(y * f32(.09))) - f32(.3))) * 6), 0, 1)), crest = f32(f32(.04) + f32(f32(.16) * fractalNoise(u32(seed + 860), f32(x * f32(.15)), f32(y * f32(.15)))));
                    ridge = f32(ridge + f32(f32((f32(crest - ridge)) * within(gap, f32(.016), f32(.022))) * pass));
                }
                elevation = f32(elevation + f32(Math.max(0, f32(ridge + f32(.3))) * f32(.55)));
                const beach = f32(fractalNoise(u32(seed + 330), f32(x * f32(.1)), f32(y * f32(.1))) - f32((f32(cold + hot)) * f32(.6)));
                let land = landMask(seed, x, y, width, height);
                const wobble = (from: Point, salt: number): number => { const angle = f32(Math.atan2(f32(y - from.y), f32(x - from.x))); return f32(f32(.8) + f32(f32(.4) * fractalNoise(u32(seed + salt), f32(f32(f32(Math.cos(angle)) * f32(1.5)) + 5), f32(f32(f32(Math.sin(angle)) * f32(1.5)) + 5)))); };
                const rift = f32(Math.hypot(f32(f32((f32(f32(f32(x - spring.x) - y) + spring.y)) * f32(.7071)) / f32(1.45)), f32((f32(f32(f32(x - spring.x) + y) - spring.y)) * f32(.7071)))), lip = f32(Math.atan2(f32(y - spring.y), f32(x - spring.x)));
                const ragged = f32(wobble(spring, 730) + f32(f32(.16) * (f32(fractalNoise(u32(seed + 731), f32(f32(f32(Math.cos(lip)) * 4) + 9), f32(f32(f32(Math.sin(lip)) * 4) + 9)) - f32(.5))))), pool = within(rift, f32(lake * ragged), f32(1.5));
                land = f32(land + f32(Math.max(0, f32(f32(.8) - land)) * within(distance(point(x, y), spring), f32(f32(lake * f32(1.45)) + 6), 4)));
                elevation = f32(elevation + f32((f32(f32(.1) - elevation)) * pool));
                heat = f32(heat + f32((f32(f32(.3) - heat)) * within(rift, f32(f32(lake * ragged) - f32(.4)), f32(.9))));
                ridge = f32(ridge + f32((f32(-f32(.5) - ridge)) * within(rift, f32(lake + 3), 2)));
                const gap = distance(point(x, y), fire), cone = f32(Volcano.size * f32(.5)), heading = f32(Math.atan2(f32(y - fire.y), f32(x - fire.x))), reach = clamp(f32((f32(width + height)) / 352), f32(.5), 1), burning = f32(hot * hot);
                const tongue = f32(cone + f32((f32(6 + f32(14 * fractalNoise(u32(seed + 795), f32(f32(f32(Math.cos(heading)) * f32(2.2)) + 5), f32(f32(f32(Math.sin(heading)) * f32(2.2)) + 5))))) * reach));
                const apron = f32(within(gap, tongue, 3) * burning), older = smooth(clamp(f32((f32(fractalNoise(u32(seed + 796), f32(x * f32(.22)), f32(y * f32(.22))) - f32(.62))) * 8), 0, 1));
                land = f32(land + f32(Math.max(0, f32(f32(.8) - land)) * within(gap, f32(cone + 14), 4)));
                heat = f32(heat + f32(f32((f32(Math.max(heat, 1) - heat)) * within(gap, f32(tongue + 2), 3)) * burning));
                let channels = 0;
                for (let k = 3; k < 5; k++) {
                    let aim = f32(f32(f32(3.9) + f32((f32(k - 3)) * f32(1.2))) + f32((f32(hash01(seed, k, 11, 780) - f32(.5))) * f32(.8)));
                    aim = f32(aim + f32((f32(fractalNoise(u32(u32(seed + 790) + k), f32(gap * f32(.12)), 3) - f32(.5))) * f32(.9)));
                    channels = Math.max(channels, within(f32(Math.abs(remainder(f32(heading - aim), f32(6.2832))) * gap), f32(.9), f32(1.2)));
                }
                ridge = f32(ridge + f32(f32((f32(f32(f32(.025) + f32(f32(.03) * channels)) - ridge)) * apron) * (f32(1 - older))));
                ridge = f32(ridge + f32(f32((f32(-f32(.4) - ridge)) * apron) * older));
                elevation = f32(elevation + f32((f32(f32(.85) - elevation)) * within(gap, f32(cone + 2), 16)));
                const front = f32((f32(f32(f32(x - heart.x) + y) - heart.y)) * f32(.7071)), near = f32(within(f32(distance(point(x, y), heart) / wobble(heart, 750)), clear, 4) * smooth(clamp(f32(f32(front / 4) + f32(.5)), 0, 1)));
                elevation = f32(elevation + f32((f32(f32(.48) - elevation)) * near));
                moisture = f32(moisture + f32((f32(f32(.44) - moisture)) * near));
                ridge = f32(ridge + f32((f32(-f32(.6) - ridge)) * near));
                heat = f32(heat + f32((f32(f32(.45) - heat)) * near));
                const grove = within(f32(distance(point(x, y), add(heart, point(3, 12))) / wobble(heart, 770)), f32(3.5), f32(1.5));
                moisture = f32(moisture + f32((f32(f32(.78) - moisture)) * grove));
                const behind = f32(-(f32(f32(f32(x - heart.x) + y) - heart.y)) * f32(.7071)), across = f32((f32(f32(f32(x - heart.x) - y) + heart.y)) * f32(.7071));
                const bearing = f32(Math.atan2(f32(y - heart.y), f32(x - heart.x))), shore = f32(f32(.93) + f32(f32(.14) * fractalNoise(u32(seed + 760), f32(f32(f32(Math.cos(bearing)) * f32(1.8)) + 5), f32(f32(f32(Math.sin(bearing)) * f32(1.8)) + 5))));
                const mere = within(f32(f32(Math.hypot(f32(across / mereWide), f32((f32(behind - f32((f32(mereBack - mereFront)) / 2))) / (f32((f32(mereBack + mereFront)) / 2))))) / shore), 1, f32(.15));
                land = f32(land - f32(mere * (f32(land + f32(.4)))));
                ridge = f32(ridge + f32((f32(-f32(.6) - ridge)) * mere));
                const at = f32(f32(j * stride) + i);
                layer(Layer.Land)[at] = land;
                layer(Layer.Elevation)[at] = elevation;
                layer(Layer.Moisture)[at] = moisture;
                layer(Layer.Shade)[at] = fractalNoise(u32(seed + 5), f32(x * f32(.3)), f32(y * f32(.3)));
                layer(Layer.Beach)[at] = beach;
                layer(Layer.Ridge)[at] = ridge;
                layer(Layer.Heat)[at] = heat;
            }
        map.stream = elivagar(seed, width, height);
        map.carveLava();
        map.finishGeneration();
        return map;
    }
    private carveLava(): void {
        if (!this.fire)
            return;
        const seed = this.mapSeed, width = this.columns, height = this.rows, resolution = 2, stride = f32(f32(width * 2) + 1);
        const landAt = (p: Point): number => this.value(Layer.Land, p), foot = this.fire.center();
        for (let k = 0; k < 3; k++) {
            const bearing = lavaBearing(seed, k);
            let heading = point(f32(Math.cos(bearing)), f32(Math.sin(bearing)));
            const run = [add(foot, scale(heading, f32(volcanoFoot - 1)))];
            while (run.length < 240 && this.inside(run[f32(run.length - 1)]) && landAt(run[f32(run.length - 1)]) > -f32(.04)) {
                const at = run[f32(run.length - 1)], downhill = point(f32(landAt(sub(at, point(f32(.6), 0))) - landAt(add(at, point(f32(.6), 0)))), f32(landAt(sub(at, point(0, f32(.6)))) - landAt(add(at, point(0, f32(.6))))));
                const steep = f32(Math.min(1, f32(length(downhill) * 12)) * f32(.8)), wander = f32(bearing + f32((f32(fractalNoise(u32(u32(seed + 900) + k), f32(at.x * f32(.12)), f32(at.y * f32(.12))) - f32(.5))) * f32(1.4)));
                const want = add(scale(point(f32(Math.cos(wander)), f32(Math.sin(wander))), f32(1 - steep)), steep > 0 ? scale(normalized(downhill), steep) : point());
                heading = normalized(add(scale(heading, f32(.75)), scale(normalized(want), f32(.25))));
                run.push(add(at, scale(heading, f32(.5))));
            }
            const along = [0];
            for (let i = 1; i < run.length; i++)
                along.push(f32(along[f32(along.length - 1)] + distance(run[f32(i - 1)], run[i])));
            let open = 0;
            while (open < run.length && this.value(Layer.Heat, run[open]) > f32(.9))
                open++;
            let shore = open;
            while (shore < run.length && landAt(run[shore]) > f32(.02))
                shore++;
            const stretch = open < run.length ? f32(along[Math.min(shore, f32(run.length - 1))] - along[open]) : 0, reach = f32(2.4), roofed = open < run.length;
            let roof = 0, roofHalf = 0;
            if (stretch >= f32(3.8)) {
                roofHalf = Math.min(f32(2.4), f32(stretch / 2));
                roof = f32(along[open] + f32(stretch / 2));
            }
            else if (roofed) {
                roofHalf = f32((f32(f32(along[f32(along.length - 1)] - along[open]) + f32(1.3))) / 2);
                roof = f32(along[f32(along.length - 1)] - roofHalf);
            }
            let low = run[0], high = run[0];
            for (const p of run) {
                low = point(Math.min(low.x, p.x), Math.min(low.y, p.y));
                high = point(Math.max(high.x, p.x), Math.max(high.y, p.y));
            }
            const i0 = Math.max(0, Math.trunc(f32((f32(low.x - reach)) * resolution))), i1 = Math.min(f32(width * resolution), f32(Math.trunc(f32((f32(high.x + reach)) * resolution)) + 1));
            const j0 = Math.max(0, Math.trunc(f32((f32(low.y - reach)) * resolution))), j1 = Math.min(f32(height * resolution), f32(Math.trunc(f32((f32(high.y + reach)) * resolution)) + 1)), span = f32(f32(i1 - i0) + 1);
            const molten = new Float32Array(f32(span * (f32(f32(j1 - j0) + 1)))).fill(1e9), crusted = molten.slice(), mouth = along[Math.min(shore, f32(run.length - 1))];
            for (let s = 1; s < run.length; s++) {
                const roofs = roofed && Math.abs(f32(f32((f32(along[f32(s - 1)] + along[s])) / 2) - roof)) < roofHalf, near = roofs ? crusted : molten;
                const fan = roofs ? 0 : f32(f32(.9) * smooth(clamp(f32((f32(f32(along[s] - mouth) + 3)) / 3), 0, 1)));
                const a0 = Math.max(i0, Math.floor(f32((f32(Math.min(run[f32(s - 1)].x, run[s].x) - reach)) * resolution))), a1 = Math.min(i1, Math.ceil(f32((f32(Math.max(run[f32(s - 1)].x, run[s].x) + reach)) * resolution)));
                const b0 = Math.max(j0, Math.floor(f32((f32(Math.min(run[f32(s - 1)].y, run[s].y) - reach)) * resolution))), b1 = Math.min(j1, Math.ceil(f32((f32(Math.max(run[f32(s - 1)].y, run[s].y) + reach)) * resolution)));
                for (let j = b0; j <= b1; j++)
                    for (let i = a0; i <= a1; i++) {
                        const cell = f32(f32(f32((f32(j - j0)) * span) + i) - i0);
                        near[cell] = Math.min(near[cell], f32(segmentDistance(point(f32(i / resolution), f32(j / resolution)), run[f32(s - 1)], run[s]) - fan));
                    }
            }
            for (let j = j0; j <= j1; j++)
                for (let i = i0; i <= i1; i++) {
                    const cell = f32(f32(f32((f32(j - j0)) * span) + i) - i0), at = f32(f32(j * stride) + i);
                    let heat = this.layers[Layer.Heat][at], ridge = this.layers[Layer.Ridge][at];
                    const warm = Math.max(within(molten[cell], f32(.6), f32(.7)), within(crusted[cell], f32(.6), f32(.7))), core = within(molten[cell], f32(.3), 1);
                    heat = Math.max(heat, f32(heat + f32((f32(2 - heat)) * warm)));
                    ridge = Math.max(ridge, f32(ridge + f32((f32(f32(.07) - ridge)) * core)));
                    ridge = f32(ridge + f32(f32((f32(-f32(.13) - ridge)) * within(crusted[cell], f32(1.4), f32(.8))) * (f32(1 - core))));
                    this.layers[Layer.Heat][at] = heat;
                    this.layers[Layer.Ridge][at] = ridge;
                }
        }
    }
    private finishGeneration(): void {
        const width = this.columns, height = this.rows, seed = this.mapSeed, heart = this.ymir!.center();
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const center = point(f32(x + f32(.5)), f32(y + f32(.5))), tile = makeTile();
                tile.terrain = this.terrainAt(center);
                tile.shade = Math.trunc(Math.min(3, f32(this.value(Layer.Shade, center) * 4)));
                this.tiles[f32(f32(y * width) + x)] = tile;
                tile.wild = tile.trees = wildTrees(this, x, y);
            }
        const settleable = (terrain: Terrain): boolean => !isWater(terrain) && !isStone(terrain) && !impassable(terrain) && terrain !== Terrain.Ash && terrain !== Terrain.Frost;
        const open = new Int32Array(f32((f32(width + 1)) * (f32(height + 1)))), dry = new Int32Array(open.length);
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
                const at = f32(f32(f32((f32(y + 1)) * (f32(width + 1))) + x) + 1), up = f32(f32(f32(y * (f32(width + 1))) + x) + 1), left = f32(at - 1), corner = f32(up - 1);
                open[at] = f32(f32(f32(Number(settleable(this.at(x, y).terrain)) + open[up]) + open[left]) - open[corner]);
                dry[at] = f32(f32(f32(Number(this.at(x, y).terrain !== Terrain.Sea) + dry[up]) + dry[left]) - dry[corner]);
            }
        const count = (sums: Int32Array, cx: number, cy: number, r: number): number => {
            const x0 = Math.max(0, f32(cx - r)), y0 = Math.max(0, f32(cy - r)), x1 = Math.min(width, f32(f32(cx + r) + 1)), y1 = Math.min(height, f32(f32(cy + r) + 1));
            return f32(f32(f32(sums[f32(f32(y1 * (f32(width + 1))) + x1)] - sums[f32(f32(y0 * (f32(width + 1))) + x1)]) - sums[f32(f32(y1 * (f32(width + 1))) + x0)]) + sums[f32(f32(y0 * (f32(width + 1))) + x0)]);
        };
        const openShare = (cx: number, cy: number, r: number): number => { const land = count(dry, cx, cy, r); return land ? f32(count(open, cx, cy, r) / land) : 0; };
        const landShare = (cx: number, cy: number, r: number): number => f32(count(dry, cx, cy, r) / (f32((f32(f32(2 * r) + 1)) * (f32(f32(2 * r) + 1)))));
        let best = { x: Math.trunc(f32(width / 2)), y: Math.trunc(f32(height / 2)) };
        const feet = point(f32(heart.x + 7), f32(heart.y + 7));
        const level = (x: number, y: number): boolean => { for (let dy = -f32(.25); dy <= f32(1.25); dy = f32(dy + f32(.25)))
            for (let dx = -f32(.25); dx <= f32(1.25); dx = f32(dx + f32(.25)))
                if (!settleable(this.terrainAt(point(f32(x + dx), f32(y + dy)))))
                    return false; return true; };
        let found = false;
        for (const near of [true, false])
            for (const [clear, room] of [[3, 9], [3, 6], [3, 3], [2, 3], [1, 1], [0, 0]]) {
                if (found || near && clear < 2)
                    continue;
                let nearest = 3.4028234663852886e38;
                const margin = Math.min(10, f32(clear + 2));
                for (let y = margin; y < f32(height - margin); y++)
                    for (let x = margin; x < f32(width - margin); x++) {
                        const before = distance(point(f32(x + f32(.5)), f32(y + f32(.5))), heart) <= 13 && f32(f32(f32(f32(x + y) + 1) - heart.x) - heart.y) > 4;
                        if (near && !before || !clearing(this, x, y, clear) || landShare(x, y, room) < f32(.5))
                            continue;
                        const gap = f32(f32(distance(point(f32(x + f32(.5)), f32(y + f32(.5))), feet) + f32((f32(1 - openShare(x, y, 10))) * 40)) + f32(hash01(seed, x, y, 23) * f32(.5)));
                        if (gap < nearest && level(x, y)) {
                            nearest = gap;
                            best = { x, y };
                        }
                    }
                found = nearest < 3.4028234663852886e38;
            }
        this.origin = best;
        for (let y = f32(best.y - 2); y <= f32(best.y + 2); y++)
            for (let x = f32(best.x - 2); x <= f32(best.x + 2); x++)
                if (this.inside(x, y))
                    this.at(x, y).trees = this.at(x, y).wild = 0;
        const origin = this.ymir!.origin;
        for (let y = f32(origin.y - 3); y < f32(f32(origin.y + Giant.size) + 3); y++)
            for (let x = f32(origin.x - 3); x < f32(f32(origin.x + Giant.size) + 3); x++)
                if (this.inside(x, y))
                    this.at(x, y).trees = this.at(x, y).wild = 0;
        placeDungeons(this, this.sites, best);
        this.revealStart();
        if (this.sites.length)
            this.sites[0].discovered = true;
        this.discover();
    }
}
