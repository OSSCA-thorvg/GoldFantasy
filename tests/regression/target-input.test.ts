import { describe, it, expect, vi } from 'vitest';
import { pointerUp } from '../../apps/web/src/native/game-input';
import { issueOrder, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { Order, PointerButton, Tool } from '../../packages/engine/src/game-tools';
import { point } from '../../packages/engine/src/geometry';
import { AnimalKind, Calling, Person, Race, Role, Monster } from '../../packages/engine/src/person';
import { GameApplication } from '../../apps/web/src/native/game-application';
import { presentedHit } from './fixtures/presented-hit';
import type { AppEvent } from '../../apps/web/src/native/application-contracts';

function fixture() {
  const people = [0, 1].map(
    (id) => new Person(id, 'Unit ' + id, Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10)),
  );
  const animal = new Monster(10, -1, point(12, 12));
  animal.animal = AnimalKind.Cow;
  const app = {
    chosen: [0, 1],
    selectedObjects: [],
    mouse: point(50, 50),
    hoveredWorldTarget: { screen: point(50, 50), hit: null },
    cursor: point(12, 12),
    tool: Tool.Select,
    pending: Order.None,
    pressAt: point(50, 50),
    panMoved: false,
    panFrom: null,
    boxFrom: null,
    hudPointer: false,
    context: { controlAt: () => false },
    pointerMove: vi.fn(),
    issueOrder: vi.fn(),
    cue: vi.fn(),
    personAt: () => -1,
    animalAtScreen: () => -1,
    treeAtScreen: () => -1,
    rockAtScreen: () => -1,
    buildingAtScreen: () => -1,
    hoveredRoad: () => -1,
    town: {
      person: (id: number) => people[id] ?? null,
      map: () => ({ cell: () => ({ dungeon: -1 }) }),
      monsterAt: () => -1,
      creature: () => animal,
      orderMove: vi.fn(),
      sendExpedition: vi.fn(() => true),
      orderAttack: vi.fn(),
      orderAttackPerson: vi.fn(),
      orderAttackMove: vi.fn(),
      building: () => null,
      roads: () => ({ road: () => null }),
    },
  } as unknown as GameCommandApp;
  return { app, people, animal };
}
describe('target input and group commands', () => {
  it.each(['a', 'm', 'A', 'M'])('group hotkey %s works even after a HUD button has focus', (text) => {
    const prepare = vi.fn(),
      app = {
        game: { buildings: null, atlas: null, editor: null, selectedPeople: () => [0, 1], prepare },
        script: { ready: () => true },
        scriptContext: { focused: () => true, textFocused: () => false },
        editorAttached: false,
      };
    GameApplication.prototype.event.call(
      app as unknown as GameApplication,
      { type: 'KeyDown', text, control: false, meta: false, alt: false } as AppEvent,
    );
    expect(prepare).toHaveBeenCalledWith(text.toLowerCase() === 'a' ? Order.Attack : Order.Move);
  });
  it('keeps A and M inside a focused text field', () => {
    const prepare = vi.fn(),
      key = vi.fn(),
      app = {
        game: { buildings: null, atlas: null, editor: null, selectedPeople: () => [0, 1], prepare },
        script: { ready: () => true },
        scriptContext: { focused: () => true, textFocused: () => true, key },
        editorAttached: false,
      };
    GameApplication.prototype.event.call(
      app as unknown as GameApplication,
      { type: 'KeyDown', text: 'a', control: false, meta: false, alt: false } as AppEvent,
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(key).toHaveBeenCalledOnce();
  });
  it.each([Order.Move, Order.Attack])(
    'executes armed group command %s with primary click and keeps selection',
    (order) => {
      const { app } = fixture();
      app.pending = order;
      pointerUp.call(app, 50, 50, PointerButton.Primary);
      expect(app.issueOrder).toHaveBeenCalledWith(order);
      expect(app.pending).toBe(Order.None);
      expect(app.chosen).toEqual([0, 1]);
    },
  );
  it('secondary click always targets even while Attack is armed', () => {
    const { app } = fixture();
    app.pending = Order.Attack;
    pointerUp.call(app, 50, 50, PointerButton.Secondary);
    expect(app.issueOrder).toHaveBeenCalledWith(Order.Work);
    expect(app.chosen).toEqual([0, 1]);
  });
  it('contextual targeting of a neutral animal approaches without attacking', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('animal', 10);
    issueOrder.call(app, Order.Work);
    expect(app.town.orderAttack).not.toHaveBeenCalled();
    expect(app.town.orderMove).toHaveBeenCalledWith([0, 1], app.cursor);
  });
  it('explicit Attack still hunts the clicked animal', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('animal', 10);
    app.town.orderAttack = vi.fn(() => true);
    app.town.approachOrder = vi.fn();
    issueOrder.call(app, Order.Attack);
    expect(app.town.orderAttack).toHaveBeenCalledTimes(2);
  });
  it('contextual targeting can defend against an already hostile animal', () => {
    const { app, animal } = fixture();
    animal.angry = true;
    app.hoveredWorldTarget!.hit = presentedHit('animal', 10);
    app.town.orderAttack = vi.fn(() => true);
    app.town.approachOrder = vi.fn();
    issueOrder.call(app, Order.Work);
    expect(app.town.orderAttack).toHaveBeenCalledTimes(2);
  });
  it('an explicit Attack targets the front person without changing group selection', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('person', 1);
    issueOrder.call(app, Order.Attack);
    expect(app.town.orderAttackPerson).toHaveBeenCalledWith([0, 1], 1);
    expect(app.chosen).toEqual([0, 1]);
  });
  it('contextual dungeon targeting uses the same front hit and falls back to movement if rejected', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('dungeon', 2);
    issueOrder.call(app, Order.Work);
    expect(app.town.sendExpedition).toHaveBeenCalledWith([0, 1], 2);
    expect(app.town.orderMove).not.toHaveBeenCalled();
    app.town.sendExpedition = vi.fn(() => false);
    issueOrder.call(app, Order.Work);
    expect(app.town.orderMove).toHaveBeenCalledWith([0, 1], app.cursor);
  });
  it('right-clicking a companion approaches without friendly fire', () => {
    const { app, people } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('person', 1);
    issueOrder.call(app, Order.Work);
    expect(app.town.orderAttackPerson).not.toHaveBeenCalled();
    expect(app.town.orderMove).toHaveBeenCalledWith([0, 1], people[1].position);
  });
});
