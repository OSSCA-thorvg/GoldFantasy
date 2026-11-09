import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain, Layer } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Person, Role, Calling, Race, Activity } from '../../packages/engine/src/person';
import { Structure, Resources, structureSpec } from '../../packages/engine/src/building-catalog';
import { point, distance } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';
import { buildingUnlock } from '../../packages/engine/src/settlement-progression';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';

let base: Town;
beforeAll(() => {
  const world = WorldMap.generate(5, 32, 32);
  world.ymir = world.fire = null;
  world.sites = [];
  world.stream = { path: [], width: [] };
  for (const layer of world.layers) layer.fill(0.4);
  world.layer(Layer.Land).fill(1);
  world.layer(Layer.Ridge).fill(-1);
  for (let y = 0; y < 32; ++y)
    for (let x = 0; x < 32; ++x)
      Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
  world.reveal(16, 16, 100);
  base = new Town(world, 32, false);
  base.placed = [
    new Building(0, Structure.Camp, point(8, 8), 0, 0),
    new Building(1, Structure.Shrine, point(12, 8), 0, 0),
    new Building(2, Structure.Guild, point(12, 12), 0, 0),
    new Building(3, Structure.Hostel, point(8, 12), 0, 0),
  ];
  base.nextId = 4;
  base.migrateSettlements();
  base.stock().add(new Resources(100, 100, 100, 100, 100, 100));
  const p = new Person(0, 'Worshipper', Role.Resident, Calling.Settler, Race.Human, 0, point(5, 8));
  p.home = p.village = 0;
  p.food = p.rest = p.hydration = p.health = 1;
  p.stress = 0;
  p.autoMode = false;
  base.folk = [p];
  base.nextPerson = 1;
  base.editHour(12);
  base.wildlifeDay = base.days;
  base.tick(0);
});
function fixture(): Town {
  return copyNative(base);
}
function advance(town: Town, seconds: number): void {
  for (let i = 0; i < seconds * 10; i++) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
  }
}
function secondSettlement(town: Town): Building {
  const camp = new Building(town.nextId++, Structure.Camp, point(25, 25), 0, 0);
  camp.faction = 1;
  camp.village = camp.id;
  town.placed.push(camp);
  town.foundSettlement(camp.id);
  const hostel = new Building(town.nextId++, Structure.Hostel, point(25, 21), 0, 0);
  hostel.faction = 1;
  hostel.village = camp.id;
  town.placed.push(hostel);
  town.stock(camp.id).add(new Resources(100, 100, 100, 100, 100, 100));
  ++town.changes;
  town.tick(0);
  return camp;
}

describe('temporary lodging visitors', () => {
  it('requires completed lodging, respects guest beds, and never offers or naturalizes guests', () => {
    const town = fixture(),
      hostel = town.building(3)!;
    hostel.progress = 0;
    town.economy(0).arrivalTimer = 0;
    town.admitGuests(0.1);
    expect(town.guests(0)).toBe(0);
    hostel.progress = 1;
    for (let i = 0; i < 10; i++) {
      town.economy(0).arrivalTimer = 0;
      town.admitGuests(0.1);
    }
    expect(town.guests(0)).toBe(structureSpec(Structure.Hostel).beds);
    const p = town.people().find((p) => p.role === Role.Guest)!;
    expect(p.bed).toBe(hostel.id);
    expect(town.stock(0).gold).toBe(109);
    expect(town.recruitmentOffers()).toEqual([]);
    expect(town.hireGuest('guest:' + p.id)).toBe(false);
    expect(town.settle(p.id)).toBe(false);
    expect(town.naturalize(p)).toBe(0);
    p.days = 20;
    town.settleGuests();
    expect(p.role).toBe(Role.Guest);
    expect(town.building(2)!.registered).toBe(0);
    town.think(p);
    expect(p.activity).toBe(Activity.Leaving);
  });
  it('credits the visited camp, preserves visitor faction, and never borrows another faction home', () => {
    const town = fixture(),
      other = secondSettlement(town);
    const before = town.stock(0).gold,
      otherBefore = town.stock(other.id).gold;
    town.welcome(Calling.Traveller, null, other.id);
    const visitor = town.people().at(-1)!;
    expect(visitor.faction).toBe(1);
    expect(town.building(visitor.bed)!.faction).toBe(1);
    expect(town.stock(0).gold).toBe(before);
    expect(town.stock(other.id).gold).toBe(otherBefore + 3);
    visitor.bed = 3;
    town.assignHomes();
    expect(town.building(visitor.bed)!.faction).toBe(1);
    const resident = town.people()[0];
    resident.home = other.id;
    town.assignHomes();
    expect(resident.home).toBe(0);
  });
  it('a guild without a hostel does not attract visitors', () => {
    const town = fixture();
    town.placed = town.placed.filter((b) => b.kind !== Structure.Hostel);
    town.economy(0).arrivalTimer = 0;
    town.admitGuests(1);
    expect(town.guests()).toBe(0);
    expect(town.building(2)!.registered).toBe(0);
  });
});

describe('altar prayer and next-day residents', () => {
  it('autoplay grows through physical altar prayer without reassigning the worshipper to staffing', () => {
    const town = fixture();
    for (const [kind, at] of [
      [Structure.Farm, point(18, 8)],
      [Structure.Well, point(18, 12)],
    ] as const) {
      const b = new Building(town.nextId++, kind, at, 0, 0);
      b.village = 0;
      town.placed.push(b);
    }
    ++town.changes;
    town.tick(0);
    town.stock(0).food = 6;
    town.planTitleWork();
    const p = town.people()[0];
    expect(p.task).toBe(Activity.Praying);
    expect(p.taskSite).toBe(1);
    advance(town, 25);
    expect(town.building(1)!.devotionDueDay).toBe(town.days + 1);
    town.newDay();
    expect(town.population(0)).toBe(2);
  });

  it('processes a neutral altar only inside its own simulation context', () => {
    const town = fixture(),
      camp = secondSettlement(town);
    const altar = new Building(town.nextId++, Structure.Shrine, point(21, 25), 0, 0);
    altar.faction = 1;
    altar.village = camp.id;
    altar.devotionDueDay = town.days;
    town.placed.push(altar);
    const dice = town.dice,
      count = town.people().length;
    town.processDevotion();
    expect(town.people()).toHaveLength(count);
    expect(town.dice).toBe(dice);
    expect(altar.devotionDueDay).toBe(town.days);
    town.controlFaction = 1;
    town.processDevotion();
    expect(town.people()).toHaveLength(count + 1);
    const born = town.people().at(-1)!;
    expect([born.faction, born.village, born.home]).toEqual([1, camp.id, camp.id]);
    expect(distance(born.position, altar.door())).toBeLessThan(0.75);
  });
  it('releases a prayer reservation when its direct command is cancelled before the offering', () => {
    const town = fixture(),
      p = town.people()[0],
      food = town.stock(0).food;
    expect(town.orderPrayAtAltar([p.id], 1)).toBe(true);
    town.orderStop([p.id]);
    advance(town, 25);
    expect(town.altarStatus(1).pendingBirths).toBe(0);
    expect(town.altarStatus(1).reason).toBe('');
    expect(town.stock(0).food).toBe(food);
  });

  it("does not unlock player construction from another faction's facilities", () => {
    const town = fixture();
    town.placed[0].faction = 1;
    expect(buildingUnlock(town, Structure.Shrine).available).toBe(false);
    town.controlFaction = 1;
    expect(buildingUnlock(town, Structure.Shrine).available).toBe(true);
  });

  it('is available to the two-founder settlement without advanced materials', () => {
    const town = fixture();
    expect(buildingUnlock(town, Structure.Shrine).available).toBe(true);
    const cost = structureSpec(Structure.Shrine).cost;
    expect(cost.planks + cost.cutStone).toBe(0);
    expect(structureSpec(Structure.Shrine).requiredPopulation).toBe(0);
  });
  it('requires real travel and prayer, pays once, and produces one resident at that altar next day', () => {
    const town = fixture(),
      p = town.people()[0],
      altar = town.building(1)!,
      food = town.stock(0).food;
    expect(town.orderPrayAtAltar([p.id], altar.id)).toBe(true);
    expect(p.moving()).toBe(true);
    expect(town.completeAltarPrayer(p)).toBe(false);
    expect(town.population(0)).toBe(1);
    expect(town.stock(0).food).toBe(food);
    advance(town, 25);
    expect(altar.devotionDueDay).toBe(town.days + 1);
    expect(town.stock(0).food).toBe(food - 4);
    expect(p.task).toBe(Activity.Idle);
    expect(p.autoMode).toBe(true);
    expect(town.population(0)).toBe(1);
    expect(town.completeAltarPrayer(p)).toBe(false);
    town.newDay();
    const born = town.people().at(-1)!;
    expect(town.population(0)).toBe(2);
    expect(born.role).toBe(Role.Resident);
    expect(born.calling).toBe(Calling.Settler);
    expect(born.village).toBe(0);
    expect(distance(born.position, altar.door())).toBeLessThan(0.75);
    expect(altar.devotionDueDay).toBe(-1);
    town.processDevotion();
    expect(town.population(0)).toBe(2);
  });
  it('reserves one same-settlement home across simultaneous altar orders and holds arrival if housing is lost', () => {
    const town = fixture(),
      altar = town.building(1)!;
    town.recruit(Role.Resident, Calling.Settler, 3, 0);
    const second = new Building(town.nextId++, Structure.Shrine, point(16, 8), 0, 0);
    second.village = 0;
    town.placed.push(second);
    ++town.changes;
    town.tick(0);
    const [first, other] = town.people();
    expect(town.orderPrayAtAltar([first.id], altar.id)).toBe(true);
    expect(town.prayerReason(other.id, second.id)).toContain('No free resident bed');
    advance(town, 25);
    expect(altar.devotionDueDay).toBeGreaterThanOrEqual(0);
    town.recruit(Role.Resident, Calling.Settler, 1, 0);
    town.newDay();
    expect(town.population(0)).toBe(5);
    expect(altar.devotionDueDay).toBeGreaterThanOrEqual(0);
    town.folk.pop();
    town.processDevotion();
    expect(town.population(0)).toBe(5);
    expect(altar.devotionDueDay).toBe(-1);
  });
  it('never accepts a guest, another faction, or resources and beds in a foreign camp', () => {
    const town = fixture(),
      other = secondSettlement(town),
      p = town.people()[0];
    const altar = new Building(town.nextId++, Structure.Shrine, point(21, 25), 0, 0);
    altar.faction = 1;
    altar.village = other.id;
    town.placed.push(altar);
    expect(town.orderPrayAtAltar([p.id], altar.id)).toBe(false);
    town.welcome(Calling.Traveller, null, 0);
    expect(town.orderPrayAtAltar([town.people().at(-1)!.id], 1)).toBe(false);
    town.stock(0).food = 3;
    expect(town.prayerReason(p.id, 1)).toContain('4 food');
    expect(town.stock(other.id).food).toBe(100);
    town.controlFaction = 1;
    town.recruit(Role.Resident, Calling.Settler, 1, other.id);
    const neutral = town.people().at(-1)!;
    expect(neutral.faction).toBe(1);
    expect(town.prayerReason(neutral.id, altar.id)).toBe('');
  });
  it('preserves pending birth day through a save and creates the same identity exactly once', () => {
    const town = fixture(),
      p = town.people()[0];
    expect(town.orderPrayAtAltar([p.id], 1)).toBe(true);
    advance(town, 25);
    expect(town.building(1)!.devotionDueDay).toBe(town.days + 1);
    const text = encodeTown(town),
      loaded = decodeTown(text, (map) => new Town(map, 32, false));
    expect(loaded).toBeTruthy();
    expect(loaded.building(1)!.devotionDueDay).toBe(town.building(1)!.devotionDueDay);
    town.newDay();
    loaded.newDay();
    const a = town.people().at(-1)!,
      b = loaded.people().at(-1)!;
    expect([b.id, b.name, b.look, b.faction, b.village]).toEqual([
      a.id,
      a.name,
      a.look,
      a.faction,
      a.village,
    ]);
    loaded.processDevotion();
    expect(loaded.population(0)).toBe(town.population(0));
  });
});

describe('guild professional oath', () => {
  it('cancels an unfinished ceremony through Stop without charging or retaining a profession choice', () => {
    const town = fixture(),
      p = town.people()[0],
      gold = town.stock(0).gold,
      food = town.stock(0).food;
    expect(town.orderTrainAtGuild(p.id, 2, Calling.Mage)).toBe(true);
    town.orderStop([p.id]);
    advance(town, 25);
    expect(p.trainingCalling).toBe(-1);
    expect(p.trained).toBe(false);
    expect(p.calling).toBe(Calling.Settler);
    expect(p.activity).toBe(Activity.Holding);
    expect(town.stock(0).gold).toBe(gold);
    expect(town.stock(0).food).toBe(food);
  });

  it.each([Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Bard])(
    'trains once after physical ceremony, preserving identity and level (%s)',
    (calling) => {
      const town = fixture(),
        p = town.people()[0],
        gold = town.stock(0).gold,
        food = town.stock(0).food;
      p.level = 4;
      p.experience = 17;
      const identity = [p.id, p.name, p.look, p.home, p.village, p.level, p.experience];
      expect(town.orderTrainAtGuild(p.id, 2, calling)).toBe(true);
      expect(p.calling).toBe(Calling.Settler);
      expect(town.completeGuildTraining(p)).toBe(false);
      expect(town.stock(0).gold).toBe(gold);
      advance(town, 25);
      expect(p.calling).toBe(calling);
      expect(p.trained).toBe(true);
      expect(p.trainingCalling).toBe(-1);
      expect([p.id, p.name, p.look, p.home, p.village, p.level, p.experience]).toEqual(identity);
      expect(town.stock(0).gold).toBe(gold - 12);
      expect(town.stock(0).food).toBe(food - 4);
      expect(town.building(2)!.trainingCount).toBe(1);
      expect(town.orderTrainAtGuild(p.id, 2, Calling.Mage)).toBe(false);
      expect(town.completeGuildTraining(p)).toBe(false);
    },
  );
  it('rechecks material availability on completion without overdrawing or changing profession', () => {
    const town = fixture(),
      p = town.people()[0];
    expect(town.orderTrainAtGuild(p.id, 2, Calling.Warrior)).toBe(true);
    town.stock(0).gold = 0;
    advance(town, 25);
    expect(p.calling).toBe(Calling.Settler);
    expect(p.trained).toBe(false);
    expect(town.stock(0).gold).toBe(0);
    expect(town.building(2)!.trainingCount).toBe(0);
    expect(p.task).toBe(Activity.Idle);
  });
  it('rejects visitors and preserves an in-transit oath choice and paid result through saves', () => {
    const town = fixture(),
      p = town.people()[0];
    town.welcome(Calling.Traveller, null, 0);
    expect(town.orderTrainAtGuild(town.people().at(-1)!.id, 2, Calling.Mage)).toBe(false);
    expect(town.orderTrainAtGuild(p.id, 2, Calling.Ranger)).toBe(true);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false));
    expect(loaded.person(p.id)!.trainingCalling).toBe(Calling.Ranger);
    advance(loaded, 25);
    const reloaded = decodeTown(encodeTown(loaded), (map) => new Town(map, 32, false));
    expect(reloaded.person(p.id)!.trained).toBe(true);
    expect(reloaded.person(p.id)!.calling).toBe(Calling.Ranger);
    expect(reloaded.trainingReason(p.id, 2, Calling.Mage)).toContain('already chosen');
  });
});
