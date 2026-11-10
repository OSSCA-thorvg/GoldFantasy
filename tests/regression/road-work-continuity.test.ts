import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain, Layer, DungeonKind } from '../../packages/engine/src/world-types';
import { Activity, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { point, add } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { enter } from '../../packages/engine/src/town-residents';
import { copyNative } from '../../packages/engine/src/native-copy';
import { dispatchWork, queueWork, type GameCommandApp } from '../../apps/web/src/native/game-commands';

let base: Town;
beforeAll(() => {
  const map = WorldMap.generate(5, 32, 32);
  map.ymir = null;
  map.fire = null;
  map.stream = { path: [], width: [] };
  for (const layer of map.layers) layer.fill(0.4);
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  // A flat policy fixture removes terrain/material causes; all worker motion,
  // metabolism, needs and construction below run through actual Town.advance.
  for (let y = 0; y < 32; ++y)
    for (let x = 0; x < 32; ++x)
      Object.assign(map.at(x, y), { terrain: Terrain.Grass, trees: 0, wild: 0, revealed: true, dungeon: -1 });
  map.sites = [{ name: 'Raid source', kind: DungeonKind.Cave, origin: point(28, 28), discovered: false }];
  base = new Town(map, 32, false);
  base.wildlifeDay = 0;
  const camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  camp.village = 0;
  base.placed.push(camp);
  base.nextId = 1;
  base.foundSettlement(0);
  Object.assign(base.stock(), new Resources(1000, 1000, 1000, 1000, 1000, 1000));
  const p = new Person(0, 'Road worker', Role.Resident, Calling.Settler, Race.Human, 0, camp.door());
  p.home = p.village = 0;
  p.food = p.rest = p.health = p.hydration = 1;
  p.inventory[0] = { item: 'hammer', quantity: 1 };
  p.equipment.tool1 = 1;
  base.folk = [p];
  base.nextPerson = 1;
  base.editHour(12);
  base.tick(0);
});
function controls(town: Town): GameCommandApp {
  const app = {
    town,
    workQueue: [],
    workSerial: 0n,
    lastDispatch: -1,
    stoppedWork: new Map(),
    chosen: [],
    crew: [],
  } as unknown as GameCommandApp;
  app.dispatchWork = dispatchWork.bind(app);
  app.queueWork = queueWork.bind(app);
  return app;
}
function snapshot(town: Town) {
  const p = town.people()[0];
  return {
    at: town.clock(),
    activity: Activity[p.activity],
    task: Activity[p.task],
    site: p.taskSite,
    target: p.target,
    ordered: p.ordered,
    auto: p.autoMode,
    food: p.food,
    rest: p.rest,
    hydration: p.hydration,
    health: p.health,
    stress: p.stress,
    stressRecovery: p.stressRecovery,
    cargo: p.carrying,
    supply: p.supplyTarget,
    road: town.roads().roads()[0]?.built,
    moving: p.moving(),
    night: town.climate().night,
  };
}
function step(app: GameCommandApp, seconds: number) {
  const trace = [];
  let previous = '';
  for (let i = 0; i < Math.ceil(seconds * 10); ++i) {
    app.town.advance(0.1);
    app.dispatchWork();
    const s = snapshot(app.town),
      key = `${s.activity}:${s.task}:${s.site}:${s.target}:${s.stressRecovery}`;
    if (key !== previous) {
      trace.push(s);
      previous = key;
    }
  }
  return trace;
}
function started(mode: 'automatic' | 'global' | 'direct' = 'automatic') {
  const town = copyNative(base),
    app = controls(town),
    p = town.people()[0];
  const path = [sharpAnchor(point(13.2, 12)), sharpAnchor(point(21, 12))];
  expect(town.canBuildRoad(path).ok, town.canBuildRoad(path).reason).toBe(true);
  expect(town.buildRoad(path)).toBe(true);
  const road = town.roads().roads()[0];
  if (mode === 'direct') expect(town.orderRoadwork([p.id], road.id)).toBe(true);
  else if (mode === 'global') app.queueWork(Activity.Roadwork, road.id);
  else town.scheduleAutomatic(p);
  for (let i = 0; i < 100 && road.built < 0.04; ++i) step(app, 0.1);
  expect(road.built, JSON.stringify(snapshot(town))).toBeGreaterThan(0.03);
  expect(p.task).toBe(Activity.Roadwork);
  expect(p.taskSite).toBe(road.id);
  expect(p.ordered).toBe(mode !== 'automatic');
  return { town, app, p, road };
}
const ordinaryInterruptions = [
  {
    name: 'ordinary hunger and thirst',
    change: (town: Town, p: Person) => {
      p.food = 0.2;
      p.hydration = 0.2;
    },
  },
  {
    name: 'critical hunger',
    change: (town: Town, p: Person) => {
      p.food = 0.04;
    },
  },
  {
    name: 'low rest',
    change: (town: Town, p: Person) => {
      p.rest = 0.19;
    },
  },
  {
    name: 'low health',
    change: (town: Town, p: Person) => {
      p.health = 0.39;
    },
  },
  {
    name: 'nightfall with full rest',
    change: (town: Town, p: Person) => {
      town.editHour(23);
      expect(town.climate().night).toBeGreaterThan(0.5);
    },
  },
  {
    name: 'stress threshold',
    change: (town: Town, p: Person) => {
      p.stress = 0.86;
    },
  },
];
describe('an admitted road remains a construction transaction', () => {
  for (const mode of ['automatic', 'global', 'direct'] as const)
    for (const condition of ordinaryInterruptions)
      it(`${mode} road continues through ${condition.name}`, () => {
        const { town, app, p, road } = started(mode),
          before = road.built;
        condition.change(town, p);
        const trace = step(app, 3),
          diagnostic = JSON.stringify({ trace, final: snapshot(town) });
        expect(p.task, diagnostic).toBe(Activity.Roadwork);
        expect(p.taskSite, diagnostic).toBe(road.id);
        expect(
          trace.every(
            (s) =>
              ![Activity.Sleeping, Activity.Eating, Activity.Drinking, Activity.Treating]
                .map((a) => Activity[a])
                .includes(s.activity),
          ),
          diagnostic,
        ).toBe(true);
        expect(road.built, diagnostic).toBeGreaterThan(before);
        for (let i = 0; i < 1200 && road.built < 1; ++i) {
          step(app, 0.1);
          if (road.built < 1) {
            expect(p.task, JSON.stringify(snapshot(town))).toBe(Activity.Roadwork);
            expect(p.taskSite, JSON.stringify(snapshot(town))).toBe(road.id);
          }
        }
        expect(road.built, JSON.stringify(snapshot(town))).toBe(1);
      });
  it('keeps road work through dehydration and low health/rest even with a reachable Well', () => {
    const { town, app, p, road } = started(),
      before = road.built;
    const well = new Building(town.nextId++, Structure.Well, point(18, 18), 0, 0);
    well.village = 0;
    town.placed.push(well);
    ++town.changes;
    p.hydration = 0.05;
    p.health = 0.39;
    p.rest = 0.19;
    const trace = step(app, 3),
      diagnostic = JSON.stringify({ trace, final: snapshot(town) });
    expect(p.task, diagnostic).toBe(Activity.Roadwork);
    expect(p.taskSite, diagnostic).toBe(road.id);
    expect(
      trace.every((s) => s.activity === 'Roadwork'),
      diagnostic,
    ).toBe(true);
    expect(road.built, diagnostic).toBeGreaterThan(before);
  });
  it('reconsiders deferred stress after the road is fully completed', () => {
    const { town, app, p, road } = started();
    p.stress = 0.86;
    for (let i = 0; i < 1200 && road.built < 1; ++i) step(app, 0.1);
    expect(road.built, JSON.stringify(snapshot(town))).toBe(1);
    expect(p.stressRecovery).toBe(false);
    const trace = step(app, 2);
    expect(p.stressRecovery, JSON.stringify(trace)).toBe(true);
    expect(p.task).toBe(Activity.Idle);
    expect(p.activity).toBe(Activity.Sleeping);
  });
  it('resumes the same road from a saved automatic sleep interruption', () => {
    const initial = started(),
      home = initial.town.camp()!;
    initial.p.activity = Activity.Sleeping;
    initial.p.target = home.id;
    initial.p.rest = 0.19;
    initial.p.recoveringRest = true;
    initial.p.path = [];
    initial.p.position = home.door();
    enter(initial.p, home.threshold());
    initial.p.doorway = 1;
    initial.p.position = home.threshold();
    // Persist the exact old suspended-task shape, including the intact road ID.
    const town = decodeTown(encodeTown(initial.town), (map) => new Town(map, 32, false, true));
    expect(town).not.toBeNull();
    const app = controls(town!),
      p = town!.people()[0],
      road = town!.roads().roads()[0],
      before = road.built;
    p.scheduleAt = town!.clock();
    const trace = step(app, 8);
    expect(p.task, JSON.stringify(trace)).toBe(Activity.Roadwork);
    expect(p.taskSite).toBe(road.id);
    expect(p.inside).toBe(false);
    expect(road.built).toBeGreaterThan(before);
  });
  it('reconsiders deferred exhaustion after the road is fully completed', () => {
    const { town, app, p, road } = started();
    p.rest = 0.19;
    for (let i = 0; i < 1200 && road.built < 1; ++i) step(app, 0.1);
    expect(road.built, JSON.stringify(snapshot(town))).toBe(1);
    const trace = step(app, 2);
    expect(p.activity, JSON.stringify(trace)).toBe(Activity.Sleeping);
    expect(p.recoveringRest).toBe(true);
  });
  it('does not exchange a started road for a later global building request or assigned workplace', () => {
    const { town, app, p, road } = started(),
      before = road.built;
    const job = new Building(town.nextId++, Structure.Lumberyard, point(18, 18), 0, 0);
    job.village = 0;
    town.placed.push(job);
    p.job = job.id;
    const build = new Building(town.nextId++, Structure.Tent, point(18, 22), 0, 0);
    build.village = 0;
    build.progress = 0;
    town.placed.push(build);
    town.changes++;
    app.queueWork(Activity.Building, build.id);
    const trace = step(app, 3);
    expect(p.task, JSON.stringify(trace)).toBe(Activity.Roadwork);
    expect(p.taskSite).toBe(road.id);
    expect(road.built).toBeGreaterThan(before);
    expect(build.progress).toBe(0);
  });
  it('lets an enemy interrupt and resumes the same road after it is defeated', () => {
    const { town, app, p, road } = started(),
      before = road.built;
    const foe = new Monster(900, 0, add(p.position, point(1, 0)));
    foe.health = 100;
    foe.raider = true;
    foe.ready = Infinity;
    town.beasts.push(foe);
    p.ready = Infinity;
    p.rest = 0.19;
    step(app, 0.3);
    expect(p.activity).toBe(Activity.Fighting);
    expect(p.taskSite).toBe(road.id);
    foe.health = 0;
    const trace = step(app, 3);
    expect(p.task, JSON.stringify(trace)).toBe(Activity.Roadwork);
    expect(p.taskSite).toBe(road.id);
    expect(road.built).toBeGreaterThan(before);
  });
  it('keeps an explicit Stop above a previous queued road', () => {
    const { town, app, p, road } = started('global'),
      before = road.built;
    town.orderStop([p.id]);
    app.stoppedWork.set(p.id, app.workSerial);
    step(app, 3);
    expect(p.activity).toBe(Activity.Holding);
    expect(p.task).toBe(Activity.Idle);
    expect(road.built).toBe(before);
  });
  it('accepts a new explicit player Move instead of forcing the previous road', () => {
    const { town, app, p } = started();
    const goal = point(24, 20);
    town.orderMove([p.id], goal);
    step(app, 0.3);
    expect(p.task).toBe(Activity.Moving);
    expect(p.ordered).toBe(true);
    expect(p.goal).toEqual(goal);
  });
});
