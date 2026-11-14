import type { Point } from './geometry';
import type { AbilityId } from './combat-events';

/** A skill whose effect lands a moment after the cast. */
export interface PendingSkill {
  by: number;
  skill: AbilityId;
  at: Point;
  lands: number;
  damage: number;
  radius: number;
}
/** Hallowed ground laid by a cleric's Sanctuary. */
export interface HallowedGround {
  by: number;
  at: Point;
  radius: number;
  until: number;
}
/** Walking distance to one resident's tile from every tile of the world beyond a gate. */
export interface FlowField {
  cell: number;
  at: number;
  distance: Float64Array;
}
/** Short-lived fight bookkeeping; never saved, safely empty after a load. */
export class CombatState {
  /** What struck each downed resident down, for their record. */
  downedBy = new Map<number, string>();
  /** Resident who dealt a creature its killing blow, until the kill is counted. */
  slayers = new Map<number, number>();
  /** Monsters drawn to a warrior's Challenge. */
  taunts = new Map<number, { by: number; until: number }>();
  /** Residents under a Rallying Verse, until this clock time. */
  rallied = new Map<number, number>();
  /** Rune Bursts, Whirls, Volleys and Frost Rings waiting to land. */
  bursts: PendingSkill[] = [];
  /** Monsters slowed by a Frost Ring, and those disheartened by a Dirge, until these clock times. */
  chilled = new Map<number, number>();
  dirged = new Map<number, number>();
  sanctuaries: HallowedGround[] = [];
  /** Clock time each guardian may next wind up its slam. */
  slamAt = new Map<number, number>();
  /** Where each winding-up guardian's slam will land. */
  slamCenter = new Map<number, Point>();
  /** Routes to each resident beyond a gate, shared by every monster hunting them. */
  flows = new Map<number, FlowField>();
  /** Clock time each hunting monster next looks for its way again, and whether it saw its prey in the open. */
  steering = new Map<number, { at: number; direct: boolean }>();
  /** Clock time each den was last struck. */
  struckAt = new Map<number, number>();
  /** Share of a hoard the kills on this floor have earned but not yet paid out. */
  spoils = 0;
  /** Where the floor fell, for the brood break. */
  breakAt: Point | null = null;
  /** Clock time the gate ends an expedition whose whole party is down or dead; -1 while someone stands. */
  lostAt = -1;
  /** Clock time each resident on auto may next weigh their skills. */
  skillCheckAt = new Map<number, number>();
  /** Day the wound countdown last ran for. */
  woundDay = -1;
}
