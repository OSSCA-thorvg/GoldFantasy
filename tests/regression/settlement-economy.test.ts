import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Building, Season } from '../../packages/engine/src/town-models';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Role, type Person } from '../../packages/engine/src/person';
import { CombatCue, combatRules } from '../../packages/engine/src/combat-events';
import { Boon, boon, boonOfWorld } from '../../packages/engine/src/gate-boons';
import { sealFloors, sealable } from '../../packages/engine/src/gate-seals';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { dayCycle } from '../../packages/engine/src/day-cycle';
import { point } from '../../packages/engine/src/geometry';
import { economyRules } from '../../packages/engine/src/economy-rules';
import { itemSpec } from '../../packages/engine/src/equipment';
import { levelVariant } from '../../packages/engine/src/craft-stations';

function settlement() {
  const town = new Town(5, 32, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  town.notices = [];
  return town;
}
function facility(town: Town, kind: Structure, workers = 1) {
  const b = new Building(town.nextId++, kind, point(4 + town.nextId * 3, 4), 0, 0);
  b.village = 0;
  b.workers = workers;
  town.placed.push(b);
  return b;
}
function resident(town: Town, calling = Calling.Settler, level = 1): Person {
  const p = town.makePerson(Role.Resident, calling, town.map().camp());
  p.home = p.village = 0;
  p.level = level;
  town.folk.push(p);
  return p;
}
/** Seals a gate leading to the boon's world, adding a synthetic gate when the small map has none. */
function grantBoon(town: Town, which: Boon) {
  const sites = town.map().dungeons();
  let index = sites.findIndex((site) => sealable(site) && boonOfWorld(town.map().destination(site)) === which);
  for (const kind of [DungeonKind.Cave, DungeonKind.Crypt, DungeonKind.Portal, DungeonKind.Ruin])
    for (let y = 0; y < 31 && index < 0; y++)
      for (let x = 0; x < 31 && index < 0; x++) {
        const site = { name: 'Test gate', kind, origin: { x, y }, discovered: true };
        if (boonOfWorld(town.map().destination(site)) === which) index = sites.push(site) - 1;
      }
  town.depth = sites.map((_, i) => (i === index ? sealFloors : (town.depth[i] ?? 0)));
  expect(boon(town, which)).toBe(true);
}

describe('market trade', () => {
  it('needs a built, staffed market and explains why not', () => {
    const town = settlement();
    expect(town.tradeOffers(0)).toEqual([]);
    expect(town.marketDay(0)).toBeNull();
    expect(town.canTrade(0, Product.Wood, 1).reason).toBe('Build a market');
    expect(town.canTrade(7, Product.Wood, 1).reason).toBe('No settlement');
    const stalls = facility(town, Structure.MarketStalls, 0);
    expect(town.canTrade(0, Product.Wood, 1).reason).toBe('The market needs a worker');
    stalls.progress = 0;
    stalls.workers = 1;
    expect(town.canTrade(0, Product.Wood, 1).reason).toBe('Build a market');
    stalls.progress = 1;
    expect(town.tradeOffers(0).map((offer) => offer.name)).toEqual(['wood', 'stone', 'food', 'planks', 'cut stone']);
    expect(town.marketDay(0)).toEqual({ market: stalls.id, name: 'Market stalls', limit: 20, traded: 0, left: 20 });
    expect(town.canTrade(0, Product.Mana, 1).reason).toBe('The market does not trade that');
    expect(town.canTrade(0, Product.Wood, 0).reason).toBe('Choose an amount to trade');
    expect(town.canTrade(0, Product.Wood, 1.5).reason).toBe('Choose an amount to trade');
  });

  it('always sells for less than any market ever asks, and better markets trade better', () => {
    const town = settlement(),
      stalls = facility(town, Structure.MarketStalls);
    const quotes = (kind: Structure) => {
      stalls.kind = kind;
      const out: { product: Product; buy: number; sell: number; day: number }[] = [];
      for (let day = 0; day < 120; ++day) {
        town.days = day;
        for (const offer of town.tradeOffers(0)) out.push({ ...offer, day });
      }
      return out;
    };
    const all = [Structure.MarketStalls, Structure.MarketHall, Structure.Bazaar].map(quotes);
    for (const product of [Product.Wood, Product.Stone, Product.Food, Product.Planks, Product.CutStone]) {
      const rows = all.flat().filter((q) => q.product === product),
        maxSell = Math.max(...rows.map((q) => q.sell)),
        minBuy = Math.min(...rows.map((q) => q.buy));
      expect(maxSell).toBeLessThan(minBuy);
      expect(Math.min(...rows.map((q) => q.sell))).toBeGreaterThan(0);
    }
    const [plain, , grand] = all;
    for (let i = 0; i < plain.length; ++i) {
      expect(grand[i].buy).toBeLessThanOrEqual(plain[i].buy);
      expect(grand[i].sell).toBeGreaterThanOrEqual(plain[i].sell);
    }
    const sum = (rows: typeof plain, key: 'buy' | 'sell') => rows.reduce((n, q) => n + q[key], 0);
    expect(sum(grand, 'buy')).toBeLessThan(sum(plain, 'buy'));
    expect(sum(grand, 'sell')).toBeGreaterThan(sum(plain, 'sell'));
    // Food is dear in winter and cheap after the harvest.
    const food = (season: Season) =>
      plain.filter((q) => q.product === Product.Food && Math.trunc((q.day % 60) / 15) === season);
    expect(sum(food(Season.Winter), 'buy') / 15).toBeGreaterThan(sum(food(Season.Autumn), 'buy') / 15);
  });

  it('buys within gold and storage room and records it in the day ledger', () => {
    const town = settlement();
    facility(town, Structure.MarketStalls);
    const wood = town.tradeOffers(0)[0];
    town.stock().gold = wood.buy * 5 - 1;
    expect(town.canTrade(0, Product.Wood, 5)).toMatchObject({ ok: false, reason: `Needs ${wood.buy * 5} gold` });
    expect(town.trade(0, Product.Wood, 5)).toBe(false);
    town.stock().gold = 1000;
    const check = town.canTrade(0, Product.Wood, 5);
    expect(check.ok).toBe(true);
    expect(check.cost.gold).toBe(wood.buy * 5);
    expect(town.trade(0, Product.Wood, 5)).toBe(true);
    expect(town.stock().gold).toBe(1000 - wood.buy * 5);
    expect(town.stock().wood).toBe(5);
    expect(town.economy(0).today).toMatchObject({ bought: wood.buy * 5, sold: 0, traded: 5 });
    expect(town.notices).toContain(`Bought 5 wood for ${wood.buy * 5} gold`);
    expect(town.receipts().at(-1)?.gain.wood).toBe(5);
    town.stock().wood = town.capacity(0).wood - 2;
    expect(town.canTrade(0, Product.Wood, 3).reason).toBe('Not enough room in storage (2 free)');
    expect(town.tradeOffers(0)[0].room).toBe(2);
    expect(town.trade(0, Product.Wood, 2)).toBe(true);
    town.settleAccounts();
    expect(town.ledger(0)).toMatchObject({ bought: wood.buy * 7, traded: 7 });
    expect(town.economy(0).today.traded).toBe(0);
  });

  it('sells stored goods for gold and caps the daily volume', () => {
    const town = settlement();
    facility(town, Structure.MarketStalls);
    const planks = town.tradeOffers(0)[3];
    town.stock().planks = 4;
    expect(town.canTrade(0, Product.Planks, -5).reason).toBe('Only 4 planks in store');
    expect(town.canTrade(0, Product.Planks, -4).cost.planks).toBe(4);
    expect(town.trade(0, Product.Planks, -4)).toBe(true);
    expect(town.stock()).toMatchObject({ planks: 0, gold: planks.sell * 4 });
    expect(town.economy(0).today).toMatchObject({ sold: planks.sell * 4, bought: 0, traded: 4 });
    expect(town.notices).toContain(`Sold 4 planks for ${planks.sell * 4} gold`);
    town.stock().stone = 50;
    expect(town.canTrade(0, Product.Stone, -17).reason).toBe('The market moves 20 goods a day (16 left today)');
    expect(town.trade(0, Product.Stone, -16)).toBe(true);
    expect(town.marketDay(0)?.left).toBe(0);
    expect(town.canTrade(0, Product.Stone, -1).ok).toBe(false);
  });
});

describe('mage tower rites', () => {
  function towered(mana = 30) {
    const town = settlement(),
      tower = facility(town, Structure.MageTower);
    town.stock().mana = mana;
    return { town, tower };
  }
  it('lists the rites and refuses without a staffed tower or mana', () => {
    const town = settlement();
    expect(town.rites().map((r) => [r.id, r.mana])).toEqual([
      ['ward', 10],
      ['mending', 8],
      ['farsight', 5],
    ]);
    expect(town.canPerformRite('ward', 0).reason).toBe('Build a mage tower');
    expect(town.canPerformRite('dance', 0).reason).toBe('Unknown rite');
    expect(town.canPerformRite('ward', 3).reason).toBe('No settlement');
    const tower = facility(town, Structure.MageTower, 0);
    expect(town.canPerformRite('ward', 0).reason).toBe('The mage tower needs a mage');
    tower.workers = 1;
    town.stock().mana = 9;
    expect(town.canPerformRite('ward', 0)).toMatchObject({ ok: false, reason: 'Needs 10 mana (9 stored)' });
    expect(town.canPerformRite('ward', 0).cost.mana).toBe(10);
    expect(town.performRite('ward', 0)).toBe(false);
    expect(town.stock().mana).toBe(9);
  });

  it('wards the settlement until the next dawn, once a day', () => {
    const { town } = towered();
    town.editHour(20);
    expect(town.performRite('ward', 0)).toBe(true);
    const sunrise = dayCycle(town.yearFraction(), town.dayFraction()).sunrise;
    expect(town.wardUntil).toBeCloseTo((town.days + 1 + sunrise) * Town.secondsPerDay, 3);
    expect(town.stock().mana).toBe(20);
    expect(town.notices).toContain('The mage tower raises a ward over the settlement until dawn');
    expect(town.canPerformRite('ward', 0).reason).toBe('Already performed today');
    town.days += 1;
    town.time = town.days * Town.secondsPerDay + 1;
    expect(town.canPerformRite('ward', 0).reason).toBe('The ward already holds');
    town.time = town.wardUntil + 1;
    expect(town.canPerformRite('ward', 0).ok).toBe(true);
    // Before dawn the ward lasts only to this morning.
    town.days += 1;
    town.editHour(1);
    expect(town.performRite('ward', 0)).toBe(true);
    const morning = dayCycle(town.yearFraction(), town.dayFraction()).sunrise;
    expect(town.wardUntil).toBeCloseTo((town.days + morning) * Town.secondsPerDay, 3);
  });

  it('mends standing residents, shortens wounds and never revives the downed', () => {
    const { town } = towered();
    const healthy = resident(town),
      wounded = resident(town, Calling.Warrior),
      scratched = resident(town),
      downed = resident(town);
    expect(town.canPerformRite('mending', 0).reason).toBe('No one needs mending');
    wounded.health = 0.3;
    wounded.woundDays = 2;
    scratched.health = 0.5;
    downed.health = 0;
    downed.downedAt = town.time;
    downed.activity = Activity.Downed;
    downed.woundDays = 2;
    expect(town.performRite('mending', 0)).toBe(true);
    expect(healthy.health).toBe(1);
    expect(wounded.woundDays).toBe(1);
    expect(wounded.health).toBeCloseTo(combatRules.woundedHealth);
    expect(scratched.health).toBeCloseTo(0.9);
    expect(downed).toMatchObject({ health: 0, woundDays: 2, activity: Activity.Downed });
    expect(town.stock().mana).toBe(22);
    const heals = town.combatEvents().filter((e) => e.cue === CombatCue.Heal);
    expect(heals.map((e) => [e.person, e.amount])).toEqual([
      [wounded.id, 30],
      [scratched.id, 40],
    ]);
    expect(town.notices).toContain("The mage tower's mending eases 2 residents");
    expect(town.canPerformRite('mending', 0).reason).toBe('Already performed today');
  });

  it('reveals the nearest hidden gate through the usual discovery', () => {
    const { town } = towered();
    const sites = town.map().dungeons();
    for (const site of sites) site.discovered = false;
    expect(sites.some(sealable)).toBe(true);
    expect(town.performRite('farsight', 0)).toBe(true);
    expect(sites.filter((site) => site.discovered).length).toBeGreaterThan(0);
    expect(town.notices.some((n) => n.startsWith('Discovered '))).toBe(true);
    expect(town.stock().mana).toBe(25);
    for (const site of sites) site.discovered = true;
    town.days += 1;
    expect(town.canPerformRite('farsight', 0).reason).toBe('Every gate is already found');
  });
});

describe('wages, boons and winter', () => {
  it('pays more for levels and a sworn calling, and the forecast agrees', () => {
    const town = settlement();
    const wage = (calling: Calling, level: number) => town.wageOf(resident(town, calling, level));
    expect(wage(Calling.Settler, 1)).toBe(3);
    expect(wage(Calling.Traveller, 1)).toBe(3);
    expect(wage(Calling.Settler, 5)).toBe(3);
    expect(wage(Calling.Settler, 6)).toBe(4);
    expect(wage(Calling.Warrior, 1)).toBe(4);
    expect(wage(Calling.Bard, 11)).toBe(6);
    expect(wage(Calling.Mage, 30)).toBe(9);
    town.folk = [];
    const settler = resident(town),
      warrior = resident(town, Calling.Warrior, 6);
    for (const p of [settler, warrior]) {
      p.worked = Town.paidWorkSeconds;
      p.purse = 0;
    }
    town.stock().gold = 20;
    expect(town.forecast(0).wages).toBe(3 + 5);
    town.settleAccounts();
    expect(town.stock().gold).toBe(12);
    expect([settler.purse, warrior.purse]).toEqual([3, 5]);
    expect(town.ledger(0).wages).toBe(8);
  });

  it('Plenty raises field food and the harvest by a quarter', () => {
    const plain = settlement(),
      blessed = settlement();
    grantBoon(blessed, Boon.Plenty);
    for (const town of [plain, blessed]) {
      town.days = 40;
      town.economy(0).growingTended = 4;
      town.economy(0).growingDays = 1;
      resident(town);
    }
    expect(plain.winterOutlook(0).harvestExpected).toBe(40);
    expect(blessed.winterOutlook(0).harvestExpected).toBe(50);
    for (const town of [plain, blessed]) {
      // The last autumn day adds an untended day to the average: 4 acres over 2 days, times 10.
      town.days = 44;
      town.stock().food = 0;
      town.newDay();
    }
    expect([plain.stock().food, blessed.stock().food]).toEqual([20, 25]);
    expect(blessed.notices).toContain('Harvest: +25 food');
    const farm = (town: Town) => {
      const b = facility(town, Structure.Farm, 2);
      b.attendance = 1;
      town.days = 0;
      return town.dailyOutput(b).food;
    };
    expect(farm(plain)).toBe(4);
    expect(farm(blessed)).toBe(5);
  });

  it('Forge halves crafting time and forged weapons are counted', () => {
    const craft = (town: Town, item: string, seconds: number) => {
      // Iron is made only at stations raised to their top level.
      const smith = facility(town, itemSpec(item)!.workshop!),
        p = resident(town);
      smith.variant = levelVariant(3);
      Object.assign(town.stock(), new Resources(100, 60, 60, 60, 20, 60, 20, 20));
      p.position = smith.door();
      p.path = [];
      p.task = Activity.Crafting;
      p.craftItem = item;
      p.craftWorkshop = smith.id;
      town.advanceCrafting(p, seconds);
      return p;
    };
    // Bare hands craft at 40% speed; this is exactly the time a Forge-blessed smith needs.
    const half = (itemSpec('sword')?.seconds ?? 0) / 0.4 / 2;
    const plain = settlement(),
      slow = craft(plain, 'sword', half);
    expect(slow.craftItem).toBe('sword');
    expect(plain.chronicle.weaponsForged).toBe(0);
    const forged = settlement();
    grantBoon(forged, Boon.Forge);
    const fast = craft(forged, 'sword', half);
    expect(fast.craftItem).toBeNull();
    expect(fast.inventory[0]?.item).toBe('sword');
    expect(forged.chronicle.weaponsForged).toBe(1);
    craft(forged, 'axe', half);
    expect(forged.chronicle.weaponsForged).toBe(1);
  });

  it('tells how much food the winter needs and warns once a day in autumn when short', () => {
    const town = settlement();
    for (let i = 0; i < 6; ++i) resident(town);
    town.days = 35;
    town.stock().food = 5;
    expect(town.winterOutlook(0)).toEqual({
      daysToWinter: 10,
      foodStored: 5,
      harvestExpected: 0,
      foodNeeded: Math.ceil((6 * 15) / economyRules.daysPerMeal),
      enough: false,
    });
    town.notices = [];
    town.newDay();
    expect(town.days).toBe(36);
    expect(town.notices.filter((n) => n.startsWith('Winter in 9 days:'))).toEqual([
      'Winter in 9 days: 5 food stored or due, 12 needed. Farm, hunt or trade for food.',
    ]);
    town.stock().food = 12;
    expect(town.winterOutlook(0).enough).toBe(true);
    town.days = 50;
    expect(town.winterOutlook(0)).toMatchObject({ daysToWinter: 0, foodNeeded: Math.ceil((6 * 10) / 7.5) });
    town.days = 5;
    expect(town.winterOutlook(0).daysToWinter).toBe(40);
  });
});
