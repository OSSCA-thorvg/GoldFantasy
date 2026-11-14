// What every kind of monster provides: one shared set of solved poses, and art dressed per creature.
import type { MonsterRank } from '../../engine/src/combat-events';
import type { RigClip } from './rig-clip';
import type { PoseBank } from './rig-pose-bank';
import type { RigSkin } from './rig-skin';

/** One creature's own art and the blow that suits what it carries. */
export interface MonsterDress {
  skin: RigSkin;
  attack: RigClip;
}
/** A lair's creature. Every one of them shares the bank; only the art differs from one to the next. */
export interface MonsterKind {
  bank: PoseBank;
  /** How far the art rises above the feet at rest, in world pixels. */
  top: number;
  /** Radii of the ground shadow. */
  shadow: readonly [number, number];
  idle: RigClip;
  walk: RigClip;
  /** The gait of a swarm, when it differs from the walk. */
  run?: RigClip;
  /** Struck down: played once from the kill; played backward it is a newcomer climbing out of a den. */
  fall: RigClip;
  /** Walk-cycle frames per tile travelled: short legs take more steps. */
  pace: number;
  /** Frames a standing pose is held (default 3). Slow breathing needs few poses; beating wings need every one. */
  idleHold?: number;
  dress(id: number, rank: MonsterRank): MonsterDress;
}
/** A stable 0..1 number per creature, so a pack is not a row of twins. */
export function monsterTrait(id: number, salt: number): number {
  let h = Math.imul((id | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
