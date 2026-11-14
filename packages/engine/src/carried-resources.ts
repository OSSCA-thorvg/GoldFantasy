import { Product } from './building-catalog';
import { addInventory, carryBonus, itemSpec, productItem } from './equipment';
import type { Person } from './person';

/** Kilograms a resident carries before a trip to storage is due, without a pack basket. */
export const carryCapacity = 30;
/** From this weight a resident walks slower, down to `burdenedPace` at capacity; without a pack basket. */
export const burdenStart = 15;
/** What this resident carries before a trip to storage is due. */
export const carryLimit = (person: Person): number => carryCapacity + carryBonus(person);
/** The weight from which this resident walks slower. */
export const burdenFrom = (person: Person): number => burdenStart + carryBonus(person);
export const burdenedPace = 0.6;
/** Residents this close can pass resources hand to hand. */
export const handoverReach = 1.4;
/** How far a builder looks for a resident who already carries what the site lacks. */
export const handoverSearch = 18;

export function packAmount(person: Person, product: Product): number {
  let amount = 0;
  for (const stack of person.inventory)
    if (stack && itemSpec(stack.item)?.category === 'resource' && itemSpec(stack.item)!.product === product)
      amount += stack.quantity;
  return amount;
}
export function packTotal(person: Person): number {
  let amount = 0;
  for (const stack of person.inventory)
    if (stack && itemSpec(stack.item)?.category === 'resource') amount += stack.quantity;
  return amount;
}
/** Everything in the pack and the hands, in kilograms. */
export function carriedWeight(person: Person): number {
  let weight = person.carrying > 0 ? person.carrying * (productItem(person.carriedProduct)?.weight ?? 1) : 0;
  for (const stack of person.inventory) if (stack) weight += (itemSpec(stack.item)?.weight ?? 0) * stack.quantity;
  return Math.round(weight * 10) / 10;
}
export function burdenPace(person: Person): number {
  const over = carriedWeight(person) - burdenFrom(person);
  return over <= 0 ? 1 : Math.max(burdenedPace, 1 - ((1 - burdenedPace) * over) / (carryCapacity - burdenStart));
}
export const heldAmount = (person: Person, product: Product): number =>
  packAmount(person, product) + (person.carriedProduct === product ? person.carrying : 0);
/** Hands to pack. Fails when the load is over capacity, which is the cue to visit storage. */
export function stowCargo(person: Person): boolean {
  const item = productItem(person.carriedProduct);
  if (!item || person.carrying <= 0 || carriedWeight(person) > carryLimit(person)) return false;
  if (!addInventory(person, item.id, person.carrying)) return false;
  person.carrying = 0;
  return true;
}
/** Removes up to `count` units of a product from the pack and returns how many came out. */
export function drawFromPack(person: Person, product: Product, count: number): number {
  let taken = 0;
  for (let slot = 0; slot < person.inventory.length && taken < count; ++slot) {
    const stack = person.inventory[slot],
      item = stack && itemSpec(stack.item);
    if (!stack || !item || item.category !== 'resource' || item.product !== product) continue;
    const part = Math.min(stack.quantity, count - taken);
    stack.quantity -= part;
    taken += part;
    if (!stack.quantity) person.inventory[slot] = null;
  }
  return taken;
}
/** Takes from the hands first, then the pack. */
export function takeHeld(person: Person, product: Product, count: number): number {
  let taken = 0;
  if (person.carriedProduct === product && person.carrying > 0) {
    taken = Math.min(person.carrying, count);
    person.carrying -= taken;
  }
  return taken + drawFromPack(person, product, count - taken);
}
/** The largest resource stack moves to the hands so it can be carried to storage. */
export function shoulderPack(person: Person): boolean {
  if (person.carrying > 0) return true;
  let best = -1;
  person.inventory.forEach((stack, slot) => {
    if (!stack || itemSpec(stack.item)?.category !== 'resource') return;
    if (best < 0 || stack.quantity > person.inventory[best]!.quantity) best = slot;
  });
  if (best < 0) return false;
  const stack = person.inventory[best]!;
  person.carriedProduct = itemSpec(stack.item)!.product;
  person.carrying = stack.quantity;
  person.inventory[best] = null;
  return true;
}
