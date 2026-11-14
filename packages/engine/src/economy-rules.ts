import { Product, Structure } from './building-catalog';
import { Calling, type Person } from './person';

/** Tunable numbers for wages, market trade and mage tower rites. */
export const economyRules = {
  wage: 3,
  /** A resident earns one more gold a day for every this many levels above the first. */
  levelsPerRaise: 5,
  /** Extra daily gold for a resident sworn to a calling (anything but settler or traveller). */
  swornWage: 1,
  /** Prices swing by up to this share either way from day to day. */
  dailySwing: 0.15,
  winterFood: 1.3,
  autumnFood: 0.85,
  /** Mana price of each rite. */
  wardMana: 10,
  mendingMana: 8,
  farsightMana: 5,
  /** Share of full health a mending restores. */
  mendingHealth: 0.4,
  /** Tiles revealed around a gate found by farsight. */
  farsightRadius: 3,
  /** Residents eat one food in about this many days (see `forecast`). */
  daysPerMeal: 7.5,
};
/** Goods a market buys and sells, in the order the HUD lists them. */
export const tradedProducts = [Product.Wood, Product.Stone, Product.Food, Product.Planks, Product.CutStone] as const;
/** Gold value of one unit before the market, the day and the season. */
export function basePrice(product: Product): number {
  switch (product) {
    case Product.Wood:
    case Product.Stone:
      return 3;
    case Product.Food:
      return 5;
    case Product.Planks:
      return 8;
    case Product.CutStone:
      return 9;
    default:
      return 0;
  }
}
export interface MarketTier {
  kind: Structure;
  /** Multiplier on what the settlement pays when buying, and receives when selling. */
  buy: number;
  sell: number;
  /** Units the market moves per day, bought and sold together. */
  volume: number;
}
/** Better markets buy cheaper, sell dearer and move more goods. */
export const marketTiers: readonly MarketTier[] = [
  { kind: Structure.MarketStalls, buy: 1, sell: 0.45, volume: 20 },
  { kind: Structure.MarketHall, buy: 0.9, sell: 0.5, volume: 40 },
  { kind: Structure.Bazaar, buy: 0.8, sell: 0.55, volume: 80 },
];
export const marketTier = (kind: Structure): MarketTier | null => marketTiers.find((tier) => tier.kind === kind) ?? null;
export const swornCalling = (person: Person): boolean =>
  person.calling !== Calling.Settler && person.calling !== Calling.Traveller;
