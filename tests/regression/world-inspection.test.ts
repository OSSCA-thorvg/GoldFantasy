import { describe, it, expect } from 'vitest';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, makeTile, Giant, Volcano, Terrain } from '../../packages/engine/src/world-types';
import { Person, Role, Calling, Race, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Building, Field } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { RoadNetwork } from '../../packages/engine/src/road-network';
import { targetsInBox, worldTarget, hoveredTarget } from '../../apps/web/src/native/world-targets';
import type { GameCommandApp } from '../../apps/web/src/native/game-commands';
import { worldObjectPanel } from '../../apps/web/src/native/game-selection-panel';
import { Rect } from '../../packages/native-ui/src';
import { SceneNode, ShapeNode } from '../../packages/native-renderer/src/paint';
import { select } from '../../apps/web/src/native/game-input';

function fixture() {
  const map = new WorldMap();
  map.columns = map.rows = 32;
  map.tiles = Array.from({ length: 1024 }, makeTile);
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(65 * 65));
  map.seen = [{ center: point(16, 16), radius: 100 }];
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
  const building = new Building(4, Structure.Tent, point(12, 12), 0, 1),
    field = new Field(5, [point(9, 9), point(10, 9), point(10, 10), point(9, 10)]);
  const monster = new Monster(6, -1, point(10, 11)),
    animal = new Monster(7, -1, point(11, 11));
  animal.animal = AnimalKind.Cow;
  map.at(9, 10).trees = 1;
  const at = project(11, 11),
    camera = new Camera(at.x, at.y, 1),
    network = new RoadNetwork();
  const app = {
    camera,
    viewWidth: 800,
    viewHeight: 600,
    mouse: point(400, 300),
    cursor: point(11, 11),
    toScreen: (p: ReturnType<typeof point>) => camera.toScreen(project(p.x, p.y), 800, 600),
    renderer: { visible: () => true, buildingRoof: () => null },
    context: { controlAt: () => false },
    town: {
      map: () => map,
      people: () => people,
      person: (id: number) => people[id] ?? null,
      buildings: () => [building],
      building: (id: number) => (id === 4 ? building : null),
      monsters: () => [monster],
      wildlife: () => [animal],
      creature: (id: number) => (id === 6 ? monster : id === 7 ? animal : null),
      fields: () => [field],
      field: () => field,
      fieldAt: () => -1,
      roads: () => network,
      monsterAt: () => 6,
    },
    personAt: () => -1,
    animalAtScreen: () => -1,
    buildingAtScreen: () => -1,
    treeAtScreen: () => -1,
    rockAtScreen: () => -1,
  } as unknown as GameCommandApp;
  return { app, people, map, monster };
}
describe('visible world inspection', () => {
  it('marquee hits residents, visitors, neutral people, buildings, wildlife, monsters, trees and fields', () => {
    const { app } = fixture(),
      refs = targetsInBox(app, { x: 0, y: 0, w: 800, h: 600 });
    expect(refs).toEqual(
      expect.arrayContaining([
        { kind: 'person', id: 0 },
        { kind: 'person', id: 1 },
        { kind: 'person', id: 2 },
        { kind: 'building', id: 4 },
        { kind: 'monster', id: 6 },
        { kind: 'animal', id: 7 },
        { kind: 'tree', id: 329 },
        { kind: 'field', id: 5 },
      ]),
    );
  });
  it('resolves the name and silhouette of an ordinary monster and permits hover inspection', () => {
    const { app } = fixture();
    expect(hoveredTarget(app)).toEqual({ kind: 'monster', id: 6 });
    expect(worldTarget(app, { kind: 'monster', id: 6 })).toMatchObject({ name: 'Monster', key: 'monster:6' });
  });
  it('click and hover use the same front target when a monster overlaps a building', () => {
    const { app } = fixture();
    app.buildingAtScreen = () => 4;
    select.call(app);
    expect(app.selectedObjects).toEqual([{ kind: 'monster', id: 6 }]);
    expect(app.selected).toBe(-1);
  });
  it('does not expose hidden creatures and ignores objects outside the actual marquee', () => {
    const { app } = fixture();
    app.renderer.visible = () => false;
    expect(worldTarget(app, { kind: 'monster', id: 6 })).toBeNull();
    expect(targetsInBox(app, { x: 2, y: 2, w: 5, h: 5 })).toEqual([]);
  });
});

describe('landmark inspection', () => {
  it('includes Ymir’s visible head above its ground footprint even through unexplored fog', () => {
    const { app, map } = fixture();
    map.ymir = new Giant({ x: 8, y: 8 });
    map.seen = [];
    app.town.monsterAt = () => -1;
    app.camera.y -= 300;
    const target = worldTarget(app, { kind: 'landmark', id: 0 });
    expect(target?.name).toBe('Ymir');
    expect(target!.bounds.h).toBeGreaterThan(450);
    const at = app.toScreen(map.ymir.center());
    expect(target!.bounds.y).toBeLessThan(at.y - 400);
    app.mouse = point(at.x, at.y - 400);
    expect(hoveredTarget(app)).toEqual({ kind: 'landmark', id: 0 });
    expect(targetsInBox(app, { x: at.x - 10, y: at.y - 410, w: 20, h: 20 })).toContainEqual({
      kind: 'landmark',
      id: 0,
    });
    select.call(app);
    expect(app.selectedObjects).toEqual([{ kind: 'landmark', id: 0 }]);
  });
  it('reveals volcano inspection only after exploration and includes its smoke silhouette', () => {
    const { app, map } = fixture();
    map.fire = new Volcano({ x: 8, y: 8 });
    map.seen = [];
    expect(worldTarget(app, { kind: 'landmark', id: 1 })).toBeNull();
    map.seen.push({ center: map.fire.center(), radius: 1 });
    const target = worldTarget(app, { kind: 'landmark', id: 1 })!;
    expect(target.name).toBe('Fire Mountain');
    expect(target.bounds.w).toBeGreaterThan(900);
    expect(target.bounds.y).toBeLessThan(app.toScreen(map.fire.center()).y - 700);
  });
  it('excludes a hidden or nonexistent spring and follows the drawn lake rim once revealed', () => {
    const { app, map } = fixture(),
      center = point(16, 16);
    map.hvergelmir = () => center;
    map.seen = [];
    map.value = (layer, p) =>
      layer === Layer.Land
        ? Math.hypot(p.x - center.x, p.y - center.y) < 3
          ? 0.8
          : 0
        : layer === Layer.Elevation
          ? 0.1
          : 0.5;
    map.at(16, 16).terrain = Terrain.Water;
    expect(worldTarget(app, { kind: 'landmark', id: 2 })).toBeNull();
    map.reveal(16, 16, 5);
    const target = worldTarget(app, { kind: 'landmark', id: 2 })!;
    expect(target.name).toBe('Hvergelmir');
    expect(target.bounds.w).toBeGreaterThan(200);
    map.value = () => 0;
    expect(worldTarget(app, { kind: 'landmark', id: 2 })).toBeNull();
  });
});

it('keeps landmark bounds attached to the actual retained art while the camera pans and zooms', () => {
  const { app, map } = fixture();
  map.ymir = new Giant({ x: 8, y: 8 });
  const base = project(11, 11),
    paint = new SceneNode().add(new ShapeNode().appendRect(base.x - 200, base.y - 500, 400, 580));
  (app.renderer as any).ymirPaint = { paint, key: 1n };
  const first = worldTarget(app, { kind: 'landmark', id: 0 })!.bounds;
  expect(first.w).toBe(400);
  expect(first.h).toBe(580);
  app.camera.zoom = 2;
  app.camera.x += 40;
  const second = worldTarget(app, { kind: 'landmark', id: 0 })!.bounds;
  expect(second.w).toBe(first.w * 2);
  expect(second.h).toBe(first.h * 2);
  expect(second.x).toBe(app.camera.toScreen(point(base.x - 200, base.y - 500), 800, 600).x);
  paint.remove().add(new ShapeNode().appendRect(base.x - 220, base.y - 520, 440, 600));
  expect(worldTarget(app, { kind: 'landmark', id: 0 })!.bounds.h).toBe(1200);
  map.ymir = null;
  expect(worldTarget(app, { kind: 'landmark', id: 0 })).toBeNull();
});
it('refreshes spring silhouette bounds after terrain repaint and never invents an absent landmark', () => {
  const { app, map } = fixture(),
    center = point(16, 16);
  let radius = 3;
  map.hvergelmir = () => center;
  map.seen = [];
  map.reveal(16, 16, 20);
  map.value = (layer, p) =>
    layer === Layer.Land
      ? Math.hypot(p.x - center.x, p.y - center.y) < radius
        ? 0.8
        : 0
      : layer === Layer.Elevation
        ? 0.1
        : 0.5;
  const ornaments = new SceneNode();
  (app.renderer as any).ornaments = ornaments;
  const before = worldTarget(app, { kind: 'landmark', id: 2 })!.bounds;
  radius = 6;
  ornaments.remove();
  const after = worldTarget(app, { kind: 'landmark', id: 2 })!.bounds;
  expect(after.w).toBeGreaterThan(before.w * 1.5);
  expect(worldTarget(app, { kind: 'landmark', id: 0 })).toBeNull();
  expect(worldTarget(app, { kind: 'landmark', id: 1 })).toBeNull();
  expect(worldTarget(app, { kind: 'landmark', id: 9 })).toBeNull();
});
it('shows a static landmark description without building or unit command actions', () => {
  const { app, map } = fixture();
  map.ymir = new Giant({ x: 8, y: 8 });
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
