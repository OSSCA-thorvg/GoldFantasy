const processorUrl = `${import.meta.env?.BASE_URL ?? '/'}vendor/goldfantasy-audio.js`;
import { sounds } from './sound-library';
import { Playback } from './sound-board';
import { Cue, type Sound, type Ambience } from './sound-types';
let context: AudioContext | undefined, preparation: Promise<void> | undefined;
const devices = new Set<BrowserSoundDevice>();
let unlockHandler: (() => void) | undefined;
/** Load unchanged authored samples before the title/application begins. No playback occurs here. */
export function prepareNativeAudio(): Promise<void> {
  if (preparation) return preparation;
  context = new AudioContext({ sampleRate: 44100 });
  const unlock = () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
    unlockHandler = undefined;
    void context?.resume();
  };
  unlockHandler = unlock;
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  preparation = (async () => {
    await Promise.all([
      context!.audioWorklet.addModule(processorUrl).catch((error) => {
        throw new Error('AudioWorklet module: ' + error);
      }),
      sounds.loadEffects(context!).catch((error) => {
        throw new Error('Native sound samples: ' + error);
      }),
    ]);
  })();
  return preparation;
}
/** NativeSound-compatible host. All playback state and mixing remain in SoundBoard. */
export class BrowserSoundDevice {
  private node: AudioWorkletNode | null = null;
  private disposed = false;
  private initialized = false;
  private resolveReady: (() => void) | undefined;
  private musicSerial = 0;
  private acceptMusic = true;
  private queue: unknown[] = [];
  readonly ready: Promise<void>;
  constructor() {
    devices.add(this);
    this.ready = prepareNativeAudio().then(
      () =>
        new Promise<void>((resolve) => {
          this.resolveReady = resolve;
          if (this.disposed) {
            resolve();
            return;
          }
          const node = new AudioWorkletNode(context!, 'goldfantasy-native-mixer', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });
          this.node = node;
          node.port.onmessage = ({ data }) => {
            if (data.kind !== 'ready') return;
            if (this.disposed) {
              node.disconnect();
              node.port.postMessage({ kind: 'dispose' });
              resolve();
              return;
            }
            for (const message of this.queue) node.port.postMessage(message);
            this.queue = [];
            this.initialized = true;
            node.connect(context!.destination);
            resolve();
          };
          node.port.postMessage({ kind: 'init', ...sounds.snapshot() });
        }),
    );
  }
  private send(message: unknown): void {
    if (this.disposed) return;
    if (this.node && this.initialized) this.node.port.postMessage(message);
    else this.queue.push(message);
  }
  play(sound: Sound): void {
    if (sound.cue === Cue.Music && sound.track) {
      if (!this.acceptMusic || this.disposed) return;
      const serial = ++this.musicSerial;
      void this.ready
        .then(() => {
          if (!this.disposed && context) return sounds.load(context, sound.track);
        })
        .then(() => {
          if (this.disposed || serial !== this.musicSerial || !this.acceptMusic) return;
          const row = sounds.snapshot().tracks.find((entry) => entry.name === sound.track);
          if (row) this.send({ kind: 'music', name: row.name, track: row.track, sound });
        })
        .catch(() => {
          if (!this.disposed && serial === this.musicSerial)
            this.send({ kind: 'play', sound: { ...sound, track: '' } });
        });
    } else {
      if (sound.cue === Cue.Music) ++this.musicSerial;
      this.send({ kind: 'play', sound });
    }
  }
  setAmbience(ambience: Ambience): void {
    this.send({ kind: 'ambience', ambience });
  }
  fadeIn(seconds = 1.1): void {
    this.acceptMusic = true;
    this.send({ kind: 'fadeIn', seconds });
  }
  fadeOut(seconds = 0.75): void {
    this.acceptMusic = false;
    ++this.musicSerial;
    this.send({ kind: 'fadeOut', seconds });
  }
  playback(state: 'Paused' | 'Stopped' | 'Playing'): void {
    this.acceptMusic = state === 'Playing';
    if (!this.acceptMusic) ++this.musicSerial;
    this.send({ kind: 'playback', state: Playback[state] });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
  for (const device of [...devices]) device.dispose();
  if (unlockHandler) {
    document.removeEventListener('pointerdown', unlockHandler);
    document.removeEventListener('keydown', unlockHandler);
    unlockHandler = undefined;
  }
  await context?.close();
  context = undefined;
  preparation = undefined;
}
