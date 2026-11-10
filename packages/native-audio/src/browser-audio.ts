// New speech catalog entries must reach the worklet after an application update.
const processorUrl = `${import.meta.env?.BASE_URL ?? '/'}vendor/goldfantasy-audio.js?v=weather-voices-1`;
import { SoundLibrary } from './sound-library';
import effectEndings from './data/effect-endings.json';
import { Playback } from './sound-board';
import { voicePrefix } from './spoken-voice';
import { Cue, VoiceLine, type VoiceKind, type Sound, type Ambience } from './sound-types';
const devices = new Set<BrowserSoundDevice>();
const unlockEvents = ['pointerdown', 'pointerup', 'keydown'] as const;
interface AudioSession {
  context: AudioContext | null;
  library: SoundLibrary;
  abort: AbortController;
  ready: Promise<void>;
  unlock: ((event: Event) => void) | null;
  closed: boolean;
  failed: boolean;
}
let session: AudioSession | undefined;
function audioSession(existingContext?: AudioContext): AudioSession {
  if (session) return session;
  const current: AudioSession = {
    context: null,
    library: new SoundLibrary(effectEndings),
    abort: new AbortController(),
    ready: Promise.resolve(),
    unlock: null,
    closed: false,
    failed: false,
  };
  session = current;
  current.ready = (async () => {
    const context = existingContext ?? new AudioContext({ sampleRate: 44100 });
    current.context = context;
    const unlock = (event: Event) => {
      // Touch and pen gain user activation on release; mouse gains it on press.
      // A resume attempt on touch pointerdown can remain pending indefinitely.
      if (event.type === 'pointerdown' && (event as PointerEvent).pointerType !== 'mouse') return;
      if (event.type === 'pointerup' && (event as PointerEvent).pointerType === 'mouse') return;
      if (current.closed || current.failed || context.state === 'running' || context.state === 'closed')
        return;
      // Keep gesture listeners for denied attempts and later OS/browser suspensions.
      void context.resume().catch(() => {});
    };
    current.unlock = unlock;
    for (const event of unlockEvents) document.addEventListener(event, unlock);
    await Promise.all([
      context.audioWorklet.addModule(processorUrl).catch((error) => {
        throw new Error('AudioWorklet module: ' + error);
      }),
      current.library.loadInitialEffects(context, undefined, current.abort.signal).catch((error) => {
        throw new Error('Native sound samples: ' + error);
      }),
    ]);
    // The mixer can render synthesized ambience and opening effects now. New
    // clips are installed in existing mixers as they arrive, without resetting voices.
    void current.library.loadEffects(context, undefined, current.abort.signal).catch((error) => {
      if (!current.closed) console.warn('Some background sounds are unavailable:', error);
    });
  })().catch((error) => {
    current.failed = true;
    if (!current.closed) console.warn('Audio is unavailable:', error);
  });
  return current;
}
/** Prepare authored audio independently of the first visible frame. Failures leave the game playable. */
export function prepareNativeAudio(existingContext?: AudioContext): Promise<void> {
  return audioSession(existingContext).ready;
}
/** NativeSound-compatible host. All playback state and mixing remain in SoundBoard. */
export class BrowserSoundDevice {
  private node: AudioWorkletNode | null = null;
  private disposed = false;
  private initialized = false;
  private failed = false;
  private resolveReady: (() => void) | undefined;
  private musicSerial = 0;
  private speechSerial = 0;
  private speech = new Map<number, number>();
  private promotedVoices = new Set<VoiceKind>();
  private unsubscribeClips: (() => void) | undefined;
  private acceptMusic = true;
  private queue: { kind: string; [key: string]: unknown }[] = [];
  private readonly session: AudioSession;
  readonly ready: Promise<void>;
  constructor() {
    devices.add(this);
    this.session = audioSession();
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    void this.session.ready.then(() => {
      const { context, library } = this.session;
      if (this.disposed || this.session.closed || this.session.failed || !context) {
        this.failed = true;
        this.queue = [];
        this.resolveReady?.();
        return;
      }
      try {
        const node = new AudioWorkletNode(context, 'goldfantasy-native-mixer', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        this.node = node;
        node.port.onmessage = ({ data }) => {
          if (data.kind !== 'ready' || this.disposed) return;
          try {
            for (const message of this.queue) node.port.postMessage(message);
            this.queue = [];
            node.connect(context.destination);
            this.initialized = true;
          } catch (error) {
            this.fail(error);
          }
          this.resolveReady?.();
        };
        node.onprocessorerror = () => this.fail(new Error('AudioWorklet processor failed.'));
        node.port.postMessage({ kind: 'init', ...library.snapshot() });
        this.unsubscribeClips = library.onClip((clip) => {
          if (this.disposed || this.failed) return;
          try {
            node.port.postMessage({ kind: 'clips', clips: [clip] });
          } catch (error) {
            this.fail(error);
          }
        });
      } catch (error) {
        this.fail(error);
      }
    });
  }
  private fail(error: unknown): void {
    if (!this.failed && !this.disposed) console.warn('Audio is unavailable:', error);
    this.failed = true;
    this.unsubscribeClips?.();
    this.unsubscribeClips = undefined;
    this.speech.clear();
    this.queue = [];
    this.node?.disconnect();
    this.node?.port.close();
    this.node = null;
    this.resolveReady?.();
  }
  private send(message: { kind: string; [key: string]: unknown }, remember = false): void {
    if (this.disposed || this.failed || this.session.closed || this.session.failed) return;
    if (this.node && this.initialized) this.node.port.postMessage(message);
    else if (remember) {
      // Only the current ambience matters when loading finishes. Keep control ordering.
      if (message.kind === 'ambience')
        this.queue = this.queue.filter((pending) => pending.kind !== 'ambience');
      this.queue.push(message);
    }
    // Transient effects belong to the moment they occur, not a burst after a slow download.
  }
  play(sound: Sound): void {
    if (sound.cue === Cue.PrepareSpeech) {
      this.prepareSpeech(sound);
    } else if (sound.cue === Cue.Music && sound.track) {
      if (!this.acceptMusic || this.disposed || this.failed) return;
      const serial = ++this.musicSerial;
      const { context, library } = this.session;
      if (!context || this.session.closed || this.session.failed) return;
      // Fetch requested music now; it must not wait behind unrelated effect files.
      void Promise.all([
        this.ready,
        library.load(context, sound.track, undefined, this.session.abort.signal, 3),
      ])
        .then(() => {
          if (this.disposed || this.failed || serial !== this.musicSerial || !this.acceptMusic) return;
          const row = this.session.library.snapshot().tracks.find((entry) => entry.name === sound.track);
          if (row) this.send({ kind: 'music', name: row.name, track: row.track, sound });
        })
        .catch(() => {
          if (!this.disposed && serial === this.musicSerial)
            this.send({ kind: 'play', sound: { ...sound, track: '' } });
        });
    } else if (sound.cue === Cue.Speech) {
      this.playSpeech(sound);
    } else {
      if (sound.cue === Cue.SpeechStop) this.speech.delete(sound.speaker);
      if (sound.cue === Cue.Music) ++this.musicSerial;
      this.send({ kind: 'play', sound });
    }
  }
  private prepareSpeech(sound: Sound): void {
    if (this.disposed || this.failed || this.session.closed || this.session.failed) return;
    const { context, library, abort } = this.session,
      prefix = voicePrefix(sound.line, sound.voice);
    if (!context || !prefix) return;
    // A pending weather reaction warms only its own takes, without reserving a
    // speech channel or replacing a line that is currently loading or playing.
    for (const entry of library.entries)
      if (entry.name.startsWith(prefix))
        void library.load(context, entry.name, undefined, abort.signal, 2).catch(() => {});
  }
  private playSpeech(sound: Sound): void {
    if (this.disposed || this.failed || !this.acceptMusic || this.session.closed || this.session.failed)
      return;
    const { context, library, abort } = this.session;
    if (!context) return;
    const name = library.name(voicePrefix(sound.line, sound.voice), sound.take);
    const serial = ++this.speechSerial;
    this.speech.set(sound.speaker, serial);
    const sampleReady = library.load(context, name, undefined, abort.signal, 3);
    // Promote only voices actually heard, including every native random take.
    if (!this.promotedVoices.has(sound.voice)) {
      this.promotedVoices.add(sound.voice);
      const common = [VoiceLine.Select, VoiceLine.Ack, VoiceLine.Work].map((line) =>
          voicePrefix(line, sound.voice),
        ),
        unrequestedWeather = [VoiceLine.Rain, VoiceLine.Snow, VoiceLine.Thunder]
          .filter((line) => line !== sound.line)
          .map((line) => voicePrefix(line, sound.voice)),
        family = voicePrefix(VoiceLine.Select, sound.voice).split('/').slice(0, 2).join('/') + '/';
      for (const entry of library.entries)
        if (
          entry.name.startsWith(family) &&
          !unrequestedWeather.some((prefix) => entry.name.startsWith(prefix))
        )
          void library
            .load(
              context,
              entry.name,
              undefined,
              abort.signal,
              common.some((prefix) => entry.name.startsWith(prefix)) ? 2 : 1,
            )
            .catch(() => {});
    }
    if (this.initialized && (!name || library.hasClip(name))) {
      this.send({ kind: 'play', sound });
      this.speech.delete(sound.speaker);
      return;
    }
    const began = performance.now();
    void Promise.all([this.ready, sampleReady])
      .then(() => {
        if (this.disposed || this.failed || !this.acceptMusic || this.speech.get(sound.speaker) !== serial)
          return;
        this.speech.delete(sound.speaker);
        const elapsed = (performance.now() - began) / 1000,
          offset = sound.offset + Math.max(0, elapsed - sound.delay),
          duration = sound.duration || (library.duration(name) ?? 0) / sound.pitch;
        // Keep the caption's original timeline. Never replay expired lines in a burst.
        if (offset >= duration) return;
        this.send({ kind: 'play', sound: { ...sound, offset, delay: Math.max(0, sound.delay - elapsed) } });
      })
      .catch(() => {
        if (this.speech.get(sound.speaker) === serial) this.speech.delete(sound.speaker);
      });
  }
  setAmbience(ambience: Ambience): void {
    this.send({ kind: 'ambience', ambience }, true);
  }
  fadeIn(seconds = 1.1): void {
    this.acceptMusic = true;
    this.send({ kind: 'fadeIn', seconds }, true);
  }
  fadeOut(seconds = 0.75): void {
    this.acceptMusic = false;
    this.speech.clear();
    ++this.musicSerial;
    this.send({ kind: 'fadeOut', seconds }, true);
  }
  playback(state: 'Paused' | 'Stopped' | 'Playing'): void {
    this.acceptMusic = state === 'Playing';
    if (!this.acceptMusic) {
      ++this.musicSerial;
      this.speech.clear();
    }
    this.send({ kind: 'playback', state: Playback[state] }, true);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeClips?.();
    this.unsubscribeClips = undefined;
    this.speech.clear();
    this.resolveReady?.();
    this.resolveReady = undefined;
    this.queue = [];
    this.node?.port.postMessage({ kind: 'dispose' });
    this.node?.disconnect();
    this.node?.port.close();
    this.node = null;
    devices.delete(this);
  }
}
export async function disposeNativeAudio(): Promise<void> {
  const current = session;
  session = undefined;
  if (current) {
    current.closed = true;
    current.abort.abort();
  }
  for (const device of [...devices]) device.dispose();
  if (current?.unlock) for (const event of unlockEvents) document.removeEventListener(event, current.unlock);
  if (current?.context && current.context.state !== 'closed') await current.context.close();
}
