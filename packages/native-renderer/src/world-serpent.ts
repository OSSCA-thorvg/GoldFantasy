// Jormungandr in the sea round Midgard: coils of one body, its head and the tail in its jaws, rising out of the
// water in foul weather. Flat two-tone like the water contours; a few shapes per part, built the first time a
// part comes into view and afterwards only moved, a few times a second, while it is on screen.
import { project, type Point } from '../../engine/src/geometry';
import type { Town } from '../../engine/src/town';
import { Weather } from '../../engine/src/climate';
import { findRealmArea } from '../../engine/src/realm-layout';
import { Rect } from '../../native-ui/src/types';
import { SceneNode, ShapeNode, type Matrix } from './paint';
import { viewRect } from './world-depth';
import type { WorldRendererState } from './world-renderer-state';
import {
  partMiddle,
  partRise,
  serpentEmergence,
  serpentParts,
  serpentRing,
  SerpentPartKind,
  weatherSpell,
  type SerpentPart,
  type SerpentRing,
} from './serpent-ring';

/** Updates a second; the swell is slow. Half as often when zoomed far out. */
export const serpentRate = 6;
const scales = { body: [40, 78, 72], shade: [28, 58, 56], belly: [132, 162, 128], foam: [222, 232, 224] } as const;
interface PartArt {
  part: SerpentPart;
  node: SceneNode;
  /** Base of the part on the water and its rise frame (x along the waterline, y straight up). */
  a: Point;
  dx: number;
  dy: number;
  length: number;
  height: number;
  box: Rect;
  body?: SceneNode;
  detail?: SceneNode;
  foam?: SceneNode;
  /** A copy drawn over the veil of known sea, so a body far out is not dimmed by distance: it is too big. */
  lit?: { node: SceneNode; body: SceneNode; foam: SceneNode };
  /** A near-black copy over the lightning flash: the body as a silhouette against the lit sea. */
  shade?: SceneNode;
  shown: boolean;
  /** How far it was up at the last update. */
  rise: number;
}
interface SerpentArt {
  key: string;
  spell: number;
  ring: SerpentRing | null;
  parts: PartArt[];
  emergence: number;
  clock: number;
  at: number;
  viewKey: string;
  flashing: boolean;
}
const arts = new WeakMap<WorldRendererState, SerpentArt>();
const at = (ring: SerpentRing, i: number) => ring.points[((i % ring.points.length) + ring.points.length) % ring.points.length];
/** Least screen width of a part, so a coil seen end-on along the loop is still an arch and not a sliver. */
const leastWidth = 150;
function frame(part: SerpentPart, ring: SerpentRing): Omit<PartArt, 'node' | 'shown' | 'part' | 'rise'> {
  const a0 = project(at(ring, part.from).x, at(ring, part.from).y),
    b0 = project(at(ring, part.to).x, at(ring, part.to).y),
    mid = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  // The waterline keeps the loop's heading across the screen, widened and never steeper than the tile rows.
  let hx = (b0.x - a0.x) / 2;
  // The head part also holds the tail in front of its jaws, so it needs room for both.
  hx = (hx < 0 ? -1 : 1) * Math.max(Math.abs(hx), (part.kind === SerpentPartKind.Head ? 250 : leastWidth) / 2);
  const hy = Math.max(-Math.abs(hx) * 0.5, Math.min(Math.abs(hx) * 0.5, (b0.y - a0.y) / 2)),
    a = { x: mid.x - hx, y: mid.y - hy },
    length = Math.hypot(hx, hy) * 2,
    height = part.kind === SerpentPartKind.Head ? 96 : Math.max(58, Math.min(92, length * 0.32)),
    left = mid.x - Math.abs(hx),
    top = mid.y - Math.abs(hy);
  return {
    a,
    dx: (hx * 2) / length,
    dy: (hy * 2) / length,
    length,
    height,
    box: new Rect(left - 70, top - height - 70, Math.abs(hx) * 2 + 140, Math.abs(hy) * 2 + height + 100),
  };
}
const fill = (rgb: readonly number[], alpha = 255) => new ShapeNode().fill(rgb[0], rgb[1], rgb[2], alpha);
/** Traces `top` along u then `under` back, as one closed outline. */
function outline(shape: ShapeNode, top: readonly Point[], under: readonly Point[]): ShapeNode {
  top.forEach((p, i) => (i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y)));
  for (let i = under.length - 1; i >= 0; --i) shape.lineTo(under[i].x, under[i].y);
  return shape.close();
}
/** An arc of the coiled back: a thick arch out of the water and back in, the sea showing beneath it. */
function coilArt(art: PartArt): void {
  const L = art.length,
    H = art.height,
    T = 34,
    steps = 14,
    arc = (from: number, to: number, rise: number) =>
      Array.from({ length: steps + 1 }, (_, i) => {
        const u = from + ((to - from) * i) / steps;
        return { x: u, y: -rise * Math.pow(Math.sin((Math.PI * (u - from)) / (to - from)), 0.8) };
      }),
    outer = arc(0, L, H + T / 2),
    inner = arc(T * 0.85, L - T * 0.85, H - T / 2),
    bellyTop = arc(T * 0.85 - 3, L - T * 0.85 + 3, H - T / 2 + 9);
  const body = new SceneNode(),
    detail = new SceneNode();
  body.add(outline(fill(scales.body), outer, inner));
  detail.add(outline(fill(scales.belly), bellyTop, inner));
  // A darker crest of fins along the back.
  const crest = fill(scales.shade);
  for (let k = 2; k < 12; k += 2) {
    const p = outer[k],
      q = outer[k + 1];
    crest.moveTo(p.x, p.y + 1).lineTo((p.x + q.x) / 2 - 2, (p.y + q.y) / 2 - 9).lineTo(q.x, q.y + 1).close();
  }
  detail.add(crest);
  // Scale rows as short flat strokes across the side.
  const rows = new ShapeNode().strokeWidth(2).strokeFill(scales.shade[0], scales.shade[1], scales.shade[2], 200).strokeCap('round');
  for (let k = 3; k < steps - 2; k += 2) {
    const p = outer[k],
      q = inner[Math.min(steps, Math.max(0, k))];
    rows.moveTo(p.x * 0.6 + q.x * 0.4 - 3, p.y * 0.6 + q.y * 0.4 + 2).lineTo(p.x * 0.6 + q.x * 0.4 + 3, p.y * 0.6 + q.y * 0.4 - 2);
  }
  detail.add(rows);
  art.body = body;
  art.detail = detail;
  art.foam = foamAt([0, T * 0.4, L - T * 0.4, L], T);
}
/** Flat foam where the body cuts the water, with a darker trough round it. */
function foamAt(cuts: readonly number[], T: number): SceneNode {
  const node = new SceneNode(),
    trough = fill([18, 40, 52], 70),
    foam = fill(scales.foam, 220);
  for (let k = 0; k < cuts.length; k += 2) {
    const mid = (cuts[k] + cuts[k + 1]) / 2,
      half = Math.abs(cuts[k + 1] - cuts[k]) / 2 + T * 0.35;
    trough.appendCircle(mid, 2, half + 8, 7);
    // A ruffled collar of foam round the body, and a few flecks drifting off it.
    foam
      .moveTo(mid - half, 1)
      .cubicTo(mid - half * 0.7, -5, mid - half * 0.2, -2, mid, -4)
      .cubicTo(mid + half * 0.2, -2, mid + half * 0.7, -6, mid + half, 1)
      .cubicTo(mid + half * 0.5, 6, mid - half * 0.5, 6, mid - half, 1)
      .close();
    foam.appendCircle(mid - half - 6, 2, 2.6, 1.6).appendCircle(mid + half + 7, 1, 2.2, 1.4).appendCircle(mid + half + 13, 3, 1.4, 1);
  }
  node.add(trough).add(foam);
  return node;
}
/** Where the neck rises, the head looks and the tail ends, in a head part's own frame: one shape of the
 * closed ring, so the tail tip always sits just in front of the jaws however wide the part is drawn. */
export function headLayout(length: number, height: number) {
  const base = { x: length * 0.08, y: 0 },
    top = { x: base.x + Math.min(length * 0.22, 64), y: -height },
    snout = { x: top.x + 56, y: top.y - 2 };
  return { base, top, snout, tip: { x: snout.x + 5, y: snout.y + 3 }, tail: { x: length - 14, y: 0 } };
}
/** A tapering band of width `from` to `to` along `spine`. */
function band(shape: ShapeNode, spine: readonly Point[], from: number, to: number): ShapeNode {
  const n = spine.length - 1,
    side = (sign: number) =>
      spine.map((p, i) => {
        const q = spine[Math.min(n, i + 1)],
          r = spine[Math.max(0, i - 1)],
          len = Math.hypot(q.x - r.x, q.y - r.y) || 1,
          w = (from + (to - from) * (i / n)) / 2;
        return { x: p.x - ((q.y - r.y) / len) * w * sign, y: p.y + ((q.x - r.x) / len) * w * sign };
      });
  return outline(shape, side(1), side(-1));
}
const cubic = (a: Point, b: Point, c: Point, d: Point, steps = 14): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps,
      u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
  });
/** The neck rising from the water, the head looking along the loop, and the tail lifting into its jaws. */
function headArt(art: PartArt): void {
  const T = 32,
    { base, top, snout, tip, tail } = headLayout(art.length, art.height),
    neck = cubic(base, { x: base.x, y: top.y * 0.7 }, { x: top.x - 30, y: top.y }, top, 12),
    tailSpine = cubic(tail, { x: tail.x, y: top.y * 0.75 }, { x: tip.x + 46, y: tip.y - 24 }, tip, 14);
  const body = new SceneNode(),
    detail = new SceneNode(),
    { x, y } = top;
  body.add(band(fill(scales.body), neck, T, T * 0.75));
  body.add(band(fill(scales.body), tailSpine, T * 0.8, 2));
  const head = fill(scales.body);
  // A long flat head, the snout reaching ahead along the loop.
  head
    .moveTo(x - 14, y - 10)
    .cubicTo(x + 6, y - 26, x + 40, y - 18, snout.x, snout.y)
    .cubicTo(snout.x - 4, y + 7, x + 22, y + 13, x - 10, y + 14)
    .close();
  body.add(head);
  detail.add(band(fill(scales.belly), neck.map((p) => ({ x: p.x + 6, y: p.y + 2 })), T * 0.35, T * 0.25));
  const shade = fill(scales.shade);
  // The jaw, shut on the tail's tip.
  shade.moveTo(x - 6, y + 5).lineTo(snout.x - 2, snout.y + 2).lineTo(snout.x - 6, snout.y + 8).cubicTo(x + 26, y + 12, x + 8, y + 14, x - 8, y + 14).close();
  // Horns swept back, a fin down the neck and a fin on the tail.
  shade.moveTo(x - 12, y - 9).lineTo(x - 36, y - 24).lineTo(x - 6, y - 16).close();
  shade.moveTo(x - 2, y - 16).lineTo(x - 18, y - 38).lineTo(x + 8, y - 20).close();
  for (let i = 3; i < 11; i += 2) {
    const p = neck[i];
    shade.moveTo(p.x - 12, p.y - 2).lineTo(p.x - 24, p.y - 6).lineTo(p.x - 13, p.y + 6).close();
  }
  for (let i = 3; i < 10; i += 3) {
    const p = tailSpine[i];
    shade.moveTo(p.x - 4, p.y - 8).lineTo(p.x + 4, p.y - 20).lineTo(p.x + 8, p.y - 7).close();
  }
  detail.add(shade);
  detail.add(fill([16, 18, 20]).appendCircle(x + 18, y - 10, 3.2, 3.2));
  art.body = body;
  art.detail = detail;
  art.foam = foamAt([base.x - T * 0.5, base.x + T * 0.5, tail.x - T * 0.4, tail.x + T * 0.4], T);
}
/** Copies every shape under `from`, sharing their outlines, in `color` or, without one, in their own colours. */
function copyShapes(from: SceneNode, color?: readonly number[]): SceneNode {
  const out = new SceneNode();
  for (const child of from.children) {
    if (child instanceof SceneNode) out.add(copyShapes(child, color));
    else if (child instanceof ShapeNode) {
      const copy = new ShapeNode();
      copy.commands = child.commands;
      copy.pathVersion++;
      if (color) copy.fill(color[0], color[1], color[2]);
      else {
        if (child.color) copy.fill(...child.color);
        if (child.strokeColor) copy.strokeWidth(child.width ?? 1).strokeFill(...child.strokeColor).strokeCap(child.cap ?? 'butt');
      }
      out.add(copy);
    }
  }
  return out;
}
function buildPart(s: WorldRendererState, art: PartArt): void {
  if (art.part.kind === SerpentPartKind.Head) headArt(art);
  else coilArt(art);
  art.node.add(art.foam!).add(art.body!).add(art.detail!);
  const body = new SceneNode().add(copyShapes(art.body!)).add(copyShapes(art.detail!)),
    foam = copyShapes(art.foam!),
    lit = new SceneNode().add(foam).add(body);
  art.lit = { node: lit, body, foam };
  art.shade = new SceneNode().add(copyShapes(art.body!, [10, 16, 20])).add(copyShapes(art.detail!, [10, 16, 20]));
  for (const node of [lit, art.shade]) node.opacity(0);
  s.serpentLit.add(lit);
  s.serpentShade.add(art.shade);
}
function prepare(s: WorldRendererState, town: Town, art: SerpentArt | undefined, spell: number): SerpentArt {
  const map = town.map(),
    realm = town.realmArea ?? findRealmArea(map),
    key = `${map.seed()}:${map.width()}:${spell}:${realm ? `${realm.x},${realm.y}` : ''}`;
  if (art?.key === key) return art;
  const ring = serpentRing(map, realm),
    parts = ring ? serpentParts(ring, map.seed(), spell) : [];
  s.serpent.remove();
  s.serpentLit.remove();
  s.serpentShade.remove();
  const next: SerpentArt = {
    key,
    spell,
    ring,
    emergence: art?.emergence ?? 0,
    clock: art?.clock ?? -1,
    at: -1,
    viewKey: '',
    flashing: false,
    parts: ring
      ? parts.map((part) => {
          const node = new SceneNode();
          node.opacity(0);
          s.serpent.add(node);
          return { part, node, shown: false, rise: 0, ...frame(part, ring) };
        })
      : [],
  };
  arts.set(s, next);
  return next;
}
/** Lightning in view right now, 0..1, so the body stands dark against the flash. */
function flashOf(s: WorldRendererState, seconds: number): number {
  const strike = s.strike;
  if (!strike) return 0;
  const t = seconds - strike.at;
  return t < 0 || t > 0.5 ? 0 : strike.brightness * (t < 0.16 ? 1 : Math.exp(-(t - 0.16) / 0.12));
}
/** Moves the serpent for this frame. Costs nothing in clear weather or with no part on screen. */
export function updateSerpent(s: WorldRendererState, town: Town, seconds: number, zoom: number): void {
  let art = arts.get(s);
  const climate = town.climate(),
    raining = climate.weather === Weather.Rain || climate.weather === Weather.Storm;
  if (s.editorView || (!raining && (!art || art.emergence <= 0))) {
    if (art && s.serpent.alpha) s.serpent.opacity(0);
    if (art) art.emergence = 0;
    return;
  }
  const spell = raining ? weatherSpell(town.weather().snapshot().peak) : (art?.spell ?? 0),
    target = raining ? serpentEmergence(town.map().seed(), climate.weather, climate.intensity, spell) : 0;
  art = prepare(s, town, art, spell);
  const clock = town.clock(),
    dt = art.clock < 0 ? 0 : Math.max(0, Math.min(1, clock - art.clock));
  art.clock = clock;
  // Rises over some seconds, sinks a little faster when the weather clears.
  art.emergence += (target - art.emergence) * Math.min(1, dt / (target > art.emergence ? 9 : 6));
  if (art.emergence < 0.004 && target === 0) art.emergence = 0;
  if (!art.ring || art.emergence <= 0) {
    s.serpent.opacity(0);
    return;
  }
  s.serpent.opacity(255);
  const flash = flashOf(s, seconds),
    rate = zoom < 0.5 ? serpentRate / 2 : serpentRate;
  // A moved view shows the parts it brings in at once rather than at the next slow step.
  const view = viewRect(s),
    viewKey = `${Math.round(view.x / 40)}:${Math.round(view.y / 40)}:${Math.round(view.w / 40)}`,
    interval = viewKey !== art.viewKey ? 1 / 20 : 1 / rate;
  if (!flash && !art.flashing && art.at >= 0 && seconds >= art.at && seconds - art.at < interval) return;
  art.at = seconds;
  art.viewKey = viewKey;
  art.flashing = flash > 0;
  for (const p of art.parts) {
    const box = p.box.intersect(view),
      rise = box.w > 0 && box.h > 0 ? partRise(p.part, art.ring, art.emergence, clock) : 0;
    p.rise = rise;
    if (rise < 0.03) {
      if (p.shown) for (const node of [p.node, p.lit!.node, p.shade!]) node.opacity(0);
      p.shown = false;
      continue;
    }
    if (!p.body) buildPart(s, p);
    // A slow sway along the waterline with the swell.
    const sway = Math.sin(clock * 0.4 + p.part.phase * 6) * 5,
      ax = p.a.x + p.dx * sway,
      ay = p.a.y + p.dy * sway,
      k = 0.45 + 0.55 * rise,
      shear: Matrix = [p.dx, 0, ax, p.dy, k, ay, 0, 0, 1],
      flat: Matrix = [p.dx, 0, ax, p.dy, 1, ay, 0, 0, 1];
    const shown = Math.round(255 * Math.min(1, rise * 2.5)),
      lit = p.lit!;
    p.body!.transform(shear);
    p.detail!.transform(shear);
    p.foam!.transform(flat);
    p.foam!.opacity(Math.round(255 * Math.min(1, rise * 1.5)));
    p.node.opacity(shown);
    lit.body.transform(shear);
    lit.foam.transform(flat);
    lit.foam.opacity(Math.round(255 * Math.min(1, rise * 1.5)));
    // Over known sea the copy shows it undimmed by day; by night it fades and the veiled body is what is seen.
    const known = p.part.edge || town.map().revealed(partMiddle(p.part, art.ring));
    lit.node.opacity(known ? Math.round(shown * (1 - 0.85 * town.climate().night)) : 0);
    p.shade!.transform(shear);
    // Black against the flash for as long as it lasts.
    p.shade!.opacity(flash > 0.08 ? Math.round(Math.min(1, flash * 2) * Math.min(1, rise * 2.5) * 240) : 0);
    p.shown = true;
  }
}
