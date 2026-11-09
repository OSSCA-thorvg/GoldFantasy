// Town keeps native storage and method names. Implementations are split along native translation units.
import { TownState } from './town-state';
import { WorldMap } from './world-map';
import { Building } from './town-models';
import { Role, Calling, Race, Person } from './person';
import { Structure, isSeat, structureSpec } from './building-catalog';
import { Point, point, add } from './geometry';
import { f32 } from './numeric';
import { copyNative } from './native-copy';
import { founderAppearance } from './person-look';
import { birthNotice, foundingPeople } from './ymir-born';
import * as construction from './town-construction';
import * as supplies from './construction-work';
import * as roadConstruction from './road-construction';
import * as orders from './unit-orders';
import * as scheduler from './unit-scheduler';
import * as needs from './unit-needs';
import * as housing from './unit-housing';
import * as residents from './town-residents';
import * as harvesting from './resource-harvesting';
import * as people from './town-people';
import * as ticking from './town-tick';
import * as combat from './town-monsters';
import * as encounters from './town-encounters';
import * as giants from './town-giants';
import * as wildlife from './town-wildlife';
import * as status from './unit-status';
import * as economy from './town-economy';
import * as settlements from './town-settlements';
import * as title from './title-autoplay';
const { population: scopedPopulation, guests: scopedGuests, housing: scopedHousing, guestBeds: scopedGuestBeds, fieldAcres: scopedFields, tendedFieldAcres: scopedTended, roadSettlement: scopedRoadSettlement, ...settlementMethods } = settlements;
const { fieldAcres: totalFields, tendedFieldAcres: totalTended, ...economyMethods } = economy;
const methods = { ...supplies, ...construction, ...roadConstruction, ...orders, ...scheduler, ...needs, ...housing, ...residents, ...harvesting, ...people, ...ticking, ...combat, ...encounters, ...giants, ...wildlife, ...status, ...economyMethods, ...settlementMethods, ...title };
type Bound<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : never };
export interface Town extends Bound<typeof methods> {}
export class Town extends TownState {
  // `preview` is the native MapPreview overload. `founders=false` still builds navigation.
  constructor(mapOrSeed: WorldMap | number = 5, mapSize = 176, founders = true, preview = false) {
    super(typeof mapOrSeed === 'number' ? WorldMap.generate(mapOrSeed, mapSize, mapSize) : copyNative(mapOrSeed));
    if (preview) return;
    this.grid.rebuild(this.world, this.network, []);
    if (!founders) return;
    const start = this.world.camp(), gathered = [point(), point(.8, .4)];
    for (let i = 0; i < gathered.length; ++i) { const founder = this.makePerson(Role.Resident, Calling.Settler, add(start, gathered[i])); founder.name = foundingPeople[i].name; founder.race = Race.Human; founder.past = foundingPeople[i].past; founder.customLook = founderAppearance(founder, foundingPeople[i].bodyType); this.folk.push(founder); }
    this.notify(birthNotice);
  }
  camp(id?: number): Building | null { return id === undefined ? this.placed.find(item => isSeat(item.kind)) ?? null : settlements.campById.call(this, id); }
  population(id?: number): number { return id === undefined ? this.folk.filter(p => p.role === Role.Resident).length : scopedPopulation.call(this, id); }
  guests(id?: number): number { return id === undefined ? this.folk.length - this.population() : scopedGuests.call(this, id); }
  housing(id?: number): number { return id === undefined ? this.placed.reduce((n, b) => n + (b.built() ? structureSpec(b.kind).residents : 0), 0) : scopedHousing.call(this, id); }
  guestBeds(id?: number): number { return id === undefined ? this.placed.reduce((n, b) => n + (b.built() ? structureSpec(b.kind).beds : 0), 0) : scopedGuestBeds.call(this, id); }
  fieldAcres(id?: number): number { return id === undefined ? totalFields.call(this) : scopedFields.call(this, id); }
  tendedFieldAcres(id?: number): number { return id === undefined ? totalTended.call(this) : scopedTended.call(this, id); }
  roadSettlement(path: Parameters<typeof scopedRoadSettlement>[0], ignore = -1): number { return scopedRoadSettlement.call(this, path, ignore); }
  gold(): number { return this.stock().gold; } wood(): number { return this.stock().wood; } idle(): number { return this.population() - this.employed(); }
  editHour(hour: number): boolean { if (!Number.isFinite(hour) || hour < 0 || hour >= 24) return false; this.time = this.days * TownState.secondsPerDay + hour / 24 * TownState.secondsPerDay; this.sky.previewTime(this.yearFraction(), this.dayFraction()); return true; }
  scout(x: number, y: number, radius: number): void { this.reveal(f32(x), f32(y), f32(radius)); ++this.changes; }
}
Object.assign(Town.prototype, methods);
