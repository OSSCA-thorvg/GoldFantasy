import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import manifest from '../../packages/native-audio/src/data/audio-manifest.json';
import sources from '../../packages/native-audio/src/data/audio-sources.json';
import type { Town } from '../../packages/engine/src/town';
import { DungeonKind, World } from '../../packages/engine/src/world-types';
import { Ambience, Cue, Sound } from '../../packages/native-audio/src/sound-types';
import { Moment } from '../../packages/native-audio/src/music-director';
import { SoundBoard } from '../../packages/native-audio/src/sound-board';
import { MusicStream, SoundLibrary } from '../../packages/native-audio/src/sound-library';
import { realmMusic, realmMusicPlaying, realmTrack } from '../../apps/web/src/native/realm-music';
import { playMoment, type GameSoundApp } from '../../apps/web/src/native/game-soundscape';

const worlds = [
  [World.Asgard, 'asgard'],
  [World.Vanaheim, 'vanaheim'],
  [World.Alfheim, 'alfheim'],
  [World.Jotunheim, 'jotunheim'],
  [World.Svartalfheim, 'svartalfheim'],
  [World.Niflheim, 'niflheim'],
  [World.Muspelheim, 'muspelheim'],
  [World.Helheim, 'helheim'],
] as const;
function fakeTown(world: World, gate = 0, floor = 0) {
  return {
    realmGate: gate,
    realmFloor: floor,
    isTitleAutoplay: () => false,
    bardPlaying: () => false,
    map: () => ({
      dungeons: () => [{ name: 'Gate', kind: DungeonKind.Portal, origin: { x: 4, y: 4 }, discovered: true }],
      destination: () => world,
    }),
  } as unknown as Town & { realmGate: number; realmFloor: number };
}
const music = (cues: Sound[]) => cues.filter((sound) => sound.cue === Cue.Music);

describe('music beyond the gates', () => {
  it('names one shipped loop for every world and floor', () => {
    const names = new Set<string>();
    for (const [world, name] of worlds)
      for (let floor = 0; floor < 3; ++floor) {
        const track = realmTrack(fakeTown(world, 0, floor));
        expect(track).toBe(`music/realm/${name}_${floor + 1}`);
        names.add(track);
        const entry = manifest.find((row) => row.name === track)!;
        expect(entry, track).toBeDefined();
        expect(entry.rate).toBe(44100);
        expect(entry.channels).toBe(2);
        expect(entry.frames / entry.rate).toBeGreaterThan(60);
        expect(entry.frames / entry.rate).toBeLessThan(90);
        expect(sources.sources.some((row) => row.path === track + '.ogg')).toBe(true);
        expect(existsSync(new URL(`../../public/assets/audio/${track}.ogg`, import.meta.url))).toBe(true);
      }
    expect(names.size).toBe(24);
    expect(realmTrack(fakeTown(World.Helheim, -1))).toBe('');
  });

  it('asks for the loop on entry, changes it with the floor and stops it on leaving', () => {
    const town = fakeTown(World.Niflheim, -1),
      app = { town, cues: [] as Sound[] };
    realmMusic(app);
    expect(app.cues).toEqual([]);
    town.realmGate = 0;
    realmMusic(app);
    realmMusic(app);
    expect(music(app.cues).map((s) => [s.track, s.loop])).toEqual([['music/realm/niflheim_1', true]]);
    expect(realmMusicPlaying(app)).toBe(true);
    town.realmFloor = 2;
    realmMusic(app);
    expect(music(app.cues).at(-1)!.track).toBe('music/realm/niflheim_3');
    town.realmGate = -1;
    realmMusic(app);
    realmMusic(app);
    expect(music(app.cues).map((s) => s.track)).toEqual([
      'music/realm/niflheim_1',
      'music/realm/niflheim_3',
      '',
    ]);
    expect(music(app.cues).at(-1)!.loop).toBe(false);
    expect(realmMusicPlaying(app)).toBe(false);
  });

  it('asks again for a newly loaded game and stays quiet on the title', () => {
    const app = { town: fakeTown(World.Muspelheim, 0, 1), cues: [] as Sound[] };
    realmMusic(app);
    app.town = fakeTown(World.Muspelheim, 0, 1);
    realmMusic(app);
    expect(music(app.cues).map((s) => s.track)).toEqual(['music/realm/muspelheim_2', 'music/realm/muspelheim_2']);
    const title = { town: fakeTown(World.Asgard, 0, 0), cues: [] as Sound[] };
    title.town.isTitleAutoplay = () => true;
    realmMusic(title);
    expect(title.cues).toEqual([]);
  });

  it('keeps the settlement moments quiet while a world plays', () => {
    const app = {
      town: fakeTown(World.Alfheim, 0, 0),
      cues: [] as Sound[],
      director: { moment: () => 'music/dawn/saga_world_tree' },
    } as unknown as GameSoundApp;
    playMoment.call(app, Moment.Dawn, 100);
    expect(music(app.cues).map((s) => s.track)).toEqual(['music/dawn/saga_world_tree']);
    realmMusic(app);
    playMoment.call(app, Moment.Dawn, 200);
    expect(music(app.cues).map((s) => s.track)).toEqual(['music/dawn/saga_world_tree', 'music/realm/alfheim_1']);
  });

  it('loads none of it at startup', async () => {
    const library = new SoundLibrary(),
      asked: string[] = [];
    vi.spyOn(library, 'load').mockImplementation(async (_context, name) => {
      asked.push(name);
    });
    await library.loadInitialEffects();
    await library.loadEffects();
    expect(asked.length).toBeGreaterThan(100);
    expect(asked.filter((name) => name.startsWith('music/'))).toEqual([]);
  });
});

describe('looping music in the mixer', () => {
  const rate = 44100,
    tone = (seconds: number) => {
      const frames = Math.round(seconds * rate),
        pcm = new Float32Array(frames * 2);
      for (let i = 0; i < frames; ++i) pcm[2 * i] = pcm[2 * i + 1] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate);
      return { pcm, frames, rate };
    },
    level = (board: SoundBoard, seconds: number) => {
      const out = new Float32Array(1024 * 2);
      let sum = 0,
        count = 0;
      for (let done = 0; done < seconds * rate; done += 1024) {
        board.render(out, 1024);
        for (const x of out) sum += x * x;
        count += out.length;
      }
      return Math.sqrt(sum / count);
    },
    board = (loop: boolean, ambience = new Ambience()) => {
      const library = new SoundLibrary();
      library.setMusic('music/realm/helheim_1', tone(1));
      const mixer = new SoundBoard(library),
        tune = new Sound(Cue.Music);
      tune.track = 'music/realm/helheim_1';
      tune.loop = loop;
      mixer.setAmbience(ambience);
      mixer.play(tune);
      return mixer;
    };

  it('wraps a loop seamlessly and lets a plain track end', () => {
    const stream = new MusicStream(tone(0.01), true),
      out = new Float32Array(1000 * 2);
    expect(stream.read(out, 1000)).toBe(1000);
    expect(out[2 * 441]).toBe(0);
    expect(out[2 * 442]).toBeCloseTo(out[2], 6);
    expect(new MusicStream(tone(0.01)).read(out, 1000)).toBe(441);
    const looping = board(true),
      plain = board(false);
    level(looping, 1.5);
    level(plain, 1.5);
    expect(level(looping, 1)).toBeGreaterThan(0.02);
    expect(level(plain, 1)).toBe(0);
    expect(looping.musicPlaying()).toBe(true);
  });

  it('gives way to a swarm and to a fight sting', () => {
    const swarm = new Ambience();
    swarm.swarm = 1;
    const calm = board(true),
      pressed = board(true, swarm),
      stung = board(true);
    level(calm, 3);
    level(pressed, 3);
    level(stung, 3);
    stung.play(new Sound(Cue.WaveHorn));
    const [a, b] = [level(calm, 0.8), level(pressed, 0.8)];
    expect(b / a).toBeLessThan(0.7);
    expect(b / a).toBeGreaterThan(0.5);
    // The horn itself has no clip in this library, so what is left is the ducked music.
    expect(level(stung, 0.8) / a).toBeLessThan(0.6);
    level(stung, 3);
    expect(level(stung, 0.5) / level(calm, 0.5)).toBeGreaterThan(0.98);
  });
});
