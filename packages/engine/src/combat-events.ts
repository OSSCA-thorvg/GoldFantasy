import type { Point } from './geometry';

/** Tunable combat numbers shared by the engine, the renderer and the HUD. */
export const combatRules = {
  /** Seconds a downed resident lasts before dying. */
  bleedOut: 45,
  /** Seconds a helper kneels beside a downed resident to get them up. */
  tendSeconds: 3,
  reviveHealth: 0.25,
  /** A revived resident carries a wound: health cannot rise above this while `woundDays` is positive. */
  woundedHealth: 0.6,
  woundDays: 2,
  critChance: 0.1,
  critDamage: 2,
  /** Chance that a resident with a shield turns a blow aside entirely. */
  blockChance: 0.25,
  /** Combat cues stay listed this long for the renderer, HUD and sound to pick up. */
  eventSeconds: 3,
};
/** What happened, for presentation. The engine decides; the renderer, HUD and sound only react. */
export enum CombatCue {
  /** A resident's blow that hit for extra damage. `amount` is the damage, as on `Hit`. */
  Crit,
  /** A blow turned aside by a shield. */
  Block,
  /** Health restored to a resident. `amount` is hundredths of full health. */
  Heal,
  /** A resident fell and is bleeding out. */
  Downed,
  /** A downed resident is back on their feet. */
  Revived,
  /** A resident died. `text` is the cause. */
  Death,
  /** A monster or animal died. `person` is the killer, or -1. */
  Kill,
  /** `amount` is the new level. */
  LevelUp,
  /** A calling ability was used. `text` is its name; `radius` and `duration` describe its area and effect. */
  Ability,
  /** A monster winds up an area blow that lands `duration` seconds later within `radius` tiles of `position`. */
  Telegraph,
  /** The telegraphed blow landed. */
  Slam,
  /** A guardian passed below half health. */
  Enrage,
  /** A monster climbed out of a den. `creature` is the newcomer, `amount` the den's id. */
  Spawn,
  /** A den was destroyed. `creature` is the den, `person` whoever finished it. */
  DenDestroyed,
  /** The last den and guardian of a floor fell and what was left of the brood died with them. `amount` is how many. */
  BroodBreak,
  /** A raid wave is on its way. `amount` is its size; `position` is where it comes from. */
  Wave,
}
export interface CombatEvent {
  serial: bigint;
  cue: CombatCue;
  /** Town clock seconds. */
  at: number;
  position: Point;
  /** Resident concerned, or -1. */
  person: number;
  /** Monster or animal concerned, or -1. */
  creature: number;
  amount: number;
  /** Ground radius in tiles for area cues, else 0. */
  radius: number;
  /** Seconds the cue lasts in the world. */
  duration: number;
  text: string;
  /** The skill an `Ability` cue is for, else ''. */
  skill: AbilityId | '';
}
export enum MonsterRank {
  Grunt,
  /** Slow, tough, hits hard. */
  Brute,
  /** Fast and frail; goes for whoever stands at the back. */
  Stalker,
  /** The floor's guardian. */
  Guardian,
  /** The bulk of a brood: small, quick, dies to a blow or two and comes in numbers. */
  Swarmer,
  /** Frail; spits from a distance and keeps away. */
  Spitter,
  /** A nest that does not move or bite: monsters climb out of it until it is destroyed. */
  Den,
}
/** A resident the settlement has lost. Enough is kept to draw their likeness and tell their deeds. */
export interface Fallen {
  id: number;
  name: string;
  past: string;
  look: number;
  calling: number;
  race: number;
  level: number;
  /** Days lived in the settlement. */
  days: number;
  kills: number;
  cause: string;
  /** Where it happened: a world beyond a gate, or Midgard. */
  place: string;
  day: number;
  /** Town clock seconds of the death. */
  at: number;
  position: Point;
}
/** Deeds counted for quests and unlocks. Only ever grows. */
export class Chronicle {
  raidsRepelled = 0;
  guardiansSlain = 0;
  /** Parties that stepped through a gate, and the size of the largest. */
  partiesLed = 0;
  largestParty = 0;
  /** Downed residents brought back to their feet. */
  rescues = 0;
  weaponsForged = 0;
  monstersSlain = 0;
}
/** The first skill of Warrior, Ranger, Mage, Cleric and Bard, then the second of each. See `skill-catalog.ts`. */
export type AbilityId =
  | 'challenge'
  | 'aimed'
  | 'burst'
  | 'mend'
  | 'rally'
  | 'whirl'
  | 'volley'
  | 'frost'
  | 'sanctuary'
  | 'dirge';
export interface AbilityState {
  id: AbilityId;
  name: string;
  description: string;
  ready: boolean;
  /** Seconds until it can be used again. */
  remaining: number;
  cooldown: number;
  /** Its effect is running right now. */
  active: boolean;
  /** Used on its own whenever it is ready and useful, without the player's key. */
  auto: boolean;
  /** Needs a ground point chosen by the player (otherwise it acts on the spot). */
  targeted: boolean;
  /** 0 for the calling's first skill, 1 for its second. */
  slot: number;
  /** The resident's level is too low for it yet; `level` is the level that grants it. */
  locked: boolean;
  level: number;
}
