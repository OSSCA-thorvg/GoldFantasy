import type { Town } from './town';
import { Product, structureSpec } from './building-catalog';
import { Check, Season, type Building } from './town-models';
import { resourceAmount, resourceBundle } from './construction-materials';
import { hash01 } from './numeric';
import { basePrice, economyRules, marketTier, marketTiers, tradedProducts, type MarketTier } from './economy-rules';

export interface TradeOffer {
  product: Product;
  /** Lower-case name for sentences, e.g. "cut stone". */
  name: string;
  /** Gold paid for one unit bought, and received for one unit sold. */
  buy: number;
  sell: number;
  /** Units in store now, and free storage room for buying. */
  stored: number;
  room: number;
}
/** The settlement's best staffed market and how much more it can move today. */
export interface MarketDay {
  market: number;
  name: string;
  limit: number;
  traded: number;
  left: number;
}
const productName = (product: Product): string =>
  ['', 'food', 'wood', 'stone', '', '', '', 'planks', 'cut stone', ''][product] ?? '';
function seasonFactor(product: Product, season: Season): number {
  if (product !== Product.Food) return 1;
  return season === Season.Winter ? economyRules.winterFood : season === Season.Autumn ? economyRules.autumnFood : 1;
}
/** Lowest buying price any market can ever ask; selling stays below it, so there is no arbitrage. */
function floorBuy(product: Product): number {
  const cheapest = Math.min(...marketTiers.map((tier) => tier.buy)),
    season = product === Product.Food ? Math.min(1, economyRules.winterFood, economyRules.autumnFood) : 1;
  return Math.max(1, Math.round(basePrice(product) * cheapest * (1 - economyRules.dailySwing) * season));
}
function prices(town: Town, tier: MarketTier, product: Product): { buy: number; sell: number } {
  const swing = 1 + economyRules.dailySwing * (2 * hash01(town.world.seed(), town.days, product, 431) - 1),
    value = basePrice(product) * swing * seasonFactor(product, town.calendar().season);
  return {
    buy: Math.max(1, Math.round(value * tier.buy)),
    sell: Math.max(0, Math.min(Math.floor(value * tier.sell), floorBuy(product) - 1)),
  };
}
function markets(town: Town, village: number): Building[] {
  const seat = town.camp(village);
  if (!seat) return [];
  return town.placed.filter(
    (b) => marketTier(b.kind) && b.built() && b.faction === seat.faction && town.settlementOf(b) === village,
  );
}
function bestMarket(town: Town, village: number): { market: Building; tier: MarketTier } | null {
  let best: { market: Building; tier: MarketTier } | null = null;
  for (const market of markets(town, village)) {
    const tier = marketTier(market.kind);
    if (tier && market.workers > 0 && (!best || tier.volume > best.tier.volume)) best = { market, tier };
  }
  return best;
}
/** The settlement's staffed market today, or null. */
export function marketDay(this: Town, village: number): MarketDay | null {
  const best = bestMarket(this, village);
  if (!best) return null;
  const traded = this.economy(village).today.traded;
  return {
    market: best.market.id,
    name: structureSpec(best.market.kind).name,
    limit: best.tier.volume,
    traded,
    left: Math.max(0, best.tier.volume - traded),
  };
}
/** What a settlement's market trades today; empty without a staffed market. */
export function tradeOffers(this: Town, village: number): TradeOffer[] {
  const best = bestMarket(this, village);
  if (!best) return [];
  const stock = this.stock(village),
    room = this.capacity(village);
  return tradedProducts.map((product) => ({
    product,
    name: productName(product),
    ...prices(this, best.tier, product),
    stored: resourceAmount(stock, product),
    room: Math.max(0, resourceAmount(room, product) - resourceAmount(stock, product)),
  }));
}
/** Whether buying (`amount` > 0) or selling (`amount` < 0) is possible now; `cost` is the gold or goods given. */
export function canTrade(this: Town, village: number, product: Product, amount: number): Check {
  if (!this.camp(village)) return new Check(false, 'No settlement');
  const best = bestMarket(this, village);
  if (!best)
    return new Check(false, markets(this, village).length ? 'The market needs a worker' : 'Build a market');
  if (!tradedProducts.some((traded) => traded === product)) return new Check(false, 'The market does not trade that');
  if (!Number.isSafeInteger(amount) || amount === 0) return new Check(false, 'Choose an amount to trade');
  const units = Math.abs(amount),
    left = Math.max(0, best.tier.volume - this.economy(village).today.traded),
    price = prices(this, best.tier, product),
    stock = this.stock(village);
  if (units > left) return new Check(false, `The market moves ${best.tier.volume} goods a day (${left} left today)`);
  if (amount > 0) {
    const cost = units * price.buy,
      room = Math.max(0, resourceAmount(this.capacity(village), product) - resourceAmount(stock, product)),
      check = new Check(true);
    check.cost.gold = cost;
    if (stock.gold < cost) return new Check(false, `Needs ${cost} gold`, check.cost);
    if (units > room) return new Check(false, `Not enough room in storage (${room} free)`, check.cost);
    return check;
  }
  const goods = resourceBundle(product, units);
  if (price.sell <= 0) return new Check(false, 'The market will not buy that today', goods);
  const stored = resourceAmount(stock, product);
  if (stored < units) return new Check(false, `Only ${stored} ${productName(product)} in store`, goods);
  return new Check(true, '', goods);
}
/** Buys (`amount` > 0) or sells (`amount` < 0) one product at the market. */
export function trade(this: Town, village: number, product: Product, amount: number): boolean {
  const best = bestMarket(this, village);
  if (!best || !this.canTrade(village, product, amount).ok) return false;
  const price = prices(this, best.tier, product),
    units = Math.abs(amount),
    economy = this.economy(village),
    name = productName(product);
  economy.today.traded += units;
  if (amount > 0) {
    const cost = units * price.buy;
    economy.stock.gold -= cost;
    economy.today.bought += cost;
    this.credit(resourceBundle(product, units), village);
    this.notify(`Bought ${units} ${name} for ${cost} gold`);
  } else {
    const gain = units * price.sell;
    economy.stock.subtract(resourceBundle(product, units));
    economy.today.sold += gain;
    this.credit(resourceBundle(Product.Goods, gain), village);
    this.notify(`Sold ${units} ${name} for ${gain} gold`);
  }
  ++this.changes;
  return true;
}
