import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { makeTile, Terrain, Layer } from '../../packages/engine/src/world-types';
import { Person, Role, Calling, Race, Activity } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure, structureSpec } from '../../packages/engine/src/building-catalog';
import { point, type Point } from '../../packages/engine/src/geometry';
import {
  addInventory,
  bareHandsRate,
  gearEffect,
  harvestSeconds,
  itemCatalog,
  itemSpec,
  workEfficiency,
  workItem,
  type WorkKind,
} from '../../packages/engine/src/equipment';
import { harvestDuration } from '../../packages/engine/src/work-timing';
import * as mining from '../../packages/engine/src/mining';
import { settlementGoals } from '../../packages/engine/src/settlement-progression';

// Wooden gear with an iron twin at the smith; the stone tier and the basket are in tool-variety.test.ts.
const wooden = itemCatalog.filter((item) => item.workshop === Structure.Workbench).filter((item) => item.material === 'wood' && item.visual !== 'basket');
const shapes = ['axe', 'pickaxe', 'hammer', 'hoe', 'shovel', 'sword', 'mace', 'bow', 'spear'];

function fixture(size = 32) {
  const map = new WorldMap();
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
    smith = new Building(1, Structure.Weaponsmith, point(18, 12), 0, 0);
  const bench = new Building(2, Structure.Workbench, point(9, 15), 0, 0);
  camp.village = smith.village = bench.village = 0;
  town.placed = [camp, smith, bench];
  town.nextId = 3;
  town.migrateSettlements();
  const p = new Person(0, 'Asa', Role.Resident, Calling.Settler, Race.Human, 5, camp.door());
  p.home = p.village = 0;
  p.autoMode = false;
  p.food = p.rest = p.health = p.hydration = 1;
  p.stress = 0;
  town.folk = [p];
  town.nextPerson = 1;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.changes++;
  town.tick(0);
  town.orderStop([0]);
  return { town, p, camp, smith, bench };
}
function hold(town: Town, p: Person, id: string | null): void {
  if (!id) return;
  expect(addInventory(p, id)).toBe(true);
  expect(town.equipItem(p.id, p.inventory.findIndex((s) => s?.item === id) + 1, 'tool1')).toBe(true);
}
const step = (town: Town) => {
  town.wildlifeDay = town.days;
  town.advance(0.05);
};
/** Seconds of real simulated work for one tree or one load of stone, from the first blow to the load in hand. */
function harvestTime(tool: string | null, stone: boolean): number {
  const { town, p } = fixture(),
    map = town.map();
  let cell = 18 * map.width() + 15;
  if (!stone) map.at(15, 18).trees = 1;
  else {
    cell = -1;
    for (let x = 20; x < 26 && cell < 0; ++x) {
      map.at(x, 22).terrain = Terrain.Rock;
      if (mining.deposit(map, x, 22)) cell = 22 * map.width() + x;
    }
  }
  hold(town, p, tool);
  expect(stone ? town.orderMine([0], cell) : town.orderChop([0], cell)).toBe(true);
  const working = stone ? Activity.Mining : Activity.Felling;
  for (let i = 0; i < 2000 && (p.activity !== working || p.moving()); ++i) step(town);
  const started = town.clock();
  for (let i = 0; i < 2000 && !p.carrying; ++i) step(town);
  expect(p.carrying).toBe(3);
  return town.clock() - started;
}
/** Seconds to raise a tent whose materials are already on site. */
function buildTime(tool: string | null): number {
  const { town, p, camp } = fixture();
  hold(town, p, tool);
  const at = point(camp.center.x - 5, camp.center.y + 4);
  expect(town.place(Structure.Tent, at, 0)).toBe(true);
  const tent = town.buildings().at(-1)!;
  tent.materials.delivered = tent.materials.required.clone();
  expect(town.orderBuild([0], tent.id)).toBe(true);
  for (let i = 0; i < 4000 && (p.activity !== Activity.Building || p.moving()); ++i) step(town);
  const started = town.clock();
  for (let i = 0; i < 8000 && !tent.built(); ++i) step(town);
  expect(tent.built()).toBe(true);
  return town.clock() - started;
}
/** Seconds of crafting at the workbench for a wooden sword. */
function craftTime(tool: string | null): number {
  const { town, p, bench } = fixture();
  Object.assign(town.stock(), new Resources(0, 40, 10));
  hold(town, p, tool);
  expect(town.orderCraft(0, bench.id, 'wooden-sword')).toBe(true);
  for (let i = 0; i < 2000 && !p.craftProgress; ++i) step(town);
  const started = town.clock();
  for (let i = 0; i < 2000 && p.craftItem; ++i) step(town);
  expect(p.inventory.some((s) => s?.item === 'wooden-sword')).toBe(true);
  return town.clock() - started;
}
/** Seconds for the farm worker to break in a 12-acre plot. */
function tillTime(tool: string | null): number {
  const { town, p, camp } = fixture(64);
  const farm = new Building(town.nextId++, Structure.Farm, point(16, 12), 0, 0);
  farm.village = 0;
  town.placed.push(farm);
  town.migrateSettlements();
  p.position = point(15, 13);
  p.job = farm.id;
  p.autoMode = true;
  farm.workers = 1;
  void camp;
  hold(town, p, tool);
  expect(town.plantField([point(17.5, 13), point(21.5, 13), point(21.5, 16), point(17.5, 16)])).toBe(true);
  const field = town.fields()[0];
  let started = -1;
  for (let i = 0; i < 20000 && field.tilled < 1; ++i) {
    step(town);
    if (started < 0 && p.workField === field.id && p.activity === Activity.Working && !p.moving())
      started = town.clock();
  }
  expect(field.tilled).toBe(1);
  return town.clock() - started;
}
const rank = (bare: number, wood: number, iron: number) => {
  console.log(
    `${expect.getState().currentTestName}: bare ${bare.toFixed(1)} s, wooden ${wood.toFixed(1)} s, smith ${iron.toFixed(1)} s`,
  );
  expect(wood).toBeLessThan(bare * 0.8);
  expect(iron).toBeLessThan(wood * 0.9);
};

describe('wooden gear from the workbench', () => {
  it('is cheap, gold-free and weaker than the smith’s gear of the same shape', () => {
    expect(wooden.map((item) => item.id)).toEqual([
      'wooden-axe',
      'wooden-pick',
      'wooden-mallet',
      'wooden-hoe',
      'wooden-shovel',
      'wooden-sword',
      'wooden-club',
      'short-bow',
      'wooden-spear',
    ]);
    for (const item of wooden) {
      expect(item.cost.gold, item.id).toBe(0);
      expect(item.cost.wood, item.id).toBeGreaterThan(0);
      expect(item.cost.stone, item.id).toBeLessThanOrEqual(1);
      expect(item.cost.planks + item.cost.cutStone + item.cost.mana, item.id).toBe(0);
      expect(item.minimumLevel, item.id).toBe(1);
      expect(shapes, item.id).toContain(item.visual);
      const smith = itemCatalog.find(
        (other) => other.workshop === Structure.Weaponsmith && other.visual === item.visual,
      )!;
      expect(smith, item.id).toBeDefined();
      expect(item.attackBonus, item.id).toBeLessThan(smith.attackBonus);
      if (item.category === 'tool') {
        expect(item.work).toEqual(smith.work);
        expect(item.rate).toBeGreaterThan(bareHandsRate);
        expect(item.rate).toBeLessThan(smith.rate);
      } else expect(item.reach, item.id).toBeLessThanOrEqual(smith.reach);
    }
  });
  it('is made at a workbench and nowhere else, from the store or the crafter’s own pack', () => {
    const { town, p, camp, smith, bench } = fixture();
    expect(town.craftOptions(0, camp.id)).toEqual([]);
    expect(town.craftOptions(0, bench.id).map((option) => option.item.id)).toEqual(
      itemCatalog.filter((item) => item.workshop === Structure.Workbench).map((item) => item.id),
    );
    expect(town.craftOptions(0, smith.id).some((option) => option.item.workshop === Structure.Workbench)).toBe(
      false,
    );
    expect(town.craftReason(0, smith.id, 'wooden-axe')).toBe('Build a workbench first');
    expect(town.craftReason(0, camp.id, 'wooden-axe')).toBe('Build a workbench first');
    expect(town.craftReason(0, bench.id, 'wooden-axe')).toBe('Not enough settlement materials');
    // Wood the resident felled and still carries is enough.
    expect(addInventory(p, 'wood', 2)).toBe(true);
    p.carriedProduct = itemSpec('wood')!.product;
    p.carrying = 1;
    expect(town.craftReason(0, bench.id, 'wooden-axe')).toBe('');
    town.stock().wood = 1;
    expect(town.orderCraft(0, bench.id, 'wooden-axe')).toBe(true);
    for (let i = 0; i < 1000 && p.craftItem; ++i) step(town);
    // The store pays first, then the hands, then the pack.
    expect(town.stock().wood).toBe(0);
    expect(p.carrying + (p.inventory.find((s) => s?.item === 'wood')?.quantity ?? 0)).toBe(1);
    expect(workItem(p, 'woodcutting')?.id).toBe('wooden-axe');
    expect(town.notices.slice(-2)).toEqual([
      'Asa crafted Wooden axe',
      'Wooden axe in hand · Fells trees faster',
    ]);
  });
  it('keeps the forge deed for the smith and takes a new weapon in hand', () => {
    const { town, p, smith, bench } = fixture();
    Object.assign(town.stock(), new Resources(50, 50, 50));
    p.level = 3;
    expect(town.orderCraft(0, bench.id, 'wooden-club')).toBe(true);
    for (let i = 0; i < 1000 && p.craftItem; ++i) step(town);
    expect(town.chronicle.weaponsForged).toBe(0);
    expect(p.equipment.weapon).toBeGreaterThan(0);
    expect(town.notices.at(-1)).toBe('Wooden club in hand · Hits harder than fists');
    expect(town.orderCraft(0, smith.id, 'mace')).toBe(true);
    for (let i = 0; i < 2000 && p.craftItem; ++i) step(town);
    expect(town.chronicle.weaponsForged).toBe(1);
    // The weapon slot was taken, so the iron mace waits in the pack.
    expect(itemSpec(p.inventory[p.equipment.weapon - 1]!.item)?.id).toBe('wooden-club');
  });
  it('says in plain words what the gear changes, with the numbers kept to the rules', () => {
    const texts = [
      ...settlementGoals().filter((goal) => goal.items.length).map((goal) => goal.description),
      ...itemCatalog.flatMap((item) => [item.description, gearEffect(item)]),
    ];
    // Costs ("from 3 wood") and counts ("Craft two") may stay; rates, times and shares may not.
    for (const text of texts) expect(text).not.toMatch(/\d+ ?(s|%|kg)\b|\d+(\.\d+)? (seconds|tiles|paces)|by hand \d/);
    expect(settlementGoals().find((goal) => goal.items.includes('wooden-axe'))!.description).toContain(
      'fells trees faster',
    );
    expect(gearEffect(itemSpec('wooden-axe')!)).toBe('Fells trees faster');
    expect(gearEffect(itemSpec('stone-axe')!)).toBe('Fells trees faster than a wooden axe');
    expect(gearEffect(itemSpec('axe')!)).toBe('Fells trees faster than a stone axe');
    expect(gearEffect(itemSpec('wooden-club')!)).toBe('Hits harder than fists');
    expect(gearEffect(itemSpec('sword')!)).toBe('Hits harder than a wooden sword');
    const { p } = fixture();
    expect(harvestDuration(p)).toBeCloseTo(harvestSeconds(bareHandsRate), 5);
    for (const item of itemCatalog.filter((i) => i.category !== 'resource')) expect(gearEffect(item), item.id).not.toBe('');
  });
});

describe('work timed with bare hands, a wooden tool and the smith’s tool', () => {
  it('fells a tree', () => {
    const [bare, wood, iron] = [null, 'wooden-axe', 'axe'].map((tool) => harvestTime(tool, false));
    rank(bare, wood, iron);
    expect(bare).toBeCloseTo(15, 0);
    expect(wood).toBeCloseTo(harvestSeconds(itemSpec('wooden-axe')!.rate), 0);
    expect(iron).toBeCloseTo(6, 0);
  });
  it('breaks a load of stone', () => {
    const [bare, wood, iron] = [null, 'wooden-pick', 'pickaxe'].map((tool) => harvestTime(tool, true));
    rank(bare, wood, iron);
  });
  it('raises a building', () => {
    const [bare, wood, iron] = [null, 'wooden-mallet', 'hammer'].map(buildTime);
    rank(bare, wood, iron);
  });
  it('crafts', () => {
    const [bare, wood, iron] = [null, 'wooden-mallet', 'hammer'].map(craftTime);
    rank(bare, wood, iron);
  });
  it('breaks in a field', () => {
    const [bare, wood, iron] = [null, 'wooden-hoe', 'hoe'].map(tillTime);
    rank(bare, wood, iron);
  });
  it('rates the work by the best tool in hand', () => {
    const { town, p } = fixture();
    const kinds: WorkKind[] = ['woodcutting', 'mining', 'construction', 'crafting', 'farming'];
    for (const kind of kinds) expect(workEfficiency(p, kind)).toBe(bareHandsRate);
    hold(town, p, 'wooden-axe');
    expect(addInventory(p, 'axe')).toBe(true);
    expect(town.equipItem(0, 2, 'tool2')).toBe(true);
    expect(workItem(p, 'woodcutting')?.id).toBe('axe');
    expect(workEfficiency(p, 'woodcutting')).toBe(1);
    expect(structureSpec(Structure.Camp).name).toBe('Camp');
  });
});
