// Direct translation of music_score.cpp. The procedural bard score, modes and instruments are unchanged.
import { f32 as f, clamp } from '../../engine/src/numeric';
export interface MusicMood {
  dark: number;
  winter: number;
  rain: number;
  raid: number;
}
export enum Instrument {
  Lute,
  Harp,
  Flute,
  Strings,
  Bells,
  Brass,
  Drum,
  Shaker,
  Tom,
}
const I = Instrument,
  ionian = [0, 2, 4, 5, 7, 9, 11],
  dorian = [0, 2, 3, 5, 7, 9, 10],
  phrygian = [0, 1, 3, 5, 7, 8, 10],
  mixolydian = [0, 2, 4, 5, 7, 9, 10],
  aeolian = [0, 2, 3, 5, 7, 8, 10];
interface Piece {
  name: string;
  root: number;
  mode: number[];
  progression: number[];
  tempo: number;
  lead: Instrument;
  accompaniment: Instrument;
  pad: boolean;
  bass: boolean;
  drum: boolean;
  shaker: boolean;
  dark: number;
  winter: number;
  rain: number;
  war: boolean;
}
const make = (
  name: string,
  root: number,
  mode: number[],
  progression: number[],
  tempo: number,
  lead: Instrument,
  accompaniment: Instrument,
  pad: boolean,
  bass: boolean,
  drum: boolean,
  shaker: boolean,
  dark: number,
  winter: number,
  rain: number,
  war: boolean,
): Piece => ({
  name,
  root,
  mode,
  progression,
  tempo,
  lead,
  accompaniment,
  pad,
  bass,
  drum,
  shaker,
  dark: f(dark),
  winter: f(winter),
  rain: f(rain),
  war,
});
const pieces: Piece[] = [
  make(
    'Hearthfire',
    0,
    dorian,
    [0, 6, 4, 3, 0, 6, 3, 4],
    76,
    I.Lute,
    I.Strings,
    true,
    true,
    false,
    false,
    0.3,
    0.4,
    0.4,
    false,
  ),
  make(
    'Market Day',
    5,
    mixolydian,
    [0, 0, 6, 3, 0, 4, 6, 0],
    104,
    I.Lute,
    I.Harp,
    false,
    true,
    true,
    true,
    0,
    0,
    0,
    false,
  ),
  make(
    'Summer Fields',
    7,
    ionian,
    [0, 3, 4, 0, 5, 3, 4, 4],
    88,
    I.Flute,
    I.Harp,
    true,
    true,
    false,
    true,
    0,
    0,
    0,
    false,
  ),
  make(
    "Pilgrim's Road",
    2,
    dorian,
    [0, 3, 0, 6, 0, 3, 4, 0],
    84,
    I.Flute,
    I.Lute,
    false,
    true,
    true,
    false,
    0.2,
    0.2,
    0.1,
    false,
  ),
  make(
    'Evening Bells',
    2,
    aeolian,
    [0, 5, 2, 6, 0, 3, 4, 0],
    66,
    I.Bells,
    I.Harp,
    true,
    true,
    false,
    false,
    0.55,
    0.4,
    0.2,
    false,
  ),
  make(
    'Nocturne',
    -3,
    aeolian,
    [0, 5, 3, 4, 0, 5, 3, 0],
    54,
    I.Flute,
    I.Harp,
    true,
    false,
    false,
    false,
    1,
    0.5,
    0.3,
    false,
  ),
  make(
    'Moonlit Watch',
    5,
    aeolian,
    [0, 6, 5, 6, 0, 3, 4, 4],
    58,
    I.Harp,
    I.Strings,
    true,
    false,
    false,
    false,
    0.9,
    0.3,
    0.2,
    false,
  ),
  make(
    'Winter Hearth',
    0,
    aeolian,
    [0, 5, 6, 0, 3, 5, 4, 4],
    60,
    I.Bells,
    I.Strings,
    true,
    true,
    false,
    false,
    0.5,
    1,
    0.4,
    false,
  ),
  make(
    'Rain on Thatch',
    3,
    dorian,
    [0, 3, 0, 6, 0, 3, 4, 4],
    62,
    I.Lute,
    I.Strings,
    true,
    true,
    false,
    false,
    0.4,
    0.3,
    1,
    false,
  ),
  make(
    'Raiders',
    0,
    phrygian,
    [0, 1, 0, 6, 0, 1, 5, 4],
    120,
    I.Brass,
    I.Tom,
    true,
    true,
    true,
    false,
    0,
    0,
    0,
    true,
  ),
];
const barRhythms = [
  [2, 2, 2, 2],
  [3, 1, 2, 2],
  [4, 2, 2],
  [2, 2, 4],
  [1, 1, 2, 4],
  [6, 2],
  [2, 1, 1, 2, 2],
  [4, 4],
  [8],
];
const table = Float32Array.from({ length: 4097 }, (_, i) => Math.sin((6.283185307179586 * i) / 4096));
function sine(cycles: number): number {
  const at = (cycles - Math.floor(cycles)) * 4096,
    i = Math.trunc(at),
    t = f(at - i);
  return f(table[i] + f(f(table[i + 1] - table[i]) * t));
}
const hz = (semitones: number) => f(f(146.83) * f(Math.pow(2, f(semitones / 12))));
class Tone {
  kind = I.Lute;
  frequency = 0;
  gain = 0;
  pan = 0;
  length = 0;
  left = 0;
  right = 0;
  start = 0;
  phase = [0, 0, 0, 0];
  filter = 0;
  string = new Float32Array();
  at = 0;
}
interface Motif {
  rhythm: number[];
  steps: number[];
  notes: number;
}
const motif = (): Motif => ({ rhythm: Array(8).fill(0), steps: Array(8).fill(0), notes: 0 });
export class Score {
  private clock = 0;
  private current = -1;
  private previous = -1;
  private beatAt = 0;
  private nextEighth = 0;
  private fade = 0;
  private fadeTarget = 1;
  private ending = false;
  private silentUntil = 0;
  private bars = 0;
  private motifs = [motif(), motif()];
  private degree = 0;
  private tones: Tone[] = [];
  private roomLeft: Float32Array;
  private roomRight: Float32Array;
  private roomAt = 0;
  private roomToneLeft = 0;
  private roomToneRight = 0;
  private seed = 0x2545f491;
  constructor(private rate: number) {
    this.roomLeft = new Float32Array(Math.trunc(f(rate * f(0.031))));
    this.roomRight = new Float32Array(Math.trunc(f(rate * f(0.037))));
  }
  piece(): number {
    return this.current;
  }
  static pieceName(index: number): string {
    return pieces[index]?.name ?? '';
  }
  static warlike(index: number): boolean {
    return pieces[index]?.war ?? false;
  }
  private noise(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return f(f((this.seed >>> 8) / 8388608) - 1);
  }
  private pitchOf(degree: number): number {
    const p = pieces[this.current],
      octave = Math.floor(f(degree / 7));
    return f(p.root + octave * 12 + p.mode[degree - octave * 7]);
  }
  private choose(mood: MusicMood): void {
    const war = mood.raid > f(0.5),
      weights = new Float32Array(pieces.length);
    let total = 0;
    for (let i = 0; i < pieces.length; ++i) {
      const p = pieces[i];
      if (p.war !== war || (i === this.previous && !war)) continue;
      const distance = f(
        f(f(Math.abs(f(p.dark - mood.dark)) * f(1.2)) + f(Math.abs(f(p.winter - mood.winter)) * f(0.9))) +
          f(Math.abs(f(p.rain - mood.rain)) * f(0.8)),
      );
      weights[i] = Math.exp(f(-5 * distance));
      total = f(total + weights[i]);
    }
    let pick = f(f(f(this.noise() * f(0.5)) + f(0.5)) * total);
    this.current = 0;
    for (let i = 0; i < pieces.length; ++i) {
      if (weights[i] <= 0) continue;
      this.current = i;
      pick = f(pick - weights[i]);
      if (pick <= 0) break;
    }
    this.previous = this.current;
  }
  private compose(): void {
    const p = pieces[this.current];
    this.bars = (3 + Math.trunc(f(Math.abs(this.noise()) * 2))) * 8;
    const slow = p.tempo < 70;
    this.motifs = [motif(), motif()];
    for (const m of this.motifs)
      for (let bar = 0; bar < 2; ++bar) {
        let rhythm: number[] | null = null;
        for (let attempt = 0; attempt < 8; ++attempt) {
          const candidate =
            barRhythms[Math.trunc(f(Math.abs(this.noise()) * barRhythms.length)) % barRhythms.length];
          if (m.notes + candidate.length > 8 || (slow && candidate.length > 3)) continue;
          rhythm = candidate;
          break;
        }
        rhythm ??= barRhythms.at(-1)!;
        for (const length of rhythm) {
          m.rhythm[m.notes] = length;
          const r = this.noise();
          m.steps[m.notes] = m.notes === 0 ? 0 : Math.abs(r) < f(0.7) ? (r < 0 ? -1 : 1) : r < 0 ? -2 : 3;
          ++m.notes;
        }
      }
    this.degree = 4;
  }
  private play(kind: Instrument, semitones: number, gain: number, beats: number, pan: number): void {
    gain = f(gain);
    beats = f(beats);
    pan = f(pan);
    if (this.tones.length >= 40) this.tones.shift();
    const t = new Tone();
    t.kind = kind;
    t.frequency = hz(semitones);
    t.gain = gain;
    t.pan = pan;
    const angle = f(f(clamp(pan, -1, 1) + 1) * f(0.7853982));
    t.left = f(Math.cos(angle));
    t.right = f(Math.sin(angle));
    t.length = f(f(beats * 60) / pieces[this.current].tempo);
    t.start = this.clock;
    if (kind === I.Lute || kind === I.Harp) {
      t.string = new Float32Array(Math.max(2, Math.trunc(f(this.rate / t.frequency))));
      let soft = 0;
      for (let i = 0; i < t.string.length; ++i) {
        soft = f(soft + f(f(kind === I.Lute ? 0.45 : 0.8) * f(this.noise() - soft)));
        t.string[i] = soft;
      }
    }
    this.tones.push(t);
  }
  private schedule(eighth: number): void {
    const p = pieces[this.current],
      index = Math.trunc(eighth),
      bar = Math.trunc(index / 8),
      step = index % 8;
    if (bar >= this.bars) {
      this.ending = true;
      this.fadeTarget = 0;
      return;
    }
    const chord = p.progression[bar % 8],
      lively = p.tempo > 80;
    if (step === 0 && p.pad)
      for (const t of [0, 2, 4])
        this.play(
          I.Strings,
          this.pitchOf(chord + t) - (p.war ? 12 : 0),
          0.011,
          8.6,
          t === 2 ? -0.3 : t === 4 ? 0.3 : 0,
        );
    if (p.bass && (step === 0 || (lively && step === 4)))
      this.play(I.Lute, this.pitchOf(chord + (step === 4 ? 4 : 0)) - 12, 0.07, 4, -0.15);
    switch (p.accompaniment) {
      case I.Harp:
        if (p.tempo >= 70 || step % 2 === 0)
          this.play(I.Harp, this.pitchOf(chord + [0, 2, 4, 7, 4, 2, 0, 2][step]), 0.03, 2, 0.35);
        break;
      case I.Lute:
        if ([0, 3, 4, 6].includes(step))
          this.play(
            I.Lute,
            this.pitchOf(chord + (step === 3 ? 4 : step === 6 ? 2 : step === 4 ? 4 : 0)),
            0.04,
            2,
            0.3,
          );
        break;
      case I.Tom:
        if (step !== 2 && step !== 5)
          this.play(I.Tom, 0, step % 4 === 0 ? 0.16 : 0.09, 1, step % 2 ? 0.2 : -0.2);
        break;
    }
    if (p.drum && (step === 0 || step === 3 || (lively && step === 6)))
      this.play(I.Drum, 0, step === 0 ? 0.14 : 0.08, 1, 0);
    if (p.shaker && step % 2 === 1) this.play(I.Shaker, 0, 0.022, 1, 0.45);
    const section = Math.trunc(bar / 8),
      pair = Math.trunc((bar % 8) / 2),
      span = (bar % 2) * 8 + step;
    if (pair === 3) {
      if (bar % 2 === 0 && (step === 0 || step === 4)) {
        const target = step === 0 ? chord + 2 : chord;
        this.play(p.lead, this.pitchOf(target) + 12, 0.065, f(4 * f(0.95)), -0.1);
      } else if (bar % 2 === 1 && step === 0) {
        this.degree = this.degree > 3 ? 7 : 0;
        this.play(p.lead, this.pitchOf(this.degree) + 12, 0.065, f(8 * f(0.95)), -0.1);
      }
      return;
    }
    const m = this.motifs[(section + (pair === 2 ? 1 : 0)) % 2];
    let onset = 0;
    for (let n = 0; n < m.notes; ++n) {
      if (onset === span) {
        this.degree += m.steps[n] + (pair === 1 && n === 0 ? 1 : 0);
        if (step === 0) {
          let best = this.degree,
            bestGap = 99;
          for (const t of [0, 2, 4, 7, 9]) {
            const candidate = chord + t;
            for (const shift of [-7, 0, 7])
              if (Math.abs(candidate + shift - this.degree) < bestGap) {
                bestGap = Math.abs(candidate + shift - this.degree);
                best = candidate + shift;
              }
          }
          this.degree = best;
        }
        if (this.degree > 10) this.degree -= 7;
        if (this.degree < -1) this.degree += 7;
        this.play(
          p.lead,
          this.pitchOf(this.degree) + 12,
          p.lead === I.Brass ? 0.05 : 0.065,
          f(f(m.rhythm[n] / 2) * f(0.95)),
          -0.1,
        );
        break;
      }
      onset += m.rhythm[n];
    }
  }
  private sound(t: Tone, now: number): number {
    const age = f(now - t.start),
      release = age > t.length ? f(age - t.length) : 0,
      advance = (partial: number, frequency: number) => {
        t.phase[partial] += f(frequency) / this.rate;
        return t.phase[partial];
      };
    switch (t.kind) {
      case I.Lute:
      case I.Harp: {
        const next = (t.at + 1) % t.string.length,
          v = t.string[t.at];
        t.string[t.at] = f(f(f(t.kind === I.Lute ? 0.996 : 0.998) * f(0.5)) * f(v + t.string[next]));
        t.at = next;
        return f(v * (release > 0 ? f(Math.exp(f(-release / f(0.6)))) : 1));
      }
      case I.Flute: {
        const vibrato = f(1 + f(f(f(0.006) * sine(age * 5.2)) * clamp(f(f(age - f(0.2)) / f(0.3)), 0, 1))),
          phase = advance(0, f(t.frequency * vibrato)),
          env = f(Math.min(1, f(age / f(0.08))) * f(Math.exp(f(-release / f(0.14)))));
        t.filter = f(t.filter + f(f(0.08) * f(this.noise() - t.filter)));
        return f(
          f(
            f(f(sine(phase) + f(f(0.22) * sine(phase * 2))) + f(f(0.06) * sine(phase * 3))) +
              f(t.filter * f(0.35)),
          ) * env,
        );
      }
      case I.Strings: {
        const env = f(Math.min(1, f(age / f(0.7))) * f(Math.exp(f(-release / f(0.9)))));
        let sum = 0;
        for (let voice = 0; voice < 2; ++voice) {
          const phase = advance(voice, f(t.frequency * f(voice ? 1.003 : 0.997)));
          for (let n = 1; n <= 5; ++n) sum = f(sum + f(sine(phase * n) / n));
        }
        t.filter = f(t.filter + f(f(0.25) * f(sum - t.filter)));
        return f(f(t.filter * f(0.5)) * env);
      }
      case I.Bells: {
        const ratios = [1, f(2.76), f(5.4), f(8.93)],
          levels = [1, f(0.5), f(0.25), f(0.12)],
          lengths = [f(1.6), f(0.8), f(0.35), f(0.18)];
        let sum = 0;
        for (let k = 0; k < 4; ++k)
          sum = f(
            sum +
              f(
                f(sine(advance(k, f(t.frequency * ratios[k]))) * levels[k]) *
                  f(Math.exp(f(-age / lengths[k]))),
              ),
          );
        return f(sum * f(0.7));
      }
      case I.Brass: {
        const env = f(Math.min(1, f(age / f(0.05))) * f(Math.exp(f(-release / f(0.12))))),
          bright = f(f(0.55) + f(f(0.4) * env)),
          phase = advance(0, f(t.frequency * f(1 + f(f(0.004) * sine(age * 5.5)))));
        let sum = 0,
          level = 1;
        for (let n = 1; n <= 8; ++n, level = f(level * bright))
          sum = f(sum + f(f(sine(phase * n) * level) / n));
        return f(f(sum * env) * f(0.6));
      }
      case I.Drum: {
        const phase = advance(0, f(70 + f(60 * f(Math.exp(f(-age / f(0.035)))))));
        return f(
          f(sine(phase) * f(Math.exp(f(-age / f(0.28))))) +
            f(f(this.noise() * f(Math.exp(f(-age / f(0.025))))) * f(0.3)),
        );
      }
      case I.Tom: {
        const phase = advance(0, f(95 + f(70 * f(Math.exp(f(-age / f(0.05)))))));
        return f(
          f(sine(phase) * f(Math.exp(f(-age / f(0.3))))) +
            f(f(this.noise() * f(Math.exp(f(-age / f(0.02))))) * f(0.2)),
        );
      }
      case I.Shaker: {
        const n = this.noise(),
          high = f(n - t.filter);
        t.filter = n;
        return f(high * f(Math.exp(f(-age / f(0.045)))));
      }
    }
  }
  render(frame: { left: number; right: number }, mood: MusicMood): void {
    this.clock += 1 / this.rate;
    if (this.current < 0) {
      this.choose(mood);
      this.compose();
      this.beatAt = this.clock;
      this.fade = 0;
    }
    const war = mood.raid > f(0.5);
    if (!this.ending && Score.warlike(this.current) !== war) {
      this.ending = true;
      this.fadeTarget = 0;
    }
    this.fade = f(
      this.fade +
        f(
          f(this.fadeTarget - this.fade) /
            f(this.rate * f(war ? 0.3 : Score.warlike(this.current) ? 0.6 : 1.2)),
        ),
    );
    if (this.ending && this.fade < f(0.01)) {
      this.tones = [];
      this.choose(mood);
      this.compose();
      this.silentUntil = this.clock + (war ? 0.2 : 1.5);
      this.beatAt = this.silentUntil;
      this.nextEighth = 0;
      this.ending = false;
      this.fadeTarget = 1;
    }
    if (!this.ending && this.clock >= this.silentUntil) {
      const eighth = 30 / pieces[this.current].tempo;
      while (this.clock >= this.beatAt + this.nextEighth * eighth && !this.ending) {
        this.schedule(this.nextEighth);
        this.nextEighth += 1;
      }
    }
    let l = 0,
      r = 0;
    for (const tone of this.tones) {
      const v = f(this.sound(tone, this.clock) * tone.gain);
      l = f(l + f(v * tone.left));
      r = f(r + f(v * tone.right));
    }
    if (Math.trunc(this.clock * this.rate) % 512 === 0)
      this.tones = this.tones.filter((t) => this.clock - t.start <= f(t.length + 3));
    const echoLeft = this.roomLeft[this.roomAt % this.roomLeft.length],
      echoRight = this.roomRight[this.roomAt % this.roomRight.length];
    this.roomToneLeft = f(this.roomToneLeft + f(f(0.35) * f(echoLeft - this.roomToneLeft)));
    this.roomToneRight = f(this.roomToneRight + f(f(0.35) * f(echoRight - this.roomToneRight)));
    this.roomLeft[this.roomAt % this.roomLeft.length] = f(l + f(this.roomToneLeft * f(0.55)));
    this.roomRight[this.roomAt % this.roomRight.length] = f(r + f(this.roomToneRight * f(0.55)));
    ++this.roomAt;
    const calm = f(f(1 - f(f(0.2) * mood.dark)) * this.fade);
    frame.left = f(frame.left + f(f(l + f(this.roomToneRight * f(0.3))) * calm));
    frame.right = f(frame.right + f(f(r + f(this.roomToneLeft * f(0.3))) * calm));
  }
}
