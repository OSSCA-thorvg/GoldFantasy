import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Monster, Role, activityName } from '../../packages/engine/src/person';
import { CombatCue, MonsterRank, combatRules } from '../../packages/engine/src/combat-events';
import { Boon, boon, boonOfWorld, boonsHeld } from '../../packages/engine/src/gate-boons';
import { sealFloors, sealable } from '../../packages/engine/src/gate-seals';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';

function settlement() {
  const town = new Town(5, 32, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  return town;
}

describe('shared combat contract', () => {
  it('lists combat cues with a serial and drops them after their time', () => {
    const town = settlement();
    town.emit(CombatCue.Crit, { x: 3, y: 4 }, { person: 7, amount: 24 });
    town.emit(CombatCue.Telegraph, { x: 5, y: 5 }, { creature: 2, radius: 2.2, duration: 1.6 });
    const [crit, wind] = town.combatEvents();
    expect(crit).toMatchObject({ serial: 0n, cue: CombatCue.Crit, person: 7, creature: -1, amount: 24, at: town.clock() });
    expect(wind).toMatchObject({ serial: 1n, radius: 2.2, duration: 1.6, text: '' });
    town.time += combatRules.eventSeconds + 0.1;
    town.stir(0.1);
    expect(town.combatEvents()).toHaveLength(0);
    town.emit(CombatCue.Kill, { x: 1, y: 1 });
    expect(town.combatEvents()[0].serial).toBe(2n);
  });
  it('names the new activities', () => {
    expect(activityName(Activity.Downed)).toBe('Downed');
    expect(activityName(Activity.Tending)).toBe('Tending the fallen');
  });
  it('saves and restores the combat record', () => {
    const town = settlement(),
      p = town.makePerson(Role.Resident, Calling.Warrior, town.map().camp());
    town.folk.push(p);
    p.downedAt = 12.5;
    p.kills = 3;
    p.abilityReadyAt = 40;
    p.abilityUntil = 20;
    p.abilityAuto = 1;
    p.woundDays = 2;
    const lair = town.map().dungeons().findIndex(sealable),
      beast = new Monster(town.nextMonster++, lair, { x: 4, y: 4 });
    beast.rank = MonsterRank.Brute;
    beast.vigor = 30;
    beast.windupUntil = 99;
    town.beasts.push(beast);
    town.chronicle.raidsRepelled = 2;
    town.chronicle.largestParty = 4;
    town.wardUntil = 500;
    town.fallen.push({
      id: 9,
      name: 'Embla',
      past: 'Woke under the arm',
      look: 12345,
      calling: Calling.Ranger,
      race: 0,
      level: 4,
      days: 11,
      kills: 6,
      cause: 'a guardian',
      place: 'Jotunheim',
      day: 14,
      at: 1234.5,
      position: { x: 3, y: 7 },
    });
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true)),
      q = loaded.people()[0],
      m = loaded.monsters()[0];
    expect(q).toMatchObject({ downedAt: 12.5, kills: 3, abilityReadyAt: 40, abilityUntil: 20, abilityAuto: 1, woundDays: 2 });
    expect(m).toMatchObject({ rank: MonsterRank.Brute, vigor: 30, windupUntil: 99 });
    expect(loaded.chronicle).toMatchObject({ raidsRepelled: 2, largestParty: 4, rescues: 0 });
    expect(loaded.wardUntil).toBe(500);
    expect(loaded.fallen).toEqual(town.fallen);
  });
  it('keeps a town without any combat record readable as before', () => {
    const town = settlement(),
      loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true));
    expect(loaded.fallen).toEqual([]);
    expect(loaded.chronicle.raidsRepelled).toBe(0);
  });
  it('grants a world boon once a gate to that world is sealed', () => {
    const town = settlement(),
      gate = town.map().dungeons().findIndex(sealable),
      world = town.map().destination(town.map().dungeons()[gate]);
    expect(boonsHeld(town)).toEqual([]);
    town.depth = town.map().dungeons().map((_, index) => (index === gate ? sealFloors : 0));
    expect(boon(town, boonOfWorld(world))).toBe(true);
    expect(boonsHeld(town)).toEqual([boonOfWorld(world)]);
    expect(boon(town, boonOfWorld(world) === Boon.Valor ? Boon.Plenty : Boon.Valor)).toBe(false);
  });
});
