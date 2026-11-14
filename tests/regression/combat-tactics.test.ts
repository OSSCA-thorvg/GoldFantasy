import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap, worldName } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile, type Dungeon } from '../../packages/engine/src/world-types';
import { Activity, AnimalKind, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { add, distance, point, type Point } from '../../packages/engine/src/geometry';
import { CombatCue, MonsterRank, combatRules } from '../../packages/engine/src/combat-events';
import { Boon, boon, boonOfWorld } from '../../packages/engine/src/gate-boons';
import { sealFloors, sealable } from '../../packages/engine/src/gate-seals';
import { breedOf, lairOf, monsterBite, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { RaidKind } from '../../packages/engine/src/raid-progression';
import { canControl, controlReason } from '../../packages/engine/src/faction';
import { rankRules } from '../../packages/engine/src/monster-ranks';
import { animalSpec } from '../../packages/engine/src/wildlife';
import { skillPower } from '../../packages/engine/src/skill-catalog';
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
  const town = new Town(map, 48, false),
    camp = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  town.placed.push(camp);
  town.nextId = 1;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(200, 60, 60, 60, 0, 60, 20, 20));
  town.folk = [];
  town.nextPerson = 0;
  town.editHour(12);
  town.wildlifeDay = town.days;
  town.tick(0);
  return { town, camp };
}
function resident(town: Town, at: Point, calling = Calling.Settler, name = `R${town.nextPerson}`) {
  const p = new Person(town.nextPerson++, name, Role.Resident, calling, Race.Human, 0, { ...at });
  p.home = p.village = 0;
  p.food = p.rest = p.health = p.hydration = 1;
  p.stress = 0;
  town.folk.push(p);
  p.activity = p.task = Activity.Idle;
  p.until = town.time;
  return p;
}
function monster(town: Town, at: Point, health = 100) {
  const foe = new Monster(town.nextMonster++, 0, { ...at });
  foe.home = { ...foe.position };
  foe.health = foe.vigor = health;
  foe.raider = true;
  foe.ready = town.time + 1000;
  town.beasts.push(foe);
  return foe;
}
function equip(p: Person, slot: 'weapon' | 'offhand', item: string) {
  const index = p.inventory.findIndex((stack) => !stack);
  p.inventory[index] = { item, quantity: 1 };
  p.equipment[slot] = index + 1;
  p.level = Math.max(p.level, 3);
}
function step(town: Town, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); ++i) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
  }
}
const cues = (town: Town, cue: CombatCue) => town.combatEvents().filter((event) => event.cue === cue);
/** Seals a gate whose world grants the boon, adding one to the map if none fits. */
function grant(town: Town, which: Boon) {
  const sites = town.map().dungeons();
  for (const kind of [DungeonKind.Cave, DungeonKind.Crypt, DungeonKind.Portal, DungeonKind.Ruin])
    for (const origin of [point(2, 2), point(2, 44), point(44, 2), point(44, 44), point(24, 2), point(24, 44)]) {
      const site: Dungeon = { name: 'Sealed gate', kind, origin, discovered: false };
      if (boonOfWorld(town.map().destination(site)) !== which) continue;
      sites.push(site);
      town.depth = sites.map((other, index) => (index === sites.length - 1 ? sealFloors : (town.depth[index] ?? 0)));
      expect(boon(town, which)).toBe(true);
      return;
    }
  throw new Error('no gate for that boon');
}

describe('downed residents', () => {
  it('goes down instead of dying, and monsters leave the downed alone', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15)),
      beast = monster(town, point(15.5, 15));
    p.health = 0.001;
    beast.ready = town.time;
    town.advance(0.1);
    expect(p.downedAt).toBeCloseTo(town.clock(), 5);
    expect(p.activity).toBe(Activity.Downed);
    expect(p.health).toBe(0);
    expect(p.path).toHaveLength(0);
    expect(cues(town, CombatCue.Downed)[0]).toMatchObject({ person: p.id, text: 'Killed by monsters' });
    expect(town.notices.at(-1)).toBe(`${p.name} is down and bleeding out`);
    expect(town.downedResidents()).toEqual([p]);
    const blows = town.hits().filter((hit) => hit.person === p.id).length;
    beast.ready = town.time;
    step(town, 3);
    expect(town.hits().filter((hit) => hit.person === p.id && hit.at > town.clock() - 2).length).toBe(0);
    expect(blows).toBeGreaterThan(0);
    expect(p.activity).toBe(Activity.Downed);
    expect(canControl(p)).toBe(false);
    expect(controlReason(p)).toContain('Downed');
    town.orderMove([p.id], point(20, 20));
    expect(p.task).not.toBe(Activity.Moving);
  });
  it('bleeds out into death with a lasting record', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15), Calling.Ranger, 'Embla');
    p.kills = 4;
    town.strikeDown(p, 'Killed by monsters');
    expect(town.bleedOutLeft(p)).toBeCloseTo(combatRules.bleedOut);
    expect(town.bleedOutTotal(p)).toBeCloseTo(combatRules.bleedOut);
    step(town, combatRules.bleedOut - 1);
    expect(town.bleedOutLeft(p)).toBeCloseTo(1, 0);
    expect(town.person(p.id)).toBe(p);
    let removedAt = -1;
    for (let i = 0; i < 30 && removedAt < 0; ++i) {
      town.advance(0.1);
      if (!town.person(p.id)) removedAt = town.clock();
    }
    expect(town.fallen).toHaveLength(1);
    expect(town.fallen[0]).toMatchObject({ id: p.id, name: 'Embla', calling: Calling.Ranger, kills: 4, cause: 'Killed by monsters', place: 'Midgard', day: town.days });
    expect(town.fallen[0].at).toBeCloseTo(removedAt, 5);
    expect(cues(town, CombatCue.Death)[0]).toMatchObject({ person: p.id, text: 'Killed by monsters' });
    expect(town.notices).toContain('Embla has died of their wounds');
  });
  it('bleeds out twice as fast with a wound already carried', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15));
    p.woundDays = 1;
    town.strikeDown(p, 'Killed by monsters');
    expect(town.bleedOutLeft(p)).toBeCloseTo(combatRules.bleedOut / 2);
  });
  it('makes the settlement grieve, nearby residents most', () => {
    const { town } = fixture(),
      dead = resident(town, point(15, 15)),
      near = resident(town, point(18, 15)),
      far = resident(town, point(40, 40));
    town.killResident(dead, 'Killed by monsters');
    expect(near.stress).toBeCloseTo(0.25 * town.memorialComfort());
    expect(far.stress).toBeCloseTo(0.1 * town.memorialComfort());
    expect(town.fallen).toHaveLength(1);
  });
  it('lets an ordered ally kneel and get the downed up with a wound', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15)),
      helper = resident(town, point(19, 15));
    town.strikeDown(p, 'Killed by monsters');
    expect(town.orderTend([helper.id], p.id)).toBe(true);
    for (let i = 0; i < 80 && helper.activity !== Activity.Tending; ++i) town.advance(0.1);
    expect(helper.activity).toBe(Activity.Tending);
    expect(helper.target).toBe(p.id);
    expect(distance(helper.position, p.position)).toBeLessThanOrEqual(0.9);
    const revision = p.lookRevision;
    step(town, combatRules.tendSeconds + 0.2);
    expect(p.downedAt).toBe(-1);
    expect(p.health).toBeGreaterThanOrEqual(combatRules.reviveHealth);
    expect(p.health).toBeLessThan(combatRules.reviveHealth + 0.01);
    expect(p.woundDays).toBe(combatRules.woundDays);
    expect(p.lookRevision).toBeGreaterThan(revision);
    expect(town.chronicle.rescues).toBe(1);
    expect(cues(town, CombatCue.Revived)[0]).toMatchObject({ person: p.id });
    expect(helper.task).not.toBe(Activity.Tending);
  });
  it('keeps counting when the order is given again to an ally already kneeling', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15)),
      helper = resident(town, point(16, 15));
    town.strikeDown(p, 'Killed by monsters');
    town.orderTend([helper.id], p.id);
    for (let i = 0; i < 80 && helper.activity !== Activity.Tending; ++i) town.advance(0.1);
    expect(helper.activity).toBe(Activity.Tending);
    step(town, combatRules.tendSeconds / 2);
    expect(town.orderTend([helper.id], p.id)).toBe(true);
    step(town, combatRules.tendSeconds / 2 + 0.3);
    expect(p.downedAt).toBe(-1);
  });
  it('starts the kneel afresh when a kneeling ally is sent to another body', () => {
    const { town } = fixture(),
      first = resident(town, point(15, 15)),
      second = resident(town, point(15.6, 15)),
      helper = resident(town, point(15.3, 15.4));
    town.strikeDown(first, 'Killed by monsters');
    town.strikeDown(second, 'Killed by monsters');
    town.orderTend([helper.id], first.id);
    for (let i = 0; i < 80 && helper.activity !== Activity.Tending; ++i) town.advance(0.1);
    step(town, combatRules.tendSeconds / 2);
    expect(town.orderTend([helper.id], second.id)).toBe(true);
    step(town, combatRules.tendSeconds / 2 + 0.3);
    expect(second.downedAt).toBeGreaterThanOrEqual(0);
    step(town, combatRules.tendSeconds);
    expect(second.downedAt).toBe(-1);
    expect(first.downedAt).toBeGreaterThanOrEqual(0);
  });
  it('drops tending for a new Move order', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15)),
      helper = resident(town, point(19, 15));
    town.strikeDown(p, 'Killed by monsters');
    town.orderTend([helper.id], p.id);
    town.advance(0.1);
    town.orderMove([helper.id], point(30, 30));
    expect(helper.task).toBe(Activity.Moving);
    step(town, 2);
    expect(p.downedAt).toBeGreaterThanOrEqual(0);
  });
  it('sends an idle ally on its own, but not while a monster stands over the body', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15)),
      helper = resident(town, point(20, 15));
    town.orderStop([helper.id]);
    town.strikeDown(p, 'Killed by monsters');
    const guard = monster(town, point(16, 15));
    guard.raider = false;
    town.advance(0.1);
    expect(helper.task).not.toBe(Activity.Tending);
    town.beasts = [];
    town.advance(0.1);
    expect(helper.task).toBe(Activity.Tending);
    step(town, 12);
    expect(p.downedAt).toBe(-1);
  });
  it('caps a wounded resident and lets the wound wear off by the day', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15));
    p.woundDays = 3;
    p.health = 0.9;
    town.advance(0.1);
    expect(p.health).toBeCloseTo(combatRules.woundedHealth);
    ++town.days;
    town.advanceWounds();
    expect(p.woundDays).toBe(2);
    const clinic = new Building(town.nextId++, Structure.Apothecary, point(20, 20), 0, 0);
    clinic.village = 0;
    clinic.workers = 1;
    town.placed.push(clinic);
    const revision = p.lookRevision;
    ++town.days;
    town.advanceWounds();
    expect(p.woundDays).toBe(0);
    expect(p.lookRevision).toBeGreaterThan(revision);
  });
});

describe('blows', () => {
  it('lands a critical blow for double damage', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15)),
      foe = monster(town, point(15.5, 15));
    const blow = town.blowStrength(p);
    town.roll = () => 0;
    town.strike(p, foe);
    expect(foe.health).toBeCloseTo(100 - blow * combatRules.critDamage, 4);
    expect(town.hits().at(-1)).toMatchObject({ crit: true, attacker: p.id });
    expect(cues(town, CombatCue.Crit)[0]).toMatchObject({ person: p.id, creature: foe.id });
    town.roll = () => 0.15;
    p.ready = 0;
    town.strike(p, foe);
    expect(town.hits().at(-1)!.crit).toBeUndefined();
    const ranger = resident(town, point(16, 15), Calling.Ranger);
    town.strike(ranger, foe);
    expect(town.hits().at(-1)!.crit).toBe(true);
  });
  it('turns a monster blow aside with a shield', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15), Calling.Warrior),
      beast = monster(town, point(15.5, 15)),
      breed = breedOf(DungeonKind.Cave);
    equip(p, 'offhand', 'shield');
    town.roll = () => 0;
    monsterBite(town, beast, p, breed);
    expect(p.health).toBe(1);
    expect(town.hits().at(-1)).toMatchObject({ blocked: true, damage: 0, person: p.id });
    expect(cues(town, CombatCue.Block)[0]).toMatchObject({ person: p.id, creature: beast.id });
    town.roll = () => 0.9;
    monsterBite(town, beast, p, breed);
    expect(p.health).toBeLessThan(1);
  });
  it('softens blows near the seat while the ward rite holds', () => {
    const { town } = fixture(),
      a = resident(town, point(15, 15)),
      beast = monster(town, point(15.5, 15)),
      breed = breedOf(DungeonKind.Cave);
    monsterBite(town, beast, a, breed);
    const plain = 1 - a.health;
    a.health = 1;
    town.wardUntil = town.time + 60;
    monsterBite(town, beast, a, breed);
    expect(1 - a.health).toBeCloseTo(plain * 0.7, 5);
  });
  it('counts kills, levels and repelled raids', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15));
    const foe = monster(town, point(15.5, 15), 0.5);
    foe.raider = false;
    town.strike(p, foe);
    town.stir(0.1);
    expect(p.kills).toBe(1);
    expect(town.chronicle.monstersSlain).toBe(1);
    expect(cues(town, CombatCue.Kill)[0]).toMatchObject({ person: p.id, creature: foe.id });
    town.rewardExperience(p, 1000);
    expect(cues(town, CombatCue.LevelUp).at(-1)).toMatchObject({ person: p.id, amount: p.level });
    town.days = 14;
    town.summonRaid(RaidKind.Pack);
    expect(town.raiding()).toBe(true);
    const raiders = town.monsters().length;
    for (const beast of town.beasts) beast.health = 0;
    town.stir(0.1);
    expect(town.chronicle.raidsRepelled).toBe(1);
    expect(town.chronicle.monstersSlain).toBe(1 + raiders);
  });
  it('gives every new monster a rank and its full health', () => {
    const { town } = fixture();
    town.days = 20;
    town.summonRaid(RaidKind.Brutes);
    expect(town.monsters().length).toBeGreaterThan(0);
    // A wave: its leaders first, then the swarm.
    const ranks = (kind: MonsterRank) => town.monsters().filter((beast) => beast.rank === kind).length;
    expect(town.monsters()[0].rank).toBe(MonsterRank.Brute);
    expect(ranks(MonsterRank.Brute) + ranks(MonsterRank.Swarmer)).toBe(town.monsters().length);
    expect(ranks(MonsterRank.Swarmer)).toBeGreaterThan(ranks(MonsterRank.Brute));
    for (const beast of town.monsters()) expect(beast.vigor).toBe(beast.health);
    expect(cues(town, CombatCue.Wave).at(-1)!.amount).toBe(town.monsters().length);
    town.beasts = [];
    town.summonRaid(RaidKind.Pack);
    expect(town.monsters()[0].rank).toBe(MonsterRank.Grunt);
    expect(ranks(MonsterRank.Swarmer)).toBeGreaterThan(ranks(MonsterRank.Grunt));
    for (const beast of town.monsters()) expect(beast.vigor).toBe(beast.health);
    town.beasts = [];
    town.releaseMonster(point(30, 30));
    expect(town.monsters()[0].vigor).toBe(town.monsters()[0].health);
  });
});

describe('calling abilities', () => {
  it('describes the ability of each calling and none for settlers', () => {
    const { town } = fixture();
    const names = [Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Bard].map((calling) => {
      const state = town.abilityOf(resident(town, point(15, 15), calling))!;
      return [state.id, state.cooldown, state.auto, state.targeted];
    });
    expect(names).toEqual([
      ['challenge', 20, true, false],
      ['aimed', 12, true, false],
      ['burst', 16, true, true],
      ['mend', 14, true, false],
      ['rally', 30, true, false],
    ]);
    expect(town.abilityOf(resident(town, point(15, 15)))).toBeNull();
  });
  it('Challenge draws nearby monsters to the warrior and halves the blows taken', () => {
    const { town } = fixture(),
      w = resident(town, point(15, 15), Calling.Warrior),
      a = monster(town, point(17, 15)),
      b = monster(town, point(15, 17)),
      far = monster(town, point(25, 25)),
      breed = breedOf(DungeonKind.Cave);
    town.roll = () => 0.9;
    monsterBite(town, a, w, breed);
    const plain = 1 - w.health;
    w.health = 1;
    expect(town.useAbility([w.id])).toBe(1);
    expect(town.combatState.taunts.get(a.id)?.by).toBe(w.id);
    expect(town.combatState.taunts.has(b.id)).toBe(true);
    expect(town.combatState.taunts.has(far.id)).toBe(false);
    expect(town.abilityOf(w)).toMatchObject({ ready: false, remaining: 20, active: true });
    expect(cues(town, CombatCue.Ability)[0]).toMatchObject({ person: w.id, text: 'Challenge', radius: 4, duration: 5 });
    monsterBite(town, a, w, breed);
    expect(1 - w.health).toBeCloseTo(plain / 2, 5);
    expect(town.useAbility([w.id])).toBe(0);
  });
  it('Aimed Shot hits several times as hard', () => {
    const { town } = fixture(),
      r = resident(town, point(15, 15), Calling.Ranger),
      foe = monster(town, point(19, 15));
    const blow = town.blowStrength(r);
    expect(town.useAbility([r.id])).toBe(1);
    expect(foe.health).toBeCloseTo(100 - skillPower.aimed * blow, 4);
    expect(town.abilityOf(r)!.remaining).toBe(12);
  });
  it('Rune Burst lands after a moment on every monster in the circle', () => {
    const { town } = fixture(),
      m = resident(town, point(15, 15), Calling.Mage),
      inside = [monster(town, point(20, 15)), monster(town, point(21, 16))],
      outside = monster(town, point(23.5, 15));
    for (const foe of [...inside, outside]) foe.raider = false;
    town.orderStop([m.id]);
    const blow = town.blowStrength(m);
    expect(town.useAbility([m.id], point(20.5, 15))).toBe(1);
    expect(inside[0].health).toBe(100);
    step(town, 0.9);
    for (const foe of inside) expect(foe.health).toBeCloseTo(100 - skillPower.burst * blow, 3);
    expect(outside.health).toBe(100);
    expect(town.useAbility([m.id], point(20.5, 15))).toBe(0);
  });
  it('Mend heals the most hurt ally, or gets a downed one up at once', () => {
    const { town } = fixture(),
      c = resident(town, point(15, 15), Calling.Cleric),
      hurt = resident(town, point(17, 15)),
      scratched = resident(town, point(16, 15));
    town.setAbilityAuto([c.id], false);
    hurt.health = 0.3;
    scratched.health = 0.8;
    expect(town.useAbility([c.id])).toBe(1);
    expect(hurt.health).toBeCloseTo(0.65, 5);
    expect(cues(town, CombatCue.Heal)[0]).toMatchObject({ person: hurt.id, amount: 35 });
    c.abilityReadyAt = 0;
    town.strikeDown(scratched, 'Killed by monsters');
    expect(town.useAbility([c.id])).toBe(1);
    expect(scratched.downedAt).toBe(-1);
    expect(scratched.health).toBeCloseTo(combatRules.reviveHealth);
  });
  it('Mend fires on its own for a cleric, unless auto-use is turned off', () => {
    const { town } = fixture(),
      c = resident(town, point(15, 15), Calling.Cleric),
      fallen = resident(town, point(17, 15));
    town.orderStop([c.id]);
    town.strikeDown(fallen, 'Killed by monsters');
    town.advance(0.1);
    expect(fallen.downedAt).toBe(-1);
    expect(town.abilityOf(c)!.ready).toBe(false);
    expect(town.setAbilityAuto([c.id], false)).toBe(1);
    expect(town.abilityOf(c)!.auto).toBe(false);
  });
  it('Rallying Verse lifts the blows of allies nearby', () => {
    const { town } = fixture(),
      bard = resident(town, point(15, 15), Calling.Bard),
      ally = resident(town, point(17, 15)),
      before = town.blowStrength(ally);
    expect(town.useAbility([bard.id])).toBe(1);
    expect(town.rallied(ally)).toBe(true);
    expect(town.blowStrength(ally)).toBeCloseTo(before * 1.25, 4);
    expect(town.abilityOf(bard)).toMatchObject({ active: true, remaining: 30 });
  });
});

describe('world boons', () => {
  it('Valor, Lore and Ember strengthen blows, learning and crits', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15)),
      foe = monster(town, point(15.5, 15)),
      blow = town.blowStrength(p);
    grant(town, Boon.Valor);
    expect(town.blowStrength(p)).toBeCloseTo(blow * 1.1, 4);
    grant(town, Boon.Lore);
    town.rewardExperience(p, 20);
    expect(p.experience).toBe(25);
    town.roll = () => 0.15;
    town.strike(p, foe);
    expect(town.hits().at(-1)!.crit).toBeUndefined();
    grant(town, Boon.Ember);
    p.ready = 0;
    town.strike(p, foe);
    expect(town.hits().at(-1)!.crit).toBe(true);
  });
  it('Barrow lets the downed hold on longer and rise stronger', () => {
    const { town } = fixture(),
      p = resident(town, point(15, 15));
    grant(town, Boon.Barrow);
    town.strikeDown(p, 'Killed by monsters');
    expect(town.bleedOutLeft(p)).toBeCloseTo(combatRules.bleedOut * 1.5);
    town.revive(p);
    expect(p.health).toBe(0.5);
  });
  it('Bulwark halves the damage monsters do to buildings', () => {
    const { town } = fixture(),
      hut = new Building(town.nextId++, Structure.Tent, point(30, 30), 0, 0),
      beast = monster(town, point(30, 30));
    hut.village = 0;
    town.placed.push(hut);
    beast.ready = 0;
    town.wreck(beast, 0.1);
    const plain = 1 - hut.health;
    hut.health = 1;
    beast.ready = 0;
    grant(town, Boon.Bulwark);
    town.wreck(beast, 0.1);
    expect(1 - hut.health).toBeCloseTo(plain / 2, 5);
  });
  it('Plenty brings more food home from a hunt', () => {
    const { town } = fixture(),
      hunt = (plenty: boolean) => {
        if (plenty) grant(town, Boon.Plenty);
        const chicken = new Monster(town.nextMonster++, -1, point(20, 20));
        chicken.animal = AnimalKind.Cow;
        chicken.health = 0;
        town.animals.push(chicken);
        const before = town.stock(0).food;
        town.stirWildlife(0.1);
        return town.stock(0).food - before;
      };
    expect(hunt(false)).toBe(animalSpec(AnimalKind.Cow).food);
    expect(hunt(true)).toBe(Math.round(animalSpec(AnimalKind.Cow).food * 1.25));
  });
});

describe('beyond a gate', () => {
  let base: WorldMap;
  beforeAll(() => {
    base = WorldMap.generate(5);
  }, 120000);
  function expedition(callings: Calling[], level: number, floor = 0) {
    const town = new Town(base, 176, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    const gate = town
      .map()
      .dungeons()
      .map((site, index) => ({ site, index }))
      .filter((g) => sealable(g.site))
      .sort((a, b) => distance(lairOf(a.site), camp.center) - distance(lairOf(b.site), camp.center))[0].index;
    town.map().dungeons()[gate].discovered = true;
    town.depth = town.map().dungeons().map((_, index) => (index === gate ? floor : 0));
    const members = callings.map((calling) => {
      const p = town.makePerson(Role.Resident, calling, monsterEntrance(town.map().dungeons()[gate]));
      town.folk.push(p);
      p.level = level;
      p.activity = Activity.Expedition;
      p.inside = true;
      return p;
    });
    town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor });
    town.advance(0.1);
    return { town, gate, members };
  }
  it('ranks the floor: brutes in the larger dens, stalkers deeper down, a guardian in the heart', () => {
    const { town } = expedition([Calling.Warrior, Calling.Ranger], 6),
      foes = town.realmFoes();
    expect(town.chronicle).toMatchObject({ partiesLed: 1, largestParty: 2 });
    for (const foe of foes) expect(foe.vigor).toBe(foe.health);
    expect(foes.find((foe) => foe.id === town.realmGuardian)!.rank).toBe(MonsterRank.Guardian);
    expect(foes.some((foe) => foe.rank === MonsterRank.Brute)).toBe(true);
    const brute = foes.find((foe) => foe.rank === MonsterRank.Brute)!,
      grunt = foes.find((foe) => foe.rank === MonsterRank.Grunt)!;
    expect(brute.health).toBeCloseTo(grunt.health * rankRules.bruteHealth, 3);
    const deeper = expedition([Calling.Warrior], 6, 1).town.realmFoes();
    expect(deeper.some((foe) => foe.rank === MonsterRank.Stalker)).toBe(true);
  }, 120000);
  it('telegraphs the guardian slam, lands it on whoever stays and spares whoever walks out', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Warrior], 20),
      [stay, leave] = members,
      guardian = town.realmFoes().find((foe) => foe.id === town.realmGuardian)!;
    town.beasts = town.beasts.filter((beast) => beast === guardian || !town.inRealm(beast.home));
    town.realmPatrol = [];
    for (const p of members) p.position = town.grid.nearestWalkable(add(guardian.position, point(0.8, 0)));
    guardian.angry = true;
    for (let i = 0; i < 100 && guardian.windupUntil < 0; ++i) town.advance(0.1);
    expect(guardian.windupUntil).toBeGreaterThan(town.clock());
    expect(cues(town, CombatCue.Telegraph).at(-1)).toMatchObject({ creature: guardian.id, radius: rankRules.slamRadius, duration: rankRules.slamWindup });
    const center = cues(town, CombatCue.Telegraph).at(-1)!.position;
    const exits = [point(4, 0), point(-4, 0), point(0, 4), point(0, -4)]
      .map((offset) => add(center, offset))
      .filter((at) => town.grid.walkable(at) && town.grid.clear(leave.position, at, Infinity))
      .sort((a, b) => distance(a, leave.position) - distance(b, leave.position));
    expect(exits.length).toBeGreaterThan(0);
    town.orderMove([leave.id], exits[0]);
    town.orderMove([stay.id], stay.position);
    const before = { stay: stay.health, leave: leave.health };
    const since = town.clock();
    town.advance(1);
    expect(town.hits().filter((hit) => hit.onPerson && hit.at > since)).toHaveLength(0);
    for (let i = 0; i < 30 && guardian.windupUntil >= 0; ++i) town.advance(0.1);
    expect(cues(town, CombatCue.Slam)).toHaveLength(1);
    expect(distance(leave.position, center)).toBeGreaterThan(rankRules.slamRadius);
    expect(leave.health).toBeGreaterThanOrEqual(before.leave);
    expect(stay.health).toBeLessThan(before.stay - 0.05);
  }, 120000);
  it('lets an Aimed Shot break the wind-up, and enrages once below half health', () => {
    const { town, members } = expedition([Calling.Ranger], 20),
      [ranger] = members,
      guardian = town.realmFoes().find((foe) => foe.id === town.realmGuardian)!;
    equip(ranger, 'weapon', 'bow');
    town.beasts = town.beasts.filter((beast) => beast === guardian || !town.inRealm(beast.home));
    town.realmPatrol = [];
    ranger.position = town.grid.nearestWalkable(add(guardian.position, point(1.5, 0)));
    guardian.angry = true;
    town.setAbilityAuto([ranger.id], false);
    for (let i = 0; i < 100 && guardian.windupUntil < 0; ++i) town.advance(0.1);
    expect(guardian.windupUntil).toBeGreaterThan(0);
    expect(town.useAbility([ranger.id])).toBe(1);
    expect(guardian.windupUntil).toBe(-1);
    town.advance(2.5);
    expect(cues(town, CombatCue.Slam)).toHaveLength(0);
    guardian.health = town.guardianVigor() * 0.4;
    town.advance(0.2);
    town.advance(0.2);
    expect(cues(town, CombatCue.Enrage)).toHaveLength(1);
    const brood = town.realmFoes().filter((foe) => foe !== guardian);
    expect(brood.length).toBeGreaterThan(0);
    for (const foe of brood) expect(foe.vigor).toBeGreaterThan(0);
  }, 120000);
  it('casts the party out gravely wounded when the last one falls, and the spoils are lost', () => {
    const { town, gate, members } = expedition([Calling.Settler, Calling.Settler], 1);
    town.realmLoot.gold = 50;
    for (const p of members) town.strikeDown(p, 'Killed by monsters');
    town.advance(0.1);
    expect(town.realmActive()).toBe(false);
    for (const p of members) {
      expect(p).toMatchObject({ downedAt: -1, woundDays: 4 });
      expect(p.health).toBeCloseTo(0.1, 1);
      expect(town.inRealm(p.position)).toBe(false);
      expect(distance(p.position, monsterEntrance(town.map().dungeons()[gate]))).toBeLessThan(4);
    }
    expect(town.stock(0).gold).toBe(0);
    expect(town.notices.some((text) => text.includes('casts the fallen party back out'))).toBe(true);
    expect(town.fallen).toHaveLength(0);
  }, 120000);
  it('leaves behind the downed nobody stands beside, and warns before it does', () => {
    const { town, gate, members } = expedition([Calling.Warrior, Calling.Warrior, Calling.Warrior], 5),
      [walker, carried, lost] = members,
      plan = town.realmPlan()!;
    walker.position = { ...plan.entry };
    carried.position = town.grid.nearestWalkable(add(plan.entry, point(1, 0)));
    lost.position = { ...plan.chambers.at(-1)!.center };
    town.strikeDown(carried, 'Killed by monsters');
    town.strikeDown(lost, 'Killed by monsters');
    expect(town.realmLeftBehind()).toEqual([lost]);
    const leave = town.canLeaveRealm();
    expect(leave.ok).toBe(true);
    expect(leave.reason).toContain(`${lost.name} would be left behind to die`);
    expect(town.leaveRealm()).toBe(true);
    const world = worldName(town.map().destination(town.map().dungeons()[gate]));
    expect(town.fallen.map((record) => [record.id, record.place])).toEqual([[lost.id, world]]);
    expect(carried.downedAt).toBeGreaterThanOrEqual(0);
    expect(carried.activity).toBe(Activity.Downed);
    expect(town.inRealm(carried.position)).toBe(false);
    town.advance(0.1);
    expect(town.person(lost.id)).toBeNull();
  }, 120000);
  it('keeps the patrol and the brood call across a save', () => {
    const { town } = expedition([Calling.Warrior, Calling.Warrior], 10);
    expect(town.realmPatrol.length).toBeGreaterThan(0);
    town.realmBroodCalled = true;
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 176, false, true));
    expect(loaded.realmPatrol).toEqual(town.realmPatrol);
    expect(loaded.realmPatrolAt).toBe(town.realmPatrolAt);
    expect(loaded.realmBroodCalled).toBe(true);
    const homes = () =>
      loaded.realmPatrol.map((id) => loaded.monsters().find((beast) => beast.id === id)?.home).filter(Boolean);
    expect(homes()).toHaveLength(loaded.realmPatrol.length);
    loaded.time = loaded.realmPatrolAt;
    for (let i = 0; i < 5; ++i) loaded.advance(0.1);
    expect(loaded.realmPatrolAt).toBeGreaterThan(town.realmPatrolAt);
    expect(loaded.realmActive()).toBe(true);
  }, 120000);
});
