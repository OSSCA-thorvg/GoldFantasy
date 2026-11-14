// What the player's command of a few residents remembers between frames: groups, aiming, the card's calling,
// and the swarm moments the HUD is still showing.
import type { Point } from '../../../../packages/engine/src/geometry';
import type { Calling } from '../../../../packages/engine/src/person';

/** A skill waiting for its ground point: a held Q/W, or a skill button pressed with the mouse or a finger. */
export interface SkillAim {
  slot: number;
  /** Who casts: the whole selection for a key, one calling's holders for a button. */
  ids: number[];
  /** 'key' fires when the key is released; 'pointer' fires on the next click or tap on the ground. */
  via: 'key' | 'pointer';
}
export interface SwarmBanner {
  title: string;
  detail: string;
  /** UI seconds it shows until. */
  until: number;
}
export interface WaveWarning {
  size: number;
  from: Point;
  /** Town clock the wave was announced. */
  at: number;
}
export class ArmyState {
  town: object | null = null;
  /** Control groups by digit 1..9: resident ids in the order they were added. */
  groups = new Map<number, number[]>();
  lastRecall = { digit: -1, at: -1 };
  aim: SkillAim | null = null;
  /** The calling whose two skills the card shows when the selection is mixed; -1 for the first. */
  focus: Calling | -1 = -1;
  lastPick = { id: -1, at: -1 };
  /** Most dens seen alive on the current floor, so the counter can say "1 of 3". */
  densSeen = 0;
  realmRevision = -1;
  banners: SwarmBanner[] = [];
  wave: WaveWarning | null = null;
}
