// Flat translucent silhouettes over the people and monsters that stand behind a tree canopy or a peak.
import { project, type Point } from '../../engine/src/geometry';
import type { Town } from '../../engine/src/town';
import { SceneNode, ShapeNode, type PaintNode } from './paint';
import { tone } from './combat-paint';
import { monsterHeight } from './monster-rank-look';
import { pickSource } from './world-pick-registry';
import type { WorldRendererState } from './world-renderer-state';
import type { WorldObjectRef } from './world-picking-types';

/** A resident's drawn height; monsters use their rank's. */
const residentHeight = 24;
/** Seconds between coverage passes; ghosts follow their units every frame in between. */
const coverageEvery = 0.1;
/** Tallest occluder a pass looks for, in screen pixels: the highest summit. */
const tallest = 280;

interface Occluder {
  /** Screen y of the foot: it hides only what stands behind that. */
  foot: number;
  x: number;
  left: number;
  right: number;
  top: number;
  polygons: Float32Array[];
}
interface RowIndex {
  children: readonly PaintNode[];
  length: number;
  /** Sorted by foot x. */
  items: Occluder[];
  /** Widest half of any item, to bound the search by x. */
  reach: number;
}
export interface Ghost {
  ref: WorldObjectRef;
  /** Tile position of the unit's feet. */
  foot: Point;
  height: number;
  hostile: boolean;
  lying: boolean;
}
interface GhostState {
  town: Town;
  rows: Map<number, RowIndex>;
  /** Units whose head or chest the last pass found covered, with their drawn height. */
  covered: Map<string, number>;
  checkedAt: number;
  ghosts: Ghost[];
  friend: ShapeNode;
  foe: ShapeNode;
  drawn: string;
  /** Units and occluders the last pass looked at. */
  units: number;
  tested: number;
}
const states = new WeakMap<WorldRendererState, GhostState>();

function polygonsOf(scene: PaintNode, out: Float32Array[]): void {
  if (scene instanceof SceneNode) for (const child of scene.children) polygonsOf(child, out);
  if (!(scene instanceof ShapeNode)) return;
  let run: number[] = [];
  const end = () => {
    if (run.length >= 6) out.push(Float32Array.from(run));
    run = [];
  };
  for (const c of scene.commands) {
    if (c[0] === 'M') {
      end();
      run.push(c[1], c[2]);
    } else if (c[0] === 'L') run.push(c[1], c[2]);
    else if (c[0] === 'C') run.push(c[5], c[6]);
    else if (c[0] === 'Z') end();
    else if (c[0] === 'R') {
      end();
      const [, x, y, w, h] = c;
      out.push(Float32Array.of(x, y, x + w, y, x + w, y + h, x, y + h));
    }
  }
  end();
}
function inside(px: number, py: number, poly: Float32Array): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[i],
      ay = poly[i + 1],
      bx = poly[j],
      by = poly[j + 1];
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) yes = !yes;
  }
  return yes;
}
/** The trees and peaks of one diagonal row as silhouettes, rebuilt only when the row's paints change. */
function rowIndex(s: WorldRendererState, state: GhostState, row: number): RowIndex | undefined {
  const scene = s.rowTrees[row];
  if (!scene) return undefined;
  const old = state.rows.get(row);
  if (old && old.children === scene.children && old.length === scene.children.length) return old;
  const items: Occluder[] = [];
  let reach = 0;
  for (const paint of scene.children) {
    const source = pickSource(paint);
    // Trees and peaks; a stone deposit is too low to hide anyone.
    if (!source || (source.ref && source.ref.kind !== 'tree')) continue;
    const polygons: Float32Array[] = [];
    polygonsOf(paint, polygons);
    if (!polygons.length) continue;
    const foot = project(source.foot.x, source.foot.y);
    let left = Infinity,
      right = -Infinity,
      top = Infinity;
    for (const poly of polygons)
      for (let i = 0; i < poly.length; i += 2) {
        left = Math.min(left, poly[i]);
        right = Math.max(right, poly[i]);
        top = Math.min(top, poly[i + 1]);
      }
    reach = Math.max(reach, foot.x - left, right - foot.x);
    items.push({ foot: foot.y, x: foot.x, left, right, top, polygons });
  }
  items.sort((a, b) => a.x - b.x);
  const index = { children: scene.children, length: scene.children.length, items, reach };
  state.rows.set(row, index);
  return index;
}
/** Whether a screen point is hidden by a tree or peak whose foot is in front of `foot`. */
function hidden(s: WorldRendererState, state: GhostState, px: number, py: number, foot: number): boolean {
  const first = Math.max(0, Math.floor(foot / 16) - 2),
    last = Math.min(s.rowTrees.length - 1, Math.ceil((py + tallest) / 16) + 1);
  for (let row = first; row <= last; row++) {
    const index = rowIndex(s, state, row);
    if (!index?.items.length) continue;
    const items = index.items;
    let low = 0,
      high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (items[mid].x < px - index.reach) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < items.length && items[i].x <= px + index.reach; i++) {
      const o = items[i];
      if (o.foot <= foot || px < o.left || px > o.right || py < o.top || py > o.foot + 40) continue;
      state.tested++;
      for (const poly of o.polygons) if (inside(px, py, poly)) return true;
    }
  }
  return false;
}
interface Seen {
  key: string;
  ref: WorldObjectRef;
  at: Point;
  hostile: boolean;
  lying: boolean;
  height: () => number;
}
/** Who is drawn now: the figure rules already decided sight, fog, buildings and the worlds beyond the gates. */
function shown(s: WorldRendererState, town: Town): Seen[] {
  const list: Seen[] = [];
  for (const p of town.people()) {
    const figure = s.figures.get(p.id);
    if (!figure?.seen || !figure.paint.alpha || p.inside) continue;
    list.push({
      key: `p${p.id}`,
      ref: { kind: 'person', id: p.id },
      at: p.position,
      hostile: false,
      lying: p.downedAt >= 0,
      height: () => residentHeight,
    });
  }
  for (const m of town.monsters()) {
    const sprite = s.beasts.get(m.id);
    if (!sprite?.seen || !sprite.paint.alpha || m.insideLair || m.health <= 0) continue;
    list.push({
      key: `m${m.id}`,
      ref: { kind: 'monster', id: m.id },
      at: m.position,
      hostile: true,
      lying: false,
      height: () => monsterHeight(town, m, s),
    });
  }
  return list;
}
/** The ellipses of a ghost in world pixels, for drawing and for picking. */
export function ghostEllipses(g: Ghost): { x: number; y: number; rx: number; ry: number }[] {
  const at = project(g.foot.x, g.foot.y),
    h = g.height;
  return g.lying
    ? [
        { x: at.x, y: at.y - h * 0.12, rx: h * 0.42, ry: h * 0.16 },
        { x: at.x - h * 0.42, y: at.y - h * 0.16, rx: h * 0.15, ry: h * 0.15 },
      ]
    : [
        { x: at.x, y: at.y - h * 0.36, rx: h * (g.hostile ? 0.3 : 0.24), ry: h * 0.36 },
        { x: at.x, y: at.y - h * 0.8, rx: h * 0.16, ry: h * 0.16 },
      ];
}
/** Whether a ghost touches a box in world pixels, with `pad` pixels of slack for a finger. */
export function ghostTouches(g: Ghost, box: { x: number; y: number; w: number; h: number }, pad = 0): boolean {
  return ghostEllipses(g).some((e) => {
    const nx = Math.max(box.x, Math.min(e.x, box.x + box.w)) - e.x,
      ny = Math.max(box.y, Math.min(e.y, box.y + box.h)) - e.y;
    return (nx / (e.rx + pad)) ** 2 + (ny / (e.ry + pad)) ** 2 <= 1;
  });
}
/** The ghosts drawn this frame. */
export const hiddenUnitGhosts = (s: WorldRendererState): readonly Ghost[] => states.get(s)?.ghosts ?? [];
/** Units and occluder silhouettes the last coverage pass looked at. */
export function ghostWork(s: WorldRendererState): { units: number; tested: number } {
  const state = states.get(s);
  return { units: state?.units ?? 0, tested: state?.tested ?? 0 };
}
export function updateHiddenUnitGhosts(s: WorldRendererState, town: Town, seconds: number): void {
  let state = states.get(s);
  if (!state || state.town !== town) {
    const friend = new ShapeNode().fill(...tone.peach, 170),
      foe = new ShapeNode().fill(...tone.rust, 190);
    s.ghosts.remove();
    s.ghosts.add(foe).add(friend);
    state = {
      town,
      rows: new Map(),
      covered: new Map(),
      checkedAt: -Infinity,
      ghosts: [],
      friend,
      foe,
      drawn: '',
      units: 0,
      tested: 0,
    };
    states.set(s, state);
  }
  const units = shown(s, town);
  if (seconds - state.checkedAt >= coverageEvery || seconds < state.checkedAt) {
    state.checkedAt = seconds;
    state.covered.clear();
    state.units = units.length;
    state.tested = 0;
    for (const u of units) {
      const foot = project(u.at.x, u.at.y),
        h = u.lying ? residentHeight * 0.3 : u.height();
      // Head or chest behind the canopy: the figure is mostly lost among the trees.
      if (hidden(s, state, foot.x, foot.y - h * 0.8, foot.y) || hidden(s, state, foot.x, foot.y - h * 0.5, foot.y))
        state.covered.set(u.key, u.lying ? residentHeight : h);
    }
  }
  state.ghosts = [];
  let drawn = '';
  for (const u of units) {
    const height = state.covered.get(u.key);
    if (height === undefined) continue;
    state.ghosts.push({ ref: u.ref, foot: { ...u.at }, height, hostile: u.hostile, lying: u.lying });
    drawn += `${u.key}:${u.at.x}:${u.at.y}:${u.lying};`;
  }
  // Rebuilt only when someone moved, so a still scene costs no path upload.
  if (drawn === state.drawn) return;
  state.drawn = drawn;
  state.friend.reset();
  state.foe.reset();
  for (const g of state.ghosts)
    for (const e of ghostEllipses(g)) (g.hostile ? state.foe : state.friend).appendCircle(e.x, e.y, e.rx, e.ry);
}
