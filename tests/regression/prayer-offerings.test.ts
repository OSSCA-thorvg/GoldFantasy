import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Activity, Calling, Person, Race, Role, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import { offeringKeys, offeringOutcome, offeringProfile } from '../../packages/engine/src/prayer-offering';
import { point } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { sharpAnchor } from '../../packages/engine/src/road-network';

let base: Town;
beforeAll(() => {
  const world = WorldMap.generate(5, 32, 32);
  world.ymir = world.fire = null;
  world.stream = { path: [], width: [] };
  for (const layer of world.layers) layer.fill(0.4);
  world.layer(Layer.Land).fill(1);
  world.layer(Layer.Ridge).fill(-1);
  for (let y = 0; y < 32; ++y)
    for (let x = 0; x < 32; ++x)
      Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
  world.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(28, 28), discovered: false }];
  world.reveal(16, 16, 100);
  base = new Town(world, 32, false);
  base.placed = [
    new Building(0, Structure.Camp, point(10, 10), 0, 0),
    new Building(1, Structure.Shrine, point(14, 10), 0, 0),
  ];
  base.nextId = 2;
  base.migrateSettlements();
  Object.assign(base.stock(), new Resources(100, 100, 100, 100, 100, 100, 0, 0, 100));
  const p = new Person(0, 'Worshipper', Role.Resident, Calling.Settler, Race.Human, 5, point(11, 12));
  p.home = p.village = 0;
  p.food = p.hydration = p.health = p.rest = 1;
  p.autoMode = false;
  base.folk = [p];
  base.nextPerson = 1;
  base.wildlifeDay = base.days;
  base.editHour(12);
  base.tick(0);
});
const fixture = () => copyNative(base);
function offering(): Resources {
  return new Resources(9, 0, 6, 8, 0, 7, 0, 0, 10);
}
function fillBeds(town: Town, leave = 0): void {
  while (town.population() < town.housing() - leave) {
    const p = copyNative(town.people()[0]);
    p.id = town.nextPerson++;
    town.folk.push(p);
  }
}

describe('offerings shape an unarmed resident', () => {
  it('does not replace a resident road assignment when a new resident is created', () => {
    const town = fixture(),
      p = town.people()[0];
    const path = [sharpAnchor(point(10, 8.8)), sharpAnchor(point(10, 4))];
    expect(town.buildRoad(path), town.canBuildRoad(path).reason).toBe(true);
    expect(town.orderRoadwork([p.id], town.roads().roads()[0].id)).toBe(true);
    town.advance(0.5);
    const worker = copyNative(p),
      clock = town.clock();
    expect(town.summonFromOffering(1, offering())).not.toBeNull();
    expect(p).toEqual(worker);
    expect(town.clock()).toBe(clock);
    expect(p.task).toBe(Activity.Roadwork);
  });
  it('pays all five configured resources once and preserves existing residents and simulation time', () => {
    const town = fixture();
    fillBeds(town, 1);
    const before = town.stock().clone(),
      gift = offering(),
      existing = encodeTown(town),
      worker = copyNative(town.people()[0]),
      clock = town.clock();
    expect(town.altarOfferingReason(1, gift)).toBe('');
    const born = town.summonFromOffering(1, gift)!;
    expect(born).not.toBeNull();
    expect(town.population()).toBe(town.housing());
    for (const key of offeringKeys) expect(town.stock()[key]).toBe(before[key] - gift[key]);
    expect(town.people()[0]).toEqual(worker);
    expect(town.clock()).toBe(clock);
    expect(born.inventory.every((item) => item === null)).toBe(true);
    expect(Object.values(born.equipment).every((slot) => slot === -1)).toBe(true);
    expect(born.purse).toBe(0);
    expect(born.home).toBe(0);
    expect(town.summonFromOffering(1, gift)).toBeNull(); // The only free bed was claimed atomically.
    for (const key of offeringKeys) expect(town.stock()[key]).toBe(before[key] - gift[key]);
    expect(encodeTown(town)).not.toBe(existing);
  });
  it('uses exactly the advertised level range and class probabilities without creating weapons', () => {
    const town = fixture(),
      gift = offering(),
      profile = offeringProfile(gift);
    vi.spyOn(town, 'roll').mockReturnValue(0);
    const born = town.summonFromOffering(1, gift)!;
    expect(born.calling).toBe(Calling.Warrior);
    expect(born.level).toBe(profile.levelMin);
    expect(born.trained).toBe(true);
    expect(born.attackMultiplier()).toBe(1);
    expect(born.vitalityMultiplier()).toBeCloseTo(profile.vitalityMin);
    expect(born.inventory.every((item) => item === null)).toBe(true);
  });
  for (const invalid of [0, -1, 0.5, NaN, Infinity, 10000])
    it(`rejects invalid or empty amounts (${invalid}) without payment or RNG changes`, () => {
      const town = fixture(),
        gift = new Resources();
      gift.bones = invalid;
      const before = encodeTown(town);
      expect(town.altarOfferingReason(1, gift)).not.toBe('');
      expect(town.summonFromOffering(1, gift)).toBeNull();
      expect(encodeTown(town)).toBe(before);
    });
  it('rejects insufficient stock, forbidden materials, foreign statues and missing housing', () => {
    for (const change of [
      (t: Town, gift: Resources) => {
        t.stock().bones = gift.bones - 1;
      },
      (_t: Town, gift: Resources) => {
        gift.wood = 1;
      },
      (t: Town) => {
        t.building(1)!.faction = 7;
      },
      (t: Town) => {
        fillBeds(t);
      },
    ]) {
      const town = fixture(),
        gift = offering();
      change(town, gift);
      const before = encodeTown(town);
      expect(town.summonFromOffering(1, gift)).toBeNull();
      expect(encodeTown(town)).toBe(before);
    }
  });
  it('lets the same total favor different classes and bounds expensive offerings', () => {
    const bone = new Resources(),
      water = new Resources(),
      gold = new Resources();
    bone.bones = water.water = gold.gold = 30;
    const chance = (gift: Resources, calling: Calling) =>
      offeringProfile(gift).classes.find((row) => row.calling === calling)!.chance;
    expect(chance(bone, Calling.Warrior)).toBeGreaterThan(chance(water, Calling.Warrior));
    expect(chance(water, Calling.Cleric)).toBeGreaterThan(chance(bone, Calling.Cleric));
    expect(chance(gold, Calling.Mage)).toBeGreaterThan(chance(bone, Calling.Mage));
    expect(offeringProfile(new Resources(0, 0, 0, 30)).specialistChance).toBeGreaterThan(
      offeringProfile(new Resources(0, 0, 0, 4)).specialistChance,
    );
    const max = new Resources(9999, 0, 9999, 9999, 0, 9999, 0, 0, 9999),
      p = offeringProfile(max);
    expect(p.levelMax).toBeLessThanOrEqual(8);
    expect(p.specialistChance).toBeLessThanOrEqual(0.85);
    expect(p.classes.reduce((sum, c) => sum + c.chance, 0)).toBeCloseTo(p.specialistChance);
    expect(offeringOutcome(max, () => 0.999999).calling).toBe(Calling.Settler);
    expect(offeringOutcome(max, () => 0.999999).level).toBe(p.levelMax);
  });
  it('round trips bones and the real resident result without replaying an arrival', () => {
    const town = fixture(),
      born = town.summonFromOffering(1, offering())!;
    town.people()[0].inventory[0] = { item: 'bones', quantity: 3 };
    town.people()[0].carriedProduct = Product.Bones;
    town.people()[0].carrying = 2;
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true))!;
    expect(loaded.stock().bones).toBe(town.stock().bones);
    expect(loaded.person(born.id)!.calling).toBe(born.calling);
    expect(loaded.person(born.id)!.level).toBe(born.level);
    expect(loaded.people()[0].inventory[0]).toEqual({ item: 'bones', quantity: 3 });
    expect(loaded.people()[0].carriedProduct).toBe(Product.Bones);
    loaded.advance(0.1);
    expect(loaded.population()).toBe(2);
  });
});

describe('bones are stored spoils', () => {
  it('awards bones once from an actual hunt, including food carried by a hungry hunter', () => {
    const town = fixture(),
      hunter = town.people()[0],
      before = town.stock().bones,
      animal = new Monster(99, -1, point(12, 12));
    animal.animal = AnimalKind.Pig;
    animal.health = 0;
    animal.provokedBy = hunter.id;
    hunter.hunting = true;
    hunter.foe = animal.id;
    hunter.food = 0.1;
    town.animals.push(animal);
    town.stirWildlife(0.1);
    expect(town.stock().bones).toBeGreaterThan(before);
    const after = town.stock().bones;
    town.stirWildlife(0.1);
    expect(town.stock().bones).toBe(after);
    expect(hunter.food).toBe(1);
  });
  it('awards bones on a lethal monster strike once, without touching food cargo', () => {
    const town = fixture(),
      p = town.people()[0],
      before = town.stock().bones,
      monster = new Monster(100, 0, point(12, 12));
    monster.health = 0.001;
    town.beasts.push(monster);
    town.strike(p, monster);
    expect(monster.health).toBeLessThanOrEqual(0);
    expect(town.stock().bones).toBe(before + 2);
    town.strike(p, monster);
    expect(town.stock().bones).toBe(before + 2);
  });
  it('includes bones in capacity and preserves stock when storage shrinks', () => {
    const town = fixture(),
      limit = town.capacity().bones;
    expect(limit).toBeGreaterThan(0);
    const gain = new Resources();
    gain.bones = limit * 2;
    town.store(gain, 0);
    expect(town.stock().bones).toBe(limit);
    expect(town.receipts().at(-1)!.gain.bones).toBe(limit - 100);
    expect(new Resources(0, 0, 0, 0, 0, 0, 0, 0, 4).clone().bones).toBe(4);
  });
});
