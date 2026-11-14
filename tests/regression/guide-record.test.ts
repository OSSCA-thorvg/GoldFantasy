import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';

function settlement(): Town {
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
  town.folk = [];
  town.nextPerson = 0;
  town.tick(0);
  return town;
}
const version = (save: string) => Number.parseInt(save.slice(17, 19), 16);
const load = (save: string) => decodeTown(save, (map) => new Town(map, 48, false, true));

describe('what the player has already been told', () => {
  it('is kept across a save, so a first-time explanation does not come back after a load', () => {
    const town = settlement();
    town.told.push('wood', 'gate', 'built:Farm');
    const save = encodeTown(town);
    expect(version(save)).toBe(17);
    expect(load(save).told).toEqual(['wood', 'gate', 'built:Farm']);
  });
  it('costs a game that has told nothing no newer save version, and older saves load with nothing told', () => {
    const town = settlement(),
      plain = encodeTown(town);
    expect(version(plain)).toBeLessThan(17);
    expect(load(plain).told).toEqual([]);
  });
});
