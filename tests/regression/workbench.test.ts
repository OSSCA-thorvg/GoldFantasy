import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { makeTile, Terrain, Layer } from '../../packages/engine/src/world-types';
import { Person, Role, Calling, Race, Activity } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure, buildWork, structureSpec } from '../../packages/engine/src/building-catalog';
import { Tool, toolStructure } from '../../packages/engine/src/game-tools';
import { distance, point } from '../../packages/engine/src/geometry';
import { itemCatalog, itemMaterial, itemSpec, isCraftStation } from '../../packages/engine/src/equipment';
import { buildingUnlock } from '../../packages/engine/src/settlement-progression';
import { BUILDING_ASSETS } from '../../packages/content/src/assets';
import { decodeBuildingAsset } from '../../packages/native-renderer/src/building-asset';
import { validateBuildingCompatibility } from '../../packages/native-renderer/src/building-assets';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';

function fixture() {
  const size = 32,
    map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = point(12, 12);
  map.tiles = Array.from({ length: size * size }, () => ({
    ...makeTile(),
    terrain: Terrain.Grass,
    revealed: true,
  }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [];
  map.reveal(size / 2, size / 2, size * 2);
  const town = new Town(map, size, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0),
    bench = new Building(1, Structure.Workbench, point(17, 15), 0, 0);
  camp.village = bench.village = 0;
  town.placed = [camp, bench];
  town.nextId = 2;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(0, 60, 10));
  const folk = ['Asa', 'Bo'].map((name, id) => {
    const p = new Person(id, name, Role.Resident, Calling.Settler, Race.Human, 5, point(12 + id, 14));
    p.home = p.village = 0;
    p.autoMode = false;
    p.food = p.rest = p.health = p.hydration = 1;
    p.stress = 0;
    return p;
  });
  town.folk = folk;
  town.nextPerson = 2;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.changes++;
  town.tick(0);
  town.orderStop([0, 1]);
  return { town, camp, bench, a: folk[0], b: folk[1] };
}
const step = (town: Town) => {
  town.wildlifeDay = town.days;
  town.advance(0.05);
};

describe('the workbench building', () => {
  it('is a small, cheap, unstaffed timber bench, appended to the catalog and open with the camp', () => {
    expect(Structure.Workbench).toBe(Structure.Count - 1);
    expect(toolStructure(Tool.Workbench)).toBe(Structure.Workbench);
    const spec = structureSpec(Structure.Workbench);
    expect(spec.size).toBeLessThanOrEqual(1);
    expect(spec.cost).toMatchObject({ gold: 0, stone: 0, planks: 0, cutStone: 0 });
    expect(spec.cost.wood).toBeGreaterThan(0);
    expect(spec.cost.wood).toBeLessThan(structureSpec(Structure.Camp).cost.wood);
    expect([spec.jobs, spec.residents, spec.requiredPopulation]).toEqual([0, 0, 0]);
    expect(spec.next).toBe(Structure.Count);
    expect(buildWork(Structure.Workbench)).toBeLessThan(buildWork(Structure.Tent));
    // No other building grows into it, and none lost its own growth to the appended kind.
    for (let kind = 0; kind < Structure.Count; ++kind)
      expect(structureSpec(kind).next).not.toBe(Structure.Workbench);
    const { town } = fixture();
    expect(buildingUnlock(town, Structure.Workbench)).toEqual({ available: true, reason: '' });
    const asset = decodeBuildingAsset(JSON.stringify(BUILDING_ASSETS.Workbench));
    expect(asset.id).toBe('workbench');
    expect(() => validateBuildingCompatibility(asset, Structure.Workbench)).not.toThrow();
    expect(isCraftStation(Structure.Workbench) && isCraftStation(Structure.Weaponsmith)).toBe(true);
    expect(isCraftStation(Structure.Camp)).toBe(false);
  });
  it('survives a save with someone working at it', () => {
    const { town, bench, a } = fixture();
    expect(town.orderCraft(a.id, bench.id, 'wooden-axe')).toBe(true);
    for (let i = 0; i < 400 && a.activity !== Activity.Crafting; ++i) step(town);
    for (let i = 0; i < 20; ++i) step(town);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true)),
      p = loaded.person(a.id)!;
    expect(loaded.building(bench.id)?.kind).toBe(Structure.Workbench);
    expect(p.craftItem).toBe('wooden-axe');
    for (let i = 0; i < 1000 && p.craftItem; ++i) {
      loaded.wildlifeDay = loaded.days;
      loaded.advance(0.05);
    }
    expect(p.inventory.some((s) => s?.item === 'wooden-axe')).toBe(true);
  });
});

describe('crafting at the bench', () => {
  it('walks to the bench, works in the open at its door, then takes the item and puts it in hand', () => {
    const { town, bench, a } = fixture();
    expect(town.orderCraft(a.id, bench.id, 'wooden-axe')).toBe(true);
    expect(a.activity).toBe(Activity.Moving);
    expect(a.target).toBe(bench.id);
    let worked = 0;
    for (let i = 0; i < 2000 && a.craftItem; ++i) {
      step(town);
      expect(a.inside).toBe(false);
      if (a.activity === Activity.Crafting) {
        // Only at the work spot, facing the bench, and only while it is the bench being worked.
        expect(distance(a.position, town.craftSpot(bench))).toBeLessThan(0.06);
        expect(a.target).toBe(bench.id);
        expect(town.craftingAt(bench.id)?.id).toBe(a.id);
        ++worked;
      }
    }
    expect(worked).toBeGreaterThan(100);
    expect(a.equipment.tool1).toBe(1);
    expect(town.notices.slice(-2)).toEqual([
      'Asa crafted Wooden axe',
      'Wooden axe in hand · Fells trees faster',
    ]);
    expect(town.craftingAt(bench.id)).toBeNull();
  });
  it('lets one resident work it at a time; the next waits beside it and starts when it is free', () => {
    const { town, bench, a, b } = fixture();
    expect(town.orderCraft(a.id, bench.id, 'wooden-axe')).toBe(true);
    for (let i = 0; i < 400 && a.activity !== Activity.Crafting; ++i) step(town);
    expect(town.craftingAt(bench.id)?.id).toBe(a.id);
    expect(town.orderCraft(b.id, bench.id, 'wooden-hoe')).toBe(true);
    let waitedBeside = false;
    for (let i = 0; i < 2000 && a.craftItem; ++i) {
      step(town);
      expect(b.activity).not.toBe(Activity.Crafting);
      if (!b.moving() && distance(b.position, town.craftWaitSpot(bench)) < 0.1) waitedBeside = true;
    }
    expect(waitedBeside).toBe(true);
    expect(town.craftQueue(bench.id).map((p) => p.id)).toEqual([b.id]);
    expect(b.craftProgress).toBe(0);
    for (let i = 0; i < 2000 && b.craftItem; ++i) step(town);
    expect(a.inventory.some((s) => s?.item === 'wooden-axe')).toBe(true);
    expect(b.inventory.some((s) => s?.item === 'wooden-hoe')).toBe(true);
    expect(town.craftQueue(bench.id)).toEqual([]);
  });
  it('is the only place wooden gear is made: not the camp, not the smith', () => {
    const { town, camp, a } = fixture();
    for (const item of itemCatalog.filter((i) => i.workshop === Structure.Workbench)) {
      expect(town.craftReason(a.id, camp.id, item.id), item.id).toBe('Build a workbench first');
      expect(town.orderCraft(a.id, camp.id, item.id)).toBe(false);
    }
  });
});

describe('calling off a craft', () => {
  const held = (town: Town, ids: number[]) => ({
    stock: town.stock().clone(),
    packs: ids.map((id) => JSON.stringify([town.person(id)!.inventory, town.person(id)!.carrying])),
  });
  it('drops the order while walking, waiting or working, spends nothing, and lets the next in line take the bench', () => {
    const { town, bench, a, b } = fixture();
    const before = held(town, [a.id, b.id]);
    // Walking there.
    expect(town.orderCraft(a.id, bench.id, 'wooden-axe')).toBe(true);
    step(town);
    expect(a.moving()).toBe(true);
    expect(town.cancelCraft(a.id)).toBe(true);
    expect([a.craftItem, a.craftWorkshop, a.task]).toEqual([null, -1, Activity.Idle]);
    expect(town.notices.at(-1)).toBe('Asa stopped making the Wooden axe');
    expect(town.cancelCraft(a.id)).toBe(false);
    // Working, half done, with another waiting beside the bench.
    expect(town.orderCraft(a.id, bench.id, 'wooden-axe')).toBe(true);
    for (let i = 0; i < 400 && a.activity !== Activity.Crafting; ++i) step(town);
    expect(town.orderCraft(b.id, bench.id, 'wooden-hoe')).toBe(true);
    for (let i = 0; i < 2000 && a.craftProgress < itemSpec('wooden-axe')!.seconds / 2; ++i) step(town);
    for (let i = 0; i < 400 && (b.moving() || b.activity !== Activity.Holding); ++i) step(town);
    expect(town.craftingAt(bench.id)?.id).toBe(a.id);
    expect(town.craftQueue(bench.id).map((p) => p.id)).toEqual([b.id]);
    expect(town.cancelCraft(a.id)).toBe(true);
    expect(held(town, [a.id, b.id])).toEqual(before);
    expect(a.inventory.some((s) => s?.item === 'wooden-axe')).toBe(false);
    // The one waiting steps up and works.
    for (let i = 0; i < 200 && town.craftingAt(bench.id)?.id !== b.id; ++i) step(town);
    expect(town.craftingAt(bench.id)?.id).toBe(b.id);
    expect(town.craftQueue(bench.id)).toEqual([]);
    // Waiting: the queue empties and the bench is free once the worker is called off too.
    expect(town.orderCraft(a.id, bench.id, 'wooden-sword')).toBe(true);
    for (let i = 0; i < 400 && (a.moving() || a.activity !== Activity.Holding); ++i) step(town);
    expect(town.craftQueue(bench.id).map((p) => p.id)).toEqual([a.id]);
    expect(town.cancelCraft(a.id)).toBe(true);
    expect(town.craftQueue(bench.id)).toEqual([]);
    expect(town.cancelCraft(b.id)).toBe(true);
    expect(town.craftingAt(bench.id)).toBeNull();
    expect(held(town, [a.id, b.id])).toEqual(before);
  });
  it('is only for a living resident of the player’s own faction with an order', () => {
    const { town, bench, a, b } = fixture();
    expect(town.cancelCraft(a.id)).toBe(false);
    expect(town.cancelCraft(99)).toBe(false);
    expect(town.orderCraft(a.id, bench.id, 'wooden-axe')).toBe(true);
    expect(town.orderCraft(b.id, bench.id, 'wooden-hoe')).toBe(true);
    b.faction = 1;
    expect(town.cancelCraft(b.id)).toBe(false);
    expect(b.craftItem).toBe('wooden-hoe');
    a.health = 0;
    expect(town.cancelCraft(a.id)).toBe(false);
  });
});

describe('what gear is made of', () => {
  it('gives every tool, weapon and shield a material, and names the smith’s tools by theirs', () => {
    for (const item of itemCatalog) {
      if (item.category === 'resource') expect(item.material, item.id).toBeNull();
      if (item.category === 'tool' || item.category === 'weapon')
        expect(item.material, item.id).not.toBeNull();
      if (/^Wooden /.test(item.name)) expect(item.material, item.id).toBe('wood');
      if (/^Iron /.test(item.name)) expect(item.material, item.id).toBe('iron');
      if (/^(Stone|Flint) /.test(item.name)) expect(item.material, item.id).toBe('stone');
      // The bench works wood and stone; iron is the smith's.
      if (item.workshop === Structure.Workbench) expect(['wood', 'stone'], item.id).toContain(item.material);
    }
    expect(itemMaterial('shield')).toBe('wood');
    expect(itemMaterial('mace')).toBe('stone');
    expect(itemMaterial('bow')).toBe('wood');
    expect(itemMaterial('staff')).toBe('wood');
    expect(itemMaterial('wood')).toBeNull();
    // Ids stay, so saves still load; only the names say the metal.
    expect(['axe', 'pickaxe', 'hammer', 'hoe', 'saw'].map((id) => itemSpec(id)!.name)).toEqual([
      'Iron axe',
      'Iron pick',
      'Iron hammer',
      'Iron hoe',
      'Iron saw',
    ]);
    for (const id of ['axe', 'pickaxe', 'hammer', 'hoe', 'saw', 'watering-can']) {
      expect(itemMaterial(id), id).toBe('iron');
      expect(itemSpec(id)!.workshop).toBe(Structure.Weaponsmith);
    }
  });
});
