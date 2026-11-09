import { add, point, segmentDistance } from './geometry';
import { f32, hash01, u32 } from './numeric';
import { DungeonKind, Giant, Region, Terrain, World, impassable, isStone, isWater, type Dungeon, type TileCoord } from './world-types';
import type { WorldMap } from './world-map';
const titles = [
    ['Tower of Ravens', 'The Broken Hall', "Bifrost's Foot", 'Valgrind'],
    ['The Green Door', 'The Vanir Well', 'The Golden Glade', "Njord's Gate"],
    ['The Bright Gate', "Freyr's Glade", 'The Elfhame Door', 'Glimmering Rift'],
    ['Ironwood Den', 'Wargmaw', 'The Howling Cleft', 'Greyfang Hollow'],
    ["Dvalin's Door", 'The Deep Delving', "Brokk's Stair", 'The Forge Below'],
    ['The Mist Gate', 'Rime Rift', 'The Frozen Throat', 'The Weeping Gate'],
    ["Surt's Door", 'The Burning Hall', 'The Ember Gate', 'The Cinder Rift'],
    ['Barrow of Kings', 'The Drowned Howe', 'Draugmound', 'Gjallar Crossing'],
];
function fits(map: WorldMap, x: number, y: number, kind: DungeonKind, home: boolean): boolean {
    const giant = map.giant();
    if (giant && f32(x + 5) > giant.origin.x && f32(x - 3) < f32(giant.origin.x + Giant.size) && f32(y + 5) > giant.origin.y && f32(y - 3) < f32(giant.origin.y + Giant.size))
        return false;
    let rockNear = false;
    for (let dy = -1; dy <= 2; dy++)
        for (let dx = -1; dx <= 2; dx++) {
            if (!map.inside(f32(x + dx), f32(y + dy)))
                return false;
            const tile = map.at(f32(x + dx), f32(y + dy)), footprint = dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1;
            if (footprint && (isWater(tile.terrain) || impassable(tile.terrain) || tile.dungeon >= 0))
                return false;
            const doorstep = dx === 1 && dy === 2;
            if (doorstep && (isWater(tile.terrain) || impassable(tile.terrain)))
                return false;
            rockNear ||= isStone(tile.terrain);
        }
    return kind !== DungeonKind.Cave || rockNear || home;
}
function clearEntrance(map: WorldMap, at: TileCoord, index: number): void {
    for (let dy = -2; dy < 4; dy++)
        for (let dx = -2; dx < 4; dx++) {
            if (!map.inside(f32(at.x + dx), f32(at.y + dy)))
                continue;
            const tile = map.at(f32(at.x + dx), f32(at.y + dy));
            if (dx >= 0 && dx < 2 && dy >= 0 && dy < 2)
                tile.dungeon = index;
            tile.trees = tile.wild = 0;
        }
}
export function reachable(map: WorldMap, start: TileCoord): Uint8Array {
    const width = map.width(), height = map.height(), river = new Uint8Array(f32(width * height)), seen = new Uint8Array(f32(width * height)), stream = map.river();
    for (let i = 1; i < stream.path.length; i++) {
        if (stream.width[f32(i - 1)] <= 0 || stream.width[i] <= 0)
            continue;
        const a = stream.path[f32(i - 1)], b = stream.path[i], reach = f32(f32(stream.width[i] / 2) + f32(.7));
        for (let y = Math.floor(f32(Math.min(a.y, b.y) - reach)); y <= Math.ceil(f32(Math.max(a.y, b.y) + reach)); y++)
            for (let x = Math.floor(f32(Math.min(a.x, b.x) - reach)); x <= Math.ceil(f32(Math.max(a.x, b.x) + reach)); x++)
                if (map.inside(x, y) && segmentDistance(point(f32(x + f32(.5)), f32(y + f32(.5))), a, b) <= reach)
                    river[f32(f32(y * width) + x)] = 1;
    }
    const open = (x: number, y: number): boolean => { const terrain = map.at(x, y).terrain; return !impassable(terrain) && (!isWater(terrain) || terrain === Terrain.Water && !!river[f32(f32(y * width) + x)]); };
    const stack = [start];
    seen[f32(f32(start.y * width) + start.x)] = 1;
    while (stack.length) {
        const at = stack.pop()!;
        for (const step of [point(1, 0), point(-1, 0), point(0, 1), point(0, -1)]) {
            const x = f32(at.x + step.x), y = f32(at.y + step.y);
            if (!map.inside(x, y) || seen[f32(f32(y * width) + x)] || !open(x, y))
                continue;
            seen[f32(f32(y * width) + x)] = 1;
            stack.push({ x, y });
        }
    }
    return seen;
}
export function placeDungeons(map: WorldMap, sites: Dungeon[], start: TileCoord): void {
    const reach = reachable(map, start);
    const gates = [[World.Jotunheim, DungeonKind.Cave], [World.Helheim, DungeonKind.Crypt], [World.Niflheim, DungeonKind.Portal], [World.Muspelheim, DungeonKind.Ruin], [World.Asgard, DungeonKind.Ruin], [World.Alfheim, DungeonKind.Portal], [World.Vanaheim, DungeonKind.Portal], [World.Svartalfheim, DungeonKind.Cave]] as const;
    for (let k = 0; k < gates.length; k++) {
        const [world, kind] = gates[k], home = k === 0;
        let best = { x: -1, y: -1 }, bestScore = -1;
        for (let y = 2; y < f32(map.height() - 3); y++)
            for (let x = 2; x < f32(map.width() - 3); x++) {
                let distance = f32(Math.hypot(f32(x - start.x), f32(y - start.y)));
                if (home)
                    distance = f32(Math.hypot(f32(f32(x + 1) - (f32(start.x + f32(.5)))), f32(f32(y + 1) - (f32(start.y + f32(.5))))));
                if ((home ? distance < 7 || distance > f32(11.5) : distance < 18) || !fits(map, x, y, kind, home) || !reach[f32(f32(f32((f32(y + 2)) * map.width()) + x) + 1)])
                    continue;
                if (map.destination({ name: '', kind, origin: { x, y }, discovered: false }) !== world)
                    continue;
                if (sites.some(d => f32(Math.hypot(f32(d.origin.x - x), f32(d.origin.y - y))) < 14))
                    continue;
                const giant = map.giant();
                if (!home && giant && giant.sights().some(s => f32(Math.hypot(f32(f32(s.center.x - x) - 1), f32(f32(s.center.y - y) - 1))) <= f32(s.radius + f32(1.5))))
                    continue;
                let score = f32(hash01(map.seed(), x, y, 90 + k) - f32(Math.abs(f32(distance - (home ? 9 : f32(24 + f32(Math.trunc(f32(k / 4)) * 30))))) * f32(.02)));
                if (home && giant)
                    score = f32(score + f32(f32((f32(f32(f32(f32(f32(x + 1) - giant.center().x) + y) + 1) - giant.center().y)) * f32(.7071)) * f32(.03)));
                if (score > bestScore) {
                    bestScore = score;
                    best = { x, y };
                }
            }
        if (best.x < 0)
            continue;
        const names = titles[world];
        sites.push({ name: names[Math.trunc(f32(hash01(map.seed(), world, 3, 95) * names.length)) % names.length], kind, origin: best, discovered: false });
        clearEntrance(map, best, f32(sites.length - 1));
    }
    const halls = ['Eastshore Stone Hall', 'The Tideworn Hall'];
    for (let k = 0; k < (map.width() >= 128 ? 2 : 1); k++) {
        let best = { x: -1, y: -1 }, bestScore = -1;
        for (let y = 2; y < f32(map.height() - 3); y++)
            for (let x = 2; x < f32(map.width() - 3); x++) {
                const door = point(f32(x + 1), f32(y + f32(2.3)));
                if (!map.onEasternCoast(door) || !fits(map, x, y, DungeonKind.GiantHall, false) || !reach[f32(f32(f32((f32(y + 2)) * map.width()) + x) + 1)])
                    continue;
                if (f32(Math.hypot(f32(x - start.x), f32(y - start.y))) < Math.min(18, f32(map.width() * f32(.2))))
                    continue;
                if (sites.some(d => f32(Math.hypot(f32(d.origin.x - x), f32(d.origin.y - y))) < Math.min(12, f32(map.width() / 10))))
                    continue;
                const score = f32(hash01(map.seed(), x, y, 171 + k) + (map.regionAt(door) === Region.Middle ? 2 : 0));
                if (score > bestScore) {
                    bestScore = score;
                    best = { x, y };
                }
            }
        if (best.x < 0)
            continue;
        sites.push({ name: halls[k], kind: DungeonKind.GiantHall, origin: best, discovered: false });
        clearEntrance(map, best, f32(sites.length - 1));
    }
}
