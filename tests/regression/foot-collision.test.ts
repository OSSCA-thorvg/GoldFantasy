import { expect, it } from 'vitest';
import { Footprint, point } from '../../packages/engine/src/geometry';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { TownState } from '../../packages/engine/src/town-state';
import { WorldMap } from '../../packages/engine/src/world-map';
import { separatePeople } from '../../packages/engine/src/person-navigation';
import {
  footBounds,
  footBlockedBy,
  footBoxesOverlap,
  footSegmentBlockedBy,
} from '../../packages/engine/src/person-collision';

it('uses a small foot rectangle instead of body-size personal space', () => {
  const town = new TownState(new WorldMap()),
    walker = new Person(0, 'Walker', Role.Resident, Calling.Settler, Race.Human, 0, point(10, 10)),
    worker = new Person(1, 'Worker', Role.Resident, Calling.Settler, Race.Human, 0, point(10, 10.8));
  walker.path = [point(10, 14)];
  walker.activity = Activity.Moving;
  worker.activity = Activity.Building;
  worker.ordered = true;
  town.folk = [walker, worker];
  town.grid.walkable = () => true;
  town.grid.clear = () => true;
  const before = { ...walker.position };
  expect(footBoxesOverlap(walker.position, worker.position)).toBe(false);
  separatePeople(town, 0.1);
  expect(walker.position).toEqual(before);
});

it('allows an adjacent foot box while rejecting a foot that intersects a wall', () => {
  const wall = new Footprint(point(5, 5), 1, 0),
    edge = 6 + footBounds.halfX;
  expect(footBlockedBy(point(edge, 5), wall)).toBe(false);
  expect(footBlockedBy(point(edge - 0.01, 5), wall)).toBe(true);
  expect(footSegmentBlockedBy(point(edge, 3), point(edge, 7), wall)).toBe(false);
  expect(footSegmentBlockedBy(point(edge - 0.01, 3), point(edge - 0.01, 7), wall)).toBe(true);
});

it('checks rotated walls and the entire sweep, including endpoints and reverse travel', () => {
  const wall = new Footprint(point(5, 5), 1, Math.PI / 4);
  for (const [a, b] of [
    [point(3, 5), point(7, 5)],
    [point(5, 5), point(8, 8)],
  ]) {
    expect(footSegmentBlockedBy(a, b, wall)).toBe(true);
    expect(footSegmentBlockedBy(b, a, wall)).toBe(true);
  }
  expect(footBlockedBy(point(6.5, 6.5), wall)).toBe(false);
  expect(footSegmentBlockedBy(point(3, 7), point(7, 7), wall)).toBe(false);
});
