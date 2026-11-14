import type { Resources, Structure } from './building-catalog';
import { itemSpec, upgradeCost, upgradeSeconds, type ItemSpec } from './equipment';
import { longestStationStep, stationStep } from './craft-stations';

// A resident's order at a station, kept in `Person.craftItem`: an item id to make it new, `upgrade:<id>` to turn
// the resident's weaker make into it, `level:<n>` to raise the station itself.
const upgradePrefix = 'upgrade:',
  levelPrefix = 'level:';
export type CraftOrder =
  | { kind: 'make'; item: ItemSpec }
  | { kind: 'upgrade'; item: ItemSpec }
  | { kind: 'station'; level: number };
export const upgradeOrder = (targetId: string): string => upgradePrefix + targetId;
export const stationOrder = (level: number): string => levelPrefix + level;
export function craftOrder(text: string | null): CraftOrder | null {
  if (!text) return null;
  if (text.startsWith(levelPrefix)) {
    const level = Number(text.slice(levelPrefix.length));
    return Number.isInteger(level) && level >= 2 && level <= 3 ? { kind: 'station', level } : null;
  }
  const upgrade = text.startsWith(upgradePrefix),
    item = itemSpec(upgrade ? text.slice(upgradePrefix.length) : text);
  return item && item.workshop !== null ? { kind: upgrade ? 'upgrade' : 'make', item } : null;
}
/** The item an order makes, new or by upgrade; null for a station's own level. */
export const orderItem = (text: string | null): ItemSpec | null => {
  const order = craftOrder(text);
  return order && order.kind !== 'station' ? order.item : null;
};
/** Work an order takes, in item seconds; for a station step the station's kind decides. */
export function orderSeconds(order: CraftOrder, kind: Structure | null): number {
  if (order.kind === 'make') return order.item.seconds;
  if (order.kind === 'upgrade') return upgradeSeconds(order.item);
  return (kind !== null ? stationStep(kind, order.level)?.seconds : undefined) ?? longestStationStep();
}
export function orderCost(order: CraftOrder, kind: Structure): Resources | null {
  if (order.kind === 'make') return order.item.cost;
  if (order.kind === 'upgrade') return upgradeCost(order.item);
  return stationStep(kind, order.level)?.cost ?? null;
}
