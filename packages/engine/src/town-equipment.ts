import type { Town } from './town';
import { Activity, Role, type Person } from './person';
import { Product, Resources, Structure, isSeat, structureSpec } from './building-catalog';
import { heldAmount, takeHeld } from './carried-resources';
import { canControl } from './faction';
import { add, distance, normalized, point, scale, sub, type Point } from './geometry';
import type { Building } from './town-models';
import { constructionProducts, resourceAmount, resourceBundle } from './construction-materials';
import { harvestDuration } from './work-timing';
import { Boon, boon, boonRules } from './gate-boons';
import { levelVariant, stationLevel, stationStep } from './craft-stations';
import { craftOrder, orderCost, orderSeconds, stationOrder, upgradeOrder, type CraftOrder } from './craft-orders';
import { completedFacility, deedCount, type UnlockRequirement } from './settlement-progression';
import {
  addInventory,
  backpackSize,
  craftsAt,
  equipmentSlots,
  equippedItem,
  gearEffect,
  isCraftStation,
  isShield,
  inventoryRoom,
  itemCatalog,
  itemSpec,
  productItem,
  upgradeCost,
  upperTier,
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
  if (!slot || !item.slots.includes(slot) || equipBlock(person, item, slot)) return false;
  const harvestBefore = activeHarvestDuration(person);
  for (const other of equipmentSlots)
    if (person.equipment[other] === inventorySlot) person.equipment[other] = -1;
  person.equipment[slot] = inventorySlot;
  // A two-handed weapon puts the shield away; it stays in the pack.
  if (slot === 'weapon' && item.hands === 2 && isShield(equippedItem(person, 'offhand'))) person.equipment.offhand = -1;
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
  return storage ? '' : 'Move closer to your settlement storage';
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
/** Recipes draw on the settlement store first, then on what the crafter carries, then on the packs of `helpers`. */
export function craftCovered(stock: Resources, p: Person, cost: Resources, helpers: readonly Person[] = []): boolean {
  return craftProducts.every(
    (product) =>
      resourceAmount(stock, product) + heldAmount(p, product) + helpers.reduce((sum, q) => sum + heldAmount(q, product), 0) >=
      resourceAmount(cost, product),
  );
}
function payCraft(stock: Resources, p: Person, cost: Resources, helpers: readonly Person[] = []): void {
  for (const product of craftProducts) {
    let need = resourceAmount(cost, product);
    const stored = Math.min(need, resourceAmount(stock, product));
    stock.subtract(resourceBundle(product, stored));
    need -= stored;
    for (const q of [p, ...helpers]) need -= takeHeld(q, product, need);
  }
}
/** Residents of the station's settlement whose packs count as settlement materials, nearest first. */
export function craftHelpers(this: Town, p: Person, workshop: Building): Person[] {
  const village = this.settlementOf(workshop),
    door = workshop.door();
  return this.folk
    .filter(
      (q) =>
        q !== p &&
        q.role === Role.Resident &&
        q.health > 0 &&
        q.faction === workshop.faction &&
        this.settlementOf(q) === village,
    )
    .sort((a, b) => distance(a.position, door) - distance(b.position, door) || a.id - b.id);
}
const stationName = (kind: Structure): string => structureSpec(kind).name.toLowerCase();
const levelReason = (kind: Structure, level: number): string => `Needs a level ${level} ${stationName(kind)}`;
/** The highest level a finished station of `kind` has reached in `village`; 0 with none. */
export function stationLevelIn(this: Town, kind: Structure, village: number): number {
  let best = 0;
  for (const b of this.placed)
    if (b.kind === kind && b.built() && b.faction === this.controlFaction && this.settlementOf(b) === village)
      best = Math.max(best, stationLevel(b));
  return best;
}
/** What raising this station to its next level asks of the settlement, cost aside; empty at the top. */
export function stationNeeds(this: Town, stationId: number): UnlockRequirement[] {
  const station = this.building(stationId),
    next = station ? stationStep(station.kind, stationLevel(station) + 1) : null;
  if (!station || !next) return [];
  const out: UnlockRequirement[] = [],
    village = this.settlementOf(station);
  for (const kind of next.after)
    out.push({ text: 'Complete ' + structureSpec(kind).name, done: completedFacility(this, kind) });
  if (next.cost.planks) out.push({ text: 'Complete Sawmill', done: completedFacility(this, Structure.Sawmill) });
  if (next.cost.cutStone) out.push({ text: 'Complete Stoneworks', done: completedFacility(this, Structure.Stoneworks) });
  if (next.station)
    out.push({
      text: levelReason(next.station.kind, next.station.level),
      done: this.stationLevelIn(next.station.kind, village) >= next.station.level,
    });
  if (next.floors) out.push({ text: 'Clear a floor beyond a gate', done: deedCount(this, 'floors') >= next.floors });
  if (next.residents)
    out.push({ text: 'Needs ' + next.residents + ' residents', done: this.population() >= next.residents });
  return out;
}
/** Why `personId` cannot take an order at the station now, before materials; '' when they can. */
function orderBlock(town: Town, p: Person | null, workshop: Building | null, text: string): string {
  if (!p || !canControl(p, town.controlFaction)) return 'Select a controllable resident';
  if (!workshop || !workshop.built() || !isCraftStation(workshop.kind)) return 'A completed matching workshop is required';
  if (workshop.faction !== p.faction || town.settlementOf(workshop) !== town.settlementOf(p))
    return 'Use a workshop in this resident’s settlement';
  if (p.craftItem && (p.craftItem !== text || p.craftWorkshop !== workshop.id))
    return 'Finish or cancel the current crafting order';
  return '';
}
export function craftReason(this: Town, personId: number, workshopId: number, itemId: string): string {
  const p = this.person(personId),
    workshop = this.building(workshopId),
    item = itemSpec(itemId);
  if (!p || !canControl(p, this.controlFaction)) return 'Select a controllable resident';
  if (!item || item.workshop === null) return 'This item cannot be crafted';
  if (!workshop || !workshop.built() || !craftsAt(item, workshop.kind))
    return item.workshop === Structure.Workbench
      ? 'Build a workbench first'
      : item.workshop === Structure.Weaponsmith
        ? 'Build a smithy first'
        : 'A completed matching workshop is required';
  const blocked = orderBlock(this, p, workshop, itemId);
  if (blocked) return blocked;
  if (stationLevel(workshop) < item.stationLevel) return levelReason(workshop.kind, item.stationLevel);
  if (inventoryRoom(p, itemId) < 1) return 'The inventory is full';
  if (!craftCovered(this.stock(this.settlementOf(workshop)), p, item.cost, this.craftHelpers(p, workshop)))
    return 'Not enough settlement materials';
  return '';
}
/** The pack slot (1-based) holding the make this resident would turn into `target`, the equipped one first; 0 with none. */
export function upgradeSource(p: Person, target: ItemSpec): number {
  let found = 0;
  p.inventory.forEach((stack, index) => {
    const item = stack ? itemSpec(stack.item) : null;
    if (!item || upperTier(item)?.id !== target.id) return;
    const worn = equipmentSlots.some((slot) => p.equipment[slot] === index + 1);
    if (!found || worn) found = index + 1;
  });
  return found;
}
/** Why `personId` cannot turn their weaker make into `targetId` at the station; '' when they can. */
export function upgradeReason(this: Town, personId: number, workshopId: number, targetId: string): string {
  const p = this.person(personId),
    workshop = this.building(workshopId),
    item = itemSpec(targetId);
  if (!item || item.workshop === null || !workshop || !craftsAt(item, workshop.kind)) return 'This item cannot be crafted';
  const blocked = orderBlock(this, p, workshop, upgradeOrder(targetId));
  if (blocked) return blocked;
  if (!upgradeSource(p!, item)) return 'Has nothing to upgrade';
  if (stationLevel(workshop) < item.stationLevel) return levelReason(workshop.kind, item.stationLevel);
  if (!craftCovered(this.stock(this.settlementOf(workshop)), p!, upgradeCost(item), this.craftHelpers(p!, workshop)))
    return 'Not enough settlement materials';
  return '';
}
/** Why `personId` cannot raise the station to its next level; '' when they can. */
export function stationUpgradeReason(this: Town, personId: number, workshopId: number): string {
  const p = this.person(personId),
    workshop = this.building(workshopId),
    next = workshop ? stationStep(workshop.kind, stationLevel(workshop) + 1) : null;
  if (workshop && isCraftStation(workshop.kind) && !next) return 'Already at the highest level';
  const blocked = orderBlock(this, p, workshop, next ? stationOrder(next.level) : '');
  if (blocked || !next || !workshop) return blocked || 'A completed matching workshop is required';
  if (this.folk.some((q) => q !== p && q.task === Activity.Crafting && q.craftWorkshop === workshop.id && craftOrder(q.craftItem)?.kind === 'station'))
    return 'Someone is already upgrading it';
  const missing = this.stationNeeds(workshop.id).find((r) => !r.done);
  if (missing) return missing.text;
  if (!craftCovered(this.stock(this.settlementOf(workshop)), p!, next.cost, this.craftHelpers(p!, workshop)))
    return 'Not enough settlement materials';
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
function placeOrder(town: Town, p: Person, workshop: Building, text: string): boolean {
  if (p.craftItem === text && p.craftWorkshop === workshop.id && p.task === Activity.Crafting) return false;
  if (!town.walkTo(p, craftSpot(workshop))) return false;
  town.setOrder(p, Activity.Crafting, workshop.id);
  p.craftItem = text;
  p.craftWorkshop = workshop.id;
  p.craftProgress = 0;
  town.resumeCraftOrder(p);
  return true;
}
export function orderCraft(this: Town, personId: number, workshopId: number, itemId: string): boolean {
  if (this.craftReason(personId, workshopId, itemId)) return false;
  return placeOrder(this, this.person(personId)!, this.building(workshopId)!, itemId);
}
/** Sends the resident to turn their weaker make into `targetId`; the old item goes into the new one. */
export function orderUpgrade(this: Town, personId: number, workshopId: number, targetId: string): boolean {
  if (this.upgradeReason(personId, workshopId, targetId)) return false;
  return placeOrder(this, this.person(personId)!, this.building(workshopId)!, upgradeOrder(targetId));
}
/** Sends the resident to raise the station to its next level. */
export function orderStationUpgrade(this: Town, personId: number, workshopId: number): boolean {
  if (this.stationUpgradeReason(personId, workshopId)) return false;
  const workshop = this.building(workshopId)!;
  return placeOrder(this, this.person(personId)!, workshop, stationOrder(stationLevel(workshop) + 1));
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
/** What an order makes, in a notice: "the Iron sword", or "the smithy's next level". */
export function orderName(this: Town, p: Person): string {
  const order = craftOrder(p.craftItem),
    station = this.building(p.craftWorkshop);
  if (!order) return '';
  return order.kind === 'station'
    ? `${station ? structureSpec(station.kind).name : 'station'} level ${order.level}`
    : order.item.name;
}
/** Drops a resident's craft order. Nothing is paid until the item is done, so nothing is lost; the next in line takes the station. */
export function cancelCraft(this: Town, personId: number): boolean {
  const p = this.person(personId);
  if (!p || p.health <= 0 || !canControl(p, this.controlFaction) || p.task !== Activity.Crafting || !p.craftItem)
    return false;
  const name = this.orderName(p);
  this.commanded();
  this.finishCraftOrder(p);
  if (name) this.notify(`${p.name} stopped making the ${name}`);
  ++this.changes;
  return true;
}
/** The order still makes sense at this station: the right workshop, its level, and for an upgrade the old item. */
function orderValid(town: Town, p: Person, workshop: Building | null, order: CraftOrder | null): workshop is Building {
  if (
    !workshop ||
    !workshop.built() ||
    !order ||
    workshop.faction !== p.faction ||
    town.settlementOf(workshop) !== town.settlementOf(p)
  )
    return false;
  if (order.kind === 'station') return stationLevel(workshop) + 1 === order.level && !!stationStep(workshop.kind, order.level);
  return (
    craftsAt(order.item, workshop.kind) &&
    stationLevel(workshop) >= order.item.stationLevel &&
    (order.kind === 'make' || upgradeSource(p, order.item) > 0)
  );
}
/** Walks to the station, waits beside it while another resident works it, then takes the work spot. */
export function resumeCraftOrder(this: Town, p: Person): boolean {
  if (p.task !== Activity.Crafting) return false;
  const workshop = this.building(p.craftWorkshop);
  if (!orderValid(this, p, workshop, craftOrder(p.craftItem))) {
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
/** Share of the current order done, 0 to 1. */
export function craftShare(this: Town, p: Person): number {
  const order = craftOrder(p.craftItem),
    station = this.building(p.craftWorkshop);
  return order ? Math.min(1, p.craftProgress / orderSeconds(order, station?.kind ?? null)) : 0;
}
export function advanceCrafting(this: Town, p: Person, dt: number): void {
  if (p.task !== Activity.Crafting || !p.craftItem || p.moving() || p.crossingDoorway()) return;
  const workshop = this.building(p.craftWorkshop),
    order = craftOrder(p.craftItem);
  if (!order || !orderValid(this, p, workshop, order)) {
    this.finishCraftOrder(p);
    return;
  }
  if (p.inside || distance(p.position, craftSpot(workshop)) > 0.05) {
    this.resumeCraftOrder(p);
    return;
  }
  const stock = this.stock(this.settlementOf(workshop)),
    cost = orderCost(order, workshop.kind)!,
    helpers = this.craftHelpers(p, workshop);
  if (!craftCovered(stock, p, cost, helpers) || (order.kind === 'make' && inventoryRoom(p, order.item.id) < 1)) {
    p.until = this.time + 1;
    return;
  }
  // Progress stays in item seconds; the Forge boon makes it run faster.
  p.craftProgress +=
    (Math.max(0, dt) * workEfficiency(p, 'crafting')) / (boon(this, Boon.Forge) ? boonRules.forgeSeconds : 1);
  if (p.craftProgress + 1e-6 < orderSeconds(order, workshop.kind)) return;
  if (order.kind === 'station') {
    payCraft(stock, p, cost, helpers);
    raiseStation(this, workshop, order.level);
    this.notify(`${p.name} raised the ${stationName(workshop.kind)} to level ${order.level}`);
    ++this.changes;
    this.finishCraftOrder(p);
    return;
  }
  const item = order.item;
  if (order.kind === 'upgrade') {
    const slot = upgradeSource(p, item),
      old = itemSpec(p.inventory[slot - 1]!.item)!;
    payCraft(stock, p, cost, helpers);
    p.inventory[slot - 1] = { item: item.id, quantity: 1 };
    // A make the owner is not yet strong enough for goes back to the pack.
    for (const s of equipmentSlots)
      if (p.equipment[s] === slot && (item.minimumLevel > p.level || !item.slots.includes(s))) p.equipment[s] = -1;
    ++p.lookRevision;
    this.notify(`${p.name} upgraded the ${old.name} to the ${item.name}`);
  } else {
    payCraft(stock, p, cost, helpers);
    if (!addInventory(p, item.id)) return;
    this.notify(`${p.name} crafted ${item.name}`);
  }
  if (item.category === 'weapon' && item.tier >= 3) ++this.chronicle.weaponsForged;
  ++this.changes;
  this.finishCraftOrder(p);
  if (item.category === 'tool') {
    if (order.kind === 'make') this.notify(`${item.name} in the pack · ${gearEffect(item)}`);
  } else if (order.kind === 'make' && takeUpCrafted(this, p, item.id)) this.notify(`${item.name} in hand · ${gearEffect(item)}`);
}
/** The station shows its new level: a new look rising from the old one, as a chapel's faith does. */
function raiseStation(town: Town, station: Building, level: number): void {
  station.replaced = [{ kind: station.kind, variant: station.variant, dx: 0, dy: 0 }];
  station.variant = levelVariant(level);
  station.version = (station.version + 1) >>> 0;
  ++town.changes;
}
/** New worn gear goes straight into a free slot it fits, so its effect is felt at once. */
function takeUpCrafted(town: Town, p: Person, id: string): boolean {
  const item = itemSpec(id),
    index = p.inventory.findIndex(
      (stack, i) => stack?.item === id && !equipmentSlots.some((slot) => p.equipment[slot] === i + 1),
    ),
    slot = item?.slots.find((s) => p.equipment[s] < 0);
  return (
    !!item &&
    index >= 0 &&
    !!slot &&
    item.minimumLevel <= p.level &&
    !equipBlock(p, item, slot) &&
    town.equipItem(p.id, index + 1, slot)
  );
}
/** Why `item` cannot go into `slot` beside what is already held: a shield needs the other hand free. */
export function equipBlock(p: Person, item: ItemSpec, slot: EquipmentSlot): string {
  const weapon = equippedItem(p, 'weapon');
  if (slot === 'offhand' && isShield(item) && weapon && weapon.hands === 2)
    return `The ${weapon.name.toLowerCase()} takes both hands`;
  return '';
}
