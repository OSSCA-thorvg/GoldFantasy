import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure, Product } from '../../packages/engine/src/building-catalog';
import { point, distance } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { addInventory } from '../../packages/engine/src/equipment';
import {
  heldAmount,
  packAmount,
  burdenPace,
  burdenStart,
  carriedWeight,
  carryCapacity,
  packTotal,
  stowCargo,
} from '../../packages/engine/src/carried-resources';

function fixture(workers = 1) {
  const size = 64,
    map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = { x: 12, y: 12 };
  map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [];
  map.reveal(size / 2, size / 2, size * 2);
  const town = new Town(map, size, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  town.placed.push(camp);
  town.nextId = 1;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(1000, 0, 0, 100, 0, 100));
  town.folk = Array.from({ length: workers }, (_, id) => {
    const p = new Person(id, 'Worker ' + id, Role.Resident, Calling.Settler, Race.Human, id, point(14 + id * 0.6, 12));
    p.home = p.village = 0;
    p.food = p.rest = p.hydration = p.health = 1;
    p.stress = 0;
    return p;
  });
  town.nextPerson = workers;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.tick(0);
  for (const p of town.folk) {
    p.path = [];
    p.task = p.activity = Activity.Idle;
    p.until = town.time;
  }
  return { town, camp, people: town.folk };
}
function site(town: Town, x: number, y: number, cost: Resources) {
  const b = new Building(town.nextId++, Structure.Tent, point(x, y), 0, 0);
  b.progress = 0;
  b.village = 0;
  b.materials.required = cost;
  town.placed.push(b);
  ++town.changes;
  return b;
}
function run(town: Town, seconds: number, until: () => boolean = () => false, each: () => void = () => {}) {
  for (let i = 0; i < seconds * 10 && !until(); ++i) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
    each();
  }
}

describe('resources stay with the people who gathered them', () => {
  it('stows loads until the pack is full and only then empties everything into storage', () => {
    const { town, people } = fixture(),
      p = people[0];
    for (let load = 0; load < 9; ++load) {
      p.carriedProduct = Product.Wood;
      p.carrying = 3;
      expect(town.keepCargo(p)).toBe(true);
    }
    addInventory(p, 'stone', 2);
    expect(packTotal(p)).toBe(29);
    expect(carriedWeight(p)).toBe(29);
    expect(burdenPace(p)).toBeLessThan(0.7);
    p.carrying = 3;
    expect(stowCargo(p)).toBe(false);
    expect(town.haulCargo(p)).toBe(true);
    run(town, 60, () => p.activity !== Activity.Hauling);
    expect(p.carrying).toBe(0);
    expect(packTotal(p)).toBe(0);
    expect(town.stock().wood).toBe(30);
    expect(town.stock().stone).toBe(2);
  });
  it('sends food and a workshop worker’s raw input to storage as before', () => {
    const { town, people } = fixture(),
      p = people[0],
      mill = new Building(town.nextId++, Structure.Sawmill, point(18, 12), 0, 0);
    mill.village = 0;
    town.placed.push(mill);
    p.carrying = 3;
    p.carriedProduct = Product.Food;
    expect(town.keepCargo(p)).toBe(false);
    p.carriedProduct = Product.Wood;
    p.job = mill.id;
    expect(town.keepCargo(p)).toBe(false);
    p.job = -1;
    expect(town.keepCargo(p)).toBe(true);
  });
  it('eats carried food on the spot', () => {
    const { town, people } = fixture(),
      p = people[0];
    addInventory(p, 'food', 2);
    p.food = 0.1;
    town.stock().food = 0;
    expect(town.eat(p)).toBe(true);
    expect(p.food).toBe(1);
    expect(packAmount(p, Product.Food)).toBe(1);
  });
});

describe('carried weight', () => {
  it('weighs resources, tools and weapons at a kilogram and worn gear at a tenth', () => {
    const { people } = fixture(),
      p = people[0];
    expect(carriedWeight(p)).toBe(0);
    addInventory(p, 'sword');
    addInventory(p, 'axe');
    addInventory(p, 'cap');
    addInventory(p, 'wood', 4);
    expect(carriedWeight(p)).toBe(6.1);
    p.carriedProduct = Product.Stone;
    p.carrying = 3;
    expect(carriedWeight(p)).toBe(9.1);
    expect(carryCapacity).toBe(30);
  });
  it('walks at full pace below fifteen kilograms and slows steadily above it', () => {
    const { town, people } = fixture(),
      p = people[0],
      free = town.walkingSpeed(p);
    addInventory(p, 'wood', 14);
    expect(burdenStart).toBe(15);
    expect(town.walkingSpeed(p)).toBe(free);
    addInventory(p, 'stone', 6);
    expect(town.walkingSpeed(p)).toBeLessThan(free);
    const half = town.walkingSpeed(p);
    addInventory(p, 'stone', 10);
    expect(town.walkingSpeed(p)).toBeLessThan(half);
    expect(town.walkingSpeed(p)).toBeCloseTo(free * 0.6);
  });
});

describe('construction supply', () => {
  it('builds straight from the builder’s own pack', () => {
    const { town, people } = fixture(),
      p = people[0],
      target = site(town, 18, 14, new Resources(0, 5));
    addInventory(p, 'wood', 8);
    expect(town.orderBuild([p.id], target.id)).toBe(true);
    const camp = town.camp()!.door();
    let nearCamp = false;
    run(town, 120, () => target.built(), () => (nearCamp ||= p.activity === Activity.FetchingMaterials && distance(p.position, camp) < 0.5));
    expect(target.built()).toBe(true);
    expect(nearCamp).toBe(false);
    expect(packAmount(p, Product.Wood)).toBe(3);
    expect(target.materials.delivered.wood).toBe(5);
  });
  it('takes what a neighbour carries hand to hand instead of walking to storage', () => {
    const { town, people } = fixture(2),
      [builder, carrier] = people,
      target = site(town, 18, 14, new Resources(0, 6));
    town.stock().wood = 100;
    addInventory(carrier, 'wood', 10);
    carrier.position = point(20, 15);
    town.setAuto(carrier.id, false);
    expect(town.orderBuild([builder.id], target.id)).toBe(true);
    let met = false;
    run(town, 120, () => target.built(), () => (met ||= builder.giver === carrier.id));
    expect(met).toBe(true);
    expect(target.built()).toBe(true);
    expect(packAmount(carrier, Product.Wood)).toBe(4);
    expect(town.stock().wood).toBe(100);
  });
  it('has each builder bring what is in their own pack instead of waiting on the others', () => {
    const { town, people } = fixture(3),
      target = site(town, 18, 14, new Resources(0, 4));
    // Between them the crew holds more than the site lacks; nobody may count on the rest and stand still.
    for (const p of people) addInventory(p, 'wood', 2);
    expect(town.orderBuild(people.map((p) => p.id), target.id)).toBe(true);
    run(town, 120, () => target.built());
    expect(target.materials.delivered.wood).toBe(4);
    expect(target.built()).toBe(true);
    expect(people.reduce((sum, p) => sum + packAmount(p, Product.Wood) + p.carrying, 0)).toBe(2);
  });
  it('does not wait for materials held by a crew mate who has gone to rest', () => {
    const { town, people } = fixture(2),
      [builder, sleeper] = people,
      target = site(town, 18, 14, new Resources(0, 4));
    for (let x = 22; x < 26; ++x) for (let y = 12; y < 16; ++y) town.map().at(x, y).trees = 3;
    ++town.changes;
    addInventory(sleeper, 'wood', 6);
    expect(town.orderBuild([builder.id, sleeper.id], target.id)).toBe(true);
    // The mate keeps the job but lies far off asleep with the wood in their pack.
    sleeper.position = point(40, 40);
    sleeper.activity = Activity.Sleeping;
    sleeper.path = [];
    sleeper.until = town.time + 1e6;
    run(town, 240, () => target.built(), () => {
      sleeper.activity = Activity.Sleeping;
      sleeper.path = [];
    });
    expect(target.built()).toBe(true);
    expect(packAmount(sleeper, Product.Wood)).toBe(6);
  });
  it('says once what a site waits for when nobody can supply it, and builds it once the material can be had', () => {
    const { town, people } = fixture(),
      p = people[0],
      target = site(town, 18, 14, new Resources(0, 0, 4));
    // No rock on this map and no stone in store: there is nothing to build with yet.
    expect(town.orderBuild([p.id], target.id)).toBe(true);
    run(town, 20);
    const told = () => town.notices.filter((text) => text === 'No stone in sight for the Tent: explore to find some');
    expect(told()).toHaveLength(1);
    // The builder is free for other work rather than stuck on an order that cannot advance.
    expect(p.ordered).toBe(false);
    expect(p.autoMode).toBe(true);
    town.stock().stone = 4;
    expect(town.orderBuild([p.id], target.id)).toBe(true);
    run(town, 120, () => target.built());
    expect(target.built()).toBe(true);
    expect(told()).toHaveLength(1);
  });
  it('sends every builder of a site to gather, not one while the others wait', () => {
    const { town, people } = fixture(3),
      target = site(town, 18, 14, new Resources(0, 18));
    for (let x = 22; x < 28; ++x) for (let y = 12; y < 18; ++y) town.map().at(x, y).trees = 3;
    ++town.changes;
    expect(town.orderBuild(people.map((p) => p.id), target.id)).toBe(true);
    const gatherers = new Set<number>();
    let idleWaits = 0;
    run(town, 400, () => target.built(), () => {
      for (const p of people) {
        if (p.activity === Activity.Felling) gatherers.add(p.id);
        if (p.activity === Activity.WaitingMaterials && people.some((o) => o.activity === Activity.Felling)) ++idleWaits;
      }
    });
    expect(target.built()).toBe(true);
    expect(gatherers.size).toBe(3);
    expect(idleWaits).toBeLessThan(40);
  });
  it('clears the whole way first, then lays the road in one unbroken walk', () => {
    const { town, people } = fixture(),
      p = people[0];
    for (const x of [20, 24, 28]) town.map().at(x, 12).trees = 1;
    ++town.changes;
    expect(town.buildRoad([sharpAnchor(point(13.2, 12)), sharpAnchor(point(32, 12))])).toBe(true);
    const road = town.roads().roads()[0],
      trees = () => [20, 24, 28].reduce((sum, x) => sum + town.map().at(x, 12).trees, 0);
    expect(town.orderRoadwork([p.id], road.id)).toBe(true);
    let furthest = 0,
      retreatWhileLaying = 0,
      interruptions = 0,
      turnsBack = 0,
      heading = 0,
      before = p.position.x,
      laying = false;
    run(town, 900, () => road.built >= 1, () => {
      const step = p.position.x - before;
      if (Math.abs(step) > 0.01) {
        const now = Math.sign(step);
        if (now < 0 && heading > 0) ++turnsBack;
        heading = now;
      }
      before = p.position.x;
      if (road.built > 0.02) {
        if (!laying) furthest = p.position.x;
        laying = true;
        // Nothing is left to clear once laying has begun.
        expect(trees()).toBe(0);
        if (p.activity !== Activity.Roadwork) ++interruptions;
        furthest = Math.max(furthest, p.position.x);
        retreatWhileLaying = Math.max(retreatWhileLaying, furthest - p.position.x);
      }
    });
    expect(road.built).toBe(1);
    expect(trees()).toBe(0);
    // One walk back from the last tree to the start; each felled tree used to cost a
    // trip to the camp, and later a trip ahead and back.
    expect(turnsBack).toBe(1);
    expect(interruptions).toBe(0);
    expect(retreatWhileLaying).toBeLessThan(0.5);
    expect(heldAmount(p, Product.Wood)).toBe(9);
    expect(town.stock().wood).toBe(0);
  });
  it('walks a short hop over open ground straight instead of by the nearest lane', () => {
    const { town, people } = fixture(),
      p = people[0];
    expect(town.buildRoad([sharpAnchor(point(13.2, 12)), sharpAnchor(point(20, 12))])).toBe(true);
    const road = town.roads().roads()[0];
    road.built = 1;
    town.roadChanged();
    town.advance(0.1);
    // Beside the road, crossing a tile boundary: the planner alone would send the walker onto the lane first.
    p.position = point(15.95, 12.42);
    expect(town.walkTo(p, point(16.3, 12.42))).toBe(true);
    expect(p.path).toEqual([point(16.3, 12.42)]);
    expect(town.walkTo(p, point(19.5, 12.42))).toBe(true);
    expect(p.path.length).toBeGreaterThanOrEqual(1);
  });
});
