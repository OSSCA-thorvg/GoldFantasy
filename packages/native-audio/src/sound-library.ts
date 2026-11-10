// Native sound_library.cpp semantics. Browser decoding is confined to the host loader.
// Authored Ogg metadata is captured with stb_vorbis, including appended weather takes.
import manifest from './data/audio-manifest.json';
import { initialEffectPrefixes } from './sound-catalog';
import { f32 as f } from '../../engine/src/numeric';
export class Clip {
  constructor(
    public pcm: Int16Array | null = null,
    public frames = 0,
    public rate = 22050,
  ) {}
  duration(): number {
    return this.rate > 0 ? this.frames / this.rate : 0;
  }
  at(seconds: number, pitch = 1): number {
    pitch = f(pitch);
    if (!this.pcm || !Number.isFinite(seconds) || !Number.isFinite(pitch) || seconds < 0 || pitch <= 0)
      return 0;
    const frame = seconds * this.rate * pitch;
    if (frame >= this.frames - 1) return 0;
    const index = Math.trunc(frame),
      fraction = f(frame - index);
    return f(f(this.pcm[index] + f((this.pcm[index + 1] - this.pcm[index]) * fraction)) / 32768);
  }
}
export function onsets(clip: Clip, threshold: number, gap: number): number[] {
  const found: number[] = [];
  if (!clip.pcm || clip.rate <= 0) return found;
  const limit = Math.trunc(f(f(threshold) * 32767)),
    quiet = Math.trunc(gap * clip.rate);
  let below = quiet;
  for (let i = 0; i < clip.frames; ++i) {
    if (Math.abs(clip.pcm[i]) < limit) {
      ++below;
      continue;
    }
    if (below >= quiet) found.push(i / clip.rate);
    below = 0;
  }
  return found;
}
export interface MusicTrack {
  readonly pcm: Float32Array;
  readonly frames: number;
  readonly rate: number;
}
export class MusicStream {
  private done = 0;
  constructor(private readonly track: MusicTrack | null) {}
  valid(): boolean {
    return !!this.track && this.track.rate === 44100;
  }
  duration(): number {
    return this.valid() ? this.track!.frames / 44100 : 0;
  }
  played(): number {
    return this.done / 44100;
  }
  read(stereo: Float32Array, frames: number): number {
    if (!this.valid() || frames <= 0) return 0;
    const got = Math.min(frames, this.track!.frames - this.done);
    stereo.set(this.track!.pcm.subarray(this.done * 2, (this.done + got) * 2));
    this.done += got;
    return got;
  }
}
export interface EffectEndings {
  frames: number;
  clips: Record<string, string>;
  sourceSha256: string;
}
export interface LoadedClip {
  name: string;
  pcm: Int16Array;
  rate: number;
}
interface LoadJob {
  name: string;
  priority: number;
  run: () => Promise<void>;
}
export class SoundLibrary {
  readonly entries = manifest;
  private clips = new Map<string, Clip>();
  private tracks = new Map<string, MusicTrack>();
  private loading = new Map<string, Promise<void>>();
  private decoders = new Map<string, OfflineAudioContext>();
  private activeLoads = 0;
  private jobs: LoadJob[] = [];
  private clipListeners = new Set<(clip: LoadedClip) => void>();
  private effectsLoading: Promise<void> | undefined;
  constructor(private readonly endings?: EffectEndings) {}
  count(prefix: string): number {
    return this.entries.filter((entry) => entry.name.startsWith(prefix)).length;
  }
  name(prefix: string, index: number): string {
    return index < 0
      ? ''
      : (this.entries.filter((entry) => entry.name.startsWith(prefix))[index]?.name ?? '');
  }
  caption(name: string): string {
    return this.entries.find((entry) => entry.name === name)?.caption ?? '';
  }
  duration(name: string): number | undefined {
    const entry = this.entries.find((entry) => entry.name === name);
    return entry && entry.frames / entry.rate;
  }
  clip(prefix: string, index: number): Clip {
    const name = this.name(prefix, index),
      found = this.clips.get(name);
    if (found) return found;
    const entry = this.entries.find((entry) => entry.name === name);
    return entry ? new Clip(null, entry.frames, entry.rate) : new Clip();
  }
  setClip(name: string, pcm: Int16Array, rate: number): void {
    this.clips.set(name, new Clip(pcm, pcm.length, rate));
    for (const listener of this.clipListeners) listener({ name, pcm, rate });
  }
  onClip(listener: (clip: LoadedClip) => void): () => void {
    this.clipListeners.add(listener);
    return () => this.clipListeners.delete(listener);
  }
  hasClip(name: string): boolean {
    return this.clips.has(name);
  }
  private drain(): void {
    this.jobs.sort((a, b) => b.priority - a.priority);
    while (this.activeLoads < 4 && this.jobs.length) {
      const job = this.jobs.shift()!;
      ++this.activeLoads;
      void job.run().finally(() => {
        --this.activeLoads;
        this.drain();
      });
    }
  }
  private schedule(name: string, priority: number, run: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.jobs.push({
        name,
        priority,
        run: async () => {
          try {
            await run();
            resolve();
          } catch (error) {
            reject(error);
          }
        },
      });
      this.drain();
    });
  }
  async loadInitialEffects(context?: BaseAudioContext, base?: string, signal?: AbortSignal): Promise<void> {
    const names = this.entries
      .filter((entry) => initialEffectPrefixes.some((prefix) => entry.name.startsWith(prefix)))
      .map((entry) => entry.name);
    await Promise.all(names.map((name) => this.load(context, name, base, signal, 2)));
  }
  setMusic(name: string, track: MusicTrack): void {
    this.tracks.delete(name);
    this.tracks.set(name, track);
    while (this.tracks.size > 3) this.tracks.delete(this.tracks.keys().next().value!);
  }
  music(name: string): MusicStream {
    return new MusicStream(this.tracks.get(name) ?? null);
  }
  async load(
    context: BaseAudioContext | undefined,
    name: string,
    base = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/`,
    signal?: AbortSignal,
    priority = 0,
  ): Promise<void> {
    signal?.throwIfAborted();
    if (this.clips.has(name) || this.tracks.has(name)) return;
    const existing = this.loading.get(name);
    if (existing) {
      const job = this.jobs.find((job) => job.name === name);
      if (job) job.priority = Math.max(job.priority, priority);
      return existing;
    }
    const entry = this.entries.find((entry) => entry.name === name);
    if (!entry) return;
    const task = this.schedule(name, priority, async () => {
      signal?.throwIfAborted();
      const response = await fetch(base + name + '.ogg', { signal });
      if (!response.ok) throw new Error(`Cannot load audio ${name}: ${response.status}`);
      const bytes = await response.arrayBuffer();
      signal?.throwIfAborted();
      // Reuse an authored-rate decoder: device-rate decoding would resample the clips.
      let decoder: BaseAudioContext | undefined = context?.sampleRate === entry.rate ? context : undefined;
      if (!decoder) {
        const key = `${entry.rate}:${entry.channels}`;
        decoder = this.decoders.get(key);
        if (!decoder) {
          const offline = new OfflineAudioContext(entry.channels, 1, entry.rate);
          this.decoders.set(key, offline);
          decoder = offline;
        }
      }
      const buffer = await decoder.decodeAudioData(bytes);
      // decodeAudioData cannot be canceled; discard a completed decode after disposal.
      signal?.throwIfAborted();
      if (name.startsWith('music/')) {
        const pcm = new Float32Array(entry.frames * 2),
          left = buffer.getChannelData(0),
          right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
        for (let i = 0; i < entry.frames; ++i) {
          pcm[i * 2] = left[i] ?? 0;
          pcm[i * 2 + 1] = right[i] ?? 0;
        }
        this.setMusic(name, { pcm, frames: entry.frames, rate: entry.rate });
      } else {
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)),
          pcm = new Int16Array(entry.frames);
        for (let i = 0; i < entry.frames; ++i) {
          let sum = 0;
          for (const channel of channels)
            sum += Math.max(-32768, Math.min(32767, Math.floor((channel[i] ?? 0) * 32768 + 0.5)));
          pcm[i] = Math.trunc(sum / channels.length);
        }
        // Some browser Vorbis decoders omit up to the final 256 authored samples.
        // Restore only that missing suffix; keep every decoded sample unchanged.
        const ending = this.endings?.clips[name];
        if (ending && buffer.length < entry.frames) {
          const bytes = Uint8Array.from(atob(ending), (character) => character.charCodeAt(0)),
            frames = Math.min(this.endings!.frames, entry.frames),
            begin = entry.frames - frames;
          if (bytes.byteLength === frames * 2) {
            const tail = new DataView(bytes.buffer);
            for (let i = Math.max(buffer.length, begin); i < entry.frames; ++i)
              pcm[i] = tail.getInt16((i - begin) * 2, true);
          }
        }
        this.setClip(name, pcm, entry.rate);
      }
    });
    this.loading.set(name, task);
    try {
      await task;
    } finally {
      this.loading.delete(name);
    }
  }
  async loadEffects(
    context?: BaseAudioContext,
    base = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/`,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    if (this.effectsLoading) return this.effectsLoading;
    const effects = this.entries.filter((entry) => !entry.name.startsWith('music/'));
    const task = (async () => {
      let next = 0,
        failed = false,
        failure: unknown;
      // Bound the entire fetch/decode operation, not just the network request.
      await Promise.all(
        Array.from({ length: Math.min(4, effects.length) }, async () => {
          while (!signal?.aborted && next < effects.length) {
            const entry = effects[next++];
            try {
              await this.load(context, entry.name, base, signal);
            } catch (error) {
              if (!failed) failure = error;
              failed = true;
            }
          }
        }),
      );
      // Let active workers settle before a caller retries the missing clips.
      if (failed) throw failure;
    })();
    this.effectsLoading = task;
    try {
      await task;
    } finally {
      this.effectsLoading = undefined;
    }
  }
  snapshot(): {
    clips: { name: string; pcm: Int16Array; rate: number }[];
    tracks: { name: string; track: MusicTrack }[];
  } {
    return {
      clips: [...this.clips]
        .filter(([, clip]) => clip.pcm)
        .map(([name, clip]) => ({ name, pcm: clip.pcm!, rate: clip.rate })),
      tracks: [...this.tracks].map(([name, track]) => ({ name, track })),
    };
  }
}
export const sounds = new SoundLibrary();
