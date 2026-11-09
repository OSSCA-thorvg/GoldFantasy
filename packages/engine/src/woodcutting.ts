// Harvest duration and yield retain the game rules; contacts share the visible work rhythm.
import { f32 as f, clamp } from './numeric';
import { harvestTiming, treeFallTiming } from './work-timing';
export const cutSeconds = harvestTiming.duration,
  swingSeconds = harvestTiming.period,
  impactSeconds = harvestTiming.impact,
  fallSeconds = treeFallTiming.duration,
  searchRadius = 5,
  logsPerTree = 3;
export function axeAngle(elapsed: number): number {
  const phase = f(Math.max(0, elapsed) % swingSeconds),
    ease = (t: number) => {
      t = clamp(t, 0, 1);
      return f(f(t * t) * f(3 - f(2 * t)));
    };
  if (phase < f(0.32)) return f(-f(1.35) * ease(f(phase / f(0.32))));
  if (phase < impactSeconds)
    return f(-f(1.35) + f(f(1.57) * ease(f(f(phase - f(0.32)) / f(impactSeconds - 0.32)))));
  return f(f(0.22) * f(1 - ease(f(f(phase - f(impactSeconds)) / f(swingSeconds - impactSeconds)))));
}
