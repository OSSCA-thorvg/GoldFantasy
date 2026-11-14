// One frame of combat presentation, in drawing order: ground marks and fields, bars, contact effects, text.
import type { Town } from '../../engine/src/town';
import { updateCombatEffects } from './combat-effects';
import { combatLayers } from './combat-paint';
import { updateCombatText } from './combat-text';
import { updateGroundTelegraphs } from './ground-telegraphs';
import { updateSkillFields } from './skill-fields';
import { updateUnitBars } from './unit-bars';
import type { WorldRendererState } from './world-renderer-state';

export { worldShake } from './combat-effects';

export function updateCombatPresentation(
  s: WorldRendererState,
  town: Town,
  selected: readonly number[],
): void {
  combatLayers(s);
  updateGroundTelegraphs(s, town);
  updateSkillFields(s, town);
  updateUnitBars(s, town, selected);
  updateCombatEffects(s, town);
  updateCombatText(s, town);
}
