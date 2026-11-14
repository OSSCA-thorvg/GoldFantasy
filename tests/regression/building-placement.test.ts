import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind, makeTile } from '../../packages/engine/src/world-types';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';

function settlement(): Town {
  const map = new WorldMap();
  map.columns = map.rows = 40;
  map.mapSeed = 5;
  map.origin = point(20, 20);
  map.tiles = Array.from({ length: 1600 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(81 * 81).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(16, 16), discovered: true }];
  map.reveal(20, 20, 100);
  const town = new Town(map, 40, false);
  expect(town.place(Structure.Camp, point(20, 20), 0), town.canPlace(Structure.Camp, point(20, 20), 0).reason).toBe(true);
  town.completeConstruction();
  town.stock().add(new Resources(100, 100, 100, 100, 100, 100));
  town.tick(0);
  return town;
}
/** Water all round a 5 x 5 plot, as a lake shore or a river bend can leave it. */
function moat(town: Town, x: number, y: number): void {
  for (let dx = -3; dx <= 3; ++dx)
    for (let dy = -3; dy <= 3; ++dy)
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 3) town.map().at(x + dx, y + dy).terrain = Terrain.Water;
  town.grid.rebuild(
    town.map(),
    town.network,
    town.buildings().map((b) => b.footprint()),
  );
}

describe('placing a building', () => {
  it('refuses a plot whose doorway the builders cannot walk to', () => {
    const town = settlement();
    expect(town.canPlace(Structure.Tent, point(30, 30), 0).reason).toBe('');
    moat(town, 30, 30);
    const cut = town.canPlace(Structure.Tent, point(30, 30), 0);
    expect(cut.ok).toBe(false);
    expect(cut.reason).toBe('Builders cannot reach its door');
    expect(town.place(Structure.Tent, point(30, 30), 0)).toBe(false);
    // The same plot elsewhere is still fine, and so is one whose door opens onto open ground.
    expect(town.canPlace(Structure.Tent, point(24, 12), 0).reason).toBe('');
  });
  it('accepts the plot again once a way to it exists', () => {
    const town = settlement();
    moat(town, 30, 30);
    expect(town.canPlace(Structure.Tent, point(30, 30), 0).ok).toBe(false);
    town.map().at(27, 30).terrain = Terrain.Grass;
    town.grid.rebuild(
      town.map(),
      town.network,
      town.buildings().map((b) => b.footprint()),
    );
    expect(town.canPlace(Structure.Tent, point(30, 30), 0).reason).toBe('');
  });
});
