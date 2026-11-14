// Skills that hold ground for a while, each at its true radius: the volley's mark until the arrows fall, the
// frost ring's standing crystals ("slow here"), the hallowed circle with its slow motes, and the dirge's
// drooping mark over each foe it holds.
import { distance, project, unproject, type Point } from '../../engine/src/geometry';
import { boxAt, DepthSlot, type Extent } from './combat-depth';
import { CombatCue, MonsterRank, type AbilityId, type CombatEvent } from '../../engine/src/combat-events';
import { skillSpec } from '../../engine/src/skill-catalog';
import type { Town } from '../../engine/src/town';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import {
  appendChevron,
  appendLeaf,
  appendTaperArc,
  combatLayers,
  cuesOf,
  ease,
  flat,
  groundRadii,
  jitter,
  onView,
  popScale,
  skillOfCue,
  tone,
  unit,
} from './combat-paint';
import { monsterHeight } from './monster-rank-look';
import type { WorldRendererState } from './world-renderer-state';

export enum FieldKind {
  Volley,
  Frost,
  Sanctuary,
  Dirge,
}
export interface Field {
  kind: FieldKind;
  /** Clock time it shows from, and until. */
  at: number;
  until: number;
  center: Point;
  radius: number;
  /** On the ground layer, under standing figures. */
  node: SceneNode;
  pose: (age: number, left: number) => void;
  /** Marks over held foes, above everything in the effects layer. */
  marks: { creature: number; node: SceneNode }[];
  /** Bits with height, sorted with the world. */
  standing: Standing[];
}
interface FieldState {
  town: Town;
  next: bigint;
  fields: Field[];
}
export const maxFields = 12;
const maxMarks = 24;
const states = new WeakMap<WorldRendererState, FieldState>();
export function skillFieldsOf(s: WorldRendererState): readonly Field[] {
  return states.get(s)?.fields ?? [];
}

/** Seconds a lasting skill holds once landed: the cue's own duration when it is not just the wind-up. */
function lasting(skill: AbilityId, event: CombatEvent): number {
  const spec = skillSpec(skill);
  if (spec.duration <= 0) return 0;
  return event.duration > spec.delay + 0.05 ? event.duration : spec.duration;
}
const disc = (rx: number, ry: number, color: Rgb, alpha: number) =>
  new ShapeNode().appendCircle(0, 0, rx, ry).fill(color[0], color[1], color[2], alpha);
/** A thin tapered sliver from one point to another, for cracks. */
function sliver(shape: ShapeNode, x0: number, y0: number, x1: number, y1: number, w: number): ShapeNode {
  const dx = x1 - x0,
    dy = y1 - y0,
    l = Math.hypot(dx, dy) || 1,
    nx = (-dy / l) * (w / 2),
    ny = (dx / l) * (w / 2),
    mx = x0 + dx * 0.4,
    my = y0 + dy * 0.4;
  return shape
    .moveTo(x0, y0)
    .lineTo(mx + nx, my + ny)
    .lineTo(x1, y1)
    .lineTo(mx - nx, my - ny)
    .close();
}
/** A leaf lying on the ground at (x, y), turned by `angle`, squashed into the iso plane. */
function groundLeaf(shape: ShapeNode, x: number, y: number, angle: number, length: number, width: number) {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    at = (u: number, v: number): [number, number] => [x + u * c - v * s, y + (u * s + v * c) * 0.5],
    h = length / 2,
    w = width * 0.75;
  shape.moveTo(...at(-h, 0));
  shape.cubicTo(...at(-h * 0.35, -w), ...at(h * 0.35, -w), ...at(h, 0));
  shape.cubicTo(...at(h * 0.35, w), ...at(-h * 0.35, w), ...at(-h, 0));
  return shape.close();
}
const scaled = (node: SceneNode | ShapeNode, k: number, y = 0) => node.transform([k, 0, 0, 0, k, y, 0, 0, 1]);

function volleyMark(rx: number, ry: number, seed: number): Pick<Field, 'node' | 'pose'> {
  const node = new SceneNode(),
    fill = disc(rx, ry, tone.olive, 70),
    rim = flat(tone.brown),
    ticks = flat(tone.ochre),
    closing = new SceneNode();
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2 + jitter(seed, i) * 0.2;
    appendTaperArc(rim, rx, ry, a0, a0 + (Math.PI * 2) / 5 - 0.3, 3.2, 0.45, 0.45);
  }
  // Ticks point inward: the arrows close on the middle.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3,
      side = 0.06;
    ticks
      .moveTo(Math.cos(a - side) * rx * 1.04, Math.sin(a - side) * ry * 1.04)
      .lineTo(Math.cos(a) * rx * 0.84, Math.sin(a) * ry * 0.84)
      .lineTo(Math.cos(a + side) * rx * 1.04, Math.sin(a + side) * ry * 1.04)
      .close();
  }
  closing.add(rim).add(ticks);
  node.add(disc(rx, ry, tone.olive, 45)).add(fill).add(closing);
  const delay = Math.max(0.1, skillSpec('volley').delay);
  return {
    node,
    pose: (age) => {
      const p = ease.smooth(unit(age / delay));
      scaled(fill, Math.max(0.01, p));
      scaled(closing, 1 - 0.06 * p);
    },
  };
}

/** A standing bit of a field: its node sorted with the world at a ground point offset from the centre. */
export interface Standing {
  slot: DepthSlot;
  foot: { x: number; y: number };
  extent: Extent;
}
const standing = (key: string): Standing => ({
  slot: new DepthSlot(key),
  foot: { x: 0, y: 0 },
  extent: { x0: -24, y0: -40, x1: 24, y1: 12 },
});
type Built = Pick<Field, 'node' | 'pose' | 'standing'>;
const crystalSectors = 6;

function frostRing(s: WorldRendererState, rx: number, ry: number, seed: number, key: string): Built {
  const node = new SceneNode(),
    cracks = flat(tone.rime),
    count = Math.max(10, Math.min(22, Math.round(rx / 8))),
    // The rim is cut into sectors, each sorted where it stands, so a unit inside the ring is in front of
    // the far crystals and behind the near ones.
    sectors = Array.from({ length: crystalSectors }, (_, i) => {
      const mid = ((i + 0.5) / crystalSectors) * Math.PI * 2,
        bit = standing(`${key}:rim:${i}`),
        body = flat(tone.frostDeep),
        facet = flat(tone.rime);
      bit.foot = { x: Math.cos(mid) * rx, y: Math.sin(mid) * ry };
      bit.slot.node.add(body).add(facet);
      return { bit, body, facet };
    }),
    crystals = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + (jitter(seed, i) - 0.5) * 0.25,
        near = Math.sin(a) > 0 ? 1.15 : 1,
        turn = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      return {
        sector: sectors[Math.min(crystalSectors - 1, Math.floor((turn / (Math.PI * 2)) * crystalSectors))],
        x: Math.cos(a) * rx,
        y: Math.sin(a) * ry,
        h: (9 + jitter(seed, i + 30) * 7) * near,
        w: (2.8 + jitter(seed, i + 60) * 1.4) * near,
        lean: (jitter(seed, i + 90) - 0.5) * 0.35,
        // Freezing runs round the ring.
        delay: (i / count) * 0.14,
      };
    }),
    flakes = Array.from({ length: 4 }, (_, i) => {
      const bit = standing(`${key}:flake:${i}`),
        shape = appendLeaf(flat(tone.rime), 3.4, 1.6);
      bit.slot.node.add(shape);
      return { bit, shape };
    });
  for (const sector of sectors) {
    const own = crystals.filter((c) => c.sector === sector);
    sector.bit.extent = {
      x0: Math.min(...own.map((c) => c.x)) - 12,
      y0: Math.min(...own.map((c) => c.y)) - 24,
      x1: Math.max(...own.map((c) => c.x)) + 12,
      y1: Math.max(...own.map((c) => c.y)) + 6,
    };
  }
  for (let i = 0; i < 6; i++) {
    const a = jitter(seed, i + 120) * Math.PI * 2,
      r = 0.25 + jitter(seed, i + 130) * 0.55;
    sliver(
      cracks,
      Math.cos(a) * rx * r,
      Math.sin(a) * ry * r,
      Math.cos(a + 0.5) * rx * (r + 0.3),
      Math.sin(a + 0.5) * ry * (r + 0.3),
      1.4,
    );
  }
  node.add(disc(rx, ry, tone.frost, 55)).add(cracks);
  let built = false;
  const build = (age: number, left: number) => {
    for (const sector of sectors) {
      sector.body.reset();
      sector.facet.reset();
    }
    for (const c of crystals) {
      const t = unit((age - c.delay) / 0.16),
        g = (t < 1 ? ease.out(t) * 1.12 : 1.12 - 0.12 * unit((age - c.delay - 0.16) / 0.1)) * unit(left / 0.35);
      if (g <= 0.02) continue;
      const h = c.h * g,
        w = c.w * (0.6 + 0.4 * g),
        tip = c.x + c.lean * h;
      c.sector.body
        .moveTo(c.x - w, c.y)
        .lineTo(c.x - w * 0.7, c.y - h * 0.55)
        .lineTo(tip, c.y - h)
        .lineTo(c.x + w * 0.8, c.y - h * 0.45)
        .lineTo(c.x + w, c.y)
        .close();
      // The face toward the light, upper left.
      c.sector.facet
        .moveTo(c.x - w * 0.7, c.y - h * 0.55)
        .lineTo(tip, c.y - h)
        .lineTo(c.x + c.lean * h * 0.3, c.y - h * 0.3)
        .close();
    }
  };
  return {
    node,
    standing: [...sectors.map((sector) => sector.bit), ...flakes.map((f) => f.bit)],
    pose: (age, left) => {
      const settled = age > 0.45 && left > 0.4;
      // The crystals only change shape while freezing and thawing; in between their outline is kept.
      if (!settled || !built) {
        build(age, left);
        built = settled;
      }
      const end = unit(left / 0.4);
      flakes.forEach(({ bit, shape }, i) => {
        // Slow flakes settling: a calm drift that says the air is cold here.
        const period = 2.6,
          t = s.reducedMotion ? 0.5 : (age / period + i / flakes.length) % 1,
          cycle = s.reducedMotion ? 0 : Math.floor(age / period + i / flakes.length),
          a = jitter(seed, i * 31 + cycle) * Math.PI * 2,
          r = Math.sqrt(jitter(seed, i * 37 + cycle)) * 0.8,
          k = Math.sin(Math.PI * t) * end,
          x = Math.cos(a) * rx * r,
          y = Math.sin(a) * ry * r;
        // It sorts at the spot it will settle on.
        bit.foot = { x, y };
        bit.extent = { x0: x - 10, y0: y - 24, x1: x + 10, y1: y + 6 };
        shape.transform([k, 0, x + Math.sin(t * 5 + i) * 3, 0, k, y - 16 * (1 - t), 0, 0, 1]);
        shape.opacity(k > 0.05 ? 255 : 0);
      });
    },
  };
}

function sanctuaryCircle(s: WorldRendererState, rx: number, ry: number, seed: number, key: string): Built {
  const node = new SceneNode(),
    ground = new SceneNode(),
    leaves = flat(tone.grove),
    buds = flat(tone.leaf),
    count = 14,
    motes = Array.from({ length: 6 }, (_, i) => {
      const bit = standing(`${key}:mote:${i}`),
        shape = appendLeaf(flat(i % 3 === 0 ? tone.peach : i % 3 === 1 ? tone.leaf : tone.sage), 4.6, 2.8);
      bit.slot.node.add(shape);
      return { bit, shape };
    });
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2,
      b = a + Math.PI / count,
      j = jitter(seed, i);
    groundLeaf(leaves, Math.cos(a) * rx, Math.sin(a) * ry, a + Math.PI / 2 + (j - 0.5) * 0.3, 13 + j * 4, 5);
    // Smaller companions just outside, between the leaves.
    groundLeaf(buds, Math.cos(b) * rx * 1.06, Math.sin(b) * ry * 1.06, b + Math.PI / 2, 7, 3);
  }
  ground.add(disc(rx, ry, tone.leaf, 45)).add(buds).add(leaves);
  node.add(ground);
  return {
    node,
    standing: motes.map((m) => m.bit),
    pose: (age, left) => {
      // Calm: a breath slower than a resting heartbeat, and a gentle spread in and out.
      const breath = s.reducedMotion ? 0 : 0.018 * Math.sin((age / 3.2) * Math.PI * 2),
        open = 0.75 + 0.25 * ease.out(unit(age / 0.6)),
        close = 0.85 + 0.15 * unit(left / 0.6);
      scaled(ground, open * close * (1 + breath));
      const end = unit(left / 0.6);
      motes.forEach(({ bit, shape }, i) => {
        const period = 3.2,
          phase = age / period + i / motes.length,
          t = phase % 1,
          cycle = Math.floor(phase),
          a = jitter(seed, i * 17 + cycle) * Math.PI * 2,
          r = Math.sqrt(jitter(seed, i * 19 + cycle)) * 0.75,
          k = Math.sin(Math.PI * t) * end * unit(age / 0.4),
          x = Math.cos(a) * rx * r,
          y = Math.sin(a) * ry * r;
        // A petal rises from the spot it sorts at.
        bit.foot = { x, y };
        bit.extent = { x0: x - 10, y0: y - 36, x1: x + 10, y1: y + 6 };
        // Petals stand upright as they rise.
        shape.transform([0, -k, x, k, 0, y - 26 * ease.out(t), 0, 0, 1]);
        shape.opacity(k > 0.05 ? 255 : 0);
      });
    },
  };
}

function dirgeMark(): SceneNode {
  const node = new SceneNode(),
    back = appendChevron(flat(tone.brown), 9, 6, 2.6),
    front = appendChevron(flat(tone.dusk), 8, 5.2, 2.4);
  // Points down: the foe's heart sinks.
  back.transform([1, 0, 1, 0, -1, -1, 0, 0, 1]);
  front.transform([1, 0, 0, 0, -1, 0, 0, 0, 1]);
  return node.add(back).add(front);
}

function retire(s: WorldRendererState, field: Field): void {
  s.combatGround.remove(field.node);
  for (const bit of field.standing) bit.slot.detach();
  for (const mark of field.marks) combatLayers(s).effects.remove(mark.node);
}
function open(s: WorldRendererState, state: FieldState, town: Town, event: CombatEvent): void {
  const skill = skillOfCue(town, event);
  if (skill !== 'volley' && skill !== 'frost' && skill !== 'sanctuary' && skill !== 'dirge') return;
  const spec = skillSpec(skill),
    radius = event.radius > 0 ? event.radius : spec.radius,
    { rx, ry } = groundRadii(radius),
    seed = Number(event.serial % 100000n),
    lands = event.at + spec.delay,
    hold = lasting(skill, event);
  let field: Field;
  const base = { center: { ...event.position }, radius, marks: [], standing: [] },
    key = `field:${event.serial}`;
  switch (skill) {
    case 'volley':
      if (spec.delay <= 0) return;
      field = { kind: FieldKind.Volley, at: event.at, until: lands, ...base, ...volleyMark(rx, ry, seed) };
      break;
    case 'frost':
      field = { kind: FieldKind.Frost, at: lands, until: lands + hold, ...base, ...frostRing(s, rx, ry, seed, key) };
      break;
    case 'sanctuary':
      field = { kind: FieldKind.Sanctuary, at: lands, until: lands + hold, ...base, ...sanctuaryCircle(s, rx, ry, seed, key) };
      break;
    case 'dirge': {
      const held = town
        .monsters()
        .filter((m) => !m.insideLair && m.rank !== MonsterRank.Den && distance(m.position, event.position) <= radius)
        .sort((a, b) => distance(a.position, event.position) - distance(b.position, event.position))
        .slice(0, maxMarks);
      field = {
        kind: FieldKind.Dirge,
        at: event.at,
        until: lands + hold,
        ...base,
        node: new SceneNode(),
        pose: () => {},
        marks: held.map((m) => ({ creature: m.id, node: dirgeMark() })),
      };
      for (const mark of field.marks) combatLayers(s).effects.add(mark.node.opacity(0));
      break;
    }
  }
  state.fields.push(field);
  while (state.fields.length > maxFields) retire(s, state.fields.shift()!);
}

/** Opens fields for new skill cues and poses every live one. */
export function updateSkillFields(s: WorldRendererState, town: Town): void {
  let state = states.get(s);
  if (!state || state.town !== town) {
    if (state) for (const field of state.fields) retire(s, field);
    state = { town, next: 0n, fields: [] };
    states.set(s, state);
  }
  const now = town.clock();
  for (const event of cuesOf(town)) {
    if (event.serial < state.next) continue;
    state.next = event.serial + 1n;
    if (event.cue !== CombatCue.Ability || now - event.at > 1 || !onView(s, event.position, 256)) continue;
    open(s, state, town, event);
  }
  state.fields = state.fields.filter((field) => {
    const age = now - field.at,
      left = field.until - now;
    if (left <= 0) {
      retire(s, field);
      return false;
    }
    if (!s.combatGround.children.includes(field.node)) s.combatGround.add(field.node);
    const at = project(field.center.x, field.center.y),
      shown = age >= 0 && s.currentVisibility.sample(field.center) >= 119;
    field.node.translate(at.x, at.y);
    field.node.opacity(shown ? 255 : 0);
    if (age >= 0) field.pose(age, left);
    for (const bit of field.standing) {
      const node = bit.slot.node;
      node.translate(at.x, at.y);
      node.opacity(shown && node.children.some((c) => c.alpha > 0 && (c instanceof ShapeNode ? c.commands.length > 0 : true)) ? 255 : 0);
      bit.slot.place(s, unproject(at.x + bit.foot.x, at.y + bit.foot.y), boxAt(at.x, at.y, bit.extent));
    }
    for (const mark of field.marks) {
      const foe = town.creature(mark.creature);
      if (!foe || foe.health <= 0 || age < 0 || s.currentVisibility.sample(foe.position) < 119) {
        mark.node.opacity(0);
        continue;
      }
      const foot = project(foe.position.x, foe.position.y),
        k = 1.3 * popScale(unit(age / 0.4)) * unit(left / 0.3),
        bob = s.reducedMotion ? 0 : Math.sin((age / 2.2) * Math.PI * 2 + mark.creature) * 1.2;
      mark.node.transform([k, 0, foot.x, 0, k, foot.y - monsterHeight(town, foe, s) - 7 + bob, 0, 0, 1]);
      mark.node.opacity(k > 0.02 ? 255 : 0);
    }
    return true;
  });
}
