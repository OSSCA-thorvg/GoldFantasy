import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { makeTile, Terrain, Layer } from '../../packages/engine/src/world-types';
import { Person, Role, Calling, Race, Activity, Monster } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure, structureSpec } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import {
  addInventory,
  armorProtection,
  combatItem,
  itemCatalog,
  itemSpec,
  raisedShield,
  upgradeCost,
  upperTier,
  workEfficiency,
  workItem,
} from '../../packages/engine/src/equipment';
import { levelVariant, stationLevel, stationStep } from '../../packages/engine/src/craft-stations';
import { craftOrder, upgradeOrder } from '../../packages/engine/src/craft-orders';
import { monsterBite } from '../../packages/engine/src/town-monsters';
import { CombatCue } from '../../packages/engine/src/combat-events';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { digest } from '../../packages/engine/src/save-archive';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import { inspector } from '../../apps/web/src/native/game-hud';
import { noteSelection, recipeOffer, stationCrafter } from '../../apps/web/src/native/craft-station-hud';

// The workbench makes tools and the smithy weapons, shields and armor; both rise in levels, and gear rises in makes.
function fixture() {
  const size = 32,
    map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = point(12, 12);
  map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [];
  map.reveal(size / 2, size / 2, size * 2);
  const town = new Town(map, size, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0),
    smith = new Building(1, Structure.Weaponsmith, point(18, 12), 0, levelVariant(1)),
    bench = new Building(2, Structure.Workbench, point(9, 15), 0, levelVariant(1));
  camp.village = smith.village = bench.village = 0;
  town.placed = [camp, smith, bench];
  town.nextId = 3;
  town.migrateSettlements();
  const folk = ['Asa', 'Bryn', 'Dag'].map((name, i) => {
    const p = new Person(i, name, Role.Resident, Calling.Settler, Race.Human, 5 + i, point(12 + i, 13));
    p.home = p.village = 0;
    p.autoMode = false;
    p.food = p.rest = p.health = p.hydration = 1;
    p.stress = 0;
    return p;
  });
  town.folk = folk;
  town.nextPerson = folk.length;
  town.animals = [];
  town.beasts = [];
  town.editHour(9);
  town.wildlifeDay = town.days;
  town.changes++;
  town.tick(0);
  town.orderStop(folk.map((p) => p.id));
  return { town, camp, smith, bench, a: folk[0], b: folk[1], c: folk[2] };
}
const step = (town: Town, seconds = 0.05) => {
  town.wildlifeDay = town.days;
  town.advance(seconds);
};
const run = (town: Town, p: Person, limit = 4000) => {
  for (let i = 0; i < limit && p.craftItem; ++i) step(town);
};
const holdIn = (town: Town, p: Person, id: string, slot: 'weapon' | 'offhand' | 'body') => {
  expect(addInventory(p, id)).toBe(true);
  return town.equipItem(p.id, p.inventory.findIndex((s) => s?.item === id) + 1, slot);
};

describe('what each station level makes', () => {
  it('opens wood at level 1, stone at 2 and iron at 3, and says which level a locked recipe needs', () => {
    const { town, smith, bench, a } = fixture();
    Object.assign(town.stock(), new Resources(100, 100, 100, 0, 0, 0, 50, 50));
    for (const item of itemCatalog.filter((i) => i.workshop !== null)) {
      const station = item.workshop === Structure.Workbench ? bench : smith,
        name = structureSpec(station.kind).name.toLowerCase();
      for (const level of [1, 2, 3]) {
        station.variant = levelVariant(level);
        expect(stationLevel(station)).toBe(level);
        expect(town.craftReason(a.id, station.id, item.id), `${item.id} at ${level}`).toBe(
          level >= item.stationLevel ? '' : `Needs a level ${item.stationLevel} ${name}`,
        );
      }
    }
    // Nothing that is a weapon, shield or armor is made at the bench.
    for (const item of itemCatalog.filter((i) => i.workshop === Structure.Workbench))
      expect(item.category === 'tool' || item.visual === 'basket', item.id).toBe(true);
  });
  it('raises a station at its doorstep, paid only when done, with a new look and a notice', () => {
    const { town, bench, a } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    const before = town.stock().clone(),
      next = stationStep(Structure.Workbench, 2)!;
    expect(town.stationUpgradeReason(a.id, bench.id)).toBe('');
    expect(town.orderStationUpgrade(a.id, bench.id)).toBe(true);
    expect(craftOrder(a.craftItem)).toEqual({ kind: 'station', level: 2 });
    for (let i = 0; i < 4000 && a.craftProgress < next.seconds / 2; ++i) step(town);
    expect(town.stock()).toEqual(before);
    expect(town.orderName(a)).toBe('Workbench level 2');
    // Called off half way: nothing spent, the bench as it was.
    expect(town.cancelCraft(a.id)).toBe(true);
    expect(town.stock()).toEqual(before);
    expect(stationLevel(bench)).toBe(1);
    expect(town.orderStationUpgrade(a.id, bench.id)).toBe(true);
    run(town, a);
    expect(stationLevel(bench)).toBe(2);
    expect(bench.replaced).toEqual([{ kind: Structure.Workbench, variant: levelVariant(1), dx: 0, dy: 0 }]);
    expect(town.stock().wood).toBe(before.wood - next.cost.wood);
    expect(town.stock().stone).toBe(before.stone - next.cost.stone);
    expect(town.notices.at(-1)).toBe('Asa raised the workbench to level 2');
    expect(town.craftReason(a.id, bench.id, 'stone-axe')).toBe('');
  });
  it('asks the settlement for more before the higher levels, and says what first', () => {
    const { town, smith, bench, a } = fixture();
    Object.assign(town.stock(), new Resources(100, 100, 100, 0, 0, 0, 50, 50));
    expect(town.stationUpgradeReason(a.id, smith.id)).toBe('Complete Quarry');
    const quarry = new Building(town.nextId++, Structure.Quarry, point(24, 22), 0, 0);
    quarry.village = 0;
    town.placed.push(quarry);
    expect(town.stationUpgradeReason(a.id, smith.id)).toBe('Needs 4 residents');
    town.folk.push(town.makePerson(Role.Resident, Calling.Settler, point(14, 14)));
    expect(town.stationUpgradeReason(a.id, smith.id)).toBe('');
    smith.variant = levelVariant(2);
    expect(town.stationNeeds(smith.id).map((r) => r.text)).toEqual([
      'Complete Sawmill',
      'Complete Stoneworks',
      'Clear a floor beyond a gate',
      'Needs 8 residents',
    ]);
    // The bench's iron level waits for a smithy that works stone.
    bench.variant = levelVariant(2);
    smith.variant = levelVariant(1);
    expect(town.stationNeeds(bench.id).find((r) => !r.done)?.text).toBe('Complete Sawmill');
    expect(town.stationNeeds(bench.id).map((r) => r.text)).toContain('Needs a level 2 smithy');
    bench.variant = levelVariant(3);
    expect(town.stationUpgradeReason(a.id, bench.id)).toBe('Already at the highest level');
  });
  it('keeps the ground in front of a station clear, where its crafter works', () => {
    const { town, bench } = fixture();
    const door = bench.door(),
      out = { x: door.x - bench.center.x, y: door.y - bench.center.y },
      len = Math.hypot(out.x, out.y),
      front = point(door.x + (out.x / len) * 0.6, door.y + (out.y / len) * 0.6);
    expect(town.canPlace(Structure.Tent, front, 0).reason).toBe('Blocks a door');
  });
  it('lets only one resident raise a station at a time', () => {
    const { town, bench, a, b } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    expect(town.orderStationUpgrade(a.id, bench.id)).toBe(true);
    expect(town.stationUpgradeReason(b.id, bench.id)).toBe('Someone is already upgrading it');
  });
});

describe('upgrading an item', () => {
  it('turns a resident’s wooden weapon into the stone one for less, in the same hand', () => {
    const { town, smith, a } = fixture();
    smith.variant = levelVariant(2);
    a.level = 3;
    Object.assign(town.stock(), new Resources(0, 20, 20));
    expect(town.upgradeReason(a.id, smith.id, 'flint-sword')).toBe('Has nothing to upgrade');
    expect(holdIn(town, a, 'wooden-sword', 'weapon')).toBe(true);
    const cost = upgradeCost(itemSpec('flint-sword')!);
    expect(cost.wood + cost.stone).toBeLessThan(itemSpec('flint-sword')!.cost.wood + itemSpec('flint-sword')!.cost.stone);
    const before = town.stock().clone();
    expect(town.orderUpgrade(a.id, smith.id, 'flint-sword')).toBe(true);
    expect(a.craftItem).toBe(upgradeOrder('flint-sword'));
    for (let i = 0; i < 4000 && a.craftProgress < 1; ++i) step(town);
    expect(town.cancelCraft(a.id)).toBe(true);
    expect(town.stock()).toEqual(before);
    expect(a.inventory[0]?.item).toBe('wooden-sword');
    expect(town.orderUpgrade(a.id, smith.id, 'flint-sword')).toBe(true);
    run(town, a);
    expect(a.inventory.filter(Boolean)).toEqual([{ item: 'flint-sword', quantity: 1 }]);
    expect(combatItem(a)?.id).toBe('flint-sword');
    expect(town.stock().wood).toBe(before.wood - cost.wood);
    expect(town.stock().stone).toBe(before.stone - cost.stone);
    expect(town.notices.at(-1)).toBe('Asa upgraded the Wooden sword to the Flint sword');
  });
  it('upgrades one step at a time, needs the station’s level, and puts away a make its owner cannot use yet', () => {
    const { town, smith, bench, a } = fixture();
    Object.assign(town.stock(), new Resources(50, 50, 50));
    expect(upperTier(itemSpec('wooden-shovel')!)?.id).toBe('shovel');
    expect(upperTier(itemSpec('sword')!)).toBeNull();
    addInventory(a, 'wooden-axe');
    expect(town.upgradeReason(a.id, bench.id, 'axe')).toBe('Has nothing to upgrade');
    expect(town.upgradeReason(a.id, bench.id, 'stone-axe')).toBe('Needs a level 2 workbench');
    a.level = 1;
    expect(holdIn(town, a, 'flint-spear', 'weapon')).toBe(false);
    smith.variant = levelVariant(3);
    a.inventory = a.inventory.map(() => null);
    a.level = 3;
    expect(holdIn(town, a, 'flint-spear', 'weapon')).toBe(true);
    expect(town.orderUpgrade(a.id, smith.id, 'spear')).toBe(true);
    run(town, a);
    // The iron spear is for level 5: it waits in the pack.
    expect(a.inventory[0]?.item).toBe('spear');
    expect(a.equipment.weapon).toBe(-1);
    expect(town.chronicle.weaponsForged).toBe(1);
  });
});

describe('shields and armor', () => {
  it('raises a shield only beside a one-handed weapon', () => {
    const { town, a } = fixture();
    a.level = 5;
    expect(holdIn(town, a, 'shield', 'offhand')).toBe(true);
    expect(raisedShield(a)?.id).toBe('shield');
    expect(holdIn(town, a, 'wooden-sword', 'weapon')).toBe(true);
    expect(raisedShield(a)?.id).toBe('shield');
    // A spear takes both hands: the shield goes back to the pack.
    expect(holdIn(town, a, 'wooden-spear', 'weapon')).toBe(true);
    expect(a.equipment.offhand).toBe(-1);
    expect(a.inventory.some((s) => s?.item === 'shield')).toBe(true);
    const shield = a.inventory.findIndex((s) => s?.item === 'shield') + 1;
    expect(town.equipItem(a.id, shield, 'offhand')).toBe(false);
    for (const id of ['short-bow', 'wooden-staff', 'spear', 'longbow'])
      expect(itemSpec(id)!.hands, id).toBe(2);
    for (const id of ['wooden-sword', 'wooden-club', 'mace', 'iron-mace']) expect(itemSpec(id)!.hands, id).toBe(1);
  });
  it('turns aside a share of blows with a "Block", the better make more often', () => {
    const blocked = (id: string) => {
      const { town, a } = fixture();
      a.level = 5;
      holdIn(town, a, id, 'offhand');
      const foe = new Monster(0, -1, point(a.position.x + 0.5, a.position.y));
      let count = 0,
        cue = false;
      for (let i = 0; i < 2000; ++i) {
        a.health = 1;
        town.blows = [];
        monsterBite(town, foe, a, { bite: 0.01, pause: 1 } as never);
        if (town.blows.some((hit) => hit.blocked)) ++count;
        cue ||= town.combatEvents().some((e) => e.cue === CombatCue.Block);
      }
      expect(cue).toBe(true);
      return count / 2000;
    };
    const wood = blocked('shield'),
      stone = blocked('reinforced-shield'),
      iron = blocked('iron-shield');
    expect(wood).toBeCloseTo(itemSpec('shield')!.block, 1);
    expect(wood).toBeLessThan(stone);
    expect(stone).toBeLessThan(iron);
  });
  it('takes part of every blow with armor, more for the better make, and weighs more', () => {
    const { town, a } = fixture();
    a.level = 5;
    const worn = ['wooden-armor', 'studded-armor', 'mail-armor'].map((id) => {
      a.inventory = a.inventory.map(() => null);
      a.equipment.body = -1;
      expect(holdIn(town, a, id, 'body')).toBe(true);
      return { cut: armorProtection(a), weight: itemSpec(id)!.weight };
    });
    expect(worn[0].cut).toBeGreaterThan(0);
    expect(worn[0].cut).toBeLessThan(worn[1].cut);
    expect(worn[1].cut).toBeLessThan(worn[2].cut);
    expect(worn[0].weight).toBeLessThan(worn[2].weight);
  });
});

describe('tools from the pack', () => {
  it('speeds work with a tool anywhere in the pack, the best of several, while a weapon waits for a hand', () => {
    const { a } = fixture();
    expect(workEfficiency(a, 'woodcutting')).toBe(0.4);
    addInventory(a, 'wooden-axe');
    expect(workItem(a, 'woodcutting')?.id).toBe('wooden-axe');
    addInventory(a, 'axe');
    addInventory(a, 'stone-axe');
    expect(workItem(a, 'woodcutting')?.id).toBe('axe');
    expect(workEfficiency(a, 'woodcutting')).toBe(1);
    addInventory(a, 'stone-pick');
    expect(workItem(a, 'mining')?.id).toBe('stone-pick');
    // A sword in the pack is not in hand: the hardest-hitting tool is what the resident fights with.
    a.level = 5;
    addInventory(a, 'sword');
    expect(combatItem(a)?.id).toBe('axe');
  });
});

describe('saving station levels', () => {
  it('writes version 19 once a smithy stands and keeps levels and an upgrade order', () => {
    const { town, smith, bench, a } = fixture();
    smith.variant = levelVariant(2);
    bench.variant = levelVariant(3);
    Object.assign(town.stock(), new Resources(0, 20, 20));
    a.level = 3;
    holdIn(town, a, 'wooden-club', 'weapon');
    expect(town.orderUpgrade(a.id, smith.id, 'mace')).toBe(true);
    for (let i = 0; i < 2000 && a.craftProgress < 1; ++i) step(town);
    const encoded = encodeTown(town),
      loaded = decodeTown(encoded, (map) => new Town(map, 32, false, true));
    expect(encoded.startsWith('GoldFantasy-save\n13000000')).toBe(true);
    expect(encodeTown(loaded)).toBe(encoded);
    expect(stationLevel(loaded.building(smith.id)!)).toBe(2);
    expect(stationLevel(loaded.building(bench.id)!)).toBe(3);
    const p = loaded.person(a.id)!;
    expect(p.craftItem).toBe(upgradeOrder('mace'));
    run(loaded, p);
    expect(p.inventory[0]?.item).toBe('mace');
  });
  it('stays on the old format without a station', () => {
    const { town, smith, bench } = fixture();
    town.placed = town.placed.filter((b) => b !== smith && b !== bench);
    expect(encodeTown(town).startsWith('GoldFantasy-save\n13000000')).toBe(false);
  });
  it('reads an old weaponsmith and armorer as smithies by rule, and an old bench as level 1', () => {
    const { town, smith, bench, a } = fixture();
    const armorer = new Building(town.nextId++, Structure.Armorer, point(24, 18), 0, 0);
    armorer.village = 0;
    town.placed.push(armorer);
    // An old save held random looks and a worker at the armorer.
    smith.variant = 712345;
    armorer.variant = 99;
    bench.variant = 4242;
    a.job = armorer.id;
    addInventory(a, 'leather-armor');
    const old = (encoded: string, version: number) => {
      const bytes = Buffer.from(encoded.split('\n')[1], 'hex'),
        payload = bytes.subarray(0, -8);
      payload.writeUInt32LE(version, 0);
      bytes.writeBigUInt64LE(digest(payload), bytes.length - 8);
      return 'GoldFantasy-save\n' + bytes.toString('hex');
    };
    const load = (floors: number) => {
      town.depth = town.map().dungeons().map(() => floors);
      return decodeTown(old(encodeTown(town), 18), (map) => new Town(map, 32, false, true));
    };
    const fresh = load(0);
    expect(fresh.building(armorer.id)!.kind).toBe(Structure.Weaponsmith);
    expect(stationLevel(fresh.building(smith.id)!)).toBe(2);
    expect(stationLevel(fresh.building(armorer.id)!)).toBe(2);
    expect(stationLevel(fresh.building(bench.id)!)).toBe(1);
    expect(fresh.person(a.id)!.job).toBe(-1);
    expect(fresh.person(a.id)!.inventory[0]?.item).toBe('leather-armor');
    // Written again, it is a version 19 save that reads back the same.
    const again = encodeTown(fresh);
    expect(again.startsWith('GoldFantasy-save\n13000000')).toBe(true);
    expect(stationLevel(decodeTown(again, (map) => new Town(map, 32, false, true)).building(smith.id)!)).toBe(2);
  });
});

// The station panel, drawn for real.
class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { putImageData() {}, clearRect() {} };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({ renderer: 'sw', locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}` });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});
function panel(town: Town, width = 1024, height = 900) {
  const canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, { width, height, enableDevicePixelRatio: false });
  const fonts = ['DejaVuSans', 'DejaVuSans-Bold'];
  for (const font of fonts) tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const metrics = Object.fromEntries(
    fonts.map((font) => [font, parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)))]),
  );
  const context = new Context(tvg, metrics);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the panel uses only GameAppState fields and these stubs.
  const app = new GameAppState(town, {} as never, context) as GameHudApp;
  app.selectTool = vi.fn();
  app.selectBuilding = vi.fn();
  app.selectPeople = vi.fn();
  app.reducedMotion = () => true;
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  return {
    app,
    words: () => labels.mock.calls.map(([, text]) => text),
    texts: () => labels.mock.calls,
    control: (id: string) => controls.mock.calls.find(([key]) => key === id),
    draw(station: Building) {
      controls.mockClear();
      labels.mockClear();
      app.selected = station.id;
      context.begin(app.theme, new Rect(0, 0, width, height), 1);
      inspector.call(app, new Rect(100, 20, 620, 860), true);
      context.end();
      canvas.update().render();
    },
    click(id: string) {
      const found = controls.mock.calls.find(([key]) => key === id);
      expect(found, id).toBeDefined();
      const r = found![1];
      context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
    },
    dispose() {
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
}
describe('the station panel', () => {
  it('shows the level, what the next one makes and costs, the upgrade button, and locked recipes with their reason', () => {
    const { town, bench, a } = fixture(),
      ui = panel(town);
    try {
      Object.assign(town.stock(), new Resources(0, 30, 30));
      ui.app.chosen = [a.id];
      noteSelection(ui.app);
      ui.draw(bench);
      expect(ui.words()).toEqual(
        expect.arrayContaining([
          'Workbench · Level 1',
          'Next level makes stone tools, a flint sickle and a hunting knife',
          'Upgrade: 10 wood, 6 stone',
          'Ready to upgrade',
          'Needs a level 2 workbench',
        ]),
      );
      expect(ui.control(`station-upgrade-${bench.id}`)?.[3]).toBe(true);
      ui.click(`station-upgrade-${bench.id}`);
      expect(craftOrder(a.craftItem)).toEqual({ kind: 'station', level: 2 });
    } finally {
      ui.dispose();
    }
  });
  it('makes the resident selected last the crafter, after the station itself is selected, and falls back when they are gone', () => {
    const { town, smith, a, b, c } = fixture(),
      ui = panel(town);
    try {
      ui.app.chosen = [c.id];
      noteSelection(ui.app);
      // Selecting the station clears the unit selection; the record stays.
      ui.app.chosen = [];
      noteSelection(ui.app);
      expect(stationCrafter(ui.app, smith)?.id).toBe(c.id);
      ui.draw(smith);
      expect(ui.words()).toContain(`${c.name} · Settler · Lv ${c.level}`);
      c.health = 0;
      expect(stationCrafter(ui.app, smith)?.id).not.toBe(c.id);
      expect([a.id, b.id]).toContain(stationCrafter(ui.app, smith)?.id);
    } finally {
      ui.dispose();
    }
  });
  it('fades what the crafter already has, with a mark, apart from what cannot be made', () => {
    const { town, smith, a, b, c } = fixture(),
      ui = panel(town);
    try {
      Object.assign(town.stock(), new Resources(0, 30, 30));
      a.level = 5;
      holdIn(town, a, 'wooden-sword', 'weapon');
      addInventory(a, 'shield');
      holdIn(town, a, 'wooden-armor', 'body');
      addInventory(b, 'wooden-club');
      addInventory(c, 'wooden-sword');
      ui.app.chosen = [a.id];
      noteSelection(ui.app);
      ui.draw(smith);
      expect(recipeOffer(town, smith, a, itemSpec('wooden-sword')!).mark).toBe('In hand');
      expect(recipeOffer(town, smith, a, itemSpec('shield')!).mark).toBe('Has one');
      expect(recipeOffer(town, smith, a, itemSpec('wooden-armor')!).mark).toBe('Worn');
      // Someone else lacks it: one press switches the crafter to them.
      const sword = recipeOffer(town, smith, a, itemSpec('wooden-sword')!);
      expect(sword).toMatchObject({ action: 'switch', hint: `${b.name} has none` });
      expect(ui.words()).toEqual(expect.arrayContaining(['In hand', `${b.name} has none`, 'Switch', 'Needs a level 2 smithy']));
      ui.click('station-switch-wooden-sword');
      expect(stationCrafter(ui.app, smith)?.id).toBe(b.id);
      // A better make held fades the weaker one too; an upgrade replaces Craft where it applies.
      smith.variant = levelVariant(2);
      expect(recipeOffer(town, smith, b, itemSpec('wooden-club')!).mark).toBe('Has one');
      expect(recipeOffer(town, smith, b, itemSpec('mace')!).action).toBe('upgrade');
      a.inventory[0] = { item: 'flint-sword', quantity: 1 };
      expect(recipeOffer(town, smith, a, itemSpec('wooden-sword')!).mark).toBe('Has a better one');
      // A faded row is drawn on the quiet surface; a locked one keeps its danger-coloured reason.
      ui.app.chosen = [];
      ui.draw(smith);
      const colours = ui.texts().filter(([, text]) => text === 'Needs a level 3 smithy').map(([, , color]) => color);
      expect(colours.length).toBeGreaterThan(0);
      for (const colour of colours) expect(colour).toEqual(ui.app.theme.danger);
    } finally {
      ui.dispose();
    }
  });
  it('sends a tool the crafter already has to someone without one, or offers a spare', () => {
    const { town, bench, a, b, c } = fixture();
    Object.assign(town.stock(), new Resources(0, 30, 30));
    addInventory(a, 'wooden-axe');
    addInventory(c, 'stone-axe');
    const offer = recipeOffer(town, bench, a, itemSpec('wooden-axe')!);
    expect(offer).toMatchObject({ action: 'craft', mark: 'Has one', hint: `${b.name} has none: ${b.name} will make it` });
    expect(offer.who?.id).toBe(b.id);
    addInventory(b, 'wooden-axe');
    expect(recipeOffer(town, bench, a, itemSpec('wooden-axe')!)).toMatchObject({ action: 'spare', hint: 'Everyone has one' });
    // The crafter who lacks it makes it as before.
    expect(recipeOffer(town, bench, c, itemSpec('wooden-pick')!)).toMatchObject({ action: 'craft', who: c, mark: '' });
  });
});
describe('Korean for the smithy', () => {
  it('translates every new line the station panel, the notices and the goals show', async () => {
    const { korean } = await import('../../packages/localization/src/korean');
    const lines = [
      'Smithy · Level 2',
      'Next level makes stone weapons, a reinforced shield and stone-studded armor',
      'Upgrade: 16 wood, 12 stone',
      'Needs a level 2 smithy',
      'Needs a level 3 workbench',
      'Asa raised the workbench to level 2',
      'Asa upgraded the Wooden sword to the Flint sword',
      'Bryn has none: Bryn will make it',
      'Bryn has none',
      'In hand: Wooden sword, Wooden shield · Worn: Wooden armor · Tools: 2',
      'Wooden axe in the pack · Fells trees faster',
      'Turns more blows aside than a wooden shield',
      'Takes less damage than wooden armor',
      'Hits harder than a flint sword',
      'Workbench level 2',
      'Asa stopped making the Smithy level 3',
      'The wooden spear takes both hands',
      'Tools from the pack: Wooden axe, Stone pick',
      'Main hand: Wooden spear · Wooden shield (needs a free hand)',
      'Has one',
      'In hand',
      'Worn',
      'Has a better one',
      'Everyone has one',
      'Upgrading · 40%',
      'Level 1 / 2',
      'Blocks a door',
    ];
    for (const line of lines) {
      const out = korean.translate(line);
      expect(out, line).not.toBe(line);
      // Only names stay in Latin letters.
      expect(out.replace(/Asa|Bryn|Lv/g, ''), line).not.toMatch(/[A-Za-z]{2}/);
    }
  });
});
