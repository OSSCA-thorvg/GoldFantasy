// Liquid water and lava: each contour band drifts on its own slow loop; nothing is re-contoured per frame.
import type { ShapeNode } from './paint';
import type { Climate } from './render-types';
const f = Math.fround,
  tau = f(6.2831853);
export enum Liquid {
  Water,
  Lava,
}
export interface Drift {
  liquid: Liquid;
  /** Reach in tiles of the loop's long axis. */
  reach: number;
  period: number;
  phase: number;
  heading: number;
}
/** Water updates this often; the drift is slow, so more would only cost frames. */
export const waterRate = 12;
/**
 * A band's loop: varied period, phase and heading so neighbouring bands slide past one another.
 * The salt names the band, so its copies in every ground chunk move as one.
 */
export function drift(liquid: Liquid, reach: number, period: number, salt: number): Drift {
  const golden = f(f(salt * f(0.618034)) % 1);
  return {
    liquid,
    reach,
    period: f(period * f(f(0.85) + f(f(0.3) * golden))),
    phase: f(f(salt * f(2.399963)) % tau),
    heading: f(f(f(salt * f(1.7)) + f(0.6)) % tau),
  };
}
/** Offset in tiles at a moment; frozen water and reduced motion keep still. */
export function driftOffset(d: Drift, seconds: number, climate: Readonly<Climate>): { x: number; y: number } {
  const calm = d.liquid === Liquid.Lava ? 1 : Math.max(0, f(1 - f(f(1.4) * climate.frost)));
  if (calm <= 0) return { x: 0, y: 0 };
  const angle = f(f(f(f(seconds % 3600) / d.period) * tau) + d.phase),
    // Lava loops slowly and settles at the ends: the heavier ooze.
    along = d.liquid === Liquid.Lava ? f(Math.sin(angle) * Math.abs(Math.sin(angle))) : f(Math.sin(angle)),
    // Lava is thick: it barely sways across its heading.
    sway = d.liquid === Liquid.Lava ? f(0.3) : 1,
    across = f(f(f(f(0.55) * f(Math.cos(angle))) + f(f(0.25) * f(Math.sin(f(f(angle * 2) + d.phase))))) * sway),
    reach = f(d.reach * calm),
    c = f(Math.cos(d.heading)),
    s = f(Math.sin(d.heading));
  return {
    x: f(f(f(along * c) - f(across * s)) * reach),
    y: f(f(f(along * s) + f(across * c)) * reach),
  };
}
export interface Drifting {
  shape: ShapeNode;
  drift?: Drift;
}
export interface WaterClock {
  waterAt: number;
  waterStill: boolean;
}
/**
 * Moves the drifting bands at most `waterRate` times a second, half that when zoomed out where the
 * drift is only a few pixels but the bands cover the screen. Returns whether anything moved.
 * `still` (reduced motion) parks every band at rest once.
 */
export function moveWater(
  clock: WaterClock,
  groups: readonly (readonly Drifting[])[],
  seconds: number,
  climate: Readonly<Climate>,
  still: boolean,
  zoom = 1,
): boolean {
  if (still) {
    if (clock.waterStill) return false;
    for (const group of groups)
      for (const band of group) if (band.drift) band.shape.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    clock.waterStill = true;
    return true;
  }
  const rate = zoom < f(0.5) ? waterRate / 2 : waterRate;
  if (!clock.waterStill && seconds >= clock.waterAt && f(seconds - clock.waterAt) < f(1 / rate)) return false;
  clock.waterAt = seconds;
  clock.waterStill = false;
  for (const group of groups)
    for (const band of group) {
      if (!band.drift) continue;
      const o = driftOffset(band.drift, seconds, climate);
      band.shape.transform([1, 0, o.x, 0, 1, o.y, 0, 0, 1]);
    }
  return true;
}
