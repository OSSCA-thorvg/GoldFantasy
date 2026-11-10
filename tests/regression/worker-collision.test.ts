import { footBoxesOverlap } from '../../packages/engine/src/person-collision';
import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain } from '../../packages/engine/src/world-types';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Activity, AnimalKind, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { point, distance } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';

let base: Town;
beforeAll(() => {
  const map = WorldMap.generate(5, 32, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      Object.assign(map.at(x, y), { terrain: Terrain.Grass, trees: 0, wild: 0, revealed: true });
  base = new Town(map, 32, false);
  base.titleAutoplay = true; // Freeze unrelated wildlife and raids, not resident scheduling.
  const camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  camp.village = 0;
  base.placed.push(camp);
  base.nextId = 1;
  base.foundSettlement(0);
  for (let i = 0; i < 2; i++) {
    const p = new Person(
      i,
      `Worker ${i}`,
      Role.Resident,
      Calling.Settler,
      Race.Human,
      i,
      point(15, 18 + i * 0.5),
    );
    p.home = p.village = 0;
    p.food = p.rest = p.health = 1;
    base.folk.push(p);
  }
  base.nextPerson = 2;
  base.tick(0);
});
function advance(town: Town, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) town.advance(0.1);
}
function diagnostics(town: Town) {
  return town
    .people()
    .map((p) => ({ activity: Activity[p.activity], position: p.position, path: p.path, target: p.target }));
}

describe('resident work foot bounds', () => {
  it('keeps simultaneous builders apart while both make construction progress', () => {
    const town = copyNative(base),
      site = new Building(town.nextId++, Structure.Storehouse, point(19, 18), 0, 0);
    site.village = 0;
    site.progress = 0;
    town.placed.push(site);
    town.changes++;
    expect(town.orderBuild([0, 1], site.id)).toBe(true);
    advance(town, 8);
    expect(
      town.people().every((p) => p.activity === Activity.Building && !p.moving()),
      JSON.stringify(diagnostics(town)),
    ).toBe(true);
    expect(
      footBoxesOverlap(town.folk[0].position, town.folk[1].position),
      JSON.stringify(diagnostics(town)),
    ).toBe(false);
    const progress = site.progress;
    advance(town, 2);
    expect(site.progress).toBeGreaterThan(progress);
  });
  it('keeps two processing workers at separate reachable work positions', () => {
    const town = copyNative(base),
      mill = new Building(town.nextId++, Structure.Sawmill, point(19, 18), 0, 0);
    mill.village = 0;
    town.placed.push(mill);
    town.stock().wood = 30;
    for (const p of town.people()) { p.inventory[0] = { item: 'saw', quantity: 1 }; p.equipment.tool1 = 1; }
    town.changes++;
    expect(town.assignJob([0, 1], mill.id)).toBe(true);
    advance(town, 8);
    expect(
      town.people().every((p) => p.activity === Activity.Working && !p.moving()),
      JSON.stringify(diagnostics(town)),
    ).toBe(true);
    expect(
      footBoxesOverlap(town.folk[0].position, town.folk[1].position),
      JSON.stringify(diagnostics(town)),
    ).toBe(false);
    advance(town, 20);
    expect(town.stock().planks).toBeGreaterThan(0);
  });
  it('allows two melee fighters to attack without stacking at the same range point', () => {
    const town = copyNative(base),
      foe = new Monster(100, 0, point(20, 18));
    foe.animal = AnimalKind.Cow;
    foe.health = 1000;
    town.animals = [foe];
    expect(town.orderAttack([0, 1], foe.id)).toBe(true);
    advance(town, 8);
    expect(
      town.people().every((p) => p.activity === Activity.Fighting),
      JSON.stringify(diagnostics(town)),
    ).toBe(true);
    expect(
      footBoxesOverlap(town.folk[0].position, town.folk[1].position),
      JSON.stringify(diagnostics(town)),
    ).toBe(false);
    expect(foe.health).toBeLessThan(1000);
  });
});
