import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { SceneNode } from '../../packages/native-renderer/src/paint';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import type { PersonParts } from '../../packages/native-renderer/src/world-sprites';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Structure } from '../../packages/engine/src/building-catalog';
import { itemSpec } from '../../packages/engine/src/equipment';
import { point } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import type { Town } from '../../packages/engine/src/town';

let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class {});
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

const states: WorldRendererState[] = [];
afterAll(() => {
  for (const state of states) state.adapter.dispose();
});
interface Order {
  item: string;
  /** Share of the item's making already done. */
  done?: number;
  tool?: string;
  /** Standing a pace aside for a busy station rather than working it. */
  waiting?: boolean;
  time?: number;
}
/** A resident at a station to the left of where they stand, drawn by the world renderer. */
function crafter(order: Order | null): { parts: PersonParts; facing: number; person: Person } {
  const state = new WorldRendererState(tvg);
  states.push(state);
  state.rows = Array.from({ length: 64 }, () => new SceneNode());
  state.currentVisibility.sample = () => 255;
  const person = new Person(7, 'Maker', Role.Resident, Calling.Settler, Race.Human, 499096, point(10, 10)),
    bench = { id: 1, kind: Structure.Workbench, center: point(8.8, 10.4) },
    time = order?.time ?? 0;
  if (order) {
    if (order.tool) {
      person.inventory[0] = { item: order.tool, quantity: 1 };
      person.equipment.tool1 = 1;
    }
    person.task = Activity.Crafting;
    person.activity = order.waiting ? Activity.Holding : Activity.Crafting;
    person.craftItem = order.item;
    person.craftWorkshop = person.target = bench.id;
    person.craftProgress = itemSpec(order.item)!.seconds * (order.done ?? 0.2);
  }
  const town = {
    people: () => [person],
    buildings: () => [],
    building: (id: number) => (id === bench.id ? bench : null),
    monsters: () => [],
    wildlife: () => [],
    hits: () => [],
    clock: () => time,
    map: () => ({
      giant: () => null,
      volcano: () => null,
      width: () => 32,
      seed: () => 5,
      inside: () => true,
      at: () => ({ trees: 0 }),
    }),
  } as unknown as Town;
  moveAgents(state, town, new Traffic(5), time, []);
  const figure = state.figures.get(person.id)!;
  return { parts: figure.parts, facing: figure.facing, person };
}
const shown = (parts: PersonParts): string[] =>
  (['knife', 'hammer', 'sword', 'axe', 'mace', 'spear'] as const).filter(
    (tool) => parts[tool]?.alpha === 255,
  );
const material = (parts: PersonParts, tool: 'sword' | 'axe' | 'knife' | 'hammer'): string[] =>
  Object.entries(parts.toolHeads[tool] ?? {})
    .filter(([, head]) => head.alpha === 255)
    .map(([name]) => name);

describe('making an item at a station', () => {
  it('pares wood with the bench’s flint knife', () => {
    const { parts } = crafter({ item: 'wooden-sword' });
    expect(shown(parts)).toEqual(['knife']);
    expect(material(parts, 'knife')).toEqual(['stone']);
    // Bent over the work, both hands at the bench.
    expect(parts.nod).toBeGreaterThan(0.1);
    expect(parts.arms[0].turn.upper).toBeLessThan(-0.5);
  });
  it('beats stone and iron into shape with the crafter’s own hammer', () => {
    for (const item of ['stone-axe', 'sword']) {
      const { parts } = crafter({ item, tool: 'wooden-mallet' });
      expect(shown(parts)).toEqual(['hammer']);
      expect(material(parts, 'hammer')).toEqual(['wood']);
    }
  });
  it('never mimes a hammer that is not there', () => {
    const { parts } = crafter({ item: 'sword' });
    expect(shown(parts)).toEqual([]);
    expect(parts.nod).toBeGreaterThan(0.1);
  });
  it('holds the finished piece up as the making ends', () => {
    const before = crafter({ item: 'wooden-sword', done: 0.5 }),
      after = crafter({ item: 'wooden-sword', done: 0.93 }),
      stone = crafter({ item: 'stone-axe', tool: 'wooden-mallet', done: 0.99 });
    expect(shown(after.parts)).toEqual(['sword']);
    expect(material(after.parts, 'sword')).toEqual(['wood']);
    // The arm goes up past the shoulder and the head tips back to look.
    expect(after.parts.arms[1].turn.upper).toBeLessThan(before.parts.arms[1].turn.upper - 0.8);
    expect(after.parts.arms[1].turn.upper).toBeLessThan(-1.5);
    expect(after.parts.nod).toBeLessThan(-0.05);
    expect(shown(stone.parts)).toEqual(['axe']);
    expect(material(stone.parts, 'axe')).toEqual(['stone']);
  });
  it('keeps at the work to the end when the piece is not one for the hand', () => {
    const { parts } = crafter({ item: 'pack-basket', done: 0.99 });
    expect(shown(parts)).toEqual(['knife']);
    expect(parts.nod).toBeGreaterThan(0.1);
  });
  it('keeps both feet on the ground through every stroke and the lift', () => {
    for (const order of [
      { item: 'wooden-sword' },
      { item: 'stone-axe', tool: 'wooden-mallet' },
      { item: 'wooden-sword', done: 0.95 },
    ])
      for (let i = 0; i < 12; i++) {
        const { parts } = crafter({ ...order, time: i / 11 });
        expect(parts.body!.matrix[5]).toBe(0);
        expect(parts.feet.map((foot) => foot!.matrix[5])).toEqual([0, 0]);
        expect(parts.body!.matrix[4]).toBeGreaterThanOrEqual(0.95);
      }
  });
  it('faces the station while working it and while waiting a turn', () => {
    expect(crafter({ item: 'wooden-sword' }).facing).toBe(-1);
    const waiting = crafter({ item: 'wooden-sword', waiting: true });
    expect(waiting.facing).toBe(-1);
    // Waiting is only standing by: nothing is taken up.
    expect(shown(waiting.parts)).toEqual([]);
    expect(crafter(null).facing).toBe(1);
  });
});
