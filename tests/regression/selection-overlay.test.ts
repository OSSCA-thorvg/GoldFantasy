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
it('draws selected unit feedback after an opaque foreground world object', () => {
  const view = fixture();
  try {
    const plain = view.draw([]);
    view.capture('covered-unselected');
    const selected = view.draw([view.p.id]);
    view.capture('covered-selected');
    let changed = 0;
    for (let i = 0; i < plain.length; i += 4)
      if (plain[i] !== selected[i] || plain[i + 1] !== selected[i + 1] || plain[i + 2] !== selected[i + 2])
        changed++;
    expect(changed, 'selection must remain visible above overlapping world geometry').toBeGreaterThan(40);
  } finally {
    view.dispose();
  }
});
it('tracks selected residents and camera changes without scaling corner strokes or adding circles', () => {
  const view = fixture();
  try {
    view.occluder.opacity(0);
    const second = new Person(
      8,
      'Second settler',
      Role.Resident,
      Calling.Settler,
      Race.Human,
      899504,
      point(10.2, 10.1),
    );
    view.people.push(second);
    view.draw([view.p.id, second.id]);
    expect(view.state.selectionMarkers.size).toBe(2);
    const marker = view.state.selectionMarkers.get(view.p.id)!;
    const before = marker.edge.commands.map((command) => [...command]);
    const start = marker.edge.commands[0];
    expect(start[0]).toBe('M');
    view.p.position.x += 0.25;
    view.draw([view.p.id, second.id]);
    const moved = marker.edge.commands[0];
    expect(moved[1]! - start[1]!).toBeCloseTo(32, 4);
    expect(moved[2]! - start[2]!).toBeCloseTo(16, 4);
    for (const zoom of [0.5, 1, 2, 4]) {
      view.state.view.zoom = zoom;
      view.draw([view.p.id]);
      expect(view.state.selectionMarkers.size).toBe(1);
      expect(marker.edge.width).toBe(1.5);
      expect(marker.under.width).toBe(3.5);
      expect(marker.edge.commands.every((command) => command[0] === 'M' || command[0] === 'L')).toBe(true);
      const [begin, corner] = marker.edge.commands;
      expect(Math.abs(begin[2]! - corner[2]!)).toBeCloseTo(6, 4);
      view.capture(`visible-zoom-${zoom}`);
    }
    expect(marker.edge.commands).not.toEqual(before);
    view.state.view.x += 2000;
    view.draw([view.p.id]);
    expect(view.state.selectionMarkers.size).toBe(0);
    view.state.view.x -= 2000;
    view.draw([view.p.id]);
    expect(view.state.selectionMarkers.size).toBe(1);
    view.people.length = 0;
    view.draw([view.p.id]);
    expect(view.state.selectionMarkers.size).toBe(0);
    expect(view.state.selection.children).toHaveLength(0);
  } finally {
    view.dispose();
  }
});
it('does not reveal units through fog or an entered doorway and fades with partial visibility', () => {
  const view = fixture();
  try {
    view.draw([view.p.id]);
    expect(view.state.selectionMarkers.size).toBe(1);
    view.setVisible(false);
    const hidden = view.draw([view.p.id]);
    expect(view.state.selectionMarkers.size).toBe(0);
    expect(hidden).toEqual(view.draw([]));
    view.setVisible(true);
    view.p.inside = true;
    view.p.doorway = 1;
    const indoors = view.draw([view.p.id]);
    expect(view.state.selectionMarkers.size).toBe(0);
    expect(indoors).toEqual(view.draw([]));
    view.p.doorway = 0.5;
    view.draw([view.p.id]);
    expect(view.state.selectionMarkers.get(view.p.id)!.alpha).toBe(
      view.state.figures.get(view.p.id)!.paint.alpha,
    );
    expect(view.state.selectionMarkers.get(view.p.id)!.alpha).toBeLessThan(255);
    view.draw([]);
    expect(view.state.selectionMarkers.size).toBe(0);
    expect(view.state.selection.children).toHaveLength(0);
  } finally {
    view.dispose();
  }
});

it('retires native selection paints after repeated deselection, offscreen culling and map resets', () => {
  const view = fixture();
  try {
    view.draw([]);
    const baseline = view.state.adapter.retainedPaintCount;
    for (let cycle = 0; cycle < 36; cycle++) {
      view.draw([view.p.id]);
      const marker = view.state.selectionMarkers.get(view.p.id)!;
      const nativePaints = [marker, marker.under, marker.edge].map((node) => view.state.adapter.sync(node));
      expect(view.state.adapter.retainedPaintCount).toBe(baseline + 3);
      expect(nativePaints.every((paint) => paint.ptr !== 0)).toBe(true);
      switch (cycle % 3) {
        case 0:
          view.draw([]);
          break;
        case 1:
          view.state.view.x += 2000;
          view.draw([view.p.id]);
          view.state.view.x -= 2000;
          break;
        default:
          view.reset();
          view.draw([]);
          break;
      }
      expect(view.state.selectionMarkers.size).toBe(0);
      expect(view.state.selection.children).toHaveLength(0);
      expect(view.state.adapter.retainedPaintCount, `native paint count after cycle ${cycle}`).toBe(baseline);
      for (const paint of nativePaints) expect(() => paint.ptr).toThrow('Object has been disposed');
    }
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
