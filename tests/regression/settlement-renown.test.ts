import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CampEconomy } from '../../packages/engine/src/camp-economy';
import { Town } from '../../packages/engine/src/town';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import type { WorldMap } from '../../packages/engine/src/world-map';
const factory = (map: WorldMap) => new Town(map, 32, false, true);
function addCamp(town: Town, faction = 0) {
  const camp = new Building(town.nextId++, Structure.Camp, point(12 + town.nextId * 4, 12), 0, 0);
  camp.faction = faction;
  camp.village = camp.id;
  town.placed.push(camp);
  town.foundSettlement(camp.id);
  return camp;
}
describe('new settlement renown', () => {
  it('starts provisions, the first Camp, later Camps and neutral Camps at zero', () => {
    expect(new CampEconomy().renown).toBe(0);
    const town = new Town(5, 32, false);
    expect(town.renown()).toBe(0);
    const first = addCamp(town);
    expect(town.renown(first.id)).toBe(0);
    town.changeRenown(first.id, 17);
    const second = addCamp(town),
      neutral = addCamp(town, 2);
    expect(town.renown(second.id)).toBe(0);
    expect(town.renown(neutral.id)).toBe(0);
    expect(town.renown(first.id)).toBe(17);
  });
  it('preserves each saved Camp renown without imposing the new default on load', () => {
    const town = new Town(5, 32, false),
      first = addCamp(town),
      second = addCamp(town);
    town.economy(first.id).renown = 37.25;
    town.economy(second.id).renown = 81.5;
    town.provisions.renown = 3.75;
    const encoded = encodeTown(town),
      loaded = decodeTown(encoded, factory);
    expect(loaded.economy(first.id).renown).toBe(37.25);
    expect(loaded.economy(second.id).renown).toBe(81.5);
    expect(loaded.provisions.renown).toBe(3.75);
    expect(encodeTown(loaded)).toBe(encoded);
  });
  it('round-trips an original native archive including its explicit historical renown', () => {
    const original = gunzipSync(
      readFileSync(new URL('./fixtures/native-v7.goldfantasy.gz', import.meta.url)),
    ).toString();
    const town = decodeTown(original, factory);
    expect(town.renown()).toBeGreaterThan(0);
    expect(encodeTown(town)).toBe(original);
  });
});
