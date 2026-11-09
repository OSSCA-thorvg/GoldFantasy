// Translated from src/game/camp_economy.cpp.
import { TownState } from './town-state';
import { Building } from './town-models';
import { Resources, Structure, isSeat, structureSpec } from './building-catalog';
import { Person, Role } from './person';
import { CampEconomy, CampReceipt, type Ledger } from './camp-economy';
import { distance, centroid, type Point } from './geometry';
import { clamp, f32 as f, lround } from './numeric';
import { Road, flatten, type RoadPath } from './road-network';
export interface SettlementTown extends TownState {
  camp(id?: number): Building | null;
  settlementOf(item: Building | Person): number;
  settlementAt(at: Point): number;
  settlement(id: number): CampEconomy;
  economy(id: number): CampEconomy;
  reserves(id: number): Resources;
  foundSettlement(id: number): void;
  recordReceipt(receipt: CampReceipt): void;
  credit(gain: Resources, id: number): void;
  fieldAcres(id?: number): number;
  connectRoad(road: Road): boolean;
}
export function campById(this: TownState, id: number): Building | null {
  const b = this.building(id);
  return b && isSeat(b.kind) ? b : null;
}
export function settlementAt(this: TownState, at: Point): number {
  let result = -1,
    best = 3.4028234663852886e38;
  for (const b of this.placed)
    if (isSeat(b.kind)) {
      const gap = distance(at, b.center);
      if (gap < best) {
        best = gap;
        result = b.id;
      }
    }
  return result;
}
export function settlementOf(this: SettlementTown, item: Building | Person): number {
  if (item instanceof Building) {
    if (isSeat(item.kind)) return item.id;
    return this.camp(item.village) ? item.village : this.settlementAt(item.center);
  }
  const home = this.building(item.role === Role.Resident ? item.home : item.bed);
  if (home) return this.settlementOf(home);
  if (this.camp(item.village)) return item.village;
  const work = this.building(item.job);
  if (work) return this.settlementOf(work);
  return this.settlementAt(item.position);
}
const empty = new CampEconomy();
empty.renown = 0;
export function settlement(this: TownState, id: number): CampEconomy {
  return id < 0 ? this.provisions : (this.villages.find((village) => village.camp === id) ?? empty);
}
export function economy(this: TownState, id: number): CampEconomy {
  if (id < 0) return this.provisions;
  const village = this.villages.find((village) => village.camp === id);
  if (!village) throw new Error('Missing camp stockpile');
  return village;
}
export function reserves(this: SettlementTown, id: number): Resources {
  return this.economy(id).stock;
}
export function stock(this: SettlementTown, id = this.camp()?.id ?? -1): Resources {
  return this.settlement(id).stock;
}
export function renown(this: SettlementTown, id = this.camp()?.id ?? -1): number {
  return lround(this.settlement(id).renown);
}
export function parched(this: SettlementTown, id = this.camp()?.id ?? -1): boolean {
  return this.settlement(id).parched;
}
export function ledger(this: SettlementTown, id = this.camp()?.id ?? -1): Ledger {
  return this.settlement(id).yesterday;
}
export function changeRenown(this: SettlementTown, id: number, amount: number): void {
  const village = this.economy(id),
    before = lround(village.renown);
  village.renown = clamp(f(village.renown + f(amount)), 0, 100);
  this.recordReceipt(
    new CampReceipt(0n, id, new Resources(), 0, Math.max(0, lround(village.renown) - before)),
  );
}
export function foundSettlement(this: SettlementTown, id: number): void {
  let village = new CampEconomy();
  if (!this.villages.length) {
    village = this.provisions;
    this.provisions = new CampEconomy();
  }
  village.camp = id;
  this.villages.push(village);
  for (const p of this.folk) if (p.village < 0) p.village = this.settlementAt(p.position);
}
export function migrateSettlements(this: SettlementTown): void {
  this.villages = [];
  for (const b of this.placed) if (isSeat(b.kind)) this.foundSettlement(b.id);
  for (const b of this.placed) b.village = this.settlementAt(b.center);
  for (const road of this.network.roads())
    road.village = this.settlementAt(road.along(road.constructionStart));
  for (const field of this.farmland) field.village = this.settlementAt(centroid(field.outline));
  for (const p of this.folk) p.village = this.settlementOf(p);
}
export function credit(this: SettlementTown, gain: Resources, id: number): void {
  const current = this.reserves(id),
    received = new Resources();
  for (const key of ['gold', 'wood', 'stone', 'food', 'water', 'mana'] as const) {
    const before = current[key];
    current[key] = clamp(current[key] + gain[key], 0, 2147483647);
    received[key] = Math.max(0, current[key] - before);
  }
  this.recordReceipt(new CampReceipt(0n, id, received));
}
export function recordReceipt(this: SettlementTown, receipt: CampReceipt): void {
  if (
    !this.camp(receipt.camp) ||
    (receipt.gain.empty() && receipt.renown <= 0 && receipt.residents <= 0 && receipt.guests <= 0)
  )
    return;
  this.deliveries = this.deliveries.filter((item) => !(item.at + 3 < this.time));
  if (this.deliveries.length >= 256) this.deliveries.splice(0, this.deliveries.length - 255);
  const copy = new CampReceipt(
    this.nextReceipt,
    receipt.camp,
    receipt.gain.clone(),
    this.time,
    receipt.renown,
    receipt.residents,
    receipt.guests,
  );
  this.nextReceipt = BigInt.asUintN(64, this.nextReceipt + 1n);
  this.deliveries.push(copy);
}
export function reward(this: SettlementTown, prize: Resources, id = this.camp()?.id ?? -1): void {
  this.credit(prize, id);
}
export function population(this: SettlementTown, id: number): number {
  return this.folk.filter((p) => p.role === Role.Resident && this.settlementOf(p) === id).length;
}
export function guests(this: SettlementTown, id: number): number {
  return this.folk.filter((p) => p.role === Role.Guest && this.settlementOf(p) === id).length;
}
export function housing(this: SettlementTown, id: number): number {
  let total = 0;
  for (const b of this.placed)
    if (b.built() && this.settlementOf(b) === id) total += structureSpec(b.kind).residents;
  return total;
}
export function guestBeds(this: SettlementTown, id: number): number {
  let total = 0;
  for (const b of this.placed)
    if (b.built() && this.settlementOf(b) === id) total += structureSpec(b.kind).beds;
  return total;
}
export function fieldAcres(this: TownState, id: number): number {
  let total = 0;
  for (const field of this.farmland) if (field.village === id) total += field.acres();
  return total;
}
export function tendedFieldAcres(this: SettlementTown, id: number): number {
  let total = 0;
  for (const b of this.placed)
    if (b.built() && b.kind === Structure.Farm && this.settlementOf(b) === id)
      total = f(total + f(f(b.workers * b.attendance) * structureSpec(b.kind).perWorker));
  return Math.min(lround(total), this.fieldAcres(id));
}
export function roadSettlement(this: SettlementTown, path: RoadPath, ignore: number): number {
  const existing = this.network.road(ignore);
  if (existing && existing.village >= 0) return existing.village;
  const probe = new Road(-1, path, flatten(path, f(0.2)));
  return this.connectRoad(probe) ? probe.village : -1;
}
