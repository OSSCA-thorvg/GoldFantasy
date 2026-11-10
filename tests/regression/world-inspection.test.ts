import { describe, it, expect, vi } from 'vitest';
import { Person, Role, Calling, Race, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { targetsInBox, worldTarget, hoveredTarget, targetKey } from '../../apps/web/src/native/world-targets';
import type { GameCommandApp } from '../../apps/web/src/native/game-commands';
import { worldObjectPanel } from '../../apps/web/src/native/game-selection-panel';
import { Rect } from '../../packages/native-ui/src';
import { select } from '../../apps/web/src/native/game-input';
import { presentedHit } from './fixtures/presented-hit';
import type {
  WorldObjectRef,
  SelectionGeometry,
} from '../../packages/native-renderer/src/world-picking-types';

function fixture() {
  const people = [0, 1, 2].map(
    (id) =>
      new Person(
        id,
        'Person ' + id,
        id === 1 ? Role.Guest : Role.Resident,
        Calling.Settler,
        Race.Human,
        5,
        point(10 + id, 10),
      ),
  );
  people[2].faction = 2;
  const building = new Building(4, Structure.Tent, point(12, 12), 0, 1);
  const monster = new Monster(6, -1, point(10, 11)),
    animal = new Monster(7, -1, point(11, 11));
  animal.animal = AnimalKind.Cow;
  const refs: WorldObjectRef[] = [
    ...people.map((p) => ({ kind: 'person' as const, id: p.id })),
    { kind: 'building', id: 4 },
    { kind: 'monster', id: 6 },
    { kind: 'animal', id: 7 },
    { kind: 'tree', id: 329, instanceIndex: 0 },
    { kind: 'field', id: 5 },
    { kind: 'landmark', id: 0 },
  ];
  const geometry = new Map<string, SelectionGeometry>(
    refs.map((ref) => [targetKey(ref), presentedHit(ref.kind, ref.id, ref.instanceIndex).geometry]),
  );
  const app = {
    mouse: point(50, 50),
    cursor: point(11, 11),
    chosen: [],
    selectedObjects: [],
    hoveredWorldTarget: { screen: point(50, 50), hit: presentedHit('monster', 6) },
    renderer: {
      pick: vi.fn(),
      selectionGeometry: vi.fn((ref: WorldObjectRef) => geometry.get(targetKey(ref)) ?? null),
      querySelection: vi.fn(() => refs.map((ref) => presentedHit(ref.kind, ref.id, ref.instanceIndex))),
    },
    context: { controlAt: () => false },
    town: {
      person: (id: number) => people[id] ?? null,
      building: (id: number) => (id === 4 ? building : null),
      creature: (id: number) => (id === 6 ? monster : id === 7 ? animal : null),
      field: () => ({ id: 5 }),
    },
    selectPeople: vi.fn(),
  } as unknown as GameCommandApp;
  return { app, geometry };
}
describe('presented world inspection', () => {
  it('marquee admits only player residents from the renderer spatial query', () => {
    const { app } = fixture(),
      box = { x: 0, y: 0, w: 100, h: 100 };
    expect(targetsInBox(app, box)).toEqual([{ kind: 'person', id: 0 }]);
    expect(app.renderer.querySelection).toHaveBeenCalledWith(box);
  });
  it('resolves names while using renderer geometry unchanged', () => {
    const { app, geometry } = fixture();
    expect(hoveredTarget(app)).toEqual({ kind: 'monster', id: 6 });
    const target = worldTarget(app, { kind: 'monster', id: 6 })!;
    expect(target).toMatchObject({ name: 'Monster', key: 'monster:6' });
    expect(target.geometry).toBe(geometry.get('monster:6'));
    expect(target.bounds).toBe(target.geometry.bounds);
    expect(app.renderer.pick).not.toHaveBeenCalled();
  });
  it('click and hover use the same front object rather than a hard-coded object-type order', () => {
    const { app } = fixture();
    select.call(app);
    expect(app.selectedObjects).toEqual([{ kind: 'monster', id: 6 }]);
    app.hoveredWorldTarget!.hit = presentedHit('building', 4);
    select.call(app);
    expect(app.selected).toBe(4);
    expect(app.selectedObjects).toEqual([]);
    expect(hoveredTarget(app)).toEqual({ kind: 'building', id: 4 });
  });
  it('does not recreate hidden geometry or enumerate the world when the presented query is empty', () => {
    const { app, geometry } = fixture();
    geometry.delete('monster:6');
    expect(worldTarget(app, { kind: 'monster', id: 6 })).toBeNull();
    app.renderer.querySelection = vi.fn(() => []);
    expect(targetsInBox(app, { x: 2, y: 2, w: 5, h: 5 })).toEqual([]);
  });
  it('keeps each tree instance distinct while its resource command still identifies the cell', () => {
    const { app, geometry } = fixture();
    const tiny = presentedHit('tree', 329, 0).geometry,
      tall = presentedHit('tree', 329, 1).geometry;
    tall.bounds = { x: 10, y: 10, w: 30, h: 60 };
    geometry.set('tree:329:1', tall);
    expect(worldTarget(app, { kind: 'tree', id: 329, instanceIndex: 0 })!.bounds).toEqual(tiny.bounds);
    expect(worldTarget(app, { kind: 'tree', id: 329, instanceIndex: 1 })!.bounds).toBe(tall.bounds);
    app.hoveredWorldTarget!.hit = presentedHit('tree', 329, 0);
    select.call(app);
    expect(app.selectedTree).toBe(329);
    expect(app.selectedTreeInstance).toBe(0);
  });
  it('takes new landmark geometry after camera/repaint changes and rejects invalidated or absent art', () => {
    const { app, geometry } = fixture();
    expect(worldTarget(app, { kind: 'landmark', id: 0 })!.name).toBe('Ymir');
    const updated = { ...geometry.get('landmark:0')!, bounds: { x: 50, y: -100, w: 800, h: 1160 } };
    geometry.set('landmark:0', updated);
    expect(worldTarget(app, { kind: 'landmark', id: 0 })!.geometry).toBe(updated);
    geometry.delete('landmark:0');
    expect(worldTarget(app, { kind: 'landmark', id: 0 })).toBeNull();
    for (const id of [1, 2, 9]) expect(worldTarget(app, { kind: 'landmark', id })).toBeNull();
  });
  it('allows individual landmark inspection without adding it to a group selection', () => {
    const { app } = fixture();
    app.hoveredWorldTarget!.hit = presentedHit('landmark', 0);
    select.call(app);
    expect(app.selectedObjects).toEqual([{ kind: 'landmark', id: 0 }]);
    expect(app.chosen).toEqual([]);
  });
});
it('shows a static landmark description without building or unit command actions', () => {
  const { app } = fixture();
  const text: string[] = [],
    controls: string[] = [],
    color = { r: 255, g: 255, b: 255, a: 255 };
  const theme = {
    frameStyle: 0,
    radius: 0,
    text: color,
    accent: color,
    muted: color,
    surface: color,
    raised: color,
    border: color,
  };
  Object.assign(app, {
    selectedObjects: [{ kind: 'landmark', id: 0 }],
    objectPage: 0,
    theme,
    context: {
      theme: () => theme,
      text: (_r: Rect, words: string) => text.push(words),
      elideText: (s: string) => s,
      control: (id: string) => {
        controls.push(id);
        return { hovered: false, focused: false, pressed: false };
      },
      rect: () => {},
      line: () => {},
    },
  });
  worldObjectPanel.call(app as any, new Rect(0, 0, 420, 148));
  expect(text).toContain('Ymir');
  expect(text.some((s) => s.includes('primordial giant'))).toBe(true);
  expect(controls).toEqual(['objects-prev', 'objects-next']);
});
