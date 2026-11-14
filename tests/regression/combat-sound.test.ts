import { describe, expect, it, vi } from 'vitest';
import manifest from '../../packages/native-audio/src/data/audio-manifest.json';
import { Monster, Person, Role, Calling, Race, type Hit } from '../../packages/engine/src/person';
import {
  CombatCue,
  MonsterRank,
  type AbilityId,
  type CombatEvent,
} from '../../packages/engine/src/combat-events';
import { StrikeKind, skills } from '../../packages/engine/src/skill-catalog';
import type { Point } from '../../packages/engine/src/geometry';
import type { Town } from '../../packages/engine/src/town';
import { Ambience, Cue, Sound, VoiceLine } from '../../packages/native-audio/src/sound-types';
import { EffectManager } from '../../packages/native-audio/src/effect-manager';
import { cueClips, swarmBedPrefix } from '../../packages/native-audio/src/sound-catalog';
import { SoundBoard } from '../../packages/native-audio/src/sound-board';
import { SoundLibrary } from '../../packages/native-audio/src/sound-library';
import {
  CombatSoundState,
  combatSounds,
  combatSoundRules,
  type CombatSoundApp,
} from '../../apps/web/src/native/game-combat-sound';

/** Points with x beyond this are off screen and out of earshot. */
const edge = 100;
function fakeApp() {
  const hits: Hit[] = [],
    monsters: Monster[] = [],
    town = {
      hits: () => hits,
      monsters: () => monsters,
      person: () => null,
      fallen: [],
    } as unknown as Town,
    app: CombatSoundApp & { said: [number, VoiceLine][] } = {
      town,
      cues: [],
      chosen: [],
      camera: { zoom: 1 },
      renderer: { visible: (at: Point) => at.x <= edge },
      combatHud: { sound: new CombatSoundState() },
      spatial: (cue: Cue, at: Point) => new Sound(cue, at.x <= edge ? 0.45 : 0, at.x > edge ? 1 : 0),
      sayLine: vi.fn((id: number, line: VoiceLine) => (app.said.push([id, line]), true)),
      said: [],
    };
  let serial = 0n,
    eventSerial = 0n;
  const hit = (fields: Partial<Hit> = {}): Hit => {
    const h: Hit = {
      serial: serial++,
      from: { x: 1, y: 1 },
      to: { x: 2, y: 2 },
      damage: 10,
      onPerson: false,
      ranged: false,
      at: 0,
      person: 1,
      attacker: 1,
      ...fields,
    };
    hits.push(h);
    return h;
  };
  const event = (cue: CombatCue, fields: Partial<CombatEvent> = {}): CombatEvent => ({
    serial: eventSerial++,
    cue,
    at: 0,
    position: { x: 3, y: 3 },
    person: -1,
    creature: -1,
    amount: 0,
    radius: 0,
    duration: 0,
    text: '',
    skill: '',
    ...fields,
  });
  const monster = (id: number, rank: MonsterRank, at: Point = { x: 4, y: 4 }) => {
    const m = new Monster(id, 0, { ...at });
    m.rank = rank;
    monsters.push(m);
    return m;
  };
  /** One frame: the cues it queued. */
  const frame = (events: CombatEvent[] = [], now = 0): Sound[] => {
    app.cues = [];
    combatSounds(app, events, now);
    return app.cues;
  };
  frame();
  return { app, hits, monsters, hit, event, monster, frame };
}
const cuesOf = (sounds: Sound[]) => sounds.map((s) => s.cue);

describe('combat sound: blows by weapon shape', () => {
  it('maps each strike to its own cue and keeps the existing single-target cues', () => {
    const { hit, frame } = fakeApp();
    hit({ strike: StrikeKind.Cleave });
    hit({ strike: StrikeKind.Crush });
    hit({ strike: StrikeKind.Pierce, ranged: true });
    hit({ strike: StrikeKind.Splash, ranged: true });
    expect(cuesOf(frame()).sort()).toEqual([Cue.Cleave, Cue.Crush, Cue.Pierce, Cue.Splash].sort());
    hit({ strike: StrikeKind.Single });
    hit({ ranged: true });
    hit({ onPerson: true, strike: StrikeKind.Cleave });
    expect(cuesOf(frame()).sort()).toEqual([Cue.Clash, Cue.Arrow, Cue.Bite].sort());
  });
  it('hears a cleave once, not once per enemy it caught, and nothing off screen', () => {
    const { hit, frame } = fakeApp();
    hit({ strike: StrikeKind.Cleave, primary: true });
    hit({ strike: StrikeKind.Cleave, primary: false });
    hit({ strike: StrikeKind.Cleave, primary: false });
    hit({ strike: StrikeKind.Crush, to: { x: edge + 5, y: 0 } });
    expect(cuesOf(frame())).toEqual([Cue.Cleave]);
  });
  it('caps blows per frame and keeps the chosen fighter and crits over the crowd', () => {
    const { app, hit, frame } = fakeApp();
    app.chosen = [7];
    for (let i = 0; i < 30; ++i) hit({ onPerson: true, person: 2, attacker: 100 + i, damage: 50 });
    hit({ strike: StrikeKind.Crush, person: 7, attacker: 7, damage: 1 });
    hit({ strike: StrikeKind.Splash, person: 3, attacker: 3, damage: 1, crit: true });
    const heard = frame();
    expect(heard).toHaveLength(combatSoundRules.blowsPerFrame);
    expect(cuesOf(heard).slice(0, 2)).toEqual([Cue.Crush, Cue.Splash]);
    // Blows are heard once.
    expect(frame()).toEqual([]);
  });
});

describe('combat sound: skills', () => {
  it('gives every skill a distinct cue and keeps the shout for Challenge and the verse', () => {
    const { app, event, frame } = fakeApp();
    const heard = new Set<Cue>();
    skills.forEach((spec, i) => {
      const cues = frame([event(CombatCue.Ability, { skill: spec.id, text: spec.name, person: 4 })], i);
      expect(cues).toHaveLength(1);
      heard.add(cues[0].cue);
    });
    expect(heard.size).toBe(skills.length);
    expect(app.said.filter(([, line]) => line === VoiceLine.Attack)).toHaveLength(2);
  });
  it('reads a skill from its name when the event has no id, and lets late skills land late', () => {
    const { event, frame } = fakeApp();
    const [burst] = frame([event(CombatCue.Ability, { text: 'Rune Burst', skill: '' })]);
    expect(burst.cue).toBe(Cue.RuneBurst);
    expect(burst.delay).toBeGreaterThan(0);
    const [volley] = frame([event(CombatCue.Ability, { skill: 'volley' satisfies AbilityId })], 1);
    expect(volley.delay).toBe(0);
  });
});

describe('combat sound: swarms, dens and the brood', () => {
  it('thins ten swarm deaths in one second to a few, each quieter than the last', () => {
    const { monster, event, frame } = fakeApp();
    for (let i = 0; i < 40; ++i) monster(i, MonsterRank.Swarmer);
    frame();
    const all = frame(
      Array.from({ length: 10 }, (_, i) => event(CombatCue.Kill, { creature: i })),
      0,
    );
    expect(all.length).toBe(combatSoundRules.deathsPerFrame);
    let total = all.length;
    const gains = all.map((s) => s.gain);
    for (let k = 1; k < 10; ++k) {
      const cues = frame([event(CombatCue.Kill, { creature: 10 + k })], k * 0.09);
      total += cues.length;
      gains.push(...cues.map((s) => s.gain));
    }
    expect(total).toBe(combatSoundRules.deathsPerSecond);
    for (let i = 1; i < gains.length; ++i) expect(gains[i]).toBeLessThanOrEqual(gains[i - 1]);
    // A second later the rout is heard again.
    expect(frame([event(CombatCue.Kill, { creature: 30 })], 2.2)).toHaveLength(1);
  });
  it('tells a death by the rank seen before the body was cleared away; animals and dens make none', () => {
    const { monsters, monster, event, frame } = fakeApp();
    monster(1, MonsterRank.Brute);
    monster(2, MonsterRank.Den);
    frame();
    monsters.length = 0;
    const cues = frame([
      event(CombatCue.Kill, { creature: 1 }),
      event(CombatCue.Kill, { creature: 2 }),
      event(CombatCue.Kill, { creature: 99 }),
    ]);
    expect(cuesOf(cues)).toEqual([Cue.SwarmDeath]);
    expect(cues[0].pitch).toBeLessThan(1);
  });
  it('lets a den be heard spawning now and then, not every time', () => {
    const { event, frame } = fakeApp();
    let heard = 0;
    for (let t = 0; t < 4; t += 0.1)
      heard += frame(
        [event(CombatCue.Spawn, { amount: 5 }), event(CombatCue.Spawn, { amount: 6 })],
        t,
      ).length;
    // Two dens, each heard at most every denSpawnGap seconds.
    expect(heard).toBeGreaterThan(1);
    expect(heard).toBeLessThanOrEqual(2 * Math.ceil(4 / combatSoundRules.denSpawnGap));
  });
  it('sounds the den falling, the brood breaking and a raid wave, the last two even off screen', () => {
    const { event, frame } = fakeApp();
    expect(cuesOf(frame([event(CombatCue.DenDestroyed)]))).toEqual([Cue.DenFall]);
    const far = { x: edge + 50, y: 0 },
      cues = frame(
        [
          event(CombatCue.BroodBreak, { position: far, amount: 30 }),
          event(CombatCue.Wave, { position: far, amount: 20 }),
        ],
        1,
      );
    expect(cuesOf(cues)).toEqual([Cue.BroodBreak, Cue.WaveHorn]);
    expect(cues.every((s) => s.gain > 0.3 && s.pan === 1)).toBe(true);
    expect(frame([event(CombatCue.Wave, { position: far })], 2)).toEqual([]);
  });
  it('raises the pack bed with the monsters in earshot and leaves out dens and the dead', () => {
    const { app, monsters, monster, frame } = fakeApp();
    for (let i = 0; i < 3; ++i) monster(i, MonsterRank.Swarmer);
    frame();
    expect(app.combatHud.sound.swarm).toBe(0);
    for (let i = 3; i < 15; ++i) monster(i, MonsterRank.Swarmer);
    frame();
    const some = app.combatHud.sound.swarm;
    expect(some).toBeGreaterThan(0);
    for (let i = 15; i < 60; ++i) monster(i, MonsterRank.Swarmer);
    for (let i = 60; i < 70; ++i) monster(i, MonsterRank.Swarmer, { x: edge + 10, y: 0 });
    frame();
    expect(app.combatHud.sound.swarm).toBeGreaterThan(some);
    expect(app.combatHud.sound.swarm).toBeLessThanOrEqual(1);
    monsters.length = 0;
    for (let i = 0; i < 30; ++i) monster(i, MonsterRank.Den);
    for (let i = 30; i < 60; ++i) monster(i, MonsterRank.Swarmer).health = 0;
    frame();
    expect(app.combatHud.sound.swarm).toBe(0);
  });
});

describe('combat sound: residents cut through the crowd', () => {
  it('hears a resident going down even off screen', () => {
    const { app, event, frame } = fakeApp();
    const person = new Person(4, 'Askr', Role.Resident, Calling.Warrior, Race.Human, 13880, {
      x: edge + 30,
      y: 0,
    });
    person.health = 1;
    app.town.person = (() => person) as never;
    const cues = frame([event(CombatCue.Downed, { person: 4, position: { x: edge + 30, y: 0 } })]);
    const downed = cues.find((s) => s.cue === Cue.Downed);
    expect(downed?.gain).toBeGreaterThanOrEqual(0.3);
    expect(app.said).toContainEqual([4, VoiceLine.Hut]);
    // The voice lines of a fall are warmed ahead, not played.
    expect(cues.filter((s) => s.cue === Cue.PrepareSpeech)).toHaveLength(2);
  });
  it('keeps the crowd to four slots, yields a slot to a skill and lets a blow displace a death', () => {
    const effects = new EffectManager(() => 0);
    for (const cue of [Cue.SwarmDeath, Cue.Bite, Cue.SwarmDeath, Cue.Bite]) {
      expect(effects.request(new Sound(cue))).not.toBe(0n);
      effects.advance(0.06);
    }
    expect(effects.request(new Sound(Cue.Clash))).toBe(0n);
    expect(effects.request(new Sound(Cue.Spawn))).toBe(0n);
    expect(effects.request(new Sound(Cue.Mend))).not.toBe(0n);
    expect(effects.statistics().effects).toBe(5);
    expect(effects.request(new Sound(Cue.Cleave))).not.toBe(0n);
    expect(effects.statistics().effects).toBe(5);
    effects.advance(1);
    // A full mixer: a resident's fall and death knell still find room.
    for (const cue of [Cue.Challenge, Cue.Whirl, Cue.Rally]) effects.request(new Sound(cue));
    expect(effects.statistics().effects).toBe(8);
    expect(effects.request(new Sound(Cue.Downed))).not.toBe(0n);
    expect(effects.request(new Sound(Cue.Fall))).not.toBe(0n);
  });
  it('limits each crowd cue by its own interval', () => {
    const effects = new EffectManager(() => 0);
    expect(effects.request(new Sound(Cue.SwarmDeath))).not.toBe(0n);
    expect(effects.request(new Sound(Cue.SwarmDeath))).toBe(0n);
    effects.advance(0.1);
    expect(effects.request(new Sound(Cue.SwarmDeath))).not.toBe(0n);
  });
});

describe('combat sound assets', () => {
  const clips = (cue: Cue) =>
    manifest.filter((e) => cueClips[cue]!.some((prefix) => e.name.startsWith(prefix)));
  it('ships enough variations of every new cue, short, mono and at the one-shot rate', () => {
    const least: [Cue, number, number][] = [
      [Cue.Cleave, 3, 0.5],
      [Cue.Crush, 3, 0.5],
      [Cue.Pierce, 3, 0.5],
      [Cue.Splash, 3, 0.5],
      [Cue.SwarmDeath, 6, 0.3],
      [Cue.Spawn, 3, 0.7],
      [Cue.DenFall, 1, 2],
      [Cue.BroodBreak, 1, 3.5],
      [Cue.WaveHorn, 1, 2.5],
      ...[
        Cue.Challenge,
        Cue.Whirl,
        Cue.AimedShot,
        Cue.Volley,
        Cue.RuneBurst,
        Cue.FrostRing,
        Cue.Mend,
        Cue.Sanctuary,
        Cue.Rally,
        Cue.Dirge,
      ].map((cue): [Cue, number, number] => [cue, 2, 1.25]),
    ];
    for (const [cue, count, longest] of least) {
      const found = clips(cue);
      expect(found.length, Cue[cue]).toBeGreaterThanOrEqual(count);
      for (const e of found) {
        expect(e.channels).toBe(1);
        expect(e.rate).toBe(22050);
        expect(e.frames / e.rate, e.name).toBeLessThanOrEqual(longest);
      }
    }
    const bed = manifest.filter((e) => e.name.startsWith(swarmBedPrefix));
    expect(bed).toHaveLength(1);
  });
  it('plays the pack bed round and round at the ambience level, silent at zero', () => {
    const library = new SoundLibrary(),
      pcm = new Int16Array(22050).map((_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 200 * i) / 22050)));
    library.setClip('sfx/combat/swarm_bed_01', pcm, 22050);
    const render = (level: number) => {
      const board = new SoundBoard(library),
        mix = new Ambience();
      mix.swarm = level;
      board.setAmbience(mix);
      const out = new Float32Array(44100 * 3 * 2);
      for (let first = 0; first < out.length / 2; first += 512)
        board.render(out.subarray(first * 2, (first + 512) * 2), 512);
      let energy = 0,
        jump = 0;
      for (let i = 44100 * 2; i < out.length / 2; ++i) {
        energy += out[i * 2] ** 2;
        jump = Math.max(jump, Math.abs(out[i * 2] - out[(i - 1) * 2]));
      }
      return { energy, jump };
    };
    expect(render(0).energy).toBe(0);
    const full = render(1);
    expect(full.energy).toBeGreaterThan(1);
    // The one-second clip wraps twice in the window without a step.
    expect(full.jump).toBeLessThan(0.02);
  });
});
