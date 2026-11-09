import { point, type Point } from '../../engine/src/geometry';
import { f32 as f, hash01 } from '../../engine/src/numeric';
export enum Flicker {
  Fire,
  Flame,
  Hearth,
  Magic,
}
export interface Flare {
  brightness: number;
  reach: number;
  sway: Point;
}
export const brightest = f(1.25);
function wander(at: Point, seconds: number, rate: number, voice: number): number {
  const x = seconds * rate,
    whole = Math.floor(x);
  let t = f(x - whole);
  t = f(f(t * t) * f(3 - f(2 * t)));
  const value = (step: number) => f(f(2 * hash01(voice, Math.trunc(at.x), Math.trunc(at.y), step >>> 0)) - 1),
    a = value(whole),
    b = value(whole + 1);
  return f(a + f(f(b - a) * t));
}
export function flare(kind: Flicker, at: Point, seconds: number): Flare {
  const layer = (rate: number, voice: number) => wander(at, seconds, rate, voice),
    result: Flare = { brightness: 1, reach: 1, sway: point() };
  switch (kind) {
    case Flicker.Fire:
      result.brightness = f(
        1 +
          f(
            f(0.25) *
              f(f(f(f(0.55) * layer(2.1, 1)) + f(f(0.3) * layer(4.7, 2))) + f(f(0.15) * layer(7.9, 3))),
          ),
      );
      result.sway = point(f(f(2.4) * layer(1.3, 4)), f(f(0.8) * layer(1.7, 5)));
      break;
    case Flicker.Flame:
      result.brightness = f(1 + f(f(0.17) * f(f(f(0.65) * layer(1.6, 1)) + f(f(0.35) * layer(6.2, 2)))));
      break;
    case Flicker.Hearth:
      result.brightness = f(1 + f(f(0.11) * f(f(f(0.7) * layer(0.9, 1)) + f(f(0.3) * layer(3.7, 2)))));
      break;
    case Flicker.Magic: {
      const phase = 6.2832 * hash01(6, Math.trunc(at.x), Math.trunc(at.y));
      result.brightness = f(
        1 + f(f(0.14) * f(f(f(0.75) * f(Math.sin(seconds * 2 + phase))) + f(f(0.25) * layer(2.4, 1)))),
      );
      break;
    }
  }
  result.reach = f(Math.sqrt(result.brightness));
  return result;
}
