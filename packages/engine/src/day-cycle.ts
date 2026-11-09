// Literal seasonal horizon calculation from src/game/day_cycle.h.
import { clamp, f32 as f } from './numeric';
export const twilightLength = f(0.17);
export function daylightHalfSpan(year: number): number {
  year = f(year);
  return f(f(0.2) + f(f(0.055) * f(Math.sin(f(f(2 * f(Math.PI)) * f(year - f(0.125)))))));
}
export interface DayCycle {
  sunrise: number;
  sunset: number;
  daylight: boolean;
  progress: number;
  remaining: number;
}
export function dayCycle(year: number, day: number): DayCycle {
  year = f(year);
  day = f(day);
  const half = f(daylightHalfSpan(year) + f(twilightLength / 2)),
    sunrise = f(f(0.5) - half),
    sunset = f(f(0.5) + half),
    daylight = day >= sunrise && day < sunset,
    length = daylight ? f(sunset - sunrise) : f(1 - f(sunset - sunrise)),
    elapsed = daylight ? f(day - sunrise) : day >= sunset ? f(day - sunset) : f(f(1 - sunset) + day);
  return {
    sunrise,
    sunset,
    daylight,
    progress: clamp(f(elapsed / length), 0, 1),
    remaining: Math.max(0, f(length - elapsed)),
  };
}
