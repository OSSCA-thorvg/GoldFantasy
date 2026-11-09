// Formula-by-formula translation of the native SoundBoard ambient and effect synthesizers.
import { f32, clamp } from '../../engine/src/numeric';
import { Cue, VoiceLine, type Ambience, type Sound } from './sound-types';
import type { Clip } from './sound-library';
export interface Stereo {
  left: number;
  right: number;
}
export interface Voice {
  sound: Sound;
  age: number;
  token: bigint;
  weatherEpoch: bigint;
  weatherRelease: number;
  left: number;
  right: number;
  clip: Clip;
  rate: number;
}
export interface SynthesisState {
  clock: number;
  rainLeft: number;
  rainRight: number;
  windTone: number;
  level: Ambience;
  chirpAt: number;
  birdAt: number;
  birdPitch: number;
  birdPan: number;
  hammerAt: number;
  strikeCount: number;
  strikeFrom: number;
  strikes: number[];
  hammer: Clip;
  fireTone: number;
  waveLow: number;
  waveHigh: number;
  waveSoft: number;
  leafLow: number;
  leafHigh: number;
  leafSoft: number;
  chopAt: number;
  owlAt: number;
  owlPitch: number;
  owlPan: number;
  songAt: number;
  songPan: number;
  song: number[];
  noise(): number;
}
const nativeDouble = <T>(value: T): T => value;
const fmod = (a: number, b: number): number => a % b;
const tau = f32(6.2831853);
export const effectDuration = (cue: Cue): number =>
  cue === Cue.Chop ? f32(0.18) : cue === Cue.Mine ? f32(0.22) : cue === Cue.TreeFall ? f32(0.85) : f32(1.6);
export const clipEnd = (cue: Cue, clip: Clip, rate: number): number =>
  Math.min(f32(f32(clip.duration()) / rate), cue === Cue.Chop ? effectDuration(cue) : f32(1e9));
export function decay(age: number, length: number): number {
  return age < 0 ? 0 : f32(Math.exp(f32(-age / length)));
}
export function place(sample: number, pan: number, out: Stereo): void {
  const angle = f32(f32(clamp(pan, -1, 1) + 1) * f32(0.7853982));
  out.left = f32(out.left + f32(sample * f32(Math.cos(angle))));
  out.right = f32(out.right + f32(sample * f32(Math.sin(angle))));
}
export function ambient(this: SynthesisState, out: Stereo): void {
  let t = f32(this.clock);
  // Rain: two uncorrelated hisses, so it surrounds the listener.
  this.rainLeft = f32(this.rainLeft + f32(f32(0.5) * f32(this.noise() - this.rainLeft)));
  this.rainRight = f32(this.rainRight + f32(f32(0.5) * f32(this.noise() - this.rainRight)));
  out.left = f32(out.left + f32(f32(this.rainLeft * f32(0.06)) * this.level.rain));
  out.right = f32(out.right + f32(f32(this.rainRight * f32(0.06)) * this.level.rain));
  // Wind: a dark rumble that swells and fades, drifting across.
  this.windTone = f32(this.windTone + f32(f32(0.015) * f32(this.noise() - this.windTone)));
  place(
    f32(
      f32(f32(f32(this.windTone * 2) * this.level.wind) * f32(0.4)) *
        f32(f32(0.6) + f32(f32(0.4) * f32(Math.sin(f32(t * f32(0.37)))))),
    ),
    f32(f32(Math.sin(f32(t * f32(0.11)))) * f32(0.6)),
    out,
  );
  // Crickets: trains of three short chirps.
  if (this.level.night > f32(0.01)) {
    if (nativeDouble(this.clock > this.chirpAt + 0.9))
      this.chirpAt = nativeDouble(this.clock + this.noise() * 0.2);
    let since = f32(this.clock - this.chirpAt);
    for (let k = 0; k < 3; ++k) {
      let local = f32(since - f32(k * f32(0.07)));
      if (local > 0 && local < f32(0.035))
        place(
          f32(
            f32(
              f32(f32(nativeDouble(Math.sin(6.283185307179586 * 4400 * this.clock))) * f32(0.014)) *
                this.level.night,
            ) * f32(Math.sin(f32(f32(local / f32(0.035)) * f32(3.14159)))),
          ),
          -f32(0.4),
          out,
        );
    }
  }
  // Birds: chirps from here and there.
  if (this.level.birds > f32(0.01)) {
    let since = f32(this.clock - this.birdAt);
    if (since > f32(f32(2.5) + f32(2 * Math.abs(this.noise())))) {
      this.birdAt = this.clock;
      this.birdPitch = f32(2600 + f32(1200 * Math.abs(this.noise())));
      this.birdPan = f32(this.noise() * f32(0.8));
      since = 0;
    }
    for (let k = 0; k < 2; ++k) {
      let local = f32(since - f32(k * f32(0.16)));
      if (local > 0 && local < f32(0.12)) {
        let sweep = f32(
          this.birdPitch *
            f32(1 + f32(f32(0.35) * f32(Math.sin(f32(f32(local / f32(0.12)) * f32(3.14159)))))),
        );
        place(
          f32(
            f32(f32(f32(Math.sin(f32(f32(tau * sweep) * local))) * f32(0.03)) * this.level.birds) *
              f32(Math.sin(f32(f32(local / f32(0.12)) * f32(3.14159)))),
          ),
          this.birdPan,
          out,
        );
      }
    }
  }
  // Hammers knocking on timber, from where the builders are: each knock one strike of the recording, rung out.
  if (this.level.hammering > f32(0.01)) {
    let since = f32(this.clock - this.hammerAt);
    if (since > f32(f32(f32(0.75) - f32(f32(0.35) * this.level.hammering)) + f32(f32(0.1) * this.noise()))) {
      this.hammerAt = this.clock;
      since = 0;
      if (this.strikeCount)
        this.strikeFrom =
          this.strikes[
            Math.trunc(f32(Math.abs(this.noise()) * f32(this.strikeCount))) % Math.trunc(this.strikeCount)
          ];
    }
    let knock = this.strikeCount
      ? f32(
          this.hammer.at(f32(this.strikeFrom + since)) * clamp(f32(f32(f32(0.34) - since) / f32(0.06)), 0, 1),
        )
      : f32(
          f32(f32(f32(Math.sin(f32(f32(tau * 190) * since))) * f32(0.7)) + f32(this.noise() * f32(0.3))) *
            decay(since, f32(0.035)),
        );
    // One builder in earshot is heard plainly, as an axe is; a busy site louder, but not three times so.
    place(f32(f32(knock * f32(0.38)) * f32(Math.sqrt(this.level.hammering))), this.level.hammerPan, out);
  }
  // The campfire: a low, soft murmur only.
  if (this.level.fire > f32(0.01)) {
    this.fireTone = f32(this.fireTone + f32(f32(0.01) * f32(this.noise() - this.fireTone)));
    place(f32(f32(this.fireTone * f32(0.02)) * this.level.fire), this.level.firePan, out);
  }
  // Water: a shore's slow wash, swelling and falling like waves.
  if (this.level.water > f32(0.01)) {
    let n = this.noise();
    this.waveLow = f32(this.waveLow + f32(f32(0.02) * f32(n - this.waveLow)));
    this.waveHigh = f32(this.waveHigh + f32(f32(0.17) * f32(n - this.waveHigh)));
    this.waveSoft = f32(this.waveSoft + f32(f32(0.17) * f32(this.waveHigh - this.waveSoft))); // A second pole keeps the hiss off it.
    let swell = f32(
      f32(0.55) +
        f32(
          f32(0.45) *
            f32(Math.sin(f32(f32(t * f32(0.9)) + f32(f32(0.6) * f32(Math.sin(f32(t * f32(0.23)))))))),
        ),
    );
    place(
      f32(f32(f32(f32(f32(this.waveSoft - this.waveLow) * f32(0.15)) * this.level.water) * swell) * swell),
      this.level.waterPan,
      out,
    );
  }
  // Leaves stirring as the wind gusts through the trees about.
  if (this.level.woods > f32(0.01)) {
    let n = this.noise();
    this.leafLow = f32(this.leafLow + f32(f32(0.08) * f32(n - this.leafLow)));
    this.leafHigh = f32(this.leafHigh + f32(f32(0.35) * f32(n - this.leafHigh)));
    this.leafSoft = f32(this.leafSoft + f32(f32(0.35) * f32(this.leafHigh - this.leafSoft)));
    let gust = Math.max(
      0,
      f32(Math.sin(f32(f32(t * f32(0.53)) + f32(2 * f32(Math.sin(f32(t * f32(0.17)))))))),
    );
    place(
      f32(
        f32(
          f32(
            f32(f32(f32(this.leafSoft - this.leafLow) * f32(0.1)) * this.level.woods) *
              f32(f32(0.3) + this.level.wind),
          ) * gust,
        ) * gust,
      ),
      f32(f32(Math.sin(f32(t * f32(0.07)))) * f32(0.5)),
      out,
    );
  }
  // Axes biting into trunks: slower and duller than the hammers.
  if (this.level.chopping > f32(0.01)) {
    if (nativeDouble(this.clock - this.chopAt > 1.1 - 0.2 * this.level.chopping))
      this.chopAt = nativeDouble(this.clock + 0.15 * Math.abs(this.noise()));
    let since = f32(this.clock - this.chopAt);
    if (since > 0) {
      let thunk = f32(
        f32(
          f32(f32(Math.sin(f32(f32(tau * 150) * since))) * decay(since, f32(0.05))) +
            f32(f32(f32(0.4) * f32(Math.sin(f32(f32(tau * 410) * since)))) * decay(since, f32(0.02))),
        ) + f32(f32(f32(0.5) * this.noise()) * decay(since, f32(0.005))),
      );
      place(f32(f32(thunk * f32(0.09)) * this.level.chopping), this.level.chopPan, out);
    }
  }
  // An owl in the woods at night: hoo... hoo-hoo, each note sagging a little.
  if (this.level.night > f32(0.3) && this.level.woods > f32(0.1)) {
    let since = f32(this.clock - this.owlAt);
    if (since > f32(1.4)) {
      this.owlAt = nativeDouble(this.clock + 12 + f32(10 * Math.abs(this.noise())));
      this.owlPitch = f32(340 + f32(60 * Math.abs(this.noise())));
      this.owlPan = f32(this.noise() * f32(0.7));
    } else if (since > 0) {
      const starts = [0, f32(0.62), f32(0.86)],
        lengths = [f32(0.34), f32(0.16), f32(0.42)];
      for (let k = 0; k < 3; ++k) {
        let local = f32(since - starts[k]);
        if (local <= 0 || local >= lengths[k]) continue;
        let shape = f32(Math.sin(f32(f32(local / lengths[k]) * f32(3.14159))));
        let phase = f32(this.owlPitch * f32(local - f32(f32(f32(f32(0.03) * local) * local) / lengths[k])));
        let hoot = f32(
          f32(Math.sin(f32(tau * phase))) + f32(f32(0.15) * f32(Math.sin(f32(f32(2 * tau) * phase)))),
        );
        place(
          f32(f32(f32(f32(f32(hoot * shape) * shape) * f32(0.022)) * this.level.night) * this.level.woods),
          this.owlPan,
          out,
        );
      }
    }
  }
  // Now and then a songbird's phrase: a run of quick notes, each lifting a little.
  if (this.level.birds > f32(0.01)) {
    let since = f32(this.clock - this.songAt);
    if (since > f32(0.5)) {
      this.songAt = nativeDouble(this.clock + 7 + f32(8 * Math.abs(this.noise())));
      for (let index = 0; index < this.song.length; ++index)
        this.song[index] = f32(2300 + f32(1400 * Math.abs(this.noise())));
      this.songPan = f32(this.noise() * f32(0.8));
    } else if (since > 0) {
      let k = Math.trunc(f32(since / f32(0.095)));
      let local = f32(since - f32(k * f32(0.095)));
      if (k < Math.trunc(this.song.length) && local < f32(0.07)) {
        let shape = f32(Math.sin(f32(f32(local / f32(0.07)) * f32(3.14159))));
        let phase = f32(this.song[Math.trunc(k)] * f32(local + f32(f32(f32(1.2) * local) * local)));
        place(
          f32(f32(f32(f32(Math.sin(f32(tau * phase))) * shape) * f32(0.02)) * this.level.birds),
          this.songPan,
          out,
        );
      }
    }
  }
}
export function voice(this: SynthesisState, v: Voice): number {
  let a = v.age;
  if (v.clip.frames) {
    if (v.sound.cue != Cue.Speech) {
      // Faded over its last moments, longer where it is cut short, so no clip ends on a click.
      let end = clipEnd(v.sound.cue, v.clip, v.rate),
        fade = end < f32(f32(v.clip.duration()) / v.rate) ? f32(0.025) : f32(0.006);
      return f32(v.clip.at(a, v.rate) * clamp(f32(f32(end - a) / fade), 0, 1));
    }
    if (a < 0 || a >= v.sound.duration) return 0;
    let local = a;
    // Typed text no clip says is hummed under, over and over.
    if (v.sound.line == VoiceLine.Murmur) local = nativeDouble(fmod(local, v.clip.duration() / v.rate + 0.1));
    let envelope = clamp(Math.min(f32(a / f32(0.008)), f32(f32(v.sound.duration - a) / f32(0.02))), 0, 1);
    return f32(v.clip.at(local, v.rate) * envelope);
  }
  switch (v.sound.cue) {
    case Cue.Place:
      return f32(
        f32(
          f32(
            f32(f32(Math.sin(f32(f32(tau * 95) * a))) * f32(0.5)) +
              f32(f32(this.noise() * decay(a, f32(0.02))) * f32(0.4)),
          ) * decay(a, f32(0.18)),
        ) * f32(0.5),
      );
    case Cue.Demolish:
      return f32(
        f32(
          f32(f32(this.noise() * f32(0.6)) * decay(a, f32(0.25))) +
            f32(f32(f32(Math.sin(f32(f32(tau * 58) * a))) * f32(0.5)) * decay(a, f32(0.3))),
        ) * f32(0.45),
      );
    case Cue.Click:
      return f32(f32(f32(Math.sin(f32(f32(tau * 1250) * a))) * decay(a, f32(0.012))) * f32(0.2));
    case Cue.Order:
      return f32(
        f32(f32(Math.sin(f32(f32(tau * f32(620 + f32(200 * a))) * a))) * decay(a, f32(0.05))) * f32(0.18),
      );
    case Cue.Notice:
      return f32(
        f32(
          f32(
            f32(Math.sin(f32(f32(tau * 880) * a))) +
              f32(
                f32(f32(0.6) * f32(Math.sin(f32(f32(tau * 1320) * f32(a - f32(0.09)))))) *
                  Number(a > f32(0.09)),
              ),
          ) * decay(a, f32(0.35)),
        ) * f32(0.1),
      );
    case Cue.Alarm: {
      let vibrato = f32(1 + f32(f32(0.01) * f32(Math.sin(f32(f32(tau * 5) * a)))));
      let saw = f32(f32(2 * fmod(f32(f32(220 * vibrato) * a), 1)) - 1);
      return f32(
        f32(
          f32(saw * Math.min(1, f32(a / f32(0.15)))) *
            (a < f32(0.9) ? 1 : decay(f32(a - f32(0.9)), f32(0.25))),
        ) * f32(0.12),
      );
    }
    case Cue.Clash: // Steel: a few clanging partials over a sharp click.
      return f32(
        f32(
          f32(
            f32(
              f32(
                f32(Math.sin(f32(f32(tau * 1180) * a))) +
                  f32(f32(0.7) * f32(Math.sin(f32(f32(tau * 1730) * a)))),
              ) + f32(f32(0.5) * f32(Math.sin(f32(f32(tau * 2390) * a)))),
            ) * decay(a, f32(0.12)),
          ) * f32(0.12),
        ) + f32(f32(this.noise() * decay(a, f32(0.008))) * f32(0.25)),
      );
    case Cue.Bite: // A snarl and a thud.
      return f32(
        f32(
          f32(
            f32(this.noise() * f32(f32(0.5) + f32(f32(0.5) * f32(Math.sin(f32(f32(tau * 38) * a)))))) *
              decay(a, f32(0.12)),
          ) * f32(0.3),
        ) + f32(f32(f32(Math.sin(f32(f32(tau * 85) * a))) * decay(a, f32(0.1))) * f32(0.3)),
      );
    case Cue.Arrow: // A whistle that falls away.
      return f32(
        f32(
          f32(f32(Math.sin(f32(f32(tau * f32(1900 - f32(900 * a))) * a))) * decay(a, f32(0.1))) * f32(0.08),
        ) + f32(f32(this.noise() * decay(a, f32(0.05))) * f32(0.06)),
      );
    case Cue.Chop:
      return f32(
        f32(
          f32(f32(f32(Math.sin(f32(f32(tau * 185) * a))) * decay(a, f32(0.028))) * f32(0.35)) +
            f32(f32(this.noise() * decay(a, f32(0.009))) * f32(0.22)),
        ) * clamp(f32(f32(f32(0.18) - a) / f32(0.025)), 0, 1),
      );
    case Cue.Mine:
      return f32(
        f32(
          f32(
            f32(
              f32(
                f32(Math.sin(f32(f32(tau * 830) * a))) +
                  f32(f32(0.5) * f32(Math.sin(f32(f32(tau * 1470) * a)))),
              ) * decay(a, f32(0.045)),
            ) * f32(0.16),
          ) + f32(f32(this.noise() * decay(a, f32(0.009))) * f32(0.16)),
        ) * clamp(f32(f32(f32(0.22) - a) / f32(0.025)), 0, 1),
      );
    case Cue.TreeFall: {
      let creak = f32(
        f32(f32(Math.sin(f32(f32(tau * f32(160 - f32(65 * a))) * a))) * decay(a, f32(0.25))) * f32(0.055),
      );
      let hit = f32(a - f32(0.5));
      let thud =
        hit < 0
          ? 0
          : f32(
              f32(f32(f32(Math.sin(f32(f32(tau * 75) * hit))) * f32(0.22)) + f32(this.noise() * f32(0.12))) *
                decay(hit, f32(0.1)),
            );
      return f32(f32(creak + thud) * clamp(f32(f32(f32(0.85) - a) / f32(0.1)), 0, 1));
    }
    case Cue.Complete: {
      // Three rising bell notes.
      let bell = 0;
      const tones = [f32(523.25), f32(659.25), f32(783.99)];
      for (let i = 0; i < 3; ++i) {
        let local = f32(a - f32(i * f32(0.12)));
        if (local > 0)
          bell = f32(bell + f32(f32(Math.sin(f32(f32(tau * tones[i]) * local))) * decay(local, f32(0.5))));
      }
      return f32(bell * f32(0.07));
    }
    case Cue.Speech:
    case Cue.SpeechStop:
      return 0;
    case Cue.Howl: {
      // A pack's long cry and a lower answer, far off in the dark.
      let cry = 0;
      for (let k = 0; k < 2; ++k) {
        let local = f32(a - f32(k * f32(0.5))),
          length = k ? f32(0.9) : f32(1.05);
        if (local <= 0 || local >= length) continue;
        let low = k ? 270 : 310,
          high = k ? 440 : 520,
          sag = Math.max(0, f32(local - f32(0.6)));
        // Rising fast to its pitch, then sagging, with a slight waver: the phase integrates the pitch.
        let phase = f32(
          f32(
            f32(
              f32(high * local) -
                f32(f32(f32(high - low) * f32(0.18)) * f32(1 - f32(Math.exp(f32(-local / f32(0.18)))))),
            ) - f32(f32(120 * sag) * sag),
          ) - f32(f32(6 / f32(tau * f32(5.5))) * f32(Math.cos(f32(f32(tau * f32(5.5)) * local)))),
        );
        let shape = f32(
          Math.min(1, f32(local / f32(0.15))) * Math.min(1, f32(f32(length - local) / f32(0.3))),
        );
        cry = f32(
          cry +
            f32(
              f32(
                f32(
                  f32(Math.sin(f32(tau * phase))) + f32(f32(0.25) * f32(Math.sin(f32(f32(2 * tau) * phase)))),
                ) * shape,
              ) * (k ? f32(0.6) : 1),
            ),
        );
      }
      return f32(cry * f32(0.07));
    }
    case Cue.Refuse:
    case Cue.Open:
    case Cue.Growth:
    case Cue.Coins:
    case Cue.Raven:
    case Cue.ThunderCrack:
    case Cue.ThunderStrike:
    case Cue.ThunderClap:
    case Cue.ThunderRumble:
    case Cue.Discover:
    case Cue.Unseal:
    case Cue.Cow:
    case Cue.Pig:
    case Cue.Chicken:
    case Cue.Wolf:
    case Cue.Dog:
    case Cue.Cat:
    case Cue.Music:
    case Cue.Count:
      return 0; // Clips only.
  }
  return 0;
}
