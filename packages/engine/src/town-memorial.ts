import type { TownState } from './town-state';
import type { Fallen } from './combat-events';
import { Structure } from './building-catalog';
import { runestoneComfort } from './progression-rules';

/** True while a finished runestone of the player's stands anywhere in Midgard. */
export function runestoneStands(this: TownState): boolean {
  return this.placed.some(
    (b) => b.kind === Structure.Runestone && b.built() && b.health > 0 && b.faction === this.controlFaction,
  );
}
/** How hard a death weighs on the survivors: 1 with no memorial, less once the fallen are remembered. */
export function memorialComfort(this: TownState): number {
  return runestoneStands.call(this) ? runestoneComfort : 1;
}
/** The fallen a runestone names, oldest first; empty while no runestone stands. */
export function rememberedFallen(this: TownState): readonly Fallen[] {
  return runestoneStands.call(this) ? this.fallen : [];
}
