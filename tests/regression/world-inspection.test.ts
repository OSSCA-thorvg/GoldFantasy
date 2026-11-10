import { describe, it, expect } from 'vitest';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, makeTile } from '../../packages/engine/src/world-types';
import { Person, Role, Calling, Race, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Building, Field } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { RoadNetwork } from '../../packages/engine/src/road-network';
import { targetsInBox, worldTarget, hoveredTarget } from '../../apps/web/src/native/world-targets';
import type { GameCommandApp } from '../../apps/web/src/native/game-commands';
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
