import { describe, expect, it, vi } from 'vitest';
import { presentedHit as hit } from './fixtures/presented-hit';
import { point, Camera } from '../../packages/engine/src/geometry';
import { Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Order, Tool } from '../../packages/engine/src/game-tools';
import { select, personAt, pointerMove, zoomBy, sceneEvent } from '../../apps/web/src/native/game-input';
import { issueOrder, treeAtScreen, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { hoveredTarget, targetsInBox, refreshHoveredTarget } from '../../apps/web/src/native/world-targets';

function fixture() {
  const people = Array.from(
    { length: 4 },
    (_, id) => new Person(id, `Unit ${id}`, Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10)),
  );
  people[1].stressRecovery = true;
  people[2].role = Role.Guest;
  people[3].faction = 1;
  const building = new Building(8, Structure.Tent, point(12, 12), 0, 0);
  building.progress = 0;
  const app = {
    mouse: point(50, 40),
    cursor: point(12, 12),
    chosen: [0],
    tool: Tool.Select,
    selectedObjects: [],
    selectedTreeInstance: -1,
    hoveredWorldTarget: { screen: point(50, 40), hit: hit('building', 8) },
    context: { controlAt: () => false },
    renderer: {
      pick: vi.fn(),
      querySelection: vi.fn(() => people.map((p) => hit('person', p.id))),
      visible: () => true,
    },
    town: {
      person: (id: number) => people[id],
      people: () => people,
      building: (id: number) => (id === 8 ? building : null),
      creature: () => null,
      map: () => null,
      monsterAt: () => -1,
      orderMove: vi.fn(),
      orderBuild: vi.fn(() => true),
      orderChop: vi.fn(() => true),
      orderMine: vi.fn(),
      orderAttack: vi.fn(),
      orderAttackMove: vi.fn(),
      approachOrder: vi.fn(),
      roads: () => ({ road: () => null }),
    },
    // Deliberately conflicting old broad hits must not override the renderer's final winner.
    personAt: () => 0,
    treeAtScreen: () => 100,
    rockAtScreen: () => 200,
    buildingAtScreen: () => 8,
    animalAtScreen: () => -1,
    hoveredRoad: () => -1,
    cue: vi.fn(),
    selectTool: vi.fn(),
    selectPeople: vi.fn(),
    toScreen: () => point(50, 50),
    camera: { zoom: 1 },
    status: '',
  } as unknown as GameCommandApp;
  return { app, people };
}
describe('one presented world hit across input paths', () => {
  it('selects and commands the same front building despite a broad person/tree overlap', () => {
    const { app } = fixture();
    select.call(app);
    expect(app.selected).toBe(8);
    expect(app.selectPeople).not.toHaveBeenCalled();
    app.chosen = [0];
    issueOrder.call(app, Order.Work);
    expect(app.town.orderBuild).toHaveBeenCalledWith([0], 8);
    expect(app.town.orderChop).not.toHaveBeenCalled();
    expect(app.town.orderMove).not.toHaveBeenCalled();
  });
  it('does not resurrect an outside-art tree hit after the presented geometry rejected it', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = null;
    expect(hoveredTarget(app)).toBeNull();
    issueOrder.call(app, Order.Work);
    expect(app.town.orderChop).not.toHaveBeenCalled();
    expect(app.town.orderMove).toHaveBeenCalledWith([0], app.cursor);
  });
  it('returns no type-specific hit behind a different front object and keeps the exact clicked tree instance', () => {
    const { app } = fixture();
    expect(personAt.call(app, app.mouse)).toBe(-1);
    app.hoveredWorldTarget!.hit = hit('tree', 100, 0) as any;
    select.call(app);
    expect(app.selectedTree).toBe(100);
    expect(app.selectedTreeInstance).toBe(0);
    expect(treeAtScreen.call(app, app.mouse)).toBe(100);
  });
  it('reads hover only from the matching presented cache, without native queries during rendering', () => {
    const { app } = fixture();
    expect(hoveredTarget(app)).toMatchObject({ kind: 'building', id: 8 });
    app.mouse = point(51, 40);
    expect(hoveredTarget(app)).toBeNull();
    expect(app.renderer.pick).not.toHaveBeenCalled();
  });
  it('pointer refresh stores one winner while HUD reads never invoke native picking', () => {
    const { app } = fixture();
    app.renderer.pick = vi.fn(() => hit('tree', 100, 0) as any);
    app.camera = new Camera();
    app.viewWidth = 100;
    app.viewHeight = 100;
    app.panFrom = null;
    app.sampleRoad = vi.fn();
    app.context.pointerMove = vi.fn();
    pointerMove.call(app, 70, 60);
    expect(app.renderer.pick).toHaveBeenCalledExactlyOnceWith(point(70, 60));
    expect(hoveredTarget(app)).toEqual({ kind: 'tree', id: 100, instanceIndex: 0 });
    expect(treeAtScreen.call(app, point(70, 60))).toBe(100);
    expect(app.renderer.pick).toHaveBeenCalledTimes(1);
    app.context.controlAt = () => ({}) as any;
    refreshHoveredTarget(app);
    expect(hoveredTarget(app)).toBeNull();
    expect(app.renderer.pick).toHaveBeenCalledTimes(1);
  });
  it('zoom invalidates the old presentation before refreshing a stationary pointer', () => {
    const { app } = fixture();
    let ready = true;
    app.camera = new Camera();
    app.viewWidth = 100;
    app.viewHeight = 100;
    app.renderer.invalidatePresentation = vi.fn(() => {
      ready = false;
    });
    app.renderer.pick = vi.fn(() => (ready ? (hit('building', 8) as any) : null));
    app.panFrom = null;
    app.sampleRoad = vi.fn();
    app.context.pointerMove = vi.fn();
    app.pointerMove = pointerMove.bind(app);
    zoomBy.call(app, 2, app.mouse);
    expect(app.renderer.invalidatePresentation).toHaveBeenCalledOnce();
    expect(hoveredTarget(app)).toBeNull();
  });
  it('scene editing also avoids selecting a building behind a front monster', () => {
    const { app } = fixture();
    app.camera = new Camera();
    app.viewWidth = 100;
    app.viewHeight = 100;
    app.renderer.pick = vi.fn(() => hit('monster', 44) as any);
    app.town.buildingAt = vi.fn(() => 8);
    app.personAt = personAt.bind(app);
    app.select = select.bind(app);
    app.selectBuilding = vi.fn();
    sceneEvent.call(app, { type: 'PointerDown', x: 50, y: 40, button: 1 } as any);
    expect(app.selectBuilding).not.toHaveBeenCalled();
    expect(app.selectedObjects).toEqual([{ kind: 'monster', id: 44 }]);
    expect(app.sceneDragOrigin).toBeNull();
  });
  it('marquee includes visible player residents, including overwhelmed residents, and nothing else', () => {
    const { app } = fixture();
    app.renderer.querySelection = vi.fn(
      () =>
        [
          ...Array.from({ length: 4 }, (_, id) => hit('person', id)),
          hit('tree', 100),
          hit('building', 8),
        ] as any,
    );
    expect(targetsInBox(app, { x: 0, y: 0, w: 100, h: 100 })).toEqual([
      { kind: 'person', id: 0 },
      { kind: 'person', id: 1 },
    ]);
  });
});
