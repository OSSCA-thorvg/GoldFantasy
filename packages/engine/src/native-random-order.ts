import { Point, point, rotated } from './geometry';
import { f32 as f } from './numeric';
// The captured native GCC build evaluates the angle argument before the radius argument in
// rotated({base + roll()*range, 0}, roll()*turn). Make that native RNG consumption explicit.
export function nativeRandomRadial(roll: () => number, base: number, range: number, turn: number): Point {
  const angle = f(roll() * f(turn)), radius = f(f(base) + f(roll() * f(range)));
  return rotated(point(radius, 0), angle);
}
