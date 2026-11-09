// Translated from src/game/effect_manager.cpp; capacities and rejection order are unchanged.
import { Cue, Sound, SpeechChannel, type VoiceKind, type VoiceLine } from './sound-types';
export interface EffectStatistics {
  effects: number;
  speech: number;
  selectedSpeech: number;
  nearbySpeech: number;
  accepted: number;
  dropped: number;
  replaced: number;
}
interface Slot {
  token: bigint;
  cue: Cue;
  speaker: number;
  priority: number;
}
const slot = (): Slot => ({ token: 0n, cue: Cue.Place, speaker: -2, priority: 0 });
const statistics = (): EffectStatistics => ({
  effects: 0,
  speech: 0,
  selectedSpeech: 0,
  nearbySpeech: 0,
  accepted: 0,
  dropped: 0,
  replaced: 0,
});
function priority(cue: Cue): number {
  switch (cue) {
    case Cue.Alarm:
      return 10;
    case Cue.Click:
    case Cue.Order:
    case Cue.Refuse:
    case Cue.Open:
      return 8;
    case Cue.Notice:
    case Cue.Complete:
    case Cue.Growth:
    case Cue.Discover:
    case Cue.Unseal:
    case Cue.ThunderCrack:
    case Cue.ThunderStrike:
      return 6;
    case Cue.Place:
    case Cue.Demolish:
    case Cue.Howl:
    case Cue.TreeFall:
    case Cue.Coins:
    case Cue.ThunderClap:
    case Cue.ThunderRumble:
      return 4;
    default:
      return 2;
  }
}
function interval(cue: Cue): number {
  switch (cue) {
    case Cue.Click:
      return 0.04;
    case Cue.Order:
    case Cue.Place:
    case Cue.Open:
      return 0.08;
    case Cue.Refuse:
      return 0.2;
    case Cue.Notice:
    case Cue.Complete:
      return 0.3;
    case Cue.Growth:
    case Cue.Coins:
    case Cue.Discover:
    case Cue.Unseal:
      return 0.5;
    case Cue.Alarm:
    case Cue.Howl:
      return 1;
    case Cue.Speech:
      return 0.25;
    case Cue.Chop:
    case Cue.Mine:
    case Cue.Hammer:
      return 0.12;
    case Cue.TreeFall:
      return 0.4;
    case Cue.Raven:
      return 4;
    case Cue.Pig:
      return 1.25;
    case Cue.Chicken:
      return 1.5;
    case Cue.Dog:
      return 2;
    case Cue.ThunderCrack:
    case Cue.ThunderStrike:
    case Cue.ThunderClap:
    case Cue.ThunderRumble:
      return 1.5;
    default:
      return 0.1;
  }
}
const interaction = (cue: Cue): boolean =>
  cue === Cue.Click || cue === Cue.Order || cue === Cue.Place || cue === Cue.Refuse || cue === Cue.Open;
const thunder = (cue: Cue): boolean => cue >= Cue.ThunderCrack && cue <= Cue.ThunderRumble;
export class EffectManager {
  static readonly maxEffects = 8;
  static readonly maxSelectedSpeech = 1;
  static readonly maxNearbySpeech = 2;
  static readonly maxSpeech = 3;
  static readonly maxConcurrent = 11;
  private slots: Slot[] = Array.from({ length: EffectManager.maxConcurrent }, slot);
  private nextAllowed = new Float64Array(256);
  private nextSpeechAllowed = new Float64Array(EffectManager.maxSpeech);
  private now = 0;
  private serial = 1n;
  private totals = statistics();
  constructor(private readonly voiceFrames: (line: VoiceLine, voice: VoiceKind, take: number) => number) {}
  request(sound: Sound): bigint {
    if (sound.cue === Cue.SpeechStop) {
      this.stopSpeech(sound.speaker);
      return 0n;
    }
    const reject = () => {
      ++this.totals.dropped;
      return 0n;
    };
    if (
      sound.cue === Cue.Music ||
      (sound.cue & 0xff) >= Cue.Count ||
      !Number.isFinite(sound.gain) ||
      sound.gain <= 0 ||
      !Number.isFinite(sound.pan)
    )
      return reject();
    const key = sound.cue;
    let chosen = -1,
      previous = -1;
    if (sound.cue === Cue.Speech) {
      if (
        sound.speaker < -1 ||
        !this.voiceFrames(sound.line, sound.voice, sound.take) ||
        !Number.isFinite(sound.pitch) ||
        sound.pitch <= 0 ||
        !Number.isFinite(sound.duration) ||
        sound.duration <= 0 ||
        !Number.isFinite(sound.offset) ||
        sound.offset < 0 ||
        sound.offset >= sound.duration ||
        !Number.isFinite(sound.delay) ||
        sound.delay < 0 ||
        (sound.speechChannel !== SpeechChannel.Selected && sound.speechChannel !== SpeechChannel.Nearby)
      )
        return reject();
      const first =
        EffectManager.maxEffects +
        (sound.speechChannel === SpeechChannel.Selected ? 0 : EffectManager.maxSelectedSpeech);
      const last =
        first +
        (sound.speechChannel === SpeechChannel.Selected
          ? EffectManager.maxSelectedSpeech
          : EffectManager.maxNearbySpeech);
      for (let i = EffectManager.maxEffects; i < EffectManager.maxConcurrent; ++i)
        if (this.slots[i].token && this.slots[i].speaker === sound.speaker) previous = i;
      for (let i = first; i < last; ++i) {
        if (i === previous) {
          chosen = previous;
          break;
        }
        if (
          chosen < 0 &&
          !this.slots[i].token &&
          this.now + 1e-9 >= this.nextSpeechAllowed[i - EffectManager.maxEffects]
        )
          chosen = i;
      }
      if (chosen < 0) return reject();
    } else {
      if (this.now + 1e-9 < this.nextAllowed[key]) return reject();
      let same = 0,
        oldest = -1;
      for (let i = 0; i < EffectManager.maxEffects; ++i) {
        const s = this.slots[i];
        if (!s.token && chosen < 0) chosen = i;
        if (s.token && s.cue === sound.cue) {
          ++same;
          if (oldest < 0 || s.token < this.slots[oldest].token) oldest = i;
        }
      }
      const limit =
        interaction(sound.cue) ||
        sound.cue === Cue.Alarm ||
        sound.cue === Cue.Howl ||
        sound.cue === Cue.TreeFall ||
        sound.cue === Cue.Raven ||
        sound.cue === Cue.Pig ||
        sound.cue === Cue.Chicken ||
        sound.cue === Cue.Dog ||
        sound.cue === Cue.Growth ||
        thunder(sound.cue)
          ? 1
          : 2;
      if (same >= limit) {
        if (!interaction(sound.cue)) return reject();
        chosen = oldest;
      }
      if (chosen < 0) {
        let lowest = 0;
        for (let i = 1; i < EffectManager.maxEffects; ++i) {
          const a = this.slots[i],
            b = this.slots[lowest];
          if (a.priority < b.priority || (a.priority === b.priority && a.token < b.token)) lowest = i;
        }
        if (priority(sound.cue) <= this.slots[lowest].priority) return reject();
        chosen = lowest;
      }
    }
    if (this.slots[chosen].token || previous >= 0) ++this.totals.replaced;
    if (previous >= 0 && previous !== chosen) this.slots[previous] = slot();
    let token = this.serial;
    this.serial = BigInt.asUintN(64, this.serial + 1n);
    if (!token) {
      token = this.serial;
      this.serial = BigInt.asUintN(64, this.serial + 1n);
    }
    this.slots[chosen] = { token, cue: sound.cue, speaker: sound.speaker, priority: priority(sound.cue) };
    if (sound.cue === Cue.Speech)
      this.nextSpeechAllowed[chosen - EffectManager.maxEffects] = this.now + interval(sound.cue);
    else this.nextAllowed[key] = this.now + interval(sound.cue);
    ++this.totals.accepted;
    return token;
  }
  active(token: bigint): boolean {
    return !!token && this.slots.some((s) => s.token === token);
  }
  finish(token: bigint): void {
    const i = this.slots.findIndex((s) => !!token && s.token === token);
    if (i >= 0) this.slots[i] = slot();
  }
  stopSpeech(speaker = -2): void {
    for (let i = EffectManager.maxEffects; i < EffectManager.maxConcurrent; ++i) {
      if (speaker !== -2 && this.slots[i].speaker !== speaker) continue;
      this.slots[i] = slot();
      this.nextSpeechAllowed[i - EffectManager.maxEffects] = this.now;
    }
  }
  advance(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.now += seconds;
  }
  clear(): void {
    this.slots = Array.from({ length: EffectManager.maxConcurrent }, slot);
    this.nextAllowed.fill(0);
    this.nextSpeechAllowed.fill(0);
    this.now = 0;
    this.totals = statistics();
  }
  statistics(): EffectStatistics {
    const result = { ...this.totals };
    for (let i = 0; i < EffectManager.maxEffects; ++i) result.effects += Number(!!this.slots[i].token);
    for (let i = EffectManager.maxEffects; i < EffectManager.maxConcurrent; ++i) {
      if (!this.slots[i].token) continue;
      ++result.speech;
      if (i < EffectManager.maxEffects + EffectManager.maxSelectedSpeech) ++result.selectedSpeech;
      else ++result.nearbySpeech;
    }
    return result;
  }
}
