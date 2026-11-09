import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import {
  SceneNode,
  ShapeNode,
  AnimationNode,
  type PaintNode,
} from '../../packages/native-renderer/src/paint';
import { WebCanvasAdapter } from '../../packages/native-renderer/src/webcanvas-adapter';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { constructionIcon } from '../../packages/native-renderer/src/construction-icon';
import { damagePaint, updateBuildingDamage } from '../../packages/native-renderer/src/building-damage';
import { riseAnimation } from '../../packages/native-renderer/src/building-assets';
import { showEquipment } from '../../packages/native-renderer/src/person-equipment';
import { PersonParts, personSprite } from '../../packages/native-renderer/src/world-sprites';
import {
  clearWorkProps,
  animateFieldWork,
  animateProcessingWork,
} from '../../packages/native-renderer/src/work-motion';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { animateAction, workPose } from '../../packages/native-renderer/src/action-motion';
import { Person, Role, Race, Calling, Activity, TreeWorkKind } from '../../packages/engine/src/person';
import { Structure, Product, structureSpec } from '../../packages/engine/src/building-catalog';
import { Tool, toolStructure } from '../../packages/engine/src/game-tools';
import { Building } from '../../packages/engine/src/town-models';
import { point } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import { harvestTiming, hammerTiming, workElapsed } from '../../packages/engine/src/work-timing';
import type { Town } from '../../packages/engine/src/town';
class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      putImageData: (image: Pixels) => (this.pixels = image.data.slice()),
      clearRect: () => this.pixels.fill(0),
    };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
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
function surface(width: number, height: number) {
  const target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false }),
    adapter = new WebCanvasAdapter(tvg),
    root = new SceneNode();
  root.add(new ShapeNode().appendRect(0, 0, width, height).fill(102, 119, 95));
  canvas.add(adapter.sync(root));
  return {
    target,
    root,
    draw: () => {
      adapter.sync(root);
      canvas.update().render();
    },
    capture: (name: string) => {
      if (process.env.CAPTURE_VISUALS) {
        mkdirSync('artifacts/work-visuals', { recursive: true });
        writeFileSync(`artifacts/work-visuals/${name}-${width}x${height}.rgba`, target.pixels);
      }
    },
    dispose: () => {
      canvas.remove();
      adapter.dispose();
      canvas.destroy();
    },
  };
}
const flatten = (p: PaintNode): PaintNode[] => [
  p,
  ...(p instanceof SceneNode ? p.children.flatMap(flatten) : []),
];
it('renders nonempty distinct road, paving, field and structure artwork for every build card', () => {
  const tools = Array.from({ length: Tool.Count }, (_, i) => i).filter(
    (tool) => toolStructure(tool) !== undefined || [Tool.Road, Tool.Pave, Tool.Field].includes(tool),
  );
  const view = surface(720, Math.ceil(tools.length / 6) * 100);
  try {
    tools.forEach((tool, i) => {
      const icon = constructionIcon(tool, 110, 85);
      expect(flatten(icon).some((p) => p instanceof ShapeNode && p.commands.length > 0)).toBe(true);
      const cell = new SceneNode().translate((i % 6) * 120 + 5, Math.floor(i / 6) * 100 + 5);
      cell.add(icon);
      view.root.add(cell);
    });
    view.draw();
    view.capture('construction-icons');
  } finally {
    view.dispose();
  }
});
it('adds exposed-surface cracks, missing material, rubble and critical smoke, and removes them after repair', () => {
  const view = surface(900, 570),
    s = new WorldRendererState(tvg),
    buildings: Building[] = [];
  const fakeTown = {
    building: (id: number) => buildings.find((b) => b.id === id) ?? null,
    clock: () => 3,
  } as Town;
  try {
    [Structure.Cottage, Structure.Sawmill, Structure.StoneStore].forEach((kind, row) =>
      [1, 0.75, 0.5, 0.25, 0.1].forEach((health, col) => {
        const size = structureSpec(kind).size,
          b = new Building(buildings.length, kind, point(size / 2, size / 2), 0.25, 4);
        b.health = health;
        buildings.push(b);
        const layout = riseAnimation(kind, 4, [], b.angle),
          picture = new AnimationNode(layout.json).frame(layout.frames - 1);
        picture.translate(-layout.originX, -layout.originY);
        const group = new SceneNode().transform([1.7, 0, col * 180 + 90, 0, 1.7, row * 190 + 130, 0, 0, 1]);
        group.add(picture).add(damagePaint(s, b));
        view.root.add(group);
      }),
    );
    updateBuildingDamage(s, fakeTown);
    view.draw();
    view.capture('building-damage');
    for (const b of buildings) {
      const damage = damagePaint(s, b);
      expect(damage.children.length > 0).toBe(b.health < 0.85);
      if (b.health < 0.6)
        expect(flatten(damage).some((p) => p instanceof ShapeNode && p.color?.[0] === 31)).toBe(true);
    }
    view.draw();
    view.capture('building-damage');
    for (const b of buildings) b.health = 1;
    updateBuildingDamage(s, fakeTown);
    for (const b of buildings) expect(damagePaint(s, b).children).toHaveLength(0);
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('renders field tilling/watering and saw/chisel work as distinct articulated motions', () => {
  const view = surface(640, 640);
  try {
    ['hoe', 'wateringCan', 'saw', 'hammer'].forEach((tool, row) =>
      [0.1, 0.35, 0.6, 0.9].forEach((time, col) => {
        const p = new Person(row, 'Worker', Role.Resident, Calling.Settler, Race.Human, 499096, point()),
          parts = new PersonParts(),
          sprite = personSprite(p, parts);
        showEquipment(parts, tool as any);
        clearWorkProps(parts);
        if (row < 2) animateFieldWork(parts, row === 1, time);
        else animateProcessingWork(parts, row === 2, time);
        expect(parts.arms[1].hand!.children).toContain(
          parts[tool as 'hoe' | 'wateringCan' | 'saw' | 'hammer'],
        );
        sprite.transform([4, 0, col * 160 + 48, 0, 4, row * 160 + 130, 0, 0, 1]);
        view.root.add(sprite);
        if (row === 1) expect(parts.waterDrops!.children.some((drop) => drop.alpha > 0)).toBe(true);
        if (row === 3) expect(parts.chisel!.alpha).toBe(255);
      }),
    );
    view.draw();
    view.capture('work-motion');
  } finally {
    view.dispose();
  }
});
it('shows work equipment only while actually outdoors at the field or productive workshop', () => {
  const view = surface(80, 80),
    s = new WorldRendererState(tvg);
  s.rows = Array.from({ length: 32 }, () => new SceneNode());
  s.currentVisibility.sample = () => 255;
  const p = new Person(0, 'Worker', Role.Resident, Calling.Settler, Race.Human, 499096, point(6, 6)),
    b = new Building(1, Structure.Farm, point(5, 5), 0, 0);
  p.target = p.job = b.id;
  p.activity = Activity.Working;
  p.workField = 0;
  let time = 1;
  const combatTarget = { position: point(5, 6) };
  const town = {
      people: () => [p],
      person: (id: number) => (id === 99 ? combatTarget : p),
      buildings: () => [b],
      building: (id: number) => (id === b.id ? b : null),
      monsters: () => [],
      wildlife: () => [],
      hits: () => [],
      clock: () => time,
      map: () => ({ giant: () => null, volcano: () => null }),
    } as unknown as Town,
    traffic = new Traffic(5);
  try {
    moveAgents(s, town, traffic, time, []);
    const parts = s.figures.get(0)!.parts;
    expect(parts.hoe!.alpha).toBe(255);
    expect(parts.waterDrops!.alpha).toBe(0);
    time = 7;
    moveAgents(s, town, traffic, time, []);
    expect(parts.wateringCan!.alpha).toBe(255);
    expect(parts.waterDrops!.alpha).toBe(255);
    p.path = [point(7, 6)];
    moveAgents(s, town, traffic, time, []);
    expect(parts.wateringCan!.alpha).toBe(0);
    expect(parts.waterDrops!.alpha).toBe(0);
    p.path = [];
    b.kind = Structure.Sawmill;
    b.productionProgress = 1;
    moveAgents(s, town, traffic, time, []);
    expect(parts.saw!.alpha).toBe(255);
    expect(parts.sawLog!.alpha).toBe(255);
    b.productionProgress = 0;
    moveAgents(s, town, traffic, time, []);
    expect(parts.saw!.alpha).toBe(0);
    expect(parts.sawLog!.alpha).toBe(0);
    b.kind = Structure.Stoneworks;
    b.productionProgress = 1;
    moveAgents(s, town, traffic, time, []);
    expect(parts.hammer!.alpha).toBe(255);
    expect(parts.chisel!.alpha).toBe(255);
    p.inside = true;
    moveAgents(s, town, traffic, time, []);
    expect(parts.chisel!.alpha).toBe(0);
    expect(parts.workStone!.alpha).toBe(0);
    expect(p.position).toEqual(point(6, 6));
    p.inside = false;
    p.activity = Activity.Fighting;
    p.attackPerson = 99;
    p.ready = time + 0.5;
    moveAgents(s, town, traffic, time, []);
    expect(s.figures.get(0)!.facing).toBe(-1);
    combatTarget.position = point(7, 6);
    moveAgents(s, town, traffic, time, []);
    expect(s.figures.get(0)!.facing).toBe(1);
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});

it('keeps raw and refined cargo visually distinct and clears loads after delivery', () => {
  const view = surface(800, 160),
    state = new WorldRendererState(tvg);
  state.rows = Array.from({ length: 32 }, () => new SceneNode());
  state.currentVisibility.sample = () => 255;
  const products = [Product.Wood, Product.Stone, Product.Planks, Product.CutStone, Product.Food];
  const props = ['logs', 'stone', 'planks', 'cutStone', 'sack'] as const;
  const people = products.map((product, id) => {
    const p = new Person(id, 'Carrier', Role.Resident, Calling.Settler, Race.Human, 499096, point(6, 6));
    p.carriedProduct = product;
    p.carrying = 3;
    p.activity = Activity.DeliveringMaterials;
    return p;
  });
  const town = {
    people: () => people,
    buildings: () => [],
    building: () => null,
    monsters: () => [],
    wildlife: () => [],
    hits: () => [],
    clock: () => 1,
    map: () => ({ giant: () => null, volcano: () => null }),
  } as unknown as Town;
  try {
    moveAgents(state, town, new Traffic(5), 1, []);
    for (const p of people) {
      const figure = state.figures.get(p.id)!;
      for (const [i, prop] of props.entries()) expect(figure.parts[prop]!.alpha).toBe(i === p.id ? 255 : 0);
      figure.paint.transform([4, 0, 80 + p.id * 160, 0, 4, 130, 0, 0, 1]);
      view.root.add(figure.paint);
    }
    view.draw();
    view.capture('material-cargo');
    for (const p of people) p.carrying = 0;
    moveAgents(state, town, new Traffic(5), 1.1, []);
    for (const p of people)
      for (const prop of props) expect(state.figures.get(p.id)!.parts[prop]!.alpha).toBe(0);
  } finally {
    state.adapter.dispose();
    view.dispose();
  }
});

for (const activity of [Activity.Felling, Activity.Mining, Activity.Building, Activity.Roadwork])
  it(`keeps ${Activity[activity]} grounded while the tool remains animated`, () => {
    const view = surface(960, 160),
      states: WorldRendererState[] = [],
      harvest = activity === Activity.Felling || activity === Activity.Mining,
      timing = harvest ? harvestTiming : hammerTiming,
      period = timing.period,
      phases = [
        0,
        0.24,
        (timing.impact / period) * 0.7,
        (timing.impact / period) * 0.84,
        timing.impact / period,
        0.9,
      ],
      bodies: number[][] = [],
      feet: number[][] = [],
      wrists: number[] = [];
    try {
      for (const [col, phase] of phases.entries()) {
        const state = new WorldRendererState(tvg);
        states.push(state);
        state.rows = Array.from({ length: 64 }, () => new SceneNode());
        state.currentVisibility.sample = () => 255;
        const p = new Person(7, 'Worker', Role.Resident, Calling.Settler, Race.Human, 499096, point(10, 10));
        p.activity = activity;
        p.tree = 11 + 10 * 32;
        p.until = 6;
        const time = phase * period + (harvest ? 0 : period * 3 - workElapsed(0, p.id));
        const town = {
          people: () => [p],
          buildings: () => [],
          building: () => null,
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
            at: () => ({ trees: 1 }),
          }),
        } as unknown as Town;
        moveAgents(state, town, new Traffic(5), time, []);
        const figure = state.figures.get(p.id)!,
          parts = figure.parts;
        bodies.push([...parts.body!.matrix]);
        feet.push(parts.feet.flatMap((foot) => [foot!.matrix[2], foot!.matrix[5]]));
        wrists.push(parts.arms[1].hand!.matrix[0]);
        figure.paint.transform([4, 0, 60 + col * 160, 0, 4, 135, 0, 0, 1]);
        view.root.add(figure.paint);
      }
      view.draw();
      view.capture(`restrained-${Activity[activity].toLowerCase()}`);
      expect(
        Math.max(...bodies.map((matrix) => Math.abs(matrix[5]))),
        'work must not jump above the grounded shadow',
      ).toBe(0);
      for (const matrix of bodies) {
        expect(matrix[4], 'work torso compression stays below five percent').toBeGreaterThanOrEqual(0.95);
        expect(Math.abs(matrix[2]), 'work must not lunge away from its work spot').toBeLessThanOrEqual(0.4);
      }
      for (const foot of feet) expect(foot).toEqual(feet[0]);
      expect(bodies[4][4], 'the actual renderer reaches contact at the shared impact time').toBeCloseTo(
        0.965,
        6,
      );
      expect(bodies[4][2]).toBeCloseTo(0.3, 6);
      expect(Math.max(...wrists) - Math.min(...wrists)).toBeGreaterThan(0.05);
    } finally {
      for (const state of states) state.adapter.dispose();
      view.dispose();
    }
  });

it('places the compact work strike at the supplied impact without changing combat lift', () => {
  for (const { period, impact } of [harvestTiming, hammerTiming]) {
    const contact = workPose(impact, period, impact);
    expect(contact.direction).toBeGreaterThan(workPose(impact - 0.02, period, impact).direction);
    expect(contact.direction).toBeGreaterThan(workPose(impact + 0.02, period, impact).direction);
    const poses = Array.from({ length: 121 }, (_, i) => workPose((i * period) / 120, period, impact));
    expect(
      Math.max(...poses.map((p) => p.direction)) - Math.min(...poses.map((p) => p.direction)),
    ).toBeLessThan(1.2);
    expect(poses.every((p) => p.lift === 0 && p.crouch <= 0.04 && Math.abs(p.forward) <= 0.3)).toBe(true);
  }
  const person = new Person(0, 'Fighter', Role.Resident, Calling.Warrior, Race.Human, 499096, point()),
    parts = new PersonParts();
  personSprite(person, parts);
  animateAction(parts, 'sword', 0.5, 1);
  expect(parts.body!.matrix[5]).toBe(-2.5);
  expect(parts.feet[1]!.matrix[5]).toBeCloseTo(-0.35, 6);
});

for (const stone of [false, true])
  it(`retains the final ${stone ? 'pick' : 'axe'} contact briefly after harvesting becomes collecting`, () => {
    const view = surface(160, 160),
      state = new WorldRendererState(tvg),
      traffic = new Traffic(5);
    state.rows = Array.from({ length: 64 }, () => new SceneNode());
    state.currentVisibility.sample = () => 255;
    const p = new Person(7, 'Worker', Role.Resident, Calling.Settler, Race.Human, 499096, point(10, 10));
    p.activity = stone ? Activity.Mining : Activity.Felling;
    p.tree = 9 + 10 * 32;
    p.until = 6;
    let time = 5.9;
    const events = [
      {
        serial: 1n,
        kind: stone ? TreeWorkKind.Mine : TreeWorkKind.Chop,
        person: p.id,
        cell: p.tree,
        index: 0,
        worker: { ...p.position },
        at: 6,
      },
      {
        serial: 2n,
        kind: stone ? TreeWorkKind.Shatter : TreeWorkKind.Fall,
        person: p.id,
        cell: p.tree,
        index: 0,
        worker: { ...p.position },
        at: 6,
      },
    ];
    const town = {
      people: () => [p],
      buildings: () => [],
      building: () => null,
      monsters: () => [],
      wildlife: () => [],
      hits: () => [],
      treeEvents: () => events,
      clock: () => time,
      map: () => ({
        giant: () => null,
        volcano: () => null,
        width: () => 32,
        seed: () => 5,
        inside: () => true,
        at: () => ({ trees: 1 }),
      }),
    } as unknown as Town;
    try {
      moveAgents(state, town, traffic, time, []);
      const figure = state.figures.get(p.id)!,
        parts = figure.parts,
        tool = stone ? 'pickaxe' : 'axe';
      expect(figure.facing).toBe(-1);
      p.activity = Activity.Collecting;
      p.tree = -1;
      p.carriedProduct = stone ? Product.Stone : Product.Wood;
      // Collection owns a different deadline; the final work pose must use the real hit.
      p.until = 999;
      time = 6.02;
      moveAgents(state, town, traffic, time, []);
      figure.paint.transform([-4, 0, 100, 0, 4, 135, 0, 0, 1]);
      view.root.add(figure.paint);
      view.draw();
      view.capture(`final-${tool}-contact`);
      expect(parts[tool]!.alpha).toBe(255);
      expect(figure.facing).toBe(-1);
      expect(parts.body!.matrix[5]).toBe(0);
      expect(parts.body!.matrix[4]).toBeCloseTo(
        1 - workPose(harvestTiming.impact + 0.02, harvestTiming.period, harvestTiming.impact).crouch,
        6,
      );
      for (const foot of parts.feet) expect(foot!.matrix[5]).toBe(0);
      time = 6.2;
      moveAgents(state, town, traffic, time, []);
      figure.paint.transform([-4, 0, 100, 0, 4, 135, 0, 0, 1]);
      view.draw();
      view.capture(`final-${tool}-collect`);
      expect(parts.axe!.alpha).toBe(0);
      expect(parts.pickaxe!.alpha).toBe(0);
    } finally {
      state.adapter.dispose();
      view.dispose();
    }
  });
