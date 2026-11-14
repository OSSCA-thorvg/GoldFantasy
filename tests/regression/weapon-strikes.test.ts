import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { point, type Point } from '../../packages/engine/src/geometry';
import { StrikeKind, strikeOf } from '../../packages/engine/src/skill-catalog';
import { itemCatalog } from '../../packages/engine/src/equipment';

function fixture() {
  const map = new WorldMap();
  map.columns = map.rows = 48;
  map.mapSeed = 5;
  map.origin = { x: 12, y: 12 };
  map.tiles = Array.from({ length: 48 * 48 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(97 * 97).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Raid source', kind: DungeonKind.Cave, origin: { x: 38, y: 38 }, discovered: true }];
  map.reveal(24, 24, 100);
  const town = new Town(map, 48, false);
  town.placed.push(new Building(0, Structure.Camp, point(12, 12), 0, 0));
  town.nextId = 1;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(200, 60, 60, 60, 0, 60, 20, 20));
  town.folk = [];
  town.nextPerson = 0;
  town.editHour(12);
  town.tick(0);
  // No crits: every blow lands as its shape says.
  town.roll = () => 0.99;
  return town;
}
function fighter(town: Town, at: Point, calling: Calling, visual: string | null) {
  const p = new Person(town.nextPerson++, `R${town.nextPerson}`, Role.Resident, calling, Race.Human, 0, { ...at });
  p.home = p.village = 0;
  p.food = p.rest = p.health = p.hydration = 1;
  p.level = 5;
  p.stress = 0;
  p.activity = p.task = Activity.Idle;
  town.folk.push(p);
  if (visual) {
    const item = itemCatalog
      .filter((i) => i.category === 'weapon' && i.visual === visual && i.minimumLevel <= p.level)
      .sort((a, b) => b.attackBonus - a.attackBonus)[0];
    p.inventory[0] = { item: item.id, quantity: 1 };
    p.equipment.weapon = 1;
  }
  return p;
}
function foe(town: Town, at: Point) {
  const m = new Monster(town.nextMonster++, 0, { ...at });
  m.home = { ...at };
  m.health = m.vigor = 100;
  m.angry = true;
  m.ready = town.clock() + 1000;
  town.beasts.push(m);
  return m;
}
const struck = (town: Town, ms: Monster[]) => ms.map((m) => Math.round((100 - m.health) * 100) / 100);

describe('the weapon in hand shapes the blow', () => {
  it('maps weapon shapes to strikes, and tools or bare hands to one target', () => {
    expect(strikeOf('sword').kind).toBe(StrikeKind.Cleave);
    expect(strikeOf('mace').kind).toBe(StrikeKind.Crush);
    expect(strikeOf('bow').kind).toBe(StrikeKind.Pierce);
    expect(strikeOf('staff').kind).toBe(StrikeKind.Splash);
    expect(strikeOf('axe').kind).toBe(StrikeKind.Single);
    expect(strikeOf(null).kind).toBe(StrikeKind.Single);
  });
  it('lets a sword cleave the enemies beside its target, at most three in all', () => {
    const town = fixture(),
      p = fighter(town, point(20, 20), Calling.Warrior, 'sword'),
      target = foe(town, point(20.8, 20)),
      beside = [foe(town, point(20.8, 20.7)), foe(town, point(20.8, 19.3)), foe(town, point(21.2, 20.9))],
      far = foe(town, point(23, 20)),
      blow = town.blowStrength(p);
    town.strike(p, target);
    expect(100 - target.health).toBeCloseTo(blow, 4);
    const caught = beside.filter((m) => m.health < 100);
    expect(caught).toHaveLength(2);
    for (const m of caught) expect(100 - m.health).toBeCloseTo(blow * strikeOf('sword').share, 4);
    expect(far.health).toBe(100);
    const hits = town.hits().filter((hit) => hit.attacker === p.id);
    expect(hits).toHaveLength(3);
    expect(hits.filter((hit) => hit.primary)).toHaveLength(1);
    expect(hits.every((hit) => hit.strike === StrikeKind.Cleave)).toBe(true);
    expect(p.swingAt).toBe(town.clock());
  });
  it('lets a mace stagger its target, delaying its next bite', () => {
    const town = fixture(),
      p = fighter(town, point(20, 20), Calling.Cleric, 'mace'),
      target = foe(town, point(20.8, 20)),
      other = foe(town, point(20.8, 20.6));
    target.ready = other.ready = town.clock();
    town.strike(p, target);
    expect(target.ready).toBeCloseTo(town.clock() + strikeOf('mace').stagger, 5);
    expect(other.health).toBe(100);
    expect(town.hits().at(-1)).toMatchObject({ strike: StrikeKind.Crush, primary: true });
  });
  it('lets an arrow fly on through to one enemy behind the target, not one beside the archer', () => {
    const town = fixture(),
      p = fighter(town, point(20, 20), Calling.Ranger, 'bow'),
      target = foe(town, point(22, 20)),
      behind = foe(town, point(23.5, 20.2)),
      further = foe(town, point(24, 19.8)),
      aside = foe(town, point(20, 21.2));
    town.strike(p, target);
    expect(struck(town, [behind, further, aside]).filter((d) => d > 0)).toHaveLength(1);
    expect(behind.health).toBeLessThan(100);
    expect(aside.health).toBe(100);
    expect(town.hits().filter((hit) => hit.attacker === p.id && !hit.primary)[0]).toMatchObject({
      strike: StrikeKind.Pierce,
      from: target.position,
    });
  });
  it('lets a staff bolt splash those around its target', () => {
    const town = fixture(),
      p = fighter(town, point(20, 20), Calling.Mage, 'staff'),
      target = foe(town, point(22, 20)),
      around = [foe(town, point(22.6, 20)), foe(town, point(22, 20.7)), foe(town, point(21.5, 19.5))],
      beyond = foe(town, point(23.5, 20));
    town.strike(p, target);
    expect(around.every((m) => m.health < 100)).toBe(true);
    expect(beyond.health).toBe(100);
    for (const m of around) expect(100 - m.health).toBeCloseTo(town.blowStrength(p) * strikeOf('staff').share, 4);
  });
  it('lets bare hands and tools strike one target', () => {
    const town = fixture(),
      p = fighter(town, point(20, 20), Calling.Settler, null),
      target = foe(town, point(20.6, 20)),
      beside = foe(town, point(20.6, 20.5));
    town.strike(p, target);
    expect(beside.health).toBe(100);
    expect(town.hits().at(-1)).toMatchObject({ strike: StrikeKind.Single, primary: true });
  });
  it('marks every bite with the monster’s swing time', () => {
    const town = fixture(),
      p = fighter(town, point(20, 20), Calling.Warrior, 'sword'),
      m = foe(town, point(20.5, 20));
    m.raider = true;
    m.ready = 0;
    town.orderHold([p.id]);
    p.ready = Infinity;
    town.advance(0.1);
    expect(m.swingAt).toBeGreaterThan(0);
    expect(town.hits().some((hit) => hit.onPerson && hit.person === p.id)).toBe(true);
  });
});
