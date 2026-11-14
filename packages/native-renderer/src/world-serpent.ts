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
  hx = (hx < 0 ? -1 : 1) * Math.max(Math.abs(hx), leastWidth / 2);
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
/** The neck rising from the water and the head at its top, looking along the loop. */
function headArt(art: PartArt): void {
  const L = art.length,
    H = art.height,
    T = 32,
    steps = 12,
    reach = Math.min(L * 0.35, 70),
    spine = Array.from({ length: steps + 1 }, (_, i) => {
      const s = i / steps;
      // Up out of the water, then bending forward under the head.
      return { x: reach * s * s, y: -H * (2 * s - s * s) };
    }),
    normal = (i: number) => {
      const p = spine[Math.max(0, i - 1)],
        q = spine[Math.min(steps, i + 1)],
        len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      return { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
    },
    side = (sign: number, width: number) =>
      spine.map((p, i) => {
        const n = normal(i),
          w = (width / 2) * (1 - 0.25 * (i / steps));
        return { x: p.x + n.x * w * sign, y: p.y + n.y * w * sign };
      });
  const body = new SceneNode(),
    detail = new SceneNode(),
    { x, y } = spine[steps],
    head = fill(scales.body);
  body.add(outline(fill(scales.body), side(-1, T), side(1, T)));
  // A long flat head, the snout reaching ahead along the loop.
  head
    .moveTo(x - 14, y - 10)
    .cubicTo(x + 6, y - 26, x + 40, y - 18, x + 56, y - 2)
    .cubicTo(x + 52, y + 7, x + 22, y + 13, x - 10, y + 14)
    .close();
  body.add(head);
  detail.add(outline(fill(scales.belly), side(1, T), side(1, T * 0.4)));
  const shade = fill(scales.shade);
  // The jaw, shut on the tail in front of it.
  shade.moveTo(x - 6, y + 5).lineTo(x + 54, y).lineTo(x + 50, y + 6).cubicTo(x + 26, y + 12, x + 8, y + 14, x - 8, y + 14).close();
  // Horns swept back and a fin down the neck.
  shade.moveTo(x - 12, y - 9).lineTo(x - 36, y - 24).lineTo(x - 6, y - 16).close();
  shade.moveTo(x - 2, y - 16).lineTo(x - 18, y - 38).lineTo(x + 8, y - 20).close();
  for (let i = 3; i < steps - 1; i += 2) {
    const p = side(-1, T)[i],
      n = normal(i);
    shade.moveTo(p.x - n.x * 2, p.y - n.y * 2 - 4).lineTo(p.x - n.x * 12, p.y - n.y * 12).lineTo(p.x - n.x * 2, p.y - n.y * 2 + 4).close();
  }
  detail.add(shade);
  detail.add(fill([16, 18, 20]).appendCircle(x + 18, y - 10, 3.2, 3.2));
  art.body = body;
  art.detail = detail;
  art.foam = foamAt([-T * 0.5, T * 0.5], T);
}
/** The tail lifting out of the water toward the head's jaws, thinning to a finned tip. */
function tailArt(art: PartArt): void {
  const L = art.length,
    H = art.height * 0.8,
    T = 24,
    steps = 12,
    spine = Array.from({ length: steps + 1 }, (_, i) => {
      const s = i / steps;
      return { x: L - L * 0.85 * s, y: -H * Math.sin(Math.PI * 0.62 * s) };
    }),
    side = (sign: number) =>
      spine.map((p, i) => {
        const q = spine[Math.min(steps, i + 1)],
          r = spine[Math.max(0, i - 1)],
          len = Math.hypot(q.x - r.x, q.y - r.y) || 1,
          w = (T / 2) * (1 - 0.92 * (i / steps));
        return { x: p.x - ((q.y - r.y) / len) * w * sign, y: p.y + ((q.x - r.x) / len) * w * sign };
      });
  const body = new SceneNode(),
    detail = new SceneNode(),
    tip = spine[steps];
  body.add(outline(fill(scales.body), side(1), side(-1)));
  const fin = fill(scales.shade);
  fin.moveTo(tip.x + 6, tip.y).lineTo(tip.x - 12, tip.y - 14).lineTo(tip.x - 4, tip.y + 2).lineTo(tip.x - 14, tip.y + 12).close();
  detail.add(fin);
  art.body = body;
  art.detail = detail;
  art.foam = foamAt([L - T * 0.5, L + T * 0.5], T);
}
function buildPart(art: PartArt): void {
  if (art.part.kind === SerpentPartKind.Head) headArt(art);
  else if (art.part.kind === SerpentPartKind.Tail) tailArt(art);
  else coilArt(art);
  art.node.add(art.foam!).add(art.body!).add(art.detail!);
}
function prepare(s: WorldRendererState, town: Town, art: SerpentArt | undefined, spell: number): SerpentArt {
  const map = town.map(),
    realm = town.realmArea ?? findRealmArea(map),
    key = `${map.seed()}:${map.width()}:${spell}:${realm ? `${realm.x},${realm.y}` : ''}`;
  if (art?.key === key) return art;
  const ring = serpentRing(map, realm),
    parts = ring ? serpentParts(ring, map.seed(), spell) : [];
  s.serpent.remove();
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
      if (p.shown) p.node.opacity(0);
      p.shown = false;
      continue;
    }
    if (!p.body) buildPart(p);
    // A slow sway along the waterline with the swell.
    const sway = Math.sin(clock * 0.4 + p.part.phase * 6) * 5,
      ax = p.a.x + p.dx * sway,
      ay = p.a.y + p.dy * sway,
      k = 0.45 + 0.55 * rise,
      shear: Matrix = [p.dx, 0, ax, p.dy, k, ay, 0, 0, 1],
      flat: Matrix = [p.dx, 0, ax, p.dy, 1, ay, 0, 0, 1];
    p.body!.transform(shear);
    p.detail!.transform(shear);
    p.foam!.transform(flat);
    p.detail!.opacity(Math.round(255 * (1 - flash)));
    p.foam!.opacity(Math.round(255 * Math.min(1, rise * 1.5) * (1 - flash * 0.8)));
    p.node.opacity(Math.round(255 * Math.min(1, rise * 2.5)));
    p.shown = true;
  }
}
/**
 * A part well out of the water shows through the veil over sea the player knows, as the volcano's fire does:
 * it is far too big to be hidden by distance. Only sea already explored is lit; nothing new is revealed.
 */
export function serpentSights(s: WorldRendererState, town: Town): { center: Point; radius: number }[] {
  const art = arts.get(s);
  if (!art?.ring || art.emergence <= 0 || !s.serpent.alpha) return [];
  const out: { center: Point; radius: number }[] = [];
  for (const p of art.parts) {
    if (!p.shown || p.rise < 0.12) continue;
    const mid = partMiddle(p.part, art.ring);
    if (!town.map().revealed(mid)) continue;
    // Two steps as the part rises: each change redraws the whole veil, so it must change seldom.
    out.push({ center: { x: mid.x - 1.2, y: mid.y - 1.2 }, radius: p.rise < 0.45 ? 2.5 : 4.5 });
  }
  return out;
}
