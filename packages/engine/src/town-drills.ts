import type { TownState } from './town-state';
import type { Person } from './person';
import { Structure } from './building-catalog';
import { f32 as f, lround } from './numeric';
import { drillRules } from './progression-rules';

interface DrillTown extends TownState {
  rewardExperience(p: Person, points: number): void;
}
/** Daily training of residents who drill instead of working. Called once from newDay. */
export function runDrills(this: DrillTown): void {
  const town = this;
  for (const yard of town.placed) {
    if (yard.kind !== Structure.TrainingYard || !yard.built() || yard.faction !== town.controlFaction) continue;
    // Attendance is the share of yesterday's shift actually spent at the yard.
    const points = lround(f(drillRules.experience * yard.attendance));
    for (const p of town.folk) {
      if (p.job !== yard.id || p.health <= 0 || p.faction !== yard.faction) continue;
      p.stress = Math.max(0, f(p.stress - drillRules.stressRelief * yard.attendance));
      if (points > 0 && p.level < drillRules.levelCap) town.rewardExperience(p, points);
    }
  }
}
