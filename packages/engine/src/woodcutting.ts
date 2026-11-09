// Exact constants and axe animation from native woodcutting.h.
import { f32 as f, clamp } from './numeric';
export const cutSeconds = 6,
  swingSeconds = 0.7,
  impactSeconds = 0.52,
  fallSeconds = 0.8,
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
