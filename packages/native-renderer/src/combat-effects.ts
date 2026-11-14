// Flat painterly contact effects: one per swing by weapon, bites, blocks, kills, wisps, skills and the brood's
// moments. A crowd keeps the most important effects and drops the least important first.
import { distance, project, unproject, type Point } from '../../engine/src/geometry';
import { CombatCue, MonsterRank, type CombatEvent } from '../../engine/src/combat-events';
import type { Hit, Monster } from '../../engine/src/person';
import { skillSpec, StrikeKind, strikeOf } from '../../engine/src/skill-catalog';
import type { Town } from '../../engine/src/town';
import { SceneNode, type Rgb } from './paint';
import {
  appendBlade,
  appendChevron,
  appendCloud,
  appendShard,
  appendStreak,
  appendWisp,
  combatLayers,
  cuesOf,
  dust,
  ease,
  extentOf,
  flat,
  inTier,
  groundRadii,
  isPrimary,
  jitter,
  motes,
  chevrons,
  onView,
  piece,
  posePiece,
  shardRing,
  shards,
  skillCastOf,
  skillOfCue,
  strikeOfHit,
  swingsOf,
  tone,
  unit,
  type Piece,
} from './combat-paint';
import { monsterHeight } from './monster-rank-look';
import { cleave, crush, pierce, splash, type Offset } from './strike-effects';
import {
  aimMark,
  castRing,
  challenge,
  dirgeWave,
  frostBite,
  mendCast,
  sanctuaryBloom,
  verse,
  volleyRain,
  whirl,
} from './skill-effects';
import { broodBreak, denCollapse, killBurst, spawnPuff } from './swarm-effects';
import type { Sprite, WorldRendererState } from './world-renderer-state';
import { boxAt, DepthSlot, inFront, Tier, type Extent } from './combat-depth';

export enum EffectKind {
  Slash,
  Streak,
  Bite,
  Block,
  /** A guardian's own sprite breaking up. */
  Kill,
  Wisp,
  Downed,
  Revived,
  LevelUp,
  Enrage,
  Motes,
  Challenge,
  Aim,
  Cast,
  Verse,
  Cleave,
  Crush,
  Pierce,
  Splash,
  Whirl,
  Volley,
  Frost,
  Sanctuary,
  Dirge,
  /** Any other monster's fall: a small ground burst; the rig animates the body. */
  Fall,
  Spawn,
  DenCollapse,
  BroodBreak,
}
/** What a crowd keeps first (higher) and drops first (lower). */
const importanceOf: Record<EffectKind, number> = {
  [EffectKind.Slash]: 2,
  [EffectKind.Streak]: 2,
  [EffectKind.Bite]: 5,
  [EffectKind.Block]: 3,
  [EffectKind.Kill]: 8,
  [EffectKind.Wisp]: 9,
  [EffectKind.Downed]: 9,
  [EffectKind.Revived]: 7,
  [EffectKind.LevelUp]: 6,
  [EffectKind.Enrage]: 8,
  [EffectKind.Motes]: 5,
  [EffectKind.Challenge]: 7,
  [EffectKind.Aim]: 6,
  [EffectKind.Cast]: 6,
  [EffectKind.Verse]: 7,
  [EffectKind.Cleave]: 3,
  [EffectKind.Crush]: 3,
  [EffectKind.Pierce]: 3,
  [EffectKind.Splash]: 3,
  [EffectKind.Whirl]: 7,
  [EffectKind.Volley]: 7,
  [EffectKind.Frost]: 7,
  [EffectKind.Sanctuary]: 7,
  [EffectKind.Dirge]: 7,
  [EffectKind.Fall]: 1,
  [EffectKind.Spawn]: 2,
  [EffectKind.DenCollapse]: 9,
  [EffectKind.BroodBreak]: 10,
};
export interface Effect {
  kind: EffectKind;
  at: number;
  importance: number;
  /** Ground point the effect hangs from, and how far above it. */
  anchor: Point;
  lift: number;
  /** Resident it follows, or -1. */
  follow: number;
  /** The figure a body shape landed on, which it sorts just in front of; the anchor when unset. */
  bodyAt?: Point;
  /** Its shapes by where they are drawn. */
  parts: EffectPart[];
  pieces: Piece[];
  life: number;
  /** A slain guardian's own sprite, breaking up in its row. */
  remains?: { sprite: Sprite; matrix: readonly number[] };
}
export interface EffectPart {
  tier: Tier;
  node: SceneNode;
  pieces: Piece[];
  /** Screen offset of a standing part's ground point from the effect's. */
  foot?: { x: number; y: number };
  /** Set for standing and body parts: the node sorted with the world. */
  slot?: DepthSlot;
  extent: Extent;
}
/** Where an effect's shapes go unless a shape says otherwise. */
const tierOf: Record<EffectKind, Tier> = {
  [EffectKind.Slash]: Tier.Body,
  [EffectKind.Streak]: Tier.Body,
  [EffectKind.Bite]: Tier.Body,
  [EffectKind.Block]: Tier.Body,
  [EffectKind.Kill]: Tier.Standing,
  [EffectKind.Wisp]: Tier.Standing,
  [EffectKind.Downed]: Tier.Standing,
  [EffectKind.Revived]: Tier.Body,
  [EffectKind.LevelUp]: Tier.Body,
  [EffectKind.Enrage]: Tier.Ground,
  [EffectKind.Motes]: Tier.Body,
  [EffectKind.Challenge]: Tier.Ground,
  [EffectKind.Aim]: Tier.Overhead,
  [EffectKind.Cast]: Tier.Body,
  [EffectKind.Verse]: Tier.Body,
  [EffectKind.Cleave]: Tier.Body,
  [EffectKind.Crush]: Tier.Body,
  [EffectKind.Pierce]: Tier.Body,
  [EffectKind.Splash]: Tier.Body,
  [EffectKind.Whirl]: Tier.Standing,
  [EffectKind.Volley]: Tier.Standing,
  [EffectKind.Frost]: Tier.Ground,
  [EffectKind.Sanctuary]: Tier.Ground,
  [EffectKind.Dirge]: Tier.Ground,
  [EffectKind.Fall]: Tier.Standing,
  [EffectKind.Spawn]: Tier.Standing,
  [EffectKind.DenCollapse]: Tier.Standing,
  [EffectKind.BroodBreak]: Tier.Ground,
};
interface EffectState {
  town: Town;
  nextHit: bigint;
  nextCue: bigint;
  effects: Effect[];
  pieces: number;
  /** Parts sorted with the world right now; each one costs the world's order a member. */
  sorted: number;
  /** Ranks seen last frame, so a death can still be told apart after the monster is gone. */
  ranks: Map<number, MonsterRank>;
  /** Rangers whose next shot is an Aimed Shot, until this clock time. */
  aiming: Map<number, number>;
  /** Names depth keys uniquely. */
  serial: number;
}
export const maxEffects = 40;
/** Live pieces across every effect; a crowd's blows give way before this is passed. */
export const maxPieces = 480;
/** Effect parts in the world's depth order at once; the least important effects give way first. */
export const maxSorted = 40;
/** Sorted parts join and leave the world's order on this beat, so a busy fight re-sorts it at most this often. */
const sortTick = 1 / 30;
const onTick = (t: number) => Math.ceil(t / sortTick - 1e-6) * sortTick;
const leanPieces = 6;
const states = new WeakMap<WorldRendererState, EffectState>();

export function combatEffectsOf(s: WorldRendererState): readonly Effect[] {
  return states.get(s)?.effects ?? [];
}
function stateOf(s: WorldRendererState, town: Town): EffectState {
  let state = states.get(s);
  if (!state || state.town !== town) {
    if (state) for (const effect of state.effects) retire(s, effect);
    state = {
      town,
      nextHit: 0n,
      nextCue: 0n,
      effects: [],
      pieces: 0,
      sorted: 0,
      ranks: new Map(),
      aiming: new Map(),
      serial: 0,
    };
    states.set(s, state);
  }
  return state;
}
function retire(s: WorldRendererState, effect: Effect): void {
  for (const part of effect.parts)
    if (part.slot) part.slot.detach();
    else (part.tier === Tier.Ground ? s.combatGround : combatLayers(s).effects).remove(part.node);
  if (effect.remains) s.rows[effect.remains.sprite.row]?.remove(effect.remains.sprite.paint);
}
const sortedIn = (effect: Effect) => effect.parts.reduce((n, part) => n + (part.slot ? 1 : 0), 0);
/** Whether an effect this important would be kept, so a crowd does not build pieces only to drop them. */
function admits(state: EffectState, importance: number): boolean {
  return (
    (state.effects.length < maxEffects && state.pieces < maxPieces && state.sorted < maxSorted) ||
    state.effects.some((e) => e.importance <= importance)
  );
}
function evictOne(s: WorldRendererState, state: EffectState): void {
  let worst = 0;
  for (let i = 1; i < state.effects.length; i++)
    if (state.effects[i].importance < state.effects[worst].importance) worst = i;
  const [gone] = state.effects.splice(worst, 1);
  state.pieces -= gone.pieces.length;
  state.sorted -= sortedIn(gone);
  retire(s, gone);
}
function add(
  s: WorldRendererState,
  state: EffectState,
  kind: EffectKind,
  at: number,
  anchor: Point,
  lift: number,
  pieces: Piece[],
  follow = -1,
  bonus = 0,
  bodyAt?: Point,
): Effect | null {
  const importance = importanceOf[kind] + bonus;
  if (!pieces.length || !admits(state, importance)) return null;
  // A busy fight keeps only an ordinary blow's main masses, which every builder lists first.
  if (importance <= 4 && state.pieces > maxPieces * 0.4) pieces = pieces.slice(0, leanPieces);
  // One node per tier, and per ground point for standing shapes, so pieces sharing a spot sort together.
  const parts = new Map<string, EffectPart>(),
    id = state.serial++,
    pale = nightLift(state.town);
  for (const p of pieces) {
    if (pale > 0 && p.tier !== Tier.Overhead && p.node.color) {
      // Under the land's light: at night an effect pales toward its lightest tone so it still reads.
      const [r, g, b, a] = p.node.color,
        [pr, pg, pb] = tone.peach;
      p.node.fill(r + (pr - r) * pale, g + (pg - g) * pale, b + (pb - b) * pale, a);
    }
    const tier = p.tier ?? tierOf[kind],
      foot = tier === Tier.Standing ? p.foot : undefined,
      key = foot ? `${tier}:${Math.round(foot.x)},${Math.round(foot.y)}` : `${tier}`;
    let part = parts.get(key);
    if (!part) {
      const slot = tier === Tier.Standing || tier === Tier.Body ? new DepthSlot(`fx:${id}:${key}`) : undefined;
      part = { tier, node: slot?.node ?? new SceneNode(), slot, pieces: [], foot, extent: extentOf([]) };
      parts.set(key, part);
    }
    part.pieces.push(p);
    p.node.opacity(0);
    part.node.add(p.node);
  }
  let life = 0;
  for (const p of pieces) life = Math.max(life, p.delay + p.life);
  const effect: Effect = {
    kind,
    at,
    importance,
    anchor: { ...anchor },
    lift,
    follow,
    bodyAt: bodyAt && { ...bodyAt },
    parts: [...parts.values()],
    pieces,
    life,
  };
  for (const part of effect.parts) {
    part.extent = extentOf(part.pieces);
    part.node.opacity(0);
    if (!part.slot) (part.tier === Tier.Ground ? s.combatGround : combatLayers(s).effects).add(part.node);
  }
  state.effects.push(effect);
  state.pieces += pieces.length;
  state.sorted += sortedIn(effect);
  while (
    state.effects.length > 1 &&
    (state.effects.length > maxEffects || state.pieces > maxPieces || state.sorted > maxSorted)
  )
    evictOne(s, state);
  return state.effects.includes(effect) ? effect : null;
}
const screenAngle = (from: Point, to: Point) => {
  const a = project(from.x, from.y),
    b = project(to.x, to.y);
  return Math.atan2(b.y - a.y, b.x - a.x || 1e-6);
};
const offset = (from: Point, to: Point): Offset => {
  const a = project(from.x, from.y),
    b = project(to.x, to.y);
  return { x: b.x - a.x, y: b.y - a.y };
};
function struckFoe(at: Point, monsters: readonly Monster[]): Monster | undefined {
  let foe: Monster | undefined,
    gap = 0.7;
  for (const m of monsters) {
    const d = distance(m.position, at);
    if (d < gap) {
      gap = d;
      foe = m;
    }
  }
  return foe;
}
function bodyHeight(s: WorldRendererState, town: Town, foe: Monster | undefined, onPerson: boolean): number {
  if (onPerson) return 12;
  return foe ? monsterHeight(town, foe, s) * 0.5 : 9;
}

function slash(seed: number, angle: number, crit: boolean): Piece[] {
  // A diagonal cut across the line of the blow, leaning one way or the other.
  const across = angle + Math.PI / 2 + (seed % 2 ? 0.7 : -0.7) + (jitter(seed, 7) - 0.5) * 0.5,
    big = crit ? 1.45 : 1,
    drift = { vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3 };
  return [
    piece(appendBlade(flat(tone.ink), 16, 2.6, 0.28), {
      angle: across,
      size: big,
      life: 0.28,
      end: 0.7,
      thin: 0.15,
      ...drift,
    }),
    piece(appendBlade(flat(tone.peach), 13, 1.6, 0.28), {
      x: -Math.sin(across) * 1.2,
      y: Math.cos(across) * -1.2,
      angle: across,
      size: big,
      delay: 0.015,
      life: 0.26,
      end: 0.75,
      thin: 0.1,
      ...drift,
    }),
    ...shards(
      seed,
      crit ? 7 : 3,
      angle,
      crit ? 2.4 : 1.4,
      crit ? 17 : 11,
      crit ? [tone.ochre, tone.peach, tone.rust] : [tone.ochre, tone.sand],
    ),
  ];
}
function streak(seed: number, length: number, aimed: boolean, tint: Rgb): Piece[] {
  const width = aimed ? 3.6 : 2.2;
  // Drawn back from the target, so it collapses into the point of impact.
  return [
    piece(appendStreak(flat(tone.ink), length, width * 1.5), {
      life: aimed ? 0.3 : 0.17,
      end: 0.15,
      thin: 0.4,
    }),
    piece(appendStreak(flat(aimed ? tone.teal : tint), length * 0.92, width), {
      life: aimed ? 0.28 : 0.15,
      end: 0.15,
      thin: 0.3,
    }),
    piece(appendCloud(flat(tone.sand), 4.5, 3, 3, seed), { vy: -4, delay: 0.05, life: 0.4, end: 1.5 }),
    ...shards(seed, aimed ? 5 : 2, 0, Math.PI * 2, aimed ? 12 : 7, [tone.sand, tone.ochre]),
  ];
}
function jaw(color: Rgb, down: boolean, width: number) {
  const node = flat(color),
    teeth = 4,
    tooth = width / teeth,
    sign = down ? 1 : -1;
  node.moveTo(-width / 2, -sign * 2);
  for (let i = 0; i < teeth; i++) {
    node.lineTo(-width / 2 + tooth * (i + 0.5), sign * 2.6);
    node.lineTo(-width / 2 + tooth * (i + 1), 0);
  }
  return node.lineTo(width / 2, -sign * 2).close();
}
function bite(seed: number, angle: number): Piece[] {
  // The jaws close on the side the bite came from, clear of the face.
  const x = -Math.cos(angle) * 5,
    y = -Math.sin(angle) * 3,
    jaws = { x, size: 0.8, life: 0.3, end: 0.8 };
  return [
    piece(jaw(tone.ink, true, 13), { ...jaws, y: y - 5.5, vy: 3.6 }),
    piece(jaw(tone.rust, true, 11), { ...jaws, y: y - 5, vy: 3.4, life: 0.28, delay: 0.01 }),
    piece(jaw(tone.ink, false, 13), { ...jaws, y: y + 5.5, vy: -3.6 }),
    piece(jaw(tone.rust, false, 11), { ...jaws, y: y + 5, vy: -3.4, life: 0.28, delay: 0.01 }),
    ...shards(seed, 3, angle, 2.2, 9, [tone.rust, tone.ink]),
  ];
}
function block(seed: number, angle: number): Piece[] {
  // The chevron points back at the attacker.
  const facing = angle + Math.PI + Math.PI / 2;
  return [
    piece(appendChevron(flat(tone.ink), 12, 7, 3.2), { angle: facing, life: 0.36, end: 0.8 }),
    piece(appendChevron(flat(tone.sand), 10, 5.6, 2.2), { angle: facing, life: 0.34, end: 0.8, delay: 0.01 }),
    ...shards(seed, 2, angle + Math.PI, 2.6, 9, [tone.sand]),
  ];
}
function wisp(seed: number): Piece[] {
  const lean = (jitter(seed, 1) - 0.5) * 4;
  // A pale flame-shaped mass with a sand companion leaning off it, rising as the body fades.
  return [
    piece(appendWisp(flat(tone.pale), 26, 8, lean), { vy: -26, life: 2.3, end: 0.5, thin: 1.15 }),
    piece(appendWisp(flat(tone.sand), 15, 4.5, lean + 3), {
      x: 4,
      y: -2,
      vy: -30,
      delay: 0.12,
      life: 2.1,
      end: 0.4,
      thin: 1.2,
    }),
    // Breaking apart near the top.
    ...[0, 1, 2, 3].map((i) =>
      piece(appendWisp(flat(i % 2 ? tone.sand : tone.pale), 6, 2, (i - 1.5) * 1.5), {
        y: -16,
        vx: (i - 1.5) * 9,
        vy: -30 - i * 4,
        delay: 0.9 + i * 0.12,
        life: 1.3,
        end: 0.3,
      }),
    ),
  ];
}
function breakup(seed: number, height: number): Piece[] {
  return Array.from({ length: 9 }, (_, i) => {
    const a = -Math.PI / 2 + (jitter(seed, i) - 0.5) * 2.8,
      y = -height * (0.25 + jitter(seed, i + 9) * 0.6),
      color = i % 3 === 2 ? tone.ochre : i % 2 ? tone.dusk : tone.ink,
      size = (color === tone.ochre ? 2 : 3.2) + jitter(seed, i + 18) * 2;
    return piece(appendShard(flat(color), size, seed + i), {
      x: (jitter(seed, i + 27) - 0.5) * 10,
      y,
      vx: Math.cos(a) * (14 + jitter(seed, i + 36) * 14),
      vy: Math.sin(a) * 12,
      fall: 20,
      angle: a,
      spin: (jitter(seed, i + 45) - 0.5) * 6,
      delay: 0.06 + jitter(seed, i + 54) * 0.05,
      life: 0.55 + jitter(seed, i + 63) * 0.2,
      end: 0.4,
    });
  });
}
/** The struck point nearest the viewer: a sweep over several enemies sorts in front of that one. */
const nearest = (swing: readonly Hit[]): Point =>
  swing.reduce((best, h) => (h.to.x + h.to.y > best.x + best.y ? h.to : best), swing[0].to);
/** How far night pales an effect's colours, 0 by day. */
const nightLift = (town: Town) => 0.45 * (town.climate?.().night ?? 0);
const swarm = (rank: MonsterRank | undefined) => rank === MonsterRank.Swarmer || rank === MonsterRank.Spitter;

/** One effect per swing: its weapon's shape across every enemy it caught. */
function onSwing(s: WorldRendererState, state: EffectState, swing: Hit[], monsters: readonly Monster[]): void {
  const town = state.town,
    first = swing.find(isPrimary) ?? swing[0],
    rest = swing.filter((h) => h !== first),
    seed = Number(first.serial % 100000n),
    angle = screenAngle(first.from, first.to),
    foe = first.onPerson ? undefined : struckFoe(first.to, monsters),
    lift = bodyHeight(s, town, foe, first.onPerson),
    crit = swing.some((h) => h.crit),
    // Crits and blows on a resident matter more; a swarmer's blows matter least.
    bonus = (crit ? 2 : 0) - (swarm(foe?.rank) ? 1 : 0);
  if ((first.onPerson && first.person < 0) || !onView(s, first.to)) return;
  if (first.blocked) {
    add(s, state, EffectKind.Block, first.at, first.to, lift, block(seed, angle), -1, bonus);
    return;
  }
  if (first.onPerson) {
    add(s, state, EffectKind.Bite, first.at, first.to, lift, bite(seed, angle), -1, bonus);
    return;
  }
  const by = first.attacker ?? first.person,
    cast = skillCastOf(town, swing);
  // A landing skill is drawn by its own effect; only the Aimed Shot keeps its streak.
  if (cast && cast.skill !== 'aimed') return;
  const aimed = cast?.skill === 'aimed' || (state.aiming.get(by) ?? -1) >= first.at;
  if (aimed) state.aiming.delete(by);
  if (!admits(state, importanceOf[EffectKind.Cleave] + bonus + (aimed ? 4 : 0))) return;
  const strike = aimed ? StrikeKind.Single : strikeOfHit(first);
  switch (strike) {
    case StrikeKind.Cleave: {
      const targets = [first, ...rest].map((h) => {
        const o = offset(h.from, h.to);
        return { x: o.x, y: o.y - (bodyHeight(s, town, struckFoe(h.to, monsters), false) - 8) };
      });
      add(s, state, EffectKind.Cleave, first.at, first.from, 8, cleave(seed, targets, crit), -1, bonus, nearest(swing));
      return;
    }
    case StrikeKind.Crush:
      add(s, state, EffectKind.Crush, first.at, first.to, lift, crush(seed, lift, crit), -1, bonus);
      return;
    case StrikeKind.Pierce: {
      let last = first;
      for (const h of rest) if (distance(h.to, first.from) > distance(last.to, first.from)) last = h;
      const path = [first.from, ...[first, ...rest].map((h) => h.to)].map((p) => offset(last.to, p));
      add(s, state, EffectKind.Pierce, first.at, last.to, lift, pierce(seed, path, crit), -1, bonus, nearest(swing));
      return;
    }
    case StrikeKind.Splash:
      add(
        s,
        state,
        EffectKind.Splash,
        first.at,
        first.to,
        lift,
        splash(seed, offset(first.to, first.from), lift, groundRadii(strikeOf('staff').reach), crit),
        -1,
        bonus,
      );
      return;
  }
  if (first.ranged) {
    const from = project(first.from.x, first.from.y),
      to = project(first.to.x, first.to.y),
      length = Math.min(aimed ? 200 : 120, Math.hypot(to.x - from.x, to.y - from.y) - 4);
    const effect = add(
      s,
      state,
      EffectKind.Streak,
      first.at,
      first.to,
      lift,
      streak(seed, Math.max(6, length), aimed || crit, tone.peach),
      -1,
      bonus + (aimed ? 4 : 0),
    );
    // The streak and its dark companion lie along the flight; puffs and shards stay upright.
    if (effect) for (const p of effect.pieces.slice(0, 2)) p.angle = angle;
    return;
  }
  add(s, state, EffectKind.Slash, first.at, first.to, lift, slash(seed, angle, crit), -1, bonus);
}

function onSkill(s: WorldRendererState, state: EffectState, event: CombatEvent, seed: number): void {
  const skill = skillOfCue(state.town, event);
  if (!skill) return;
  const delay = skillSpec(skill).delay,
    lands = event.at + delay,
    { rx, ry } = groundRadii(event.radius > 0 ? event.radius : skillSpec(skill).radius);
  switch (skill) {
    case 'burst':
      // The circle itself belongs to the ground telegraphs; here only the cast at the mage.
      add(s, state, EffectKind.Cast, event.at, event.position, 12, castRing(seed), event.person);
      break;
    case 'challenge':
      add(s, state, EffectKind.Challenge, event.at, event.position, 0, challenge(seed), event.person);
      break;
    case 'aimed':
      state.aiming.set(event.person, event.at + 1.5);
      add(s, state, EffectKind.Aim, event.at, event.position, 14, aimMark(), event.person);
      break;
    case 'mend':
      add(s, state, EffectKind.Cast, event.at, event.position, 12, mendCast(seed), event.person);
      break;
    case 'rally':
      add(s, state, EffectKind.Verse, event.at, event.position, 6, verse(seed), event.person);
      break;
    case 'whirl':
      add(s, state, EffectKind.Whirl, event.at, event.position, 0, whirl(seed, rx, ry, delay), event.person);
      break;
    case 'volley':
      add(s, state, EffectKind.Volley, lands, event.position, 0, volleyRain(seed, rx, ry));
      break;
    case 'frost':
      add(s, state, EffectKind.Frost, lands, event.position, 0, frostBite(seed, rx, ry));
      break;
    case 'sanctuary':
      add(s, state, EffectKind.Sanctuary, event.at, event.position, 0, sanctuaryBloom(seed, rx, ry));
      break;
    case 'dirge':
      add(s, state, EffectKind.Dirge, event.at, event.position, 0, dirgeWave(seed, rx, ry));
      break;
  }
}
function onCue(s: WorldRendererState, state: EffectState, event: CombatEvent): void {
  const seed = Number(event.serial % 100000n);
  switch (event.cue) {
    case CombatCue.Death:
      add(s, state, EffectKind.Wisp, event.at, event.position, 4, wisp(seed));
      break;
    case CombatCue.Downed:
      add(s, state, EffectKind.Downed, event.at, event.position, 2, [
        ...dust(seed, 9),
        ...shards(seed, 3, -Math.PI / 2, 2.4, 9, [tone.rust, tone.ink]),
      ]);
      break;
    case CombatCue.Revived:
      add(
        s,
        state,
        EffectKind.Revived,
        event.at,
        event.position,
        8,
        [...motes(seed, 5, [tone.leaf, tone.sage], 22), ...inTier(Tier.Overhead, chevrons(tone.leaf, 1))],
        event.person,
      );
      break;
    case CombatCue.Heal:
      add(
        s,
        state,
        EffectKind.Motes,
        event.at,
        event.position,
        10,
        motes(seed, 5, [tone.leaf, tone.sage, tone.leaf], 20),
        event.person,
      );
      break;
    case CombatCue.LevelUp:
      add(
        s,
        state,
        EffectKind.LevelUp,
        event.at,
        event.position,
        14,
        [...inTier(Tier.Overhead, chevrons(tone.sage, 3)), ...motes(seed, 3, [tone.teal, tone.sage], 16)],
        event.person,
      );
      break;
    case CombatCue.Enrage:
      add(s, state, EffectKind.Enrage, event.at, event.position, 0, [
        ...shardRing(seed, 9, 10, 26, tone.rust, tone.ochre),
        ...shardRing(seed + 7, 9, 6, 20, tone.rust, tone.ink, 0.3),
      ]);
      break;
    case CombatCue.Ability:
      onSkill(s, state, event, seed);
      break;
    case CombatCue.Kill: {
      const rank = state.ranks.get(event.creature);
      // A guardian breaks up its own sprite (releaseBeast); a den has its own collapse; animals fall quietly.
      if (rank === undefined || rank === MonsterRank.Guardian || rank === MonsterRank.Den) break;
      add(s, state, EffectKind.Fall, event.at, event.position, 0, killBurst(seed), -1, swarm(rank) ? 0 : 1);
      break;
    }
    case CombatCue.Spawn:
      add(s, state, EffectKind.Spawn, event.at, event.position, 0, spawnPuff(seed));
      break;
    case CombatCue.DenDestroyed:
      add(s, state, EffectKind.DenCollapse, event.at, event.position, 0, denCollapse(seed));
      break;
    case CombatCue.BroodBreak:
      add(
        s,
        state,
        EffectKind.BroodBreak,
        event.at,
        event.position,
        0,
        broodBreak(seed, groundRadii(event.radius > 0 ? event.radius : 9).rx),
      );
      break;
  }
}

/** Takes over a slain monster's sprite so it breaks apart instead of vanishing: a guardian (the rig plays every
 * other monster's fall), or a monster that died with its brood without a Kill cue of its own. */
export function releaseBeast(s: WorldRendererState, town: Town, id: number, sprite: Sprite): boolean {
  if (s.sceneView || sprite.row < 0 || !sprite.paint.alpha) return false;
  const state = stateOf(s, town),
    now = town.clock(),
    rank = state.ranks.get(id),
    recent = (cue: CombatCue, e: CombatEvent) => e.cue === cue && now - e.at < 1 && now >= e.at,
    kill = cuesOf(town).find((e) => recent(CombatCue.Kill, e) && e.creature === id),
    brood = kill ? undefined : cuesOf(town).find((e) => recent(CombatCue.BroodBreak, e));
  const cause = kill && rank === MonsterRank.Guardian ? kill : brood;
  if (!cause || rank === undefined || rank === MonsterRank.Den) return false;
  if (state.effects.some((e) => e.remains?.sprite === sprite)) return false;
  const matrix = sprite.paint.matrix,
    height = 18 * Math.abs(matrix[4]),
    seed = Number((cause.serial + BigInt(id)) % 100000n),
    effect = kill
      ? add(s, state, EffectKind.Kill, now, kill.position, 0, [
          ...breakup(seed, height),
          ...dust(seed, 8 * Math.abs(matrix[0])),
        ])
      : add(s, state, EffectKind.Fall, now, unproject(matrix[2], matrix[5]), 0, killBurst(seed));
  if (!effect) return false;
  effect.remains = { sprite, matrix: [...matrix] };
  return true;
}

/** Consumes new cues and blows, then poses every live effect. */
export function updateCombatEffects(s: WorldRendererState, town: Town): void {
  const state = stateOf(s, town),
    now = town.clock(),
    monsters = town.monsters();
  for (const m of monsters) state.ranks.set(m.id, m.rank);
  if (state.ranks.size > monsters.length + 256) {
    const live = new Set(monsters.map((m) => m.id));
    for (const id of state.ranks.keys()) if (!live.has(id)) state.ranks.delete(id);
  }
  // Cues first: an Aimed Shot's cue and its blow arrive in the same tick.
  for (const event of cuesOf(town)) {
    if (event.serial < state.nextCue) continue;
    state.nextCue = event.serial + 1n;
    if (now - event.at > (event.cue === CombatCue.Death ? 2 : 0.6) || !onView(s, event.position, 160)) continue;
    onCue(s, state, event);
  }
  const fresh: Hit[] = [];
  for (const hit of town.hits()) {
    if (hit.serial < state.nextHit) continue;
    state.nextHit = hit.serial + 1n;
    if (now - hit.at <= 0.3) fresh.push(hit);
  }
  for (const swing of swingsOf(fresh)) onSwing(s, state, swing, monsters);
  const visible = (at: Point) => s.currentVisibility.sample(at) >= 119;
  state.effects = state.effects.filter((effect) => {
    const age = now - effect.at;
    if (now >= onTick(effect.at + effect.life) || age < -2) {
      state.pieces -= effect.pieces.length;
      state.sorted -= sortedIn(effect);
      retire(s, effect);
      return false;
    }
    const follow = effect.follow >= 0 ? town.person(effect.follow)?.position : undefined;
    if (follow) {
      if (effect.bodyAt) effect.bodyAt = { x: effect.bodyAt.x + follow.x - effect.anchor.x, y: effect.bodyAt.y + follow.y - effect.anchor.y };
      effect.anchor = { ...follow };
    }
    const at = project(effect.anchor.x, effect.anchor.y),
      top = at.y - effect.lift,
      // A skill that lands later waits unseen; fog hides it as it hides units.
      shown = now >= onTick(effect.at) && visible(effect.anchor);
    if (age >= 0) for (const p of effect.pieces) posePiece(p, age);
    for (const part of effect.parts) {
      part.node.translate(at.x, top);
      // A sorted part stays in the world's order for the whole effect: joining or leaving it re-sorts and
      // refills the world, so it is done once each, on a shared tick.
      part.node.opacity(shown && (part.slot || part.pieces.some((p) => p.node.alpha > 0)) ? 255 : 0);
      if (!part.slot) continue;
      const ground =
        part.tier === Tier.Body
          ? inFront(effect.bodyAt ?? effect.anchor)
          : part.foot
            ? unproject(at.x + part.foot.x, at.y + part.foot.y)
            : effect.anchor;
      part.slot.place(s, ground, boxAt(at.x, top, part.extent));
    }
    if (effect.remains) {
      // A short squash, then the body sinks and thins out while its pieces fly.
      const m = effect.remains.matrix,
        squash = age < 0.07 ? ease.out(age / 0.07) : 1 - ease.in(unit((age - 0.07) / 0.3)),
        sx = age < 0.07 ? 1 + 0.08 * squash : 1 + 0.15 * (1 - squash),
        sy = age < 0.07 ? 1 - 0.08 * squash : 0.3 + 0.62 * squash;
      effect.remains.sprite.paint.transform([m[0] * sx, 0, m[2], 0, m[4] * sy, m[5], 0, 0, 1]);
      effect.remains.sprite.paint.opacity(Math.round(255 * (age < 0.07 ? 1 : squash)));
      if (age > 0.4) {
        s.rows[effect.remains.sprite.row]?.remove(effect.remains.sprite.paint);
        effect.remains = undefined;
      }
    }
    return true;
  });
}

/** A short shake when a slam lands, a guardian or a den falls, or the brood breaks; none with reduced motion. */
export function worldShake(s: WorldRendererState, town: Town): Point {
  if (s.reducedMotion || s.sceneView || s.editorView) return { x: 0, y: 0 };
  const now = town.clock(),
    state = states.get(s),
    ranks = state?.town === town ? state.ranks : undefined;
  let strength = 0;
  for (const event of cuesOf(town)) {
    const age = now - event.at,
      span =
        event.cue === CombatCue.BroodBreak
          ? 0.4
          : event.cue === CombatCue.DenDestroyed ||
              event.cue === CombatCue.Slam ||
              (event.cue === CombatCue.Kill && ranks?.get(event.creature) === MonsterRank.Guardian)
            ? event.cue === CombatCue.DenDestroyed
              ? 0.16
              : 0.12
            : 0;
    if (!span || age < 0 || age > span) continue;
    strength = Math.max(strength, (1 - age / span) * (event.cue === CombatCue.BroodBreak ? 0.8 : 1));
  }
  if (!strength) return { x: 0, y: 0 };
  return { x: Math.sin(now * 95) * 2.5 * strength, y: Math.cos(now * 77) * 1.6 * strength };
}
