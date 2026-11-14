import { MonsterRank } from './combat-events';
import type { Monster, Person } from './person';
import type { TownState } from './town-state';
import { distance } from './geometry';
import { f32 as f } from './numeric';
import { armorProtection, combatItem } from './equipment';
const shotWeapon = (p: Person): boolean => combatItem(p)?.visual === 'bow' || combatItem(p)?.visual === 'staff';

export const rankRules = {
  bruteHealth: 1.8,
  bruteStrength: 1.5,
  brutePace: 0.75,
  stalkerHealth: 0.6,
  stalkerPace: 1.4,
  /** A swarmer falls to a blow or two and bites often, but softly. */
  swarmerHealth: 0.17,
  swarmerStrength: 1.4,
  swarmerPace: 1.3,
  swarmerPause: 0.6,
  spitterHealth: 0.3,
  spitterStrength: 0.7,
  spitterPace: 0.9,
  spitterPause: 1.8,
  /** Tiles a spitter spits from, and how close it lets a resident come before backing off. */
  spitReach: 4.5,
  spitShy: 2.4,
  /** Farthest a spitter backs off from its home. */
  spitRoam: 4,
  /** Monsters beyond a gate have a hide that turns aside this much of every blow: weapons and levels tell, bare
   * hands barely scratch them. A blow always keeps a fifth of its force. */
  hide: 0.9,
  denHealth: 4,
  /** Seconds between swarmers of a roused den, the first sooner; slower while it was struck in the last `denStruck`
   * seconds. Its brood alive at once is at most `denBrood`, shrinking with the den's wounds. */
  denPause: 4,
  denPauseStruck: 8,
  denStruck: 2,
  denFirst: 1.5,
  denBrood: 6,
  /** Guardian slam: seconds between wind-ups while fighting, the first one sooner. */
  slamPause: 9,
  slamFirst: 5,
  /** Seconds before the next wind-up after an Aimed Shot breaks one. */
  slamBroken: 6,
  slamWindup: 2.2,
  slamRadius: 2.2,
  /** The slam hits as hard as this many of the guardian's bites; armour only softens half as much. */
  slamPower: 15,
};
/** What a kill of each rank is worth in experience, bounty and spoils, against a grunt. */
const worth: Record<MonsterRank, number> = {
  [MonsterRank.Grunt]: 1,
  [MonsterRank.Brute]: 1.6,
  [MonsterRank.Stalker]: 0.8,
  [MonsterRank.Guardian]: 1,
  [MonsterRank.Swarmer]: 0.17,
  [MonsterRank.Spitter]: 0.35,
  [MonsterRank.Den]: 2.5,
};
export const rankWorth = (beast: Monster): number => worth[beast.rank] ?? 1;

/** Sets a new monster's rank and full health; `scale` applies the rank's health and strength. */
export function rankMonster(beast: Monster, rank: MonsterRank, scale = true): Monster {
  beast.rank = rank;
  if (scale) {
    const [health, strength] =
      rank === MonsterRank.Brute
        ? [rankRules.bruteHealth, rankRules.bruteStrength]
        : rank === MonsterRank.Stalker
          ? [rankRules.stalkerHealth, 1]
          : rank === MonsterRank.Swarmer
            ? [rankRules.swarmerHealth, rankRules.swarmerStrength]
            : rank === MonsterRank.Spitter
              ? [rankRules.spitterHealth, rankRules.spitterStrength]
              : rank === MonsterRank.Den
                ? [rankRules.denHealth, 1]
                : [1, 1];
    beast.health = f(beast.health * health);
    beast.strength = f(beast.strength * strength);
  }
  beast.vigor = beast.health;
  return beast;
}
export const rankPace = (beast: Monster): number =>
  beast.rank === MonsterRank.Brute
    ? rankRules.brutePace
    : beast.rank === MonsterRank.Stalker
      ? rankRules.stalkerPace
      : beast.rank === MonsterRank.Swarmer
        ? rankRules.swarmerPace
        : beast.rank === MonsterRank.Spitter
          ? rankRules.spitterPace
          : beast.rank === MonsterRank.Den
            ? 0
            : 1;
/** Share of the breed's pause between two bites. */
export const rankPause = (beast: Monster): number =>
  beast.rank === MonsterRank.Swarmer
    ? rankRules.swarmerPause
    : beast.rank === MonsterRank.Spitter
      ? rankRules.spitterPause
      : 1;

/** Picks whom a monster goes for among residents in reach; a stalker weighs exposure against distance. */
export function choosePrey(beast: Monster, candidates: readonly Person[]): Person | null {
  let best: Person | null = null,
    bestScore = Infinity;
  for (const p of candidates) {
    let score = distance(p.position, beast.position);
    if (beast.rank === MonsterRank.Stalker) {
      let alone = 4;
      for (const other of candidates)
        if (other !== p) alone = Math.min(alone, distance(other.position, p.position));
      score -= alone + (shotWeapon(p) || armorProtection(p) <= 0 ? 3 : 0);
    }
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}
/** The warrior whose Challenge holds this monster, while it lasts and they stand within reach. */
export function tauntedBy(town: TownState, beast: Monster, reach: number): Person | null {
  const taunt = town.combatState.taunts.get(beast.id);
  if (!taunt || taunt.until <= town.time) return null;
  const warrior = town.person(taunt.by);
  return warrior &&
    warrior.health > 0 &&
    warrior.downedAt < 0 &&
    !warrior.inside &&
    distance(warrior.position, beast.position) <= reach
    ? warrior
    : null;
}
/** A Frost Ring halves a monster's pace and bites; a Dirge slows it a fifth. */
export function slowedBy(town: TownState, beast: Monster): number {
  const state = town.combatState;
  return (
    ((state.chilled.get(beast.id) ?? -1) > town.time ? skillEffects.frostSlow : 1) *
    ((state.dirged.get(beast.id) ?? -1) > town.time ? skillEffects.dirgeSlow : 1)
  );
}
/** Numbers of the skills that act on monsters over time, kept true to the catalog's descriptions. */
export const skillEffects = {
  frostSlow: 0.5,
  dirgeSlow: 0.8,
  dirgeBite: 0.7,
};
