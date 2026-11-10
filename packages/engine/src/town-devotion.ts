import { TownState } from './town-state';
import { Activity, Calling, Person, Role } from './person';
import { Resources, Structure, isHome, structureSpec } from './building-catalog';
import { Building } from './town-models';
import { CampReceipt } from './camp-economy';
import { canControl, sameFaction, belongsToFaction } from './faction';
import { distance, type Point } from './geometry';
import { offeringReason, offeringOutcome } from './prayer-offering';
import { emptyEquipment } from './equipment';

export const ceremonySeconds = 5;
export interface DevotionEvent {
  serial: bigint;
  altar: number;
  person: number;
  at: number;
  position: Point;
}
export function devotionEvents(this: TownState): readonly DevotionEvent[] {
  this.altarEvents = this.altarEvents.filter((event) => this.time - event.at <= 3);
  return this.altarEvents;
}
export interface AltarStatus {
  reason: string;
  pendingBirths: number;
  dueDay: number;
  cost: Resources;
}
export interface DevotionTown extends TownState {
  camp(id?: number): Building | null;
  settlementOf(item: Building | Person): number;
  stock(village?: number): Resources;
  makePerson(role: Role, calling: Calling, at: Point): Person;
  assignHomes(): void;
  staff(): void;
  recordReceipt(receipt: CampReceipt): void;
  walkTo(person: Person, to: Point): boolean;
  setOrder(person: Person, task: Activity, site?: number): void;
  arrive(person: Person): void;
  processDevotion(): void;
  prayerReason(personId: number, altarId: number): string;
  trainingReason(personId: number, guildId: number, calling: Calling): string;
}
function altar(place: Building | null): place is Building {
  return !!place && place.kind === Structure.Shrine && place.built() && place.health > 0;
}
function localResidents(town: DevotionTown, place: Building): number {
  const village = town.settlementOf(place);
  return town.folk.filter(
    (p) =>
      p.role === Role.Resident && p.health > 0 && sameFaction(p, place) && town.settlementOf(p) === village,
  ).length;
}
function localHousing(town: DevotionTown, place: Building): number {
  const village = town.settlementOf(place);
  return town.placed.reduce(
    (sum, b) =>
      sum +
      (b.built() &&
      b.health > 0 &&
      isHome(b.kind) &&
      sameFaction(b, place) &&
      town.settlementOf(b) === village
        ? structureSpec(b.kind).residents
        : 0),
    0,
  );
}
function reservedHomes(town: DevotionTown, place: Building, exceptPerson = -1): number {
  const village = town.settlementOf(place);
  const pending = town.placed.filter(
    (b) => altar(b) && b.devotionDueDay >= 0 && sameFaction(b, place) && town.settlementOf(b) === village,
  ).length;
  // A walking or interrupted worshipper holds the same bed reservation as one already praying.
  const praying = new Set<number>();
  for (const p of town.folk) {
    if (
      p.id === exceptPerson ||
      p.role !== Role.Resident ||
      p.health <= 0 ||
      p.task !== Activity.Praying ||
      !sameFaction(p, place)
    )
      continue;
    const target = town.building(p.taskSite);
    if (
      altar(target) &&
      target.devotionDueDay < 0 &&
      sameFaction(target, place) &&
      town.settlementOf(target) === village
    )
      praying.add(target.id);
  }
  return pending + praying.size;
}
function altarReason(town: DevotionTown, id: number, personId = -1, checkFood = true): string {
  const place = town.building(id);
  if (!altar(place)) return 'Complete an altar first.';
  if (!belongsToFaction(place, town.controlFaction)) return 'This altar belongs to another settlement.';
  const camp = town.camp(town.settlementOf(place));
  if (!camp?.built() || !sameFaction(camp, place)) return 'Complete a camp for this altar.';
  if (place.devotionDueDay >= 0) return 'A resident is waiting for an available home.';
  if (
    town.folk.some(
      (p) => p.id !== personId && p.health > 0 && p.task === Activity.Praying && p.taskSite === id,
    )
  )
    return 'A resident is already preparing this altar.';
  if (localResidents(town, place) + reservedHomes(town, place, personId) >= localHousing(town, place))
    return 'No free resident bed. Complete a home in this settlement.';
  if (checkFood && town.stock(camp.id).food < 4) return 'Need 4 food for the altar offering.';
  return '';
}
export function altarStatus(this: DevotionTown, id: number): AltarStatus {
  const place = this.building(id);
  return {
    reason: altarReason(this, id),
    pendingBirths: altar(place) && place.devotionDueDay >= 0 ? 1 : 0,
    dueDay: altar(place) ? place.devotionDueDay : -1,
    cost: new Resources(0, 0, 0, 4),
  };
}
export function altarOfferingReason(this: DevotionTown, id: number, offering: Resources): string {
  const invalid = offeringReason(offering);
  if (invalid) return invalid;
  const reason = altarReason(this, id, -1, false);
  if (reason) return reason;
  const place = this.building(id)!;
  if (!this.folk.some(p => canControl(p, this.controlFaction) && sameFaction(p, place) &&
    this.settlementOf(p) === this.settlementOf(place) && p.activity !== Activity.Expedition))
    return 'An available resident must be present in this settlement.';
  if (!this.stock(this.settlementOf(place)).covers(offering)) return 'The settlement does not have enough resources for this offering.';
  return '';
}
/** The presentation calls this once at transformation, while the world is paused.
 * Validation, payment and arrival are atomic. Closing before transformation costs nothing. */
export function summonFromOffering(this: DevotionTown, id: number, offering: Resources): Person | null {
  if (altarOfferingReason.call(this, id, offering)) return null;
  const place = this.building(id)!, village = this.settlementOf(place),
    outcome = offeringOutcome(offering, () => this.roll());
  const born = this.makePerson(Role.Resident, outcome.calling, this.grid.nearestWalkable(place.door()));
  born.faction = place.faction;
  born.village = village;
  born.faith = place.faith;
  born.level = outcome.level;
  born.trained = outcome.calling !== Calling.Settler;
  born.past = 'Shaped from an offering before the statue of Ymir.';
  born.food = born.rest = born.hydration = born.health = 1;
  born.stress = 0;
  born.purse = 0;
  born.inventory.fill(null);
  born.equipment = emptyEquipment();
  this.stock(village).subtract(offering);
  this.folk.push(born);
  this.altarEvents.push({ serial: this.nextDevotionEvent++, altar: id, person: born.id,
    at: this.time, position: { ...born.position } });
  this.assignHomes();
  this.staff();
  this.recordReceipt(new CampReceipt(0n, village, new Resources(), 0, 0, 1));
  this.notify(born.name + ' is shaped by the offering and joins the settlement.');
  ++this.changes;
  return born;
}
export function prayerReason(this: DevotionTown, personId: number, altarId: number): string {
  const p = this.person(personId),
    place = this.building(altarId);
  if (!canControl(p, this.controlFaction))
    return p?.role === Role.Guest
      ? 'Guests cannot pray for a new resident.'
      : 'Choose an available resident of this settlement.';
  if (!place || !sameFaction(p, place) || this.settlementOf(p) !== this.settlementOf(place))
    return "Choose a resident who lives in this altar's settlement.";
  return altarReason(this, altarId, personId);
}
export function orderPrayAtAltar(this: DevotionTown, ids: number[], altarId: number): boolean {
  const place = this.building(altarId);
  if (!place) return false;
  for (const id of ids) {
    const p = this.person(id);
    if (!p || this.prayerReason(id, altarId) || !this.walkTo(p, place.door())) continue;
    this.setOrder(p, Activity.Praying, altarId);
    p.trainingCalling = -1;
    p.aggressive = false;
    p.activity = Activity.Praying;
    if (!p.moving()) this.arrive(p);
    ++this.changes;
    return true; // One completed offering creates one resident at this altar.
  }
  return false;
}
/** Both ceremonies use the ordinary doorway, needs interruption, and saved direct-order lifecycle. */
export function resumeDevotionOrder(this: DevotionTown, p: Person): boolean {
  if (p.task !== Activity.Praying && p.task !== Activity.Training) return false;
  const reason =
    p.task === Activity.Praying
      ? this.prayerReason(p.id, p.taskSite)
      : this.trainingReason(p.id, p.taskSite, p.trainingCalling);
  const place = this.building(p.taskSite);
  if (reason || !place) {
    finishCeremony(this, p);
    if (reason) this.notify(reason);
    return true;
  }
  if (!this.walkTo(p, place.door())) {
    p.path = [];
    p.activity = Activity.Holding;
    p.until = this.time + 1;
    return true;
  }
  p.activity = p.task;
  p.target = place.id;
  if (!p.moving()) this.arrive(p);
  return true;
}
export function finishCeremony(town: TownState, p: Person): void {
  p.task = Activity.Idle;
  p.taskSite = -1;
  p.trainingCalling = -1;
  p.autoMode = true;
  p.ordered = p.aggressive = p.approachingOrder = false;
  p.activity = Activity.Idle;
  p.target = -1;
  p.path = [];
  p.inside = false;
  p.until = town.time;
}
export function completeAltarPrayer(this: DevotionTown, p: Person): boolean {
  if (
    p.task !== Activity.Praying ||
    p.activity !== Activity.Praying ||
    p.target !== p.taskSite ||
    p.crossingDoorway() ||
    p.moving() ||
    this.time < p.until
  )
    return false;
  const place = this.building(p.taskSite),
    reason = this.prayerReason(p.id, p.taskSite);
  if (place && distance(p.position, place.door()) > 0.05) return false;
  if (reason || !altar(place)) {
    finishCeremony(this, p);
    if (reason) this.notify(reason);
    return false;
  }
  this.stock(this.settlementOf(place)).food -= 4;
  place.devotionDueDay = this.days;
  p.prayedAt = this.time;
  finishCeremony(this, p);
  this.processDevotion();
  ++this.changes;
  return true;
}
export function processDevotion(this: DevotionTown): void {
  for (const place of [...this.placed].sort((a, b) => a.id - b.id)) {
    if (
      !altar(place) ||
      !belongsToFaction(place, this.controlFaction) ||
      place.devotionDueDay < 0 ||
      place.devotionDueDay > this.days
    )
      continue;
    const village = this.settlementOf(place),
      camp = this.camp(village);
    if (
      !camp?.built() ||
      !sameFaction(camp, place) ||
      localResidents(this, place) >= localHousing(this, place)
    )
      continue;
    const born = this.makePerson(Role.Resident, Calling.Settler, this.grid.nearestWalkable(place.door()));
    born.faction = place.faction;
    born.village = village;
    born.faith = place.faith;
    born.past = 'Called into the world by a prayer at the settlement altar.';
    born.food = born.rest = born.hydration = born.health = 1;
    born.stress = 0;
    born.autoMode = true;
    this.folk.push(born);
    this.altarEvents = this.altarEvents.filter((event) => this.time - event.at <= 3);
    this.altarEvents.push({
      serial: this.nextDevotionEvent++, altar: place.id, person: born.id,
      at: this.time, position: { ...born.position },
    });
    place.devotionDueDay = -1;
    this.assignHomes();
    this.staff();
    this.recordReceipt(new CampReceipt(0n, village, new Resources(), 0, 0, 1));
    this.notify(born.name + ' appears at the altar and joins the settlement.');
    ++this.changes;
  }
}
