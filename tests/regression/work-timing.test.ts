import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import {
  Person,
  Role,
  Calling,
  Race,
  Activity,
  TreeWorkKind,
  type TreeWorkEvent,
} from '../../packages/engine/src/person';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Terrain } from '../../packages/engine/src/world-types';
import { point } from '../../packages/engine/src/geometry';
import { hammerTiming, harvestDuration, workElapsed } from '../../packages/engine/src/work-timing';

function fixture() {
  const town = new Town(5, 32, false);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      Object.assign(town.map().at(x, y), { terrain: Terrain.Grass, trees: 0, wild: 0, revealed: true });
  const home = new Building(0, Structure.Camp, point(12, 12), 0, 0);
  home.village = 0;
  town.placed.push(home);
  town.nextId = 1;
  town.foundSettlement(0);
  const p = new Person(0, 'Worker', Role.Resident, Calling.Settler, Race.Human, 0, point(18, 18));
  p.home = p.village = 0;
  p.food = p.rest = p.health = 1;
  town.folk.push(p);
  town.nextPerson = 1;
  town.titleAutoplay = true;
  town.changes++;
  town.tick(0);
  return { town, p };
}
function harvest(step: number, equipped = true) {
  const { town, p } = fixture();
  if (equipped) { p.inventory[0] = { item: 'axe', quantity: 1 }; p.equipment.tool1 = 1; }
  town.map().at(20, 20).trees = 1;
  expect(town.orderChop([p.id], 20 * 32 + 20)).toBe(true);
  for (let i = 0; i < 1000 && (p.moving() || p.until > town.clock() + 100); i++) town.advance(step);
  expect(p.activity).toBe(Activity.Felling);
  const started = p.until - harvestDuration(p),
    events: TreeWorkEvent[] = [];
  let heard = 0n;
  for (let i = 0; i < 1000 && !events.some((e) => e.kind === TreeWorkKind.Fall); i++) {
    town.advance(step);
    for (const event of town.treeEvents())
      if (event.serial >= heard) {
        heard = event.serial + 1n;
        events.push(event);
      }
  }
  return { events: events.map((e) => ({ ...e, at: e.at - started })), p };
}

describe('work contacts use one simulation timeline', () => {
  for (const step of [0.1, 0.037])
    it(`ends the six-second harvest on the final axe contact, step ${step}`, () => {
      const { events, p } = harvest(step),
        chops = events.filter((e) => e.kind === TreeWorkKind.Chop),
        fall = events.find((e) => e.kind === TreeWorkKind.Fall)!;
      expect(chops.map((e) => Number(e.at.toFixed(6)))).toEqual([0.6, 1.5, 2.4, 3.3, 4.2, 5.1, 6]);
      expect(fall.at).toBeCloseTo(6, 8);
      expect(chops.at(-1)!.at).toBeCloseTo(fall.at, 8);
      expect(p.carrying).toBe(3);
    });
  it('keeps barehand contacts on the same timeline until the slower fifteen-second harvest completes', () => {
    const { events, p } = harvest(.1, false),
      contacts = events.filter(e => e.kind === TreeWorkKind.Chop),
      fall = events.find(e => e.kind === TreeWorkKind.Fall)!;
    expect(contacts.map(e => Number(e.at.toFixed(6)))).toEqual(Array.from({length: 17}, (_,i) => Number((.6 + i * .9).toFixed(6))));
    expect(fall.at).toBeCloseTo(15,8);expect(contacts.at(-1)!.at).toBeCloseTo(fall.at,8);expect(p.carrying).toBe(3);
  });
  it('emits hammer contacts only while a worker actually advances construction', () => {
    const { town, p } = fixture(),
      site = new Building(town.nextId++, Structure.Storehouse, point(20, 18), 0, 0);
    site.progress = 0;
    site.village = 0;
    town.placed.push(site);
    town.changes++;
    expect(town.orderBuild([p.id], site.id)).toBe(true);
    const events: TreeWorkEvent[] = [];
    let heard = 0n;
    for (let i = 0; i < 80; i++) {
      town.advance(0.1);
      for (const event of town.treeEvents())
        if (event.serial >= heard) {
          heard = event.serial + 1n;
          events.push(event);
        }
    }
    const strikes = events.filter((e) => e.kind === TreeWorkKind.Hammer);
    expect(strikes.length).toBeGreaterThan(2);
    for (const strike of strikes) {
      const phase = (workElapsed(strike.at, p.id) - hammerTiming.impact) / hammerTiming.period;
      expect(phase).toBeCloseTo(Math.round(phase), 8);
    }
    expect(site.progress).toBeGreaterThan(0);
    town.orderMove([p.id], point(25, 18));
    const serial = town.nextTreeEvent;
    town.advance(0.5);
    expect(town.treeEvents().filter((e) => e.serial >= serial && e.kind === TreeWorkKind.Hammer)).toEqual([]);
  });
});
