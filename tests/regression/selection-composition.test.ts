import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Context, Rect, rgba, Theme } from '../../packages/native-ui/src';
import { GameAppState, Plan } from '../../apps/web/src/native/game-app-state';
import { render, type GameRenderApp } from '../../apps/web/src/native/game-render';
import { commandOverlay } from '../../apps/web/src/native/game-commands';
import { toScreen } from '../../apps/web/src/native/game-input';
import { AnimalKind } from '../../packages/engine/src/person';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { parseFontMetrics, type NativeFontMetrics } from '../../packages/native-ui/src/fonts';
import { objectSelectionOverlay } from '../../apps/web/src/native/selection-overlay';
import { WorldRenderer } from '../../packages/native-renderer/src/world-renderer';
import { ShapeNode } from '../../packages/native-renderer/src/paint';
import type { GroundSelectionMarker } from '../../packages/native-renderer/src/world-picking-types';

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
      putImageData: (image: Pixels) => {
        this.pixels = image.data.slice();
      },
      clearRect: () => this.pixels.fill(0),
    };
  }
}
let tvg: ThorVGNamespace;
let metrics: NativeFontMetrics;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const wasm = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${wasm.toString('base64')}`,
  });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  metrics = Object.fromEntries(
    ['DejaVuSans', 'DejaVuSans-Bold'].map((font) => [
      font,
      parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
    ]),
  );
});

it('road feedback follows an L course and never draws its bounding rectangle or crosses hidden gaps', () => {
  const width = 240,
    height = 200,
    target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false });
  const world = groundWorld(width, height),
    background = new tvg.Shape().appendRect(0, 0, width, height).fill(36, 52, 41);
  canvas.add(background).add(world.scene());
  try {
    paintSelection(
      world,
      'road:8',
      {
        foot: point(30, 140),
        bounds: { x: 30, y: 40, w: 150, h: 100 },
        labelAnchor: point(100, 40),
        opacity: 255,
        paths: [
          [point(30, 40), point(30, 140), point(75, 140)],
          [point(130, 140), point(180, 140)],
        ],
      },
      'road',
    );
    canvas.update().render();
    const changed = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return target.pixels[i] !== 36 || target.pixels[i + 1] !== 52 || target.pixels[i + 2] !== 41;
    };
    expect(changed(30, 100)).toBe(true);
    expect(changed(155, 140)).toBe(true);
    expect(changed(100, 140), 'hidden road gap stays unpainted').toBe(false);
    expect(changed(180, 40), 'opposite bounding corner stays unpainted').toBe(false);
    expect(changed(100, 80), 'empty interior stays unpainted').toBe(false);
  } finally {
    canvas.remove();
    world.dispose();
    background.dispose();
    canvas.destroy();
  }
});

it('unit feedback is a foot ellipse rather than an artwork box', () => {
  const width = 240,
    height = 200,
    target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false });
  const world = groundWorld(width, height),
    background = new tvg.Shape().appendRect(0, 0, width, height).fill(36, 52, 41);
  canvas.add(background).add(world.scene());
  try {
    paintSelection(
      world,
      'person:1',
      {
        foot: point(120, 150),
        bounds: { x: 80, y: 50, w: 80, h: 100 },
        labelAnchor: point(120, 50),
        opacity: 255,
        ellipse: { rx: 12, ry: 6 },
      },
      'person',
    );
    canvas.update().render();
    const at = (x: number, y: number) =>
      Array.from(target.pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
    expect(at(132, 150)).not.toEqual([36, 52, 41]);
    expect(at(80, 50)).toEqual([36, 52, 41]);
    expect(at(160, 50)).toEqual([36, 52, 41]);
  } finally {
    canvas.remove();
    world.dispose();
    background.dispose();
    canvas.destroy();
  }
});

it('building feedback uses a ground ellipse instead of a footprint box', () => {
  const width = 240,
    height = 200,
    target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false });
  const world = groundWorld(width, height),
    background = new tvg.Shape().appendRect(0, 0, width, height).fill(36, 52, 41);
  canvas.add(background).add(world.scene());
  try {
    paintSelection(
      world,
      'building:1',
      {
        foot: point(120, 150),
        bounds: { x: 80, y: 50, w: 80, h: 110 },
        labelAnchor: point(120, 50),
        opacity: 255,
        groundOutline: [point(100, 140), point(140, 140), point(140, 160), point(100, 160)],
      },
      'building',
    );
    canvas.update().render();
    const at = (x: number, y: number) =>
      Array.from(target.pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
    expect(at(143, 150)).not.toEqual([36, 52, 41]);
    expect(at(140, 140), 'no footprint-box corner').toEqual([36, 52, 41]);
    expect(at(80, 50), 'no artwork-box corner').toEqual([36, 52, 41]);
  } finally {
    canvas.remove();
    world.dispose();
    background.dispose();
    canvas.destroy();
  }
});

it('shows selected feedback without a second hover label and reads cached hover only when selection is empty', () => {
  const width = 280,
    height = 200,
    target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false });
  const context = nativeContext(),
    world = groundWorld(width, height),
    background = new tvg.Shape().appendRect(0, 0, width, height).fill(36, 52, 41);
  const geometry = (x: number) => ({
    foot: point(x, 150),
    bounds: { x: x - 10, y: 90, w: 20, h: 60 },
    labelAnchor: point(x, 90),
    opacity: 255,
    ellipse: { rx: 12, ry: 6 },
  });
  const people = [
      { id: 1, name: 'Selected', health: 1 },
      { id: 2, name: 'Hovered', health: 1 },
    ],
    pick = vi.fn();
  const town = { person: (id: number) => people.find((p) => p.id === id), map: () => ({}) };
  const app = new GameAppState(
    town as any,
    {
      selectionGeometry: (ref: any) => geometry(ref.id === 1 ? 60 : 220),
      setGroundSelection: (markers: readonly GroundSelectionMarker[]) => world.setGroundSelection(markers),
      pick,
    } as any,
    context,
  ) as any;
  app.chosen = [1];
  app.mouse = point(220, 150);
  app.viewWidth = width;
  app.viewHeight = height;
  app.hoveredWorldTarget = {
    screen: { ...app.mouse },
    hit: { kind: 'person', id: 2, key: 'person:2', drawRank: 2, frameId: 1, geometry: geometry(220) },
  };
  canvas.add(background).add(world.scene()).add(context.scene());
  const draw = () => {
    context.begin(Theme.dark(), new Rect(0, 0, width, height), 0);
    objectSelectionOverlay(app);
    context.end();
    canvas.update().render();
  };
  const at = (x: number, y: number) =>
    Array.from(target.pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
  try {
    draw();
    expect(at(72, 150)).not.toEqual([36, 52, 41]);
    expect(at(232, 150)).toEqual([36, 52, 41]);
    app.chosen = [];
    draw();
    expect(at(232, 150)).not.toEqual([36, 52, 41]);
    expect(at(72, 150)).toEqual([36, 52, 41]);
    expect(pick).not.toHaveBeenCalled();
  } finally {
    canvas.remove();
    context.dispose();
    world.dispose();
    background.dispose();
    canvas.destroy();
  }
});
afterAll(() => {
  tvg?.term();
  vi.unstubAllGlobals();
});
function nativeContext(): Context {
  // Each isolated Canvas fixture registers its own font resources.
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  return new Context(tvg, metrics);
}

it('composes ground selection before world objects and keeps labels beneath HUD panels', () => {
  const width = 320,
    height = 240,
    target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false }),
    context = nativeContext(),
    world = groundWorld(width, height),
    body = new ShapeNode().appendRect(170, 102, 20, 30).fill(90, 40, 36),
    animal = { id: 4, animal: AnimalKind.Pig, health: 3, position: point(10, 10) },
    map = { width: () => 40, height: () => 40, revealed: () => true, dungeons: () => [] },
    town = {
      creature: (id: number) => (id === animal.id ? animal : null),
      map: () => map,
      person: () => null,
      isTitleAutoplay: () => false,
    },
    renderer = {
      visible: () => true,
      update: () => {},
      setGroundSelection: (markers: readonly GroundSelectionMarker[]) => world.setGroundSelection(markers),
      selectionGeometry: () => ({
        foot: point(160, 120),
        bounds: { x: 140, y: 76, w: 40, h: 48 },
        labelAnchor: point(160, 76),
        ellipse: { rx: 16, ry: 6 },
        opacity: 255,
      }),
    },
    app = new GameAppState(town as any, renderer as any, context) as GameRenderApp;
  world.background.appendRect(0, 0, width, height).fill(36, 52, 41);
  const center = project(10, 10);
  app.camera = new Camera(center.x, center.y);
  app.viewWidth = width;
  app.viewHeight = height;
  app.selectedAnimal = animal.id;
  app.editor = null;
  app.atlas = null;
  app.buildings = null;
  app.editorDecision = null;
  app.mapDecision = null;
  app.speakers = new Map();
  app.reducedMotion = () => false;
  app.plan = () => new Plan();
  app.speechBubbles = () => {};
  app.targetingCursor = () => false;
  app.commandOverlay = () => commandOverlay.call(app);
  app.toScreen = (at) => toScreen.call(app, at);
  const panel = new Rect(135, 124, 35, 14);
  app.hud = () => context.rect(panel, rgba(50, 80, 120));
  // A native world object is after the ground marker, before the HUD.
  world.objects.add(body);
  canvas.add(world.scene()).add(context.scene());
  const draw = () => {
    render.call(app, width, height, 0, false);
    canvas.update().render();
    return target.pixels.slice();
  };
  const rgb = (pixels: Uint8ClampedArray, x: number, y: number) =>
    Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3));
  try {
    app.selectedAnimal = -1;
    const plain = draw();
    app.selectedAnimal = animal.id;
    const marked = draw();
    expect(rgb(marked, 144, 120), 'uncovered ground still shows the ring').not.toEqual(rgb(plain, 144, 120));
    expect(rgb(marked, 176, 120), 'world artwork covers the ring').toEqual([90, 40, 36]);
    expect(rgb(marked, 160, 126), 'HUD panels cover ground feedback').toEqual([50, 80, 120]);
    app.selectedAnimal = -1;
    expect(draw(), 'deselection removes target feedback').toEqual(plain);
  } finally {
    canvas.remove();
    context.dispose();
    world.dispose();
    canvas.destroy();
  }
});

function groundWorld(width: number, height: number): WorldRenderer {
  const world = new WorldRenderer(tvg);
  world.viewWidth = width;
  world.viewHeight = height;
  world.view = new Camera(width / 2, height / 2, 1);
  return world;
}
function paintSelection(
  world: WorldRenderer,
  key: string,
  geometry: GroundSelectionMarker['geometry'],
  kind: GroundSelectionMarker['kind'],
): void {
  world.setGroundSelection([{ key, kind, geometry, hover: false }]);
}
