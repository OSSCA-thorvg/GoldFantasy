// Flat painterly building blocks shared by combat text, contact effects, bars and telegraphs.
import { project, tileHalfHeight, tileHalfWidth, type Point } from '../../engine/src/geometry';
import type { Town } from '../../engine/src/town';
import { CombatCue, type AbilityId, type CombatEvent } from '../../engine/src/combat-events';
import type { Hit } from '../../engine/src/person';
import { skillOfCalling, skills, skillSpec, StrikeKind } from '../../engine/src/skill-catalog';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import type { WorldRendererState } from './world-renderer-state';
import { Tier, type Extent } from './combat-depth';

/** The user's earthy palette (look direction, section 6). */
export const tone = {
  teal: [33, 94, 94],
  sage: [137, 167, 144],
  rust: [191, 91, 50],
  peach: [246, 217, 170],
  ochre: [199, 131, 38],
  olive: [124, 130, 69],
  brown: [104, 89, 48],
  sand: [215, 196, 158],
  leaf: [140, 173, 102],
  /** Dusk indigo: the unlit side of the world art. */
  dusk: [46, 44, 84],
  /** Dark mass under combat shapes and the outline of combat text. */
  ink: [34, 28, 36],
  pale: [236, 228, 210],
  /** Frost family of the look guide, for the Frost Ring only. */
  frost: [124, 164, 178],
  frostDeep: [71, 121, 145],
  rime: [201, 220, 224],
  /** Grove deep of the look guide: the hallowed ground's leaves. */
  grove: [107, 133, 53],
} as const satisfies Record<string, Rgb>;

/** Screen radii of a ground circle `radius` tiles wide, in the iso projection. */
export const groundRadii = (radius: number) => ({
  rx: radius * tileHalfWidth * Math.SQRT2,
  ry: radius * tileHalfHeight * Math.SQRT2,
});

/** A cheap stable hash in [0, 1) so effects look the same on every run. */
export function jitter(seed: number, i: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export const ease = {
  out: (t: number) => 1 - (1 - t) * (1 - t),
  in: (t: number) => t * t,
  smooth: (t: number) => t * t * (3 - 2 * t),
};
export const unit = (t: number) => Math.max(0, Math.min(1, t));

/** A calligraphic crescent: sharp tips, belly `width` thick, bowed by `bow`. Centred on the origin along x. */
export function appendBlade(shape: ShapeNode, length: number, width: number, bow = 0.35): ShapeNode {
  const h = length / 2,
    lift = length * bow;
  return shape
    .moveTo(-h, 0)
    .cubicTo(-h * 0.45, -lift - width, h * 0.45, -lift - width, h, 0)
    .cubicTo(h * 0.4, -lift + width * 0.15, -h * 0.4, -lift + width * 0.15, -h, 0)
    .close();
}
/** A faceted shard pointing along +x. */
export function appendShard(shape: ShapeNode, size: number, seed: number): ShapeNode {
  const a = 0.35 + jitter(seed, 1) * 0.3,
    b = 0.25 + jitter(seed, 2) * 0.3;
  return shape
    .moveTo(size, 0)
    .lineTo(-size * 0.25, -size * a)
    .lineTo(-size * 0.5, size * 0.05)
    .lineTo(-size * 0.2, size * b)
    .close();
}
/** A faceted rock standing on y = 0. */
export function appendRock(shape: ShapeNode, size: number, seed: number): ShapeNode {
  const t = (i: number) => 0.75 + jitter(seed, i) * 0.5;
  return shape
    .moveTo(-size * t(1), 0)
    .lineTo(-size * 0.7 * t(2), -size * 0.9 * t(3))
    .lineTo(size * 0.1, -size * 1.5 * t(4))
    .lineTo(size * 0.8 * t(5), -size * 0.8 * t(6))
    .lineTo(size * t(7), 0)
    .close();
}
/** A scalloped cloud of overlapping lobes on a flat base. */
export function appendCloud(
  shape: ShapeNode,
  rx: number,
  ry: number,
  lobes: number,
  seed: number,
): ShapeNode {
  for (let i = 0; i < lobes; i++) {
    const u = lobes > 1 ? i / (lobes - 1) : 0.5,
      x = (u * 2 - 1) * rx * 0.75,
      r = ry * (0.55 + 0.45 * Math.sin(Math.PI * u)) * (0.85 + jitter(seed, i) * 0.3);
    shape.appendCircle(x, -r * 0.6, r * 1.15, r);
  }
  return shape;
}
/** A long tapered streak along +x ending at the origin: a hair-thin tail at -length, widest just behind the head. */
export function appendStreak(shape: ShapeNode, length: number, width: number): ShapeNode {
  return shape
    .moveTo(-length, 0)
    .lineTo(-Math.min(length * 0.18, 8), -width / 2)
    .lineTo(0, 0)
    .lineTo(-Math.min(length * 0.18, 8), width / 2)
    .close();
}
/** A pale rising wisp: a tapered flame with its tip up. */
export function appendWisp(shape: ShapeNode, height: number, width: number, lean: number): ShapeNode {
  return shape
    .moveTo(0, 0)
    .cubicTo(-width, -height * 0.25, -width * 0.6, -height * 0.7, lean, -height)
    .cubicTo(width * 0.2, -height * 0.65, width * 0.9, -height * 0.3, 0, 0)
    .close();
}
/** An upward chevron, the point at the top. */
export function appendChevron(shape: ShapeNode, width: number, height: number, thick: number): ShapeNode {
  return shape
    .moveTo(-width / 2, 0)
    .lineTo(0, -height)
    .lineTo(width / 2, 0)
    .lineTo(width / 2 - thick * 0.7, thick * 0.4)
    .lineTo(0, -height + thick)
    .lineTo(-width / 2 + thick * 0.7, thick * 0.4)
    .close();
}
/** A flat ring segment from `from` to `to` (0..1 of a turn, clockwise from the top). */
export function appendArc(
  shape: ShapeNode,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thick: number,
  from: number,
  to: number,
): ShapeNode {
  const span = to - from;
  if (span <= 0.001) return shape;
  const steps = Math.max(2, Math.ceil(span * 28)),
    at = (k: number, r: number, s: number) => {
      const a = (from + span * k) * Math.PI * 2 - Math.PI / 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * s] as const;
    };
  for (let i = 0; i <= steps; i++) {
    const [x, y] = at(i / steps, rx, ry);
    if (i) shape.lineTo(x, y);
    else shape.moveTo(x, y);
  }
  const k = (rx - thick) / rx;
  for (let i = steps; i >= 0; i--) {
    const [x, y] = at(i / steps, rx - thick, ry * k);
    shape.lineTo(x, y);
  }
  return shape.close();
}

/** A calligraphic arc on a ground ellipse from angle `a0` to `a1` (radians, clockwise on screen): both tips
 * sharp, `width` at its belly, the belly toward the head when `tail` > `head`. `bias` puts the width outside. */
export function appendTaperArc(
  shape: ShapeNode,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  width: number,
  tail = 0.5,
  head = 0.3,
  bias = 0.5,
): ShapeNode {
  const span = a1 - a0;
  if (Math.abs(span) < 1e-3 || width <= 0 || rx <= 0) return shape;
  const n = Math.max(6, Math.ceil(Math.abs(span) * 9)),
    k = ry / rx,
    w = (v: number) => width * Math.min(v / tail, 1) ** 1.3 * Math.min((1 - v) / head, 1) ** 1.1;
  for (let i = 0; i <= n; i++) {
    const v = i / n,
      a = a0 + span * v,
      r = rx + w(v) * bias;
    if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r * k);
    else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r * k);
  }
  for (let i = n - 1; i > 0; i--) {
    const v = i / n,
      a = a0 + span * v,
      r = rx - w(v) * (1 - bias);
    shape.lineTo(Math.cos(a) * r, Math.sin(a) * r * k);
  }
  return shape.close();
}
/** A jagged burst star: long and short spikes in turn, hand-cut by `seed`. */
export function appendStar(shape: ShapeNode, r: number, spikes: number, seed: number, inner = 0.42): ShapeNode {
  const count = spikes * 2,
    turn = jitter(seed, 90) * Math.PI;
  for (let i = 0; i < count; i++) {
    const j = jitter(seed, i + 91),
      a = turn + (i / count) * Math.PI * 2 + (j - 0.5) * (Math.PI / count) * 0.6,
      reach = i % 2 ? r * inner * (0.9 + j * 0.2) : r * ((i / 2) % 2 ? 0.62 : 1) * (0.88 + j * 0.24),
      x = Math.cos(a) * reach,
      y = Math.sin(a) * reach;
    if (i) shape.lineTo(x, y);
    else shape.moveTo(x, y);
  }
  return shape.close();
}
/** A leaf or petal: a lens along x with sharp tips, centred on the origin. */
export function appendLeaf(shape: ShapeNode, length: number, width: number): ShapeNode {
  const h = length / 2,
    w = width * 0.75;
  return shape
    .moveTo(-h, 0)
    .cubicTo(-h * 0.35, -w, h * 0.35, -w, h, 0)
    .cubicTo(h * 0.35, w, -h * 0.35, w, -h, 0)
    .close();
}
export function flat(color: Rgb, alpha = 255): ShapeNode {
  return new ShapeNode().fill(color[0], color[1], color[2], alpha);
}

/** One animated flat piece of an effect, posed every frame from its own little script. */
export interface Piece {
  node: ShapeNode;
  /** Start offset in screen pixels from the effect's anchor, and the drift over its life. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Extra downward pull at the end of its life (pixels). */
  fall: number;
  angle: number;
  spin: number;
  size: number;
  /** Scale at the end of its life, as a share of `size`. */
  end: number;
  /** Height kept at the end (1 keeps the shape, smaller thins a slash out). */
  thin: number;
  delay: number;
  life: number;
  alpha: number;
  /** Where it is drawn; the effect's own tier when unset. */
  tier?: Tier;
  /** Screen offset of the ground point it stands on, from the effect's ground point (standing pieces). */
  foot?: { x: number; y: number };
  /** How far its outline reaches from its position, for culling (long streaks, wide arcs). */
  reach?: number;
}
/** Local box round where pieces go over their lives. */
export function extentOf(pieces: readonly Piece[]): Extent {
  const e = { x0: -24, y0: -24, x1: 24, y1: 24 };
  for (const p of pieces) {
    const r = (p.reach ?? 14) * p.size * 1.2;
    for (const [x, y] of [
      [p.x, p.y],
      [p.x + p.vx, p.y + p.vy + p.fall],
    ]) {
      e.x0 = Math.min(e.x0, x - r);
      e.y0 = Math.min(e.y0, y - r);
      e.x1 = Math.max(e.x1, x + r);
      e.y1 = Math.max(e.y1, y + r);
    }
  }
  return e;
}
/** The same pieces, drawn in `tier`. */
export const inTier = (tier: Tier, pieces: Piece[], foot?: { x: number; y: number }): Piece[] =>
  pieces.map((p) => Object.assign(p, { tier, ...(foot ? { foot } : {}) }));
export function piece(node: ShapeNode, fields: Partial<Omit<Piece, 'node'>>): Piece {
  return {
    node,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fall: 0,
    angle: 0,
    spin: 0,
    size: 1,
    end: 0.4,
    thin: 1,
    delay: 0,
    life: 0.4,
    alpha: 255,
    ...fields,
  };
}
/** Small anticipation, an early overshooting peak, then a shrinking breakup. */
export function popScale(t: number): number {
  if (t < 0.14) return 0.55 + 0.63 * ease.out(t / 0.14);
  if (t < 0.32) return 1.18 - 0.18 * ease.smooth((t - 0.14) / 0.18);
  return 1;
}
/** Poses a piece at `age` seconds after its effect started; false once it is done. */
export function posePiece(p: Piece, age: number): boolean {
  const t = (age - p.delay) / p.life;
  if (t < 0) {
    p.node.opacity(0);
    return true;
  }
  if (t >= 1) {
    p.node.opacity(0);
    return false;
  }
  // A short pull back before the burst, then the drift slows down.
  const travel = ease.out(t) - 0.06 * Math.sin(Math.PI * unit(t / 0.12)),
    k = p.size * popScale(t) * (1 + (p.end - 1) * unit((t - 0.32) / 0.68)),
    angle = p.angle + p.spin * t,
    c = Math.cos(angle),
    s = Math.sin(angle),
    thin = 1 + (p.thin - 1) * ease.in(t);
  p.node.transform([
    k * c,
    -k * s * thin,
    p.x + p.vx * travel,
    k * s,
    k * c * thin,
    p.y + p.vy * travel + p.fall * t * t,
    0,
    0,
    1,
  ]);
  // Pieces leave mostly by shrinking; only the last quarter fades.
  p.node.opacity(Math.round(p.alpha * (t < 0.75 ? 1 : 1 - ease.in((t - 0.75) / 0.25))));
  return true;
}

/** Small warm accent shards flung along `angle`. */
export function shards(
  seed: number,
  count: number,
  angle: number,
  spread: number,
  reach: number,
  colors: readonly Rgb[],
  from: { x: number; y: number } = { x: 0, y: 0 },
): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const a = angle + (jitter(seed, i * 3) - 0.5) * spread,
      r = reach * (0.6 + jitter(seed, i * 3 + 1) * 0.6),
      node = appendShard(flat(colors[i % colors.length]), 2 + jitter(seed, i * 3 + 2) * 1.6, seed + i);
    return piece(node, {
      x: from.x + Math.cos(a) * 2,
      y: from.y + Math.sin(a) * 2,
      vx: Math.cos(a) * r,
      vy: Math.sin(a) * r * 0.8,
      fall: 5,
      angle: a,
      spin: (jitter(seed, i + 40) - 0.5) * 5,
      delay: 0.03 + i * 0.008,
      life: 0.34 + jitter(seed, i + 50) * 0.12,
      end: 0.35,
    });
  });
}
export function motes(seed: number, count: number, colors: readonly Rgb[], rise: number): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const x = (jitter(seed, i) - 0.5) * 14;
    return piece(appendLeaf(flat(colors[i % colors.length]), 4.8, 3.2), {
      x,
      y: 4,
      vx: (jitter(seed, i + 9) - 0.5) * 8,
      vy: -rise - jitter(seed, i + 20) * 8,
      angle: -Math.PI / 2 + (jitter(seed, i + 30) - 0.5) * 1.2,
      spin: (jitter(seed, i + 31) - 0.5) * 3,
      delay: i * 0.07,
      life: 0.8 + jitter(seed, i + 40) * 0.3,
      end: 0.6,
    });
  });
}
/** Shards set round a ground ellipse, flying outward: a dark one under each lighter one. */
export function shardRing(
  seed: number,
  count: number,
  rx: number,
  reach: number,
  main: Rgb,
  accent: Rgb,
  delay = 0,
  under: Rgb = tone.ink,
): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + jitter(seed, i) * 0.3,
      c = Math.cos(a),
      s = Math.sin(a) * 0.5,
      size = 3.4 + jitter(seed, i + 9) * 1.4,
      angle = Math.atan2(s, c);
    out.push(
      piece(appendShard(flat(under), size * 1.2, seed + i), {
        x: c * rx,
        y: s * rx,
        vx: c * reach,
        vy: s * reach,
        angle,
        delay,
        life: 0.5,
        end: 0.4,
      }),
      piece(appendShard(flat(i % 3 ? main : accent), size, seed + i + 50), {
        x: c * rx,
        y: s * rx - 0.6,
        vx: c * reach,
        vy: s * reach,
        angle,
        delay: delay + 0.015,
        life: 0.48,
        end: 0.35,
      }),
    );
  }
  return out;
}
export function chevrons(color: Rgb, count: number): Piece[] {
  return Array.from({ length: count }, (_, i) => [
    piece(appendChevron(flat(tone.ink, 220), 11, 6, 3), { y: 2, vy: -16, delay: i * 0.14, life: 0.9, end: 0.8 }),
    piece(appendChevron(flat(color), 9, 5, 2.1), {
      y: 1.6,
      vy: -16,
      delay: i * 0.14 + 0.01,
      life: 0.88,
      end: 0.8,
    }),
  ]).flat();
}
/** A dark scalloped puff with a lighter one riding on it. */
export function dust(seed: number, width: number, dark: Rgb = tone.brown, light: Rgb = tone.sand): Piece[] {
  return [
    piece(appendCloud(flat(dark), width, width * 0.55, 4, seed), { vy: -3, life: 0.7, end: 1.5, size: 0.8 }),
    piece(appendCloud(flat(light), width * 0.8, width * 0.42, 3, seed + 1), {
      x: width * 0.12,
      y: -1,
      vy: -5,
      delay: 0.04,
      life: 0.62,
      end: 1.4,
      size: 0.8,
    }),
  ];
}
/** Wave fronts rolling outward by replacement: each front is a broken ring drawn at its own radius, so its
 * line keeps its weight instead of growing with a scale. */
export function waveFronts(
  seed: number,
  rx: number,
  ry: number,
  fronts: readonly number[],
  arcs: number,
  width: number,
  main: Rgb,
  companion: Rgb,
  step: number,
  life: number,
): Piece[] {
  const out: Piece[] = [];
  fronts.forEach((share, f) => {
    const gap = 0.22 + jitter(seed, f) * 0.12,
      w = width * (1.15 - share * 0.5);
    for (let i = 0; i < arcs; i++) {
      const a0 = ((i + jitter(seed, f * 13 + i) * 0.3) / arcs) * Math.PI * 2 + f * 0.7,
        a1 = a0 + (Math.PI * 2) / arcs - gap,
        // The near half of a ground ring reads thicker.
        near = 1 + 0.35 * Math.sin((a0 + a1) / 2),
        drift = { vx: Math.cos((a0 + a1) / 2) * rx * 0.08, vy: Math.sin((a0 + a1) / 2) * ry * 0.08 },
        timing = { delay: f * step, life, end: 0.85, ...drift };
      out.push(
        piece(appendTaperArc(flat(companion), rx * share - w * 0.6, ry * share - w * 0.3, a0 + 0.08, a1 - 0.05, w * 0.55 * near, 0.45, 0.45), {
          ...timing,
          delay: timing.delay + 0.03,
          reach: rx * share,
        }),
        piece(appendTaperArc(flat(main), rx * share, ry * share, a0, a1, w * near, 0.45, 0.45), {
          ...timing,
          reach: rx * share + w,
        }),
      );
    }
  });
  return out;
}

/** How an ordinary blow landed, read defensively until every blow carries it. */
interface StrikeFields {
  serial: bigint;
  strike?: StrikeKind;
  primary?: boolean;
}
export const strikeOfHit = (hit: StrikeFields): StrikeKind => hit.strike ?? StrikeKind.Single;
export const isPrimary = (hit: StrikeFields): boolean => hit.primary ?? true;
/** Blows from one attacker at one moment are one swing: a cleave, a pierce or a skill landing. */
export function swingsOf(hits: readonly Hit[]): Hit[][] {
  const groups = new Map<string, Hit[]>();
  for (const hit of hits) {
    const key =
      !hit.onPerson && hit.attacker !== undefined && hit.attacker >= 0
        ? `${hit.attacker}:${hit.at}`
        : `s${hit.serial}`;
    const group = groups.get(key);
    if (group) group.push(hit);
    else groups.set(key, [hit]);
  }
  return [...groups.values()];
}
/** The skill use whose landing a swing is, or null for an ordinary blow. */
export function skillCastOf(town: Town, swing: readonly Hit[]): (CombatEvent & { skill: AbilityId }) | null {
  const first = swing[0],
    by = first.attacker ?? first.person;
  if (first.onPerson || by < 0) return null;
  for (const event of cuesOf(town)) {
    if (event.cue !== CombatCue.Ability || event.person !== by) continue;
    const skill = skillOfCue(town, event);
    if (skill !== 'aimed' && skill !== 'burst' && skill !== 'whirl' && skill !== 'volley') continue;
    if (Math.abs(event.at + skillSpec(skill).delay - first.at) <= 0.15) return { ...event, skill };
  }
  return null;
}

interface Layers {
  bars: SceneNode;
  effects: SceneNode;
  text: SceneNode;
}
const layers = new WeakMap<WorldRendererState, Layers>();
/** Bars under effects under text, all above the fog in the screen-space combat layer. */
export function combatLayers(s: WorldRendererState): Layers {
  let found = layers.get(s);
  if (!found) {
    found = { bars: new SceneNode(), effects: new SceneNode(), text: new SceneNode() };
    layers.set(s, found);
  }
  for (const layer of [found.bars, found.effects, found.text])
    if (!s.combat.children.includes(layer)) s.combat.add(layer);
  return found;
}
/** World-pixel anchor of a ground point. */
export const anchorOf = (at: Point): Point => project(at.x, at.y);
/** Visible to the player and near the view, so effects are not built for unseen fights. */
export function onView(s: WorldRendererState, at: Point, margin = 96): boolean {
  if (s.currentVisibility.sample(at) < 119) return false;
  if (!s.viewWidth || !s.viewHeight) return true;
  const screen = s.view.toScreen(anchorOf(at), s.viewWidth, s.viewHeight);
  return (
    screen.x > -margin &&
    screen.y > -margin &&
    screen.x < s.viewWidth + margin &&
    screen.y < s.viewHeight + margin * 2
  );
}
/** Older fake towns in tests have no combat cues. */
export const cuesOf = (town: Town) => town.combatEvents?.() ?? [];
const byName = new Map(skills.map((skill) => [skill.name.toLowerCase(), skill.id]));
const nameWords: readonly [string, AbilityId][] = [
  ['challenge', 'challenge'],
  ['whirl', 'whirl'],
  ['aim', 'aimed'],
  ['volley', 'volley'],
  ['frost', 'frost'],
  ['burst', 'burst'],
  ['rune', 'burst'],
  ['mend', 'mend'],
  ['sanctuary', 'sanctuary'],
  ['dirge', 'dirge'],
  ['verse', 'rally'],
  ['rally', 'rally'],
];
/** Which skill an Ability cue is: its own id, else its name, else the user's first skill. */
export function skillOfCue(town: Town, event: CombatEvent): AbilityId | null {
  if (event.skill) return event.skill;
  const name = event.text.toLowerCase(),
    exact = byName.get(name);
  if (exact) return exact;
  for (const [word, id] of nameWords) if (name.includes(word)) return id;
  const calling = town.person?.(event.person)?.calling;
  return calling === undefined ? null : (skillOfCalling(calling, 0)?.id ?? null);
}
