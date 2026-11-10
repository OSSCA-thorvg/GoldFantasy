// Native speech timing and selection, with appended recorded weather reactions.
import { Activity, type Person } from '../../engine/src/person';
import { appearanceOf, Mood } from '../../engine/src/person-look';
import { f32 as f, hash01 } from '../../engine/src/numeric';
import { VoiceKind, VoiceLine } from './sound-types';
import {
  characterVoicePitch,
  voiceKind,
  voiceLine,
  voiceSample,
  voiceTakes,
  voiceWords,
} from './spoken-voice';
interface Syllable {
  begin: number;
  end: number;
  bytes: number;
  sounded: boolean;
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const smoothstep = (x: number): number => {
  x = Math.max(0, Math.min(1, f(x)));
  return f(f(x * x) * f(3 - f(2 * x)));
};
const randomDelay = (seed: number, seconds: number): number =>
  f(7 + f(hash01(seed, Math.trunc(Math.max(0, seconds)), 0, 0x501ce) * 7));
const words = [
  'Hmm.',
  'Ha, good!',
  'Hah!',
  'Ugh!',
  'Haaah.',
  'Hmm.',
  'Hmm, where was I...',
  'Yes?',
  'Aye!',
  'Hup!',
  'Haaah... mmh.',
  'Mmm...',
  'Not again.',
  'Thank you!',
  'To arms!',
  'Ugh...',
  'Oh, rain again.',
  'Brr, so cold.',
  'Oh my God!',
];
export class PersonSpeech {
  static readonly maxCharacters = 160;
  private words = '';
  private syllables: Syllable[] = [];
  private started = -1;
  private length = 0;
  private nextUtterance = -1;
  private previous = Activity.Idle;
  private observed = false;
  private serial = 0n;
  private sound = VoiceLine.None;
  private speaker = VoiceKind.Huntress;
  private take = 0;
  private pitch = 1;
  say(text: string | VoiceLine, seconds: number, rate = 1, voice = VoiceKind.Huntress, pick = -1): boolean {
    rate = f(rate);
    if (typeof text === 'string') {
      const line = voiceLine(text),
        takes = voiceTakes(line, voice);
      return this.speak(
        text,
        line,
        seconds,
        rate,
        voice,
        takes > 1
          ? Math.trunc(
              f(
                hash01(Number(BigInt.asUintN(32, this.serial)), Math.trunc(seconds * 1000), 1, 0x7a4e) *
                  takes,
              ),
            ) % takes
          : 0,
      );
    }
    const takes = voiceTakes(text, voice);
    if (text <= VoiceLine.None || text >= VoiceLine.Count || !takes) return false;
    if (pick < 0 || pick >= takes)
      pick =
        Math.trunc(
          f(hash01(Number(BigInt.asUintN(32, this.serial)), Math.trunc(seconds * 1000), 2, 0x7a4e) * takes),
        ) % takes;
    return this.speak(voiceWords(text, voice, pick) || words[text] || '', text, seconds, rate, voice, pick);
  }
  private speak(
    text: string,
    line: VoiceLine,
    seconds: number,
    rate: number,
    voice: VoiceKind,
    pick: number,
  ): boolean {
    const bytes = encoder.encode(text);
    if (
      !Number.isFinite(seconds) ||
      !Number.isFinite(rate) ||
      rate < f(0.5) ||
      rate > 2 ||
      !text ||
      bytes.length > PersonSpeech.maxCharacters * 4 ||
      decoder.decode(bytes) !== text
    )
      return false;
    const next: Syllable[] = [];
    let at = 0.16,
      sounded = false,
      offset = 0;
    for (const char of text) {
      if (next.length === PersonSpeech.maxCharacters) return false;
      const cp = char.codePointAt(0)!;
      offset += encoder.encode(char).length;
      let span = f(0.09),
        soundedUnit = true;
      const lower = cp >= 65 && cp <= 90 ? cp + 32 : cp;
      if (cp < 32 || cp === 127) return false;
      if (cp === 32 || cp === 9) {
        span = f(0.045);
        soundedUnit = false;
      } else if (cp === 46 || cp === 44 || cp === 33 || cp === 63 || cp === 0x2026) {
        span = f(cp === 44 ? 0.18 : cp === 0x2026 ? 0.48 : 0.28);
        soundedUnit = false;
      } else {
        sounded = true;
        if ([97, 104, 111, 117, 119].includes(lower)) span = f(0.13);
      }
      next.push({ begin: at, end: at + span, bytes: offset, sounded: soundedUnit });
      at += span;
    }
    if (!sounded) return false;
    if (line !== VoiceLine.None && line !== VoiceLine.Murmur) {
      let voicedEnd = 0.16;
      for (const unit of next) if (unit.sounded) voicedEnd = unit.end;
      const span = voiceSample(line, voice, pick).duration() / rate,
        factor = span / Math.max(0.001, voicedEnd - 0.16);
      const remap = (time: number) =>
        time <= voicedEnd ? 0.16 + (time - 0.16) * factor : time + 0.16 + span - voicedEnd;
      for (const unit of next) {
        unit.begin = remap(unit.begin);
        unit.end = remap(unit.end);
      }
      at = next.at(-1)!.end;
    }
    this.words = text;
    this.serial = BigInt.asUintN(64, this.serial + 1n);
    this.syllables = next;
    this.started = seconds;
    this.sound = line;
    this.speaker = voice;
    this.take = pick;
    this.pitch = rate;
    this.length = at;
    this.nextUtterance = seconds + this.length + 9;
    return true;
  }
  stop(): void {
    this.serial = BigInt.asUintN(64, this.serial + 1n);
    this.started = -1;
    this.words = '';
    this.syllables = [];
    this.length = 0;
    this.sound = VoiceLine.None;
  }
  playing(seconds: number): boolean {
    return this.started >= 0 && seconds >= this.started && seconds < this.started + this.length + 0.2;
  }
  update(person: Person, mood: Mood, seconds: number, automatic = true): void {
    if (!Number.isFinite(seconds)) return;
    const attack =
      (!this.observed || this.previous !== Activity.Fighting) && person.activity === Activity.Fighting;
    this.previous = person.activity;
    this.observed = true;
    if (this.nextUtterance < 0) this.nextUtterance = seconds + randomDelay(person.look, person.id);
    if (!automatic || this.playing(seconds) || (!attack && seconds < this.nextUtterance)) return;
    const roll = hash01(person.look, Math.trunc(seconds), person.id, 0x5a1d);
    let line = roll < f(0.45) ? VoiceLine.Hmm : roll < f(0.75) ? VoiceLine.Mumble : VoiceLine.Ahh;
    if (mood === Mood.Fierce) line = VoiceLine.Attack;
    else if (mood === Mood.Hurt) line = VoiceLine.Hut;
    else if (mood === Mood.Tired || mood === Mood.Exhausted)
      line = roll < f(0.55) ? VoiceLine.Phew : VoiceLine.Yawn;
    else if (mood === Mood.Hungry) line = VoiceLine.Complain;
    else if (mood === Mood.Stressed) line = roll < f(0.5) ? VoiceLine.Phew : VoiceLine.Complain;
    else if (mood === Mood.Cheerful) line = roll < f(0.6) ? VoiceLine.Ahh : VoiceLine.Hmm;
    else if (mood === Mood.Asleep) line = VoiceLine.Sleep;
    const voice = voiceKind(appearanceOf(person).bodyType, person.look, person.id);
    if (this.say(line, seconds, characterVoicePitch(person.look, person.id), voice))
      this.nextUtterance =
        seconds + this.length + f(randomDelay(person.look, seconds) * (mood === Mood.Asleep ? 6 : 1));
  }
  caption(seconds: number): string {
    if (this.started < 0 || seconds < this.started || seconds >= this.started + this.length + 1.2) return '';
    let count = 0;
    const t = seconds - this.started;
    for (const unit of this.syllables) {
      if (t < unit.begin) break;
      count = unit.bytes;
    }
    return decoder.decode(encoder.encode(this.words).subarray(0, count));
  }
  captionOpacity(seconds: number): number {
    if (this.started < 0) return 0;
    const t = f(seconds - this.started);
    return f(smoothstep(f(t / f(0.14))) * f(1 - smoothstep(f(f(f(t - f(this.length)) - f(0.8)) / f(0.4)))));
  }
  duration(): number {
    return this.length;
  }
  text(): string {
    return this.words;
  }
  sequence(): bigint {
    return this.serial;
  }
  startedAt(): number {
    return this.started;
  }
  voice(): VoiceLine {
    return this.sound;
  }
  voiceKind(): VoiceKind {
    return this.speaker;
  }
  voiceTake(): number {
    return this.take;
  }
  voicePitch(): number {
    return this.pitch;
  }
  voiceDuration(): number {
    return this.sound === VoiceLine.Murmur
      ? Math.max(0, this.length - 0.16)
      : voiceSample(this.sound, this.speaker, this.take).duration() / this.pitch;
  }
}
