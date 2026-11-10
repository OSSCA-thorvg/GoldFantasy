import { describe, it, expect, vi } from 'vitest';
import { selectionTargets, selectionReferences } from '../../apps/web/src/native/selection-targets';
import { WorldMap } from '../../packages/engine/src/world-map';
import { makeTile, Terrain } from '../../packages/engine/src/world-types';
import { Person, Role, Calling, Race, Monster, AnimalKind } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import * as mining from '../../packages/engine/src/mining';
import {
  worldObjectKey,
  type SelectionGeometry,
} from '../../packages/native-renderer/src/world-picking-types';
import type { GameCommandApp } from '../../apps/web/src/native/game-commands';
function fixture() {
  const map = new WorldMap();
  map.columns = map.rows = 32;
  map.tiles = Array.from({ length: 1024 }, makeTile);
  const people = [0, 1].map(
    (id) => new Person(id, 'Person ' + id, Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10)),
  );
  const buildings = [new Building(4, Structure.Camp, point(10, 10), 0, 0)],
    animal = new Monster(7, -1, point(10, 10));
  animal.animal = AnimalKind.Cow;
  const geometries = new Map<string, SelectionGeometry>();
  const app = {
    town: {
      map: () => map,
      person: (id: number) => people[id] ?? null,
      building: (id: number) => buildings.find((b) => b.id === id) ?? null,
      creature: (id: number) => (id === 7 ? animal : null),
      roads: () => ({ road: () => null }),
      field: () => null,
    },
    renderer: { selectionGeometry: vi.fn((ref: any) => geometries.get(worldObjectKey(ref)) ?? null) },
    chosen: [],
    selected: -1,
    selectedTree: -1,
    selectedTreeInstance: -1,
    selectedRock: -1,
    selectedAnimal: -1,
    selectedDungeon: -1,
    selectedObjects: [],
  } as unknown as GameCommandApp;
  const geometry = (x = 100): SelectionGeometry => ({
    foot: point(x, 150),
    bounds: { x: x - 15, y: 90, w: 30, h: 60 },
    labelAnchor: point(x, 90),
    ellipse: { rx: 12, ry: 5 },
    opacity: 255,
  });
  return { app, map, people, buildings, animal, geometries, geometry };
}
describe('selection follows the last presented target geometry', () => {
  it('uses the renderer snapshot without recomputing building bounds or testing native paints', () => {
    const { app, buildings, geometries, geometry } = fixture(),
      g = geometry();
    app.selected = 4;
    geometries.set('building:4', g);
    expect(selectionTargets(app)[0]).toMatchObject({ key: 'building:4', geometry: g, bounds: g.bounds });
    buildings[0].angle = 1.5;
    buildings[0].center = point(20, 20);
    expect(selectionTargets(app)[0].geometry).toBe(g);
    const updated = geometry(230);
    geometries.set('building:4', updated);
    expect(selectionTargets(app)[0].geometry).toBe(updated);
  });
  it('retains the precise clicked tree instance instead of following the last standing tree', () => {
    const { app, map, geometries, geometry } = fixture();
    map.at(10, 10).trees = 3;
    app.selectedTree = 330;
    app.selectedTreeInstance = 0;
    geometries.set('tree:330:0', geometry());
    expect(selectionTargets(app)[0].key).toBe('tree:330:0');
    map.at(10, 10).trees = 2;
    expect(selectionTargets(app)[0].key).toBe('tree:330:0');
    app.selectedTreeInstance = 2;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedTree).toBe(-1);
    expect(app.selectedTreeInstance).toBe(-1);
  });
  it('clears a fully harvested resource without switching to another object', () => {
    const { app, map, geometries, geometry } = fixture();
    map.at(10, 10).trees = 1;
    app.selectedTree = 330;
    app.selectedTreeInstance = 0;
    geometries.set('tree:330:0', geometry());
    map.at(10, 10).trees = 0;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedTree).toBe(-1);
  });
  it('clears a quarried rock from inspection', () => {
    const { app, map } = fixture();
    map.mapSeed = 5;
    for (let x = 8; x < 13; x++) map.at(x, 10).terrain = Terrain.Rock;
    const x = [8, 9, 10, 11, 12].find((x) => mining.deposit(map, x, 10))!;
    app.selectedRock = 320 + x;
    map.at(x, 10).quarried = true;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedRock).toBe(-1);
  });
  it('keeps a hidden or off-screen living animal selected without drawing a synthetic marker', () => {
    const { app, geometries, geometry } = fixture();
    app.selectedAnimal = 7;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedAnimal).toBe(7);
    geometries.set('animal:7', geometry(210));
    expect(selectionTargets(app)[0].geometry.foot.x).toBe(210);
  });
  it('drops dead people and removed buildings', () => {
    const { app, people, buildings } = fixture();
    app.chosen = [0, 1];
    people[0].health = 0;
    expect(selectionReferences(app)).toEqual([{ kind: 'person', id: 1 }]);
    app.chosen = [];
    app.selected = 4;
    buildings.length = 0;
    expect(selectionReferences(app)).toEqual([]);
    expect(app.selected).toBe(-1);
  });
  it('keeps non-unit inspection singular', () => {
    const { app } = fixture();
    app.selectedObjects = [
      { kind: 'animal', id: 7 },
      { kind: 'landmark', id: 2 },
    ];
    expect(selectionReferences(app)).toEqual([{ kind: 'animal', id: 7 }]);
    expect(app.selectedObjects).toHaveLength(1);
  });
  it('does not fabricate geometry for an undisplayed frame', () => {
    const { app } = fixture();
    app.selected = 4;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selected).toBe(4);
  });
});
