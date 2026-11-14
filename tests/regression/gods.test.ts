// Thor's visits and Jormungandr: when he comes and goes, what he does by day and night, the limits on his
// hunting, his storms, his place in a save; where the serpent lies, when it shows and what it costs.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Calling, Monster, Role } from '../../packages/engine/src/person';
import { Camera, add, distance, point, project } from '../../packages/engine/src/geometry';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Sky, Weather } from '../../packages/engine/src/climate';
import { Thunderstorm } from '../../packages/engine/src/thunderstorm';
import { findRealmArea, inArea } from '../../packages/engine/src/realm-layout';
import { BoltKind, ThorDoing, thorRules, thunderFactor } from '../../packages/engine/src/thor-visit';
import {
  partMiddle,
  partRise,
  serpentEmergence,
  serpentParts,
  serpentRing,
  serpentRules,
  serpentSighting,
  SerpentPartKind,
  weatherSpell,
} from '../../packages/native-renderer/src/serpent-ring';
import { serpentSights, updateSerpent } from '../../packages/native-renderer/src/world-serpent';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { pickSource } from '../../packages/native-renderer/src/world-pick-registry';
import { SceneNode, type PaintNode } from '../../packages/native-renderer/src/paint';
import { hasHangul, setLocale, translate } from '../../packages/localization/src/index';
import { godsPhrases } from '../../packages/localization/src/korean/gods';
import { landmarkDescription } from '../../apps/web/src/native/world-targets';

const day = Town.secondsPerDay;
/** An open grass settlement with a camp; `altar` adds a finished Altar of Odin, `folk` residents. */
function settlement(folk = 4, altar = true): Town {
  const map = new WorldMap();
  map.columns = map.rows = 64;
  map.mapSeed = 5;
  map.origin = { x: 20, y: 20 };
  map.tiles = Array.from({ length: 64 * 64 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(129 * 129).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Cave', kind: DungeonKind.Cave, origin: { x: 56, y: 56 }, discovered: true }];
  const town = new Town(map, 64, false);
  town.placed.push(new Building(0, Structure.Camp, point(20, 20), 0, 0));
  if (altar) town.placed.push(new Building(1, Structure.Shrine, point(25, 18), 0, 0));
  town.nextId = 2;
  town.migrateSettlements();
  town.folk = [];
  town.nextPerson = 0;
  for (let i = 0; i < folk; ++i) {
    const p = town.makePerson(Role.Resident, Calling.Settler, point(18 + i, 22));
    p.food = p.rest = p.hydration = 1;
    town.folk.push(p);
  }
  town.stock().food = 999;
  town.summonRaid = () => {};
  town.releaseMonster = () => {};
  town.tick(0);
  return town;
}
/** Runs the town `seconds` on, keeping its residents fed, and calls `each` every game second. */
function run(town: Town, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1) {
    for (const p of town.folk) p.food = p.hydration = Math.max(p.food, 0.8);
    town.advance(1);
    each?.();
  }
}
/** Morning of day `d`. */
const morning = (town: Town, d: number) => {
  town.days = d;
  town.time = d * day + day * 0.32;
};
function arrived(town: Town): Town {
  run(town, day * 1.5, () => {});
  expect(town.thor.present).toBe(true);
  return town;
}

describe('Thor comes to Midgard', () => {
  it('only once the settlement has an altar and a few residents', () => {
    const bare = settlement(4, false);
    run(bare, day * 3);
    expect(bare.thor.present).toBe(false);
    expect(bare.thor.nextVisit).toBe(-1);
    const few = settlement(thorRules.residents - 1, true);
    run(few, day * 3);
    expect(few.thor.present).toBe(false);
    const called = settlement(thorRules.residents, true);
    run(called, day * 3);
    expect(called.thor.present).toBe(true);
    expect(called.thor.visits).toBe(1);
    expect(called.notices).toContain('Thor has come to Midgard');
    expect(called.thor.bolts.some((b) => b.kind === BoltKind.Arrival) || called.thor.arrivedDay >= 0).toBe(true);
    // He comes by day, near the fire, never in the dark.
    expect(distance(called.thor.position, point(20, 20))).toBeLessThan(10);
  });
  it('stays about a week, leaves by day and comes again some weeks later', () => {
    const town = arrived(settlement());
    const came = town.thor.arrivedDay;
    run(town, day * (thorRules.stay - 1));
    expect(town.thor.present).toBe(true);
    run(town, day * 1.5);
    expect(town.thor.present).toBe(false);
    expect(town.notices).toContain('Thor leaves Midgard');
    expect(town.days - came).toBeGreaterThanOrEqual(thorRules.stay);
    expect(town.days - came).toBeLessThanOrEqual(thorRules.stay + 1);
    expect(town.thor.nextVisit - town.days).toBeGreaterThanOrEqual(thorRules.gapLeast - 1);
    expect(town.thor.nextVisit - town.days).toBeLessThanOrEqual(thorRules.gapMost);
  });
  it('enjoys the settlement by day in several ways and hunts only by night', () => {
    const town = arrived(settlement());
    town.placed.push(new Building(2, Structure.Tavern, point(15, 24), 0, 0));
    town.nextId = 3;
    const byDay = new Set<ThorDoing>(),
      byNight = new Set<ThorDoing>();
    run(town, day * 4, () => {
      const night = town.climate().night;
      if (night < 0.05) byDay.add(town.thor.doing);
      if (night > 0.95) byNight.add(town.thor.doing);
    });
    const pastimes = [ThorDoing.Strolling, ThorDoing.Fireside, ThorDoing.Watching, ThorDoing.Lifting, ThorDoing.Drinking];
    expect([...byDay].filter((d) => pastimes.includes(d)).length).toBeGreaterThanOrEqual(3);
    expect(byDay.has(ThorDoing.Hunting)).toBe(false);
    expect([...byNight]).toEqual([ThorDoing.Hunting]);
  });
  it('kills a monster near the settlement at night with the hammer, and no resident earns it', () => {
    const town = arrived(settlement());
    while (town.climate().night < 0.9) run(town, 5);
    const foe = new Monster(town.nextMonster++, 0, point(26, 26));
    foe.home = { ...foe.position };
    foe.health = foe.vigor = 13;
    town.beasts.push(foe);
    const xp = town.folk.map((p) => p.experience + p.level * 1000);
    let bolt = false;
    run(town, 20, () => (bolt ||= town.thor.bolts.some((b) => b.kind === BoltKind.Hammer)));
    expect(town.beasts.includes(foe)).toBe(false);
    expect(bolt).toBe(true);
    expect(town.folk.map((p) => p.experience + p.level * 1000)).toEqual(xp);
    expect(town.folk.every((p) => p.kills === 0)).toBe(true);
  });
  it('hunts one at a time, only round the settlement and never beyond a gate', () => {
    const town = arrived(settlement());
    while (town.climate().night < 0.9) run(town, 5);
    const far = new Monster(town.nextMonster++, 0, point(20 + thorRules.huntReach + 6, 20));
    far.home = { ...far.position };
    far.health = 13;
    // A raised world beyond a gate, with a monster at its edge right beside the settlement.
    town.realmGate = 0;
    town.realmArea = { x: 30, y: 10, size: 20 };
    const beyond = new Monster(town.nextMonster++, 0, point(31, 21));
    beyond.home = point(35, 20);
    beyond.health = 13;
    town.beasts.push(far, beyond);
    const targets = new Set<number>();
    run(town, 40, () => {
      if (town.thor.target >= 0) targets.add(town.thor.target);
      expect(inArea(town.realmArea, town.thor.position)).toBe(false);
      expect(distance(town.thor.position, point(20, 20))).toBeLessThan(thorRules.huntReach + 3);
    });
    expect(targets.has(far.id)).toBe(false);
    expect(targets.has(beyond.id)).toBe(false);
    expect(far.health).toBe(13);
    expect(beyond.health).toBe(13);
  });
  it('is no resident: he takes no orders, has no health to lose and no monster goes for him', () => {
    const town = arrived(settlement());
    expect(town.people().some((p) => p.name === 'Thor')).toBe(false);
    expect('health' in town.thor).toBe(false);
    while (town.climate().night < 0.9) run(town, 5);
    // A monster right beside him bites only residents.
    const foe = new Monster(town.nextMonster++, 0, add(town.thor.position, point(0.5, 0)));
    foe.home = { ...foe.position };
    foe.health = 1e6;
    foe.raider = true;
    town.beasts.push(foe);
    // An order to every resident moves residents only.
    town.orderMove(town.folk.map((p) => p.id), point(10, 10));
    run(town, 10);
    for (const hit of town.hits()) if (hit.onPerson) expect(town.person(hit.person)).not.toBeNull();
    expect(town.thor.present).toBe(true);
    expect(distance(town.thor.position, point(10, 10))).toBeGreaterThan(4);
  });
  it('makes lightning strike far more often in rain while he is here, and only then', () => {
    const town = arrived(settlement());
    expect(thunderFactor(town)).toBe(thorRules.thunder);
    const strikes = (weather: Weather, factor: number) => {
      const storm = new Thunderstorm(11);
      let n = 0;
      for (let t = 0; t < 3600; t += 0.1) if (storm.update(t, weather, 0.6, factor)) ++n;
      return n;
    };
    expect(strikes(Weather.Rain, 3)).toBeGreaterThan(strikes(Weather.Rain, 1) * 2.2);
    expect(strikes(Weather.Storm, 3)).toBeGreaterThan(strikes(Weather.Storm, 1) * 2);
    expect(strikes(Weather.Clear, 3)).toBe(0);
    expect(strikes(Weather.Cloudy, 3)).toBe(0);
    run(town, day * 9);
    expect(town.thor.present).toBe(false);
    expect(thunderFactor(town)).toBe(1);
  });
  it('turns rain to storm more readily but brings no more rain', () => {
    const spells = (chance: number) => {
      const sky = new Sky(21);
      sky.stormChance = chance;
      let wet = 0,
        storms = 0,
        last = -1;
      for (let s = 0; s < day * 240; s += 10) {
        sky.advance(10, day, 0.6, (s % day) / day);
        const w = sky.now().weather,
          peak = sky.snapshot().peak;
        if (peak !== last && (w === Weather.Rain || w === Weather.Storm)) {
          ++wet;
          if (w === Weather.Storm) ++storms;
        }
        last = peak;
      }
      return { wet, storms };
    };
    const plain = spells(-1),
      thor = spells(thorRules.storm);
    // Autumn: no storms at all without him.
    expect(plain.storms).toBe(0);
    expect(thor.storms / thor.wet).toBeGreaterThan(0.45);
    expect(Math.abs(thor.wet - plain.wet)).toBeLessThanOrEqual(Math.max(3, plain.wet * 0.25));
  });
  it('keeps his visit across a save, at a new version only once he has been called', () => {
    const version = (save: string) => Number.parseInt(save.slice(17, 19), 16),
      load = (save: string) => decodeTown(save, (map) => new Town(map, 64, false, true));
    const quiet = settlement(4, false);
    expect(version(encodeTown(quiet))).toBeLessThan(18);
    expect(load(encodeTown(quiet)).thor).toMatchObject({ present: false, nextVisit: -1, visits: 0 });
    const town = arrived(settlement());
    run(town, 30);
    const save = encodeTown(town);
    expect(version(save)).toBe(18);
    const back = load(save);
    expect(back.thor).toMatchObject({
      present: true,
      arrivedDay: town.thor.arrivedDay,
      nextVisit: town.thor.nextVisit,
      visits: 1,
      position: town.thor.position,
    });
    // After a load he simply takes up a pastime again, and goes home on the same day.
    run(back, 5);
    expect(back.thor.present).toBe(true);
    run(back, day * (thorRules.stay + 1));
    expect(back.thor.present).toBe(false);
    // Between visits the save remembers when he is due.
    const between = load(encodeTown(back));
    expect(between.thor).toMatchObject({ present: false, visits: 1, nextVisit: back.thor.nextVisit });
  });
});

let tvg: ThorVGNamespace;
let map: WorldMap;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class {});
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({ renderer: 'sw', locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}` });
  map = WorldMap.generate(5, 96, 96);
}, 60000);
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});
/** A stand-in for the town the serpent reads: the map, the weather and the clock. */
function sea(weather: Weather, intensity: number, peak: number, clock = 100) {
  return {
    map: () => map,
    realmArea: null,
    climate: () => ({ weather, intensity, night: 0 }),
    weather: () => ({ snapshot: () => ({ peak }) }),
    clock: () => clock,
  };
}
const stormPeak = () => {
  for (let k = 0; k < 400; ++k) {
    const peak = 0.8 + k * 0.0005;
    if (serpentEmergence(map.seed(), Weather.Storm, 0.9, weatherSpell(peak)) > 0.5) return peak;
  }
  throw new Error('no storm brings the serpent up');
};

describe('Jormungandr in the sea', () => {
  it('shows only in rain and storms: often in storms, now and then in rain, never in clear, cloudy or snowy skies', () => {
    const seed = map.seed(),
      share = (weather: Weather) => {
        let up = 0;
        for (let spell = 0; spell < 400; ++spell) if (serpentEmergence(seed, weather, 0.8, spell) > 0) ++up;
        return up / 400;
      };
    for (const weather of [Weather.Clear, Weather.Cloudy, Weather.Snow]) expect(share(weather)).toBe(0);
    expect(share(Weather.Storm)).toBeGreaterThan(0.75);
    expect(share(Weather.Rain)).toBeGreaterThan(0.2);
    expect(share(Weather.Rain)).toBeLessThan(0.5);
    // A light drizzle does not bring it up even in a spell that would.
    const spell = weatherSpell(stormPeak());
    expect(serpentEmergence(seed, Weather.Storm, 0.1, spell)).toBe(0);
  });
  it('lies on one loop round the land, clear of land, beaches, the map edge and the gate square', () => {
    const realm = findRealmArea(map),
      ring = serpentRing(map, realm)!;
    expect(ring).not.toBeNull();
    const n = ring.points.length;
    // Closed: consecutive points a tile apart all the way round.
    for (let i = 0; i < n; ++i) expect(distance(ring.points[i], ring.points[(i + 1) % n])).toBeLessThan(1.6);
    const land: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height(); ++y)
      for (let x = 0; x < map.width(); ++x) if (map.at(x, y).terrain !== Terrain.Sea && !inArea(realm, point(x + 0.5, y + 0.5))) land.push({ x: x + 0.5, y: y + 0.5 });
    const parts = serpentParts(ring, map.seed(), 3);
    expect(parts.filter((p) => p.kind === SerpentPartKind.Head)).toHaveLength(1);
    expect(parts.filter((p) => p.kind === SerpentPartKind.Coil).length).toBeGreaterThan(4);
    for (const part of parts)
      for (let i = part.from; i <= part.to; ++i) {
        const p = ring.points[((i % n) + n) % n];
        expect(Math.min(...land.map((l) => distance(l, p)))).toBeGreaterThan(serpentRules.clearance - 1.5);
        expect(p.x).toBeGreaterThan(serpentRules.edge - 0.5);
        expect(p.y).toBeLessThan(map.height() - serpentRules.edge + 0.5);
        if (realm) expect(inArea({ x: realm.x - 3, y: realm.y - 3, size: realm.size + 6 }, p)).toBe(false);
        // What rises above it on screen is open sea too: the tiles behind it, up to its height.
        for (let k = 1; k <= 3; ++k) expect(map.at(Math.floor(p.x) - k, Math.floor(p.y) - k).terrain).toBe(Terrain.Sea);
      }
    // The parts go all the way round the land's middle.
    const middle = land.reduce((a, b) => ({ x: a.x + b.x / land.length, y: a.y + b.y / land.length }), { x: 0, y: 0 }),
      sides = new Set(parts.map((p) => Math.floor(((Math.atan2(partMiddle(p, ring).y - middle.y, partMiddle(p, ring).x - middle.x) + Math.PI) / (2 * Math.PI)) * 4) % 4));
    // This small map's land runs to the edge on one side; the full-size map has sea all round.
    expect(sides.size).toBeGreaterThanOrEqual(3);
  });
  it('swells along the loop: parts rise and sink in turn while it is up', () => {
    const ring = serpentRing(map)!,
      parts = serpentParts(ring, map.seed(), 3),
      coils = parts.filter((p) => p.kind === SerpentPartKind.Coil);
    const upAt = (clock: number) => coils.map((p) => partRise(p, ring, 1, clock) > 0.5);
    const now = upAt(0),
      later = upAt(12);
    expect(now.some(Boolean)).toBe(true);
    expect(now.some((v) => !v)).toBe(true);
    expect(later).not.toEqual(now);
    for (const p of parts) expect(partRise(p, ring, 0, 5)).toBe(0);
  });
  it('builds and moves nothing in clear weather or when no part is on screen, and is never a pick target', () => {
    const s = new WorldRendererState(tvg);
    s.viewWidth = 1280;
    s.viewHeight = 800;
    const look = (at: { x: number; y: number }, zoom: number) => {
      const c = project(at.x, at.y);
      s.view = new Camera(c.x, c.y, zoom);
    };
    const shapes = (node: PaintNode): number => (node instanceof SceneNode ? node.children.reduce((n, c) => n + shapes(c), 0) : 1);
    const clear = sea(Weather.Clear, 0, 0) as unknown as Town;
    look(point(48, 48), 1);
    for (let t = 0; t < 20; ++t) updateSerpent(s, clear, t, 1);
    expect(s.serpent.children).toHaveLength(0);
    // A storm, but the camera off over empty sea: the parts exist as empty holders only.
    const peak = stormPeak();
    let clock = 100;
    const storm = () => sea(Weather.Storm, 0.9, peak, clock) as unknown as Town;
    look(point(-60, -60), 1);
    for (let t = 0; t < 120; ++t) {
      clock += 0.5;
      updateSerpent(s, storm(), 20 + t * 0.5, 1);
    }
    expect(s.serpent.children.length).toBeGreaterThan(4);
    expect(shapes(s.serpent)).toBe(0);
    // Over a part that is up: its shapes are built, and none of them can be picked.
    const ring = serpentRing(map)!,
      part = serpentParts(ring, map.seed(), weatherSpell(peak)).find((p) => partRise(p, ring, 1, clock) > 0.8)!;
    look(partMiddle(part, ring), 1);
    updateSerpent(s, storm(), 90, 1);
    expect(shapes(s.serpent)).toBeGreaterThan(3);
    const walk = (node: PaintNode): void => {
      expect(pickSource(node)).toBeUndefined();
      if (node instanceof SceneNode) node.children.forEach(walk);
    };
    walk(s.serpent);
    // Sighted only over sea the player knows.
    expect(serpentSights(s, { map: () => ({ revealed: () => false }) } as unknown as Town)).toEqual([]);
    // Clear skies again: it sinks and the layer goes still.
    for (let t = 0; t < 80; ++t) {
      clock += 0.5;
      updateSerpent(s, sea(Weather.Clear, 0, 0, clock) as unknown as Town, 100 + t * 0.5, 1);
    }
    expect(s.serpent.alpha).toBe(0);
  });
  it('is pointed out to the player only when a part is up where they look', () => {
    const peak = stormPeak(),
      ring = serpentRing(map)!,
      part = serpentParts(ring, map.seed(), weatherSpell(peak)).find((p) => partRise(p, ring, 1, 100) > 0.8)!,
      at = partMiddle(part, ring);
    map.reveal(map.width() / 2, map.height() / 2, map.width() * 2);
    const seen = (p: { x: number; y: number }) => distance(p, at) < 3;
    expect(serpentSighting(sea(Weather.Storm, 0.9, peak), seen)).not.toBeNull();
    expect(serpentSighting(sea(Weather.Clear, 0, 0), seen)).toBeNull();
    expect(serpentSighting(sea(Weather.Storm, 0.9, peak), () => false)).toBeNull();
  });
});

describe('the gods in Korean', () => {
  it('has Korean for every notice, name and line, in syllables the font carries', () => {
    setLocale('KR');
    try {
      for (const text of ['Thor', 'Jormungandr', 'Thor has come to Midgard', 'Thor leaves Midgard', landmarkDescription(3)]) {
        expect(hasHangul(translate(text)), text).toBe(true);
        expect(translate(text).match(/[A-Za-z]{2,}/g) ?? [], text).toEqual([]);
      }
    } finally {
      setLocale('ENG');
    }
    const decoder = new TextDecoder('euc-kr'),
      carried = new Set<string>();
    for (let lead = 0xb0; lead < 0xc9; ++lead)
      for (let trail = 0xa1; trail < 0xff; ++trail) carried.add(decoder.decode(new Uint8Array([lead, trail])));
    const used = [...Object.values(godsPhrases).join('')].filter((c) => /[\uac00-\ud7a3]/.test(c));
    expect(used.filter((c) => !carried.has(c))).toEqual([]);
  });
});
