import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind, makeTile } from '../../packages/engine/src/world-types';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { Activity, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { point, add, scale, distance, Footprint } from '../../packages/engine/src/geometry';
import { RoadNetwork, sharpAnchor } from '../../packages/engine/src/road-network';
import { footBounds } from '../../packages/engine/src/person-collision';

function fixture(angle = 0, complete = true) {
  const map = new WorldMap();
  map.columns = map.rows = 40;
  map.mapSeed = 5;
  map.origin = point(20, 20);
  map.tiles = Array.from({ length: 1600 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(81 * 81).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(16, 16), discovered: true }];
  map.reveal(20, 20, 100);
  const town = new Town(map, 40, false),
    direction = point(Math.cos(angle), Math.sin(angle)),
    normal = point(-direction.y, direction.x),
    center = point(20, 20);
  expect(town.place(Structure.Camp, center, 0), town.canPlace(Structure.Camp, center, 0).reason).toBe(true);
  town.completeConstruction();
  town.stock().add(new Resources(100, 100, 100, 100, 100, 100));
  const from = add(center, scale(direction, 1.2)),
    to = add(center, scale(direction, 12)),
    middle = add(center, scale(direction, 7));
  const path = [sharpAnchor(from), sharpAnchor(to)];
  expect(town.buildRoad(path), town.canBuildRoad(path).reason).toBe(true);
  const road = town.network.list.at(-1)!;
  if (complete) town.completeConstruction();
  const worker = new Person(0, 'Road worker', Role.Resident, Calling.Settler, Race.Human, 5, from);
  worker.home = worker.village = town.camp()!.id;
  worker.autoMode = false;
  worker.food = worker.rest = worker.health = worker.hydration = 1;
  town.folk = [worker];
  town.nextPerson = 1;
  town.titleAutoplay = true;
  town.tick(0);
  const flank = () => {
    const buildings = [];
    for (const side of [-1, 1]) {
      const requested = add(middle, scale(normal, side * 0.9)),
        fitted = town.fit(Structure.Tent, requested, 0);
      expect(fitted.snapped).toBe(true);
      expect(
        town.place(Structure.Tent, fitted.center, fitted.angle),
        town.canPlace(Structure.Tent, fitted.center, fitted.angle).reason,
      ).toBe(true);
      const building = town.placed.at(-1)!;
      building.progress = 1;
      for (const key of ['wood', 'stone', 'planks', 'cutStone'] as const)
        building.materials.delivered[key] = building.materials.required[key];
      buildings.push(building);
    }
    ++town.changes;
    town.tick(0);
    return buildings;
  };
  return { town, worker, road, from, to, middle, flank, map: town.map() };
}
const orientations = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
describe('roads remain open between legally placed buildings', () => {
  for (const angle of orientations)
    it(`preserves the road center and actual travel after opposite fitted tents (${angle})`, () => {
      const { town, worker, road, from, to, middle, flank } = fixture(angle);
      expect(town.grid.walkable(middle)).toBe(true);
      const buildings = flank();
      expect(
        town.grid.blockedBy(middle),
        JSON.stringify(buildings.map((b) => ({ center: b.center, angle: b.angle }))),
      ).toBe(false);
      expect(
        town.grid.walkable(middle),
        `road center ${JSON.stringify(middle)} became a blocked whole cell`,
      ).toBe(true);
      town.orderMove([worker.id], to);
      expect(worker.path.length).toBeGreaterThan(0);
      let passed = false;
      for (let i = 0; i < 300 && distance(worker.position, to) > 0.05; ++i) {
        town.advance(0.05);
        expect(town.grid.blockedBy(worker.position), 'a route must not enter the solid building').toBe(false);
        expect(
          town.network.distance(worker.position).distance,
          'walking must retain the clear road corridor',
        ).toBeLessThan(0.31);
        passed ||= distance(worker.position, middle) < 0.5;
      }
      expect(passed).toBe(true);
      expect(distance(worker.position, to)).toBeLessThan(0.05);
      town.orderMove([worker.id], from);
      expect(worker.path.length).toBeGreaterThan(0);
      for (let i = 0; i < 300 && distance(worker.position, from) > 0.05; ++i) town.advance(0.05);
      expect(distance(worker.position, from)).toBeLessThan(0.05);
      expect(road.built).toBe(1);
    });
  for (const angle of orientations)
    it(`enters and leaves the home door facing the opposite building (${angle})`, () => {
      const { town, worker, from, flank } = fixture(angle);
      const [home] = flank();
      worker.home = home.id;
      worker.rest = 0.2;
      expect(town.grid.walkable(home.door())).toBe(true);
      expect(town.orderRest([worker.id], home.id)).toBe(true);
      for (let i = 0; i < 400 && worker.doorway < 1; ++i) {
        town.advance(0.05);
        if (!worker.inside && !worker.crossingDoorway())
          expect(town.grid.blockedBy(worker.position)).toBe(false);
      }
      expect(worker.inside).toBe(true);
      expect(worker.doorway).toBe(1);
      expect(town.orderLeave([worker.id])).toBe(true);
      for (let i = 0; i < 100 && worker.crossingDoorway(); ++i) town.advance(0.05);
      expect(worker.inside).toBe(false);
      expect(worker.doorway).toBe(0);
      town.orderMove([worker.id], from);
      for (let i = 0; i < 400 && distance(worker.position, from) > 0.05; ++i) town.advance(0.05);
      expect(worker.inside).toBe(false);
      expect(worker.doorway).toBe(0);
      expect(distance(worker.position, from)).toBeLessThan(0.05);
    });
  it.each(orientations)('finishes an initially unbuilt road between buildings (%s)', (angle) => {
    const { town, worker, road, flank } = fixture(angle, false);
    flank();
    expect(town.orderRoadwork([worker.id], road.id)).toBe(true);
    for (let i = 0; i < 1800 && road.built < 1; ++i) {
      town.advance(0.1);
    }
    expect(
      road.built,
      JSON.stringify({
        activity: Activity[worker.activity],
        position: worker.position,
        path: worker.path,
        built: road.built,
      }),
    ).toBe(1);
  });
  it('mines and delivers missing stone to complete paving in the same corridor', () => {
    const { town, worker, road, flank, map } = fixture();
    flank();
    town.stock().stone = 0;
    for (let y = 22; y <= 25; ++y) for (let x = 22; x <= 25; ++x) map.at(x, y).terrain = Terrain.Rock;
    ++town.changes;
    town.tick(0);
    expect(town.pave(road.id)).toBe(true);
    expect(town.orderRoadwork([worker.id], road.id)).toBe(true);
    const activities = new Set<Activity>();
    for (let i = 0; i < 1800 && !road.paved; ++i) {
      town.advance(0.1);
      activities.add(worker.activity);
    }
    expect(
      road.paved,
      JSON.stringify({ activity: Activity[worker.activity], position: worker.position, paving: road.paving }),
    ).toBe(true);
    expect(road.materials.required.stone).toBeGreaterThan(0);
    expect(activities.has(Activity.Mining)).toBe(true);
    expect(activities.has(Activity.DeliveringMaterials)).toBe(true);
    expect(road.materials.delivered.stone).toBeGreaterThanOrEqual(road.materials.required.stone);
  });
  it.each([1, 2])('repairs the same corridor with %s workers without crossing a building', (count) => {
    const { town, worker, road, from, flank } = fixture();
    flank();
    if (count === 2) {
      const second = new Person(
        1,
        'Second worker',
        Role.Resident,
        Calling.Settler,
        Race.Human,
        6,
        point(from.x + 0.2, from.y),
      );
      second.home = second.village = town.camp()!.id;
      second.autoMode = false;
      town.folk.push(second);
      town.nextPerson = 2;
    }
    road.wear = 0.7;
    expect(
      town.orderRoadwork(
        town.folk.map((p) => p.id),
        road.id,
      ),
    ).toBe(true);
    for (let i = 0; i < 1800 && road.wear > 0; ++i) {
      town.advance(0.05);
      for (const person of town.folk)
        if (!person.inside && !person.crossingDoorway())
          expect(town.grid.blockedBy(person.position)).toBe(false);
    }
    expect(road.wear).toBe(0);
  });
  it('keeps exact solid walls closed, including the foot rectangle at a rotated edge', () => {
    const { town, road, middle, map } = fixture();
    for (const angle of orientations) {
      const wall = new Footprint(middle, 0.5, angle);
      town.grid.rebuild(map, town.network, [wall]);
      expect(town.grid.walkable(middle)).toBe(false);
      expect(town.grid.path(road.line[0], middle)).toEqual([]);
      expect(town.grid.clear(road.line[0], road.line.at(-1)!, Infinity)).toBe(false);
      const c = Math.cos(angle),
        s = Math.sin(angle),
        extent = 0.5 + footBounds.halfX * Math.abs(c) + footBounds.halfY * Math.abs(s);
      expect(town.grid.blockedBy(add(middle, point(c * (extent - 0.01), s * (extent - 0.01))))).toBe(true);
    }
  });
  it('uses the laid bridge but never treats an unbuilt or ruined water crossing as a road corridor', () => {
    const { town, road, from, to, map, flank } = fixture();
    const buildings = flank();
    for (let y = 0; y < map.height(); ++y) map.at(29, y).terrain = Terrain.Water;
    const walls = [town.camp()!, ...buildings].map((b) => b.footprint());
    town.grid.rebuild(map, town.network, walls);
    expect(town.grid.path(from, to).length).toBeGreaterThan(0);
    expect(town.grid.walkable(point(29.5, 20))).toBe(true);
    road.wear = 1;
    town.grid.rebuild(map, town.network, walls);
    expect(town.grid.path(from, to)).toEqual([]);
    expect(town.grid.walkable(point(29.5, 20))).toBe(false);
    road.wear = 0;
    road.built = 0.5;
    town.grid.rebuild(map, town.network, walls);
    expect(town.grid.path(from, to)).toEqual([]);
  });
  it('does not replace a short grass route with a distant U-shaped road just because that road has a narrow corridor', () => {
    const { town, map } = fixture(),
      roads = new RoadNetwork();
    roads.add([point(5, 5), point(5, 30), point(30, 30), point(30, 5)].map(sharpAnchor), 1);
    town.grid.rebuild(map, roads, [
      new Footprint(point(17, 29.1), 0.5, 0),
      new Footprint(point(17, 30.9), 0.5, Math.PI),
    ]);
    const path = town.grid.path(point(5, 5), point(30, 5));
    expect(path.length).toBeGreaterThan(0);
    const length = path.slice(1).reduce((sum, p, i) => sum + distance(path[i], p), 0);
    expect(length, `chosen route length ${length}`).toBeLessThan(30);
  });
  it('keeps a completed bridge route available when a shorter planned bridge crosses impassable water', () => {
    const { town, map } = fixture(),
      roads = new RoadNetwork();
    for (let y = 0; y < map.height(); ++y) map.at(15, y).terrain = Terrain.Water;
    roads.add([point(5, 10), point(8, 10)].map(sharpAnchor), 1);
    roads.add([point(8, 10), point(8, 20), point(25, 20), point(25, 10)].map(sharpAnchor), 1);
    roads.add([point(8, 10), point(25, 10)].map(sharpAnchor), 0);
    town.grid.rebuild(map, roads, [
      new Footprint(point(6, 9.1), 0.5, 0),
      new Footprint(point(6, 10.9), 0.5, 0),
    ]);
    const from = point(6, 10),
      to = point(25, 10);
    expect(town.grid.walkable(from)).toBe(true);
    expect(town.grid.cost(6, 10)).toBe(0);
    expect(town.grid.walkable(point(15.5, 10))).toBe(false);
    const path = town.grid.path(from, to);
    expect(path.length).toBeGreaterThan(0);
    expect(path.some((p) => p.y > 19)).toBe(true);
    for (let i = 1; i < path.length; ++i) expect(town.grid.clear(path[i - 1], path[i], Infinity)).toBe(true);
  });
  it('finds a dry planned detour before choosing a shorter unfinished lake crossing', () => {
    const { town, map } = fixture(),
      roads = new RoadNetwork();
    for (let y = 8; y <= 12; ++y) for (let x = 14; x <= 16; ++x) map.at(x, y).terrain = Terrain.Water;
    roads.add([point(5, 10), point(10, 10)].map(sharpAnchor), 1);
    const shortcut = roads.add([point(10, 10), point(25, 10)].map(sharpAnchor), 0);
    roads.add([point(10, 10), point(10, 6), point(25, 6), point(25, 10)].map(sharpAnchor), 0);
    const walls = [new Footprint(point(7, 9.1), 0.5, 0), new Footprint(point(7, 10.9), 0.5, 0)];
    town.grid.rebuild(map, roads, walls);
    const from = point(7, 10),
      to = point(25, 10);
    expect(town.grid.walkable(from)).toBe(true);
    expect(town.grid.cost(7, 10)).toBe(0);
    expect(town.grid.walkable(point(15.5, 10))).toBe(false);
    const path = town.grid.path(from, to);
    expect(path.length).toBeGreaterThan(0);
    expect(path.some((p) => p.y < 7)).toBe(true);
    for (let i = 1; i < path.length; ++i) expect(town.grid.clear(path[i - 1], path[i], Infinity)).toBe(true);
    expect(town.grid.speedAt(point(17, 6))).toBeCloseTo(1.1);
    // Geometry is unchanged: only the new bridge's actual passability opens
    // and closes. The cached access graph must follow those changes as well.
    roads.road(shortcut)!.built = 1;
    town.grid.rebuild(map, roads, walls);
    const bridged = town.grid.path(from, to);
    expect(bridged.length).toBeGreaterThan(0);
    expect(bridged.every((p) => p.y > 9)).toBe(true);
    roads.road(shortcut)!.wear = 1;
    town.grid.rebuild(map, roads, walls);
    expect(town.grid.path(from, to).some((p) => p.y < 7)).toBe(true);
  });
  it('keeps repeated same-cell work-front moves local instead of searching every road', () => {
    const { town, middle, flank } = fixture();
    flank();
    const graph = (town.grid as unknown as { accessGraph: { route: (...args: unknown[]) => unknown } })
      .accessGraph;
    const route = graph.route.bind(graph);
    let searches = 0;
    graph.route = (...args) => {
      ++searches;
      return route(...args);
    };
    const from = add(middle, point(0.1, 0.05)),
      to = add(middle, point(0.2, 0.05));
    for (let i = 0; i < 100; ++i) expect(town.grid.path(from, to)).toEqual([from, to]);
    expect(searches).toBe(0);
  });
  it('builds, supplies and walks a bent road between fitted buildings on both legs', () => {
    const { town, worker, road, from } = fixture(0, false);
    expect(town.network.remove(road.id)).toBe(true);
    const bend = point(28, 20),
      end = point(28, 28);
    expect(town.buildRoad([from, bend, end].map(sharpAnchor))).toBe(true);
    const bent = town.network.list.at(-1)!,
      homes = [];
    for (const cursor of [point(25, 19), point(25, 21), point(27, 25), point(29, 25)]) {
      const fitted = town.fit(Structure.Tent, cursor, 0);
      expect(fitted.snapped).toBe(true);
      expect(
        town.place(Structure.Tent, fitted.center, fitted.angle),
        town.canPlace(Structure.Tent, fitted.center, fitted.angle).reason,
      ).toBe(true);
      const home = town.placed.at(-1)!;
      home.progress = 1;
      home.materials.delivered.add(home.materials.required);
      homes.push(home);
    }
    ++town.changes;
    town.tick(0);
    expect(
      town.grid.path(from, homes.at(-1)!.door()).length,
      'the unbuilt turning corridor still has clear ground to its far doorway',
    ).toBeGreaterThan(0);
    expect(town.grid.speedAt(bend)).toBeCloseTo(1.1);
    const farDoor = homes.at(-1)!.door();
    town.orderMove([worker.id], farDoor);
    for (let i = 0; i < 600 && distance(worker.position, farDoor) > 0.05; ++i) {
      town.advance(0.05);
      expect(town.grid.blockedBy(worker.position)).toBe(false);
    }
    expect(distance(worker.position, farDoor)).toBeLessThan(0.05);
    town.orderMove([worker.id], from);
    for (let i = 0; i < 600 && distance(worker.position, from) > 0.05; ++i) town.advance(0.05);
    expect(distance(worker.position, from)).toBeLessThan(0.05);
    expect(town.orderRoadwork([worker.id], bent.id)).toBe(true);
    for (let i = 0; i < 2400 && bent.built < 1; ++i) town.advance(0.1);
    expect(
      bent.built,
      JSON.stringify({
        activity: Activity[worker.activity],
        position: worker.position,
        front: bent.workPoint(),
      }),
    ).toBe(1);
    expect(town.pave(bent.id)).toBe(true);
    expect(town.orderRoadwork([worker.id], bent.id)).toBe(true);
    for (let i = 0; i < 2400 && !bent.paved; ++i) town.advance(0.1);
    expect(bent.paved).toBe(true);
    expect(bent.materials.required.stone).toBeGreaterThan(0);
    expect(bent.materials.delivered.stone).toBeGreaterThanOrEqual(bent.materials.required.stone);
    worker.home = homes.at(-1)!.id;
    worker.rest = 0.2;
    town.orderMove([worker.id], from);
    for (let i = 0; i < 400 && distance(worker.position, from) > 0.05; ++i) town.advance(0.05);
    expect(distance(worker.position, from)).toBeLessThan(0.05);
    expect(town.orderRest([worker.id], worker.home)).toBe(true);
    for (let i = 0; i < 600 && worker.doorway < 1; ++i) town.advance(0.05);
    expect(worker.inside).toBe(true);
    expect(worker.doorway).toBe(1);
  });
});
