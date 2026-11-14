// Posed outlines over the people and monsters that stand behind a tree canopy or a peak.
import { project, type Point } from '../../engine/src/geometry';
import type { Monster } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import { SceneNode, ShapeNode, type PaintNode } from './paint';
import { tone } from './combat-paint';
import { monsterHeight } from './monster-rank-look';
import { pickSource } from './world-pick-registry';
import type { Figure, Sprite, WorldRendererState } from './world-renderer-state';
import type { WorldObjectRef } from './world-picking-types';
import { monsterParts } from './world-sprites';
import { Draft } from './ghost-trace';
import { monsterMotion, traceMonster, traceResident, type GhostArea, type MonsterMotion } from './ghost-figures';

/** A resident's drawn height; monsters use their rank's. */
const residentHeight = 24;
/** Seconds between coverage passes; outlines follow their units in between. */
const coverageEvery = 0.1;
/** Seconds between redraws of the outlines: thirty poses a second, whatever the frame rate. */
const redrawEvery = 1 / 32;
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
  /** Where a click finds it, in world pixels: the posed body's box and the head. */
  areas: GhostArea[];
}
interface GhostState {
  town: Town;
  rows: Map<number, RowIndex>;
  /** Units whose head or chest the last pass found covered, with their drawn height. */
  covered: Map<string, number>;
  checkedAt: number;
  drawnAt: number;
  ghosts: Ghost[];
  friend: ShapeNode;
  foe: ShapeNode;
  /** This frame's outlines and the last ones drawn, per side. */
  drafts: { friend: Draft; foe: Draft };
  motions: Map<number, MonsterMotion>;
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
  figure?: Figure;
  beast?: Monster;
  sprite?: Sprite;
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
      figure,
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
      beast: m,
      sprite,
    });
  }
  return list;
}
/** A ghost's hit area in world pixels: the posed body's box and the head. */
export const ghostAreas = (g: Ghost): readonly GhostArea[] => g.areas;
/** Whether a ghost touches a box in world pixels, with `pad` pixels of slack for a finger. */
export function ghostTouches(g: Ghost, box: { x: number; y: number; w: number; h: number }, pad = 0): boolean {
  return g.areas.some((e) => {
    const nx = Math.max(box.x, Math.min(e.x, box.x + box.w)) - e.x,
      ny = Math.max(box.y, Math.min(e.y, box.y + box.h)) - e.y;
    return e.box
      ? Math.abs(nx) <= e.rx + pad && Math.abs(ny) <= e.ry + pad
      : (nx / (e.rx + pad)) ** 2 + (ny / (e.ry + pad)) ** 2 <= 1;
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
    // Outlines only, so the tree or peak in front still reads through them. The foe's line is finer:
    // its figures are smaller and many, and a heavier line would run a pack together.
    const outline = (color: readonly [number, number, number], width: number) =>
        new ShapeNode().strokeWidth(width).strokeJoin('round').strokeCap('round').strokeFill(...color, 235),
      friend = outline(tone.peach, 1.6),
      foe = outline(tone.rust, 1.25);
    s.ghosts.remove();
    s.ghosts.add(foe).add(friend);
    state = {
      town,
      rows: new Map(),
      covered: new Map(),
      checkedAt: -Infinity,
      drawnAt: -Infinity,
      ghosts: [],
      friend,
      foe,
      drafts: { friend: new Draft(), foe: new Draft() },
      motions: new Map(),
      units: 0,
      tested: 0,
    };
    states.set(s, state);
  }
  // The outlines follow their units at a steady pace; between redraws the last ones stand.
  const covering = seconds - state.checkedAt >= coverageEvery || seconds < state.checkedAt;
  if (!covering && seconds - state.drawnAt < redrawEvery && seconds >= state.drawnAt) return;
  state.drawnAt = seconds;
  const units = shown(s, town);
  if (covering) {
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
  const { drafts } = state;
  drafts.friend.clear();
  drafts.foe.clear();
  for (const u of units) {
    const height = state.covered.get(u.key);
    if (height === undefined) continue;
    let areas: GhostArea[] | null = null;
    if (u.figure) areas = traceResident(drafts.friend, u.figure);
    else if (u.beast && u.sprite) {
      let motion = state.motions.get(u.beast.id);
      if (!motion || motion.rank !== u.beast.rank) state.motions.set(u.beast.id, (motion = monsterMotion(town, u.beast)));
      areas = traceMonster(drafts.foe, town, u.beast, u.sprite.paint, monsterParts(u.sprite.paint)?.body, motion);
    }
    if (areas) state.ghosts.push({ ref: u.ref, foot: { ...u.at }, height, hostile: u.hostile, lying: u.lying, areas });
  }
  // A monster's stride and blow are kept only while it stays hidden.
  if (state.motions.size > state.ghosts.length * 2 + 16)
    for (const id of state.motions.keys()) if (!state.covered.has(`m${id}`)) state.motions.delete(id);
  // Each side is sent again only when its outlines changed, so a still scene costs no path upload.
  drafts.friend.present(state.friend);
  drafts.foe.present(state.foe);
}
