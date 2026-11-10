import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Product, Resources, Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';

function fixture(automatic = false) {
  const map = new WorldMap();
  map.columns = map.rows = 40;
  map.mapSeed = 5;
  map.origin = point(20, 20);
  map.tiles = Array.from({ length: 1600 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(81 * 81).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.stream.path = [point(26, 0), point(26, 40)];
  map.stream.width = [2, 2];
  for (let y = 0; y < 40; y++) for (let x = 25; x <= 26; x++) map.at(x, y).terrain = Terrain.Water;
  map.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(16, 16), discovered: true }];
  map.reveal(20, 20, 100);
  const town = new Town(map, 40, false);
  expect(town.place(Structure.Camp, point(20, 20), 0)).toBe(true);
  town.completeConstruction();
  town.stock().add(new Resources(100, 1, 100, 100));
  const path = [sharpAnchor(point(21.2, 20)), sharpAnchor(point(32, 20))];
  expect(town.buildRoad(path), town.canBuildRoad(path).reason).toBe(true);
  const road = town.network.list.at(-1)!;
  expect(road.materials.required.wood).toBeGreaterThan(road.materials.delivered.wood);
  const worker = new Person(0, 'Builder', Role.Resident, Calling.Settler, Race.Human, 5, point(21.2, 20));
  worker.home = worker.village = town.camp()!.id;
  worker.autoMode = automatic;
  worker.food = worker.hydration = worker.rest = worker.health = 1;
  worker.inventory[0] = { item: 'hammer', quantity: 1 };
  worker.inventory[1] = { item: 'axe', quantity: 1 };
  worker.equipment.tool1 = 1;
  worker.equipment.tool2 = 2;
  town.folk = [worker];
  town.nextPerson = 1;
  town.animals = [];
  town.beasts = [];
  town.tick(0);
  return { town, worker, road };
}
type Fixture = ReturnType<typeof fixture>;
function diagnostic({ town, worker: p, road }: Fixture): string {
  return JSON.stringify({
    time: town.clock(),
    activity: Activity[p.activity],
    task: Activity[p.task],
    site: p.taskSite,
    target: p.target,
    supplyTarget: p.supplyTarget,
    supplyRoad: p.supplyRoad,
    ordered: p.ordered,
    cargo: p.carrying,
    position: p.position,
    path: p.path,
    built: road.built,
    delivered: road.materials.delivered,
    until: p.until,
  });
}
function until(v: Fixture, done: () => boolean, seconds = 120): void {
  for (let i = 0; i < seconds * 10 && !done(); i++) v.town.advance(0.1);
  expect(done(), diagnostic(v)).toBe(true);
}
function assigned(v: Fixture, automatic = false): void {
  if (automatic) expect(v.town.scheduleAutomatic(v.worker)).toBe(true);
  else expect(v.town.orderRoadwork([v.worker.id], v.road.id)).toBe(true);
  expect(v.worker.task).toBe(Activity.Roadwork);
  expect(v.worker.taskSite).toBe(v.road.id);
}
function retains(v: Fixture, automatic = false): void {
  expect(v.worker.task, diagnostic(v)).toBe(Activity.Roadwork);
  expect(v.worker.taskSite, diagnostic(v)).toBe(v.road.id);
  expect(v.worker.ordered).toBe(!automatic);
  expect(v.worker.autoMode).toBe(automatic);
}

describe('road supply transactions remain assigned until completion or cancellation', () => {
  for (const automatic of [false, true])
    it(`${automatic ? 'automatic' : 'direct'} bridge waits for missing wood and completes when stock returns`, () => {
      const v = fixture(automatic);
      assigned(v, automatic);
      until(v, () => v.worker.activity === Activity.WaitingMaterials, 15);
      expect(v.road.built).toBeGreaterThan(0);
      expect(v.road.built).toBeLessThan(1);
      const progress = v.road.built;
      for (let i = 0; i < 100; i++) {
        v.town.advance(0.1);
        retains(v, automatic);
        expect(v.road.built).toBe(progress);
      }
      v.town.stock().wood += v.road.materials.missing(Product.Wood);
      until(v, () => v.road.built === 1);
      expect(v.road.materials.delivered.wood).toBe(v.road.materials.required.wood);
      until(v, () => v.worker.task === Activity.Idle, 5);
      expect(v.worker.autoMode).toBe(true);
    });

  it('retains harvested cargo through a temporarily blocked delivery route and resumes real delivery', () => {
    const v = fixture(),
      { town, worker, road } = v,
      map = town.map();
    // The resource grove has one dry approach. A different construction finishing
    // across that approach temporarily blocks the return leg after harvesting.
    for (let x = 0; x < 40; x++) map.at(x, 17).terrain = Terrain.Water;
    map.at(22, 17).terrain = Terrain.Grass;
    map.at(22, 14).trees = 3;
    ++town.changes;
    town.tick(0);
    assigned(v);
    until(v, () => worker.activity === Activity.Collecting && worker.carrying === 3, 40);
    expect(town.grid.path(worker.position, road.workPoint()).length).toBeGreaterThan(0);
    expect(
      town.place(Structure.Tent, point(22.5, 17.5), 0),
      town.canPlace(Structure.Tent, point(22.5, 17.5), 0).reason,
    ).toBe(true);
    const blocker = town.placed.at(-1)!;
    // This checkpoint represents the unrelated building's completion, not a
    // mocked walk failure; every retry uses the actual updated collision grid.
    blocker.progress = 1;
    blocker.materials.delivered = blocker.materials.required.clone();
    ++town.changes;
    town.tick(0);
    expect(town.grid.path(worker.position, road.workPoint())).toEqual([]);
    until(v, () => worker.activity === Activity.WaitingMaterials, 5);
    const progress = road.built;
    for (let i = 0; i < 60; i++) {
      town.advance(0.1);
      retains(v);
      expect(worker.carrying).toBe(3);
      expect(road.built).toBe(progress);
    }
    expect(town.demolish(blocker.center)).toBe(true);
    const activities = new Set<Activity>();
    for (let i = 0; i < 1800 && road.built < 1; i++) {
      town.advance(0.1);
      activities.add(worker.activity);
      if (road.built < 1) retains(v);
    }
    expect(activities.has(Activity.DeliveringMaterials), diagnostic(v)).toBe(true);
    expect(road.built, diagnostic(v)).toBe(1);
  });

  it('honors a player Stop while awaiting materials and does not restart when stock returns', () => {
    const v = fixture();
    assigned(v);
    until(v, () => v.worker.activity === Activity.WaitingMaterials, 15);
    const progress = v.road.built;
    v.town.orderStop([v.worker.id]);
    v.town.stock().wood += 100;
    for (let i = 0; i < 100; i++) v.town.advance(0.1);
    expect(v.road.built).toBe(progress);
    expect(v.worker.task).toBe(Activity.Idle);
    expect(v.worker.taskSite).toBe(-1);
    expect(v.worker.activity).toBe(Activity.Holding);
    expect(v.worker.autoMode).toBe(false);
  });
});
