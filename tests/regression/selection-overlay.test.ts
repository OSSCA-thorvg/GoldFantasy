import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { WorldRenderer } from '../../packages/native-renderer/src/world-renderer';
import { SceneNode, ShapeNode } from '../../packages/native-renderer/src/paint';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
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

function fixture() {
  const width = 320,
    height = 240,
    target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false }),
    state = new WorldRenderer(tvg),
    p = new Person(7, 'Selected settler', Role.Resident, Calling.Settler, Race.Human, 499096, point(10, 10)),
    people = [p],
    traffic = new Traffic(5);
  let visible = true;
  const restoreRows = () => {
    state.rows = Array.from({ length: 40 }, () => new SceneNode());
    for (const row of state.rows) state.objects.add(row);
    state.currentVisibility.sample = () => (visible ? 255 : 0);
  };
  restoreRows();
  state.background.appendRect(0, 0, width, height).fill(102, 119, 95);
  state.viewWidth = width;
  state.viewHeight = height;
  const at = project(p.position.x, p.position.y);
  state.view = new Camera(at.x, at.y - 8, 4);
  const occluder = new ShapeNode().appendRect(at.x - 100, at.y - 100, 200, 200).fill(49, 64, 52);
  state.overlay.add(occluder);
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
  canvas.add(state.scene());
  return {
    state,
    p,
    people,
    target,
    occluder,
    reset: () => {
      state.invalidateMap();
      restoreRows();
    },
    setVisible: (value: boolean) => {
      visible = value;
    },
    draw: (selected: readonly number[]) => {
      const c = state.view;
      state.world.transform([
        c.zoom,
        0,
        width / 2 - c.x * c.zoom,
        0,
        c.zoom,
        height / 2 - c.y * c.zoom,
        0,
        0,
        1,
      ]);
      moveAgents(state, town, traffic, 1, selected);
      state.scene();
      // Match WorldRenderer.update: retain the live root and independently cached figures.
      state.adapter.collect([state.root, ...[...state.figures.values()].map((figure) => figure.paint)]);
      canvas.update().render();
      return target.pixels.slice();
    },
    capture: (name: string) => {
      if (!process.env.CAPTURE_VISUALS) return;
      mkdirSync('artifacts/selection-overlay', { recursive: true });
      writeFileSync(`artifacts/selection-overlay/${name}-${width}x${height}.rgba`, target.pixels);
    },
    dispose: () => {
      canvas.remove();
      state.dispose();
      canvas.destroy();
    },
  };
}
it('leaves selection feedback to the shared app overlay without duplicate native markers', () => {
  const view = fixture();
  try {
    view.occluder.opacity(0);
    const plain = view.draw([]);
    expect(view.draw([view.p.id])).toEqual(plain);
    expect(view.state.selection.children).toHaveLength(0);
    expect(view.state.selectionMarkers.size).toBe(0);
    const count = view.state.adapter.retainedPaintCount;
    for (let i = 0; i < 30; i++) {
      view.draw(i % 2 ? [view.p.id] : []);
      expect(view.state.adapter.retainedPaintCount).toBe(count);
    }
    view.reset();
    view.draw([view.p.id]);
    expect(view.state.selection.children).toHaveLength(0);
  } finally {
    view.dispose();
  }
});
it('keeps figure alpha authoritative through fog and doorway transitions', () => {
  const view = fixture();
  try {
    view.draw([view.p.id]);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBe(255);
    view.setVisible(false);
    view.draw([view.p.id]);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBe(0);
    view.setVisible(true);
    view.p.inside = true;
    view.p.doorway = 1;
    view.draw([view.p.id]);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBe(0);
    view.p.doorway = 0.5;
    view.draw([view.p.id]);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBeGreaterThan(0);
    expect(view.state.figures.get(view.p.id)!.paint.alpha).toBeLessThan(255);
  } finally {
    view.dispose();
  }
});

it('keeps stress recovery and neutral affiliation indicators tied to the actual visible figure', () => {
  const view = fixture();
  try {
    view.occluder.opacity(0);
    view.draw([]);
    const figure = view.state.figures.get(view.p.id)!;
    expect(figure.parts.stressRecovery!.alpha).toBe(0);
    expect(figure.parts.affiliation!.alpha).toBe(0);
    view.p.stressRecovery = true;
    view.draw([]);
    expect(figure.parts.stressRecovery!.alpha).toBe(255);
    expect(figure.parts.alert!.alpha).toBe(0);
    view.p.faction = 3;
    view.draw([]);
    expect(figure.parts.affiliation!.alpha).toBe(255);
    view.setVisible(false);
    view.draw([]);
    expect(figure.paint.alpha).toBe(0);
    view.p.stressRecovery = false;
    view.p.faction = 0;
    view.setVisible(true);
    view.draw([]);
    expect(figure.parts.stressRecovery!.alpha).toBe(0);
    expect(figure.parts.affiliation!.alpha).toBe(0);
  } finally {
    view.dispose();
  }
});
