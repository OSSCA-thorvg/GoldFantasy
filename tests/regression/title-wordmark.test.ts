import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';

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
function renderWordmark() {
  const target = new MemoryCanvas(1120, 256),
    canvas = new tvg.Canvas(target as any, { width: 1120, height: 256, enableDevicePixelRatio: false });
  const picture = new tvg.Picture()
    .load(readFileSync('apps/web/src/native/assets/midgard-wordmark.svg', 'utf8'), { type: 'svg' })
    .size(1120, 256);
  try {
    canvas.add(picture);
    canvas.update().render();
    if (process.env.CAPTURE_VISUALS) {
      mkdirSync('artifacts/title-seams', { recursive: true });
      writeFileSync('artifacts/title-seams/wordmark-1120x256.rgba', target.pixels);
    }
    return target.pixels.slice();
  } finally {
    canvas.remove();
    picture.dispose();
    canvas.destroy();
  }
}
function pixel(pixels: Uint8ClampedArray, x: number, y: number) {
  const i = (Math.floor(y / 5) * 1120 + Math.floor(x / 5)) * 4;
  return [...pixels.slice(i, i + 4)];
}
it('keeps a continuous gold face where the original Cinzel stem and serif contours overlap', () => {
  const pixels = renderWordmark();
  for (const [name, seam, interior] of [
    ['I bottom serif', [1195, 900], [1250, 900]],
    ['first D top', [1718, 270], [1770, 270]],
    ['last D top', [4938, 270], [4990, 270]],
  ] as const) {
    const actual = pixel(pixels, ...seam),
      expected = pixel(pixels, ...interior);
    for (let channel = 0; channel < 4; channel++)
      expect(
        Math.abs(actual[channel] - expected[channel]),
        `${name}: no internal dark outline`,
      ).toBeLessThanOrEqual(2);
  }
});
it('preserves the D, A and R counters and the title ornaments', () => {
  const pixels = renderWordmark();
  for (const [x, y] of [
    [1900, 601],
    [3510, 650],
    [4270, 430],
    [5120, 601],
  ])
    expect(pixel(pixels, x, y)[3]).toBe(0);
  for (const [x, y] of [
    [1250, 600],
    [2800, 1138],
    [2800, 92],
  ])
    expect(pixel(pixels, x, y)[3]).toBeGreaterThan(200);
});
