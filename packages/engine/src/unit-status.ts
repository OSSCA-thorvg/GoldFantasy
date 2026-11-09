import { TownState } from './town-state';
import { Person, Role } from './person';
import { Weather } from './climate';
import { f32 as f } from './numeric';
export enum Condition { Hungry, Starving, Exhausted, Thirsty, Cold, Soaked, SnowedOn, SleptOutside, NoHome, Unpaid, ShortOfCoin, NoGuestBed, Relaxed, Wounded, Distressed, Content }
const names = ['Hungry', 'Starving', 'Exhausted', 'Thirsty', 'Cold', 'Soaked', 'Snowed on', 'Slept outside', 'No home', 'Unpaid', 'Short of coin', 'No bed at an inn', 'Enjoyed the tavern', 'Wounded', 'Breaking down', 'Content'];
export const conditionName = (condition: Condition): string => names[condition];
export const positiveCondition = (condition: Condition): boolean => condition === Condition.Relaxed || condition === Condition.Content;
export interface StatusTown extends TownState { parched(id?: number): boolean; settlementOf(p: Person): number; conditions(p: Person): Condition[]; }
export function conditions(this: StatusTown, p: Person): Condition[] { const sky = this.climate(), out: Condition[] = []; if (p.food < f(.1)) out.push(Condition.Starving); else if (p.food < f(.3)) out.push(Condition.Hungry); if (p.rest < f(.2)) out.push(Condition.Exhausted); if (this.parched(this.settlementOf(p))) out.push(Condition.Thirsty); if (!p.inside && sky.temperature < 2) out.push(Condition.Cold); if (!p.inside && sky.precipitating()) out.push(sky.weather === Weather.Snow ? Condition.SnowedOn : Condition.Soaked); if (p.sleptOutside) out.push(Condition.SleptOutside); if (p.role === Role.Resident && p.home < 0) out.push(Condition.NoHome); if (p.unpaid) out.push(p.purse < 3 ? Condition.ShortOfCoin : Condition.Unpaid); if (p.role === Role.Guest && p.bed < 0) out.push(Condition.NoGuestBed); if (this.time - p.relaxedAt < TownState.secondsPerDay) out.push(Condition.Relaxed); if (p.health < f(.6)) out.push(Condition.Wounded); if (p.stress >= f(.85)) out.push(Condition.Distressed); if (!out.length) out.push(Condition.Content); return out; }
export function thoughts(this: StatusTown, p: Person): string[] { return this.conditions(p).map(conditionName); }
