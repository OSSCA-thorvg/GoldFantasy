import type { TownState } from './town-state';
import { Role } from './person';
import { DungeonKind, type Dungeon } from './world-types';

/** Floors a party must clear, one delve each, before a gate closes for good. */
export const sealFloors = 3;
export enum Saga {
  Playing,
  Victory,
  Defeat,
}
export const sealable = (site: Dungeon): boolean =>
  site.kind !== DungeonKind.GiantHall && site.kind !== DungeonKind.Return;
export function gateSealed(town: TownState, dungeon: number): boolean {
  const site = town.world.dungeons()[dungeon];
  return !!site && sealable(site) && (town.depth[dungeon] ?? 0) >= sealFloors;
}
export function sealProgress(town: TownState): { sealed: number; total: number } {
  let sealed = 0,
    total = 0;
  town.world.dungeons().forEach((site, index) => {
    if (!sealable(site)) return;
    ++total;
    if (gateSealed(town, index)) ++sealed;
  });
  return { sealed, total };
}
export function sagaState(town: TownState): Saga {
  const alive = town.folk.some(
    // A downed resident can still be saved, so the settlement is not lost yet.
    (p) => p.role === Role.Resident && p.faction === town.controlFaction && (p.health > 0 || p.downedAt >= 0),
  );
  // A birth already promised at an altar can still restart the settlement.
  const promised = town.placed.some((b) => b.faction === town.controlFaction && b.devotionDueDay >= 0);
  if (!alive && !promised) return Saga.Defeat;
  const { sealed, total } = sealProgress(town);
  return total > 0 && sealed === total ? Saga.Victory : Saga.Playing;
}
