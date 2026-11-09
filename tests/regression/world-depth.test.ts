import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Town } from '../../packages/engine/src/town';
import { Camera, Footprint, point, project } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import { Preview } from '../../packages/engine/src/game-tools';
import { treeAt } from '../../packages/native-renderer/src/tree-painter';
import {
  footprintBaseline,
  groundBaseline,
  compareBaselines,
  registerDepth,
  sortWorldObjects,
} from '../../packages/native-renderer/src/world-depth';
import { Terrain, DungeonKind } from '../../packages/engine/src/world-types';
import { Monster, AnimalKind } from '../../packages/engine/src/person';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { Rect } from '../../packages/native-ui/src/types';
import { WorldRenderer } from '../../packages/native-renderer/src/world-renderer';
import { SceneNode, type PaintNode } from '../../packages/native-renderer/src/paint';
class PixelBuffer {
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
      putImageData: (image: PixelBuffer) => (this.pixels = image.data.slice()),
      clearRect: () => this.pixels.fill(0),
    };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', PixelBuffer);
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
const flatten = (p: PaintNode): PaintNode[] => [
  p,
  ...(p instanceof SceneNode ? p.children.flatMap(flatten) : []),
];
it('sorts overlapping residents by continuous ground position even within the same tile row', () => {
  const town = new Town(5, 64),
    target = new MemoryCanvas(640, 480);
  const canvas = new tvg.Canvas(target as any, { width: 640, height: 480, enableDevicePixelRatio: false });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const renderer = new WorldRenderer(tvg),
    traffic = new Traffic(5),
    preview = new Preview();
  canvas.add(renderer.scene());
  try {
    const [front, back] = town.folk;
    front.position = point(14, 14.65);
    back.position = point(14, 14.15);
    for (const p of town.folk) {
      p.entrance = { ...p.position };
      p.threshold = { ...p.position };
    }
    town.scout(14, 14, 10);
    const center = project(14, 14),
      camera = new Camera(center.x, center.y, 3);
    renderer.update(town, traffic, camera, 640, 480, 0, preview, []);
    canvas.update().render();
    let order = flatten(renderer.objects),
      a = renderer.figures.get(back.id)!.paint,
      b = renderer.figures.get(front.id)!.paint;
    expect(order.indexOf(a), 'the rear resident must be painted before the front resident').toBeLessThan(
      order.indexOf(b),
    );
    back.position = point(14, 14.85);
    renderer.update(town, traffic, camera, 640, 480, 0.1, preview, []);
    canvas.update().render();
    order = flatten(renderer.objects);
    expect(
      order.indexOf(b),
      'crossing the other resident must update order without waiting for a tile-row change',
    ).toBeLessThan(order.indexOf(a));
  } finally {
    canvas.remove();
    renderer.dispose();
    canvas.destroy();
  }
});

it('uses the near-horizontal footprint diagonal at every building orientation', () => {
  for (const angle of [0, 0.2, 0.6, Math.PI / 4, 1.2, Math.PI / 2, 2.4]) {
    const footprint = new Footprint(point(12, 14), 1.5, angle),
      baseline = footprintBaseline(footprint);
    const corners = footprint.corners().map((p) => project(p.x, p.y));
    const other =
      baseline.left.x === corners[0].x || baseline.right.x === corners[0].x
        ? [corners[1], corners[3]]
        : [corners[0], corners[2]];
    const slope = Math.abs((baseline.right.y - baseline.left.y) / (baseline.right.x - baseline.left.x));
    const otherSlope = Math.abs((other[1].y - other[0].y) / (other[1].x - other[0].x || 1e-9));
    expect(slope).toBeLessThanOrEqual(otherSlope + 1e-5);
    const x = (baseline.left.x + baseline.right.x) / 2,
      y = (baseline.left.y + baseline.right.y) / 2;
    expect(compareBaselines({ left: { x, y: y - 1 }, right: { x, y: y - 1 } }, baseline)).toBeLessThan(0);
    expect(compareBaselines({ left: { x, y: y + 1 }, right: { x, y: y + 1 } }, baseline)).toBeGreaterThan(0);
  }
});
it('interleaves trees, residents, monsters and animals by their foot positions', () => {
  const town = new Town(5, 64),
    target = new MemoryCanvas(640, 480),
    canvas = new tvg.Canvas(target as any, { width: 640, height: 480, enableDevicePixelRatio: false });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const renderer = new WorldRenderer(tvg),
    traffic = new Traffic(5),
    preview = new Preview();
  canvas.add(renderer.scene());
  try {
    for (let x = 0; x <= 28; x++) {
      const tile = town.world.at(x, 28 - x);
      tile.trees = 0;
      tile.terrain = Terrain.Grass;
      tile.quarried = true;
    }
    town.world.at(14, 14).trees = 1;
    const tree = treeAt(town.world, 14, 14, 0),
      p = town.folk[0];
    town.folk = [p];
    p.position = point(tree.foot.x - 0.06, tree.foot.y - 0.06);
    p.entrance = { ...p.position };
    p.threshold = { ...p.position };
    const beast = new Monster(101, 0, point(tree.foot.x + 0.12, tree.foot.y + 0.12)),
      animal = new Monster(102, 0, point(tree.foot.x + 0.06, tree.foot.y + 0.06));
    animal.animal = AnimalKind.Cow;
    town.beasts = [beast];
    town.animals = [animal];
    town.world.dungeons()[0].kind = DungeonKind.Cave;
    town.scout(tree.foot.x, tree.foot.y, 10);
    const center = project(tree.foot.x, tree.foot.y),
      camera = new Camera(center.x, center.y, 3);
    renderer.update(town, traffic, camera, 640, 480, 0, preview, []);
    canvas.update().render();
    const order = flatten(renderer.objects),
      treePaint = renderer.rowTrees[28].children[0];
    const paints = [
      renderer.figures.get(p.id)!.paint,
      treePaint,
      renderer.beasts.get(animal.id)!.paint,
      renderer.beasts.get(beast.id)!.paint,
    ];
    for (let i = 1; i < paints.length; i++)
      expect(order.indexOf(paints[i - 1])).toBeLessThan(order.indexOf(paints[i]));
    const first = renderer.objects.children.slice();
    renderer.update(town, traffic, camera, 640, 480, 0.1, preview, []);
    expect(renderer.objects.children).toEqual(first);
  } finally {
    canvas.remove();
    renderer.dispose();
    canvas.destroy();
  }
});

it('orders opposite building corners without a non-transitive global-sort flip', () => {
  const state = new WorldRendererState(tvg),
    building = new SceneNode(),
    front = new SceneNode(),
    back = new SceneNode();
  const footprint = new Footprint(point(10, 10), 2, 0.2),
    fromScreen = (x: number, y: number) => point(10 + (x / 32 + y / 16) / 2, 10 + (y / 16 - x / 32) / 2);
  const a = fromScreen(-120, -7),
    b = fromScreen(120, 7);
  expect(footprint.contains(a)).toBe(false);
  expect(footprint.contains(b)).toBe(false);
  registerDepth(building, footprint, 'building', new Rect(-130, 220, 260, 180));
  registerDepth(front, a, 'front', new Rect(-130, 280, 20, 40));
  registerDepth(back, b, 'back', new Rect(110, 294, 20, 40));
  state.rowBuildings = [new SceneNode().add(building)];
  state.rows = [new SceneNode().add(front).add(back)];
  state.view = new Camera(0, 320, 1);
  state.viewWidth = 640;
  state.viewHeight = 480;
  sortWorldObjects(state);
  expect(state.objects.children.indexOf(back)).toBeLessThan(state.objects.children.indexOf(building));
  expect(state.objects.children.indexOf(building)).toBeLessThan(state.objects.children.indexOf(front));
  state.adapter.dispose();
});
