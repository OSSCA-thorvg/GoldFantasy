import { point, add, project } from '../../engine/src/geometry';
import { f32, clamp, lround } from '../../engine/src/numeric';
import { Town } from '../../engine/src/town';
import { WorldRendererState } from './world-renderer-state';
import { Flicker, flare, brightest } from './light-flicker';
import { weather, drift } from './world-weather';
export function animate(s: WorldRendererState, town: Town, seconds: number): void {
  const elapsed = s.lastAnimate < 0 ? 0 : f32(seconds - s.lastAnimate);
  s.lastAnimate = seconds;
  const eyes = lround(f32(255 * clamp(f32(f32(town.climate().night * f32(1.5)) - f32(0.3)), 0, 1)));
  for (const glint of s.ymirGlints) glint?.opacity(eyes);
  for (const [id, item] of s.visuals) {
    const b = town.building(id),
      frame =
        b && !b.built()
          ? f32(f32(b.progress * item.layout.frames) * f32(0.92))
          : Math.min(item.layout.frames, f32(item.frame + f32(elapsed * item.layout.frameRate)));
    if (frame !== item.frame) {
      item.picture.frame(Math.min(frame, f32(item.layout.frames - 1)));
      item.frame = frame;
    }
  }
  const climate = town.climate(),
    dark = climate.night > f32(0.002);
  s.darkness.opacity(dark ? 255 : 0);
  s.warmth.opacity(dark ? 255 : 0);
  s.darkVeil?.fill(4, 6, 22, Math.trunc(f32(170 * climate.night)));
  s.lights.opacity(Math.trunc(f32(70 + f32(100 * climate.night))));
  weather(s, climate, seconds);
  drift(s, climate, seconds);
  if (seconds - s.lastFlicker < 1 / 20) return;
  s.lastFlicker = seconds;
  const t = f32(seconds);
  for (let i = 0; i < s.pulses.length; i++)
    s.pulses[i].opacity(Math.trunc(f32(170 + f32(f32(Math.sin(f32(f32(t * f32(2.2)) + i))) * 70))));
  for (let i = 0; i < s.wispPaints.length; i++) {
    const wisp = s.wisps[i],
      phase = f32(f32(t * f32(f32(0.7) + f32(f32(0.13) * (i % 5)))) + f32(i * f32(2.1)));
    s.wispPaints[i].transform([
      1,
      0,
      f32(wisp.center.x + f32(f32(Math.cos(phase)) * wisp.radius)),
      0,
      1,
      f32(
        f32(f32(wisp.center.y - 22) + f32(f32(f32(Math.sin(phase)) * wisp.radius) * f32(0.45))) +
          f32(f32(Math.sin(f32(f32(t * f32(2.6)) + i))) * 4),
      ),
      0,
      0,
      1,
    ]);
  }
  for (const pool of s.pools) {
    const f = flare(pool.flicker, pool.center, seconds),
      at = add(pool.center, f.sway),
      reach = f.reach,
      squash = f32(pool.ry / pool.rx);
    if (pool.glow) {
      const m = pool.glowAt;
      pool.glow.transform([
        f32(m[0] * reach),
        m[1],
        f32(m[2] + f.sway.x),
        m[3],
        f32(m[4] * reach),
        f32(m[5] + f.sway.y),
        m[6],
        m[7],
        m[8],
      ]);
    }
    if (pool.halo) {
      const swell = f32(1 + f32(2 * f32(f.brightness - 1)));
      pool.halo.transform([
        swell,
        0,
        f32(pool.flame.x * f32(1 - swell)),
        0,
        swell,
        f32(pool.flame.y * f32(1 - swell)),
        0,
        0,
        1,
      ]);
    }
    if (!pool.hole) continue;
    pool.hole.transform([reach, 0, at.x, 0, f32(reach * squash), at.y, 0, 0, 1]);
    pool.hole.opacity(Math.trunc(f32(f32(255 * f.brightness) / brightest)));
    if (!pool.tint) continue;
    pool.tint.transform([
      reach,
      0,
      at.x,
      0,
      f32(reach * squash),
      f32(at.y - f32(pool.ry * f32(0.25))),
      0,
      0,
      1,
    ]);
    pool.tint.opacity(Math.trunc(f32(f32(90 * climate.night) * f.brightness)));
  }
  if (!s.flame) return;
  const p = s.firePosition,
    fire = flare(Flicker.Fire, p, seconds),
    lift = f32(f32(fire.brightness - 1) * 20),
    lean = f32(fire.sway.x * f32(0.8)),
    a = f32(f32(f32(Math.sin(f32(t * f32(9.1)))) * f32(1.6)) + lean),
    b = f32(f32(f32(Math.sin(f32(f32(t * f32(13.7)) + 1))) * f32(2.2)) + lean),
    c = f32(f32(Math.sin(f32(f32(t * f32(7.3)) + 2))) * f32(1.2));
  s.flame
    .reset()
    .moveTo(f32(p.x - 5), p.y)
    .cubicTo(
      f32(p.x - 6),
      f32(p.y - 6),
      f32(f32(p.x - 2) + a),
      f32(p.y - 9),
      f32(f32(p.x - 1) + a),
      f32(f32(f32(p.y - 15) + c) - lift),
    )
    .cubicTo(
      f32(p.x + 1),
      f32(p.y - 10),
      f32(f32(p.x + 3) + b),
      f32(p.y - 12),
      f32(f32(p.x + 2) + b),
      f32(f32(f32(p.y - 18) - c) - lift),
    )
    .cubicTo(f32(p.x + 6), f32(p.y - 10), f32(p.x + 7), f32(p.y - 5), f32(p.x + 5), p.y)
    .close()
    .fill(226, 104, 40);
  s.flameCore!.reset()
    .moveTo(f32(p.x - f32(2.6)), p.y)
    .cubicTo(
      f32(p.x - 3),
      f32(p.y - 4),
      f32(p.x + f32(a * f32(0.5))),
      f32(p.y - 6),
      f32(p.x + f32(a * f32(0.6))),
      f32(f32(f32(p.y - 10) + c) - f32(lift * f32(0.6))),
    )
    .cubicTo(f32(p.x + 2), f32(p.y - 6), f32(p.x + f32(3.4)), f32(p.y - 3), f32(p.x + f32(2.6)), p.y)
    .close()
    .fill(255, 200, 96);
}
