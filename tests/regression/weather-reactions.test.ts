import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Climate, Weather } from '../../packages/engine/src/climate';
import { point } from '../../packages/engine/src/geometry';
import { Reach, type Strike } from '../../packages/engine/src/thunderstorm';
import { Cue, Sound, VoiceLine, Clip, sounds } from '../../packages/native-audio/src';
import { speakerState, speechAudio, updateSpeech } from '../../apps/web/src/native/game-speech';
import {
  updateWeatherReactions,
  resetWeatherReactions,
  weatherReactionTiming as timing,
  type WeatherReactionApp,
} from '../../apps/web/src/native/weather-reactions';

// Fixed clip metadata exercises the real PersonSpeech timing/sequence bridge
// without decoding or playing audio. Catalog/asset tests cover recorded takes.
const weatherPrefix = (prefix: string) => /\/(rain|snow|thunder)_$/.test(prefix);
const count = sounds.count.bind(sounds),
  name = sounds.name.bind(sounds),
  caption = sounds.caption.bind(sounds),
  clip = sounds.clip.bind(sounds);
beforeEach(() => {
  vi.spyOn(sounds, 'count').mockImplementation((prefix) => (weatherPrefix(prefix) ? 1 : count(prefix)));
  vi.spyOn(sounds, 'name').mockImplementation((prefix, index) =>
    weatherPrefix(prefix) ? prefix + '01' : name(prefix, index),
  );
  vi.spyOn(sounds, 'caption').mockImplementation((key) =>
    /\/(rain|snow|thunder)_01$/.test(key) ? 'Weather is changing.' : caption(key),
  );
  vi.spyOn(sounds, 'clip').mockImplementation((prefix, index) =>
    weatherPrefix(prefix) ? new Clip(null, 44100, 22050) : clip(prefix, index),
  );
});
afterEach(() => vi.restoreAllMocks());
function fixture(weather = Weather.Clear) {
  const people = [0, 1].map(
    (id) =>
      new Person(
        id,
        'Person ' + id,
        Role.Resident,
        Calling.Settler,
        Race.Human,
        5 + id,
        point(100 + id, 100),
      ),
  );
  const climate = Object.assign(new Climate(), { weather, intensity: 1 });
  let clock = 100,
    speed = 1;
  const app = {
    town: {
      people: () => people,
      person: (id: number) => people.find((p) => p.id === id) ?? null,
      climate: () => climate,
      clock: () => clock,
      map: () => ({ seed: () => 5 }),
      dice: 123,
      roll: vi.fn(() => {
        throw new Error('Weather speech must not consume world randomness');
      }),
      isTitleAutoplay: () => false,
    },
    editor: null,
    speakers: new Map(),
    cues: [],
    chosen: [],
    last: 0,
    nextSpeechAt: [0, 0],
    viewWidth: 800,
    viewHeight: 600,
    renderer: { visible: () => true },
    toScreen: (at: { x: number; y: number }) => ({ ...at }),
    spatial: (cue: Cue) => new Sound(cue, 1),
    gameSpeed: () => speed,
  } as unknown as WeatherReactionApp;
  app.speechAudio = speechAudio.bind(app);
  const tick = (seconds: number, strike?: Strike) => {
    app.last = seconds;
    updateWeatherReactions(app, seconds, strike);
  };
  return {
    app,
    people,
    climate,
    tick,
    setClock: (value: number) => {
      clock = value;
    },
    setSpeed: (value: number) => {
      speed = value;
    },
  };
}
const strike = (delay = 3, seed = 1): Strike => ({
  at: 0,
  delay,
  seed,
  reach: Reach.Far,
  brightness: 0.2,
  across: 1.5,
  down: 0.5,
});
const speaking = (app: WeatherReactionApp) =>
  [...app.speakers].filter(([, state]) => state.speech.sequence() > 0n);
const sequence = (app: WeatherReactionApp) =>
  speaking(app).reduce((n, [, state]) => n + Number(state.speech.sequence()), 0);

describe('weather reaction scheduling', () => {
  it('prefetches a visible voice without starting speech, then uses the existing speechAudio bridge', () => {
    const { app, tick } = fixture(Weather.Rain);
    tick(10);
    expect(app.cues).toHaveLength(1);
    expect(app.cues[0].cue).toBe(Cue.PrepareSpeech);
    expect(app.cues[0].line).toBe(VoiceLine.Rain);
    expect(sequence(app)).toBe(0);
    tick(10.4);
    expect(app.cues).toHaveLength(1);
    tick(10 + timing.entryDelay);
    expect(sequence(app)).toBe(1);
    updateSpeech.call(app, 10 + timing.entryDelay);
    const audible = app.cues.find((c) => c.cue === Cue.Speech)!;
    expect(audible.line).toBe(VoiceLine.Rain);
    expect(audible.delay).toBeCloseTo(0.16);
    expect(audible.duration).toBeGreaterThan(0);
  });
  it('reacts to rain and snow transitions, not each Rain/Storm toggle', () => {
    const { app, climate, tick } = fixture();
    tick(0);
    climate.weather = Weather.Rain;
    tick(1);
    tick(1.8);
    expect(speaking(app)[0][1].speech.voice()).toBe(VoiceLine.Rain);
    climate.weather = Weather.Storm;
    tick(15);
    expect(sequence(app)).toBe(1);
    climate.weather = Weather.Snow;
    tick(16);
    tick(16.8);
    expect(sequence(app)).toBe(2);
    expect(speaking(app).some(([, s]) => s.speech.voice() === VoiceLine.Snow)).toBe(true);
  });
  it('makes only rare ongoing remarks during a steady wet spell', () => {
    const { app, tick } = fixture(Weather.Rain),
      at: number[] = [];
    let serial = 0;
    for (let second = 0; second <= 130; second++) {
      tick(second);
      const next = sequence(app);
      if (next > serial) at.push(second);
      serial = next;
    }
    expect(at.length).toBeGreaterThanOrEqual(3);
    expect(at.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(timing.repeatMin);
  });
  it('waits for the actual delayed thunder arrival and never future-starts a speech sequence', () => {
    const { app, tick } = fixture();
    tick(20, strike(3));
    tick(22.99);
    expect(sequence(app)).toBe(0);
    tick(23.19);
    expect(sequence(app)).toBe(0);
    tick(23.2);
    const speech = speaking(app)[0][1].speech;
    expect(speech.voice()).toBe(VoiceLine.Thunder);
    expect(speech.startedAt()).toBe(23.2);
    expect(speech.playing(23.2)).toBe(true);
  });
  it('deduplicates one strike and coalesces repeated flashes without chatter', () => {
    const { app, tick } = fixture(),
      flash = strike(1);
    tick(0, flash);
    tick(0.1, flash);
    tick(1.2);
    expect(sequence(app)).toBe(1);
    tick(2, flash);
    tick(3, strike(0, 2));
    tick(4, strike(0, 3));
    tick(8);
    expect(sequence(app)).toBe(1);
    tick(20);
    expect(sequence(app)).toBe(1);
  });
  it('chooses the same speaker without any selection and in a title preview', () => {
    const a = fixture(Weather.Snow),
      b = fixture(Weather.Snow);
    b.app.chosen = [0, 1];
    b.app.town.isTitleAutoplay = () => true;
    a.tick(0);
    b.tick(0);
    a.tick(1);
    b.tick(1);
    expect(speaking(a.app).map(([id]) => id)).toEqual(speaking(b.app).map(([id]) => id));
    expect(sequence(b.app)).toBe(1);
  });
  it('uses a visible outdoor guest while excluding indoor, dead, fighting and offscreen people', () => {
    const { app, people, tick } = fixture(Weather.Rain);
    people[0].inside = true;
    people[1].role = Role.Guest;
    for (let i = 2; i < 7; i++)
      people.push(new Person(i, 'Excluded', Role.Resident, Calling.Settler, Race.Human, 2, point(100, 100)));
    people[2].health = 0;
    people[3].activity = Activity.Sleeping;
    people[4].position = point(-50, 100);
    people[5].doorway = 0.5;
    people[6].activity = Activity.Expedition;
    tick(0);
    tick(1);
    expect(speaking(app).map(([id]) => id)).toEqual([1]);
  });
  it('rejects fog-hidden and inaudible candidates, expiring an obsolete event quietly', () => {
    const { app, tick } = fixture();
    app.renderer.visible = () => false;
    tick(0, strike(0));
    tick(10);
    app.renderer.visible = () => true;
    tick(11);
    expect(sequence(app)).toBe(0);
    expect(app.cues).toHaveLength(0);
    app.spatial = (cue) => new Sound(cue, 0.01);
    tick(12, strike(0, 2));
    tick(13);
    expect(sequence(app)).toBe(0);
  });
  it('keeps an existing command acknowledgement intact and retries after it finishes', () => {
    const { app, tick } = fixture(Weather.Rain),
      speech = speakerState(app, 0).speech;
    tick(0);
    expect(speech.say(VoiceLine.Ack, 0.7)).toBe(true);
    const previous = speech.sequence();
    tick(0.8);
    expect(speech.playing(0.8)).toBe(true);
    expect(speech.sequence()).toBe(previous);
    expect(speech.voice()).toBe(VoiceLine.Ack);
    expect(sequence(app)).toBe(Number(previous));
    tick(0.7 + speech.duration() + 0.3);
    expect(sequence(app)).toBe(Number(previous) + 1);
  });
  it('defers when a command or combat cue has priority without replacing speech', () => {
    const { app, tick } = fixture(Weather.Rain);
    tick(0);
    app.cues.push(new Sound(Cue.Order));
    tick(1);
    expect(sequence(app)).toBe(0);
    app.cues = [new Sound(Cue.Clash)];
    tick(2);
    expect(sequence(app)).toBe(0);
    app.cues = [];
    tick(3);
    expect(sequence(app)).toBe(1);
  });
  it('leaves a newly engaged fighter the next speech slot even before the attack utterance starts', () => {
    const { app, people, tick } = fixture(Weather.Rain);
    tick(0);
    people[0].activity = Activity.Fighting;
    tick(1);
    expect(sequence(app)).toBe(0);
    people[0].activity = Activity.Idle;
    tick(2);
    expect(sequence(app)).toBe(1);
  });
  it('gives the same person a longer quiet interval and expires missed opportunities', () => {
    const { app, people, tick } = fixture(Weather.Rain);
    people.length = 1;
    tick(0);
    tick(1);
    expect(sequence(app)).toBe(1);
    tick(13, strike(0));
    tick(15);
    tick(23);
    expect(sequence(app)).toBe(1);
    tick(42, strike(0, 2));
    tick(42.2);
    expect(sequence(app)).toBe(2);
  });
  it('drops pending reactions while paused or in an editor', () => {
    for (const editor of [false, true]) {
      const { app, tick, setSpeed } = fixture();
      tick(0, strike(2));
      if (editor) app.editor = {};
      else setSpeed(0);
      tick(1);
      tick(4);
      app.editor = null;
      setSpeed(1);
      tick(5);
      expect(sequence(app)).toBe(0);
    }
  });
  it('does not consume gameplay randomness or mutate resident and climate state', () => {
    const { app, people, climate, tick } = fixture(Weather.Rain);
    const stringify = (value: unknown) =>
      JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? String(item) : item));
    const before = stringify({ people, climate, dice: app.town.dice });
    tick(0);
    tick(1);
    expect(stringify({ people, climate, dice: app.town.dice })).toBe(before);
    expect(app.town.roll).not.toHaveBeenCalled();
  });
  it('clears delayed events on explicit reset, Town replacement, and both clock rewinds', () => {
    for (const mode of ['reset', 'town', 'simulation', 'presentation']) {
      const { app, tick, setClock } = fixture();
      tick(10, strike(3));
      if (mode === 'reset') resetWeatherReactions(app);
      else if (mode === 'town') app.town = { ...app.town } as any;
      else if (mode === 'simulation') setClock(0);
      tick(mode === 'presentation' ? 1 : 11);
      tick(14);
      expect(sequence(app)).toBe(0);
    }
  });
});

it('routes recorded weather lines through PersonSpeech and the normal audio cue bridge', () => {
  vi.restoreAllMocks();
  for (const [weather, line] of [
    [Weather.Rain, VoiceLine.Rain],
    [Weather.Snow, VoiceLine.Snow],
    [Weather.Clear, VoiceLine.Thunder],
  ]) {
    const { app, tick } = fixture(weather);
    tick(0, line === VoiceLine.Thunder ? strike(0) : undefined);
    tick(1);
    updateSpeech.call(app, 1);
    const cue = app.cues.find((sound) => sound.cue === Cue.Speech);
    expect(cue?.line).toBe(line);
    expect(cue?.duration).toBeGreaterThan(0.1);
    const speech = app.speakers.get(cue!.speaker)!.speech;
    expect(speech.text()).not.toBe('');
    expect(speech.text()).not.toBe('Weather is changing.');
  }
});
