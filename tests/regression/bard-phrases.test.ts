import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import manifest from '../../packages/native-audio/src/data/audio-manifest.json';
import sources from '../../packages/native-audio/src/data/audio-sources.json';
import { Activity, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Camera, point, project, type Point } from '../../packages/engine/src/geometry';
import {
  advanceBards,
  bardPhraseSeconds,
  bardRules,
  mayPlay,
  playing,
  type BardTown,
} from '../../packages/engine/src/bard-phrases';
import { auraReach } from '../../packages/engine/src/calling-auras';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Cue, Sound } from '../../packages/native-audio/src/sound-types';
import { cueClips, initialEffectPrefixes } from '../../packages/native-audio/src/sound-catalog';
import { EffectManager } from '../../packages/native-audio/src/effect-manager';
import { SoundBoard } from '../../packages/native-audio/src/sound-board';
import { SoundLibrary } from '../../packages/native-audio/src/sound-library';
import { bardLyre, lyreRules, type LyreApp } from '../../apps/web/src/native/bard-lyre';
import { spatial } from '../../apps/web/src/native/game-ambience';

afterEach(() => vi.restoreAllMocks());

function bard(id: number, at: Point, calling = Calling.Bard): Person {
  return new Person(id, `Bard ${id}`, Role.Resident, calling, Race.Human, 0, at);
}
interface FakeTown extends BardTown {
  night: number;
  beasts: Monster[];
  raid: boolean;
  realm: boolean;
  fire: Building;
}
function fakeTown(folk: Person[]): FakeTown {
  const fire = new Building(0, Structure.Camp, point(10, 10), 0, 0);
  fire.progress = 1;
  const town: FakeTown = {
    time: 0,
    folk,
    night: 0,
    beasts: [],
    raid: false,
    realm: false,
    fire,
    map: () => ({ seed: () => 5 }),
    climate: () => ({ night: town.night }),
    monsters: () => town.beasts,
    inRealm: () => town.realm,
    settlementOf: () => 0,
    camp: () => town.fire,
    raiding: () => town.raid,
  };
  return town;
}
/** Runs the bards for `seconds` at 10 ticks a second and lists every phrase as [id, phrase, at, until]. */
function run(town: FakeTown, seconds: number, each?: () => void): [number, number, number, number][] {
  const heard: [number, number, number, number][] = [];
  for (let i = 0; i < seconds * 10; ++i) {
    town.time = Math.round(town.time * 10 + 1) / 10;
    each?.();
    advanceBards(town);
    for (const p of town.folk)
      if (playing(p, town.time) && !heard.some(([id, , at]) => id === p.id && at === p.phraseAt))
        heard.push([p.id, p.phrase, p.phraseAt, p.playingUntil]);
  }
  return heard;
}

describe('when a bard plays', () => {
  it('plays while idle, walking or resting outdoors, with long pauses and no overlap', () => {
    for (const activity of [Activity.Idle, Activity.Moving, Activity.Relaxing, Activity.Arriving]) {
      const p = bard(1, point(10, 10)),
        town = fakeTown([p]);
      p.activity = activity;
      const heard = run(town, 1200);
      expect(heard.length, Activity[activity]).toBeGreaterThanOrEqual(8);
      expect(heard[0][2]).toBeLessThanOrEqual(bardRules.firstWait[1] + 1);
      for (let i = 0; i < heard.length; ++i) {
        const [, phrase, at, until] = heard[i];
        expect(until - at).toBeCloseTo(bardPhraseSeconds[phrase], 5);
        if (!i) continue;
        const [, before, , end] = heard[i - 1];
        expect(phrase).not.toBe(before);
        expect(at - end).toBeGreaterThanOrEqual(bardRules.pause[0] - 0.1);
        expect(at - end).toBeLessThanOrEqual(bardRules.pause[1] + 0.2);
      }
      // A small bank, well used.
      expect(new Set(heard.map(([, phrase]) => phrase)).size).toBeGreaterThanOrEqual(6);
    }
  });

  it('never plays asleep, at work, fighting, downed, indoors, in a raid, beyond a gate or with monsters near', () => {
    const cases: [string, (p: Person, town: FakeTown) => void][] = [
      ...[
        Activity.Sleeping,
        Activity.Working,
        Activity.Building,
        Activity.Felling,
        Activity.Mining,
        Activity.Hauling,
        Activity.Crafting,
        Activity.Eating,
        Activity.Fighting,
        Activity.Guarding,
        Activity.Praying,
        Activity.Downed,
        Activity.Tending,
        Activity.Expedition,
      ].map((a): [string, (p: Person) => void] => [Activity[a], (p) => (p.activity = a)]),
      ['downed', (p) => (p.downedAt = 0)],
      ['dead', (p) => (p.health = 0)],
      ['indoors', (p) => (p.inside = true)],
      ['holding a line', (p) => (p.holding = true)],
      ['attack-moving', (p) => ((p.activity = Activity.Moving), (p.aggressive = true))],
      ['raid', (_, town) => (town.raid = true)],
      ['beyond a gate', (_, town) => (town.realm = true)],
      [
        'monster near',
        (p, town) => town.beasts.push(new Monster(9, -1, point(p.position.x + 4, p.position.y))),
      ],
    ];
    for (const [name, set] of cases) {
      const p = bard(1, point(10, 10)),
        town = fakeTown([p]);
      set(p, town);
      expect(mayPlay(town, p), name).toBe(false);
      expect(run(town, 600), name).toEqual([]);
    }
    // A monster far off, or a beast of the field, does not stop the tune.
    const p = bard(1, point(10, 10)),
      town = fakeTown([p]);
    town.beasts.push(new Monster(9, -1, point(40, 10)));
    expect(mayPlay(town, p)).toBe(true);
    // Only bards play.
    const warrior = bard(2, point(10, 10), Calling.Warrior);
    expect(run(fakeTown([warrior]), 300)).toEqual([]);
  });

  it('stops a phrase when the bard is called away, and pauses with the game', () => {
    const p = bard(1, point(10, 10)),
      town = fakeTown([p]);
    while (!playing(p, town.time)) run(town, 0.1);
    p.activity = Activity.Fighting;
    run(town, 0.1);
    expect(playing(p, town.time)).toBe(false);
    // A paused game does not tick, so nothing begins: the clock alone decides.
    p.activity = Activity.Idle;
    const before = p.phraseAt;
    advanceBards(town);
    advanceBards(town);
    expect(p.phraseAt).toBe(before);
  });

  it('lets two nearby bards take turns, and two far apart play freely', () => {
    const near = [bard(1, point(10, 10)), bard(2, point(13, 10)), bard(3, point(10, 14))],
      heard = run(fakeTown(near), 3000);
    expect(new Set(heard.map(([id]) => id)).size).toBe(3);
    const sorted = [...heard].sort((a, b) => a[2] - b[2]);
    for (let i = 1; i < sorted.length; ++i) {
      expect(sorted[i][2], 'a nearby phrase begins only after the last has ended').toBeGreaterThanOrEqual(
        sorted[i - 1][3] + bardRules.afterOther - 0.1,
      );
      expect(sorted[i][1], 'and is not the one just heard').not.toBe(sorted[i - 1][1]);
    }
    const far = run(fakeTown([bard(1, point(10, 10)), bard(2, point(60, 10))]), 3000);
    expect(far.filter(([id]) => id === 1).length).toBeGreaterThanOrEqual(20);
    expect(far.filter(([id]) => id === 2).length).toBeGreaterThanOrEqual(20);
  });

  it('is deterministic from the seed and the clock, without Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const once = () => run(fakeTown([bard(1, point(10, 10)), bard(4, point(12, 10))]), 1500);
    const a = once();
    expect(once()).toEqual(a);
    expect(random).not.toHaveBeenCalled();
  });

  it('leaves the pose to the renderer: playing never borrows a skill cast', () => {
    const p = bard(1, point(10, 10)),
      town = fakeTown([p]);
    while (!playing(p, town.time)) run(town, 0.1);
    expect(p.cast).toBe('');
    expect(p.phraseAt).toBeLessThanOrEqual(town.time);
    expect(p.playingUntil).toBeGreaterThan(town.time);
  });

  it('eases the stress of residents near the fire in the evening only', () => {
    for (const [night, at, eased] of [
      [0.6, point(11, 10), true],
      [0.1, point(11, 10), false],
      [0.6, point(30, 10), false],
    ] as const) {
      const p = bard(1, at),
        listener = new Person(
          2,
          'Embla',
          Role.Resident,
          Calling.Settler,
          Race.Human,
          0,
          point(at.x + 1, at.y),
        ),
        stranger = new Person(
          3,
          'Far',
          Role.Resident,
          Calling.Settler,
          Race.Human,
          0,
          point(at.x + auraReach + 2, at.y),
        ),
        town = fakeTown([p, listener, stranger]);
      listener.activity = stranger.activity = Activity.Working;
      town.night = night;
      listener.stress = stranger.stress = 0.5;
      while (!playing(p, town.time)) run(town, 0.1);
      expect(listener.stress).toBeCloseTo(eased ? 0.5 - bardRules.calm : 0.5, 5);
      expect(stranger.stress).toBe(0.5);
    }
  });
});

describe('a bard in a real settlement', () => {
  it('plays from the town tick', () => {
    const map = new WorldMap();
    map.columns = map.rows = 40;
    map.mapSeed = 5;
    map.origin = { x: 12, y: 12 };
    map.tiles = Array.from({ length: 40 * 40 }, () => ({
      ...makeTile(),
      terrain: Terrain.Grass,
      revealed: true,
    }));
    map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(81 * 81).fill(0.4));
    map.layer(Layer.Land).fill(1);
    map.layer(Layer.Ridge).fill(-1);
    const town = new Town(map, 40, false);
    town.placed.push(new Building(0, Structure.Camp, point(12, 12), 0, 0));
    town.nextId = 1;
    town.migrateSettlements();
    town.folk = [];
    town.nextPerson = 0;
    const p = bard(town.nextPerson++, point(14, 12));
    p.home = p.village = 0;
    town.folk.push(p);
    let phrases = 0,
      last = -1;
    for (let i = 0; i < 3000; ++i) {
      town.advance(0.1);
      if (playing(p, town.clock()) && p.phraseAt !== last) {
        last = p.phraseAt;
        ++phrases;
      }
    }
    expect(phrases).toBeGreaterThanOrEqual(2);
  });
});

describe('what a bard sounds like', () => {
  it('ships a lyre phrase for every length the simulation knows, lazily loaded', () => {
    expect(cueClips[Cue.Lyre]).toEqual(['sfx/bard/lyre_']);
    const rows = manifest.filter((row) => row.name.startsWith('sfx/bard/lyre_'));
    expect(rows.map((row) => row.name)).toEqual(
      bardPhraseSeconds.map((_, i) => `sfx/bard/lyre_${String(i + 1).padStart(2, '0')}`),
    );
    for (const [i, row] of rows.entries()) {
      expect(row.rate).toBe(22050);
      expect(row.channels).toBe(1);
      expect(row.frames / row.rate).toBeGreaterThanOrEqual(2);
      expect(row.frames / row.rate).toBeLessThanOrEqual(5);
      expect(Math.abs(row.frames / row.rate - bardPhraseSeconds[i])).toBeLessThan(0.02);
      expect(sources.sources.some((s) => s.path === row.name + '.ogg')).toBe(true);
      expect(existsSync(new URL(`../../public/assets/audio/${row.name}.ogg`, import.meta.url))).toBe(true);
    }
    // Not among the clips the opening waits for; loaded later with the other effects.
    expect(initialEffectPrefixes.some((prefix) => prefix.startsWith('sfx/bard'))).toBe(false);
    expect(readFileSync(new URL('../../public/assets/audio/NOTICE.md', import.meta.url), 'utf8')).toContain(
      'sfx/bard/',
    );
  });

  it('cues each phrase once, near the bard on screen, at a spatial level under the effects', () => {
    const p = bard(1, point(10, 10)),
      town = fakeTown([p]);
    let visible = true,
      speed = 1,
      talking = false;
    const app: LyreApp = {
      town: { ...town, people: () => town.folk, clock: () => town.time } as unknown as Town,
      cues: [],
      last: 0,
      speakers: new Map([[7, { speech: { playing: () => talking } }]]),
      renderer: { visible: () => visible },
      spatial: (cue, at) => new Sound(cue, 0.8 * Math.exp(-Math.hypot(at.x - 10, at.y - 10) / 14)),
      gameSpeed: () => speed,
    };
    const next = (setup: () => void) => {
      app.cues = [];
      setup();
      while (!playing(p, town.time)) {
        run(town, 0.1);
        bardLyre(app, false);
      }
      bardLyre(app, false);
      bardLyre(app, false);
      return app.cues;
    };
    let cues = next(() => {});
    expect(cues.length).toBe(1);
    expect(cues[0].cue).toBe(Cue.Lyre);
    expect(cues[0].take).toBe(p.phrase);
    expect(cues[0].gain).toBeCloseTo(0.8 * lyreRules.gain, 5);
    cues = next(() => (visible = false));
    expect(cues, 'off screen').toEqual([]);
    cues = next(() => ((visible = true), (speed = 0)));
    expect(cues, 'paused').toEqual([]);
    cues = next(() => ((speed = 1), (talking = true)));
    expect(cues, 'a voice speaking').toEqual([]);
    talking = false;
    app.cues = [];
    while (!playing(p, town.time)) {
      run(town, 0.1);
      bardLyre(app, true);
    }
    expect(app.cues, 'a world loop playing').toEqual([]);
    // Joined late, a phrase is not started halfway.
    while (playing(p, town.time)) run(town, 0.1);
    while (!playing(p, town.time)) run(town, 0.1);
    run(town, 1);
    app.cues = [];
    bardLyre(app, false);
    expect(app.cues).toEqual([]);
  });

  it('is quieter with distance and zoomed out, and silent off screen', () => {
    const app = {
      camera: new Camera(0, 0, 1),
      viewWidth: 1280,
      viewHeight: 800,
      toScreen(world: Point) {
        const at = project(world.x, world.y);
        return this.camera.toScreen(at, this.viewWidth, this.viewHeight);
      },
    };
    const at = (x: number, y: number, zoom = 1) => {
      const centre = project(10, 10);
      app.camera = new Camera(centre.x, centre.y, zoom);
      return spatial.call(app as never, Cue.Lyre, point(x, y)).gain;
    };
    expect(at(10, 10)).toBeGreaterThan(at(13, 13));
    expect(at(10, 10, 0.5)).toBeLessThan(at(10, 10, 1));
    expect(at(80, 80)).toBe(0);
  });

  it('sounds one lyre at a time, yields to every other effect and plays the phrase it is given', () => {
    const effects = new EffectManager(() => 0),
      first = effects.request(new Sound(Cue.Lyre, 0.3));
    expect(first).toBeTruthy();
    effects.advance(1);
    expect(effects.request(new Sound(Cue.Lyre, 0.3)), 'a second bard waits').toBe(0n);
    for (const cue of [
      Cue.Coins,
      Cue.Place,
      Cue.Demolish,
      Cue.TreeFall,
      Cue.Howl,
      Cue.ThunderClap,
      Cue.Hammer,
    ])
      expect(effects.request(new Sound(cue, 0.5))).toBeTruthy();
    expect(effects.active(first)).toBe(true);
    // With every slot taken, an ordinary effect takes the lyre's.
    expect(effects.request(new Sound(Cue.Chop, 0.5))).toBeTruthy();
    expect(effects.active(first)).toBe(false);

    const library = new SoundLibrary();
    library.setClip('sfx/bard/lyre_03', new Int16Array(22050).fill(8000), 22050);
    library.setClip('sfx/bard/lyre_04', new Int16Array(22050).fill(-8000), 22050);
    const board = new SoundBoard(library),
      out = new Float32Array(2 * 4410);
    const sound = new Sound(Cue.Lyre, 0.4);
    sound.take = 2;
    board.play(sound);
    board.render(out, 4410);
    const level = out.slice(2000, 8000).reduce((sum, v) => sum + v, 0) / 6000;
    expect(level, 'the third phrase, as named').toBeGreaterThan(0.02);
    const silent = new SoundBoard(library);
    silent.play(new Sound(Cue.Lyre, 0));
    out.fill(0);
    silent.render(out, 4410);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(0.02);
  });
});
