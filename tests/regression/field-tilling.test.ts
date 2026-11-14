import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building, Field } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { point, distance } from '../../packages/engine/src/geometry';
import { farmWorkPhase, fieldRows } from '../../packages/engine/src/farm-work';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';

function fixture() {
  const size = 64,
    map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = { x: 12, y: 12 };
  map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [];
  map.reveal(size / 2, size / 2, size * 2);
  const town = new Town(map, size, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0),
    farm = new Building(1, Structure.Farm, point(16, 12), 0, 0);
  town.placed.push(camp, farm);
  town.nextId = 2;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(1000, 100, 100, 100, 0, 100));
  const p = new Person(0, 'Farmer', Role.Resident, Calling.Settler, Race.Human, 0, point(15, 13));
  p.home = p.village = 0;
  p.food = p.rest = p.hydration = p.health = 1;
  p.stress = 0;
  p.job = farm.id;
  farm.workers = 1;
  town.folk = [p];
  town.nextPerson = 1;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.tick(0);
  return { town, farm, p };
}
const plot = [point(17.5, 13), point(21.5, 13), point(21.5, 16), point(17.5, 16)];

describe('breaking in a field', () => {
  it('stakes a new plot untilled; it yields nothing until a farm worker has hoed it', () => {
    const { town, p } = fixture();
    expect(town.plantField(plot), town.canPlantField(plot).reason).toBe(true);
    const field = town.fields()[0];
    expect(field.tilled).toBe(0);
    expect(field.acres()).toBe(12);
    expect(field.tilledAcres()).toBe(0);
    expect(town.tendedFieldAcres()).toBe(0);
    const goals = new Set<string>();
    let hoeing = 0;
    for (let i = 0; i < 3000 && field.tilled < 1; ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
      if (p.activity === Activity.Working && p.workField === field.id && !p.moving()) {
        ++hoeing;
        goals.add(p.goal.x.toFixed(1) + ',' + p.goal.y.toFixed(1));
        // Breaking in is hoe work throughout; watering only starts on a finished plot.
        if (field.tilled < 1) expect(farmWorkPhase(p, town.clock(), town.fields())).toBe(0);
      }
    }
    expect(field.tilled).toBe(1);
    expect(hoeing).toBeGreaterThan(100);
    // The worker follows the furrow front across the plot instead of standing on one spot.
    expect(goals.size).toBeGreaterThan(4);
    expect(field.tilledAcres()).toBe(12);
    expect(town.notices.some((text) => text.startsWith('A field is tilled'))).toBe(true);
    const rows = fieldRows(field.outline);
    expect(Math.abs(rows.along.x)).toBe(1);
    expect(distance(rows.center, point(19.5, 14.5))).toBeLessThan(0.01);
  });
  it('keeps old fields fully tilled and saves a half-tilled one', () => {
    const { town } = fixture();
    const old = new Field(town.nextId++, plot, 0);
    town.farmland.push(old);
    expect(old.tilled).toBe(1);
    expect(decodeTown(encodeTown(town), (map) => new Town(map, 64, false, true)).fields()[0].tilled).toBe(1);
    old.tilled = 0.5;
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 64, false, true));
    expect(loaded.fields()[0].tilled).toBe(0.5);
    expect(loaded.fields()[0].tilledAcres()).toBe(6);
  });
});
