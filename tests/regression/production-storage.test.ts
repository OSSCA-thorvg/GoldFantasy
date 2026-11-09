import { describe, expect, it } from 'vitest';
import { Resources, Structure, Product, structureSpec } from '../../packages/engine/src/building-catalog';
import { Town } from '../../packages/engine/src/town';
import { Building } from '../../packages/engine/src/town-models';
import { point } from '../../packages/engine/src/geometry';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import {
  buildingAsset,
  validateBuildingCompatibility,
} from '../../packages/native-renderer/src/building-assets';
import { TreeWorkKind, Person, Calling, Role, Race, Activity } from '../../packages/engine/src/person';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain } from '../../packages/engine/src/world-types';
import { settlementGoals, buildingUnlock } from '../../packages/engine/src/settlement-progression';

// Small deterministic settlements isolate economic accounting from raids and pathfinding.
function fixture() {
  const town = new Town(5, 32, false);
  const camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = camp.id;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(camp.id);
  return town;
}
function facility(town: Town, kind: Structure) {
  const b = new Building(town.nextId++, kind, point(12 + town.nextId, 12), 0, 0);
  b.village = town.camp()!.id;
  town.placed.push(b);
  return b;
}

describe('processing and dedicated stores', () => {
  it('ships compatible geometry for every buildable structure', () => {
    for (let kind = 0; kind < Structure.Count; kind++)
      expect(() => validateBuildingCompatibility(buildingAsset(kind), kind)).not.toThrow();
  });
  it('introduces processing before advanced building objectives and unlocks', () => {
    const goals = settlementGoals().map((g) => g.building);
    expect(goals.indexOf(Structure.Sawmill)).toBeLessThan(goals.indexOf(Structure.Weaponsmith));
    expect(goals.indexOf(Structure.Stoneworks)).toBeLessThan(goals.indexOf(Structure.Weaponsmith));
    const town = fixture();
    facility(town, Structure.Guild);
    expect(buildingUnlock(town, Structure.Weaponsmith).reason).toBe('Complete Sawmill');
    facility(town, Structure.Sawmill);
    expect(buildingUnlock(town, Structure.Weaponsmith).reason).toBe('Complete Stoneworks');
  });
  it('accounts for refined resources without mixing them with logs or stone', () => {
    const stock = new Resources(0, 10, 8, 0, 0, 0, 3, 4);
    expect(stock.planks).toBe(3);
    expect(stock.cutStone).toBe(4);
    expect(stock.clone().subtract(new Resources(0, 0, 0, 0, 0, 0, 2, 1)).planks).toBe(1);
    expect(stock.covers(new Resources(0, 0, 0, 0, 0, 0, 4))).toBe(false);
  });
  it('only increases the matching storage capacity and preserves over-capacity old stock', () => {
    const town = fixture(),
      base = town.capacity();
    facility(town, Structure.WoodStore);
    expect(town.capacity().wood).toBe(base.wood + 240);
    expect(town.capacity().planks).toBe(base.planks + 240);
    expect(town.capacity().stone).toBe(base.stone);
    facility(town, Structure.Granary);
    expect(town.capacity().food).toBe(base.food + 240);
    expect(town.capacity().water).toBe(base.water);
    facility(town, Structure.StoneStore);
    expect(town.capacity().stone).toBe(base.stone + 240);
    expect(town.capacity().cutStone).toBe(base.cutStone + 240);
    town.stock().planks = town.capacity().planks + 10;
    town.store(new Resources(0, 0, 0, 0, 0, 0, 4), town.camp()!.id);
    expect(town.stock().planks).toBe(town.capacity().planks + 10);
  });
  it('converts raw supplies through actual work and never duplicates missing inputs', () => {
    const town = fixture(),
      mill = facility(town, Structure.Sawmill),
      works = facility(town, Structure.Stoneworks);
    town.stock().wood = 4;
    town.stock().stone = 2;
    town.processProduction(mill, 23.9);
    expect(town.stock().planks).toBe(0);
    town.processProduction(mill, 0.1);
    expect(town.stock().wood).toBe(2);
    expect(town.stock().planks).toBe(1);
    town.processProduction(works, 30);
    expect(town.stock().stone).toBe(0);
    expect(town.stock().cutStone).toBe(1);
    expect(town.treeEvents().filter((e) => e.kind === TreeWorkKind.Produced)).toHaveLength(2);
    town.processProduction(works, 300);
    expect(town.stock().cutStone).toBe(1);
    expect(town.dailyOutput(mill).planks).toBe(0);
    expect(structureSpec(Structure.Sawmill).product).toBe(Product.Planks);
  });
  it('does not consume inputs or bank unbounded work while output storage is full', () => {
    const town = fixture(),
      mill = facility(town, Structure.Sawmill);
    town.stock().wood = 4;
    town.stock().planks = town.capacity().planks;
    town.processProduction(mill, 3000);
    expect(town.stock().wood).toBe(4);
    town.stock().planks--;
    town.processProduction(mill, 0.1);
    expect(town.stock().wood).toBe(4);
    town.processProduction(mill, 24);
    expect(town.stock().wood).toBe(2);
  });
  for (const rawStock of [0, 2])
    it(`finishes a building through the processing chain from ${rawStock} stored logs`, () => {
      const world = WorldMap.generate(5, 32, 32);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++)
          Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, wild: 0, revealed: true });
      // No remote daily output or synthetic finished timber: the builder must
      // gather (when necessary), deliver, saw, fetch the plank and return to site.
      const town = new Town(world, 32, false);
      town.titleAutoplay = true;
      const camp = new Building(0, Structure.Camp, point(16, 16), 0, 0);
      camp.village = 0;
      const mill = new Building(1, Structure.Sawmill, point(18, 16), 0, 0);
      mill.village = 0;
      mill.wanted = 0;
      const site = new Building(2, Structure.Tent, point(23, 16), 0, 0);
      site.village = 0;
      site.progress = 0;
      site.materials.required.planks = 1;
      town.placed.push(camp, mill, site);
      town.nextId = 3;
      town.foundSettlement(0);
      town.stock().wood = rawStock;
      world.at(20, 18).trees = town.map().at(20, 18).trees = 1;
      const p = new Person(0, 'Builder', Role.Resident, Calling.Settler, Race.Human, 0, camp.door());
      p.home = p.village = 0;
      p.food = p.rest = p.health = 1;
      town.folk.push(p);
      town.nextPerson = 1;
      town.tick(0);
      expect(town.orderBuild([p.id], site.id)).toBe(true);
      let saw = false,
        felled = false;
      for (let i = 0; i < 2400 && !site.built(); i++) {
        town.advance(0.1);
        saw ||= p.activity === Activity.Working && p.target === mill.id;
        felled ||= p.activity === Activity.Felling;
      }
      expect({
        built: site.built(),
        saw,
        felled,
        activity: Activity[p.activity],
        task: Activity[p.task],
        position: p.position,
        stock: town.stock(),
        delivered: site.materials.delivered,
      }).toMatchObject({ built: true, saw: true, felled: rawStock === 0 });
      expect(site.materials.delivered.planks).toBe(1);
    });
  it('lets an assigned sawmill worker obtain missing logs and return to production', () => {
    const town = new Town(5, 32, false);
    town.titleAutoplay = true;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++)
        Object.assign(town.map().at(x, y), { terrain: Terrain.Grass, trees: 0, wild: 0, revealed: true });
    const camp = new Building(0, Structure.Camp, point(16, 16), 0, 0),
      mill = new Building(1, Structure.Sawmill, point(18, 16), 0, 0);
    camp.village = mill.village = 0;
    town.placed.push(camp, mill);
    town.nextId = 2;
    town.foundSettlement(0);
    town.map().at(20, 18).trees = 1;
    const p = new Person(0, 'Sawyer', Role.Resident, Calling.Settler, Race.Human, 0, camp.door());
    p.home = p.village = 0;
    p.food = p.rest = p.health = 1;
    town.folk.push(p);
    town.nextPerson = 1;
    town.changes++;
    town.tick(0);
    expect(town.assignJob([p.id], mill.id)).toBe(true);
    let gathered = false,
      delivered = false;
    for (let i = 0; i < 1200 && !town.stock().planks; i++) {
      town.advance(0.1);
      gathered ||= p.activity === Activity.Felling;
      delivered ||= p.activity === Activity.Hauling;
    }
    expect({
      stock: town.stock(),
      gathered,
      delivered,
      job: p.job,
      activity: Activity[p.activity],
      task: Activity[p.task],
    }).toMatchObject({ stock: { planks: 1 }, gathered: true, delivered: true, job: mill.id });
  });
  it('saves refined stock, production progress and new needs without losing old IDs', () => {
    const town = fixture(),
      mill = facility(town, Structure.Sawmill);
    town.stock().planks = 7;
    town.stock().cutStone = 9;
    town.stock().wood = 4;
    town.processProduction(mill, 12);
    const saved = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true));
    expect(saved.stock().planks).toBe(7);
    expect(saved.stock().cutStone).toBe(9);
    expect(saved.building(mill.id)!.productionProgress).toBeCloseTo(12);
    expect(Structure.Torch).toBe(29);
    expect(Product.Water).toBe(6);
  });
  it('emits a resource sound event only when revealed trees actually regrow', () => {
    const town = fixture();
    town.scout(16, 16, 40);
    let before = 0;
    for (let y = 0; y < town.map().height(); y++)
      for (let x = 0; x < town.map().width(); x++) {
        const tile = town.map().at(x, y);
        tile.trees = 0;
        before += tile.trees;
      }
    town.regrow();
    let after = 0;
    for (let y = 0; y < town.map().height(); y++)
      for (let x = 0; x < town.map().width(); x++) after += town.map().at(x, y).trees;
    const generated = town.treeEvents().filter((e) => e.kind === TreeWorkKind.Regrow);
    expect(after - before).toBeGreaterThan(0);
    expect(generated).toHaveLength(after - before);
    expect(generated.every((e) => e.person === -1 && e.at === town.clock())).toBe(true);
  });
});
