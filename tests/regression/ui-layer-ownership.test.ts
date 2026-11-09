import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Context, Rect, Theme, rgba } from '../../packages/native-ui/src';

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
  getContext(kind: string) {
    if (kind !== '2d') throw Error('Expected software canvas');
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
  const wasm = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${wasm.toString('base64')}`,
  });
});
afterAll(() => {
  tvg?.term();
  vi.unstubAllGlobals();
});
it('keeps unique Paint ownership when retained icons move between dynamic nested clips', () => {
  const canvas = new tvg.Canvas(new OffscreenCanvas(160, 120), {
      width: 160,
      height: 120,
      enableDevicePixelRatio: false,
    }),
    context = new Context(tvg, {}),
    theme = Theme.dark(),
    viewport = new Rect(0, 0, 160, 120);
  const paints = Array.from({ length: 10 }, (_, i) =>
    new tvg.Shape().appendRect(i * 12, 4, 10, 10).fill(30 + i * 20, 120, 80),
  );
  canvas.add(context.scene());
  let random = 7,
    frame = 0;
  const roll = (n: number) => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random % n;
  };
  try {
    for (frame = 0; frame < 500; ++frame) {
      const groups = Array.from({ length: 5 }, () => [] as number[]);
      for (let i = 0; i < 40; ++i) groups[roll(5)].push(roll(paints.length));
      context.begin(theme, viewport, frame / 60);
      const draw = (group: number) => {
        for (let j = 0; j < roll(4); ++j)
          context.rect(new Rect(j * 15, 20 + group * 15, 14, 14), rgba(roll(255), 80, 90));
        for (const i of groups[group]) context.add(paints[i]);
      };
      draw(0);
      context.clip(new Rect(0, 0, 150, 110), () => {
        draw(1);
        context.clip(new Rect(0, 0, 140, 100), () => draw(2));
        draw(3);
      });
      context.clip(new Rect(0, 0, 130, 90), () => draw(4));
      context.end();
      canvas.update().render();
    }
  } catch (error) {
    throw new Error('Frame ' + frame + ': ' + String(error), { cause: error });
  } finally {
    canvas.remove();
    context.dispose();
    for (const paint of paints) paint.dispose();
    canvas.destroy();
  }
});

it('reuses animated camp receipt icons across changed clipped HUD layouts', async () => {
  const { CampResourceHud } = await import('../../apps/web/src/native/camp-resource-hud');
  const { parseFontMetrics } = await import('../../packages/native-ui/src/fonts');
  const { Structure } = await import('../../packages/engine/src/building-catalog');
  const { Resources } = await import('../../packages/engine/src/building-catalog');
  const { CampReceipt } = await import('../../packages/engine/src/camp-economy');
  const { Theme } = await import('../../packages/native-ui/src/theme');
  const metrics: any = {};
  for (const name of ['DejaVuSans', 'DejaVuSans-Bold']) {
    const bytes = new Uint8Array(readFileSync(`public/assets/native-fonts/${name}.ttf`));
    tvg.Font.load(name, bytes);
    metrics[name] = parseFontMetrics(bytes);
  }
  const canvas = new tvg.Canvas(new OffscreenCanvas(640, 480), {
      width: 640,
      height: 480,
      enableDevicePixelRatio: false,
    }),
    context = new Context(tvg, metrics),
    hud = new CampResourceHud(),
    theme = Theme.dark(),
    viewport = new Rect(0, 0, 640, 480);
  let receipts: any[] = [],
    clock = 0;
  const town = {
    receipts: () => receipts,
    clock: () => clock,
    camp: () => ({ kind: Structure.Camp }),
    stock: () => new Resources(100, 100, 100, 100, 100, 100),
    capacity: () => new Resources(100, 100, 100, 100, 100, 100),
    renown: () => 10,
    population: () => 2,
    guests: () => 1,
    housing: () => 4,
    guestBeds: () => 2,
  } as any;
  const marker = [{ camp: 0, roof: { x: 200, y: 180 } }];
  canvas.add(context.scene());
  try {
    for (let frame = 0; frame < 600; ++frame) {
      clock = frame * 0.1;
      if (frame % 7 === 0) {
        const gain = new Resources();
        gain[['gold', 'wood', 'stone', 'food', 'water', 'mana'][frame % 6] as keyof Resources] = 1 as never;
        receipts = [new CampReceipt(BigInt(frame), 0, gain, clock, 0, 0, 0)];
      }
      context.begin(theme, viewport, clock);
      if (frame % 3 === 0)
        context.clip(new Rect(0, 0, 500, 400), () =>
          context.rect(new Rect(5, 5, 100, 30), rgba(80, 90, 100)),
        );
      context.rect(new Rect(frame % 5, 30, 100, 10), rgba(80, 150, 120));
      hud.draw(context, theme, town, marker, frame % 5 === 0 ? 0 : -1, new Rect(0, 50, 640, 430), false);
      context.end();
      canvas.update().render();
    }
  } finally {
    canvas.remove();
    context.dispose();
    hud.dispose();
    canvas.destroy();
  }
});

function references(paint: { ptr: number }): number {
  const module = (
    globalThis as unknown as {
      __ThorVGModule: {
        _tvg_paint_ref: (ptr: number) => number;
        _tvg_paint_unref: (ptr: number, free: number) => number;
      };
    }
  ).__ThorVGModule;
  const count = module._tvg_paint_ref(paint.ptr) - 1;
  module._tvg_paint_unref(paint.ptr, 0);
  return count;
}
it('retains one wrapper reference before attachment and releases only scene ownership on removal', () => {
  const scene = new tvg.Scene(),
    paint = new tvg.Shape().appendRect(0, 0, 8, 8).fill(255, 0, 0);
  try {
    expect(references(paint)).toBe(1);
    scene.add(paint);
    expect(references(paint)).toBe(2);
    scene.remove(paint);
    expect(references(paint)).toBe(1);
    expect(() => paint.opacity(200)).not.toThrow();
  } finally {
    scene.remove();
    scene.dispose();
    paint.dispose();
  }
});
it('keeps reference counts bounded through 70,000 retained UI reorderings', () => {
  const context = new Context(tvg, {}),
    theme = Theme.dark(),
    view = new Rect(0, 0, 100, 100),
    a = new tvg.Shape().appendRect(0, 0, 8, 8).fill(255, 0, 0),
    b = new tvg.Shape().appendRect(20, 0, 8, 8).fill(0, 255, 0);
  try {
    for (let frame = 0; frame < 70000; ++frame) {
      context.begin(theme, view, frame);
      context.add(frame % 2 ? a : b);
      context.add(frame % 2 ? b : a);
      context.end();
      if (frame < 3 || frame % 10000 === 0 || frame === 69999) {
        expect(references(a), `frame ${frame}`).toBe(2);
        expect(references(b), `frame ${frame}`).toBe(2);
      }
    }
  } finally {
    context.dispose();
    a.dispose();
    b.dispose();
  }
});

it('balances 70,000 clip and mask replacements without losing wrapper ownership', () => {
  const paint = new tvg.Shape().appendRect(0, 0, 20, 20).fill(255, 0, 0),
    clip = new tvg.Shape().appendRect(0, 0, 10, 20).fill(255, 255, 255),
    mask = new tvg.Shape().appendRect(0, 0, 20, 10).fill(255, 255, 255);
  try {
    for (let frame = 0; frame < 70000; ++frame) {
      paint.clip(clip);
      paint.mask(mask, tvg.MaskMethod.Alpha);
      if (frame < 3 || frame % 10000 === 0 || frame === 69999) {
        expect(references(clip)).toBe(2);
        expect(references(mask)).toBe(2);
      }
    }
    paint.dispose();
    expect(references(clip)).toBe(1);
    expect(references(mask)).toBe(1);
  } finally {
    paint.dispose();
    clip.dispose();
    mask.dispose();
  }
});
it('keeps borrowed animation pictures owned by their animation through repeated scene moves', async () => {
  const asset = (await import('../../packages/native-ui/assets/game/resource-wood.json')).default;
  const canvas = new tvg.Canvas(new OffscreenCanvas(64, 64), {
      width: 64,
      height: 64,
      enableDevicePixelRatio: false,
    }),
    animation = new tvg.Animation().load(JSON.stringify(asset)),
    scene = new tvg.Scene(),
    picture = animation.picture!;
  try {
    expect(references(picture)).toBe(1);
    for (let frame = 0; frame < 70000; ++frame) {
      scene.add(picture);
      if (frame < 3 || frame % 10000 === 0 || frame === 69999) expect(references(picture)).toBe(2);
      scene.remove(picture);
    }
    expect(references(picture)).toBe(1);
    animation.frame(2);
    scene.add(picture);
    canvas.add(scene);
    expect(() => canvas.update().render()).not.toThrow();
  } finally {
    canvas.remove();
    scene.remove();
    scene.dispose();
    animation.dispose();
    canvas.destroy();
  }
});
it('balances Canvas attachment and preserves independently owned duplicates', () => {
  const canvas = new tvg.Canvas(new OffscreenCanvas(40, 40), {
      width: 40,
      height: 40,
      enableDevicePixelRatio: false,
    }),
    source = new tvg.Shape().appendRect(1, 1, 10, 10).fill(255, 0, 0),
    duplicate = source.duplicate();
  try {
    expect(references(source)).toBe(1);
    expect(references(duplicate)).toBe(1);
    for (let frame = 0; frame < 70000; ++frame) {
      canvas.add(source);
      if (frame < 3 || frame % 10000 === 0 || frame === 69999) expect(references(source)).toBe(2);
      canvas.remove(source);
    }
    expect(references(source)).toBe(1);
    source.dispose();
    canvas.add(duplicate);
    expect(() => canvas.update().render()).not.toThrow();
    canvas.remove(duplicate);
    expect(references(duplicate)).toBe(1);
  } finally {
    canvas.remove();
    source.dispose();
    duplicate.dispose();
    canvas.destroy();
  }
});

it('applies the SDK compatibility patch idempotently and rejects unexpected versions or contents', async () => {
  const { patchWebCanvas } = await import('../../scripts/patch-webcanvas.mjs');
  const { mkdtemp, writeFile, mkdir, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  expect(await patchWebCanvas()).toEqual([]);
  const folder = await mkdtemp(join(tmpdir(), 'midgard-webcanvas-ownership-')),
    url = pathToFileURL(folder + '/');
  try {
    await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '9.9.9' }));
    await expect(patchWebCanvas(url)).rejects.toThrow('Review');
    await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '1.1.3' }));
    await mkdir(join(folder, 'dist'));
    const unexpected = 'unexpected SDK bytes';
    await writeFile(join(folder, 'dist/webcanvas.esm.js'), unexpected);
    await expect(patchWebCanvas(url)).rejects.toThrow('Unexpected WebCanvas contents');
    expect(await readFile(join(folder, 'dist/webcanvas.esm.js'), 'utf8')).toBe(unexpected);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

it('keeps the same clipped HUD scene alive across 70,000 prefix changes', () => {
  const canvas = new tvg.Canvas(new OffscreenCanvas(40, 40), {
      width: 40,
      height: 40,
      enableDevicePixelRatio: false,
    }),
    context = new Context(tvg, {}),
    theme = Theme.dark(),
    view = new Rect(0, 0, 40, 40);
  canvas.add(context.scene());
  let retained: ReturnType<Context['layer']> = null;
  try {
    for (let frame = 0; frame < 70000; ++frame) {
      context.begin(theme, view, frame);
      // Changing preceding content makes syncLayer detach and reinsert the
      // retained clip before CampResourceHud-style drawing begins.
      context.rect(new Rect(frame % 2, 0, 8, 8), rgba(180, 90, 40));
      const layer = context.layer(new Rect(2, 2, 30, 30), () => {
        context.rect(new Rect(5, 5, 10, 10), rgba(60, 150, 90));
      });
      context.end();
      if (!retained) retained = layer;
      expect(layer).toBe(retained);
      if (frame < 3 || frame % 10000 === 0 || frame === 69999) {
        expect(references(layer!), `clipped HUD scene at frame ${frame}`).toBe(2);
        expect(() => canvas.update().render()).not.toThrow();
      }
    }
  } finally {
    canvas.remove();
    context.dispose();
    canvas.destroy();
  }
});
