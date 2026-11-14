// An eased camera move toward a place in the world, stepped once per frame.
import { project, type Camera, type Point } from '../../../../packages/engine/src/geometry';
import { clamp, f32 } from '../../../../packages/engine/src/numeric';

export interface CameraGlide {
  from: Point;
  /** Projected screen-space point the camera centres on at the end. */
  to: Point;
  start: number;
  seconds: number;
}
export const glideSeconds = 0.6;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function glideTo(camera: Camera, world: Point, now: number, seconds = glideSeconds): CameraGlide {
  return { from: { x: camera.x, y: camera.y }, to: project(world.x, world.y), start: now, seconds };
}
/** Moves the camera along the glide; false once it has arrived. */
export function stepGlide(camera: Camera, glide: CameraGlide, now: number): boolean {
  const t = glide.seconds > 0 ? clamp((now - glide.start) / glide.seconds, 0, 1) : 1,
    k = ease(t);
  camera.x = f32(glide.from.x + (glide.to.x - glide.from.x) * k);
  camera.y = f32(glide.from.y + (glide.to.y - glide.from.y) * k);
  return t < 1;
}
/** True when `world` already sits well inside the view, so there is nothing to glide to. */
export function inView(camera: Camera, world: Point, width: number, height: number, margin = 0.2): boolean {
  const p = project(world.x, world.y),
    s = camera.toScreen(p, width, height);
  return s.x >= width * margin && s.x <= width * (1 - margin) && s.y >= height * margin && s.y <= height * (1 - margin);
}
