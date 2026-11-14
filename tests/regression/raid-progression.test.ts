import { describe, expect, it } from 'vitest';
import { dungeonThreat, pressureNotice, raidMuster, RaidKind, seatVolley, threatWeeks } from '../../packages/engine/src/raid-progression';
import { MonsterRank } from '../../packages/engine/src/combat-events';
import { rankRules } from '../../packages/engine/src/monster-ranks';
import { Calling, Monster, Role } from '../../packages/engine/src/person';
import { monsterBite } from '../../packages/engine/src/town-monsters';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { Town } from '../../packages/engine/src/town';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { breedOf } from '../../packages/engine/src/town-monsters';

describe('weekly dungeon pressure', () => {
  it('holds pressure within the week and raises numbers and strength at the next week', () => {
    const camp = new Building(0, Structure.Camp, point(3, 3), 0, 0);
    const opening = dungeonThreat(0, point(), [camp]);
    expect(dungeonThreat(6, point(), [camp])).toEqual(opening);
    const next = dungeonThreat(7, point(), [camp]);
    expect(next.count).toBeGreaterThan(opening.count);
    expect(next.health).toBeGreaterThan(opening.health);
    expect(next.damage).toBeGreaterThan(opening.damage);
    expect(dungeonThreat(13, point(), [camp])).toEqual(next);
  });
  it('uses the nearby completed camp rather than a far castle or unfinished keep', () => {
    const camp = new Building(0, Structure.Camp, point(2, 2), 0, 0);
    const castle = new Building(1, Structure.Castle, point(100, 100), 0, 0);
    const keep = new Building(2, Structure.Keep, point(1, 1), 0, 0);
    keep.progress = 0.8;
    expect(dungeonThreat(14, point(), [castle, camp, keep]).tier).toBe(0);
    expect(dungeonThreat(14, point(), [castle]).tier).toBe(0);
    keep.progress = 1;
    expect(dungeonThreat(14, point(), [castle, camp, keep]).tier).toBe(2);
    // Fortifying the seat must never make the raids themselves worse.
    expect({ ...dungeonThreat(14, point(), [keep]), tier: 0 }).toEqual(dungeonThreat(14, point(), [camp]));
  });
  it('bounds both swarm size and strength, and says so each week', () => {
    const castle = new Building(0, Structure.Castle, point(), 0, 0),
      cap = dungeonThreat(threatWeeks * 7, point(), [castle]);
    expect(dungeonThreat(700, point(), [castle]).count).toBe(12);
    expect(dungeonThreat(700, point(), [castle])).toEqual({ ...cap, week: 100 });
    expect(cap.health).toBeGreaterThan(dungeonThreat(threatWeeks * 7 - 1, point(), [castle]).health);
    expect(pressureNotice(2)).toBe('Week 2: raiders grow stronger. Seal a gate to end its raids.');
    expect(pressureNotice(threatWeeks)).toContain('full strength');
    expect(pressureNotice(threatWeeks + 1)).toBe('');
  });
  it('announces the weekly pressure only while a discovered gate is open', () => {
    const town = new Town(5, 32, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.foundSettlement(0);
    for (const site of town.map().dungeons()) site.discovered = false;
    town.days = 6;
    town.notices = [];
    town.newDay();
    expect(town.notices.some((text) => text.startsWith('Week 1:'))).toBe(false);
    town.map().dungeons().find((d) => d.kind !== DungeonKind.GiantHall)!.discovered = true;
    town.days = 13;
    town.newDay();
    expect(town.notices.some((text) => text.startsWith('Week 2:'))).toBe(true);
  });
  it('lets a fortified seat shoot hard enough to matter', () => {
    const town = new Town(5, 32, false),
      seat = new Building(0, Structure.Keep, town.map().camp(), 0, 0);
    seat.village = 0;
    town.placed.push(seat);
    town.foundSettlement(0);
    const lair = town.map().dungeons().findIndex((d) => d.kind !== DungeonKind.GiantHall),
      beast = new Monster(town.nextMonster++, lair, { x: seat.center.x + 3, y: seat.center.y });
    beast.raider = true;
    beast.health = breedOf(town.map().dungeons()[lair].kind).health;
    town.beasts.push(beast);
    const before = beast.health;
    town.stir(0.1);
    expect(before - beast.health).toBeCloseTo(seatVolley.damagePerTier * 2);
    for (let t = 0; t < 12 && beast.health > 0; t += 0.1) {
      town.time += 0.1;
      town.stir(0.1);
    }
    expect(beast.health).toBeLessThanOrEqual(0);
  });
  it('gives clerics a ward and bards a song that help the fighters around them', () => {
    const town = new Town(5, 32, false),
      at = town.map().camp(),
      lair = town.map().dungeons().findIndex((d) => d.kind !== DungeonKind.GiantHall),
      breed = breedOf(town.map().dungeons()[lair].kind),
      fighter = town.makePerson(Role.Resident, Calling.Warrior, at),
      friend = town.makePerson(Role.Resident, Calling.Settler, { x: at.x + 2, y: at.y });
    town.folk.push(fighter, friend);
    const bite = () => {
        fighter.health = 1;
        monsterBite(town, new Monster(99, lair, at), fighter, breed);
        return 1 - fighter.health;
      },
      blow = () => {
        const foe = new Monster(98, lair, at);
        foe.health = 100;
        town.strike(fighter, foe);
        return 100 - foe.health;
      },
      plainBite = bite(),
      plainBlow = blow();
    friend.calling = Calling.Cleric;
    expect(bite()).toBeCloseTo(plainBite * 0.8);
    expect(blow()).toBeCloseTo(plainBlow);
    friend.calling = Calling.Bard;
    expect(bite()).toBeCloseTo(plainBite);
    expect(blow()).toBeCloseTo(plainBlow * 1.15);
    friend.position = { x: at.x + 9, y: at.y };
    expect(blow()).toBeCloseTo(plainBlow);
    fighter.calling = Calling.Bard;
    expect(blow()).toBeCloseTo(plainBlow / 1.3);
  });
  it('applies the weekly increase to actual spawned dungeon raiders', () => {
    const town = new Town(5, 32, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.foundSettlement(0);
    const lair = town
      .map()
      .dungeons()
      .find((d) => d.kind !== DungeonKind.GiantHall)!;
    lair.discovered = true;
    town.days = 6;
    town.summonRaid(RaidKind.Pack);
    const opening = town.monsters().length,
      health = town.monsters()[0].health;
    town.beasts = [];
    town.days = 7;
    town.summonRaid(RaidKind.Pack);
    expect(town.monsters().length).toBeGreaterThanOrEqual(opening);
    expect(town.monsters()[0].health).toBeGreaterThan(health);
    // An empty camp only draws a probe of swarmers: they too grow with the week.
    const swarmer = town.monsters()[0];
    expect(swarmer.rank).toBe(MonsterRank.Swarmer);
    expect(swarmer.strength).toBeCloseTo(1.08 * rankRules.swarmerStrength * raidMuster.swarmBite, 4);
    expect(swarmer.health).toBeCloseTo(breedOf(lair.kind).health * 1.18 * rankRules.swarmerHealth, 3);
  });
});
