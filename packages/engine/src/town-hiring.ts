import { TownState } from './town-state';
import { Person, Role, Calling, Activity, callingName } from './person';
import { Resources, Structure } from './building-catalog';
import type { Building } from './town-models';
import type { Point } from './geometry';
import { canControl, sameFaction, belongsToFaction } from './faction';
import { finishCeremony } from './town-devotion';

/** Compatibility only: lodging visitors and generated offers cannot be hired. */
export interface HireOffer {
  key: string;
  person: Person;
  cost: Resources;
  existing: boolean;
  village: number;
}
export function recruitmentOffers(this: TownState, _village = -1): HireOffer[] {
  return [];
}
export function recruitmentReason(this: TownState, _offer: HireOffer): string {
  return 'Guests are temporary visitors. New residents arrive through an altar prayer.';
}
export function hireGuest(this: TownState, _key: string): boolean {
  return false;
}

export interface GuildTrainingOption {
  calling: Calling;
  name: string;
  description: string;
  cost: Resources;
  reason: string;
}
export interface TrainingTown extends TownState {
  settlementOf(item: Person | Building): number;
  stock(village?: number): Resources;
  walkTo(p: Person, at: Point): boolean;
  setOrder(p: Person, task: Activity, site?: number): void;
  arrive(p: Person): void;
  trainingReason(personId: number, guildId: number, calling: Calling): string;
}
const professions: readonly { calling: Calling; description: string }[] = [
  { calling: Calling.Warrior, description: 'A close-combat profession. Equip a crafted weapon for stronger attacks.' },
  { calling: Calling.Ranger, description: 'A ranged-combat profession. Equip a crafted bow to attack from a distance.' },
  { calling: Calling.Mage, description: 'A rune-casting profession. Equip a crafted staff to attack from a distance.' },
  { calling: Calling.Cleric, description: 'A sworn guardian who fights at close range.' },
  { calling: Calling.Bard, description: 'A keeper of songs who can fight at close range.' },
];
function guild(place: Building | null): place is Building {
  return (
    !!place &&
    (place.kind === Structure.Guild || place.kind === Structure.GuildHall) &&
    place.built() &&
    place.health > 0
  );
}
export function guildTrainingOptions(
  this: TrainingTown,
  personId: number,
  guildId: number,
): GuildTrainingOption[] {
  return professions.map(({ calling, description }) => ({
    calling,
    name: callingName(calling),
    description,
    cost: new Resources(12, 0, 0, 4),
    reason: this.trainingReason(personId, guildId, calling),
  }));
}
export function trainingReason(
  this: TrainingTown,
  personId: number,
  guildId: number,
  calling: Calling,
): string {
  const p = this.person(personId),
    place = this.building(guildId);
  if (!guild(place)) return 'Complete a guild first.';
  if (!belongsToFaction(place, this.controlFaction)) return 'This guild belongs to another settlement.';
  if (!canControl(p, this.controlFaction))
    return p?.role === Role.Guest
      ? 'Guests cannot train or become residents.'
      : 'Choose an available resident of this settlement.';
  if (!sameFaction(p, place) || this.settlementOf(p) !== this.settlementOf(place))
    return "Choose a resident who lives in this guild's settlement.";
  if (p.trained || p.calling !== Calling.Settler) return 'This resident has already chosen a profession.';
  if (!professions.some((option) => option.calling === calling)) return 'Choose a guild profession.';
  const stock = this.stock(this.settlementOf(place));
  if (stock.gold < 12) return 'Need 12 gold for the professional oath.';
  if (stock.food < 4) return 'Need 4 food for the training supplies.';
  return '';
}
export function orderTrainAtGuild(
  this: TrainingTown,
  personId: number,
  guildId: number,
  calling: Calling,
): boolean {
  const p = this.person(personId),
    place = this.building(guildId);
  if (!p || !place || this.trainingReason(personId, guildId, calling) || !this.walkTo(p, place.door()))
    return false;
  this.setOrder(p, Activity.Training, guildId);
  p.trainingCalling = calling;
  p.aggressive = false;
  p.activity = Activity.Training;
  if (!p.moving()) this.arrive(p);
  ++this.changes;
  return true;
}
export function completeGuildTraining(this: TrainingTown, p: Person): boolean {
  if (
    p.task !== Activity.Training ||
    p.activity !== Activity.Training ||
    p.target !== p.taskSite ||
    !p.inside ||
    p.crossingDoorway() ||
    p.moving() ||
    this.time < p.until
  )
    return false;
  const calling = p.trainingCalling,
    place = this.building(p.taskSite),
    reason = this.trainingReason(p.id, p.taskSite, calling);
  if (reason || !guild(place)) {
    finishCeremony(this, p);
    if (reason) this.notify(reason);
    return false;
  }
  this.stock(this.settlementOf(place)).subtract(new Resources(12, 0, 0, 4));
  p.calling = calling;
  p.trained = true;
  ++place.trainingCount;
  finishCeremony(this, p);
  this.notify(p.name + ' has taken the oath of a ' + callingName(calling) + '.');
  ++this.changes;
  return true;
}
