import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Town } from '../../packages/engine/src/town';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import {
  Activity,
  Calling,
  Person,
  Race,
  Role,
  TreeWorkKind,
  type TreeWorkEvent,
} from '../../packages/engine/src/person';
import { Terrain } from '../../packages/engine/src/world-types';
import { harvestDuration, harvestTiming, treeFallTiming } from '../../packages/engine/src/work-timing';
import * as mining from '../../packages/engine/src/mining';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { SceneNode, identity } from '../../packages/native-renderer/src/paint';
import { Rect } from '../../packages/native-ui/src/types';
import { buildTreeRow, swayTrees, updateFelling } from '../../packages/native-renderer/src/world-trees';
import { treeAt } from '../../packages/native-renderer/src/tree-painter';
import { sortWorldObjects } from '../../packages/native-renderer/src/world-depth';
import { pickSource } from '../../packages/native-renderer/src/world-pick-registry';
import { WorldPicker } from '../../packages/native-renderer/src/world-picking';
import {
  hasResourceHits,
  resetResourceHits,
  updateResourceHits,
} from '../../packages/native-renderer/src/resource-hit';

class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels = new Uint8ClampedArray();
  constructor(
    public width: number,
    public height: number,
  ) {}
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

function fixture(stone = false, trees = 1) {
  const town = new Town(5, 32, false),
    map = town.map();
  for (const tile of map.tiles)
    Object.assign(tile, { terrain: Terrain.Grass, trees: 0, wild: 0, revealed: true, quarried: true });
  map.ymir = map.fire = null;
  map.reveal(16, 16, 32);
  let x = 14,
    y = 14;
  if (stone) {
    for (x = 10; x < 22; x++) {
      Object.assign(map.at(x, y), { terrain: Terrain.Rock, quarried: false });
      if (mining.deposit(map, x, y)) break;
      Object.assign(map.at(x, y), { terrain: Terrain.Grass, quarried: true });
    }
    expect(mining.deposit(map, x, y)).toBe(true);
  } else map.at(x, y).trees = trees;
  const cell = y * 32 + x,
    index = stone ? 0 : trees - 1,
    foot = stone ? mining.position(x, y) : treeAt(map, x, y, index).foot,
    pivot = project(foot.x, foot.y),
    surface = new MemoryCanvas(640, 400),
    canvas = new tvg.Canvas(surface as unknown as OffscreenCanvas, {
      width: 640,
      height: 400,
      enableDevicePixelRatio: false,
    }),
    state = new WorldRendererState(tvg),
    picker = new WorldPicker(state),
    row = x + y;
  state.view = new Camera(pivot.x, pivot.y - 20, 4);
  state.viewWidth = 640;
  state.viewHeight = 400;
  state.rows = Array.from({ length: 63 }, () => new SceneNode());
  state.rowTrees = Array.from({ length: 63 }, () => new SceneNode());
  state.rowCanopies = Array.from({ length: 63 }, () => []);
  state.treeBounds = Array.from({ length: 63 }, () => new Rect());
  state.background.appendRect(0, 0, 640, 400).fill(84, 102, 86);
  let visible = true,
    serial = 0n;
  state.currentVisibility.sample = () => (visible ? 255 : 0);
  const rebuild = () => buildTreeRow(state, map, town.climate(), row);
  rebuild();
  canvas.add(state.scene());
  const target = () => {
    const found = state.rowTrees[row].children.find((paint) => {
      const ref = pickSource(paint)?.ref;
      return ref?.kind === (stone ? 'rock' : 'tree') && ref.id === cell && (ref.instanceIndex ?? 0) === index;
    });
    if (!(found instanceof SceneNode)) throw new Error('Missing resource fixture');
    return found;
  };
  return {
    state,
    town,
    map,
    cell,
    index,
    foot,
    pivot,
    row,
    surface,
    picker,
    target,
    rebuild,
    visible(value: boolean) {
      visible = value;
    },
    contact(kind = stone ? TreeWorkKind.Mine : TreeWorkKind.Chop, at = 1): TreeWorkEvent {
      return {
        serial: serial++,
        kind,
        at,
        cell,
        index,
        person: 1,
        worker: point(foot.x - 0.5, foot.y),
      };
    },
    draw(time: number, wind = 0, windTime = time, name?: string) {
      town.time = time;
      const c = state.view;
      state.world.transform([c.zoom, 0, 320 - c.x * c.zoom, 0, c.zoom, 200 - c.y * c.zoom, 0, 0, 1]);
      swayTrees(state, wind, windTime);
      updateFelling(state, town);
      updateResourceHits(state, town);
      sortWorldObjects(state);
      state.scene();
      state.adapter.collect([state.root]);
      canvas.update().render();
      picker.presented(town, 1);
      if (name && process.env.CAPTURE_RESOURCE_HITS) {
        mkdirSync('artifacts/resource-hit', { recursive: true });
        writeFileSync(`artifacts/resource-hit/${name}-640x400.rgba`, surface.pixels);
      }
      return createHash('sha256').update(surface.pixels).digest('hex');
    },
    dispose() {
      resetResourceHits(state);
      picker.invalidate();
      canvas.remove();
      state.dispose();
      canvas.destroy();
    },
  };
}
function expectGrounded(paint: SceneNode, pivot: { x: number; y: number }) {
  const m = paint.matrix;
  expect(m[0] * pivot.x + m[1] * pivot.y + m[2]).toBeCloseTo(pivot.x, 3);
  expect(m[3] * pivot.x + m[4] * pivot.y + m[5]).toBeCloseTo(pivot.y, 3);
  expect(m[3]).toBe(0);
  expect(m[4]).toBe(1);
}

for (const stone of [false, true])
  it(`reacts to the actual ${stone ? 'mine' : 'chop'} timestamp and settles without moving the resource base`, () => {
    const v = fixture(stone);
    try {
      const name = stone ? 'rock' : 'tree',
        paint = v.target(),
        event = v.contact();
      v.town.timberEvents.push(event);
      const before = v.draw(0.99, 0, 0, `${name}-before`),
        baseline = v.state.adapter.retainedPaintCount;
      expect(paint.matrix).toEqual(identity);
      expect(hasResourceHits(v.state)).toBe(false);
      const contact = v.draw(1.035, 0, 0, `${name}-contact`);
      expect(contact).not.toBe(before);
      let chipPixels = 0;
      for (let i = 0; i < v.surface.pixels.length; i += 4) {
        const r = v.surface.pixels[i],
          g = v.surface.pixels[i + 1];
        if (stone ? g > 102 : r > 80 && r > g + 10) chipPixels++;
      }
      // The original stone/tree and flat background contain none of these chip colors.
      // This catches particles accidentally hidden behind the resource for their whole lifetime.
      expect(chipPixels).toBeGreaterThan(10);
      expect(paint.matrix).not.toEqual(identity);
      expectGrounded(paint, v.pivot);
      expect(Math.abs(paint.matrix[1])).toBeLessThan(0.065);
      const count = v.state.adapter.retainedPaintCount;
      expect(v.draw(1.035)).toBe(contact);
      expect(v.state.adapter.retainedPaintCount).toBe(count);
      v.draw(1.15, 0, 0, `${name}-recoil`);
      expectGrounded(paint, v.pivot);
      const geometry = v.picker.selectionGeometry({
        kind: stone ? 'rock' : 'tree',
        id: v.cell,
        ...(stone ? {} : { instanceIndex: 0 }),
      });
      expect(geometry?.foot).toEqual(v.state.view.toScreen(v.pivot, 640, 400));
      expect(v.draw(1.5, 0, 0, `${name}-settled`)).toBe(before);
      expect(paint.matrix).toEqual(identity);
      expect(hasResourceHits(v.state)).toBe(false);
      expect(v.state.adapter.retainedPaintCount).toBe(baseline);
    } finally {
      v.dispose();
    }
  });

it('composes with wind, targets only the hit tree instance, and never accumulates deformation', () => {
  const v = fixture(false, 2);
  try {
    const target = v.target(),
      other = v.state.rowTrees[v.row].children.find((paint) => paint !== target)!;
    v.draw(0.9, 0.8, 2);
    const wind = [...target.matrix],
      otherWind = [...other.matrix];
    v.town.timberEvents.push(v.contact());
    v.draw(1.04, 0.8, 2);
    const hit = [...target.matrix];
    expect(hit).not.toEqual(wind);
    expect(other.matrix).toEqual(otherWind);
    expectGrounded(target, v.pivot);
    for (let i = 0; i < 10; i++) {
      v.draw(1.04, 0.8, 2);
      expect(target.matrix).toEqual(hit);
    }
    v.draw(1.5, 0.8, 2);
    expect(target.matrix).toEqual(wind);
    v.draw(1.6, 0, 2);
    expect(target.matrix).toEqual(identity);
  } finally {
    v.dispose();
  }
});

it('does not invent reactions for unrelated work, hidden resources, or removed targets', () => {
  const v = fixture();
  try {
    const before = v.draw(0.9);
    for (const kind of [TreeWorkKind.Hammer, TreeWorkKind.Regrow, TreeWorkKind.Produced])
      v.town.timberEvents.push(v.contact(kind));
    expect(v.draw(1.04)).toBe(before);
    v.town.timberEvents.push(v.contact());
    v.visible(false);
    expect(v.draw(1.05)).toBe(before);
    expect(hasResourceHits(v.state)).toBe(false);
    v.visible(true);
    v.map.at(v.cell % 32, Math.floor(v.cell / 32)).trees = 0;
    v.rebuild();
    v.draw(1.06);
    expect(hasResourceHits(v.state)).toBe(false);
  } finally {
    v.dispose();
  }
});

it('keeps the final contact chips while the existing tree fall proceeds on its original timeline', () => {
  const v = fixture();
  try {
    v.town.timberEvents.push(v.contact(), v.contact(TreeWorkKind.Fall));
    v.map.at(v.cell % 32, Math.floor(v.cell / 32)).trees = 0;
    v.rebuild();
    v.draw(1.03, 0, 0, 'tree-final-contact');
    expect(v.state.fallingTrees).toHaveLength(1);
    expect(hasResourceHits(v.state)).toBe(true);
    const fall = v.state.fallingTrees[0];
    v.draw(1.4, 0, 0, 'tree-falling');
    expect(hasResourceHits(v.state)).toBe(false);
    expect(v.state.fallingTrees).toHaveLength(1);
    v.draw(1 + treeFallTiming.impact);
    expect(Math.abs(fall.body.matrix[0])).toBeCloseTo(Math.cos(1.46), 5);
    v.draw(1 + treeFallTiming.duration + 0.01);
    expect(v.state.fallingTrees).toHaveLength(0);
  } finally {
    v.dispose();
  }
});

it('uses contacts emitted by real harvesting rather than a second animation clock', () => {
  const v = fixture();
  try {
    const p = new Person(
      1,
      'Woodcutter',
      Role.Resident,
      Calling.Settler,
      Race.Human,
      499096,
      point(v.foot.x - 0.3, v.foot.y),
    );
    p.inventory[0] = { item: 'axe', quantity: 1 };
    p.equipment.tool1 = 1;
    p.food = p.rest = p.hydration = 1;
    v.town.folk.push(p);
    v.town.titleAutoplay = true;
    v.town.changes++;
    v.town.tick(0);
    expect(v.town.orderChop([p.id], v.cell)).toBe(true);
    for (let i = 0; i < 200 && (p.activity !== Activity.Felling || p.moving()); i++) v.town.advance(0.01);
    expect(p.activity).toBe(Activity.Felling);
    expect(p.moving()).toBe(false);
    const started = p.until - harvestDuration(p);
    for (let i = 0; i < 200 && !v.town.treeEvents().some((event) => event.kind === TreeWorkKind.Chop); i++) {
      v.draw(v.town.clock());
      expect(v.target().matrix).toEqual(identity);
      v.town.advance(0.01);
    }
    const first = v.town.treeEvents().find((event) => event.kind === TreeWorkKind.Chop)!;
    expect(first.at - started).toBeCloseTo(harvestTiming.impact, 7);
    v.town.advance(0.025);
    v.draw(v.town.clock());
    expect(v.target().matrix).not.toEqual(identity);
    expectGrounded(v.target(), v.pivot);
    for (let i = 0; i < 700 && p.activity === Activity.Felling; i++) v.town.advance(0.01);
    expect(p.activity).toBe(Activity.Collecting);
    const fall = v.town.treeEvents().find((event) => event.kind === TreeWorkKind.Fall)!;
    expect(fall).toBeDefined();
    expect(
      v.town.treeEvents().some((event) => event.kind === TreeWorkKind.Chop && event.at === fall.at),
    ).toBe(true);
    v.rebuild();
    v.town.advance(0.025);
    v.draw(v.town.clock());
    expect(hasResourceHits(v.state)).toBe(true);
    expect(v.state.fallingTrees).toHaveLength(1);
  } finally {
    v.dispose();
  }
});
