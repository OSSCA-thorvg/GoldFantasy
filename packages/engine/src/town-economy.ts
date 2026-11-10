// Translated from src/game/town_economy.cpp.
import { TownState } from './town-state';
import { Building, Calendar, Forecast, GrowthStatus, Season, seasonName } from './town-models';
import {
  Resources,
  storedResourceKeys,
  Product,
  Structure,
  GrowthNeed,
  structureSpec,
  isHome,
  isMarket,
  rentOf,
  priceOf,
  describe,
} from './building-catalog';
import { Activity, Role, type Person } from './person';
import { Ledger, type CampEconomy } from './camp-economy';
import { Terrain, type Tile } from './world-types';
import { add, sub, scale, point, rotated, distance, type Point } from './geometry';
import { f32 as f, lround, hash01 } from './numeric';
export interface Reason {
  value: string;
}
export interface EconomyTown extends TownState {
  camp(id?: number): Building | null;
  stock(id?: number): Resources;
  reserves(id: number): Resources;
  economy(id: number): CampEconomy;
  settlement(id: number): CampEconomy;
  settlementOf(item: Building | Person): number;
  population(id?: number): number;
  guests(id?: number): number;
  nearbyTiles(center: Point, radius: number, predicate: (tile: Tile) => boolean): number;
  fieldAcres(id?: number): number;
  tendedFieldAcres(id?: number): number;
  calendar(): Calendar;
  yearFraction(): number;
  dayFraction(): number;
  tick(seconds: number): void;
  newDay(): void;
  store(gain: Resources, village: number): void;
  dailyOutput(item: Building): Resources;
  settleAccounts(): void;
  regrow(): void;
  settleGuests(): void;
  assignHomes(): void;
  staff(): void;
  grow(): void;
  processDevotion(): void;
  capacity(village?: number): Resources;
  credit(gain: Resources, village: number): void;
  wageOf(person: Person): number;
  site(id: number): Building | null;
  near(center: Point, radius: number, predicate: (kind: Structure) => boolean, faction?: number): boolean;
  needMet(item: Building, reason?: Reason): boolean;
  roomToGrow(item: Building, kind: Structure): boolean;
  mergeManor(seed: Building): boolean;
}
const monthsPerYear = 12,
  harvestMonth = 9;
export function dayFraction(this: TownState): number {
  return f((this.time % TownState.secondsPerDay) / TownState.secondsPerDay);
}
export function yearFraction(this: TownState): number {
  return f(
    ((this.time / TownState.secondsPerDay) % (TownState.daysPerMonth * monthsPerYear)) /
      (TownState.daysPerMonth * monthsPerYear),
  );
}
export function calendar(this: TownState): Calendar {
  const month = Math.trunc(this.days / TownState.daysPerMonth);
  const value = new Calendar(
    (this.days % TownState.daysPerMonth) + 1,
    (month % monthsPerYear) + 1,
    Math.trunc(month / monthsPerYear) + 1,
  );
  value.season = Math.trunc((value.month - 1) / 3);
  return value;
}
export function fieldAcres(this: TownState): number {
  return this.farmland.reduce((sum, field) => sum + field.acres(), 0);
}
export function tendedFieldAcres(this: EconomyTown): number {
  let capacity = 0;
  for (const item of this.placed)
    if (item.kind === Structure.Farm && item.built())
      capacity = f(capacity + f(f(item.workers * item.attendance) * structureSpec(item.kind).perWorker));
  return Math.min(lround(capacity), this.fieldAcres());
}
export function dailyOutput(this: EconomyTown, item: Building): Resources {
  const spec = structureSpec(item.kind),
    out = new Resources();
  if (!item.built()) return out;
  const amount = lround(f(f(item.workers * item.attendance) * spec.perWorker));
  switch (spec.product) {
    case Product.Planks:
    case Product.CutStone:
    case Product.Wood:
    case Product.Stone:
      break;
    case Product.Goods:
      if (amount > 0) {
        let homes = 0;
        for (const other of this.placed)
          if (
            isHome(other.kind) &&
            this.settlementOf(other) === this.settlementOf(item) &&
            distance(other.center, item.center) <= 8
          )
            ++homes;
        out.gold = amount + Math.trunc(homes / 2);
      }
      break;
    case Product.Mana:
      out.mana = amount;
      break;
    case Product.Water:
      out.water = amount * (this.nearbyTiles(item.center, 4, (t) => t.terrain === Terrain.Water) ? 2 : 1);
      break;
    case Product.Food: {
      const season = this.calendar().season;
      if (season === Season.Summer || season === Season.Autumn) {
        const village = this.settlementOf(item),
          acres = this.fieldAcres(village),
          share = acres ? Math.trunc((this.tendedFieldAcres(village) * Math.min(amount, acres)) / acres) : 0;
        out.food = Math.trunc(share / 2);
      } else out.food = lround(f(f(item.workers * item.attendance) * 2));
      break;
    }
    case Product.None:
      break;
  }
  return out;
}
export function advance(this: EconomyTown, seconds: number): boolean {
  const step = 0.1;
  let newDayBegan = false;
  for (let left = seconds; left > 1e-9; left -= step) {
    const dt = Math.min(step, left);
    this.time += dt;
    this.sky.advance(dt, TownState.secondsPerDay, this.yearFraction(), this.dayFraction());
    this.tick(dt);
    while (this.time >= (this.days + 1) * TownState.secondsPerDay) {
      this.newDay();
      newDayBegan = true;
    }
  }
  return newDayBegan;
}
export function newDay(this: EconomyTown): void {
  const before = this.calendar();
  ++this.days;
  const date = this.calendar(),
    shift = f(TownState.secondsPerDay * f(0.4));
  for (const item of this.placed) {
    item.attendance = item.workers ? Math.min(1, f(item.workedSeconds / f(shift * item.workers))) : 0;
    item.workedSeconds = 0;
  }
  for (const item of this.placed)
    if (this.settlementOf(item) >= 0) this.store(this.dailyOutput(item), this.settlementOf(item));
  // Water is consumed at a water facility by individual thirsty residents.
  // Daily stock deductions would charge the same drink twice and ignore hydration.
  for (const village of [this.provisions, ...this.villages]) village.parched = false;
  this.settleAccounts();
  for (const person of this.folk) ++person.days;
  for (const village of this.villages) {
    if (before.season === Season.Summer || before.season === Season.Autumn) {
      village.growingTended = f(village.growingTended + f(this.tendedFieldAcres(village.camp)));
      ++village.growingDays;
    }
    if (before.month !== harvestMonth || date.month === harvestMonth) continue;
    const harvest = village.growingDays ? lround(f(f(village.growingTended / village.growingDays) * 10)) : 0;
    village.growingTended = 0;
    village.growingDays = 0;
    const beforeHarvest = village.stock.food;
    this.store(new Resources(0, 0, 0, harvest), village.camp);
    const stored = village.stock.food - beforeHarvest;
    if (!harvest) this.notify('Autumn ends with no harvest');
    else {
      let message = `Harvest: +${stored} food`;
      if (stored < harvest) message += ` (${harvest} produced, ${harvest - stored} not stored)`;
      this.notify(message);
    }
  }
  if (before.season !== date.season)
    this.notify(
      seasonName(date.season) + (date.season === Season.Spring ? ` of year ${date.year}` : '') + ' begins',
    );
  this.regrow();
  this.settleGuests();
  this.assignHomes();
  this.staff();
  this.grow();
  this.processDevotion();
  ++this.changes;
}
export function capacity(this: EconomyTown, village = this.camp()?.id ?? -1): Resources {
  let room = 120;
  const seat = this.camp(village);
  if (seat)
    room +=
      seat.kind === Structure.Palisade
        ? 80
        : seat.kind === Structure.Keep
          ? 160
          : seat.kind === Structure.Castle
            ? 240
            : 0;
  for (const item of this.placed)
    if (item.built() && this.settlementOf(item) === village) room += structureSpec(item.kind).storage;
  const capacity = new Resources(0, room, room, room, 0, room, room, room, room);
  for (const item of this.placed) {
    if (!item.built() || this.settlementOf(item) !== village) continue;
    if (item.kind === Structure.WoodStore) {
      capacity.wood += 240;
      capacity.planks += 240;
    }
    if (item.kind === Structure.StoneStore) {
      capacity.stone += 240;
      capacity.cutStone += 240;
    }
    if (item.kind === Structure.Granary) capacity.food += 240;
  }
  return capacity;
}
export function store(this: EconomyTown, gain: Resources, village: number): void {
  const room = this.capacity(village),
    ledger = this.economy(village),
    treasury = ledger.stock,
    accepted = gain.clone();
  let spoiled = false;
  for (const key of storedResourceKeys) {
    const kept = Math.min(Math.max(0, room[key] - treasury[key]), Math.max(0, accepted[key]));
    spoiled = spoiled || kept < accepted[key];
    accepted[key] = kept;
  }
  this.credit(accepted, village);
  if (spoiled && ledger.spoiledDay !== this.days) {
    ledger.spoiledDay = this.days;
    this.notify('The stores are full: build a suitable depot or storehouse');
  }
}
export function wageOf(_person: Person): number {
  return 3;
}
export function forecast(this: EconomyTown, village = this.camp()?.id ?? -1): Forecast {
  const day = new Forecast();
  const faction = this.camp(village)?.faction ?? this.controlFaction;
  for (const p of this.folk) {
    if (p.role !== Role.Resident || p.faction !== faction || this.settlementOf(p) !== village) continue;
    const paid = (task: Activity) =>
      task === Activity.Building ||
      task === Activity.Roadwork ||
      task === Activity.Felling ||
      task === Activity.Mining ||
      task === Activity.Collecting ||
      task === Activity.Hauling ||
      task === Activity.Working;
    if (p.job >= 0 || paid(p.activity) || paid(p.task) || p.worked >= TownState.paidWorkSeconds)
      day.wages += this.wageOf(p);
    const home = this.building(p.home);
    if (home && home.owner < 0) day.rent += rentOf(home.kind);
  }
  const yesterday = this.settlement(village).yesterday;
  day.guests = yesterday.guests;
  day.bounty = yesterday.bounty;
  for (const item of this.placed)
    if (item.faction === faction && this.settlementOf(item) === village) day.made.add(this.dailyOutput(item));
  const mouths = this.population(village) + this.guests(village);
  day.used.food = yesterday.eaten || Math.ceil(mouths / 7.5);
  day.used.water = yesterday.drunk || Math.ceil(mouths / 3.75);
  return day;
}
export function settleAccounts(this: EconomyTown): void {
  const shift = TownState.paidWorkSeconds;
  for (const p of this.folk) {
    if (p.role !== Role.Resident) continue;
    const village = this.settlementOf(p);
    // Travelling or orphaned neutral residents have private supplies, not the
    // player's unassigned stockpile. Their new Camp resumes normal accounting.
    if (village < 0 && p.faction !== this.controlFaction) { p.worked = 0; continue; }
    const today = this.economy(village).today;
    p.unpaid = false;
    if (p.worked >= shift) {
      const wage = this.wageOf(p),
        job = this.building(p.job),
        employer = job ? this.settlementOf(job) : village,
        pay = this.economy(employer);
      if (pay.stock.gold >= wage) {
        pay.stock.gold -= wage;
        p.purse += wage;
        pay.today.wages += wage;
      } else p.unpaid = true;
    }
    p.worked = 0;
    const home = this.site(p.home);
    if (!home || home.owner >= 0) continue;
    const rent = rentOf(home.kind);
    if (p.purse >= rent) {
      p.purse -= rent;
      this.credit(new Resources(rent), this.settlementOf(home));
      today.rent += rent;
    } else p.unpaid = true;
    const price = priceOf(home.kind);
    if (price > 0 && p.purse >= price + 10 && p.stress < f(0.6)) {
      p.purse -= price;
      this.credit(new Resources(price), this.settlementOf(home));
      today.sales += price;
      home.owner = p.id;
      this.notify(`${p.name} bought their ${structureSpec(home.kind).name} for ${price} gold`);
    }
  }
  this.provisions.yesterday = this.provisions.today;
  this.provisions.today = new Ledger();
  for (const village of this.villages) {
    village.yesterday = village.today;
    village.today = new Ledger();
  }
}
export function needMet(this: EconomyTown, item: Building, reason: Reason = { value: '' }): boolean {
  const spec = structureSpec(item.kind),
    treasury = this.stock(this.settlementOf(item)),
    residents = this.population(this.settlementOf(item));
  switch (spec.need) {
    case GrowthNeed.Food:
      reason.value = 'Needs food in store';
      return treasury.food > 0;
    case GrowthNeed.Market:
      reason.value = 'Needs a market within 8 paces';
      return this.near(item.center, 8, isMarket, item.faction);
    case GrowthNeed.Workers:
      reason.value = `Needs ${spec.needAmount} workers`;
      return item.workers >= spec.needAmount;
    case GrowthNeed.Population:
      reason.value = `Needs ${spec.needAmount} people`;
      return residents >= spec.needAmount;
    case GrowthNeed.Merge:
      reason.value = `In a town of ${spec.needAmount}, merges with 3 mature townhouses huddled beside it`;
      return residents >= spec.needAmount;
    case GrowthNeed.Occupancy: {
      const living = this.folk.filter((p) => p.role === Role.Resident && p.home === item.id).length;
      reason.value = `Needs a full house (${living}/${spec.residents}) in a town of ${spec.needAmount}`;
      return living >= spec.residents && residents >= spec.needAmount;
    }
    case GrowthNeed.Income:
      reason.value = `Needs ${spec.needAmount} gold from guests (${item.earned} so far)`;
      return item.earned >= spec.needAmount;
    case GrowthNeed.Registry:
      reason.value = `Needs ${spec.needAmount} residents trained (${item.trainingCount} so far)`;
      return item.trainingCount >= spec.needAmount;
    case GrowthNeed.None:
      return true;
  }
  return true;
}
export function growthStatus(this: EconomyTown, item: Building): GrowthStatus {
  const spec = structureSpec(item.kind),
    status = new GrowthStatus();
  if (spec.next === Structure.Count) return status;
  status.grows = true;
  status.next = structureSpec(spec.next).name;
  status.days = item.growth;
  status.needed = spec.growthDays;
  const reason = { value: '' };
  status.ready = this.needMet(item, reason);
  status.reason = reason.value;
  const mature = item.growth >= spec.growthDays;
  if (status.ready && !this.roomToGrow(item, spec.next)) {
    status.ready = false;
    status.reason = 'Needs clear ground around it to grow';
  } else if (status.ready && mature && !this.stock(this.settlementOf(item)).covers(spec.upgradeCost)) {
    status.ready = false;
    status.reason = 'Waiting for ' + describe(spec.upgradeCost);
  } else if (status.ready && !(mature && spec.need === GrowthNeed.Merge)) status.reason = '';
  return status;
}
export function grow(this: EconomyTown): void {
  const ids = this.placed.map((item) => item.id);
  for (const id of ids) {
    const item = this.placed.find((b) => b.id === id);
    if (!item) continue;
    const treasury = this.reserves(this.settlementOf(item)),
      spec = structureSpec(item.kind);
    if (spec.next === Structure.Count || !item.built() || !this.needMet(item)) continue;
    const blessed = isHome(item.kind) && this.near(item.center, 6, (kind) => kind === Structure.Shrine, item.faction);
    item.growth = Math.min(spec.growthDays, item.growth + (blessed ? 2 : 1));
    if (item.growth < spec.growthDays || !treasury.covers(spec.upgradeCost)) continue;
    if (spec.need === GrowthNeed.Merge) {
      this.mergeManor(item);
      continue;
    }
    if (!this.roomToGrow(item, spec.next)) continue;
    treasury.subtract(spec.upgradeCost);
    const shift = f(f(structureSpec(spec.next).size - spec.size) / 2);
    item.replaced = [{ kind: item.kind, variant: item.variant, dx: shift, dy: shift }];
    item.kind = spec.next;
    item.growth = 0;
    item.earned = 0;
    item.version = (item.version + 1) >>> 0;
    item.workers = Math.min(item.workers, structureSpec(item.kind).jobs);
    this.notify(`${spec.name} grew into a ${structureSpec(item.kind).name}`);
    ++this.changes;
  }
}
export function mergeManor(this: EconomyTown, seed: Building): boolean {
  const village = this.settlementOf(seed),
    treasury = this.reserves(village),
    huddle = 2,
    spec = structureSpec(Structure.Townhouse),
    group = [seed];
  const others = this.placed.filter(
    (other) =>
      other !== seed &&
      this.settlementOf(other) === village &&
      other.kind === Structure.Townhouse &&
      other.growth >= spec.growthDays &&
      distance(other.center, seed.center) <= huddle,
  );
  others.sort((a, b) => distance(a.center, seed.center) - distance(b.center, seed.center));
  for (const other of others)
    if (group.length < 4 && group.every((g) => distance(g.center, other.center) <= huddle)) group.push(other);
  if (group.length < 4) return false;
  let middle = point();
  for (const item of group) middle = add(middle, scale(item.center, f(0.25)));
  const angle = seed.angle,
    half = f(structureSpec(Structure.Manor).size / 2);
  const manor = new Building(
    this.nextId++,
    Structure.Manor,
    middle,
    angle,
    Math.trunc(
      f(hash01(this.world.seed(), Math.trunc(f(middle.x * 8)), Math.trunc(f(middle.y * 8)), 43) * f(1e6)),
    ) >>> 0,
  );
  manor.village = village;
  const ids: number[] = [];
  for (const item of group) {
    const local = rotated(sub(item.center, middle), -angle);
    manor.replaced.push({
      kind: Structure.Townhouse,
      variant: item.variant,
      dx: f(f(local.x + half) - f(0.5)),
      dy: f(f(local.y + half) - f(0.5)),
    });
    ids.push(item.id);
  }
  this.placed = this.placed.filter((b) => !ids.includes(b.id));
  for (const person of this.folk) {
    if (ids.includes(person.home)) person.home = manor.id;
    if (
      (person.inside || person.doorway > 0) &&
      person.activity !== Activity.Exploring &&
      person.activity !== Activity.Expedition &&
      ids.includes(person.target)
    )
      person.target = manor.id;
  }
  treasury.subtract(spec.upgradeCost);
  this.placed.push(manor);
  this.notify('Four townhouses merged into a manor');
  ++this.changes;
  return true;
}
