import type { Town } from './town';
import type { Building } from './town-models';
import { Activity, type Person } from './person';
import { Resources, structureSpec, type Structure } from './building-catalog';

export const repairBatchHealth = 0.25;

/** Each prepaid repair batch restores at most one quarter of a building's health. */
export function repairMaterialCost(kind: Structure): Resources {
  const original = structureSpec(kind).cost;
  const cost = new Resources();
  for (const key of ['wood', 'stone', 'planks', 'cutStone'] as const)
    cost[key] = Math.ceil(original[key] * 0.1);
  // Upgraded structures with no separate build price still need physical timber.
  if (cost.empty()) cost.wood = 1;
  return cost;
}

/** Reserve one shared maintenance batch, then use the normal gather/delivery chain. */
export function prepareBuildingRepair(town: Town, person: Person, building: Building): boolean {
  if (!building.built() || building.health >= 1 || building.repairCredit > 0) return false;
  if (!building.repairPending) {
    building.materials.required.add(repairMaterialCost(building.kind));
    building.repairPending = true;
  }
  if (town.prepareConstruction(person, Activity.Building, building.id)) return true;
  if (building.materials.limit() < 1) return true;
  building.repairPending = false;
  building.repairCredit = repairBatchHealth;
  return false;
}

export function restoreBuildingHealth(building: Building, amount: number): void {
  const restored = Math.max(0, Math.min(1 - building.health, building.repairCredit, amount));
  building.health += restored;
  building.repairCredit = Math.max(0, building.repairCredit - restored);
  // Do not buy an extra material batch for floating-point residue at a boundary.
  if (1 - building.health < 1e-7) building.health = 1;
  if (building.repairCredit < 1e-7) building.repairCredit = 0;
}
