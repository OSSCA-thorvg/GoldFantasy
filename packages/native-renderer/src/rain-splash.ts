// Rain hitting the ground: a fixed pool of short-lived splashes in tile space, rebuilt a few times a second into two shapes.
import { ShapeNode } from './paint';
import type { WorldRendererState } from './world-renderer-state';
import { Weather } from '../../engine/src/climate';
import { unproject, type Point } from '../../engine/src/geometry';
import { f32 as f, clamp, hash01 } from '../../engine/src/numeric';
import { Terrain, isWater } from '../../engine/src/world-types';

export interface SplashGround {
  terrainAt(p: Point): Terrain;
  /** Building id covering the point, or -1. */
  buildingAt(p: Point): number;
}
export enum SplashKind {
  None,
  Land,
  Water,
}
/** Most splashes ever alive. */
export const splashPool = 160;
export const splashRate = 15;
const life = f(0.42),
  tau = f(6.2831853);
interface Slot {
  cycle: number;
  x: number;
  y: number;
  kind: SplashKind;
}
interface Splashes {
  at: number;
  shown: boolean;
  slots: Slot[];
  wet: ShapeNode;
  rim: ShapeNode;
}
const splashesOf = new WeakMap<WorldRendererState, Splashes>();
function splashesFor(s: WorldRendererState): Splashes {
  let state = splashesOf.get(s);
  if (!state) {
    state = { at: -1, shown: false, slots: [], wet: new ShapeNode(), rim: new ShapeNode() };
    for (let i = 0; i < splashPool; ++i) state.slots.push({ cycle: -1, x: 0, y: 0, kind: SplashKind.None });
    s.splashes.add(state.wet).add(state.rim);
    splashesOf.set(s, state);
  }
  return state;
}
const groundKind = (terrain: Terrain): SplashKind =>
  isWater(terrain)
    ? SplashKind.Water
    : terrain === Terrain.Lava || terrain === Terrain.Ice || terrain === Terrain.Mountain
      ? SplashKind.None
      : SplashKind.Land;

/** How many splashes the current rain keeps alive; zero when dry, snowing, far out or still. */
export function splashCount(s: WorldRendererState): number {
  if (s.editorView || s.falling === Weather.Snow || s.reducedMotion || s.viewWidth <= 0 || s.shownWet < f(0.02)) return 0;
  const near = clamp(f(f(s.view.zoom - f(0.4)) / f(0.35)), 0, 1),
    area = f(f(s.viewWidth * s.viewHeight) / f(1280 * 800)),
    storm = s.falling === Weather.Storm;
  return clamp(
    Math.trunc(f(f(f(f((storm ? 130 : 70) * f(f(0.3) + f(f(0.7) * s.fallingIntensity))) * s.shownWet) * near) * area)),
    0,
    splashPool,
  );
}

/** Rebuilds the splashes at most `splashRate` times a second; returns how many were drawn. */
export function paintSplashes(s: WorldRendererState, ground: SplashGround, seconds: number): number {
  const count = splashCount(s);
  if (!count && !splashesOf.has(s)) return 0;
  const state = splashesFor(s);
  if (!count) {
    if (state.shown) {
      state.wet.reset();
      state.rim.reset();
      state.shown = false;
    }
    return 0;
  }
  if (state.shown && seconds >= state.at && f(seconds - state.at) < f(1 / splashRate)) return -1;
  state.at = seconds;
  state.shown = true;
  const { wet, rim } = state,
    halfW = f(f(s.viewWidth / 2) / s.view.zoom),
    halfH = f(f(s.viewHeight / 2) / s.view.zoom),
    big = s.falling === Weather.Storm ? f(1.25) : f(f(0.85) + f(f(0.25) * s.fallingIntensity));
  wet.reset();
  rim.reset();
  let drawn = 0;
  for (let i = 0; i < count; ++i) {
    const slot = state.slots[i],
      phase = f(f(seconds / life) + hash01(53, i, 0, 7)),
      cycle = Math.floor(phase),
      age = f(phase - cycle);
    if (slot.cycle !== cycle) {
      slot.cycle = cycle;
      const sx = f(f(s.view.x - halfW) + f(f(2 * halfW) * hash01(53, i, cycle, 1))),
        sy = f(f(s.view.y - halfH) + f(f(2 * halfH) * hash01(53, i, cycle, 2))),
        p = unproject(sx, sy);
      slot.x = p.x;
      slot.y = p.y;
      slot.kind = groundKind(ground.terrainAt(p));
      if (slot.kind === SplashKind.Land && ground.buildingAt(p) >= 0) slot.kind = SplashKind.None;
    }
    if (slot.kind === SplashKind.None) continue;
    ++drawn;
    const size = f(big * f(f(0.8) + f(f(0.4) * hash01(53, i, cycle, 3))));
    if (slot.kind === SplashKind.Water) {
      // A ring that opens out and thins away.
      const r = f(f(size * f(0.16)) * f(f(0.25) + f(f(0.75) * age)));
      if (age < f(0.85)) rim.appendCircle(slot.x, slot.y, r, r);
      continue;
    }
    // A dark wet spot with a crown of three ticks thrown out from it.
    const spot = f(f(size * f(0.055)) * f(1 - f(f(0.4) * age)));
    wet.appendCircle(slot.x, slot.y, spot, spot);
    if (age > f(0.6)) continue;
    const turn = f(hash01(53, i, cycle, 4) * tau),
      from = f(size * f(f(0.05) + f(f(0.1) * age))),
      to = f(from + f(f(size * f(0.08)) * f(1 - f(age / f(0.6)))));
    for (let k = 0; k < 3; ++k) {
      const a = f(turn + f(f(k * tau) / 3)),
        c = f(Math.cos(a)),
        n = f(Math.sin(a));
      rim.moveTo(f(slot.x + f(c * from)), f(slot.y + f(n * from))).lineTo(f(slot.x + f(c * to)), f(slot.y + f(n * to)));
    }
  }
  wet.fill(30, 40, 52, 70);
  rim
    .fill(0, 0, 0, 0)
    .strokeWidth(f(0.024))
    .strokeCap('round')
    .strokeFill(200, 214, 226, 135);
  return drawn;
}
