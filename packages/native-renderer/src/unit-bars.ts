// Thin flat health bars with a delayed chip, capped for a crowd, and the bleed-out ring over a downed resident.
import { distance, project, type Point } from '../../engine/src/geometry';
import { combatRules, MonsterRank } from '../../engine/src/combat-events';
import { Role, type Hit, type Person } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import { ShapeNode } from './paint';
import { appendArc, combatLayers, tone } from './combat-paint';
import { monsterHeight } from './monster-rank-look';
import type { WorldRendererState } from './world-renderer-state';

/** How long the chip holds after a blow before it starts to catch up, and its catch-up speed. */
export const chipHold = 0.4;
const chipRate = 0.9;
/** Below this many seconds the ring turns to the danger colour. */
const urgent = 10;

export interface BarTrack {
  shown: number;
  chip: number;
  hurtAt: number;
  seen: number;
  /** Highest health seen, standing in for an unknown full health. */
  most: number;
}
interface Shapes {
  back: ShapeNode;
  chip: ShapeNode;
  foe: ShapeNode;
  friend: ShapeNode;
  ringBack: ShapeNode;
  ring: ShapeNode;
  ringUrgent: ShapeNode;
}
interface BarState {
  town: Town;
  tracks: Map<string, BarTrack>;
  shapes: Shapes;
}
const states = new WeakMap<WorldRendererState, BarState>();
export function barTracksOf(s: WorldRendererState): ReadonlyMap<string, BarTrack> {
  return states.get(s)?.tracks ?? new Map();
}
export function barShapesOf(s: WorldRendererState): Readonly<Shapes> | undefined {
  return states.get(s)?.shapes;
}
/** Width, height and priority of each rank's bar: a den's is the clearest, a swarmer's the thinnest. */
const barStyle = (rank: MonsterRank): readonly [number, number, number] => {
  switch (rank) {
    case MonsterRank.Den:
      return [28, 3.6, 100];
    case MonsterRank.Guardian:
      return [30, 3.4, 90];
    case MonsterRank.Brute:
      return [20, 2.6, 50];
    case MonsterRank.Stalker:
      return [13, 2.6, 40];
    case MonsterRank.Swarmer:
      return [9, 1.6, 20];
    case MonsterRank.Spitter:
      return [9, 1.6, 25];
    default:
      return [16, 2.6, 40];
  }
};
/** Most bars drawn at once; the least important give way first. */
export const maxBars = 40;
const cell = (x: number, y: number) => Math.floor(x) * 65536 + Math.floor(y);

function track(state: BarState, key: string, fraction: number, health: number, now: number): BarTrack {
  let t = state.tracks.get(key);
  if (!t) {
    t = { shown: fraction, chip: fraction, hurtAt: -1, seen: now, most: health };
    state.tracks.set(key, t);
  }
  const dt = Math.max(0, Math.min(0.25, now - t.seen));
  if (fraction < t.shown - 1e-4) t.hurtAt = now;
  t.shown = fraction;
  if (fraction >= t.chip) t.chip = fraction;
  else if (now - t.hurtAt >= chipHold)
    t.chip = Math.max(fraction, t.chip - dt * (chipRate * 0.4 + (t.chip - fraction) * chipRate * 4));
  t.seen = now;
  t.most = Math.max(t.most, health);
  return t;
}
function bar(
  shapes: Shapes,
  fill: ShapeNode,
  x: number,
  y: number,
  width: number,
  height: number,
  t: BarTrack,
): void {
  shapes.back.appendRect(x - width / 2 - 1, y - 1, width + 2, height + 2, 1, 1);
  if (t.chip > t.shown)
    shapes.chip.appendRect(x - width / 2 + width * t.shown, y, width * (t.chip - t.shown), height);
  if (t.shown > 0) fill.appendRect(x - width / 2, y, width * t.shown, height);
}
const player = (p: Person) => p.faction === 0 && p.role === Role.Resident;

/** Redraws every bar and ring in a handful of shared shapes. */
export function updateUnitBars(s: WorldRendererState, town: Town, selected: readonly number[] = []): void {
  let state = states.get(s);
  if (!state || state.town !== town) {
    const shapes: Shapes = {
      back: new ShapeNode().fill(...tone.ink, 215),
      chip: new ShapeNode().fill(...tone.peach),
      foe: new ShapeNode().fill(...tone.rust),
      friend: new ShapeNode().fill(...tone.leaf),
      ringBack: new ShapeNode().fill(...tone.ink, 200),
      ring: new ShapeNode().fill(...tone.peach),
      ringUrgent: new ShapeNode().fill(...tone.rust),
    };
    if (state) for (const shape of Object.values(state.shapes)) combatLayers(s).bars.remove(shape);
    state = { town, tracks: new Map(), shapes };
    states.set(s, state);
  }
  const { shapes } = state,
    layer = combatLayers(s).bars;
  for (const shape of Object.values(shapes)) {
    shape.reset();
    if (!layer.children.includes(shape)) layer.add(shape);
  }
  const now = town.clock(),
    seen = new Set<string>(),
    chosen = new Set(selected),
    // Recent blows by tile, so a crowd costs a lookup per monster instead of a scan of every blow.
    struck = new Map<number, Hit[]>();
  for (const h of town.hits()) {
    if (now - h.at >= 3 || now < h.at) continue;
    for (const at of [h.to, h.from]) {
      const key = cell(at.x, at.y),
        list = struck.get(key);
      if (list) list.push(h);
      else struck.set(key, [h]);
    }
  }
  const touched = (at: Point) => {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const h of struck.get(cell(at.x + dx, at.y + dy)) ?? [])
          if (distance(h.to, at) < 0.7 || distance(h.from, at) < 0.05) return true;
    return false;
  };
  const wanted: { priority: number; draw: () => void }[] = [];
  for (const m of town.monsters()) {
    if (m.insideLair || s.currentVisibility.sample(m.position) < 119) continue;
    const key = `m${m.id}`,
      before = state.tracks.get(key),
      full = m.vigor > 0 ? m.vigor : Math.max(before?.most ?? 0, m.health),
      fraction = full > 0 ? Math.max(0, Math.min(1, m.health / full)) : 1,
      [width, height, rank] = barStyle(m.rank ?? MonsterRank.Grunt),
      t = track(state, key, fraction, m.health, now);
    seen.add(key);
    const unhurt = fraction >= 0.999 && t.chip <= t.shown,
      thin = height < 2;
    // A den is always worth its bar; an unhurt swarmer never is.
    if (unhurt && m.rank !== MonsterRank.Den && (thin || !(m.windupUntil > now || touched(m.position)))) continue;
    wanted.push({
      priority: rank + (now - t.hurtAt < 1 ? 8 : 0) + (1 - fraction) * 6,
      draw: () => {
        const foot = project(m.position.x, m.position.y);
        bar(shapes, shapes.foe, foot.x, foot.y - monsterHeight(town, m, s) - (thin ? 5 : 8), width, height, t);
      },
    });
  }
  for (const p of town.people()) {
    if (!player(p) || p.inside || p.visibility() < 0.5 || s.currentVisibility.sample(p.position) < 119)
      continue;
    const foot = project(p.position.x, p.position.y);
    if (p.downedAt >= 0) {
      const left = town.bleedOutLeft?.(p) ?? Math.max(0, p.downedAt + combatRules.bleedOut - now),
        total = Math.max(0.001, left + Math.max(0, now - p.downedAt)),
        share = Math.max(0, Math.min(1, left / total)),
        cx = foot.x,
        cy = foot.y - 19;
      appendArc(shapes.ringBack, cx, cy, 6.4, 6.4, 3, 0, 1);
      appendArc(left < urgent ? shapes.ringUrgent : shapes.ring, cx, cy, 5.7, 5.7, 1.6, 1 - share, 1);
      continue;
    }
    const key = `p${p.id}`,
      fraction = Math.max(0, Math.min(1, p.health)),
      t = track(state, key, fraction, p.health, now);
    seen.add(key);
    if (fraction >= 0.995 && !chosen.has(p.id) && t.chip <= t.shown) continue;
    wanted.push({
      priority: (chosen.has(p.id) ? 85 : 70) + (1 - fraction) * 10,
      draw: () => bar(shapes, shapes.friend, foot.x, foot.y - 31, 14, 2.2, t),
    });
  }
  if (wanted.length > maxBars) wanted.sort((a, b) => b.priority - a.priority);
  for (let i = 0; i < Math.min(maxBars, wanted.length); i++) wanted[i].draw();
  for (const key of state.tracks.keys()) if (!seen.has(key)) state.tracks.delete(key);
}
