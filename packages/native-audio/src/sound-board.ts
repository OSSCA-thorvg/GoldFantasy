// Native SoundBoard mixer, with SDL device ownership moved to the browser host.
import { f32 as f, clamp } from '../../engine/src/numeric';
import { Ambience, Cue, Sound } from './sound-types';
import { Clip, MusicStream, SoundLibrary, sounds, onsets } from './sound-library';
import { voiceSample } from './spoken-voice';
import { EffectManager } from './effect-manager';
import { Score } from './music-score';
import { ambient, voice, clipEnd, effectDuration, type Voice, type Stereo } from './sound-synthesis';
export enum Playback {
  Playing,
  Paused,
  Stopped,
}
const rate = 44100,
  musicGain = f(0.5),
  musicRise = f(1 / f(rate * 3)),
  musicFall = f(1 / f(rate * f(2.5))),
  musicEnding = 6,
  thunderReleaseFrames = (rate * 3) / 4,
  thunderRainFloor = f(0.15);
const clips: Partial<Record<Cue, string[]>> = {
  [Cue.Place]: ['ui/rune_'],
  [Cue.Demolish]: ['sfx/collapse_'],
  [Cue.Click]: ['ui/click_'],
  [Cue.Notice]: ['ui/notify_'],
  [Cue.Alarm]: ['sfx/horn_'],
  [Cue.Order]: ['ui/confirm_'],
  [Cue.Clash]: ['sfx/clash_', 'sfx/block_', 'sfx/swing_'],
  [Cue.Complete]: ['ui/complete_'],
  [Cue.Chop]: ['sfx/chop_'],
  [Cue.TreeFall]: ['sfx/tree_fall_'],
  [Cue.Refuse]: ['ui/error_'],
  [Cue.Open]: ['ui/click_'],
  [Cue.Growth]: ['ui/growth_'],
  [Cue.Coins]: ['sfx/coins_'],
  [Cue.Raven]: ['wildlife/raven_'],
  [Cue.ThunderCrack]: ['weather/crack_'],
  [Cue.ThunderStrike]: ['weather/strike_'],
  [Cue.ThunderClap]: ['weather/clap_'],
  [Cue.ThunderRumble]: ['weather/rumble_'],
  [Cue.Discover]: ['sfx/rune_wake_'],
  [Cue.Unseal]: ['sfx/stone_door_'],
  [Cue.Cow]: ['wildlife/cow_'],
  [Cue.Pig]: ['wildlife/pig_'],
  [Cue.Chicken]: ['wildlife/chicken_'],
  [Cue.Wolf]: ['wildlife/wolf_'],
  [Cue.Dog]: ['wildlife/dog_'],
  [Cue.Cat]: ['wildlife/cat_'],
};
const interfaceCue = (cue: Cue) =>
    [Cue.Click, Cue.Order, Cue.Place, Cue.Refuse, Cue.Open, Cue.Notice].includes(cue),
  thunderCue = (cue: Cue) => cue >= Cue.ThunderCrack && cue <= Cue.ThunderRumble;
function makeVoice(sound: Sound, age = 0, token = 0n): Voice {
  const angle = f(f(clamp(sound.pan, -1, 1) + 1) * f(0.7853982));
  return {
    sound: { ...sound },
    age: f(age),
    token,
    weatherEpoch: 0n,
    weatherRelease: 0,
    left: f(Math.cos(angle)),
    right: f(Math.sin(angle)),
    clip: new Clip(),
    rate: 1,
  };
}
export class SoundBoard {
  private state = Playback.Playing;
  private fadeTarget = Playback.Playing;
  private backgroundGain = 0;
  private fadeFrom = 0;
  private fadeTo = 1;
  private fadeAt = 0;
  private fadeSamples = 48510;
  private voices: Voice[] = [];
  private active: Voice[] = [];
  private effects = new EffectManager((line, voice, take) => voiceSample(line, voice, take).frames);
  private pending: MusicStream | null = null;
  private music: MusicStream | null = null;
  private fading: MusicStream | null = null;
  private silence = false;
  private musicOn = false;
  private musicLevel = 0;
  private fadingLevel = 0;
  private tune = new Float32Array(2048);
  private tuneFading = new Float32Array(2048);
  private lastTake = new Uint8Array(64);
  private picking = 0x2545f491;
  private target = new Ambience();
  level = new Ambience();
  private weatherEpoch = 0n;
  private seed = 22695477;
  rainLeft = 0;
  rainRight = 0;
  windTone = 0;
  fireTone = 0;
  waveLow = 0;
  waveHigh = 0;
  waveSoft = 0;
  leafLow = 0;
  leafHigh = 0;
  leafSoft = 0;
  clock = 0;
  chirpAt = 0;
  birdAt = 1;
  hammerAt = 0.5;
  chopAt = 0.3;
  owlAt = 4;
  songAt = 3;
  hammer = new Clip();
  strikes: number[] = [];
  strikeCount = 0;
  strikeFrom = 0;
  birdPitch = 3000;
  birdPan = 0;
  owlPitch = 380;
  owlPan = 0;
  songPan = 0;
  song = Array(5).fill(0) as number[];
  private score = new Score(rate);
  constructor(private readonly library: SoundLibrary = sounds) {
    this.refreshHammer();
  }
  refreshHammer(): void {
    this.hammer = this.library.clip('sfx/hammer_', 0);
    this.strikes = onsets(this.hammer, f(0.5), 0.25).slice(0, 4).map(f);
    this.strikeCount = this.strikes.length;
  }
  play(sound: Sound): void {
    if (sound.cue === Cue.Music) {
      const track = sound.track ? this.library.music(sound.track) : null;
      if (this.state !== Playback.Playing || this.fadeTarget !== Playback.Playing) return;
      this.silence = !track || !track.valid();
      this.pending = this.silence ? null : track;
      this.musicOn = this.musicOn || !this.silence;
      return;
    }
    const picked = sound.cue === Cue.SpeechStop ? { clip: new Clip(), rate: 1 } : this.pick(sound);
    if (sound.cue === Cue.SpeechStop) {
      this.effects.stopSpeech(sound.speaker);
      this.voices = this.voices.filter((v) => this.effects.active(v.token));
      return;
    }
    if (this.state !== Playback.Playing || this.fadeTarget !== Playback.Playing) return;
    const token = this.effects.request(sound);
    if (!token) return;
    this.voices = this.voices.filter((v) => this.effects.active(v.token));
    const age =
        sound.cue === Cue.Speech
          ? f(sound.offset - sound.delay)
          : picked.clip.frames
            ? -Math.max(0, sound.delay)
            : 0,
      v = makeVoice(sound, age, token);
    v.clip = picked.clip;
    v.rate = picked.rate;
    v.weatherEpoch = this.weatherEpoch;
    this.voices.push(v);
  }
  private pick(sound: Sound): { clip: Clip; rate: number } {
    if (sound.cue === Cue.Speech)
      return { clip: voiceSample(sound.line, sound.voice, sound.take), rate: sound.pitch };
    const groups = clips[sound.cue];
    if (!groups?.length) return { clip: new Clip(), rate: 1 };
    const next = () => {
        this.picking = (Math.imul(this.picking, 1664525) + 1013904223) >>> 0;
        return (this.picking >>> 8) / 16777216;
      },
      group = groups[Math.min(groups.length - 1, Math.trunc(f(next() * groups.length)))],
      takes = this.library.count(group);
    if (!takes) return { clip: new Clip(), rate: 1 };
    const key = sound.cue % this.lastTake.length;
    let take = Math.trunc(f(next() * takes)) % takes;
    if (takes > 1 && take === this.lastTake[key]) take = (take + 1) % takes;
    this.lastTake[key] = take;
    const spread = f(interfaceCue(sound.cue) ? 0.02 : 0.05),
      speed = f(
        f(1 + f(f(f(next() * 2) - 1) * spread)) *
          (Number.isFinite(sound.pitch) && sound.pitch > 0 ? sound.pitch : 1),
      );
    return { clip: this.library.clip(group, take), rate: speed };
  }
  musicPlaying(): boolean {
    return this.musicOn;
  }
  effectStatistics() {
    return this.effects.statistics();
  }
  setAmbience(mix: Ambience): void {
    if (this.target.rain > thunderRainFloor && mix.rain <= thunderRainFloor)
      this.weatherEpoch = BigInt.asUintN(64, this.weatherEpoch + 1n);
    this.target = { ...mix };
  }
  playback(value: Playback): void {
    const freezeFade =
      this.fadeTarget === Playback.Playing &&
      ((value === Playback.Paused && this.state === Playback.Playing) ||
        (value === Playback.Playing && this.state === Playback.Paused));
    this.state = value;
    if (!freezeFade) {
      this.fadeTarget = value;
      this.backgroundGain = this.fadeFrom = this.fadeTo = value === Playback.Playing ? 1 : 0;
      this.fadeAt = this.fadeSamples = 0;
    }
    if (value === Playback.Stopped) {
      this.voices = [];
      this.effects.clear();
      this.target = new Ambience();
      this.level = new Ambience();
      this.score = new Score(rate);
      this.pending = this.music = this.fading = null;
      this.silence = this.musicOn = false;
      this.musicLevel = this.fadingLevel = 0;
    }
  }
  fadeOut(seconds = 0.75): void {
    this.fadePlayback(false, f(seconds));
  }
  fadeIn(seconds = 1.1): void {
    this.fadePlayback(true, f(seconds));
  }
  private fadePlayback(playing: boolean, seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      this.playback(playing ? Playback.Playing : Playback.Paused);
      return;
    }
    this.fadeTarget = playing ? Playback.Playing : Playback.Paused;
    if (playing) this.state = Playback.Playing;
    const running = this.state === Playback.Playing;
    this.fadeFrom = this.backgroundGain;
    this.fadeTo = playing ? 1 : 0;
    this.fadeAt = 0;
    this.fadeSamples = running ? Math.max(1, Math.trunc(f(Math.min(seconds, 10) * rate))) : 0;
    if (!playing) {
      this.voices = [];
      this.active = [];
      this.effects.clear();
    }
  }
  noise(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return f(f((this.seed >>> 8) / 8388608) - 1);
  }
  render(out: Float32Array, frames: number): void {
    if (frames <= 0) return;
    this.active = [];
    if (this.state !== Playback.Playing) {
      out.fill(0, 0, frames * 2);
      return;
    }
    this.active = this.voices;
    this.voices = [];
    const goal = { ...this.target },
      epoch = this.weatherEpoch;
    this.active = this.active.filter((v) => {
      if (!thunderCue(v.sound.cue) || v.weatherEpoch === epoch || v.age > 0) return true;
      this.effects.finish(v.token);
      return false;
    });
    if (this.pending || this.silence) {
      if (this.music) {
        this.fading = this.music;
        this.fadingLevel = this.musicLevel;
      }
      this.music = this.pending;
      this.pending = null;
      this.musicLevel = 0;
      this.silence = false;
    }
    const glide = f(4 / f(rate * f(0.8))),
      swell = f(4 / f(rate * 3)),
      workGlide = f(4 / f(rate * f(0.02))),
      ease = (key: keyof Ambience) => {
        this.level[key] = f(this.level[key] + f(f(goal[key] - this.level[key]) * glide));
      },
      background = (key: keyof Ambience, rise = 3, fall = 4.5) => {
        this.level[key] = f(
          this.level[key] +
            f(f(goal[key] - this.level[key]) * f(3 / f(rate * f(goal[key] > this.level[key] ? rise : fall)))),
        );
      };
    let mixedFrames = 0,
      fadedOut = false;
    for (let first = 0; first < frames;) {
      let count = Math.min(1024, frames - first);
      if (this.fadeTarget !== Playback.Playing && this.fadeSamples > 0)
        count = Math.min(count, this.fadeSamples - this.fadeAt);
      const decode = (key: 'music' | 'fading', into: Float32Array) => {
        const track = this[key],
          got = track ? track.read(into, count) : 0;
        into.fill(0, 2 * got, 2 * count);
        const ending = track ? clamp(f(f(track.duration() - track.played()) / musicEnding), 0, 1) : 0;
        if (track && got < count) this[key] = null;
        return ending;
      };
      const ending = decode('music', this.tune),
        fadingEnding = decode('fading', this.tuneFading);
      for (let i = first; i < first + count; ++i) {
        background('rain', 3, 5);
        background('wind');
        background('night');
        background('birds');
        this.level.hammering = f(
          this.level.hammering +
            f(f(goal.hammering - this.level.hammering) * (goal.hammering > 0 ? glide : workGlide)),
        );
        background('fire');
        for (const key of ['hammerPan', 'firePan', 'raid', 'dark', 'winter', 'gloom'] as const) ease(key);
        background('water');
        ease('waterPan');
        background('woods');
        this.level.chopping = f(
          this.level.chopping +
            f(f(goal.chopping - this.level.chopping) * (goal.chopping > 0 ? glide : workGlide)),
        );
        ease('chopPan');
        this.level.music = f(this.level.music + f(f(goal.music - this.level.music) * swell));
        const frame: Stereo = { left: 0, right: 0 };
        ambient.call(this, frame);
        if (goal.music > 0 || this.level.music > f(0.001)) {
          const tune: Stereo = { left: 0, right: 0 };
          this.score.render(tune, {
            dark: this.level.dark,
            winter: this.level.winter,
            rain: this.level.gloom,
            raid: this.level.raid,
          });
          frame.left = f(frame.left + f(tune.left * this.level.music));
          frame.right = f(frame.right + f(tune.right * this.level.music));
        }
        this.musicLevel = Math.min(1, f(this.musicLevel + musicRise));
        this.fadingLevel = Math.max(0, f(this.fadingLevel - musicFall));
        const at = 2 * (i - first),
          now = f(f(this.musicLevel * ending) * musicGain),
          then = f(f(this.fadingLevel * fadingEnding) * musicGain);
        frame.left = f(frame.left + f(f(this.tune[at] * now) + f(this.tuneFading[at] * then)));
        frame.right = f(frame.right + f(f(this.tune[at + 1] * now) + f(this.tuneFading[at + 1] * then)));
        if (this.fadeSamples > 0) {
          const progress = f(++this.fadeAt / this.fadeSamples),
            eased = f(f(progress * progress) * f(3 - f(2 * progress)));
          this.backgroundGain =
            (this.fadeFrom <= 0 && this.fadeTo >= 0) || (this.fadeFrom >= 0 && this.fadeTo <= 0)
              ? f(f(eased * this.fadeTo) + f(f(1 - eased) * this.fadeFrom))
              : eased === 1
                ? this.fadeTo
                : f(this.fadeFrom + f(eased * f(this.fadeTo - this.fadeFrom)));
          if (this.fadeAt === this.fadeSamples) {
            this.fadeAt = this.fadeSamples = 0;
            fadedOut = this.fadeTarget !== Playback.Playing;
          }
        }
        frame.left = f(frame.left * this.backgroundGain);
        frame.right = f(frame.right * this.backgroundGain);
        for (const v of this.active) {
          let release = 1;
          if (thunderCue(v.sound.cue) && v.weatherEpoch !== epoch) {
            v.weatherRelease = Math.min(v.weatherRelease + 1, thunderReleaseFrames);
            const t = f(v.weatherRelease / thunderReleaseFrames);
            release = f(1 - f(f(t * t) * f(3 - f(2 * t))));
          }
          const tail =
              release <= 0
                ? 0
                : v.sound.cue === Cue.Speech || v.clip.frames
                  ? 1
                  : clamp(f(f(f(1.6) - v.age) / f(0.01)), 0, 1),
            sample = tail > 0 ? f(f(f(voice.call(this, v) * tail) * v.sound.gain) * release) : 0;
          frame.left = f(frame.left + f(sample * v.left));
          frame.right = f(frame.right + f(sample * v.right));
          v.age = f(v.age + f(1 / rate));
        }
        out[2 * i] = clamp(frame.left, -1, 1);
        out[2 * i + 1] = clamp(frame.right, -1, 1);
        this.clock += 1 / rate;
      }
      if (this.fading && this.fadingLevel <= 0) this.fading = null;
      first += count;
      mixedFrames += count;
      if (fadedOut) {
        out.fill(0, first * 2, frames * 2);
        break;
      }
    }
    if (fadedOut) this.state = Playback.Paused;
    this.musicOn = !!(this.music || this.fading || this.pending);
    this.effects.advance(mixedFrames / rate);
    this.active = this.active.filter((v) => {
      if (!this.effects.active(v.token)) return false;
      const ended =
        v.weatherRelease >= thunderReleaseFrames ||
        (v.sound.cue === Cue.Speech
          ? v.age >= v.sound.duration
          : v.clip.frames
            ? v.age >= clipEnd(v.sound.cue, v.clip, v.rate)
            : v.age > effectDuration(v.sound.cue));
      if (ended) this.effects.finish(v.token);
      return !ended;
    });
    this.voices.unshift(...this.active);
  }
}
