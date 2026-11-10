import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Context, Rect, rgba } from '../../packages/native-ui/src';
import { GameAppState, Plan } from '../../apps/web/src/native/game-app-state';
import { render, type GameRenderApp } from '../../apps/web/src/native/game-render';
import { commandOverlay } from '../../apps/web/src/native/game-commands';
import { toScreen } from '../../apps/web/src/native/game-input';
import { selectionTargets } from '../../apps/web/src/native/selection-targets';
import { selectionFrame } from '../../packages/native-renderer/src/selection-marker';
import { AnimalKind } from '../../packages/engine/src/person';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { parseFontMetrics, type NativeFontMetrics } from '../../packages/native-ui/src/fonts';

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
afterAll(() => {
  tvg?.term();
  vi.unstubAllGlobals();
});

it('composes object selection above world art but beneath HUD panels through the game render loop', () => {
  const width = 320,
    height = 240,
    target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false }),
    context = new Context(tvg, metrics),
    world = new tvg.Shape().appendRect(0, 0, width, height).fill(36, 52, 41),
    animal = { id: 4, animal: AnimalKind.Pig, health: 3, position: point(10, 10) },
    map = { width: () => 40, height: () => 40, revealed: () => true, dungeons: () => [] },
    town = {
      creature: (id: number) => (id === animal.id ? animal : null),
      map: () => map,
      person: () => null,
      isTitleAutoplay: () => false,
    },
    renderer = { visible: () => true, update: () => {} },
    app = new GameAppState(town as any, renderer as any, context) as GameRenderApp;
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
  const frame = selectionFrame(selectionTargets(app)[0].bounds),
    panel = new Rect(frame.x - 10, frame.y - 10, frame.w + 20, frame.h / 2 + 10);
  app.hud = () => context.rect(panel, rgba(50, 80, 120));
  canvas.add(world).add(context.scene());
  const draw = () => {
    render.call(app, width, height, 0, false);
    canvas.update().render();
    return target.pixels.slice();
  };
  try {
    app.selectedAnimal = -1;
    const plain = draw();
    app.selectedAnimal = animal.id;
    const marked = draw();
    let visible = 0,
      overHud = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (plain[i] === marked[i] && plain[i + 1] === marked[i + 1] && plain[i + 2] === marked[i + 2])
          continue;
        if (x > panel.x + 1 && x < panel.x + panel.w - 1 && y > panel.y + 1 && y < panel.y + panel.h - 1)
          overHud++;
        else visible++;
      }
    expect(visible, 'selection corners remain visible over opaque world art').toBeGreaterThan(40);
    expect(overHud, 'world selection must not paint over menus').toBe(0);
    app.selectedAnimal = -1;
    expect(draw(), 'deselection removes all target feedback').toEqual(plain);
  } finally {
    canvas.remove();
    context.dispose();
    world.dispose();
    canvas.destroy();
  }
});
