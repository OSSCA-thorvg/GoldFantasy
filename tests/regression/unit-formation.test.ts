import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { distance, point, type Point } from '../../packages/engine/src/geometry';
import { CombatCue } from '../../packages/engine/src/combat-events';
import { secondSkillLevel, skillPower, skillSpec } from '../../packages/engine/src/skill-catalog';
import { skillEffects } from '../../packages/engine/src/monster-ranks';
import { itemCatalog } from '../../packages/engine/src/equipment';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';

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
  town.wildlifeDay = town.days;
  town.tick(0);
  return town;
}
function resident(town: Town, at: Point, calling: Calling, visual: string | null = null, level = 5) {
  const p = new Person(town.nextPerson++, `R${town.nextPerson}`, Role.Resident, calling, Race.Human, 0, { ...at });
  p.home = p.village = 0;
  p.food = p.rest = p.health = p.hydration = 1;
  p.level = level;
  p.stress = 0;
  p.activity = p.task = Activity.Idle;
  p.until = town.clock();
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
function monster(town: Town, at: Point, health = 100) {
  const m = new Monster(town.nextMonster++, 0, { ...at });
  m.home = { ...at };
  m.health = m.vigor = health;
  m.raider = true;
  m.ready = town.clock() + 1000;
  town.beasts.push(m);
  return m;
}
function step(town: Town, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); ++i) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
  }
}
const cues = (town: Town, cue: CombatCue) => town.combatEvents().filter((event) => event.cue === cue);

describe('hold position', () => {
  it('stands, strikes what comes into reach and never chases', () => {
    const town = fixture(),
      p = resident(town, point(20, 20), Calling.Warrior, 'sword'),
      far = monster(town, point(26, 20));
    far.raider = false;
    expect(town.orderHold([p.id])).toBe(1);
    expect(p.holding).toBe(true);
    step(town, 2);
    expect(p.position).toEqual(point(20, 20));
    expect(far.health).toBe(100);
    far.position = point(20.7, 20);
    far.angry = true;
    step(town, 1.2);
    expect(far.health).toBeLessThan(100);
    expect(p.activity).toBe(Activity.Fighting);
    expect(distance(p.position, point(20, 20))).toBeLessThan(0.01);
    far.position = point(26, 20);
    far.angry = false;
    step(town, 1);
    expect(p.activity).toBe(Activity.Holding);
    expect(distance(p.position, point(20, 20))).toBeLessThan(0.01);
  });
  it('still uses skills left on auto, and any other order ends it', () => {
    const town = fixture(),
      cleric = resident(town, point(20, 20), Calling.Cleric),
      hurt = resident(town, point(21, 20), Calling.Settler);
    town.orderHold([cleric.id]);
    hurt.health = 0.2;
    step(town, 0.3);
    expect(hurt.health).toBeGreaterThan(0.5);
    town.orderMove([cleric.id], point(25, 25));
    expect(cleric.holding).toBe(false);
    town.orderHold([cleric.id]);
    town.orderStop([cleric.id]);
    expect(cleric.holding).toBe(false);
  });
});

describe('group moves arrive in formation', () => {
  it('puts blades in front, bards and clerics behind them, bows and staves at the back, 0.7 apart', () => {
    const town = fixture(),
      at = (dx: number, dy: number) => point(10 + dx, 10 + dy),
      group = [
        resident(town, at(0, 0), Calling.Ranger, 'bow'),
        resident(town, at(0.6, 0), Calling.Warrior, 'sword'),
        resident(town, at(1.2, 0), Calling.Cleric, 'mace'),
        resident(town, at(1.8, 0), Calling.Warrior, 'sword'),
        resident(town, at(2.4, 0), Calling.Mage, 'staff'),
        resident(town, at(3, 0), Calling.Bard),
      ],
      to = point(30, 10.5);
    town.orderMove(
      group.map((p) => p.id),
      to,
    );
    const goal = (p: Person) => p.path.at(-1)!,
      ahead = (p: Person) => goal(p).x - to.x;
    const [ranger, w1, cleric, w2, mage, bard] = group;
    expect(Math.min(ahead(w1), ahead(w2))).toBeGreaterThan(Math.max(ahead(cleric), ahead(bard)));
    expect(Math.min(ahead(cleric), ahead(bard))).toBeGreaterThan(Math.max(ahead(ranger), ahead(mage)));
    expect(distance(goal(w1), goal(w2))).toBeCloseTo(0.7, 1);
    expect(ahead(w1) - ahead(cleric)).toBeCloseTo(0.7, 1);
    for (const p of group) expect(distance(goal(p), to)).toBeLessThan(1.5);
    // The same order twice gives the same slots.
    const first = group.map((p) => ({ ...goal(p) }));
    town.orderMove(
      group.map((p) => p.id),
      to,
    );
    expect(group.map(goal)).toEqual(first);
  });
  it('sends a single resident to the exact point', () => {
    const town = fixture(),
      p = resident(town, point(10, 10), Calling.Warrior, 'sword');
    town.orderAttackMove([p.id], point(20.3, 14.6));
    expect(p.path.at(-1)).toEqual(point(20.3, 14.6));
  });
});

describe('two skills per calling', () => {
  it('lists both skills, the second locked below its level, and keeps the slot-0 API', () => {
    const town = fixture(),
      young = resident(town, point(15, 15), Calling.Warrior, null, 1),
      old = resident(town, point(16, 15), Calling.Warrior, null, secondSkillLevel),
      settler = resident(town, point(17, 15), Calling.Settler);
    expect(town.skillsOf(young).map((s) => [s.id, s.slot, s.locked, s.ready, s.level])).toEqual([
      ['challenge', 0, false, true, 1],
      ['whirl', 1, true, false, secondSkillLevel],
    ]);
    expect(town.skillsOf(old)[1]).toMatchObject({ id: 'whirl', locked: false, ready: true });
    expect(town.skillsOf(settler)).toEqual([]);
    expect(town.abilityOf(old)).toEqual(town.skillsOf(old)[0]);
    expect(town.useSkill([young.id], 1)).toBe(0);
    expect(town.skillReach(old, 1)).toBe(skillSpec('whirl').radius);
    expect(town.abilityReach(old)).toBe(town.skillReach(old, 0));
    // Skills help on their own until the player takes one in hand.
    expect(town.skillsOf(old).map((s) => s.auto)).toEqual([true, true]);
    expect(town.setSkillAuto([old.id], 1, false)).toBe(1);
    expect(town.skillsOf(old)[1].auto).toBe(false);
    expect(town.skillsOf(old)[0].auto).toBe(true);
  });
  it('Whirl lands a heavy blow on every enemy around the warrior', () => {
    const town = fixture(),
      w = resident(town, point(20, 20), Calling.Warrior, 'sword'),
      near = [monster(town, point(21, 20)), monster(town, point(20, 21.2))],
      out = monster(town, point(22.5, 20)),
      blow = town.blowStrength(w);
    expect(town.useSkill([w.id], 1)).toBe(1);
    expect(w).toMatchObject({ cast: 'whirl', castAt: town.clock() });
    expect(cues(town, CombatCue.Ability).at(-1)).toMatchObject({ skill: 'whirl', text: 'Whirl', person: w.id, radius: 1.8 });
    step(town, 0.4);
    for (const m of near) expect(100 - m.health).toBeGreaterThanOrEqual(blow * skillPower.whirl - 0.01);
    expect(out.health).toBe(100);
    expect(town.skillsOf(w)[1]).toMatchObject({ ready: false, remaining: expect.any(Number) });
  });
  it('Volley rains on a circle, picking the thickest spot on its own', () => {
    const town = fixture(),
      r = resident(town, point(20, 20), Calling.Ranger, 'bow'),
      pack = [monster(town, point(26, 20)), monster(town, point(26.5, 20.5)), monster(town, point(25.6, 19.4))],
      lone = monster(town, point(20, 26));
    town.orderHold([r.id]);
    r.ready = Infinity;
    expect(town.useSkill([r.id], 1)).toBe(1);
    step(town, 0.8);
    for (const m of pack) expect(m.health).toBeLessThan(100);
    expect(lone.health).toBe(100);
    expect(town.useSkill([r.id], 1, point(20, 26))).toBe(0);
  });
  it('Frost Ring slows the enemies inside to half pace and half bite rate', () => {
    const town = fixture(),
      mage = resident(town, point(20, 20), Calling.Mage, 'staff'),
      inside = monster(town, point(25, 20)),
      outside = monster(town, point(30, 20));
    expect(town.useSkill([mage.id], 1, point(25, 20))).toBe(1);
    step(town, 0.5);
    expect(town.combatState.chilled.has(inside.id)).toBe(true);
    expect(town.combatState.chilled.has(outside.id)).toBe(false);
    expect(skillEffects.frostSlow).toBe(0.5);
    step(town, skillSpec('frost').duration + 0.5);
    expect(town.combatState.chilled.has(inside.id)).toBe(false);
  });
  it('Sanctuary mends the allies inside and keeps the downed from bleeding out', () => {
    const town = fixture(),
      c = resident(town, point(20, 20), Calling.Cleric),
      hurt = resident(town, point(21, 20), Calling.Settler),
      fallen = resident(town, point(20, 21), Calling.Settler);
    town.setSkillAuto([c.id], 0, false);
    town.orderHold([c.id, hurt.id]);
    hurt.health = 0.3;
    town.strikeDown(fallen, 'Killed by monsters');
    const left = town.bleedOutLeft(fallen);
    expect(town.useSkill([c.id], 1)).toBe(1);
    expect(town.hallowed(hurt)).toBe(true);
    step(town, 2);
    expect(hurt.health).toBeCloseTo(0.3 + 2 * skillPower.sanctuaryMend, 2);
    expect(fallen.downedAt).toBeGreaterThanOrEqual(0);
    expect(town.bleedOutLeft(fallen)).toBeCloseTo(left, 0);
  });
  it('Dirge softens the bites and slows the steps of enemies around the bard', () => {
    const town = fixture(),
      bard = resident(town, point(20, 20), Calling.Bard),
      m = monster(town, point(21, 20));
    m.ready = 0;
    town.orderHold([bard.id]);
    bard.ready = Infinity;
    town.roll = () => 0.99;
    step(town, 0.1);
    const plain = 1 - bard.health;
    bard.health = 1;
    expect(town.useSkill([bard.id], 1)).toBe(1);
    expect(town.combatState.dirged.has(m.id)).toBe(true);
    m.ready = 0;
    step(town, 0.1);
    expect(1 - bard.health).toBeCloseTo(plain * skillEffects.dirgeBite, 4);
  });
  it('fires skills on their own when they would help, except one the player has taken in hand', () => {
    const town = fixture(),
      w = resident(town, point(20, 20), Calling.Warrior, 'sword');
    for (const at of [point(21, 20), point(20, 21), point(19, 20), point(20, 19)]) monster(town, at);
    town.orderHold([w.id]);
    town.setSkillAuto([w.id], 1, false);
    step(town, 0.6);
    expect(w.abilityReadyAt2).toBe(0);
    town.setSkillAuto([w.id], 1, true);
    step(town, 0.6);
    expect(w.abilityReadyAt2).toBeGreaterThan(0);
  });
  it('keeps second-skill readiness, auto and hold position across a save, at the lowest version that holds them', () => {
    const town = fixture(),
      w = resident(town, point(20, 20), Calling.Warrior, 'sword');
    const version = (save: string) => Number.parseInt(save.slice(17, 19), 16);
    const plain = encodeTown(town);
    expect(version(plain)).toBeLessThan(15);
    // A combat record without anything new stays a version 15 save and loads as before.
    w.kills = 3;
    w.abilityReadyAt = town.clock() + 2;
    const older = encodeTown(town);
    expect(version(older)).toBe(15);
    expect(decodeTown(older, (map) => new Town(map, 48, false, true)).person(w.id)).toMatchObject({ kills: 3, abilityAuto2: -1, holding: false });
    town.setSkillAuto([w.id], 1, false);
    town.orderHold([w.id]);
    w.abilityReadyAt2 = town.clock() + 7;
    const save = encodeTown(town);
    expect(version(save)).toBe(16);
    const loaded = decodeTown(save, (map) => new Town(map, 48, false, true)).person(w.id)!;
    expect(loaded).toMatchObject({ abilityAuto2: 0, holding: true, abilityReadyAt2: w.abilityReadyAt2, cast: '', swingAt: -1 });
    expect(decodeTown(plain, (map) => new Town(map, 48, false, true)).person(w.id)!.holding).toBe(false);
  });
});
