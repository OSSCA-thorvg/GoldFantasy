import rows from '../data/building-catalog.json';
import { f32 } from './numeric';
export enum Structure { Camp, Tent, Cottage, Townhouse, Manor, MarketStalls, MarketHall, Bazaar, Farm, Lumberyard, Quarry, Well, Storehouse, Shrine, MageTower, Portal, Tavern, Hostel, Inn, GrandInn, Guild, GuildHall, Chapel, Weaponsmith, Armorer, Apothecary, Palisade, Keep, Castle, Torch, Count }
export class Resources {
  constructor(public gold = 0, public wood = 0, public stone = 0, public food = 0, public mana = 0, public water = 0) {}
  covers(cost: Resources): boolean { return this.gold >= cost.gold && this.wood >= cost.wood && this.stone >= cost.stone && this.food >= cost.food && this.mana >= cost.mana && this.water >= cost.water; }
  add(other: Resources): this { this.gold += other.gold; this.wood += other.wood; this.stone += other.stone; this.food += other.food; this.mana += other.mana; this.water += other.water; return this; }
  subtract(other: Resources): this { this.gold -= other.gold; this.wood -= other.wood; this.stone -= other.stone; this.food -= other.food; this.mana -= other.mana; this.water -= other.water; return this; }
  empty(): boolean { return !this.gold && !this.wood && !this.stone && !this.food && !this.mana && !this.water; }
  clone(): Resources { return new Resources(this.gold, this.wood, this.stone, this.food, this.mana, this.water); }
}
export enum GrowthNeed { None, Food, Market, Workers, Merge, Population, Occupancy, Income, Registry }
export enum Faith { Dawn, Grove, Forge, Moon, Count }
export enum Product { None, Food, Wood, Stone, Goods, Mana, Water }
export interface StructureSpec { name: string; description: string; size: number; cost: Resources; residents: number; jobs: number; requiredPopulation: number; buildable: boolean; product: Product; perWorker: number; next: Structure; growthDays: number; need: GrowthNeed; needAmount: number; upgradeCost: Resources; beds: number; storage: number; }
const resource = (r: { gold: number; wood: number; stone: number; food: number; mana: number; water: number }): Resources => new Resources(r.gold, r.wood, r.stone, r.food, r.mana, r.water);
const specs: StructureSpec[] = rows.map(row => ({ ...row, cost: resource(row.cost), upgradeCost: resource(row.upgradeCost) }));
export const structureSpec = (kind: Structure): StructureSpec => specs[kind];
export const isSeat = (kind: Structure): boolean => kind === Structure.Camp || kind === Structure.Palisade || kind === Structure.Keep || kind === Structure.Castle;
export const isHome = (kind: Structure): boolean => isSeat(kind) || kind === Structure.Tent || kind === Structure.Cottage || kind === Structure.Townhouse || kind === Structure.Manor;
export const isMarket = (kind: Structure): boolean => kind === Structure.MarketStalls || kind === Structure.MarketHall || kind === Structure.Bazaar;
export const isLodging = (kind: Structure): boolean => kind === Structure.Hostel || kind === Structure.Inn || kind === Structure.GrandInn;
export const isOutfitter = (kind: Structure): boolean => kind === Structure.Weaponsmith || kind === Structure.Armorer || kind === Structure.Apothecary;
export function rentOf(kind: Structure): number { switch (kind) { case Structure.Tent: return 1; case Structure.Cottage: return 2; case Structure.Townhouse: return 3; case Structure.Manor: return 6; default: return 0; } }
export function priceOf(kind: Structure): number { switch (kind) { case Structure.Tent: return 25; case Structure.Cottage: return 70; case Structure.Townhouse: return 140; case Structure.Manor: return 450; default: return 0; } }
export const faithName = (faith: Faith): string => ['Order of the Dawn', 'Grove Mother', 'Forge Father', 'Wild Moon'][faith] || '';
export function buildWork(kind: Structure): number { const cost = structureSpec(kind).cost; return f32(8 + f32(f32(f32(cost.wood + cost.stone) + f32(cost.gold / 2)) * f32(.6))); }
export function describe(value: Resources): string { const parts: string[] = []; for (const key of ['gold', 'wood', 'stone', 'food', 'mana', 'water'] as const) if (value[key]) parts.push(`${value[key]} ${key}`); return parts.join(', ') || 'free'; }
export interface Rgb { r: number; g: number; b: number; }
export interface Stage { kind: Structure; variant: number; dx: number; dy: number; }
