// Monsters as rigged figures: each lair's creature is art over a shared skeleton, moved by the shared clips.
import { MonsterRank } from '../../engine/src/combat-events';
import { DungeonKind } from '../../engine/src/world-types';
import type { Matrix, PaintNode, SceneNode } from './paint';
import { oval } from './sprite-primitives';
import type { RigClip } from './rig-clip';
import { denArt } from './monster-dens';
import { draugrKind } from './monster-draugr';
import { goblinKind } from './monster-goblin';
import { impKind } from './monster-imp';
import { jotunnKind } from './monster-jotunn';
import { wargKind } from './monster-warg';
import type { MonsterKind } from './monster-look';

export function monsterKind(lair: DungeonKind): MonsterKind {
  switch (lair) {
    case DungeonKind.Cave:
      return wargKind();
    case DungeonKind.Crypt:
      return draugrKind();
    case DungeonKind.Portal:
    // The way home shares the portal's creatures.
    case DungeonKind.Return:
      return impKind();
    case DungeonKind.GiantHall:
      return jotunnKind();
    default:
      return goblinKind();
  }
}

interface Posed {
  kind: MonsterKind;
  skin: { pose(matrices: readonly Matrix[]): void };
  attack: RigClip;
  /** Swarms run where the rest walk. */
  gait: RigClip;
  rank: MonsterRank;
  id: number;
  stride: number;
  shown: readonly Matrix[] | null;
}
const posed = new WeakMap<SceneNode, Posed>(),
  tops = new WeakMap<SceneNode, number>();
/** Seconds a slain monster takes to crumple, and a newcomer to climb out of its den. */
export const fallSeconds = 0.55,
  emergeSeconds = 0.5;
/** Builds a monster (or, for a den, its nest) under `body` and returns its ground shadow. */
export function monsterBody(body: SceneNode, lair: DungeonKind, id: number, rank: MonsterRank): PaintNode {
  if (rank === MonsterRank.Den) {
    const den = denArt(lair);
    body.add(den.art);
    tops.set(body, den.top);
    return oval([0, 0], den.shadow[0], den.shadow[1], [0, 0, 0, 70]);
  }
  const kind = monsterKind(lair),
    dress = kind.dress(id, rank),
    state: Posed = {
      kind,
      skin: dress.skin,
      attack: dress.attack,
      gait: rank === MonsterRank.Swarmer ? (kind.run ?? kind.walk) : kind.walk,
      rank,
      id,
      stride: 0,
      shown: null,
    };
  body.add(dress.skin.node);
  posed.set(body, state);
  tops.set(body, kind.top);
  show(state, kind.idle, 0, 1);
  return oval([0, 0], kind.shadow[0], kind.shadow[1], [0, 0, 0, 110]);
}
function show(state: Posed, clip: RigClip, frame: number, step: number): void {
  const matrices = state.kind.bank.pose(clip, frame, step);
  // A pack in step shares its poses; a figure whose pose has not moved on is left alone.
  if (matrices === state.shown) return;
  state.shown = matrices;
  state.skin.pose(matrices);
}
export interface MonsterMoment {
  walking: boolean;
  /** Tiles moved since the last frame. */
  moved: number;
  /** Share of the pause since this monster's last blow landed (0 at contact), or negative when it has not struck. */
  blow: number;
  /** How far a telegraphed blow has been wound up (0..1), or null when none is coming. */
  windup?: number | null;
  /** Seconds since it climbed out of a den, or negative when it did not. */
  emerged?: number;
  clock: number;
  /** Frames a moving pose is held: 1 is full motion, more thins the work for a crowd. */
  hold?: number;
}
/** Picks the clip for what the monster is doing and poses its art. */
export function poseMonster(body: SceneNode, moment: MonsterMoment): void {
  const state = posed.get(body);
  if (!state) return;
  const { kind } = state,
    hold = moment.hold ?? 1,
    emerged = moment.emerged ?? -1;
  if (emerged >= 0 && emerged < emergeSeconds)
    // Climbing out: the fall run backward, from folded on the ground up to its feet.
    show(state, kind.fall, (1 - emerged / emergeSeconds) * kind.fall.frames * 0.7, 1);
  else if (moment.windup !== null && moment.windup !== undefined) {
    // A telegraphed blow: the weapon rises as the warning runs out and hangs there until it falls.
    const clip = state.attack,
      peak = (clip.markers.contact ?? clip.frames) - 5;
    show(state, clip, Math.min(1, moment.windup * 1.25) * peak, 1);
  } else if (moment.blow >= 0) {
    // The blow's cycle starts on contact: follow through, recover, then gather for the next.
    const clip = state.attack;
    show(state, clip, (clip.markers.contact ?? 0) + moment.blow * clip.frames, hold);
  } else if (moment.walking) {
    state.stride += moment.moved * kind.pace * (state.gait === kind.walk ? 1 : 0.6);
    show(state, state.gait, state.stride, hold);
  }
  // Standing breath is slow: a few poses a second are plenty.
  else show(state, kind.idle, moment.clock * 30 + state.id * 37, (kind.idleHold ?? 3) * hold);
}
/**
 * Poses a slain monster `age` seconds after the kill. False when this body does not fall (a den, or
 * a guardian, which breaks apart instead) or has finished falling.
 */
export function poseFallenMonster(body: SceneNode, age: number): boolean {
  const state = posed.get(body);
  if (!state || state.rank === MonsterRank.Guardian || age >= fallSeconds) return false;
  show(state, state.kind.fall, (age / fallSeconds) * state.kind.fall.frames, 1);
  return true;
}
/** How far this monster's art rises above its feet, for bars and marks drawn over it. */
export function monsterTop(body: SceneNode): number {
  return tops.get(body) ?? 20;
}
