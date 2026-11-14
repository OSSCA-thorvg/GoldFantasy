import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { distance, point, type Point } from '../../packages/engine/src/geometry';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';

/** A camp, two founders on Auto beside it, and a tent site they would start on by themselves. */
function fixture(waiting: boolean) {
  const map = new WorldMap();
  map.columns = map.rows = 48;
  map.mapSeed = 5;
  map.origin = { x: 12, y: 12 };
  map.tiles = Array.from({ length: 48 * 48 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(97 * 97).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Cave', kind: DungeonKind.Cave, origin: { x: 38, y: 38 }, discovered: true }];
  map.reveal(24, 24, 100);
  const town = new Town(map, 48, false);
  town.placed.push(new Building(0, Structure.Camp, point(12, 12), 0, 0));
  town.nextId = 1;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(200, 60, 60, 60, 0, 60, 20, 20));
  town.folk = [];
  town.nextPerson = 0;
  const founder = (at: Point) => {
    const p = new Person(town.nextPerson++, `F${town.nextPerson}`, Role.Resident, Calling.Settler, Race.Human, 0, { ...at });
    p.home = p.village = 0;
    p.food = p.rest = p.health = p.hydration = 1;
    p.stress = 0;
    town.folk.push(p);
    return p;
  };
  const people = [founder(point(14, 12)), founder(point(14.8, 12.4))],
    site = new Building(town.nextId++, Structure.Tent, point(18, 14), 0, 0);
  site.progress = 0;
  site.village = 0;
  site.materials.required = new Resources(0, 4);
  town.placed.push(site);
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.awaiting = waiting;
  town.tick(0);
  return { town, people, site };
}
function run(town: Town, seconds: number): void {
  for (let i = 0; i < seconds * 10; ++i) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
  }
}
const places = (people: readonly Person[]) => people.map((p) => ({ ...p.position }));
const moved = (before: readonly Point[], people: readonly Person[]) =>
  people.map((p, i) => distance(before[i], p.position) > 0.05);

describe('a new game waits for the player', () => {
  it('keeps the founders standing where they woke until an order is given', () => {
    const { town, people, site } = fixture(true),
      start = places(people);
    run(town, 30);
    expect(moved(start, people)).toEqual([false, false]);
    expect(people.map((p) => p.activity)).toEqual([Activity.Idle, Activity.Idle]);
    expect(site.progress).toBe(0);
    expect(town.awaiting).toBe(true);
  });
  it('would otherwise have them set to work on their own at once', () => {
    const { town, people } = fixture(false),
      start = places(people);
    run(town, 30);
    expect(moved(start, people)).toContain(true);
  });
  it('ends the wait with the first order to anyone, and then everyone goes about their work', () => {
    const { town, people, site } = fixture(true),
      [ordered, other] = people,
      start = places(people);
    run(town, 5);
    town.orderMove([ordered.id], point(20, 20));
    expect(town.awaiting).toBe(false);
    run(town, 60);
    expect(moved(start, people)).toEqual([true, true]);
    expect(other.ordered).toBe(false);
    expect(site.progress).toBeGreaterThan(0);
  });
  it.each([
    ['placing a building', (town: Town) => town.place(Structure.Tent, point(24, 12), 0)],
    ['drawing a road', (town: Town) => town.buildRoad([sharpAnchor(point(13.2, 12)), sharpAnchor(point(20, 12))])],
    ['switching a resident to Stop', (town: Town) => (town.orderStop([0]), true)],
    ['switching a resident to Auto', (town: Town) => (town.setAuto(0, true), true)],
  ])('ends the wait on %s', (_, act) => {
    const { town } = fixture(true);
    expect(act(town)).toBe(true);
    expect(town.awaiting).toBe(false);
  });
  it('still lets a waiting founder fight back when attacked', () => {
    const { town, people } = fixture(true),
      [p] = people,
      foe = new Monster(town.nextMonster++, 0, point(14.6, 12));
    foe.home = { ...foe.position };
    foe.health = foe.vigor = 100;
    foe.raider = true;
    town.beasts.push(foe);
    let fought = false;
    for (let i = 0; i < 100 && !fought; ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
      fought = p.activity === Activity.Fighting;
    }
    expect(fought).toBe(true);
    expect(town.awaiting).toBe(true);
  });
  it('is not kept in a save: a loaded game never waits', () => {
    const { town } = fixture(true),
      loaded = decodeTown(encodeTown(town), (map) => new Town(map, 48, false, true));
    expect(loaded.awaiting).toBe(false);
  });
});
