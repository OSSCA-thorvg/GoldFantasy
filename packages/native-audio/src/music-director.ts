// Translated from src/game/music_director.cpp.
export enum Moment {
  Dawn,
  Dusk,
  Battle,
  Build,
}
export interface MusicLibrary {
  count(folder: string): number;
  name(folder: string, index: number): string;
  duration(track: string): number | undefined;
}
const folders = ['music/dawn/', 'music/dusk/', 'music/battle/', 'music/build/'];
const chances = [Math.fround(0.75), Math.fround(0.75), 0, Math.fround(0.45)];
export class MusicDirector {
  private state: number;
  private until = -1;
  private quietUntil = 30;
  private last = [-1, -1, -1, -1];
  constructor(
    private readonly sounds: MusicLibrary,
    seed = 1,
  ) {
    this.state = (Math.imul(seed, 2654435761) + 0x9e3779b9) >>> 0;
  }
  private roll(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return (this.state >>> 8) / 16777216;
  }
  playing(seconds: number): boolean {
    return seconds < this.until;
  }
  moment(moment: Moment, seconds: number): string {
    const kind = moment;
    if (kind < 0 || kind >= folders.length) return '';
    if (moment === Moment.Battle) return '';
    if (this.playing(seconds) || seconds < this.quietUntil || this.roll() >= chances[kind]) return '';
    const tracks = this.sounds.count(folders[kind]);
    if (!tracks) return '';
    let pick = Math.trunc(Math.fround(this.roll() * Math.fround(tracks))) % tracks;
    if (tracks > 1 && pick === this.last[kind]) pick = (pick + 1) % tracks;
    this.last[kind] = pick;
    const track = this.sounds.name(folders[kind], pick);
    this.until = seconds + (this.sounds.duration(track) ?? 72);
    this.quietUntil = this.until + 100 + Math.fround(140 * this.roll());
    return track;
  }
}
