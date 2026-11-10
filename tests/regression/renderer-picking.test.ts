import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Camera, Footprint, point, project, unproject } from '../../packages/engine/src/geometry';
import type { Town } from '../../packages/engine/src/town';
import { Terrain, Layer } from '../../packages/engine/src/world-types';
import { Road } from '../../packages/engine/src/road-network';
import {
  SceneNode,
  ShapeNode,
  AnimationNode,
  SvgPictureNode,
} from '../../packages/native-renderer/src/paint';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { paintFields } from '../../packages/native-renderer/src/terrain-painter';
import { WorldPicker } from '../../packages/native-renderer/src/world-picking';
import { registerPick } from '../../packages/native-renderer/src/world-pick-registry';
import { registerDepth, sortWorldObjects } from '../../packages/native-renderer/src/world-depth';
import { TreeBatch, TreeKind } from '../../packages/native-renderer/src/tree-painter';
import { paintYmir } from '../../packages/native-renderer/src/ymir-statue';
import { paintVolcano } from '../../packages/native-renderer/src/volcano-painter';
import { paintHvergelmir } from '../../packages/native-renderer/src/hvergelmir-painter';
import type { WorldObjectRef } from '../../packages/native-renderer/src/world-picking-types';

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
      putImageData: (p: Pixels) => (this.pixels = p.data.slice()),
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
function fixture(dpr = 1) {
  const surface = new MemoryCanvas(320 * dpr, 240 * dpr);
  const canvas = new tvg.Canvas(surface as any, {
    width: surface.width,
    height: surface.height,
    enableDevicePixelRatio: false,
  });
  const s = new WorldRendererState(tvg),
    picker = new WorldPicker(s),
    roads: Road[] = [];
  let revealed = true,
    trees = 2,
    revision = 1n;
  const map = {
    width: () => 32,
    inside: () => true,
    revealed: () => revealed,
    at: () => ({ trees }),
    giant: () => ({ center: () => point() }),
    dungeons: () => [{ discovered: true }],
    terrainAt: () => Terrain.Grass,
  };
  const town = {
    map: () => map,
    roadRevision: () => revision,
    roads: () => ({ roads: () => roads }),
    building: () => ({}),
    person: () => ({ health: 1, visibility: () => 1, position: point() }),
    creature: () => ({ health: 1, insideLair: false, position: point() }),
  } as unknown as Town;
  s.currentVisibility.sample = () => 255;
  s.view = new Camera(160, 120, 1);
  s.viewWidth = 320;
  s.viewHeight = 240;
  s.root.transform([dpr, 0, 0, 0, dpr, 0, 0, 0, 1]);
  canvas.add(s.scene());
  return {
    s,
    picker,
    town,
    roads,
    surface,
    reveal(value: boolean) {
      revealed = value;
      revision++;
    },
    trees(value: number) {
      trees = value;
    },
    add(
      body: SceneNode | ShapeNode | AnimationNode | SvgPictureNode,
      ref: WorldObjectRef,
      foot = unproject(50, 60),
    ) {
      const root = new SceneNode().add(body);
      s.objects.add(root);
      registerPick(root, { ref, body: [body], foot, ellipse: { rx: 6, ry: 3 } });
      return root;
    },
    draw() {
      picker.beginFrame();
      const c = s.view;
      s.world.transform([c.zoom, 0, 160 - c.x * c.zoom, 0, c.zoom, 120 - c.y * c.zoom, 0, 0, 1]);
      s.scene();
      s.adapter.collect([s.root]);
      canvas.update().render();
      picker.presented(town, dpr);
    },
    dispose() {
      picker.invalidate();
      canvas.remove();
      s.dispose();
      canvas.destroy();
    },
  };
}
function rectangle(x: number, y: number, w: number, h: number) {
  return new ShapeNode().appendRect(x, y, w, h).fill(90, 130, 80);
}
function animation(firstOpacity = 100) {
  const shape = (x: number) => ({
    ty: 'gr',
    it: [
      { ty: 'rc', p: { a: 0, k: [x, 30] }, s: { a: 0, k: [10, 20] }, r: { a: 0, k: 0 } },
      { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 }, r: 1 },
      {
        ty: 'tr',
        p: { a: 0, k: [0, 0] },
        a: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: x === 20 ? firstOpacity : 100 },
      },
    ],
  });
  return new AnimationNode(
    JSON.stringify({
      v: '5.9.0',
      fr: 30,
      ip: 0,
      op: 2,
      w: 100,
      h: 100,
      layers: [
        {
          ty: 4,
          ind: 1,
          ip: 0,
          op: 2,
          st: 0,
          ks: {
            p: { a: 0, k: [0, 0] },
            a: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
          shapes: [shape(20), shape(60)],
        },
      ],
    }),
  );
}
it.each([1, 1.75])(
  'rejects disjoint Scene, SVG and Lottie gaps under mirrored ancestors at effective DPR %s',
  (dpr) => {
    const v = fixture(dpr);
    try {
      const scene = new SceneNode().add(rectangle(15, 20, 10, 20)).add(rectangle(55, 20, 10, 20));
      const svg = new SvgPictureNode(
        '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><path d="M15 20h10v20H15z M55 20h10v20H55z" fill="red"/></svg>',
      );
      for (const body of [scene, svg, animation()]) {
        v.s.objects.remove();
        const nested = new SceneNode().add(body).transform([-1, 0, 100, 0, 1, 20, 0, 0, 1]);
        v.add(nested, { kind: 'building', id: 1 });
        v.draw();
        expect(
          v.picker.pick(point(80, 50))?.id,
          `${body.type}: ${JSON.stringify(v.picker.selectionGeometry({ kind: 'building', id: 1 }))}`,
        ).toBe(1);
        expect(v.picker.pick(point(40, 50))?.id).toBe(1);
        expect(v.picker.pick(point(60, 50))).toBeNull();
        expect(v.picker.querySelection({ x: 57, y: 45, w: 5, h: 8 })).toEqual([]);
      }
    } finally {
      v.dispose();
    }
  },
);
it('keeps prepared Lottie leaf queries clipped and hidden without acquiring native references', () => {
  const v = fixture(1.75);
  const references = (paint: { ptr: number }) => {
    const module = (globalThis as any).__ThorVGModule;
    const count = module._tvg_paint_ref(paint.ptr) - 1;
    module._tvg_paint_unref(paint.ptr, 0);
    return count;
  };
  try {
    const body = animation(),
      nested = new SceneNode().add(body).transform([-1, 0, 100, 0, 1, 20, 0, 0, 1]);
    const parent = new SceneNode().add(nested).clip(rectangle(70, 35, 20, 30));
    v.add(parent, { kind: 'building', id: 1 });
    v.draw();
    expect(v.picker.pick(point(80, 50))?.id).toBe(1);
    expect(v.picker.pick(point(40, 50))).toBeNull();
    const native = v.s.adapter.sync(body),
      count = references(native);
    for (let i = 0; i < 40; i++) {
      body.frame(i % 2);
      v.draw();
      expect(references(native)).toBe(count);
    }
    v.s.objects.remove();
    const hidden = animation(0);
    v.add(new SceneNode().add(hidden).transform([-1, 0, 100, 0, 1, 20, 0, 0, 1]), {
      kind: 'building',
      id: 2,
    });
    v.draw();
    expect(v.picker.pick(point(80, 50))).toBeNull();
    expect(v.picker.pick(point(40, 50))?.id).toBe(2);
  } finally {
    v.dispose();
  }
});
it('queries exactly one physical pixel for fractional logical pointer positions', () => {
  const v = fixture(1.75);
  try {
    v.add(rectangle(0, 0, 100, 100), { kind: 'building', id: 1 });
    v.draw();
    const query = vi.spyOn(v.s.adapter, 'intersectsRendered');
    v.picker.pick(point(40.2, 45.3));
    expect(query).toHaveBeenCalled();
    expect(query.mock.calls[0][1]).toEqual({ x: 70, y: 79, w: 1, h: 1 });
  } finally {
    v.dispose();
  }
});
it('honors clip contours, alpha-zero bodies and stroke-only holes', () => {
  const v = fixture();
  try {
    const clip = new ShapeNode().appendCircle(45, 45, 12).fill(255, 255, 255);
    const body = new SceneNode().add(rectangle(10, 10, 70, 70)).clip(clip);
    const root = v.add(body, { kind: 'building', id: 1 });
    v.draw();
    expect(v.picker.pick(point(45, 45))?.id).toBe(1);
    expect(v.picker.pick(point(15, 15))).toBeNull();
    root.opacity(0);
    v.draw();
    expect(v.picker.pick(point(45, 45))).toBeNull();
    root.opacity(255);
    body.remove();
    body.add(
      new ShapeNode().appendCircle(45, 45, 10).fill(0, 0, 0, 0).strokeWidth(2).strokeFill(255, 255, 255),
    );
    v.draw();
    expect(v.picker.pick(point(45, 45))).toBeNull();
    expect(v.picker.pick(point(54, 45))?.id).toBe(1);
  } finally {
    v.dispose();
  }
});
it('picks the actual frontmost object, not a kind priority or the nearest feet', () => {
  const v = fixture();
  try {
    const back = v.add(rectangle(30, 30, 40, 40), { kind: 'person', id: 8 });
    const front = v.add(rectangle(40, 35, 40, 40), { kind: 'tree', id: 4, instanceIndex: 1 });
    v.s.rows = [new SceneNode().add(front).add(back)];
    registerDepth(back, unproject(50, 60), 'person:8');
    registerDepth(front, unproject(50, 70), 'tree:4:1');
    sortWorldObjects(v.s);
    v.draw();
    expect(v.picker.pick(point(50, 50))).toMatchObject({ kind: 'tree', id: 4, instanceIndex: 1 });
    registerDepth(back, unproject(50, 80), 'person:8');
    sortWorldObjects(v.s);
    v.draw();
    expect(v.picker.pick(point(50, 50))).toMatchObject({ kind: 'person', id: 8 });
  } finally {
    v.dispose();
  }
});
it('rejects the empty padded rectangle beside a real small fir and preserves exact tree identity', () => {
  const v = fixture();
  try {
    const foot = unproject(100, 130),
      batch = new TreeBatch({ summer: 0, autumn: 0, snow: 0 } as any);
    batch.add({ kind: TreeKind.Fir, foot, size: 0.55, slender: 1, lean: 0, variant: 0 });
    const tree = new SceneNode();
    for (const shape of batch.finish(130)) tree.add(shape);
    v.add(rectangle(96, 108, 10, 25), { kind: 'building', id: 1 });
    v.add(tree, { kind: 'tree', id: 2, instanceIndex: 1 }, foot);
    v.draw();
    expect(v.picker.pick(point(100, 122))?.kind).toBe('tree');
    expect(v.picker.pick(point(104, 111))?.kind).toBe('building');
    expect(v.picker.querySelection({ x: 103, y: 109, w: 2, h: 3 }).map((h) => h.kind)).toEqual(['building']);
    v.trees(1);
    v.draw();
    expect(v.picker.selectionGeometry({ kind: 'tree', id: 2, instanceIndex: 1 })).toBeNull();
  } finally {
    v.dispose();
  }
});
it('can select an actual construction stake before the first building wall appears', () => {
  const v = fixture();
  try {
    const footprint = new Footprint(point(3, 3), 0.5);
    v.s.view = new Camera(0, 96, 1);
    paintFields(v.s.farmland, {
      calendar: () => ({ season: 0 }),
      climate: () => ({ snow: 0 }) as any,
      tendedFieldAcres: () => 0,
      fields: () => [],
      buildings: () => [{ id: 1, built: () => false, footprint: () => footprint }],
    });
    v.draw();
    const p = footprint.corners()[0],
      at = v.s.view.toScreen(project(p.x, p.y), 320, 240);
    expect(v.picker.pick(at)).toMatchObject({ kind: 'building', id: 1 });
    expect(v.picker.pick(v.s.view.toScreen(project(3, 3), 320, 240))).toBeNull();
  } finally {
    v.dispose();
  }
});
it('uses the actual bent road stroke and does not select its empty enclosing rectangle', () => {
  const v = fixture();
  try {
    const road = new Road();
    Object.assign(road, { id: 1, line: [point(2, 2), point(4, 2), point(4, 4)], built: 1, paved: true });
    v.roads.push(road);
    v.s.view = new Camera(0, 100, 1);
    v.draw();
    const actual = v.picker.selectionGeometry({ kind: 'road', id: 1 })!.paths![0];
    const onRoad = actual[Math.floor(actual.length / 3)];
    expect(v.picker.pick(onRoad)?.kind).toBe('road');
    const center = v.s.view.toScreen(project(3, 3), 320, 240);
    expect(v.picker.pick(center)).toBeNull();
    expect(v.picker.querySelection({ x: center.x - 2, y: center.y - 2, w: 4, h: 4 })).toEqual([]);
    v.reveal(false);
    v.draw();
    expect(v.picker.selectionGeometry({ kind: 'road', id: 1 })).toBeNull();
  } finally {
    v.dispose();
  }
});
it('reprojects current road feedback without joining its hidden spans or requiring a new presented frame', () => {
  const v = fixture();
  try {
    const road = new Road();
    Object.assign(road, { id: 1, line: [point(2, 2), point(8, 2)], built: 1, paved: true });
    v.roads.push(road);
    v.town.map().revealed = (p) => p.x < 4 || p.x > 6;
    const previousView = new Camera(100, 100, 1);
    v.s.view = previousView;
    v.draw();
    const geometry = v.picker.selectionGeometry({ kind: 'road', id: 1 })!;
    expect(geometry.paths).toHaveLength(2);
    v.s.view = new Camera(120, 140, 2);
    const markers = v.picker.groundSelection(
      [{ key: 'road:1', kind: 'road', hover: false, geometry }],
      v.town,
    );
    expect(markers).toHaveLength(1);
    const current = markers[0].geometry.paths!;
    expect(current).toHaveLength(2);
    for (let i = 0; i < current.length; i++)
      for (let n = 0; n < current[i].length; n++) {
        const world = previousView.toWorld(geometry.paths![i][n], 320, 240),
          expected = v.s.view.toScreen(world, 320, 240),
          tile = unproject(world.x, world.y);
        expect(current[i][n].x).toBeCloseTo(expected.x, 3);
        expect(current[i][n].y).toBeCloseTo(expected.y, 3);
        expect(tile.x < 4 || tile.x > 6).toBe(true);
      }
    expect(v.picker.selectionGeometry({ kind: 'road', id: 1 })).toBe(geometry);
    v.picker.invalidate();
    const restored = v.picker.groundSelection([{ key: 'road:1', kind: 'road', hover: false }], v.town);
    expect(restored[0].geometry.paths).toEqual(current);
    expect(v.picker.selectionGeometry({ kind: 'road', id: 1 })).toBeNull();
  } finally {
    v.dispose();
  }
});
it('publishes frame snapshots only after rendering and clears native/index references on invalidation', () => {
  const v = fixture();
  try {
    const root = v.add(rectangle(40, 40, 20, 20), { kind: 'building', id: 1 });
    expect(v.picker.pick(point(50, 50))).toBeNull();
    v.draw();
    const old = structuredClone(v.picker.selectionGeometry({ kind: 'building', id: 1 }));
    v.picker.beginFrame();
    root.translate(30, 0);
    v.s.scene();
    expect(v.picker.pick(point(50, 50))).toBeNull();
    expect(v.picker.selectionGeometry({ kind: 'building', id: 1 })).toEqual(old);
    v.draw();
    expect(v.picker.pick(point(80, 50))?.id).toBe(1);
    const count = v.s.adapter.retainedPaintCount;
    for (let n = 0; n < 30; n++) {
      v.picker.invalidate();
      v.draw();
      expect(v.s.adapter.retainedPaintCount).toBe(count);
    }
    v.s.objects.remove();
    v.draw();
    expect(v.picker.pick(point(80, 50))).toBeNull();
    expect(v.picker.selectionGeometry({ kind: 'building', id: 1 })).toBeNull();
    expect(v.s.adapter.retainedPaintCount).toBeLessThan(count);
  } finally {
    v.dispose();
  }
});
it('targets the actual high Ymir body while unrevealed volcano and spring stay uninspectable', () => {
  const v = fixture();
  try {
    const ymir = new SceneNode();
    paintYmir(ymir, point(), { snow: 0 } as any, false);
    v.s.view = new Camera(0, -220, 0.4);
    v.add(ymir, { kind: 'landmark', id: 0 }, point());
    v.reveal(false);
    v.draw();
    const geometry = v.picker.selectionGeometry({ kind: 'landmark', id: 0 })!;
    expect(geometry.bounds.y).toBeLessThan(geometry.foot.y - 130);
    let headHit = false;
    for (let y = 10; y < 100 && !headHit; y += 2)
      for (let x = 145; x < 175; x += 2)
        if (v.picker.pick(point(x, y))?.kind === 'landmark') {
          headHit = true;
          break;
        }
    expect(headHit).toBe(true);
    const volcano = new SceneNode();
    paintVolcano(volcano, point(), 5);
    v.add(volcano, { kind: 'landmark', id: 1 }, point());
    v.draw();
    expect(v.picker.selectionGeometry({ kind: 'landmark', id: 1 })).toBeNull();
    v.reveal(true);
    v.draw();
    expect(v.picker.selectionGeometry({ kind: 'landmark', id: 1 })).not.toBeNull();
    v.s.objects.remove();
    const spring = new SceneNode();
    paintHvergelmir(spring, {
      hvergelmir: () => point(),
      seed: () => 5,
      value: (layer: Layer, p: { x: number; y: number }) =>
        layer === Layer.Land ? 1 : 0.2 + Math.hypot(p.x, p.y) * 0.05,
    } as any);
    v.s.view = new Camera(0, 0, 1);
    v.add(spring, { kind: 'landmark', id: 2 }, point());
    v.reveal(false);
    v.draw();
    expect(v.picker.selectionGeometry({ kind: 'landmark', id: 2 })).toBeNull();
    v.reveal(true);
    v.draw();
    expect(v.picker.selectionGeometry({ kind: 'landmark', id: 2 })).not.toBeNull();
  } finally {
    v.dispose();
  }
});
