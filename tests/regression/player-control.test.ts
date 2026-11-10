import { describe, expect, it, vi } from 'vitest';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { Order, Tool, PointerButton } from '../../packages/engine/src/game-tools';
import {
  issueOrder,
  dispatchWork,
  prepare,
  toggleAuto,
  stopSelected,
  leaveSelected,
  type GameCommandApp,
} from '../../apps/web/src/native/game-commands';
import { residentSelection } from '../../apps/web/src/native/game-unit-panel';
import { selectPeople, selectTool, personAt, pointerUp } from '../../apps/web/src/native/game-input';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';

function fixture() {
  const people = Array.from(
    { length: 4 },
    (_, id) => new Person(id, `Person ${id}`, Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10)),
  );
  people[1].stressRecovery = true;
  people[2].faction = 9;
  people[3].role = Role.Guest;
  const town = {
    person: (id: number) => people.find((p) => p.id === id) ?? null,
    setAuto: vi.fn(),
    orderStop: vi.fn(),
    orderLeave: vi.fn(() => true),
    orderMove: vi.fn(),
    orderAttackMove: vi.fn(),
    orderAttackPerson: vi.fn(),
    orderBuild: vi.fn(() => true),
    assignJob: vi.fn(() => true),
    monsterAt: () => -1,
    building: vi.fn(() => null as Building | null),
    roads: () => ({ road: () => null }),
  };
  const app = {
    town,
    chosen: people.map((p) => p.id),
    status: '',
    mouse: point(50, 50),
    cursor: point(12, 12),
    stoppedWork: new Map(),
    workSerial: 1n,
    selectTool: vi.fn(),
    cancelPointer: vi.fn(),
    cue: vi.fn(),
    personAt: () => -1,
    animalAtScreen: () => -1,
    treeAtScreen: () => -1,
    rockAtScreen: () => -1,
    buildingAtScreen: () => -1,
    hoveredRoad: () => -1,
    pending: Order.None,
  } as unknown as GameCommandApp;
  return { app, town, people };
}
describe('player command ownership boundary', () => {
  it('dispatches a mixed selection only to controllable residents without deselecting inspected people', () => {
    const { app, town } = fixture();
    issueOrder.call(app, Order.Move);
    expect(town.orderMove).toHaveBeenCalledWith([0], app.cursor);
    issueOrder.call(app, Order.Attack);
    expect(town.orderAttackMove).toHaveBeenCalledWith([0], app.cursor);
    toggleAuto.call(app);
    expect(town.setAuto.mock.calls.map((call) => call[0])).toEqual([0]);
    stopSelected.call(app);
    leaveSelected.call(app);
    expect(town.orderStop).toHaveBeenCalledWith([0]);
    expect(town.orderLeave).toHaveBeenCalledWith([0]);
    expect([...app.stoppedWork.keys()]).toEqual([0]);
    expect(app.chosen).toEqual([0, 1, 2, 3]);
  });
  it('rechecks a breakdown or defection occurring after the unit was selected', () => {
    const { app, town, people } = fixture();
    app.chosen = [0];
    people[0].stressRecovery = true;
    prepare.call(app, Order.Move);
    issueOrder.call(app, Order.Move);
    expect(app.pending).toBe(Order.None);
    expect(town.orderMove).not.toHaveBeenCalled();
    expect(app.status).toContain('Overwhelmed');
    people[0].stressRecovery = false;
    people[0].faction = 2;
    issueOrder.call(app, Order.Move);
    expect(town.orderMove).not.toHaveBeenCalled();
    expect(app.status).toContain('neutral');
    expect(residentSelection.call(app as unknown as GameHudApp)).toBe(false);
  });
  it('preserves individual inspection of guests, neutral people and overwhelmed residents', () => {
    const { app } = fixture();
    for (const id of [1, 2, 3]) {
      selectPeople.call(app, [id]);
      expect(app.chosen).toEqual([id]);
      expect(residentSelection.call(app as unknown as GameHudApp)).toBe(false);
    }
  });
  it('does not build, repair or assign work in a neutral building on contextual click', () => {
    const { app, town } = fixture();
    const building = new Building(5, Structure.Lumberyard, point(12, 12), 0, 0);
    building.faction = 2;
    town.building.mockReturnValue(building);
    app.buildingAtScreen = () => 5;
    issueOrder.call(app, Order.Work);
    expect(town.orderBuild).not.toHaveBeenCalled();
    expect(town.assignJob).not.toHaveBeenCalled();
    expect(app.status).toContain('neutral');
    expect(town.orderMove).toHaveBeenCalledWith([0], building.door());
  });
  it('filters selected construction crews when choosing a tool', () => {
    const { app } = fixture();
    app.tool = Tool.Select;
    app.dismissBuildDrawer = () => {};
    selectTool.call(app, Tool.Select, true);
    expect(app.crew).toEqual([0]);
  });
});

it('does not pick a neutral resident through player fog', () => {
  const { app, people } = fixture();
  app.town.people = () => [people[2]];
  app.camera = { zoom: 1 } as any;
  app.toScreen = () => point(50, 50);
  app.renderer = { visible: () => false } as any;
  expect(personAt.call(app, point(50, 41))).toBe(-1);
  app.renderer.visible = () => true;
  expect(personAt.call(app, point(50, 41))).toBe(people[2].id);
});

it('marquee inspects every visible person while later commands filter control ownership', () => {
  const { app, people } = fixture();
  app.town.people = () => people;
  app.boxFrom = point(0, 0);
  app.pointerMove = (x, y) => {
    app.mouse = point(x, y);
  };
  app.toScreen = () => point(50, 50);
  app.camera = { zoom: 1 } as any;
  app.renderer = { visible: () => true } as any;
  app.context = { controlAt: () => false } as any;
  pointerUp.call(app, 100, 100, PointerButton.Primary);
  expect(app.chosen).toEqual([0, 1, 2, 3]);
});
it('retires queued work on orphaned neutral roads without relying on a surviving Camp', () => {
  const { app, town, people } = fixture();
  const road = { id: 11, faction: 2, village: -1, built: 0, paving: -1, wear: 0 };
  app.town.roads = () => ({ road: () => road }) as any;
  app.town.clock = () => 1;
  app.town.people = () => people;
  app.town.roadWorkPosition = () => point(12, 12);
  app.town.orderRoadwork = vi.fn(() => true);
  app.workQueue = [{ activity: Activity.Roadwork, target: road.id, serial: 1n }];
  dispatchWork.call(app, true);
  expect(app.workQueue).toEqual([]);
  expect(app.town.orderRoadwork).not.toHaveBeenCalled();
  road.faction = 0;
  app.workQueue = [{ activity: Activity.Roadwork, target: road.id, serial: 1n }];
  dispatchWork.call(app, true);
  expect(app.town.orderRoadwork).toHaveBeenCalledWith([0], road.id);
});
