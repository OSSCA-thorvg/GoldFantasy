// Native settlement_progression.cpp. Guidance/UI rules are intentionally separate from Town::place.
import type { Town } from './town';
import { Structure, structureSpec } from './building-catalog';
import { Tool, toolStructure } from './game-tools';
import rows from '../data/settlement-goals.json';
import { belongsToFaction } from './faction';
export interface Unlock {
  available: boolean;
  reason: string;
}
export enum GoalKind {
  Building,
  Road,
  Field,
  Population,
}
export interface SettlementGoal {
  title: string;
  description: string;
  kind: GoalKind;
  building: Structure;
  residents: number;
}
const goals: SettlementGoal[] = rows.map((row) => ({
  ...row,
  kind: GoalKind[row.kind as keyof typeof GoalKind],
  building: Structure[row.building as keyof typeof Structure],
}));
export function completedFacility(town: Town, kind: Structure): boolean {
  for (const b of town.buildings())
    if (b.built() && belongsToFaction(b, town.controlFaction))
      for (let stage = kind; stage !== Structure.Count; stage = structureSpec(stage).next)
        if (b.kind === stage) return true;
  return false;
}
export function buildingUnlock(town: Town, kind: Structure): Unlock {
  let first = Structure.Camp,
    second = Structure.Count,
    population = 0,
    road = false;
  switch (kind) {
    case Structure.Sawmill:
    case Structure.WoodStore:
      first = Structure.Lumberyard;
      break;
    case Structure.Stoneworks:
    case Structure.StoneStore:
      first = Structure.Quarry;
      break;
    case Structure.Granary:
      first = Structure.Farm;
      break;
    case Structure.Camp:
      return { available: true, reason: '' };
    case Structure.Torch:
    case Structure.Lumberyard:
      road = true;
      break;
    case Structure.Farm:
      first = Structure.Lumberyard;
      break;
    case Structure.Well:
      first = Structure.Farm;
      break;
    case Structure.Tent:
    case Structure.Quarry:
      first = Structure.Well;
      break;
    case Structure.Hostel:
      first = Structure.Tent;
      break;
    case Structure.Storehouse:
      first = Structure.Quarry;
      population = 4;
      break;
    case Structure.Tavern:
      first = Structure.Hostel;
      population = 4;
      break;
    case Structure.MarketStalls:
      first = Structure.Hostel;
      population = 6;
      break;
    case Structure.Guild:
      first = Structure.Hostel;
      second = Structure.Quarry;
      population = 6;
      break;
    case Structure.Weaponsmith:
      first = Structure.Guild;
      population = 10;
      break;
    case Structure.Armorer:
      first = Structure.Weaponsmith;
      population = 12;
      break;
    case Structure.MageTower:
      first = Structure.Guild;
      population = 16;
      break;
    case Structure.Apothecary:
      first = Structure.MageTower;
      population = 18;
      break;
    case Structure.Shrine:
      first = Structure.Camp;
      break;
    case Structure.Chapel:
      first = Structure.Shrine;
      population = 26;
      break;
    case Structure.Portal:
      first = Structure.MageTower;
      second = Structure.Guild;
      population = 30;
      break;
    default:
      break;
  }
  if (!completedFacility(town, first))
    return { available: false, reason: 'Complete ' + structureSpec(first).name };
  if (second !== Structure.Count && !completedFacility(town, second))
    return { available: false, reason: 'Complete ' + structureSpec(second).name };
  if (
    road &&
    !town
      .roads()
      .roads()
      .some(
        (r) =>
          r.built >= 1 &&
          !!town.camp(r.village) &&
          belongsToFaction(town.camp(r.village)!, town.controlFaction),
      )
  )
    return { available: false, reason: 'Complete a road' };
  const cost = structureSpec(kind).cost;
  if (cost.planks && !completedFacility(town, Structure.Sawmill))
    return { available: false, reason: 'Complete Sawmill' };
  if (cost.cutStone && !completedFacility(town, Structure.Stoneworks))
    return { available: false, reason: 'Complete Stoneworks' };
  population = Math.max(population, structureSpec(kind).requiredPopulation);
  if (town.population() < population)
    return { available: false, reason: 'Needs ' + population + ' residents' };
  return { available: true, reason: '' };
}
export function toolAvailable(town: Town, tool: Tool): boolean {
  const kind = toolStructure(tool);
  if (kind !== undefined) return buildingUnlock(town, kind).available;
  if (tool === Tool.Road || tool === Tool.Pave) return completedFacility(town, Structure.Camp);
  if (tool === Tool.Field) return completedFacility(town, Structure.Farm);
  return true;
}
export const settlementGoals = (): readonly SettlementGoal[] => goals;
export function goalComplete(town: Town, goal: SettlementGoal): boolean {
  switch (goal.kind) {
    case GoalKind.Building:
      return completedFacility(town, goal.building);
    case GoalKind.Road:
      return town
        .roads()
        .roads()
        .some(
          (r) =>
            r.built >= 1 &&
            !!town.camp(r.village) &&
            belongsToFaction(town.camp(r.village)!, town.controlFaction),
        );
    case GoalKind.Field:
      return town.fieldAcres() > 0;
    case GoalKind.Population:
      return town.population() >= goal.residents;
    default:
      return false;
  }
}
