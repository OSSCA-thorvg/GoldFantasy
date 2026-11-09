import { describe, expect, it } from 'vitest';
import { dungeonThreat } from '../../packages/engine/src/raid-progression';
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
    expect(dungeonThreat(14, point(), [keep]).health).toBeGreaterThan(
      dungeonThreat(14, point(), [camp]).health,
    );
  });
  it('keeps swarm size bounded while continuing weekly strength progression', () => {
    const castle = new Building(0, Structure.Castle, point(), 0, 0);
    expect(dungeonThreat(700, point(), [castle]).count).toBe(12);
    expect(dungeonThreat(707, point(), [castle]).health).toBeGreaterThan(
      dungeonThreat(700, point(), [castle]).health,
    );
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
    town.summonRaid();
    const opening = town.monsters().length,
      health = town.monsters()[0].health;
    town.beasts = [];
    town.days = 7;
    town.summonRaid();
    expect(town.monsters()).toHaveLength(opening + 1);
    expect(town.monsters()[0].health).toBeGreaterThan(health);
    expect(town.monsters()[0].strength).toBeCloseTo(1.08);
    expect(town.monsters()[0].health).toBeCloseTo(breedOf(lair.kind).health * 1.18);
  });
});
