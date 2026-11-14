import type { Town } from './town';
import { Activity, type Person } from './person';
import { Product, Resources, Structure, isSeat } from './building-catalog';
import { heldAmount, takeHeld } from './carried-resources';
import { canControl } from './faction';
import { add, distance, normalized, point, scale, sub, type Point } from './geometry';
import type { Building } from './town-models';
import { constructionProducts, resourceAmount, resourceBundle } from './construction-materials';
import { harvestDuration } from './work-timing';
import { Boon, boon, boonRules } from './gate-boons';
import {
  addInventory,
  backpackSize,
  craftsAt,
  equipmentSlots,
  gearEffect,
  inventoryRoom,
  itemCatalog,
  itemSpec,
  productItem,
  workEfficiency,
  type EquipmentSlot,
  type ItemSpec,
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
const craftProducts = [Product.Goods, ...constructionProducts];
/** Recipes draw on the settlement store first, then on what the crafter carries. */
export function craftCovered(stock: Resources, p: Person, cost: Resources): boolean {
  return craftProducts.every(
    (product) => resourceAmount(stock, product) + heldAmount(p, product) >= resourceAmount(cost, product),
  );
}
function payCraft(stock: Resources, p: Person, cost: Resources): void {
  for (const product of craftProducts) {
    const need = resourceAmount(cost, product),
      stored = Math.min(need, resourceAmount(stock, product));
    stock.subtract(resourceBundle(product, stored));
    takeHeld(p, product, need - stored);
  }
}
export function craftReason(this: Town, personId: number, workshopId: number, itemId: string): string {
  const p = this.person(personId),
    workshop = this.building(workshopId),
    item = itemSpec(itemId);
  if (!p || !canControl(p, this.controlFaction)) return 'Select a controllable resident';
  if (!item || item.workshop === null) return 'This item cannot be crafted';
  if (!workshop || !workshop.built() || !craftsAt(item, workshop.kind))
    return item.workshop === Structure.Workbench ? 'Build a workbench first' : 'A completed matching workshop is required';
  if (workshop.faction !== p.faction || this.settlementOf(workshop) !== this.settlementOf(p))
    return 'Use a workshop in this resident’s settlement';
  if (p.craftItem && (p.craftItem !== itemId || p.craftWorkshop !== workshopId))
    return 'Finish or cancel the current crafting order';
  if (inventoryRoom(p, itemId) < 1) return 'The inventory is full';
  if (!craftCovered(this.stock(this.settlementOf(workshop)), p, item.cost)) return 'Not enough settlement materials';
  return '';
}
export function craftOptions(this: Town, personId: number, workshopId: number) {
  const workshop = this.building(workshopId);
  return itemCatalog
    .filter((item) => !!workshop && craftsAt(item, workshop.kind))
    .map((item) => ({ item, reason: this.craftReason(personId, workshopId, item.id) }));
}
/** Where the crafter stands: in the open at the door, facing the building's centre. */
export function craftSpot(workshop: Building): Point {
  return workshop.door();
}
/** Where a resident waits for a busy station: a pace to the side of the work spot. */
export function craftWaitSpot(this: Town, workshop: Building): Point {
  const door = workshop.door(),
    out = normalized(sub(door, workshop.center));
  return this.grid.nearestWalkable(add(door, scale(point(-out.y, out.x), 0.7)));
}
const crafting = (p: Person, id: number): boolean =>
  p.health > 0 && p.task === Activity.Crafting && p.craftWorkshop === id;
/** The resident working the station now, or null. One works a station at a time. */
export function craftingAt(this: Town, workshopId: number): Person | null {
  return this.folk.find((p) => crafting(p, workshopId) && p.activity === Activity.Crafting) ?? null;
}
/** Residents with an order at the station who are on their way or waiting their turn. */
export function craftQueue(this: Town, workshopId: number): Person[] {
  return this.folk.filter((p) => crafting(p, workshopId) && p.activity !== Activity.Crafting);
}
export function orderCraft(this: Town, personId: number, workshopId: number, itemId: string): boolean {
  if (this.craftReason(personId, workshopId, itemId)) return false;
  const p = this.person(personId)!,
    workshop = this.building(workshopId)!;
  if (p.craftItem === itemId && p.craftWorkshop === workshopId && p.task === Activity.Crafting) return false;
  if (!this.walkTo(p, craftSpot(workshop))) return false;
  this.setOrder(p, Activity.Crafting, workshopId);
  p.craftItem = itemId;
  p.craftWorkshop = workshopId;
  p.craftProgress = 0;
  this.resumeCraftOrder(p);
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
function stationValid(town: Town, p: Person, workshop: Building | null, item: ItemSpec | null): workshop is Building {
  return (
    !!workshop &&
    workshop.built() &&
    !!item &&
    craftsAt(item, workshop.kind) &&
    workshop.faction === p.faction &&
    town.settlementOf(workshop) === town.settlementOf(p)
  );
}
/** Walks to the station, waits beside it while another resident works it, then takes the work spot. */
export function resumeCraftOrder(this: Town, p: Person): boolean {
  if (p.task !== Activity.Crafting) return false;
  const workshop = this.building(p.craftWorkshop),
    item = p.craftItem ? itemSpec(p.craftItem) : null;
  if (!stationValid(this, p, workshop, item)) {
    this.finishCraftOrder(p);
    return false;
  }
  const other = this.craftingAt(workshop.id),
    taken = !!other && other.id !== p.id,
    spot = taken ? this.craftWaitSpot(workshop) : craftSpot(workshop);
  p.target = workshop.id;
  if (p.inside || distance(p.position, spot) > 0.05) {
    if (!this.walkTo(p, spot)) {
      p.activity = Activity.Holding;
      p.path = [];
      p.until = this.time + 1;
    } else p.activity = Activity.Moving;
    return true;
  }
  p.path = [];
  if (taken) {
    p.activity = Activity.Holding;
    p.until = this.time + 0.5;
    return true;
  }
  p.activity = Activity.Crafting;
  p.until = this.time;
  return true;
}
export function advanceCrafting(this: Town, p: Person, dt: number): void {
  if (p.task !== Activity.Crafting || !p.craftItem || p.moving() || p.crossingDoorway()) return;
  const workshop = this.building(p.craftWorkshop),
    item = itemSpec(p.craftItem);
  if (!item || !stationValid(this, p, workshop, item)) {
    this.finishCraftOrder(p);
    return;
  }
  if (p.inside || distance(p.position, craftSpot(workshop)) > 0.05) {
    this.resumeCraftOrder(p);
    return;
  }
  const stock = this.stock(this.settlementOf(workshop));
  if (!craftCovered(stock, p, item.cost) || inventoryRoom(p, item.id) < 1) {
    p.until = this.time + 1;
    return;
  }
  // Progress stays in item seconds; the Forge boon makes it run faster.
  p.craftProgress +=
    (Math.max(0, dt) * workEfficiency(p, 'crafting')) / (boon(this, Boon.Forge) ? boonRules.forgeSeconds : 1);
  if (p.craftProgress + 1e-6 < item.seconds) return;
  payCraft(stock, p, item.cost);
  if (!addInventory(p, item.id)) return;
  // Only the smith forges; whittled bench weapons do not count.
  if (item.category === 'weapon' && item.workshop === Structure.Weaponsmith) ++this.chronicle.weaponsForged;
  this.notify(`${p.name} crafted ${item.name}`);
  ++this.changes;
  this.finishCraftOrder(p);
  if (takeUpCrafted(this, p, item.id)) this.notify(`${item.name} in hand · ${gearEffect(item)}`);
}
/** New gear goes straight into a free slot it fits, so its effect is felt at once. */
function takeUpCrafted(town: Town, p: Person, id: string): boolean {
  const item = itemSpec(id),
    index = p.inventory.findIndex(
      (stack, i) => stack?.item === id && !equipmentSlots.some((slot) => p.equipment[slot] === i + 1),
    ),
    slot = item?.slots.find((s) => p.equipment[s] < 0);
  return !!item && index >= 0 && !!slot && item.minimumLevel <= p.level && town.equipItem(p.id, index + 1, slot);
}
