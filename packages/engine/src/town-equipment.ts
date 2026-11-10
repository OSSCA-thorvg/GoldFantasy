import type { Town } from './town';
import { Activity, type Person } from './person';
import { Product, Structure, isSeat } from './building-catalog';
import { canControl } from './faction';
import { distance } from './geometry';
import { resourceAmount, resourceBundle } from './construction-materials';
import { harvestDuration } from './work-timing';
import {
  addInventory,
  backpackSize,
  equipmentSlots,
  inventoryRoom,
  itemCatalog,
  itemSpec,
  productItem,
  workEfficiency,
  type EquipmentSlot,
} from './equipment';

function activeHarvestDuration(person: Person): number {
  return !person.moving() &&
    !person.crossingDoorway() &&
    (person.activity === Activity.Felling || person.activity === Activity.Mining)
    ? harvestDuration(person, person.activity === Activity.Mining)
    : 0;
}
function retimeHarvest(person: Person, time: number, before: number): void {
  if (!before) return;
  // Gear changes the rate of the unfinished work, not how much was completed.
  person.until = time + (Math.max(0, person.until - time) * activeHarvestDuration(person)) / before;
}

export function equipItem(
  this: Town,
  personId: number,
  inventorySlot: number,
  requested?: EquipmentSlot,
): boolean {
  const person = this.person(personId),
    stack = person?.inventory[inventorySlot - 1],
    item = stack && itemSpec(stack.item);
  if (
    !person ||
    !canControl(person, this.controlFaction) ||
    !item ||
    stack.quantity !== 1 ||
    item.minimumLevel > person.level
  )
    return false;
  const slot = requested ?? item.slots.find((slot) => person.equipment[slot] < 0) ?? item.slots[0];
  if (!slot || !item.slots.includes(slot)) return false;
  const harvestBefore = activeHarvestDuration(person);
  for (const other of equipmentSlots)
    if (person.equipment[other] === inventorySlot) person.equipment[other] = -1;
  person.equipment[slot] = inventorySlot;
  retimeHarvest(person, this.time, harvestBefore);
  ++person.lookRevision;
  ++this.changes;
  return true;
}
export function unequipItem(this: Town, personId: number, slot: EquipmentSlot): boolean {
  const person = this.person(personId);
  if (
    !person ||
    !canControl(person, this.controlFaction) ||
    !equipmentSlots.includes(slot) ||
    person.equipment[slot] < 0
  )
    return false;
  const harvestBefore = activeHarvestDuration(person);
  person.equipment[slot] = -1;
  retimeHarvest(person, this.time, harvestBefore);
  ++person.lookRevision;
  ++this.changes;
  return true;
}
export function transferInventory(this: Town, personId: number, from: number, to: number): boolean {
  const p = this.person(personId);
  if (
    !p ||
    !canControl(p, this.controlFaction) ||
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from > backpackSize ||
    to > backpackSize ||
    from === to
  )
    return false;
  if (from === 0) {
    const item = productItem(p.carriedProduct),
      target = p.inventory[to - 1];
    if (
      !item ||
      p.carrying <= 0 ||
      (target && target.item !== item.id) ||
      (target?.quantity ?? 0) + p.carrying > item.maximumStack
    )
      return false;
    p.inventory[to - 1] = { item: item.id, quantity: (target?.quantity ?? 0) + p.carrying };
    p.carrying = 0;
  } else if (to === 0) {
    const stack = p.inventory[from - 1],
      item = stack && itemSpec(stack.item);
    if (!stack || !item || item.category !== 'resource' || (p.carrying && p.carriedProduct !== item.product))
      return false;
    if (p.carrying + stack.quantity > item.maximumStack) return false;
    p.carriedProduct = item.product;
    p.carrying += stack.quantity;
    p.inventory[from - 1] = null;
  } else {
    const a = p.inventory[from - 1],
      b = p.inventory[to - 1];
    if (!a) return false;
    const item = itemSpec(a.item)!;
    if (b?.item === a.item && item.maximumStack > 1) {
      if (a.quantity + b.quantity > item.maximumStack) return false;
      b.quantity += a.quantity;
      p.inventory[from - 1] = null;
    } else {
      p.inventory[from - 1] = b;
      p.inventory[to - 1] = a;
      for (const slot of equipmentSlots) {
        if (p.equipment[slot] === from) p.equipment[slot] = to;
        else if (p.equipment[slot] === to) p.equipment[slot] = from;
      }
    }
  }
  ++this.changes;
  return true;
}
export function inventoryTransferReason(this: Town, personId: number): string {
  const p = this.person(personId);
  if (!p || !canControl(p, this.controlFaction)) return 'Select a controllable resident';
  const village = this.settlementOf(p),
    camp = this.camp(village);
  if (!camp || camp.faction !== p.faction || !camp.built()) return 'A completed home camp is required';
  const storage = this.placed.some(
    (b) =>
      b.built() &&
      b.faction === p.faction &&
      this.settlementOf(b) === village &&
      (isSeat(b.kind) ||
        b.kind === Structure.Storehouse ||
        b.kind === Structure.WoodStore ||
        b.kind === Structure.StoneStore ||
        b.kind === Structure.Granary) &&
      (distance(p.position, b.door()) <= 2.5 || (p.inside && distance(p.entrance, b.door()) < 0.05)),
  );
  return storage ? '' : 'Move within 2.5 paces of your settlement storage';
}
export function withdrawInventory(this: Town, personId: number, product: Product, quantity: number): boolean {
  if (this.inventoryTransferReason(personId) || !Number.isSafeInteger(quantity) || quantity <= 0)
    return false;
  const p = this.person(personId)!,
    item = productItem(product),
    stock = this.stock(this.settlementOf(p));
  if (!item || resourceAmount(stock, product) < quantity || inventoryRoom(p, item.id) < quantity)
    return false;
  if (!addInventory(p, item.id, quantity)) return false;
  stock.subtract(resourceBundle(product, quantity));
  ++this.changes;
  return true;
}
export function depositInventory(this: Town, personId: number, slot: number, quantity?: number): boolean {
  if (this.inventoryTransferReason(personId) || !Number.isInteger(slot) || slot < 0 || slot > backpackSize)
    return false;
  const p = this.person(personId)!,
    stack = slot ? p.inventory[slot - 1] : null,
    item = slot ? stack && itemSpec(stack.item) : productItem(p.carriedProduct),
    available = slot ? (stack?.quantity ?? 0) : p.carrying,
    count = quantity ?? available,
    village = this.settlementOf(p);
  if (
    !item ||
    item.category !== 'resource' ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    count > available
  )
    return false;
  const stock = this.stock(village),
    capacity = this.capacity(village);
  if (
    resourceAmount(stock, item.product) + count > resourceAmount(capacity, item.product) &&
    ![Product.Goods, Product.Mana].includes(item.product)
  )
    return false;
  this.store(resourceBundle(item.product, count), village);
  if (!slot) p.carrying -= count;
  else {
    stack!.quantity -= count;
    if (!stack!.quantity) p.inventory[slot - 1] = null;
  }
  ++this.changes;
  return true;
}
export function craftReason(this: Town, personId: number, workshopId: number, itemId: string): string {
  const p = this.person(personId),
    workshop = this.building(workshopId),
    item = itemSpec(itemId);
  if (!p || !canControl(p, this.controlFaction)) return 'Select a controllable resident';
  if (!item || item.workshop === null) return 'This item cannot be crafted';
  if (!workshop || !workshop.built() || workshop.kind !== item.workshop)
    return 'A completed matching workshop is required';
  if (workshop.faction !== p.faction || this.settlementOf(workshop) !== this.settlementOf(p))
    return 'Use a workshop in this resident’s settlement';
  if (p.craftItem && (p.craftItem !== itemId || p.craftWorkshop !== workshopId))
    return 'Finish or cancel the current crafting order';
  if (inventoryRoom(p, itemId) < 1) return 'The inventory is full';
  if (!this.stock(this.settlementOf(workshop)).covers(item.cost)) return 'Not enough settlement materials';
  return '';
}
export function craftOptions(this: Town, personId: number, workshopId: number) {
  const workshop = this.building(workshopId);
  return itemCatalog
    .filter((item) => item.workshop !== null && item.workshop === workshop?.kind)
    .map((item) => ({ item, reason: this.craftReason(personId, workshopId, item.id) }));
}
export function orderCraft(this: Town, personId: number, workshopId: number, itemId: string): boolean {
  if (this.craftReason(personId, workshopId, itemId)) return false;
  const p = this.person(personId)!,
    workshop = this.building(workshopId)!;
  if (p.craftItem === itemId && p.craftWorkshop === workshopId && p.task === Activity.Crafting) return false;
  if (!this.walkTo(p, workshop.door())) return false;
  this.setOrder(p, Activity.Crafting, workshopId);
  p.craftItem = itemId;
  p.craftWorkshop = workshopId;
  p.craftProgress = 0;
  p.activity = Activity.Crafting;
  p.target = workshopId;
  if (!p.moving()) this.arrive(p);
  return true;
}
export function finishCraftOrder(this: Town, p: Person): void {
  p.craftItem = null;
  p.craftWorkshop = -1;
  p.craftProgress = 0;
  p.task = Activity.Idle;
  p.taskSite = -1;
  p.ordered = p.approachingOrder = false;
  p.autoMode = true;
  p.activity = Activity.Idle;
  p.until = this.time;
}
export function resumeCraftOrder(this: Town, p: Person): boolean {
  if (p.task !== Activity.Crafting) return false;
  const workshop = this.building(p.craftWorkshop),
    item = p.craftItem && itemSpec(p.craftItem);
  if (
    !workshop ||
    !workshop.built() ||
    !item ||
    workshop.kind !== item.workshop ||
    workshop.faction !== p.faction ||
    this.settlementOf(workshop) !== this.settlementOf(p)
  ) {
    this.finishCraftOrder(p);
    return false;
  }
  if (!this.walkTo(p, workshop.door())) {
    p.activity = Activity.Holding;
    p.until = this.time + 1;
    return true;
  }
  p.activity = Activity.Crafting;
  p.target = workshop.id;
  if (!p.moving()) this.arrive(p);
  return true;
}
export function advanceCrafting(this: Town, p: Person, dt: number): void {
  if (p.task !== Activity.Crafting || !p.craftItem || p.moving() || p.crossingDoorway()) return;
  const workshop = this.building(p.craftWorkshop),
    item = itemSpec(p.craftItem);
  if (
    !workshop ||
    !workshop.built() ||
    !item ||
    workshop.kind !== item.workshop ||
    workshop.faction !== p.faction ||
    this.settlementOf(workshop) !== this.settlementOf(p)
  ) {
    this.finishCraftOrder(p);
    return;
  }
  if (!p.inside && distance(p.position, workshop.door()) > 0.03) {
    this.resumeCraftOrder(p);
    return;
  }
  const stock = this.stock(this.settlementOf(workshop));
  if (!stock.covers(item.cost) || inventoryRoom(p, item.id) < 1) {
    p.until = this.time + 1;
    return;
  }
  p.craftProgress += Math.max(0, dt) * workEfficiency(p, 'crafting');
  if (p.craftProgress + 1e-6 < item.seconds) return;
  if (!addInventory(p, item.id)) return;
  stock.subtract(item.cost);
  this.notify(`${p.name} crafted ${item.name}`);
  ++this.changes;
  this.finishCraftOrder(p);
}
