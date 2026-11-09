import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Activity, Monster, type Person } from '../../packages/engine/src/person';
import { Structure } from '../../packages/engine/src/building-catalog';
import { add, point, scale, type Point } from '../../packages/engine/src/geometry';
import { sharpAnchor, type RoadPath } from '../../packages/engine/src/road-network';
import { copyNative } from '../../packages/engine/src/native-copy';
import { Tool } from '../../packages/engine/src/game-tools';
import { dispatchWork, queueWork, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { finishRoad, selectTool } from '../../apps/web/src/native/game-input';
// Only presentation callbacks and pointer sampling are excluded. Validated paths
// enter the real finishRoad handler; dispatch, navigation, collection and building
// all use production code. Browser regressions cover actual pointer strokes.
function controls(town: Town): GameCommandApp {
  const app = {
    town,
    workQueue: [],
    workSerial: 0n,
    lastDispatch: -1,
    stoppedWork: new Map<number, bigint>(),
    chosen: [],
    crew: [],
    roadPress: null,
    roadStroke: [],
    roadMoved: false,
    status: '',
    tool: Tool.Select,
    cue() {},
    dismissBuildDrawer() {},
  } as unknown as GameCommandApp;
  app.selectTool = selectTool.bind(app);
  app.dispatchWork = dispatchWork.bind(app);
  app.queueWork = queueWork.bind(app);
  return app;
}
function step(app: GameCommandApp, seconds = 0.1): void {
  // Same order as GameApp.render: advance the world, then dispatch player work.
  app.town.advance(seconds);
  app.dispatchWork();
}
function describeWorker(p: Person) {
  return {
    id: p.id,
    activity: Activity[p.activity],
    task: Activity[p.task],
    site: p.taskSite,
    ordered: p.ordered,
    auto: p.autoMode,
    cargo: p.carrying,
    tree: p.tree,
    position: p.position,
  };
}
function diagnostics(app: GameCommandApp) {
  return JSON.stringify({
    queue: app.workQueue.map((w) => ({ ...w, serial: String(w.serial) })),
    workers: app.town.people().map(describeWorker),
    roads: app.town
      .roads()
      .roads()
      .map((r) => ({ id: r.id, built: r.built, front: r.workPoint() })),
  });
}
function advanceUntil(app: GameCommandApp, done: () => boolean, seconds: number): void {
  for (let i = 0; i < seconds * 10 && !done(); ++i) step(app);
  expect(done(), diagnostics(app)).toBe(true);
}
let firstCamp: Town;
beforeAll(() => {
  // Match the shipped New Game: designed seed 5, full default 176×176 terrain,
  // two founders, no invented resources, flattened land, revealed map or instant build.
  const town = new Town(5),
    app = controls(town),
    origin = town.map().camp();
  expect(town.map().width()).toBe(176);
  expect(town.place(Structure.Camp, origin, 0)).toBe(true);
  const camp = town.camp()!;
  app.queueWork(Activity.Building, camp.id);
  advanceUntil(app, () => camp.built(), 180);
  expect(camp.materials.delivered.wood).toBeGreaterThanOrEqual(camp.materials.required.wood);
  expect(town.roads().roads()).toHaveLength(0);
  firstCamp = copyNative(town);
}, 30000);
function fixture(delay = 3) {
  const app = controls(copyNative(firstCamp));
  for (let i = 0; i < delay * 10; ++i) step(app);
  return app;
}
function radial(app: GameCommandApp, direction: Point): RoadPath {
  const origin = app.town.camp()!.center;
  return [sharpAnchor(add(origin, scale(direction, 1.2))), sharpAnchor(add(origin, scale(direction, 6)))];
}
function requestRoad(app: GameCommandApp, path: RoadPath, selected: number[] = []) {
  app.chosen = [...selected];
  app.crew = [...selected];
  app.roadPress = path[0].point;
  app.roadStroke = path.map((a) => a.point);
  app.roadMoved = true;
  app.roadDraft = () => path;
  const before = app.town.roads().roads().length;
  finishRoad.call(app);
  expect(app.town.roads().roads().length, app.status).toBe(before + 1);
  const road = app.town.roads().roads().at(-1)!;
  expect(road.built).toBe(0);
  return road;
}
const directions = [
  { name: 'east', vector: point(1, 0) },
  { name: 'west', vector: point(-1, 0) },
  { name: 'south', vector: point(0, 1) },
  { name: 'north', vector: point(0, -1) },
];
describe('new player road requests after the first Camp', () => {
  for (const direction of directions)
    for (const selected of [false, true])
      for (const auto of [false, true])
        it(`${direction.name}: ${selected ? 'selected crew' : 'global request'}, Auto ${auto ? 'ON' : 'OFF'}`, () => {
          const app = fixture(),
            town = app.town;
          if (!auto) for (const p of town.people()) town.setAuto(p.id, false);
          const crew = selected ? [town.people()[0].id] : [];
          const road = requestRoad(app, radial(app, direction.vector), crew);
          const admitted = town.people().find((p) => p.task === Activity.Roadwork && p.taskSite === road.id);
          expect(admitted, diagnostics(app)).toBeDefined();
          if (selected) expect(admitted!.id).toBe(crew[0]);
          const assigned = admitted!.id;
          let previous = 0;
          for (let i = 0; i < 1200 && road.built < 1; ++i) {
            step(app);
            expect(road.built).toBeGreaterThanOrEqual(previous);
            previous = road.built;
            expect(town.person(assigned)!.taskSite, diagnostics(app)).toBe(road.id);
            expect(town.person(assigned)!.task, diagnostics(app)).toBe(Activity.Roadwork);
            if (i === 199) expect(road.built, diagnostics(app)).toBeGreaterThan(0);
          }
          expect(road.built, diagnostics(app)).toBe(1);
          expect(app.chosen).toEqual(crew);
        });
  it('admits a road immediately at the actual first Camp completion boundary', () => {
    const app = fixture(0),
      road = requestRoad(app, radial(app, point(1, 0)));
    advanceUntil(
      app,
      () => app.town.people().some((p) => p.task === Activity.Roadwork && p.taskSite === road.id),
      0.2,
    );
    advanceUntil(app, () => road.built === 1, 120);
  });
  it('preserves explicit resident commands while a global road request waits', () => {
    const app = fixture(),
      town = app.town,
      origin = town.camp()!.center;
    const ids = town.people().map((p) => p.id);
    town.orderMove(ids, add(origin, point(3, 2)));
    const goals = town.people().map((p) => ({ ...p.goal }));
    const road = requestRoad(app, radial(app, point(1, 0)));
    expect(town.people().map((p) => p.task)).toEqual(ids.map(() => Activity.Moving));
    expect(town.people().map((p) => p.goal)).toEqual(goals);
    advanceUntil(app, () => road.built === 1, 120);
  });
  it('keeps an unfinished automatic road assignment when another road is requested', () => {
    const app = fixture(),
      town = app.town,
      worker = town.people()[0];
    town.folk = [worker];
    const first = requestRoad(app, radial(app, point(1, 0)), [worker.id]);
    worker.ordered = false;
    advanceUntil(app, () => first.built >= 0.2, 30);
    const second = requestRoad(app, radial(app, point(0, -1)));
    expect(worker.task).toBe(Activity.Roadwork);
    expect(worker.taskSite).toBe(first.id);
    for (let i = 0; i < 1200 && first.built < 1; ++i) {
      step(app);
      if (first.built < 1) expect(worker.taskSite).toBe(first.id);
    }
    expect(first.built, diagnostics(app)).toBe(1);
    expect(second.built).toBe(0);
    advanceUntil(app, () => second.built === 1, 120);
  });
  it('builds the first Camp when founders have already gathered wood without any storage', () => {
    const town = new Town(5),
      app = controls(town);
    advanceUntil(app, () => town.people().every((p) => p.carrying > 0), 60);
    expect(town.camp()).toBeNull();
    const gathered = town.people().reduce((sum, p) => sum + p.carrying, 0);
    expect(gathered).toBeGreaterThan(0);
    expect(town.place(Structure.Camp, town.map().camp(), 0)).toBe(true);
    const camp = town.camp()!;
    app.queueWork(Activity.Building, camp.id);
    advanceUntil(
      app,
      () => town.people().some((p) => p.task === Activity.Building && p.taskSite === camp.id),
      2,
    );
    advanceUntil(app, () => camp.built(), 180);
    expect(camp.materials.delivered.wood).toBeGreaterThanOrEqual(camp.materials.required.wood);
  });
  it('lets an active resource delivery finish, then admits the pending player road', () => {
    const app = fixture(),
      town = app.town,
      worker = town.people()[0];
    town.folk = [worker];
    advanceUntil(app, () => worker.activity === Activity.Collecting && worker.carrying > 0, 30);
    const carried = worker.carrying,
      stock = town.stock().wood;
    const road = requestRoad(app, radial(app, point(1, 0)));
    expect(worker.task).toBe(Activity.Felling);
    expect(worker.carrying).toBe(carried);
    advanceUntil(app, () => worker.task === Activity.Roadwork && worker.taskSite === road.id, 30);
    expect(worker.carrying).toBe(0);
    expect(town.stock().wood).toBe(stock + carried);
    advanceUntil(app, () => road.built === 1, 120);
  });
  it('preserves a blocked cargo load in construction inventory when storage is full', () => {
    const app = fixture(),
      town = app.town,
      worker = town.people()[0];
    town.folk = [worker];
    advanceUntil(app, () => worker.carrying > 0, 30);
    // An explicit inventory boundary fixture, with the original world and roads unchanged.
    town.stock().wood = town.capacity().wood;
    advanceUntil(
      app,
      () => !worker.moving() && [Activity.Idle, Activity.Holding].includes(worker.activity),
      30,
    );
    expect(worker.carrying).toBeGreaterThan(0);
    const wood = town.stock().wood + worker.carrying;
    const road = requestRoad(app, radial(app, point(1, 0)));
    expect(worker.task).toBe(Activity.Roadwork);
    advanceUntil(app, () => road.built === 1, 120);
    expect(town.stock().wood + worker.carrying + road.materials.delivered.wood).toBe(wood);
  });
  it('retries a pending road after recovery even when automatic harvesting resumes in the same frame', () => {
    const app = fixture(),
      town = app.town,
      worker = town.people()[0];
    town.folk = [worker];
    expect(worker.task).toBe(Activity.Felling);
    worker.rest = 0.1;
    expect(town.scheduleAutomatic(worker)).toBe(true);
    expect(worker.activity).toBe(Activity.Sleeping);
    const road = requestRoad(app, radial(app, point(1, 0)));
    expect(worker.task).toBe(Activity.Felling);
    expect(worker.recoveringRest).toBe(true);
    advanceUntil(app, () => worker.inside && !worker.crossingDoorway(), 10);
    worker.rest = Math.fround(0.9499); // A late recovery checkpoint, before the existing .95 boundary.
    step(app, 1);
    expect(worker.recoveringRest).toBe(false);
    expect(worker.task, diagnostics(app)).toBe(Activity.Roadwork);
    expect(worker.taskSite).toBe(road.id);
    advanceUntil(app, () => road.built === 1, 120);
  });
  it('does not revive a stopped older request, but accepts a newer player request', () => {
    const app = fixture(),
      town = app.town,
      worker = town.people()[0];
    town.folk = [worker];
    const first = requestRoad(app, radial(app, point(1, 0)), [worker.id]);
    app.queueWork(Activity.Roadwork, first.id);
    town.orderStop([worker.id]);
    app.stoppedWork.set(worker.id, app.workSerial);
    for (let i = 0; i < 20; ++i) step(app);
    expect(worker.activity).toBe(Activity.Holding);
    expect(worker.task).toBe(Activity.Idle);
    expect(first.built).toBe(0);
    const second = requestRoad(app, radial(app, point(0, -1)));
    expect(worker.task).toBe(Activity.Roadwork);
    expect(worker.taskSite).toBe(second.id);
    advanceUntil(app, () => second.built === 1, 120);
  });
  it('keeps active automatic combat above a pending road request', () => {
    const app = fixture(),
      town = app.town,
      worker = town.people()[0];
    town.folk = [worker];
    const foe = new Monster(900, 0, add(worker.position, point(1, 0)));
    foe.health = 100;
    foe.raider = true;
    foe.ready = Infinity;
    town.beasts.push(foe);
    worker.activity = Activity.Fighting;
    worker.foe = foe.id;
    worker.ready = Infinity;
    worker.path = [];
    const task = worker.task,
      site = worker.taskSite;
    const road = requestRoad(app, radial(app, point(1, 0)));
    for (let i = 0; i < 5; ++i) step(app);
    expect(worker.activity).toBe(Activity.Fighting);
    expect(worker.task).toBe(task);
    expect(worker.taskSite).toBe(site);
    expect(worker.foe).toBe(foe.id);
    expect(road.built).toBe(0);
  });
  it('does not discard pending health recovery during its Idle transition', () => {
    const app = fixture(),
      town = app.town,
      worker = town.people()[0];
    town.folk = [worker];
    worker.health = 0.5;
    worker.recoveringHealth = true;
    worker.activity = Activity.Idle;
    worker.path = [];
    const task = worker.task,
      site = worker.taskSite;
    const road = requestRoad(app, radial(app, point(1, 0)));
    expect(worker.task).toBe(task);
    expect(worker.taskSite).toBe(site);
    expect(worker.recoveringHealth).toBe(true);
    expect(road.built).toBe(0);
    advanceUntil(app, () => worker.activity === Activity.Sleeping, 2);
  });
  it('accepts a new selected road command over the previous unfinished assignment', () => {
    const app = fixture(),
      town = app.town,
      worker = town.people()[0];
    town.folk = [worker];
    const first = requestRoad(app, radial(app, point(1, 0)), [worker.id]);
    advanceUntil(app, () => first.built >= 0.2, 30);
    const progress = first.built;
    const second = requestRoad(app, radial(app, point(0, -1)), [worker.id]);
    expect(worker.task).toBe(Activity.Roadwork);
    expect(worker.taskSite).toBe(second.id);
    advanceUntil(app, () => second.built === 1, 120);
    expect(first.built).toBe(progress);
  });
});
