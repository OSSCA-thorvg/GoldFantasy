import { Calling } from './person';
import type { AbilityId } from './combat-events';

/** How a skill finds what it acts on. */
export enum SkillAim {
  /** Acts around the caster at once. */
  Self,
  /** Picks an enemy within range by itself. */
  Enemy,
  /** Picks an ally within range by itself. */
  Ally,
  /** Lands on a ground point: the player's cursor, or the best spot when used on its own. */
  Ground,
}
export interface SkillSpec {
  id: AbilityId;
  name: string;
  description: string;
  calling: Calling;
  /** 0 is the calling's first skill, 1 its second. */
  slot: number;
  /** The level at which a resident of the calling has it. */
  level: number;
  cooldown: number;
  aim: SkillAim;
  /** Tiles from the caster within which it finds or accepts a target; 0 when it acts on the spot. */
  range: number;
  /** Ground radius of the effect in tiles; 0 for a single target. */
  radius: number;
  /** Seconds between the cast and the effect landing. */
  delay: number;
  /** Seconds the effect lasts once it has landed; 0 for an instant. */
  duration: number;
  /** Used on its own when it would help, unless the player turns that off to time it by hand. */
  auto: boolean;
}
/** A resident's second skill comes with experience. */
export const secondSkillLevel = 4;
/** Every skill, the two of each calling together. Ids, slots and aims are fixed; numbers are tuning. */
export const skills: readonly SkillSpec[] = [
  {
    id: 'challenge',
    name: 'Challenge',
    description: 'Nearby monsters turn on the warrior for a while; the warrior takes less damage meanwhile.',
    calling: Calling.Warrior,
    slot: 0,
    level: 1,
    cooldown: 20,
    aim: SkillAim.Self,
    range: 0,
    radius: 4,
    delay: 0,
    duration: 5,
    auto: true,
  },
  {
    id: 'whirl',
    name: 'Whirl',
    description: 'A full turn of the blade: every enemy close around takes a heavy blow.',
    calling: Calling.Warrior,
    slot: 1,
    level: secondSkillLevel,
    cooldown: 10,
    aim: SkillAim.Self,
    range: 0,
    radius: 1.8,
    delay: 0.25,
    duration: 0,
    auto: true,
  },
  {
    id: 'aimed',
    name: 'Aimed Shot',
    description: 'One heavy shot at the nearest enemy in range; breaks a wind-up.',
    calling: Calling.Ranger,
    slot: 0,
    level: 1,
    cooldown: 12,
    aim: SkillAim.Enemy,
    range: 6,
    radius: 0,
    delay: 0,
    duration: 0,
    auto: true,
  },
  {
    id: 'volley',
    name: 'Volley',
    description: 'Arrows rain on a circle in the distance, striking every enemy inside.',
    calling: Calling.Ranger,
    slot: 1,
    level: secondSkillLevel,
    cooldown: 14,
    aim: SkillAim.Ground,
    range: 8,
    radius: 2.2,
    delay: 0.6,
    duration: 0,
    auto: true,
  },
  {
    id: 'burst',
    name: 'Rune Burst',
    description: 'A rune circle lands after a moment, hitting every monster inside for heavy damage.',
    calling: Calling.Mage,
    slot: 0,
    level: 1,
    cooldown: 16,
    aim: SkillAim.Ground,
    range: 8,
    radius: 2,
    delay: 0.8,
    duration: 0,
    auto: true,
  },
  {
    id: 'frost',
    name: 'Frost Ring',
    description: 'A ring of frost in the distance: enemies caught in it move and strike slower for a while.',
    calling: Calling.Mage,
    slot: 1,
    level: secondSkillLevel,
    cooldown: 20,
    aim: SkillAim.Ground,
    range: 8,
    radius: 3,
    delay: 0.4,
    duration: 5,
    auto: true,
  },
  {
    id: 'mend',
    name: 'Mend',
    description: 'Heals the most hurt ally nearby, or gets a downed ally up at once.',
    calling: Calling.Cleric,
    slot: 0,
    level: 1,
    cooldown: 14,
    aim: SkillAim.Ally,
    range: 6,
    radius: 0,
    delay: 0,
    duration: 0,
    auto: true,
  },
  {
    id: 'sanctuary',
    name: 'Sanctuary',
    description: 'Hallows the ground around the cleric for a while: allies inside mend steadily and the downed do not bleed out.',
    calling: Calling.Cleric,
    slot: 1,
    level: secondSkillLevel,
    cooldown: 30,
    aim: SkillAim.Self,
    range: 0,
    radius: 2.5,
    delay: 0,
    duration: 8,
    auto: true,
  },
  {
    id: 'rally',
    name: 'Rallying Verse',
    description: 'Nearby allies strike harder and walk faster for a while.',
    calling: Calling.Bard,
    slot: 0,
    level: 1,
    cooldown: 30,
    aim: SkillAim.Self,
    range: 0,
    radius: 5,
    delay: 0,
    duration: 8,
    auto: true,
  },
  {
    id: 'dirge',
    name: 'Dirge',
    description: 'Nearby enemies lose heart for a while: their blows land softer and they move slower.',
    calling: Calling.Bard,
    slot: 1,
    level: secondSkillLevel,
    cooldown: 24,
    aim: SkillAim.Self,
    range: 0,
    radius: 5,
    delay: 0,
    duration: 6,
    auto: true,
  },
];
/** Strength of each skill; reach, radius, timing and cooldown are in `skills`. Keep the descriptions true. */
export const skillPower = {
  /** Multiples of the resident's ordinary blow. */
  aimed: 3,
  burst: 2.5,
  whirl: 2,
  volley: 1.4,
  mendHealth: 0.35,
  /** Health a Sanctuary gives back each second to the allies inside it. */
  sanctuaryMend: 0.04,
};
export const skillSpec = (id: AbilityId): SkillSpec => skills.find((skill) => skill.id === id)!;
/** The skill a calling keeps in a slot, or null (settlers and travellers have none). */
export const skillOfCalling = (calling: Calling, slot: number): SkillSpec | null =>
  skills.find((skill) => skill.calling === calling && skill.slot === slot) ?? null;

/** How an ordinary blow lands. The weapon in hand decides. */
export enum StrikeKind {
  /** One target. */
  Single,
  /** A sweep that also catches enemies beside the target. */
  Cleave,
  /** A heavy blow on one target that staggers it. */
  Crush,
  /** A shot that flies on through enemies behind the target. */
  Pierce,
  /** A bolt that bursts on its target and catches those around it. */
  Splash,
}
export interface StrikeSpec {
  kind: StrikeKind;
  /** Tiles around the target (Cleave, Splash) or beyond it (Pierce) that the blow also reaches. */
  reach: number;
  /** Share of the damage the other enemies take. */
  share: number;
  /** Most enemies one blow can hurt, the target included. */
  most: number;
  /** Seconds a Crush delays its target's next bite. */
  stagger: number;
}
const single: StrikeSpec = { kind: StrikeKind.Single, reach: 0, share: 0, most: 1, stagger: 0 };
const byShape: Record<string, StrikeSpec> = {
  sword: { kind: StrikeKind.Cleave, reach: 1.2, share: 0.6, most: 3, stagger: 0 },
  mace: { kind: StrikeKind.Crush, reach: 0, share: 0, most: 1, stagger: 0.8 },
  bow: { kind: StrikeKind.Pierce, reach: 2.5, share: 0.6, most: 2, stagger: 0 },
  staff: { kind: StrikeKind.Splash, reach: 0.9, share: 0.5, most: 4, stagger: 0 },
  spear: { kind: StrikeKind.Pierce, reach: 1.2, share: 0.6, most: 2, stagger: 0 },
};
/** The blow a weapon deals, by the shape it is drawn with (an item's `visual`), so every sword cleaves
 * whatever it is made of; tools and bare hands strike one target. */
export const strikeOf = (visual: string | null | undefined): StrikeSpec => (visual && byShape[visual]) || single;
