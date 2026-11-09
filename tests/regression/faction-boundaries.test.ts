import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain, Layer } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Person, Role, Calling, Race, Activity } from '../../packages/engine/src/person';
import { Structure, Resources, Product } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { Road, sharpAnchor, flatten } from '../../packages/engine/src/road-network';
import { copyNative } from '../../packages/engine/src/native-copy';

let base: Town;
beforeAll(() => {
  const world = WorldMap.generate(5, 96, 96);
  world.ymir = world.fire = null;
  world.sites = [];
  world.stream = { path: [], width: [] };
  for (const layer of world.layers) layer.fill(0.4);
  world.layer(Layer.Land).fill(1);
  world.layer(Layer.Ridge).fill(-1);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 96; x++)
      Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
  world.reveal(48, 48, 200);
  base = new Town(world, 96, false);
  base.placed = [
    new Building(0, Structure.Camp, point(16, 16), 0, 0),
    new Building(1, Structure.Camp, point(72, 16), 0, 0),
    new Building(2, Structure.Granary, point(68, 16), 0, 0),
    new Building(3, Structure.Hostel, point(68, 20), 0, 0),
    new Building(4, Structure.Well, point(72, 20), 0, 0),
    new Building(5, Structure.Tavern, point(76, 20), 0, 0),
    new Building(6, Structure.Tent, point(22, 17.2), 0, 0),
    new Building(7, Structure.Tent, point(78, 17.2), 0, 0),
  ];
  for (const b of base.placed) {
    b.faction = [0, 6].includes(b.id) ? 0 : 1;
    b.village = b.faction === 0 ? 0 : 1;
  }
  base.placed[6].progress = base.placed[7].progress = 0;
  base.placed[6].materials.required.planks = base.placed[7].materials.required.planks = 3;
  base.nextId = 8;
  base.foundSettlement(0);
  base.foundSettlement(1);
  Object.assign(base.stock(0), new Resources());
  Object.assign(base.stock(1), new Resources(9, 7, 7, 7, 0, 7, 7, 7));
  const p = new Person(0, 'Player worker', Role.Resident, Calling.Settler, Race.Human, 0, point(20, 16));
  p.faction = 0;
  p.village = p.home = 0;
  p.food = p.rest = p.hydration = p.health = 1;
  p.stress = 0;
  const n = new Person(
    1,
    'Neutral worker',
    Role.Resident,
    Calling.Settler,
    Race.Human,
    1,
    base.placed[1].door(),
  );
  n.faction = 1;
  n.village = n.home = 1;
  n.food = n.rest = n.hydration = n.health = 1;
  n.stress = 0;
  base.folk = [p, n];
  base.nextPerson = 2;
  base.editHour(12);
  base.wildlifeDay = base.days;
  base.tick(0);
  for (const person of base.folk) {
    person.task = person.activity = Activity.Idle;
    person.target = person.taskSite = -1;
    person.ordered = person.approachingOrder = person.aggressive = false;
    person.path = [];
    person.scheduleAt = 10000;
    person.until = 10000;
  }
});
function fixture() {
  return copyNative(base);
}
function step(town: Town, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
  }
}
function supplyRoad(town: Town, village: number): Road {
  const x = village === 0 ? 16 : 72,
    path = [sharpAnchor(point(x + 1.2, 16)), sharpAnchor(point(x + 6, 16))];
  const road = new Road(town.network.nextId++, path, flatten(path));
  road.village = village;
  road.faction = town.camp(village)!.faction;
  town.network.list.push(road);
  return road;
}
function buildOrder(town: Town, person = 0, site = 6) {
  const p = town.person(person)!;
  town.setOrder(p, Activity.Building, site);
  p.activity = Activity.Building;
  p.supplyTarget = site;
  return p;
}

describe('needs stay within affiliation boundaries', () => {
  it.each([Activity.Eating, Activity.Sleeping])(
    'rejects a stale foreign visit on arrival before consuming stock or entering (%s)',
    (activity) => {
      const town = fixture(),
        p = town.person(0)!,
        place = town.building(3)!;
      p.position = place.door();
      p.path = [];
      p.activity = activity;
      p.target = place.id;
      p.food = 0.1;
      p.rest = 0.1;
      p.carrying = 2;
      p.carriedProduct = Product.Wood;
      const stock = town.stock(1).clone();
      expect(p.approachingOrder).toBe(false);
      expect(place.faction).toBe(1);
      expect(p.faction).toBe(0);
      town.arrive(p);
      expect(town.stock(1)).toEqual(stock);
      expect(p.inside).toBe(false);
      expect(p.activity).toBe(Activity.Idle);
      expect(p.target).toBe(-1);
      expect(p.carrying).toBe(2);
      expect(p.food).toBe(0.1);
    },
  );

  it('does not eat the nearby neutral granary when the player pantry is empty', () => {
    const town = fixture(),
      p = town.person(0)!;
    p.position = town.building(2)!.door();
    p.food = 0.1;
    const accepted = town.eat(p);
    step(town, 8);
    expect(town.stock(1).food).toBe(7);
    expect(accepted).toBe(false);
    expect(p.food).toBeLessThan(0.2);
  });
  it('rejects a stale foreign home as a food source, while a neutral resident uses its own camp', () => {
    const town = fixture(),
      p = town.person(0)!;
    p.home = 1;
    p.position = town.building(1)!.door();
    p.food = 0.1;
    expect(town.eat(p)).toBe(false);
    expect(town.stock(1).food).toBe(7);
    town.controlFaction = 1;
    const n = town.person(1)!;
    n.food = 0.1;
    n.position = town.building(1)!.door();
    expect(town.eat(n)).toBe(true);
    step(town, 8);
    expect(town.stock(1).food).toBe(6);
    expect(town.stock(0).food).toBe(0);
  });
  it('keeps a guest away from foreign beds and taverns', () => {
    const town = fixture(),
      p = town.person(0)!;
    p.role = Role.Guest;
    p.home = -1;
    p.bed = 3;
    p.rest = 0.1;
    p.position = town.building(3)!.door();
    expect(town.takeBreak(p)).toBe(true);
    expect(p.target).not.toBe(3);
    expect(town.stock(1).gold).toBe(9);
    p.path = [];
    p.inside = false;
    p.doorway = 0;
    p.rest = 1;
    p.stress = 0.9;
    expect(town.takeBreak(p)).toBe(true);
    expect(p.target).not.toBe(5);
  });
  it('drinks only from a matching settlement and faction, preserving foreign water', () => {
    const town = fixture(),
      p = town.person(0)!;
    p.position = town.building(4)!.door();
    p.hydration = 0.1;
    town.drink(p);
    expect(town.building(p.target)?.faction ?? p.faction).toBe(0);
    expect(town.stock(1).water).toBe(7);
    town.controlFaction = 1;
    const n = town.person(1)!;
    n.position = town.building(4)!.door();
    n.hydration = 0.1;
    expect(town.drink(n)).toBe(true);
    step(town, 8);
    expect(town.stock(1).water).toBe(6);
  });
});

describe('construction material affiliation boundaries', () => {
  it('keeps road ownership after its camp is destroyed and reclaims only own orphan surplus', () => {
    const town = fixture(),
      p = buildOrder(town),
      own = supplyRoad(town, 0),
      foreign = supplyRoad(town, 1);
    own.materials.delivered.planks = 4;
    foreign.materials.delivered.planks = 5;
    town.raze(0);
    town.raze(1);
    expect(town.camp(0)).toBeNull();
    expect(town.camp(1)).toBeNull();
    expect(town.constructionSupplyCamp(Activity.Roadwork, own.id)).toBe(-1);
    expect(town.collectConstructionSurplus(p, Activity.Roadwork, foreign.id)).toBe(false);
    expect(town.collectConstructionSurplus(p, Activity.Roadwork, own.id)).toBe(true);
    p.target = -own.id - 2;
    town.fetchConstructionMaterials(p);
    expect(p.carrying).toBe(3);
    expect(own.materials.delivered.planks).toBe(1);
    expect(foreign.materials.delivered.planks).toBe(5);
  });

  it('does not reserve neutral roadside stock through the player context', () => {
    const town = fixture();
    supplyRoad(town, 1);
    expect(town.roadReady(town.network.list[0].id)).toBe(true);
    town.reserveConstructionMaterials(Activity.Building, 7);
    expect(town.stock(1).planks).toBe(7);
    expect(town.building(7)!.materials.delivered.planks).toBe(0);
    expect(town.constructionSupplyCamp(Activity.Building, 7)).toBe(-1);
    town.controlFaction = 1;
    town.reserveConstructionMaterials(Activity.Building, 7);
    expect(town.stock(1).planks).toBe(4);
    expect(town.building(7)!.materials.delivered.planks).toBe(3);
  });
  it('does not walk across the world to fetch neutral supplies for a player construction site', () => {
    const town = fixture(),
      p = buildOrder(town);
    expect(town.prepareConstruction(p, Activity.Building, 6)).toBe(true);
    step(town, 90);
    expect(town.stock(1).planks).toBe(7);
    expect(town.building(6)!.materials.delivered.planks).toBe(0);
    expect(p.target).not.toBe(1);
  });
  it('rejects a stale foreign camp pickup at transaction time without taking stock', () => {
    const town = fixture(),
      p = buildOrder(town);
    p.target = 1;
    p.carriedProduct = Product.Planks;
    town.fetchConstructionMaterials(p);
    expect(town.stock(1).planks).toBe(7);
    expect(p.carrying).toBe(0);
  });
  it('does not take foreign building surplus or deliver player cargo into a foreign worksite', () => {
    const town = fixture(),
      p = buildOrder(town),
      source = town.building(7)!;
    source.materials.delivered.planks = 6;
    p.target = source.id;
    p.carriedProduct = Product.Planks;
    town.fetchConstructionMaterials(p);
    expect(source.materials.delivered.planks).toBe(6);
    expect(p.carrying).toBe(0);
    p.supplyTarget = source.id;
    p.supplyRoad = false;
    p.carrying = 3;
    town.deliverConstructionMaterials(p);
    expect(source.materials.delivered.planks).toBe(6);
    expect(p.carrying).toBe(3);
  });
  it('does not collect foreign road surplus, including an in-transit road pickup', () => {
    const town = fixture(),
      p = buildOrder(town),
      road = supplyRoad(town, 1);
    road.materials.delivered.planks = 4;
    expect(town.collectConstructionSurplus(p, Activity.Roadwork, road.id)).toBe(false);
    p.supplyRoad = false;
    p.supplyTarget = 6;
    p.target = -road.id - 2;
    p.carriedProduct = Product.Planks;
    town.fetchConstructionMaterials(p);
    expect(road.materials.delivered.planks).toBe(4);
    expect(p.carrying).toBe(0);
  });
  it('allows a neutral worker to fetch and deliver only its own finite stock', () => {
    const town = fixture();
    town.controlFaction = 1;
    const p = buildOrder(town, 1, 7);
    p.target = 1;
    p.carriedProduct = Product.Planks;
    town.fetchConstructionMaterials(p);
    expect(p.carrying).toBe(3);
    expect(town.stock(1).planks).toBe(4);
    expect(town.stock(0).planks).toBe(0);
    town.deliverConstructionMaterials(p);
    expect(p.carrying).toBe(0);
    expect(town.building(7)!.materials.delivered.planks).toBe(3);
  });
});

describe('daily accounting affiliation boundaries', () => {
  it('does not credit orphan neutral-home rent to the player provisions', () => {
    const town = fixture(),
      neutral = town.person(1)!,
      home = town.building(7)!;
    home.progress = 1;
    neutral.home = home.id;
    neutral.worked = 0;
    neutral.purse = 10;
    town.raze(1);
    town.provisions.stock.gold = 50;
    expect(town.settlementOf(neutral)).toBe(-1);
    const projected = town.forecast(-1).rent;
    town.settleAccounts();
    expect(town.provisions.stock.gold).toBe(50);
    expect(neutral.purse).toBe(10);
    expect(projected).toBe(0);
  });

  it('does not pay an unassociated neutral worker from the player provisions', () => {
    const town = fixture(),
      neutral = town.person(1)!;
    town.raze(1);
    neutral.home = neutral.village = neutral.job = -1;
    neutral.worked = Town.paidWorkSeconds;
    neutral.purse = 0;
    town.provisions.stock.gold = 50;
    expect(town.settlementOf(neutral)).toBe(-1);
    const projected = town.forecast(-1).wages;
    town.settleAccounts();
    expect(town.provisions.stock.gold).toBe(50);
    expect(neutral.purse).toBe(0);
    expect(neutral.worked).toBe(0);
    expect(projected).toBe(0);
  });

  it('still pays a player founder without a camp and excludes foreign residents from that forecast', () => {
    const town = fixture(),
      player = town.person(0)!,
      neutral = town.person(1)!;
    town.raze(0);
    town.raze(1);
    for (const p of [player, neutral]) {
      p.home = p.village = p.job = -1;
      p.worked = Town.paidWorkSeconds;
      p.purse = 0;
    }
    town.provisions.stock.gold = 50;
    expect(town.forecast(-1).wages).toBe(3);
    town.settleAccounts();
    expect(town.provisions.stock.gold).toBe(47);
    expect(player.purse).toBe(3);
    expect(neutral.purse).toBe(0);
  });

  it('keeps an associated neutral settlement wage and forecast in its own treasury', () => {
    const town = fixture(),
      neutral = town.person(1)!;
    neutral.worked = Town.paidWorkSeconds;
    neutral.purse = 0;
    town.provisions.stock.gold = 50;
    expect(town.forecast(0).wages).toBe(0);
    expect(town.forecast(1).wages).toBe(3);
    town.settleAccounts();
    expect(town.provisions.stock.gold).toBe(50);
    expect(town.stock(0).gold).toBe(0);
    expect(town.stock(1).gold).toBe(6);
    expect(neutral.purse).toBe(3);
  });
});
