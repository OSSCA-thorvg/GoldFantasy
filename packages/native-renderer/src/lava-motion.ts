// Molten lava: bands that crawl, cores that breathe, and light that reaches only lava the player can see.
import { project, point, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { Rect } from '../../native-ui/src/types';
import { SceneNode, ShapeNode, type PaintNode, type Rgb, type Rgba } from './paint';
import { opaque, softDisc } from './vector-paint';
import { region, RESOLUTION, type Sample } from './contours';
import { appendBlob, type Local } from './flat-forms';
import { drift, driftOffset, Liquid, type Drift } from './water-motion';
import { isoLayer, type WorldRendererState } from './world-renderer-state';
import { viewRect } from './world-depth';
import type { Climate, TerrainMap, TileRegion } from './render-types';
import type { Tint, Tinted } from './terrain-painter';
import { placeFloe } from './volcano-painter';
const f = Math.fround;
/** Lava is cut into cells this many tiles wide, so each is shown, moved and lit on its own. */
export const lavaCell = 8;
/** Updates a second; lava crawls, so fewer than the water's twelve still read as smooth. */
export const lavaRate = 6;
const hot: Rgb = [252, 180, 84],
  warmth: Rgb = [200, 82, 30];
/** Light reach round a lava cell, in screen pixels. */
export const lavaLight = { rx: 230, ry: 115 };
interface Band {
  shape: ShapeNode;
  drift: Drift;
}
interface Spot {
  node: ShapeNode;
  at: Point;
  phase: number;
  period: number;
}
export interface LavaLights {
  /** The molten outline itself: night does not dim it. */
  cut: PaintNode;
  hole: PaintNode;
  tint: PaintNode;
}
export interface LavaPatch {
  area: TileRegion;
  /** Screen box of the cell and its light, for culling. */
  box: Rect;
  center: Point;
  bands: Band[];
  /** Breathing cores, clipped to the molten band; hidden with the cell. */
  glow: SceneNode;
  spots: Spot[];
  outline: ShapeNode;
  lights?: LavaLights;
  phase: number;
  period: number;
  shown: boolean;
  rested: boolean;
  seenAt: number;
  seen: boolean;
  /** Whether the outline is cut through the night veil: lava ever explored and on screen. */
  cut: boolean;
  knownAt: number;
  known: boolean;
}
const patchesOf = new WeakMap<object, LavaPatch[]>();
/** The lava cells painted into a ground layer. */
export const lavaPatches = (ground: object): readonly LavaPatch[] => patchesOf.get(ground) ?? [];
const ease = (t: number) => f(f(t * t) * f(3 - f(2 * t)));
/** 0 at rest, 1 at the height of a breath: a quicker swell, a slower settle. */
export function breath(seconds: number, period: number, phase: number): number {
  const t = f((((seconds / period + phase) % 1) + 1) % 1);
  return t < f(0.4) ? ease(f(t / f(0.4))) : f(1 - ease(f(f(t - f(0.4)) / f(0.6))));
}
function spotShape(salt: number, k: number, r: number): ShapeNode {
  const points: Local[] = [];
  for (let n = 0; n < 7; n++) {
    const a = f(f(n * f(0.8976)) + f(hash01(salt, k, n, 871) * f(0.4))),
      reach = f(r * f(f(0.75) + f(f(0.4) * hash01(salt, k, n, 872))));
    points.push([f(f(Math.cos(a)) * reach), f(f(Math.sin(a)) * reach)]);
  }
  return appendBlob(new ShapeNode(), point(), points).fill(...opaque(hot));
}
/**
 * Paints the molten bands (base, hot and core) cell by cell into `iso`, after the static crust bands.
 * `lava(inset)` is the field of the flow; the tints take the colours, the cells keep the motion.
 */
export function paintLava(
  iso: SceneNode,
  map: TerrainMap,
  tints: Tinted[],
  lava: (inset: number) => Sample,
  base: Tint,
  area?: TileRegion,
): void {
  const patches: LavaPatch[] = [],
    // Phases hang on position alone, so a repaint keeps every flow in its own step.
    seed = 0,
    molten = lava(0),
    width = map.width(),
    height = map.height(),
    // Band by band across all cells, so the edges where cells overlap blend a colour with itself.
    layers = [new SceneNode(), new SceneNode(), new SceneNode()],
    glows = new SceneNode();
  for (let top = 0; top < height; top += lavaCell)
    for (let left = 0; left < width; left += lavaCell) {
      const cell = {
        left,
        top,
        right: Math.min(width, left + lavaCell),
        bottom: Math.min(height, top + lavaCell),
      };
      if (
        area &&
        (cell.right <= area.left ||
          cell.left >= area.right ||
          cell.bottom <= area.top ||
          cell.top >= area.bottom)
      )
        continue;
      let count = 0,
        sx = 0,
        sy = 0;
      for (let j = cell.top * RESOLUTION; j <= cell.bottom * RESOLUTION; ++j)
        for (let i = cell.left * RESOLUTION; i <= cell.right * RESOLUTION; ++i)
          if (molten(i, j) >= 0) {
            ++count;
            sx += i;
            sy += j;
          }
      if (!count) continue;
      // Neighbouring cells overlap by a tile and drift as one, so no seam opens between them.
      const zone = {
        left: Math.max(area?.left ?? 0, cell.left - 1),
        top: Math.max(area?.top ?? 0, cell.top - 1),
        right: Math.min(area?.right ?? width, cell.right + 1),
        bottom: Math.min(area?.bottom ?? height, cell.bottom + 1),
      };
      const bands: Band[] = [],
        index = patches.length;
      for (const [k, [inset, color, reach, period, salt]] of (
        [
          [0, base, 0.04, 34, 31],
          [0.05, (): Rgba => opaque([204, 92, 34]), 0.07, 29, 32],
          [0.13, (): Rgba => opaque([240, 150, 56]), 0.09, 24, 33],
        ] as const
      ).entries()) {
        const shape = region(map, 0, lava(inset), { x: 0, y: 0 }, zone);
        tints.push({ shape, color, stroke: false });
        layers[k].add(shape);
        bands.push({ shape, drift: drift(Liquid.Lava, f(reach), period, salt) });
      }
      const clip = region(map, 0, lava(0.05), { x: 0, y: 0 }, zone).fill(255, 255, 255),
        glow = new SceneNode().clip(clip);
      bands.push({ shape: clip, drift: bands[1].drift });
      // Up to two breathing cores per cell, where the flow runs hottest, a few tiles apart.
      const core = lava(0.13),
        hotter = lava(0.05),
        found: Point[] = [];
      for (const field of [core, hotter]) {
        const candidates: { at: Point; order: number }[] = [];
        for (let j = cell.top * RESOLUTION; j < cell.bottom * RESOLUTION; ++j)
          for (let i = cell.left * RESOLUTION; i < cell.right * RESOLUTION; ++i)
            if (field(i, j) >= f(0.01))
              candidates.push({
                at: point(f(i / RESOLUTION), f(j / RESOLUTION)),
                order: hash01(seed, i, j, 873),
              });
        candidates.sort((a, b) => a.order - b.order);
        for (const c of candidates)
          if (found.length < 2 && found.every((p) => Math.hypot(p.x - c.at.x, p.y - c.at.y) >= 3))
            found.push(c.at);
        if (found.length) break;
      }
      const spots = found.map((at, k) => {
        const node = spotShape(seed + index, k, f(1.1));
        glow.add(node);
        return {
          node,
          at,
          phase: hash01(seed, Math.trunc(at.x), Math.trunc(at.y), 874),
          period: f(f(5) + f(f(3) * hash01(seed, Math.trunc(at.x), Math.trunc(at.y), 875))),
        };
      });
      glows.add(glow);
      const center = point(f(sx / count / RESOLUTION), f(sy / count / RESOLUTION)),
        corners = [
          project(zone.left, zone.top),
          project(zone.right, zone.top),
          project(zone.left, zone.bottom),
          project(zone.right, zone.bottom),
        ],
        x0 = Math.min(...corners.map((c) => c.x)) - lavaLight.rx,
        y0 = Math.min(...corners.map((c) => c.y)) - lavaLight.ry,
        x1 = Math.max(...corners.map((c) => c.x)) + lavaLight.rx,
        y1 = Math.max(...corners.map((c) => c.y)) + lavaLight.ry;
      glow.opacity(0);
      patches.push({
        area: cell,
        box: new Rect(x0, y0, f(x1 - x0), f(y1 - y0)),
        center,
        bands,
        glow,
        spots,
        outline: region(map, 0, lava(-0.03), { x: 0, y: 0 }, zone).fill(255, 255, 255),
        phase: hash01(seed, cell.left, cell.top, 876),
        period: f(f(6) + f(f(2.5) * hash01(seed, cell.left, cell.top, 877))),
        shown: false,
        cut: false,
        knownAt: -1,
        known: false,
        rested: true,
        seenAt: -1,
        seen: false,
      });
    }
  for (const layer of layers) iso.add(layer);
  iso.add(glows);
  patchesOf.set(iso, patches);
}
/** Light for every lava cell: a cut through the night veil and a warm wash, hidden until the cell is seen. */
export function lightLava(s: WorldRendererState, lit: SceneNode): void {
  for (const patch of lavaPatches(s.ground)) {
    const at = project(patch.center.x, patch.center.y),
      cut = isoLayer().add(patch.outline),
      hole = softDisc(lavaLight.rx, [255, 255, 255], 150).transform([
        1,
        0,
        at.x,
        0,
        f(lavaLight.ry / lavaLight.rx),
        at.y,
        0,
        0,
        1,
      ]),
      tint = softDisc(f(lavaLight.rx * f(0.85)), warmth, 255).transform([
        1,
        0,
        at.x,
        0,
        f(lavaLight.ry / lavaLight.rx),
        at.y,
        0,
        0,
        1,
      ]);
    for (const node of [cut, hole, tint]) node.opacity(0);
    lit.add(cut).add(hole);
    s.warmth.add(tint);
    patch.lights = { cut, hole, tint };
    patch.shown = patch.cut = false;
  }
  const v = s.fireRow >= 0 ? s.volcanoLight : null;
  if (v?.cut) {
    const hole = softDisc(260, [255, 255, 255], 190).transform([
        1,
        0,
        v.crater.x,
        0,
        f(0.5),
        v.crater.y,
        0,
        0,
        1,
      ]),
      tint = softDisc(220, warmth, 255).transform([1, 0, v.crater.x, 0, f(0.5), f(v.crater.y + 40), 0, 0, 1]);
    for (const node of [v.cut, hole, tint]) node.opacity(0);
    lit.add(v.cut).add(hole);
    s.warmth.add(tint);
    v.lights = { cut: v.cut, hole, tint };
    v.shown = v.cutShown = false;
  }
  clocks.delete(s);
}
interface Clock {
  at: number;
}
const clocks = new WeakMap<object, Clock>();
const seenBy = (s: WorldRendererState, patch: LavaPatch): boolean => {
  const revision = s.currentVisibility.revision();
  if (patch.seenAt !== revision) {
    patch.seenAt = revision;
    patch.seen = false;
    const { left, top, right, bottom } = patch.area;
    for (let v = 0; v <= 4 && !patch.seen; ++v)
      for (let u = 0; u <= 4 && !patch.seen; ++u)
        patch.seen =
          s.currentVisibility.sample(
            point(f(left + f(f(f(right - left) * u) / 4)), f(top + f(f(f(bottom - top) * v) / 4))),
          ) > 0;
  }
  return patch.seen;
};
function show(
  lights: Pick<LavaLights, 'hole' | 'tint'> | undefined,
  glow: PaintNode | null,
  on: boolean,
): void {
  glow?.opacity(on ? 255 : 0);
  if (!lights) return;
  lights.hole.opacity(on ? 255 : 0);
  if (!on) lights.tint.opacity(0);
}
/** Explored lava keeps its own brightness at night, so the night veil never shows a cell's edge across a flow. */
const explored = (s: WorldRendererState, patch: LavaPatch): boolean => {
  const revision = s.exploredVisibility.revision();
  if (patch.knownAt === revision) return patch.known;
  patch.knownAt = revision;
  patch.known = false;
  const { left, top, right, bottom } = patch.area;
  for (let v = 0; v <= 2 && !patch.known; ++v)
    for (let u = 0; u <= 2 && !patch.known; ++u)
      patch.known =
        s.exploredVisibility.sample(
          point(f(left + f(f(f(right - left) * u) / 2)), f(top + f(f(f(bottom - top) * v) / 2))),
        ) > 0;
  return patch.known;
};
/**
 * Moves, breathes and lights the lava the player can see, a few times a second. Lava off screen or
 * not in anyone's sight is left alone: its glow and light are switched off and nothing about it is touched.
 * Returns the number of lava cells updated.
 */
export function updateLava(
  s: WorldRendererState,
  seconds: number,
  climate: Readonly<Climate>,
  still: boolean,
  zoom: number,
): number {
  const patches = lavaPatches(s.ground),
    volcano = s.fireRow >= 0 ? s.volcanoLight : null;
  if (!patches.length && !volcano?.cut) return 0;
  let clock = clocks.get(s);
  if (!clock) clocks.set(s, (clock = { at: -1 }));
  const rate = zoom < f(0.5) ? lavaRate / 2 : lavaRate;
  if (seconds >= clock.at && clock.at >= 0 && f(seconds - clock.at) < f(1 / rate)) return 0;
  clock.at = seconds;
  const view = viewRect(s),
    night = climate.night ?? 0;
  let updated = 0;
  for (const patch of patches) {
    const overlap = patch.box.intersect(view),
      inView = overlap.w > 0 && overlap.h > 0,
      visible = inView && seenBy(s, patch),
      cut = visible || (inView && night > 0 && explored(s, patch));
    if (cut !== patch.cut) {
      patch.cut = cut;
      patch.lights?.cut.opacity(cut ? 255 : 0);
    }
    if (visible !== patch.shown) {
      patch.shown = visible;
      show(patch.lights, patch.glow, visible);
    }
    if (!visible) continue;
    ++updated;
    if (!still || !patch.rested) {
      for (const band of patch.bands) {
        const o = still ? { x: 0, y: 0 } : driftOffset(band.drift, seconds, climate);
        band.shape.transform([1, 0, o.x, 0, 1, o.y, 0, 0, 1]);
      }
      patch.rested = still;
    }
    const swell = still ? f(0.5) : breath(seconds, patch.period, patch.phase);
    for (const spot of patch.spots) {
      const b = still ? f(0.5) : breath(seconds, spot.period, spot.phase),
        k = f(f(0.8) + f(f(0.35) * b)),
        o = still ? { x: 0, y: 0 } : driftOffset(patch.bands[1].drift, seconds, climate);
      spot.node.transform([k, 0, f(spot.at.x + o.x), 0, k, f(spot.at.y + o.y), 0, 0, 1]);
      spot.node.opacity(Math.trunc(f(f(30) + f(f(130) * b))));
    }
    patch.lights?.tint.opacity(Math.trunc(f(f(f(80) * night) * f(f(0.75) + f(f(0.4) * swell)))));
  }
  if (volcano?.cut) {
    const c = volcano.crater,
      overlap = new Rect(f(c.x - 520), f(c.y - 420), 1040, 900).intersect(view),
      inView = overlap.w > 0 && overlap.h > 0,
      visible = inView && s.currentVisibility.sample(volcano.heart) > 0,
      cut = visible || (inView && night > 0);
    if (cut !== volcano.cutShown) {
      volcano.cutShown = cut;
      volcano.lights?.cut.opacity(cut ? 255 : 0);
    }
    if (visible !== volcano.shown) {
      volcano.shown = visible;
      show(volcano.lights, null, visible);
      for (const node of volcano.hot) node.opacity(visible ? 120 : 0);
    }
    if (visible) {
      ++updated;
      volcano.hot.forEach((node, k) =>
        node.opacity(
          Math.trunc(
            f(f(30) + f(f(170) * (still ? f(0.5) : breath(seconds, f(5.5 + k * 1.3), f(k * 0.37))))),
          ),
        ),
      );
      if (!still)
        for (const floe of volcano.floes) {
          const u = f(f(f(f(seconds * floe.speed) + floe.start) % 1));
          floe.node.transform(placeFloe(floe, u));
          // Floes surface below the lip and sink into the field at the foot.
          floe.node.opacity(Math.max(1, Math.trunc(f(f(220) * Math.min(1, f(u * 8), f(f(1 - u) * 8))))));
        }
      volcano.lights?.tint.opacity(
        Math.trunc(f(f(f(90) * night) * f(f(0.8) + f(f(0.3) * (still ? f(0.5) : breath(seconds, 7, 0.2)))))),
      );
    }
  }
  return updated;
}
