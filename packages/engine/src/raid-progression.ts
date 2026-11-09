import { Structure, isSeat } from './building-catalog';
import type { Building } from './town-models';
import type { Point } from './geometry';
import { distance } from './geometry';
import { TownState } from './town-state';

export function campTier(kind: Structure): number {
  return kind === Structure.Castle ? 3 : kind === Structure.Keep ? 2 : kind === Structure.Palisade ? 1 : 0;
}

/** Threat changes only on seven-day boundaries; the nearest completed seat sets its tier. */
export function dungeonThreat(days: number, origin: Point, buildings: readonly Building[]) {
  const nearest = buildings
    .filter((b) => isSeat(b.kind) && b.built() && distance(b.center, origin) <= TownState.campReach * 2)
    .sort((a, b) => distance(a.center, origin) - distance(b.center, origin))[0];
  const week = Math.max(0, Math.floor(days / 7)),
    tier = nearest ? campTier(nearest.kind) : 0;
  return {
    week,
    tier,
    count: Math.min(12, 2 + week + tier * 2),
    health: 1 + week * 0.18 + tier * 0.35,
    damage: 1 + week * 0.08 + tier * 0.15,
  };
}
