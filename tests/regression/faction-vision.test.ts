import { expect, it } from 'vitest';
import { updateVision } from '../../packages/native-renderer/src/world-vision';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { Person, Calling, Race, Role } from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { point } from '../../packages/engine/src/geometry';
import { WorldMap } from '../../packages/engine/src/world-map';
import type { Town } from '../../packages/engine/src/town';
it('neutral residents, camps and torches do not reveal player fog, while player sight can still reveal them', () => {
  const state = new WorldRendererState(),
    map = new WorldMap();
  map.columns = map.rows = 100;
  const player = new Person(0, 'Player', Role.Resident, Calling.Settler, Race.Human, 5, point(10, 10));
  const neutral = new Person(1, 'Neutral', Role.Resident, Calling.Settler, Race.Human, 7, point(80, 80));
  neutral.faction = 1;
  const camp = new Building(1, Structure.Camp, point(80, 80), 0, 0);
  const torch = new Building(2, Structure.Torch, point(84, 80), 0, 0);
  for (const b of [camp, torch]) {
    b.progress = 1;
    b.faction = 1;
  }
  const town = {
    map: () => map,
    people: () => [player, neutral],
    buildings: () => [camp, torch],
    climate: () => ({ night: 1 }),
  } as unknown as Town;
  updateVision(state, town);
  expect(state.vision).toHaveLength(1);
  expect(state.currentVisibility.sample(neutral.position)).toBe(0);
  expect(state.exploredVisibility.sample(neutral.position)).toBe(0);
  player.position = point(81, 80);
  updateVision(state, town);
  expect(state.currentVisibility.sample(neutral.position)).toBeGreaterThan(119);
  expect(state.vision).toHaveLength(1);
});
