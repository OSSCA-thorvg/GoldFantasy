import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import type { WorldMap } from '../../packages/engine/src/world-map';
import { Product } from '../../packages/engine/src/building-catalog';
import { Activity } from '../../packages/engine/src/person';
import { prepareBuildingRepair, repairMaterialCost } from '../../packages/engine/src/building-repair';

const original = gunzipSync(
  readFileSync(new URL('./fixtures/native-v7.goldfantasy.gz', import.meta.url)),
).toString();
const factory = (map: WorldMap) => new Town(map, 32, false, true);
describe('new simulation state save compatibility', () => {
  it('round trips an actual historical v7 archive byte for byte with safe new defaults', () => {
    const town = decodeTown(original, factory);
    expect(town.people()[0].hydration).toBe(1);
    expect(town.people()[0].attackPerson).toBe(-1);
    expect(town.people()[0].workField).toBe(-1);
    expect(town.stock().planks).toBe(0);
    expect(town.monsters()[0].strength).toBe(1);
    expect(encodeTown(town)).toBe(original);
  });
  it('upgrades and preserves personal hydration, hunting, person targets and weekly strength', () => {
    const town = decodeTown(original, factory),
      person = town.folk[0];
    person.hydration = 0.4;
    person.hunting = true;
    person.attackPerson = 7;
    person.workField = 42;
    town.beasts[0].strength = 1.4;
    town.stock().planks = 8;
    town.stock().cutStone = 6;
    town.placed[0].repairCredit = 0.125;
    const encoded = encodeTown(town),
      loaded = decodeTown(encoded, factory);
    expect(loaded.people()[0].hydration).toBeCloseTo(0.4);
    expect(loaded.people()[0].hunting).toBe(true);
    expect(loaded.people()[0].attackPerson).toBe(7);
    expect(loaded.people()[0].workField).toBe(42);
    expect(loaded.monsters()[0].strength).toBeCloseTo(1.4);
    expect(loaded.stock().planks).toBe(8);
    expect(loaded.stock().cutStone).toBe(6);
    expect(loaded.placed[0].repairCredit).toBe(0.125);
    expect(encodeTown(loaded)).toBe(encoded);
  });
  it('uses v9 for refined cargo even after its source workshop and stock are gone', () => {
    const town = decodeTown(original, factory),
      person = town.folk[0];
    person.carriedProduct = Product.Planks;
    person.carrying = 2;
    const encoded = encodeTown(town);
    expect(Buffer.from(encoded.slice(17), 'hex').readUInt32LE(0)).toBe(9);
    const loaded = decodeTown(encoded, factory);
    expect(loaded.people()[0].carriedProduct).toBe(Product.Planks);
    expect(loaded.people()[0].carrying).toBe(2);
  });
  it('preserves a pending prepaid repair batch without requesting its materials twice', () => {
    const town = decodeTown(original, factory);
    town.placed[0].repairPending = true;
    town.placed[0].repairCredit = 0;
    town.placed[0].health = 0.5;
    const fee = repairMaterialCost(town.placed[0].kind);
    town.placed[0].materials.required.add(fee);
    town.placed[0].materials.delivered.add(fee);
    town.folk[0].carrying = 0;
    const encoded = encodeTown(town);
    expect(Buffer.from(encoded.slice(17), 'hex').readUInt32LE(0)).toBe(9);
    const loaded = decodeTown(encoded, factory);
    expect(loaded.placed[0].repairPending).toBe(true);
    expect(loaded.placed[0].repairCredit).toBe(0);
    expect(encodeTown(loaded)).toBe(encoded);
    const required = loaded.placed[0].materials.required.clone(),
      stock = loaded.stock().clone();
    expect(prepareBuildingRepair(loaded, loaded.folk[0], loaded.placed[0])).toBe(false);
    expect(loaded.placed[0].repairCredit).toBe(0.25);
    expect(loaded.placed[0].materials.required).toEqual(required);
    expect(loaded.stock()).toEqual(stock);
  });
  it('recovers the old completed-construction stall while preserving an explicit Stop', () => {
    const town = decodeTown(original, factory),
      person = town.folk[0],
      site = town.placed[0];
    site.progress = site.health = 1;
    person.autoMode = person.ordered = false;
    person.task = Activity.Building;
    person.taskSite = site.id;
    const saved = encodeTown(town);
    expect(Buffer.from(saved.slice(17), 'hex').readUInt32LE(0)).toBe(7);
    expect(decodeTown(saved, factory).folk[0].autoMode).toBe(true);
    person.task = Activity.Idle;
    person.taskSite = -1;
    expect(decodeTown(encodeTown(town), factory).folk[0].autoMode).toBe(false);
  });
});
