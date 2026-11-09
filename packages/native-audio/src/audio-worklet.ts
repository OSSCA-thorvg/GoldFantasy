// Platform adapter only. The unchanged game mixer runs on the browser audio thread.
import { SoundBoard, Playback } from './sound-board';
import { sounds, type MusicTrack, type LoadedClip } from './sound-library';
import type { Sound, Ambience } from './sound-types';
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
type Message =
  | {
      kind: 'init';
      clips: { name: string; pcm: Int16Array; rate: number }[];
      tracks: { name: string; track: MusicTrack }[];
    }
  | { kind: 'clips'; clips: LoadedClip[] }
  | { kind: 'music'; name: string; track: MusicTrack; sound: Sound }
  | { kind: 'play'; sound: Sound }
  | { kind: 'ambience'; ambience: Ambience }
  | { kind: 'fadeIn' | 'fadeOut'; seconds: number }
  | { kind: 'playback'; state: Playback }
  | { kind: 'dispose' };
class NativeMixer extends AudioWorkletProcessor {
  private board: SoundBoard | null = null;
  private disposed = false;
  private buffer = new Float32Array(256);
  constructor() {
    super();
    this.port.onmessage = ({ data }: { data: Message }) => {
      if (data.kind === 'init') {
        for (const clip of data.clips) sounds.setClip(clip.name, clip.pcm, clip.rate);
        for (const row of data.tracks) sounds.setMusic(row.name, row.track);
        this.board = new SoundBoard();
        this.port.postMessage({ kind: 'ready' });
        return;
      }
      if (data.kind === 'clips') {
        for (const clip of data.clips) sounds.setClip(clip.name, clip.pcm, clip.rate);
        return;
      }
      if (data.kind === 'dispose') {
        this.board?.playback(Playback.Stopped);
        this.disposed = true;
        return;
      }
      if (!this.board) return;
      switch (data.kind) {
        case 'music':
          sounds.setMusic(data.name, data.track);
          this.board.play(data.sound);
          break;
        case 'play':
          this.board.play(data.sound);
          break;
        case 'ambience':
          this.board.setAmbience(data.ambience);
          break;
        case 'fadeIn':
          this.board.fadeIn(data.seconds);
          break;
        case 'fadeOut':
          this.board.fadeOut(data.seconds);
          break;
        case 'playback':
          this.board.playback(data.state);
          break;
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0];
    if (!channels?.length) return !this.disposed;
    const frames = channels[0].length;
    if (this.buffer.length !== frames * 2) this.buffer = new Float32Array(frames * 2);
    if (this.board && !this.disposed) this.board.render(this.buffer, frames);
    else this.buffer.fill(0);
    for (let i = 0; i < frames; ++i) {
      channels[0][i] = this.buffer[i * 2];
      if (channels[1]) channels[1][i] = this.buffer[i * 2 + 1];
    }
    return !this.disposed;
  }
}
registerProcessor('goldfantasy-native-mixer', NativeMixer);
