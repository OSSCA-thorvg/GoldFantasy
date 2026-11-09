import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers/promises';
import manifest from '../../packages/native-audio/src/data/audio-manifest.json';

const settle = async (condition: () => boolean) => {
  for (let i = 0; i < 100 && !condition(); ++i) await setImmediate();
  expect(condition()).toBe(true);
};
let blocked: Set<string>,
  requests: string[],
  pending: Map<string, { resolve: () => void; reject: (e: unknown) => void }>,
  nodes: NodeStub[],
  contexts: ContextStub[],
  warnings: unknown[][];
class DocumentStub extends EventTarget {}
class ContextStub {
  state = 'suspended';
  sampleRate = 44100;
  destination = {};
  resumes = 0;
  audioWorklet = { addModule: async () => {} };
  constructor() {
    contexts.push(this);
  }
  async resume() {
    ++this.resumes;
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }
}
class NodeStub {
  messages: any[] = [];
  connected = false;
  port = {
    onmessage: null as ((e: { data: any }) => void) | null,
    postMessage: (data: any) => {
      this.messages.push(data);
      if (data.kind === 'init') queueMicrotask(() => this.port.onmessage?.({ data: { kind: 'ready' } }));
    },
    close() {},
  };
  constructor() {
    nodes.push(this);
  }
  connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
}
class DecoderStub {
  constructor(
    public channels: number,
    _frames: number,
    public sampleRate: number,
  ) {}
  async decodeAudioData(bytes: ArrayBuffer) {
    const entry = manifest[new Uint32Array(bytes)[0]];
    expect(this.sampleRate).toBe(entry.rate);
    return {
      length: 8,
      numberOfChannels: entry.channels,
      getChannelData: () => new Float32Array([0, 0.8, -0.8, 0.3, 0, 0, 0, 0]),
    };
  }
}
beforeEach(() => {
  vi.resetModules();
  blocked = new Set();
  requests = [];
  pending = new Map();
  nodes = [];
  contexts = [];
  warnings = [];
  vi.stubGlobal('document', new DocumentStub());
  vi.stubGlobal('AudioContext', ContextStub);
  vi.stubGlobal('OfflineAudioContext', DecoderStub);
  vi.stubGlobal('AudioWorkletNode', NodeStub);
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(args));
  vi.stubGlobal('fetch', async (url: string, options?: { signal?: AbortSignal }) => {
    const name = url.slice(url.indexOf('/audio/') + 7, -4),
      index = manifest.findIndex((e) => e.name === name);
    expect(index).toBeGreaterThanOrEqual(0);
    requests.push(name);
    if (blocked.has(name))
      await new Promise<void>((resolve, reject) => {
        pending.set(name, { resolve, reject });
        options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true });
      });
    options?.signal?.throwIfAborted();
    return { ok: true, arrayBuffer: async () => new Uint32Array([index]).buffer };
  });
});
afterEach(async () => {
  const { disposeNativeAudio } = await import('../../packages/native-audio/src/browser-audio');
  await disposeNativeAudio();
  for (const job of pending.values()) job.resolve();
  await setImmediate();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('audio startup priorities', () => {
  it('starts the title mixer before a noncritical voice finishes loading', async () => {
    blocked.add('voice/berserker/ack_01');
    const { BrowserSoundDevice } = await import('../../packages/native-audio/src/browser-audio');
    const device = new BrowserSoundDevice();
    let ready = false;
    void device.ready.then(() => (ready = true));
    await settle(() => pending.has('voice/berserker/ack_01'));
    expect(ready).toBe(true);
    expect(nodes[0].connected).toBe(true);
    expect(nodes[0].messages[0].clips.some((c: any) => c.name === 'sfx/hammer_01')).toBe(true);
  });
  it('requests music while the initial effects are still loading', async () => {
    blocked.add('sfx/hammer_01');
    const { BrowserSoundDevice } = await import('../../packages/native-audio/src/browser-audio');
    const { Cue, Sound } = await import('../../packages/native-audio/src/sound-types');
    const device = new BrowserSoundDevice(),
      sound = new Sound(Cue.Music);
    sound.track = 'music/build/day_hammer_harvest';
    device.play(sound);
    await settle(() => pending.has('sfx/hammer_01'));
    await setImmediate();
    expect(requests).toContain(sound.track);
  });
});

describe('incremental audio loading', () => {
  it('loads every initial cue variation and keeps synthesized ambience/mining file-free', async () => {
    const { cueClips, initialEffectPrefixes } = await import('../../packages/native-audio/src/sound-catalog');
    const { Cue } = await import('../../packages/native-audio/src/sound-types');
    const { SoundLibrary } = await import('../../packages/native-audio/src/sound-library');
    const library = new SoundLibrary();
    await library.loadInitialEffects();
    for (const cue of [Cue.Place, Cue.Click, Cue.Order, Cue.Complete, Cue.Chop, Cue.TreeFall, Cue.Raven]) {
      for (const prefix of cueClips[cue]!) {
        for (const entry of manifest.filter((e) => e.name.startsWith(prefix)))
          expect(library.hasClip(entry.name)).toBe(true);
      }
    }
    expect(library.hasClip('sfx/hammer_01')).toBe(true);
    expect(cueClips[Cue.Mine]).toBeUndefined();
    expect(requests.every((name) => initialEffectPrefixes.some((prefix) => name.startsWith(prefix)))).toBe(
      true,
    );
    expect(requests.length).toBeLessThan(20);
  });

  it('installs background clips in the running device and keeps cached clips', async () => {
    blocked.add('voice/berserker/ack_01');
    const { BrowserSoundDevice } = await import('../../packages/native-audio/src/browser-audio');
    const device = new BrowserSoundDevice();
    await device.ready;
    const initialHammer = nodes[0].messages[0].clips.find((c: any) => c.name === 'sfx/hammer_01');
    await settle(() => pending.has('voice/berserker/ack_01'));
    pending.get('voice/berserker/ack_01')!.resolve();
    await settle(() =>
      nodes[0].messages.some(
        (m) => m.kind === 'clips' && m.clips.some((c: any) => c.name === 'voice/berserker/ack_01'),
      ),
    );
    expect(nodes[0].messages.filter((m) => m.kind === 'init')).toHaveLength(1);
    expect(requests.filter((n) => n === initialHammer.name)).toHaveLength(1);
    expect(nodes[0].connected).toBe(true);
  });

  it('does not reset mixer voices, clock, hammer onsets or music when a new clip arrives', async () => {
    let Processor: any;
    class ProcessorStub {
      port = { onmessage: null as any, postMessage: vi.fn() };
    }
    vi.stubGlobal('AudioWorkletProcessor', ProcessorStub);
    vi.stubGlobal('registerProcessor', (_name: string, constructor: any) => (Processor = constructor));
    await import('../../packages/native-audio/src/audio-worklet');
    const { Cue, Sound, Ambience } = await import('../../packages/native-audio/src/sound-types');
    const processor = new Processor(),
      deliver = (data: any) => processor.port.onmessage({ data });
    const hammer = new Int16Array(22050);
    hammer[2] = 30000;
    hammer[11025] = -30000;
    deliver({
      kind: 'init',
      clips: [
        { name: 'sfx/hammer_01', pcm: hammer, rate: 22050 },
        { name: 'sfx/chop_01', pcm: new Int16Array(22050).fill(9000), rate: 22050 },
      ],
      tracks: [],
    });
    const ambience = new Ambience();
    ambience.wind = 0.5;
    deliver({ kind: 'ambience', ambience });
    deliver({ kind: 'play', sound: new Sound(Cue.Chop) });
    const music = new Sound(Cue.Music);
    music.track = 'music/build/day_hammer_harvest';
    deliver({
      kind: 'music',
      name: music.track,
      track: { pcm: new Float32Array(44100 * 2).fill(0.1), frames: 44100, rate: 44100 },
      sound: music,
    });
    const outputs = [[new Float32Array(128), new Float32Array(128)]];
    processor.process([], outputs);
    const board = processor.board,
      clock = board.clock,
      voices = board.voices,
      heldHammer = board.hammer,
      strikes = board.strikes,
      playingMusic = board.music;
    expect(strikes.length).toBe(2);
    expect(clock).toBeGreaterThan(0);
    expect(outputs[0][0].some((v: number) => v !== 0)).toBe(true);
    deliver({
      kind: 'clips',
      clips: [{ name: 'wildlife/cow_01', pcm: new Int16Array([100, -100, 100]), rate: 22050 }],
    });
    expect(processor.board).toBe(board);
    expect(board.voices).toBe(voices);
    expect(board.clock).toBe(clock);
    expect(board.hammer).toBe(heldHammer);
    expect(board.strikes).toBe(strikes);
    expect(board.music).toBe(playingMusic);
    processor.process([], outputs);
    expect(board.clock).toBeGreaterThan(clock);
  });

  it('keeps initial audio usable if a background clip fails and retries that clip on demand', async () => {
    blocked.add('voice/berserker/ack_01');
    const { BrowserSoundDevice } = await import('../../packages/native-audio/src/browser-audio');
    const { Cue, Sound, VoiceKind, VoiceLine } = await import('../../packages/native-audio/src/sound-types');
    const device = new BrowserSoundDevice();
    await device.ready;
    await settle(() => pending.has('voice/berserker/ack_01'));
    pending.get('voice/berserker/ack_01')!.reject(new Error('controlled background request failure'));
    await settle(() => warnings.length === 1);
    const sound = new Sound(Cue.Speech);
    sound.voice = VoiceKind.Berserker;
    sound.line = VoiceLine.Ack;
    sound.speaker = 0;
    sound.duration = 10;
    blocked.delete('voice/berserker/ack_01');
    device.play(sound);
    await settle(() => nodes[0].messages.some((m) => m.kind === 'play' && m.sound.cue === Cue.Speech));
    expect(requests.filter((n) => n === 'voice/berserker/ack_01')).toHaveLength(2);
    expect(nodes[0].connected).toBe(true);
  });

  it('discards pending speech after stop or expiry instead of replaying an old utterance', async () => {
    blocked.add('voice/huntress/select_01');
    blocked.add('voice/huntress/ack_01');
    const { BrowserSoundDevice } = await import('../../packages/native-audio/src/browser-audio');
    const { Cue, Sound, VoiceKind, VoiceLine } = await import('../../packages/native-audio/src/sound-types');
    const device = new BrowserSoundDevice();
    await device.ready;
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sound = new Sound(Cue.Speech);
    sound.voice = VoiceKind.Huntress;
    sound.line = VoiceLine.Select;
    sound.duration = 1;
    sound.speaker = 1;
    device.play(sound);
    await settle(() => pending.has('voice/huntress/select_01'));
    const stop = new Sound(Cue.SpeechStop);
    stop.speaker = 1;
    device.play(stop);
    pending.get('voice/huntress/select_01')!.resolve();
    await setImmediate();
    const second = { ...sound, line: VoiceLine.Ack };
    device.play(second);
    await settle(() => pending.has('voice/huntress/ack_01'));
    now = 2000;
    pending.get('voice/huntress/ack_01')!.resolve();
    await setImmediate();
    expect(nodes[0].messages.filter((m) => m.kind === 'play' && m.sound.cue === Cue.Speech)).toHaveLength(0);
  });

  it('keeps late speech aligned with its original caption rather than restarting it', async () => {
    blocked.add('voice/huntress/select_01');
    const { BrowserSoundDevice } = await import('../../packages/native-audio/src/browser-audio');
    const { Cue, Sound, VoiceKind, VoiceLine } = await import('../../packages/native-audio/src/sound-types');
    const device = new BrowserSoundDevice();
    await device.ready;
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const sound = new Sound(Cue.Speech);
    sound.voice = VoiceKind.Huntress;
    sound.line = VoiceLine.Select;
    sound.duration = 2;
    sound.speaker = 1;
    sound.delay = 0.1;
    device.play(sound);
    await settle(() => pending.has('voice/huntress/select_01'));
    now = 350;
    pending.get('voice/huntress/select_01')!.resolve();
    await settle(() => nodes[0].messages.some((m) => m.kind === 'play' && m.sound.cue === Cue.Speech));
    const played = nodes[0].messages.find((m) => m.kind === 'play' && m.sound.cue === Cue.Speech).sound;
    expect(played.offset).toBeCloseTo(0.25);
    expect(played.delay).toBe(0);
  });

  it('unlocks on an early touch release, retries later suspension and removes listeners on disposal', async () => {
    blocked.add('sfx/hammer_01');
    const { prepareNativeAudio, disposeNativeAudio } =
      await import('../../packages/native-audio/src/browser-audio');
    const ready = prepareNativeAudio(),
      context = contexts[0];
    const gesture = (type: string, pointerType: string) => {
      const event = new Event(type);
      Object.defineProperty(event, 'pointerType', { value: pointerType });
      document.dispatchEvent(event);
    };
    gesture('pointerdown', 'touch');
    expect(context.resumes).toBe(0);
    gesture('pointerup', 'touch');
    expect(context.resumes).toBe(1);
    expect(context.state).toBe('running');
    context.state = 'suspended';
    gesture('pointerup', 'pen');
    expect(context.resumes).toBe(2);
    await disposeNativeAudio();
    gesture('keydown', '');
    expect(context.resumes).toBe(2);
    await ready;
  });

  it('aborts an old session without contaminating a fresh preload', async () => {
    blocked.add('sfx/hammer_01');
    const { BrowserSoundDevice, disposeNativeAudio } =
      await import('../../packages/native-audio/src/browser-audio');
    const old = new BrowserSoundDevice();
    await settle(() => pending.has('sfx/hammer_01'));
    await disposeNativeAudio();
    await old.ready;
    blocked.clear();
    const fresh = new BrowserSoundDevice();
    await fresh.ready;
    expect(contexts).toHaveLength(2);
    expect(contexts[0].state).toBe('closed');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].connected).toBe(true);
    expect(warnings).toHaveLength(0);
  });
});

describe('audio priority lifecycle boundaries', () => {
  it('reuses the context already unlocked by the splash gesture', async () => {
    const context = new ContextStub();
    await context.resume();
    const { prepareNativeAudio, BrowserSoundDevice } =
      await import('../../packages/native-audio/src/browser-audio');
    await prepareNativeAudio(context as unknown as AudioContext);
    const device = new BrowserSoundDevice();
    await device.ready;
    expect(contexts).toHaveLength(1);
    expect(context.state).toBe('running');
    expect(nodes[0].connected).toBe(true);
  });
  it('bounds prioritized music, voices and background effects to four active loads', async () => {
    const { SoundLibrary } = await import('../../packages/native-audio/src/sound-library');
    const library = new SoundLibrary(),
      entries = manifest.filter((e) => !e.name.startsWith('music/')).slice(0, 8);
    for (const e of entries) blocked.add(e.name);
    const loading = entries.map((e) => library.load(undefined, e.name));
    expect(requests).toHaveLength(4);
    const music = library.load(undefined, 'music/build/day_hammer_harvest', undefined, undefined, 3);
    pending.get(entries[0].name)!.resolve();
    await settle(() => requests.includes('music/build/day_hammer_harvest'));
    expect(requests.indexOf('music/build/day_hammer_harvest')).toBe(4);
    for (const e of entries) blocked.delete(e.name);
    for (const job of pending.values()) job.resolve();
    await Promise.all([...loading, music]);
    expect(new Set(requests).size).toBe(requests.length);
    const count = requests.length;
    await library.load(undefined, entries[0].name);
    expect(requests).toHaveLength(count);
  });
  it('handles unavailable and canceled music without disabling effects or replaying it later', async () => {
    const track = 'music/build/day_hammer_harvest';
    blocked.add(track);
    const { BrowserSoundDevice } = await import('../../packages/native-audio/src/browser-audio');
    const { Cue, Sound } = await import('../../packages/native-audio/src/sound-types');
    const device = new BrowserSoundDevice();
    await device.ready;
    const music = new Sound(Cue.Music);
    music.track = track;
    device.play(music);
    await settle(() => pending.has(track));
    pending.get(track)!.reject(new Error('controlled music error'));
    await settle(() => nodes[0].messages.some((m) => m.kind === 'play' && m.sound.cue === Cue.Music));
    device.play(new Sound(Cue.Chop));
    expect(nodes[0].messages.at(-1).sound.cue).toBe(Cue.Chop);
    pending.delete(track);
    device.play(music);
    await settle(() => pending.has(track));
    device.fadeOut();
    pending.get(track)!.resolve();
    await setImmediate();
    expect(nodes[0].messages.some((m) => m.kind === 'music')).toBe(false);
    expect(nodes[0].connected).toBe(true);
  });
  it('coalesces pending ambience and never queues a burst of old clicks or work sounds', async () => {
    blocked.add('sfx/hammer_01');
    const { BrowserSoundDevice } = await import('../../packages/native-audio/src/browser-audio');
    const { Cue, Sound, Ambience } = await import('../../packages/native-audio/src/sound-types');
    const device = new BrowserSoundDevice();
    device.fadeIn(0.5);
    for (let i = 0; i < 1000; ++i) {
      const mix = new Ambience();
      mix.wind = i / 1000;
      device.setAmbience(mix);
      device.play(new Sound(Cue.Chop));
    }
    device.fadeOut(0.25);
    await settle(() => pending.has('sfx/hammer_01'));
    pending.get('sfx/hammer_01')!.resolve();
    await device.ready;
    const controls = nodes[0].messages.filter((m) => m.kind !== 'init' && m.kind !== 'clips');
    expect(controls.map((m) => m.kind)).toEqual(['fadeIn', 'ambience', 'fadeOut']);
    expect(controls[1].ambience.wind).toBe(0.999);
  });
});
