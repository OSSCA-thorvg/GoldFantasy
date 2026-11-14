import { Faith, Product } from './building-catalog';
import { distance, point, type Point } from './geometry';
import { clamp, f32 } from './numeric';
import type { Appearance } from './person-appearance';
import { backpackSize, emptyEquipment, type ItemStack } from './equipment';
import { MonsterRank, type AbilityId } from './combat-events';
import type { StrikeKind } from './skill-catalog';
export enum Role { Resident, Guest }
export enum Calling { Settler, Traveller, Warrior, Ranger, Mage, Cleric, Bard }
export enum Race { Human, God, Giant }
export enum Activity { Idle, Moving, Holding, Building, Roadwork, Working, Eating, Sleeping, Relaxing, Exploring, Brooding, Arriving, Leaving, Guarding, Fighting, Expedition, Praying, Shopping, Hauling, Felling, Collecting, Mining, Treating, FetchingMaterials, DeliveringMaterials, WaitingMaterials, Drinking, Training, Crafting, /** Struck down and bleeding out; lies still until tended or dead. */ Downed, /** Kneeling by a downed resident (`target` is their id). */ Tending }
export enum AnimalKind { Cow, Pig, Chicken, Wolf, Dog, Cat, Count }
export const callingName = (calling: Calling): string => ['Settler', 'Traveller', 'Warrior', 'Ranger', 'Mage', 'Cleric', 'Bard'][calling] || '';
export const raceName = (race: Race): string => ['Human', 'God', 'Giant'][race] || '';
export const activityName = (activity: Activity): string => ['Idle', 'Moving on orders', 'Holding position', 'Building', 'Working on a road', 'Working', 'Eating', 'Sleeping', 'Relaxing at the tavern', 'Delving the dungeon', 'Brooding', 'Arriving', 'Leaving', 'On watch', 'Fighting', 'On an expedition', 'Praying', 'Buying gear', 'Carrying goods', 'Felling a tree', 'Collecting resources', 'Mining stone', 'Receiving treatment', 'Fetching supplies', 'Delivering materials', 'Waiting for materials', 'Drinking water', 'Training at the guild', 'Crafting equipment', 'Downed', 'Tending the fallen'][activity] || '';
export class Monster {
  health = 3; strength = 1; raider = false; angry = false; ready = 0; home = point(); prey = -1; race: Race | null = null; insideLair = false; provokedBy = -1; animal: AnimalKind | null = null;
  /** What kind of fighter this is; decides its size and manner. */
  rank = MonsterRank.Grunt;
  /** Full health, for health bars; 0 when unknown (older saves). */
  vigor = 0;
  /** Clock time a telegraphed area blow lands, or -1. */
  windupUntil = -1;
  /** Clock time of its last bite or spit, for presentation; not saved. */
  swingAt = -1;
  /** Clock time it climbed out of a den, or -1; not saved. */
  bornAt = -1;
  /** Id of the den it came from or belongs to, or -1. */
  brood = -1;
  constructor(public id: number, public lair: number, public position: Point, public path: Point[] = []) {}
  giant(): boolean { return this.race === Race.Giant; }
}
export interface Hit { serial: bigint; from: Point; to: Point; damage: number; onPerson: boolean; ranged: boolean; at: number; person: number; attacker?: number; /** A blow for extra damage. */ crit?: boolean; /** Turned aside by a shield; `damage` is 0. */ blocked?: boolean; /** How the blow landed; absent means `StrikeKind.Single`. */ strike?: StrikeKind; /** False for the enemies a cleave, pierce or splash caught besides its target; absent means true. */ primary?: boolean; }
export interface Expedition { dungeon: number; members: number[]; /** Floor of the world beyond the gate the party will enter. */ floor: number; }
export class Person {
  static readonly maximumLevel = 30;
  inventory: (ItemStack | null)[] = Array.from({ length: backpackSize }, () => null);
  equipment = emptyEquipment();
  craftItem: string | null = null;
  craftWorkshop = -1;
  craftProgress = 0;
  faction = 0;
  stressRecovery = false;
  lastBreakdownAt = -1;
  trained = false;
  trainingCalling = -1;
  // Temporary rest can span a meal or combat without replacing the assigned work.
  /** Resident this one is walking to for a hand-to-hand delivery; not saved. */
  giver = -1;
  recoveringRest = false;
  recoveringHealth = false;
  /** Clock time this resident was struck down, or -1 while standing. */
  downedAt = -1;
  /** Monsters and animals this resident has killed. */
  kills = 0;
  /** Clock time the calling ability is ready again, and until when its effect lasts. */
  abilityReadyAt = 0;
  abilityUntil = 0;
  /** Auto-use of the ability: -1 follows the calling's default, 0 off, 1 on. */
  abilityAuto = -1;
  /** The same for the calling's second skill. */
  abilityReadyAt2 = 0;
  abilityUntil2 = 0;
  abilityAuto2 = -1;
  /** Skill being cast and its timing, for presentation; not saved. */
  cast: AbilityId | '' = '';
  castAt = -1;
  castUntil = -1;
  /** A bard's lyre phrase (index into the bank, -1 before the first), when it began and ends; not saved. */
  phrase = -1;
  phraseAt = -1;
  playingUntil = -1;
  /** Clock time a bard may begin the next phrase, or -1 while none is planned; not saved. */
  phraseDue = -1;
  /** Clock time of the last ordinary blow, for presentation; not saved. */
  swingAt = -1;
  /** Serial of the clearing job this resident is on, or -1; not saved. Any other order clears it. */
  clearing = -1;
  /** Hold position: stand, strike whatever comes into reach, never chase. Any other order clears it. */
  holding = false;
  /** Days of a lasting wound left; while positive, health stays at or below combatRules.woundedHealth. */
  woundDays = 0;
  hydration = 1;
  hunting = false;
  attackPerson = -1;
  workField = -1;
  activity = Activity.Idle; target = -1; until = 0; inside = false; ordered = false; task = Activity.Idle; taskSite = -1;
  food = f32(.8); rest = f32(.9); stress = f32(.15); health = 1; home = -1; job = -1; bed = -1; autoMode = true;
  ready = 0; foe = -1; tree = -1; carrying = 0; carriedProduct = Product.Wood; aggressive = false; approachingOrder = false; goal = point(); days = 0; loot = 0;
  relaxedAt = -1e9; prayedAt = -1e9; load = 0; breaking = 0; gear = 0; level = 1; experience = 0; purse = 0; worked = 0; unpaid = false; sleptOutside = false;
  customLook: Appearance | null = null; lookRevision = 0n; entrance = point(); threshold = point(); doorway = 0; faith = Faith.Dawn; past = ''; village = -1; supplyTarget = -1; supplyRoad = false; scheduleAt = 0;
  constructor(public id: number, public name: string, public role: Role, public calling: Calling, public race: Race, public look: number, public position: Point, public path: Point[] = []) {}
  /** Each level asks more than the last, and the gap itself widens: a floor's worth of fighting is a level or two, not five. */
  experienceToNextLevel(): number { const n = this.level - 1; return this.level >= Person.maximumLevel ? 0 : 40 + 30 * n + 3 * n * n; }
  /** Levels and a fighting calling are what turn a long brawl into a quick kill. */
  /** Growth a level brings to blows and to the health a blow takes away; strong enough that a level is felt. */
  static attackPerLevel = 0.15;
  static vitalityPerLevel = 0.2;
  attackMultiplier(): number { return f32((1 + f32(Person.attackPerLevel) * (this.level - 1)) * (this.calling === Calling.Warrior ? f32(1.3) : this.calling === Calling.Ranger || this.calling === Calling.Mage ? f32(1.15) : 1)); }
  vitalityMultiplier(): number { return f32(1 + f32(f32(Person.vitalityPerLevel) * (this.level - 1))); }
  gainExperience(points: number): number {
    if (points <= 0 || this.health <= 0 || this.level >= Person.maximumLevel) return 0;
    let gained = 0, remaining = this.experience + points;
    while (this.level < Person.maximumLevel && remaining >= this.experienceToNextLevel()) { remaining -= this.experienceToNextLevel(); this.level++; gained++; this.health = Math.min(1, f32(this.health + f32(.2))); }
    this.experience = this.level === Person.maximumLevel ? 0 : remaining; return gained;
  }
  moving(): boolean { return this.path.length > 0; }
  crossingDoorway(): boolean { return this.inside ? this.doorway < 1 : this.doorway > 0; }
  visibility(): number { const gap = distance(this.entrance, this.threshold); let visible = clamp(f32(f32(f32(1 - this.doorway) * gap) / Math.max(f32(.001), Math.min(f32(.35), gap))), 0, 1); if (gap < f32(.001)) visible = f32(1 - this.doorway); return f32(f32(visible * visible) * f32(3 - f32(2 * visible))); }
}
export const adventurer = (p: Person): boolean => p.calling === Calling.Warrior || p.calling === Calling.Ranger || p.calling === Calling.Mage || p.calling === Calling.Cleric;
export interface AnimalCall { serial: bigint; kind: AnimalKind; position: Point; at: number; }
export enum TreeWorkKind { Chop, Fall, Mine, Shatter, Regrow, Produced, Hammer }
export interface TreeWorkEvent { serial: bigint; kind: TreeWorkKind; person: number; cell: number; index: number; worker: Point; at: number; }
