// Native sound_library.cpp semantics. Browser decoding is confined to the host loader.
// Rates/frame counts/captions are captured from the immutable native assets with stb_vorbis.
import manifest from './data/audio-manifest.json';
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
export class SoundLibrary {
  readonly entries = manifest;
  private clips = new Map<string, Clip>();
  private tracks = new Map<string, MusicTrack>();
  private loading = new Map<string, Promise<void>>();
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
    context: BaseAudioContext,
    name: string,
    base = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/`,
  ): Promise<void> {
    if (this.clips.has(name) || this.tracks.has(name)) return;
    const existing = this.loading.get(name);
    if (existing) return existing;
    const entry = this.entries.find((entry) => entry.name === name);
    if (!entry) return;
    const task = (async () => {
      const response = await fetch(base + name + '.ogg');
      if (!response.ok) throw new Error(`Cannot load audio ${name}: ${response.status}`);
      // An OfflineAudioContext at the authored rate prevents browser output-rate resampling.
      const decoder =
        context.sampleRate === entry.rate ? context : new OfflineAudioContext(entry.channels, 1, entry.rate);
      const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
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
        this.setClip(name, pcm, entry.rate);
      }
    })();
    this.loading.set(name, task);
    try {
      await task;
    } finally {
      this.loading.delete(name);
    }
  }
  async loadEffects(
    _context?: BaseAudioContext,
    base = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/`,
  ): Promise<void> {
    const response = await fetch(base + 'native-effects.pcm.gz');
    if (!response.ok) throw new Error(`Cannot load native sound samples: ${response.status}`);
    // Static hosts may set Content-Encoding:gzip for .gz assets; fetch already decodes that.
    const received = await response.arrayBuffer();
    const header = new Uint8Array(received, 0, Math.min(2, received.byteLength));
    const bytes =
      header[0] === 0x1f && header[1] === 0x8b
        ? await new Response(
            new Blob([received]).stream().pipeThrough(new DecompressionStream('gzip')),
          ).arrayBuffer()
        : received;
    for (const entry of this.entries)
      if ('pcmOffset' in entry)
        this.setClip(entry.name, new Int16Array(bytes, entry.pcmOffset!, entry.frames), entry.rate);
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
