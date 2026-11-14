// What the title player has made at the stations: the quest's items first, then arms for the fighters, then tools
// for the workers. Recipes and their reasons are read from the stations' own option lists, never hard-coded.
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, Calling, type Person } from '../../../../packages/engine/src/person';
import type { Building } from '../../../../packages/engine/src/town-models';
import { Structure } from '../../../../packages/engine/src/building-catalog';
import {
  carriedTools,
  equippedItem,
  isCraftStation,
  type ItemSpec,
  type WorkKind,
} from '../../../../packages/engine/src/equipment';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';

/** Weapon shapes each calling fights best with, best first. */
const weaponShapes: Partial<Record<Calling, readonly string[]>> = {
  [Calling.Warrior]: ['sword', 'mace', 'spear'],
  [Calling.Ranger]: ['bow'],
  [Calling.Mage]: ['staff'],
  [Calling.Cleric]: ['mace', 'sword'],
  [Calling.Bard]: ['sword', 'spear', 'mace'],
};
const plainShapes = ['sword', 'mace', 'spear'];
export const isFighter = (p: Person): boolean => p.calling >= Calling.Warrior;

export function ownStations(town: Town): Building[] {
  return town.buildings().filter((b) => isPlayerBuilding(b) && b.built() && isCraftStation(b.kind));
}
/** A station already has someone ordered to it (working, walking there or waiting). */
export function stationBusy(town: Town, station: Building): boolean {
  return town.people().some((p) => p.health > 0 && p.task === Activity.Crafting && p.craftWorkshop === station.id);
}
const owns = (p: Person, id: string): boolean => p.inventory.some((s) => s?.item === id);
const toolRate = (p: Person, work: WorkKind): number =>
  Math.max(0, ...carriedTools(p).filter((t) => t.work.includes(work)).map((t) => t.rate));
/** The work a resident's job or task needs a tool for. */
export function workOf(town: Town, p: Person): WorkKind | null {
  const job = town.building(p.job);
  if (job) {
    if (job.kind === Structure.Farm) return 'farming';
    if (job.kind === Structure.Lumberyard) return 'woodcutting';
    if (job.kind === Structure.Quarry) return 'mining';
    if (job.kind === Structure.Sawmill) return 'sawing';
  }
  if (p.task === Activity.Felling) return 'woodcutting';
  if (p.task === Activity.Mining) return 'mining';
  if (p.task === Activity.Building) return 'construction';
  if (p.task === Activity.Roadwork) return 'digging';
  return null;
}
/** How much `item` would add for `p`; 0 when it adds nothing. */
export function gearWorth(town: Town, p: Person, item: ItemSpec): number {
  if (owns(p, item.id) || item.minimumLevel > p.level) return 0;
  if (item.category === 'weapon') {
    const shapes = weaponShapes[p.calling] ?? plainShapes,
      rank = shapes.indexOf(item.visual ?? '');
    if (rank < 0) return 0;
    const held = equippedItem(p, 'weapon'),
      gain = item.attackBonus - (held?.attackBonus ?? 0);
    return gain > 0.05 ? (isFighter(p) ? 40 : 12) + gain * 10 - rank : 0;
  }
  if (item.category === 'armor' && item.slots.length) {
    if (!isFighter(p) && item.visual !== 'basket') return 0;
    if (item.visual === 'basket') return equippedItem(p, 'accessory') ? 0 : 6;
    const slot = item.slots[0],
      held = equippedItem(p, slot);
    if (item.block > 0) {
      const weapon = equippedItem(p, 'weapon');
      if (weapon && weapon.hands === 2) return 0;
      return item.block > (held?.block ?? 0) ? 30 + item.block * 20 : 0;
    }
    return item.defense > (held?.defense ?? 0) ? 25 + item.defense * 40 : 0;
  }
  if (item.category === 'tool') {
    const work = workOf(town, p);
    if (!work || !item.work.includes(work)) return 0;
    return item.rate > toolRate(p, work) + 0.01 ? 15 + item.rate * 10 : 0;
  }
  return 0;
}
export interface GearChoice {
  person: Person;
  station: Building;
  item: ItemSpec;
  worth: number;
}
/** The most useful item some free resident can have made now at a free station, or null. */
export function bestGear(town: Town, free: readonly Person[], wanted?: readonly string[]): GearChoice | null {
  let best: GearChoice | null = null;
  for (const station of ownStations(town)) {
    if (stationBusy(town, station)) continue;
    for (const p of free)
      for (const { item, reason } of town.craftOptions(p.id, station.id)) {
        if (reason) continue;
        const worth = wanted ? (wanted.includes(item.id) && !owns(p, item.id) ? 100 - item.cost.wood : 0) : gearWorth(town, p, item);
        if (worth > 0 && (!best || worth > best.worth)) best = { person: p, station, item, worth };
      }
  }
  return best;
}
/** Items of `wanted` (cheapest first) that the town could make at some station, ignoring materials. */
export function makeable(town: Town, someone: Person, wanted: readonly string[]): ItemSpec[] {
  const out: ItemSpec[] = [];
  for (const station of ownStations(town))
    for (const { item, reason } of town.craftOptions(someone.id, station.id))
      if (wanted.includes(item.id) && (!reason || reason === 'Not enough settlement materials')) out.push(item);
  return out.sort((a, b) => a.cost.wood + a.cost.stone - (b.cost.wood + b.cost.stone));
}
