import { repairMaterialCost } from '../../packages/engine/src/building-repair';
import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Activity, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { Building } from '../../packages/engine/src/town-models';
import { MapDocument } from '../../packages/native-editors/src/map-document';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Terrain, Layer } from '../../packages/engine/src/world-types';
import { point, add } from '../../packages/engine/src/geometry';
import { copyNative } from '../../packages/engine/src/native-copy';
let base: Town;
beforeAll(() => {
  const doc = new MapDocument(WorldMap.generate(5, 64, 64));
  doc.paint(point(32, 32), 45, Terrain.Grass);
  doc.clearTrees(point(32, 32), 45);
  const world = doc.gameMap();
  world.ymir = null;
  world.fire = null;
  world.stream = { path: [], width: [] };
  for (const layer of world.layers) layer.fill(0.4);
  world.layer(Layer.Land).fill(1);
  world.layer(Layer.Ridge).fill(-1);
  // Flat, revealed land isolates material deliveries and repair completion from
  // unrelated raids, terrain barriers and exploration.
  for (let y = 0; y < 64; ++y)
    for (let x = 0; x < 64; ++x)
      Object.assign(world.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
  world.reveal(32, 32, 100);
  base = new Town(world, 64, false);
  base.wildlifeDay = 0;
  const home = new Building(0, Structure.Camp, point(30, 30), 0, 0);
  base.placed.push(home);
  base.nextId = 1;
  base.migrateSettlements();
  Object.assign(base.stock(), new Resources(1000, 1000, 1000, 1000, 1000, 1000));
  const p = new Person(0, 'Policy worker', Role.Resident, Calling.Settler, Race.Human, 0, home.door());
  p.home = p.village = 0;
  p.food = p.rest = p.health = 1;
  base.folk = [p];
  base.nextPerson = 1;
  base.editHour(12);
  base.tick(0);
});
function fixture() {
  return copyNative(base);
}
function step(town: Town, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds * 10); ++i) town.advance(0.1);
}
describe('building repair supplies and completion', () => {
  it('charges only physical construction materials, including refined inputs', () => {
    const fee = repairMaterialCost(Structure.Weaponsmith);
    expect(fee.wood).toBeGreaterThan(0);
    expect(fee.stone).toBeGreaterThan(0);
    expect(fee.planks).toBeGreaterThan(0);
    expect(fee.cutStone).toBeGreaterThan(0);
    expect(fee.gold + fee.food + fee.water + fee.mana).toBe(0);
    expect(repairMaterialCost(Structure.Cottage).wood).toBeGreaterThan(0);
  });
  it('repairs gradually with paid batches and never replays building completion side effects', () => {
    const town = fixture(),
      p = town.people()[0],
      home = town.camp()!,
      before = town.stock().wood;
    home.health = 0.5;
    town.setAuto(p.id, false);
    const revision = town.changes,
      notes: string[] = [];
    town.notify = (text: string) => notes.push(text);
    expect(town.orderBuild([p.id], home.id)).toBe(true);
    step(town, 2);
    expect(home.health).toBeGreaterThan(0.5);
    expect(home.health).toBeLessThan(1);
    expect(town.stock().wood).toBeLessThan(before);
    for (let i = 0; i < 1000 && (!p.autoMode || home.health < 1); ++i) town.advance(0.1);
    expect(home.health).toBe(1);
    expect(p.autoMode).toBe(true);
    expect(p.ordered).toBe(false);
    expect(before - town.stock().wood).toBe(repairMaterialCost(home.kind).wood * 2);
    expect(notes.filter((n) => n.includes(' is finished'))).toHaveLength(0);
    expect(notes.filter((n) => n.includes(' is repaired'))).toHaveLength(1);
    expect(Number(town.changes - revision)).toBeLessThanOrEqual(3);
  });
  it('gathers and delivers missing repair supplies before health can increase', () => {
    const town = fixture(),
      p = town.people()[0],
      home = town.camp()!;
    home.health = 0.3;
    town.stock().wood = 0;
    town.map().at(33, 32).trees = 4;
    expect(town.orderBuild([p.id], home.id)).toBe(true);
    const seen = new Set<Activity>();
    for (let i = 0; i < 2200 && home.health < 1; ++i) {
      town.advance(0.1);
      seen.add(p.activity);
      if (home.health > 0.3)
        expect(home.materials.delivered.wood).toBeGreaterThanOrEqual(repairMaterialCost(home.kind).wood);
    }
    expect(
      home.health,
      JSON.stringify({
        activity: Activity[p.activity],
        stock: town.stock(),
        materials: home.materials,
        pending: home.repairPending,
        credit: home.repairCredit,
      }),
    ).toBe(1);
    expect(seen.has(Activity.Felling)).toBe(true);
    expect(seen.has(Activity.DeliveringMaterials)).toBe(true);
    expect(home.materials.required.wood).toBe(repairMaterialCost(home.kind).wood * 3);
    expect(town.map().at(33, 32).trees).toBeLessThan(4);
  });
  it('shares one pending maintenance fee across workers instead of charging while supplies are unavailable', () => {
    const town = fixture(),
      p = town.people()[0],
      other = copyNative(p),
      home = town.camp()!;
    other.id = 1;
    other.position = add(p.position, point(0.5, 0));
    town.folk.push(other);
    home.health = 0.9;
    town.stock().wood = 0;
    expect(town.orderBuild([p.id, other.id], home.id)).toBe(true);
    step(town, 6);
    expect(home.health).toBe(0.9);
    expect(home.repairPending).toBe(true);
    expect(home.materials.required.wood).toBe(repairMaterialCost(home.kind).wood);
    town.stock().wood = 10;
    for (let i = 0; i < 1000 && home.health < 1; ++i) town.advance(0.1);
    expect(home.health).toBe(1);
    expect(home.repairPending).toBe(false);
    expect(home.materials.required.wood).toBe(repairMaterialCost(home.kind).wood);
    expect(home.repairCredit).toBeCloseTo(0.15, 6);
  });
  it('returns a completed direct construction command from Auto OFF to Auto', () => {
    const town = fixture(),
      p = town.people()[0],
      site = new Building(1, Structure.Tent, point(35, 34), 0, 0);
    site.progress = 0.99;
    town.placed.push(site);
    town.setAuto(p.id, false);
    expect(town.orderBuild([p.id], site.id)).toBe(true);
    step(town, 15);
    expect(site.built()).toBe(true);
    expect(p.autoMode).toBe(true);
    expect(p.ordered).toBe(false);
  });
});
