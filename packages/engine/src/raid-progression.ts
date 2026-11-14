import { Structure, isSeat } from './building-catalog';
import type { Building } from './town-models';
import type { Point } from './geometry';
import { distance } from './geometry';
import { TownState } from './town-state';
import { hash01 } from './numeric';

export function campTier(kind: Structure): number {
  return kind === Structure.Castle ? 3 : kind === Structure.Keep ? 2 : kind === Structure.Palisade ? 1 : 0;
}

/** Raiders stop growing after this many weeks, so a late town can still win a night. */
export const threatWeeks = 12;
export const raidHealth = (week: number): number => 1 + Math.min(threatWeeks, week) * 0.18;
/** Threat changes only on seven-day boundaries. A fortified seat never makes raids worse. */
export function dungeonThreat(days: number, origin: Point, buildings: readonly Building[]) {
  const nearest = buildings
    .filter((b) => isSeat(b.kind) && b.built() && distance(b.center, origin) <= TownState.campReach * 2)
    .sort((a, b) => distance(a.center, origin) - distance(b.center, origin))[0];
  const week = Math.max(0, Math.floor(days / 7)),
    tier = nearest ? campTier(nearest.kind) : 0;
  return {
    week,
    tier,
    count: Math.min(12, 2 + week),
    health: raidHealth(week),
    damage: 1 + Math.min(threatWeeks, week) * 0.08,
  };
}

export enum RaidKind {
  Pack,
  Horde,
  Brutes,
  Pincer,
}
export const raidGraceDays = 2;
const rawDue = (seed: number, day: number, winter: boolean): boolean =>
  day >= raidGraceDays && hash01(seed, day, 7, 301) < (winter ? 0.7 : 0.45);
/** Raids skip nights, but never leave more than two quiet nights in a row. */
export function raidDue(seed: number, day: number, winter = false): boolean {
  if (day < raidGraceDays) return false;
  return rawDue(seed, day, winter) || (!rawDue(seed, day - 1, winter) && !rawDue(seed, day - 2, winter));
}
export function raidKind(seed: number, day: number): RaidKind {
  // The first raids are plain packs so the shapes are learned one at a time.
  if (day < 6) return RaidKind.Pack;
  const pick = hash01(seed, day, 11, 302);
  return pick < 0.4 ? RaidKind.Pack : pick < 0.62 ? RaidKind.Horde : pick < 0.82 ? RaidKind.Brutes : RaidKind.Pincer;
}
/** How a raid answers what the settlement has. */
export const raidMuster = {
  /** Might of each resident at home: their blow times their vitality, so arms and levels count. */
  perBlow: 1,
  /** Might of each manned watchtower and of each tier of a fortified seat. */
  perTower: 2,
  perTier: 2.5,
  /** Might the dungeons add each week on their own. */
  perWeek: 3,
  /** Swarmers per point of might; a leader for every `leaderMight`, an extra brute for every `bruteMight`. */
  swarm: 1,
  leastSwarm: 3,
  leaderMight: 6,
  bruteMight: 14,
  /** A raiding swarmer bites this much softer than one beyond a gate, where the brood is at home. */
  swarmBite: 0.4,
};
/** A raid is a wave sized to the settlement's `might`: `count` leaders (grunts, or brutes for a brute raid) with
 * the shape's `health` and `damage`, a few extra `brutes`, and a `swarm` of swarmers. The first raids on a young
 * camp are probes: a few swarmers and no leader. */
export function raidShape(kind: RaidKind, might: number) {
  const swarm = Math.max(raidMuster.leastSwarm, Math.round(raidMuster.swarm * might)),
    leaders = Math.floor(might / raidMuster.leaderMight);
  if (kind === RaidKind.Horde)
    return { count: Math.floor(leaders / 2), health: 0.8, damage: 0.9, brutes: 0, swarm: Math.round(swarm * 1.6) };
  if (kind === RaidKind.Brutes)
    return { count: Math.max(1, Math.ceil(leaders / 2)), health: 1.8, damage: 1.25, brutes: 0, swarm: Math.round(swarm / 2) };
  return { count: leaders, health: 1, damage: 1, brutes: Math.floor(might / raidMuster.bruteMight), swarm };
}
export const raidWarning = (kind: RaidKind, gate: string): string =>
  kind === RaidKind.Horde
    ? `Many small tracks circle ${gate}: a horde will come tonight`
    : kind === RaidKind.Brutes
      ? `Heavy tracks lead from ${gate}: a few great brutes will come tonight`
      : kind === RaidKind.Pincer
        ? `Two gates stir at once: raiders will come from both sides tonight`
        : `Fresh tracks lead from ${gate}: a raid will come tonight`;
/** A fortified seat shoots at raiders; a bare camp cannot. */
export const seatVolley = { reach: 8, pause: 1.5, damagePerTier: 1.5 };
/** Told once a week while any discovered gate is still open. */
export const pressureNotice = (week: number): string =>
  week > threatWeeks
    ? ''
    : week === threatWeeks
      ? `Week ${week}: raiders are at their full strength. Only sealing the gates ends the raids.`
      : `Week ${week}: raiders now have ${Math.round(raidHealth(week) * 100)}% health. Seal a gate to end its raids.`;
