// Translated from src/game/thunderstorm.cpp.
import { Weather } from './climate';
import { clamp, f32 as f, hash01 } from './numeric';
export enum Reach {
  Overhead,
  Near,
  Middle,
  Far,
}
export interface Strike {
  reach: Reach;
  at: number;
  delay: number;
  brightness: number;
  across: number;
  down: number;
  seed: number;
}
function lerp(a: number, b: number, t: number): number {
  // The C++ std::lerp branch used here has two positive finite endpoints and 0 <= t <= 1.
  if (t === 1) return b;
  const x = f(a + f(t * f(b - a)));
  return t > 1 === b > a ? Math.max(b, x) : Math.min(b, x);
}
export class Thunderstorm {
  private state: number;
  private last = -1;
  private remaining = -1;
  private earliest = 0;
  constructor(seed = 7) {
    this.state = (Math.imul(seed, 2246822519) + 0x165667b1) >>> 0;
  }
  private roll(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return (this.state >>> 8) / 16777216;
  }
  static activity(worldSeed: number, day: number | bigint): number {
    const count = BigInt(day),
      low = Number(BigInt.asUintN(32, count)),
      high = Number(BigInt.asUintN(32, count >> 32n));
    const pick = hash01((worldSeed ^ high) >>> 0, low & 0x7fffffff, low >>> 31, 0x7419b3a5);
    return pick < f(0.18)
      ? f(f(2.2) + f(f(0.8) * f(pick / f(0.18))))
      : f(f(0.85) + f(f(0.3) * f(f(pick - f(0.18)) / f(0.82))));
  }
  update(seconds: number, weather: Weather, intensity: number, activity = 1): Strike | undefined {
    intensity = f(intensity);
    activity = f(activity);
    const storm = weather === Weather.Storm;
    if (
      (!storm && weather !== Weather.Rain) ||
      !Number.isFinite(seconds) ||
      !Number.isFinite(intensity) ||
      intensity <= f(0.08)
    ) {
      this.last = this.remaining = -1;
      return undefined;
    }
    intensity = clamp(intensity, 0, 1);
    activity = Number.isFinite(activity) ? clamp(activity, f(0.5), f(3.5)) : 1;
    const wetness = f(f(intensity * intensity) * f(3 - f(2 * intensity)));
    const meanGap = storm ? lerp(18, 11, wetness) : lerp(f(72.5), 19, wetness);
    const gap = () => f(f(0.55) + f(f(0.9) * this.roll()));
    if (this.last < 0 || seconds < this.last) {
      this.last = seconds;
      this.remaining = gap() * 0.5;
      this.earliest = seconds + 1.5;
      return undefined;
    }
    const elapsed = clamp(seconds - this.last, 0, 1);
    this.last = seconds;
    this.remaining -= (elapsed * activity) / meanGap;
    if (this.remaining > 0 || seconds < this.earliest) return undefined;
    this.remaining = gap();
    this.earliest = seconds + 1.5;
    const pick = this.roll();
    const reach = storm
      ? pick < f(0.08)
        ? Reach.Overhead
        : pick < f(0.3)
          ? Reach.Near
          : pick < f(0.65)
            ? Reach.Middle
            : Reach.Far
      : pick < f(0.05)
        ? Reach.Near
        : pick < f(0.3)
          ? Reach.Middle
          : Reach.Far;
    const strike: Strike = { at: seconds, reach, delay: 0, brightness: 0, across: 0, down: 0, seed: 0 };
    switch (reach) {
      case Reach.Overhead:
        strike.delay = f(f(0.05) * this.roll());
        strike.brightness = 1;
        break;
      case Reach.Near:
        strike.delay = f(f(0.25) + f(f(0.35) * this.roll()));
        strike.brightness = f(0.8);
        break;
      case Reach.Middle:
        strike.delay = f(f(1.2) + f(f(1.2) * this.roll()));
        strike.brightness = f(0.45);
        break;
      case Reach.Far:
        strike.delay = f(3 + f(f(2.5) * this.roll()));
        strike.brightness = f(0.22);
        break;
    }
    const side = this.roll();
    if (reach === Reach.Far)
      strike.across =
        side < f(0.5) ? f(f(-0.25) - f(f(0.4) * this.roll())) : f(f(1.25) + f(f(0.4) * this.roll()));
    else if (reach === Reach.Middle) strike.across = f(f(-0.2) + f(f(1.4) * side));
    else strike.across = f(f(0.15) + f(f(0.7) * side));
    strike.down = f(f(0.3) + f(f(0.5) * this.roll()));
    strike.seed = this.state;
    return strike;
  }
}
