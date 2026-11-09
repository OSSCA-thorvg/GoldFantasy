import { describe, expect, it } from 'vitest';
import { selectionTargets, type SelectionTargetApp } from '../../apps/web/src/native/selection-targets';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { WorldMap, treePosition } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { AnimalKind, Monster } from '../../packages/engine/src/person';
import { animalSpec } from '../../packages/engine/src/wildlife';
import * as mining from '../../packages/engine/src/mining';
import { selectionFrame } from '../../packages/native-renderer/src/selection-marker';

function fixture() {
  const map = new WorldMap();
  map.columns = map.rows = 32;
  map.mapSeed = 5;
  map.tiles = Array.from({ length: 32 * 32 }, makeTile);
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(65 * 65));
  map.seen = [{ center: point(16, 16), radius: 100 }];
  const buildings: Building[] = [],
    animals: Monster[] = [],
    center = project(10, 10),
    camera = new Camera(center.x, center.y, 1);
  let visible = true;
  const app: SelectionTargetApp = {
    town: {
      map: () => map,
      building: (id) => buildings.find((b) => b.id === id) ?? null,
      creature: (id) => animals.find((a) => a.id === id) ?? null,
    },
    renderer: {
      visible: () => visible,
      buildingRoof: (b) => {
        const p = project(b.center.x, b.center.y);
        return point(p.x, p.y - 80);
      },
    },
    camera,
    viewWidth: 800,
    viewHeight: 600,
    selected: -1,
    selectedTree: -1,
    selectedRock: -1,
    selectedAnimal: -1,
    selectedDungeon: -1,
    toScreen: (p) => camera.toScreen(project(p.x, p.y), app.viewWidth, app.viewHeight),
  };
  return { app, map, camera, buildings, animals, setVisible: (value: boolean) => (visible = value) };
}

describe('world target selection bounds', () => {
  it('encloses a rotated building footprint and cached roof through zoom and camera movement', () => {
    const { app, camera, buildings } = fixture(),
      building = new Building(4, Structure.Camp, point(10, 10), Math.PI / 4, 0);
    buildings.push(building);
    app.selected = building.id;
    camera.zoom = 2;
    const first = selectionTargets(app)[0];
    expect(first.key).toBe('building:4');
    for (const corner of building.footprint().corners()) {
      const screen = app.toScreen(corner);
      expect(screen.x).toBeGreaterThanOrEqual(first.bounds.x);
      expect(screen.x).toBeLessThanOrEqual(first.bounds.x + first.bounds.w);
      expect(screen.y).toBeGreaterThanOrEqual(first.bounds.y);
      expect(screen.y).toBeLessThanOrEqual(first.bounds.y + first.bounds.h);
    }
    expect(first.bounds.y).toBe(140);
    camera.x += 20;
    camera.y += 10;
    const second = selectionTargets(app)[0].bounds;
    expect(second.x).toBeCloseTo(first.bounds.x - 40);
    expect(second.y).toBeCloseTo(first.bounds.y - 20);
    expect(second.w).toBe(first.bounds.w);
    expect(second.h).toBe(first.bounds.h);
  });

  it('uses the last standing tree in a selected cell and follows the next tree after harvesting', () => {
    const { app, map } = fixture(),
      cell = 10 * 32 + 10;
    app.selectedTree = cell;
    map.at(10, 10).trees = 3;
    const first = selectionTargets(app)[0].bounds,
      foot = app.toScreen(treePosition(map, 10, 10, 2));
    expect(first.x + first.w / 2).toBeCloseTo(foot.x);
    expect(first.y + first.h).toBeCloseTo(foot.y);
    map.at(10, 10).trees--;
    const second = selectionTargets(app)[0].bounds,
      nextFoot = app.toScreen(treePosition(map, 10, 10, 1));
    expect(second.x + second.w / 2).toBeCloseTo(nextFoot.x);
    expect(second.y + second.h).toBeCloseTo(nextFoot.y);
    expect(app.selectedTree).toBe(cell);
    map.at(10, 10).trees = 0;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedTree).toBe(-1);
  });

  it('encloses both the top and lower facet of the actual rock and clears a quarried deposit', () => {
    const { app, map, camera } = fixture();
    for (let x = 8; x < 13; x++) map.at(x, 10).terrain = Terrain.Rock;
    const x = [8, 9, 10, 11, 12].find((candidate) => mining.deposit(map, candidate, 10))!;
    expect(x).toBeDefined();
    app.selectedRock = 10 * 32 + x;
    camera.zoom = 3;
    const bounds = selectionTargets(app)[0].bounds,
      foot = app.toScreen(mining.position(x, 10)),
      radius = mining.size(map, x, 10) * 3;
    expect(bounds.x).toBeCloseTo(foot.x - radius);
    expect(bounds.y).toBeCloseTo(foot.y - radius * 1.1);
    expect(bounds.y + bounds.h).toBeCloseTo(foot.y + radius * 0.2);
    map.at(x, 10).quarried = true;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedRock).toBe(-1);
  });

  it('hides a moving animal outside current vision without losing its selection, then follows its return', () => {
    const { app, animals, setVisible } = fixture(),
      animal = new Monster(12, -1, point(10, 10));
    animal.animal = AnimalKind.Cow;
    animals.push(animal);
    app.selectedAnimal = animal.id;
    const before = selectionTargets(app)[0].bounds,
      spec = animalSpec(AnimalKind.Cow);
    expect(before.w).toBe(spec.width);
    expect(before.h).toBe(spec.height);
    setVisible(false);
    animal.position = point(11, 10);
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedAnimal).toBe(animal.id);
    setVisible(true);
    const after = selectionTargets(app)[0].bounds;
    expect(after.x - before.x).toBe(32);
    expect(after.y - before.y).toBe(16);
    animal.insideLair = true;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedAnimal).toBe(animal.id);
    animal.health = 0;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedAnimal).toBe(-1);
  });

  it('keeps explored static targets in memory, while undiscovered targets and fogged animals stay hidden', () => {
    const { app, map, buildings, animals, setVisible } = fixture();
    buildings.push(new Building(1, Structure.Camp, point(10, 10), 0, 0));
    app.selected = 1;
    map.at(10, 10).trees = 1;
    app.selectedTree = 330;
    map.sites.push({ name: 'Known cave', kind: DungeonKind.Cave, origin: { x: 9, y: 9 }, discovered: true });
    app.selectedDungeon = 0;
    const animal = new Monster(2, -1, point(10, 10));
    animal.animal = AnimalKind.Dog;
    animals.push(animal);
    app.selectedAnimal = 2;
    setVisible(false);
    expect(selectionTargets(app).map((target) => target.key)).toEqual([
      'building:1',
      'tree:330',
      'dungeon:0',
    ]);
    map.seen = [];
    map.sites[0].discovered = false;
    expect(selectionTargets(app)).toEqual([]);
    expect([app.selected, app.selectedTree, app.selectedDungeon, app.selectedAnimal]).toEqual([1, 330, 0, 2]);
  });

  it.each([DungeonKind.Cave, DungeonKind.Crypt, DungeonKind.Portal, DungeonKind.Ruin, DungeonKind.GiantHall])(
    'frames the full dungeon silhouette rather than a ground ring for kind %i',
    (kind) => {
      const { app, map, camera } = fixture();
      map.sites.push({ name: 'Site', kind, origin: { x: 9, y: 9 }, discovered: true });
      app.selectedDungeon = 0;
      camera.zoom = 2;
      const bounds = selectionTargets(app)[0].bounds;
      expect(bounds.w).toBeGreaterThan(150);
      expect(bounds.y).toBeLessThanOrEqual(220);
      expect(bounds.y + bounds.h).toBeGreaterThan(320);
      expect(bounds.x).toBeLessThan(400);
      expect(bounds.x + bounds.w).toBeGreaterThan(400);
    },
  );

  it('rejects removed and out-of-range targets safely and only clears stale UI IDs', () => {
    const { app } = fixture();
    app.selected = 999;
    app.selectedTree = 1024;
    app.selectedRock = 1024;
    app.selectedAnimal = 999;
    app.selectedDungeon = 999;
    expect(selectionTargets(app)).toEqual([]);
    expect([
      app.selected,
      app.selectedTree,
      app.selectedRock,
      app.selectedAnimal,
      app.selectedDungeon,
    ]).toEqual([-1, -1, -1, -1, -1]);
    app.selectedTree = 330.5;
    app.selectedRock = 330.5;
    app.selectedDungeon = 0.5;
    expect(selectionTargets(app)).toEqual([]);
    expect([app.selectedTree, app.selectedRock, app.selectedDungeon]).toEqual([-1, -1, -1]);
  });

  it('culls distant targets while retaining a padded corner that still intersects the viewport', () => {
    const { app, camera, animals } = fixture(),
      animal = new Monster(3, -1, point(10, 10));
    animal.animal = AnimalKind.Chicken;
    animals.push(animal);
    app.selectedAnimal = 3;
    camera.zoom = 0.1;
    camera.x = 10000;
    expect(selectionTargets(app)).toEqual([]);
    expect(app.selectedAnimal).toBe(3);
    // At tiny zoom the artwork can be outside while its minimum-size frame is still visible.
    camera.x = 4050;
    const target = selectionTargets(app)[0];
    expect(target.bounds.x + target.bounds.w).toBeLessThan(0);
    expect(selectionFrame(target.bounds).x + selectionFrame(target.bounds).w).toBeGreaterThan(0);
    app.viewWidth = 390;
    app.viewHeight = 844;
    camera.x = 0;
    expect(selectionTargets(app)[0].bounds.x + target.bounds.w / 2).toBeCloseTo(195);
  });
});
