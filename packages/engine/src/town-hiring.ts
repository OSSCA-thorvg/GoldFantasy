import { TownState } from './town-state';
import { Person, Role, Calling, Race, Activity, callingName } from './person';
import { Resources, Faith } from './building-catalog';
import { CampReceipt } from './camp-economy';
import { copyNative } from './native-copy';
import { add, point, rotated, type Point } from './geometry';
import type { Building } from './town-models';

export interface HireOffer {
  key: string;
  person: Person;
  cost: Resources;
  existing: boolean;
  village: number;
}
interface HiringTown extends TownState {
  camp(id?: number): Building | null;
  population(village?: number): number;
  housing(village?: number): number;
  stock(village?: number): Resources;
  settlementOf(person: Person): number;
  assignHomes(): void;
  staff(): void;
  recordReceipt(receipt: CampReceipt): void;
  enforceGuestLodging(person: Person): void;
  recruitmentOffers(village?: number): HireOffer[];
  recruitmentReason(offer: HireOffer): string;
}
const names = [
  'Runa',
  'Leif',
  'Astrid',
  'Einar',
  'Freydis',
  'Soren',
  'Ingrid',
  'Torsten',
  'Alva',
  'Sten',
  'Yrsa',
  'Kjell',
];
const bynames = [
  'Ashsong',
  'Stonehand',
  'Oakheart',
  'Dawnwalker',
  'Reedward',
  'Ironbough',
  'Ravencrest',
  'Frostmere',
];
const callings = [
  Calling.Settler,
  Calling.Warrior,
  Calling.Ranger,
  Calling.Mage,
  Calling.Cleric,
  Calling.Bard,
];
function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
function costOf(p: Person): Resources {
  return new Resources(
    p.calling === Calling.Settler || p.calling === Calling.Traveller ? 12 : 20 + p.level * 6,
    0,
    0,
    p.calling === Calling.Settler || p.calling === Calling.Traveller ? 4 : 6,
  );
}
/** Offers are derived from saved identity state, without advancing the world RNG.
 * Browsing or loading a save cannot reroll a candidate or charge the treasury. */
export function recruitmentOffers(this: HiringTown, village = -1): HireOffer[] {
  const seat = village < 0 ? this.camp() : this.camp(village);
  const at = seat?.door() ?? this.world.camp();
  const existing = this.folk
    .filter((p) => p.role === Role.Guest && p.health > 0 && p.activity !== Activity.Leaving)
    .map((person) => ({
      key: `guest:${person.id}`,
      person,
      cost: costOf(person),
      existing: true,
      village: this.settlementOf(person),
    }));
  return existing.concat(
    callings.map((calling, slot) => {
      const seed = mix(
        this.world.seed() ^ Math.imul(this.nextPerson + 1, 0x9e3779b1) ^ Math.imul(slot + 1, 0x85ebca6b),
      );
      const person = new Person(
        -slot - 1,
        `${names[seed % names.length]} ${bynames[(seed >>> 8) % bynames.length]}`,
        Role.Guest,
        calling,
        Race.Human,
        seed % 1000000,
        { ...at },
      );
      person.level = calling === Calling.Settler ? 1 : 1 + ((seed >>> 16) % 3);
      person.food = person.rest = person.health = 1;
      person.stress = 0;
      person.faith = person.look % Faith.Count;
      person.purse = 10;
      person.village = seat?.id ?? -1;
      person.past = [
        'A steady hand seeking a hearth and honest work.',
        'A shield sworn to defend a new home.',
        'A patient scout of the old forest paths.',
        'A keeper of runes and forgotten lore.',
        'A healer guided by the light of the old gods.',
        'A wanderer carrying songs from distant halls.',
      ][slot];
      return {
        key: `new:${this.nextPerson}:${seat?.id ?? -1}:${slot}`,
        person,
        cost: costOf(person),
        existing: false,
        village: seat?.id ?? -1,
      };
    }),
  );
}
export function recruitmentReason(this: HiringTown, offer: HireOffer): string {
  const seat = offer.village < 0 ? this.camp() : this.camp(offer.village);
  if (!seat?.built()) return 'Complete a camp before offering a home.';
  if (this.population(seat.id) >= this.housing(seat.id))
    return 'No free resident bed. Build or complete a tent.';
  const stock = this.stock(seat.id);
  if (stock.gold < offer.cost.gold) return `Need ${offer.cost.gold} gold to sign this oath.`;
  if (stock.food < offer.cost.food) return `Need ${offer.cost.food} food for the welcome supplies.`;
  return '';
}
export function hireGuest(this: HiringTown, key: string): boolean {
  const village = key.startsWith('new:') ? Number(key.split(':')[2]) : -1;
  if (!Number.isInteger(village)) return false;
  const offer = this.recruitmentOffers(village).find((item) => item.key === key);
  if (!offer || this.recruitmentReason(offer)) return false;
  const seat = offer.village < 0 ? this.camp()! : this.camp(offer.village)!;
  const person = offer.existing ? offer.person : copyNative(offer.person);
  this.stock(seat.id).subtract(offer.cost);
  if (!offer.existing) {
    person.id = this.nextPerson++;
    const entry: Point = this.grid.nearestWalkable(
      add(seat.door(), rotated(point(0.65, 0), person.id * 2.399963)),
    );
    person.position = entry;
    this.folk.push(person);
  }
  person.role = Role.Resident;
  if (person.calling === Calling.Traveller) person.calling = Calling.Settler;
  person.village = seat.id;
  person.autoMode = true;
  this.enforceGuestLodging(person);
  if (!person.inside && !person.crossingDoorway()) {
    person.activity = person.task = Activity.Idle;
    person.target = person.taskSite = -1;
    person.ordered = false;
    person.path = [];
  }
  this.assignHomes();
  this.staff();
  this.recordReceipt(new CampReceipt(0n, seat.id, new Resources(), 0, 0, 1));
  this.notify(`${person.name}, ${callingName(person.calling)}, has sworn an oath to the settlement.`);
  ++this.changes;
  return true;
}
