import type { TownState } from './town-state';
import { World } from './world-types';
import { gateSealed, sealable } from './gate-seals';

/** Sealing a gate leaves the settlement a lasting gift of that world. Derived from the seals, never saved. */
export enum Boon {
  /** Asgard: residents strike harder. */
  Valor,
  /** Vanaheim: fields and hunts feed more. */
  Plenty,
  /** Alfheim: experience comes faster. */
  Lore,
  /** Jotunheim: buildings shrug off blows and seats and towers shoot harder. */
  Bulwark,
  /** Svartalfheim: crafting takes half the time. */
  Forge,
  /** Niflheim: winter no longer thins the game nor bites the unsheltered. */
  Hearth,
  /** Muspelheim: critical blows come more often. */
  Ember,
  /** Helheim: the downed hold on longer and rise stronger. */
  Barrow,
}
export const boonOfWorld = (world: World): Boon =>
  [Boon.Valor, Boon.Plenty, Boon.Lore, Boon.Bulwark, Boon.Forge, Boon.Hearth, Boon.Ember, Boon.Barrow][world] ??
  Boon.Valor;
export const boonRules = {
  valorAttack: 1.1,
  plentyFood: 1.25,
  loreExperience: 1.25,
  bulwarkBuildingDamage: 0.5,
  bulwarkVolley: 1.5,
  forgeSeconds: 0.5,
  emberCrit: 0.1,
  barrowBleedOut: 1.5,
  barrowReviveHealth: 0.5,
};
export const boonName = (boon: Boon): string =>
  ['Valor', 'Plenty', 'Lore', 'Bulwark', 'Forge', 'Hearth', 'Ember', 'Barrow'][boon] ?? '';
export const boonText = (boon: Boon): string =>
  [
    'Residents strike harder.',
    'Fields and hunts yield more food.',
    'Residents gain experience faster.',
    'Buildings take less damage; seats and towers shoot harder.',
    'Crafting goes faster.',
    'Winter no longer thins the game or chills the unsheltered.',
    'Critical blows come more often.',
    'The downed hold on longer and rise stronger.',
  ][boon] ?? '';
/** True once any gate leading to the world of this boon is sealed. */
export function boon(town: TownState, which: Boon): boolean {
  return town.world
    .dungeons()
    .some(
      (site, index) =>
        sealable(site) && gateSealed(town, index) && boonOfWorld(town.world.destination(site)) === which,
    );
}
export function boonsHeld(town: TownState): Boon[] {
  const held: Boon[] = [];
  for (let which = Boon.Valor; which <= Boon.Barrow; ++which) if (boon(town, which)) held.push(which);
  return held;
}
