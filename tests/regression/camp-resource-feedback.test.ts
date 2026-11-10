import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Context, Rect, Theme } from '../../packages/native-ui/src';
import { parseFontMetrics, type NativeFontMetrics } from '../../packages/native-ui/src/fonts';
import { CampResourceHud } from '../../apps/web/src/native/camp-resource-hud';
import { resourceIcons } from '../../apps/web/src/native/hud-assets';
import { CampReceipt } from '../../packages/engine/src/camp-economy';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
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
      putImageData: (image: Pixels) => {
        this.pixels = image.data.slice();
      },
      clearRect: () => this.pixels.fill(0),
    };
  }
}
let tvg: ThorVGNamespace, metrics: NativeFontMetrics;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
  metrics = {};
  for (const name of ['DejaVuSans', 'DejaVuSans-Bold']) {
    const data = new Uint8Array(readFileSync(`public/assets/native-fonts/${name}.ttf`));
    tvg.Font.load(name, data);
    metrics[name] = parseFontMetrics(data);
  }
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

it('shows credited quantities and preserves deliveries queued while the same resource is still visible', () => {
  const surface = new MemoryCanvas(640, 480),
    canvas = new tvg.Canvas(surface as unknown as OffscreenCanvas, {
      width: 640,
      height: 480,
      enableDevicePixelRatio: false,
    }),
    context = new Context(tvg, metrics),
    hud = new CampResourceHud(),
    theme = Theme.dark(),
    viewport = new Rect(0, 0, 640, 480),
    labels: { text: string; bounds: Rect }[] = [],
    observed = new Set<string>();
  let time = 0,
    receipts: CampReceipt[] = [];
  const town = {
    receipts: () => receipts,
    clock: () => time,
    camp: () => ({ kind: Structure.Camp }),
  } as unknown as Town;
  const text = context.text.bind(context);
  context.text = (bounds, value, color, ...rest) => {
    if (
      value.startsWith('+') &&
      color.r === theme.accent.r &&
      color.g === theme.accent.g &&
      color.b === theme.accent.b
    ) {
      labels.push({ text: value, bounds: new Rect(bounds.x, bounds.y, bounds.w, bounds.h) });
      observed.add(value);
    }
    return text(bounds, value, color, ...rest);
  };
  canvas.add(context.scene());
  const draw = (now: number) => {
    time = now;
    labels.length = 0;
    context.begin(theme, viewport, now);
    hud.draw(context, theme, town, [{ camp: 0, roof: { x: 320, y: 230 } }], -1, viewport, false);
    context.end();
    canvas.update().render();
    for (let a = 0; a < labels.length; a++)
      for (let b = a + 1; b < labels.length; b++) {
        const x = labels[a].bounds,
          y = labels[b].bounds;
        expect(
          x.x < y.x + y.w && x.x + x.w > y.x && x.y < y.y + y.h && x.y + x.h > y.y,
          'simultaneous credited quantities must not overlap',
        ).toBe(false);
      }
  };
  try {
    draw(0);
    receipts.push(new CampReceipt(1n, 0, new Resources(0, 1, 2, 0, 0, 0, 3, 4), 0.1));
    draw(0.1);
    receipts.push(new CampReceipt(2n, 0, new Resources(0, 2), 0.2));
    draw(0.2);
    receipts.push(new CampReceipt(3n, 0, new Resources(0, 3), 0.3));
    draw(0.3);
    for (const now of [0.6, 0.9, 1.2, 1.5, 1.8, 2.1]) {
      draw(now);
      if (process.env.CAPTURE_RESOURCE_FEEDBACK && now === 1.5) {
        mkdirSync('artifacts/resource-feedback', { recursive: true });
        writeFileSync('artifacts/resource-feedback/quantities-640x480.rgba', surface.pixels);
      }
    }
    expect([...observed].sort()).toEqual(['+1', '+2', '+3', '+4', '+5']);
  } finally {
    canvas.remove();
    context.dispose();
    hud.dispose();
    canvas.destroy();
  }
});

it('renders sawn boards and dressed blocks differently from logs and unprocessed rock', () => {
  const surface = new MemoryCanvas(96, 96),
    canvas = new tvg.Canvas(surface as unknown as OffscreenCanvas, {
      width: 96,
      height: 96,
      enableDevicePixelRatio: false,
    }),
    signatures = new Map<number, string>();
  try {
    for (const kind of [1, 2, 9, 10]) {
      const animation = new tvg.Animation().load(resourceIcons[kind]);
      try {
        animation.picture.size(96, 96);
        canvas.add(animation.picture);
        animation.frame(0);
        canvas.update().render();
        expect(surface.pixels.some((v, i) => i % 4 === 3 && v > 32)).toBe(true);
        signatures.set(kind, createHash('sha256').update(surface.pixels).digest('hex'));
        if (process.env.CAPTURE_RESOURCE_FEEDBACK) {
          mkdirSync('artifacts/resource-feedback', { recursive: true });
          writeFileSync(`artifacts/resource-feedback/icon-${kind}-96x96.rgba`, surface.pixels);
        }
      } finally {
        canvas.remove();
        animation.dispose();
      }
    }
    expect(new Set(signatures.values()).size).toBe(4);
  } finally {
    canvas.destroy();
  }
});
