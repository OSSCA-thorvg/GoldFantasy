// Translated from src/game/climate.h and climate.cpp.
import { clamp, f32 as f } from './numeric';
import { daylightHalfSpan, twilightLength } from './day-cycle';

export enum Weather {
  Clear,
  Cloudy,
  Rain,
  Storm,
  Snow,
}
export const weatherName = (weather: Weather): string =>
  ['Clear', 'Cloudy', 'Rain', 'Storm', 'Snow'][weather] ?? '';
export class Climate {
  weather = Weather.Clear;
  intensity = 0;
  wind = 0;
  temperature = 10;
  snow = 0;
  summer = 0;
  autumn = 0;
  frost = 0;
  night = 0;
  precipitating(): boolean {
    return this.weather === Weather.Rain || this.weather === Weather.Storm || this.weather === Weather.Snow;
  }
}
const tau = f(6.2831853),
  swellDays = f(0.05),
  fadeDays = f(0.12);
const durationScale = (weather: Weather): number =>
  weather === Weather.Rain || weather === Weather.Storm ? f(1.5) : 1;
function smooth(t: number): number {
  t = clamp(t, 0, 1);
  return f(f(t * t) * f(3 - f(2 * t)));
}
function windOf(weather: Weather, intensity: number): number {
  switch (weather) {
    case Weather.Cloudy:
      return f(0.24);
    case Weather.Rain:
      return f(f(0.14) + f(f(0.5) * intensity));
    case Weather.Storm:
      return f(f(0.2) + f(f(0.75) * intensity));
    case Weather.Snow:
      return f(f(0.14) + f(f(0.45) * intensity));
    case Weather.Clear:
      return f(0.12);
  }
  return f(0.12);
}
function bump(year: number, start: number, end: number, ramp: number): number {
  const rise = smooth(f(f(f(year - start) + ramp) / ramp)),
    fall = f(1 - smooth(f(f(year - end) / ramp)));
  return Math.min(rise, fall);
}
export interface SkySnapshot {
  climate: Omit<Climate, 'precipitating'>;
  timer: number;
  state: number;
  peak: number;
  span: number;
  breeze: number;
}
export class Sky {
  private climate = new Climate();
  private timer = 0;
  private state: number;
  private peak = 0;
  private span = 0;
  private breeze = 0;
  constructor(seed: number) {
    this.state = (Math.imul(seed, 747796405) + 2891336453) >>> 0;
  }
  now(): Readonly<Climate> {
    return this.climate;
  }
  private random(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    this.state >>>= 0;
    return f((this.state >>> 8) / 16777216);
  }
  private roll(year: number): void {
    const summer = year >= f(0.25) && year < f(0.5),
      winter = year >= f(0.75);
    const wet = summer ? f(0.28) : winter ? f(0.16) : f(0.1),
      pick = this.random();
    this.peak = 0;
    if (pick < wet) {
      const hard = this.random(),
        stormy = summer && this.random() < f(0.3);
      this.climate.weather = winter ? Weather.Snow : stormy ? Weather.Storm : Weather.Rain;
      this.peak = stormy
        ? f(f(0.75) + f(f(0.25) * hard))
        : hard < f(0.55)
          ? f(f(0.15) + f(f(0.25) * f(hard / f(0.55))))
          : hard < f(0.85)
            ? f(f(0.4) + f(f(0.25) * f(f(hard - f(0.55)) / f(0.3))))
            : f(f(0.7) + f(f(0.3) * f(f(hard - f(0.85)) / f(0.15))));
    } else this.climate.weather = pick < f(wet + f(0.25)) ? Weather.Cloudy : Weather.Clear;
    this.climate.intensity = 0;
    this.timer = this.span = f(f(f(0.35) + f(this.random() * f(0.6))) * durationScale(this.climate.weather));
  }
  force(weather: Weather, intensity: number): void {
    intensity = f(intensity);
    this.climate.weather = weather;
    this.climate.intensity = this.peak = intensity;
    this.timer = durationScale(weather);
    this.span = f(this.timer + swellDays);
    this.climate.wind = windOf(weather, intensity);
  }
  advance(seconds: number, secondsPerDay: number, year: number, day: number): void {
    year = f(year);
    day = f(day);
    const days = f(seconds / secondsPerDay);
    this.timer = f(this.timer - days);
    if (this.timer <= 0) this.roll(year);
    this.updateClimate(days, year, day);
  }
  previewTime(year: number, day: number): void {
    this.updateClimate(0, f(year), f(day));
  }
  private updateClimate(days: number, year: number, day: number): void {
    const daylight = daylightHalfSpan(year);
    this.climate.night = smooth(f(f(Math.abs(f(day - f(0.5))) - daylight) / twilightLength));
    const base = f(9 + f(13 * f(Math.sin(f(tau * f(year - f(0.05)))))));
    const weatherChill = this.climate.precipitating() ? 3 : this.climate.weather === Weather.Cloudy ? 1 : 0;
    this.climate.temperature = f(f(base - weatherChill) - f(4 * this.climate.night));
    const winter = year >= f(0.75);
    if (
      winter &&
      (this.climate.weather === Weather.Rain || this.climate.weather === Weather.Storm) &&
      this.climate.temperature <= f(0.5)
    )
      this.climate.weather = Weather.Snow;
    if (this.climate.weather === Weather.Snow && (!winter || this.climate.temperature > f(2.5)))
      this.climate.weather = Weather.Rain;
    if (this.peak > 0 && this.climate.precipitating()) {
      const elapsed = f(this.span - this.timer),
        pulse = f(1 + f(f(0.1) * f(Math.sin(f(f(f(tau * elapsed) * 6) + f(this.peak * 40))))));
      this.climate.intensity = clamp(
        f(f(this.peak * Math.min(smooth(f(elapsed / swellDays)), smooth(f(this.timer / fadeDays)))) * pulse),
        0,
        1,
      );
    }
    this.breeze = f(this.breeze + days);
    const gust = f(
      f(f(0.5) + f(f(0.3) * f(Math.sin(f(f(tau * this.breeze) / f(0.3)))))) +
        f(f(0.2) * f(Math.sin(f(f(f(tau * this.breeze) / f(0.11)) + f(1.3))))),
    );
    const target = clamp(
      f(windOf(this.climate.weather, this.climate.intensity) * f(f(0.7) + f(f(0.6) * gust))),
      0,
      1,
    );
    this.climate.wind = f(this.climate.wind + f(f(target - this.climate.wind) * Math.min(1, f(days * 20))));
    if (this.climate.weather === Weather.Snow)
      this.climate.snow = f(this.climate.snow + f(f(f(0.9) * this.climate.intensity) * days));
    else if (this.climate.temperature > 1)
      this.climate.snow = f(
        this.climate.snow -
          f(
            f(
              f(f(0.35) + f(f(0.08) * this.climate.temperature)) +
                (this.climate.precipitating() ? f(0.5) : 0),
            ) * days,
          ),
      );
    this.climate.snow = clamp(this.climate.snow, 0, 1);
    this.climate.frost = clamp(
      f(this.climate.frost + f((this.climate.temperature < -2 ? f(0.6) : f(-0.8)) * days)),
      0,
      1,
    );
    this.climate.summer = bump(year, f(0.25), f(0.5), f(0.08));
    this.climate.autumn = bump(year, f(0.52), f(0.8), f(0.1));
  }
  snapshot(): SkySnapshot {
    return {
      climate: { ...this.climate },
      timer: this.timer,
      state: this.state,
      peak: this.peak,
      span: this.span,
      breeze: this.breeze,
    };
  }
  restore(value: SkySnapshot): void {
    this.climate = Object.assign(new Climate(), value.climate);
    this.timer = value.timer;
    this.state = value.state >>> 0;
    this.peak = value.peak;
    this.span = value.span;
    this.breeze = value.breeze;
  }
}
