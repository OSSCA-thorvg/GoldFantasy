import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Town } from '../../packages/engine/src/town';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import { noticeDue, noticeRules, noticeToast, showNotice } from '../../apps/web/src/native/notice-toast';

class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { putImageData() {}, clearRect() {} };
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

describe('how long a notice stays', () => {
  const toast = { notice: '', noticeFrom: 0, noticeUntil: 0 };
  it('shows for ten seconds when nothing else is waiting', () => {
    showNotice(toast, 'Embla crafted Wooden axe', 100);
    expect(toast.noticeUntil - toast.noticeFrom).toBe(10);
    expect(noticeRules.seconds).toBe(10);
    expect(noticeDue(toast, 100 + 9.9, false)).toBe(false);
    expect(noticeDue(toast, 100 + 10, false)).toBe(true);
  });
  it('gives way to a waiting notice, but not before it could be read', () => {
    showNotice(toast, 'Embla crafted Wooden axe', 100);
    expect(noticeDue(toast, 100 + 1, true)).toBe(false);
    expect(noticeDue(toast, 100 + noticeRules.yieldAfter, true)).toBe(true);
    expect(noticeRules.yieldAfter).toBeGreaterThanOrEqual(2);
  });
});

describe('the notice on screen', () => {
  function screen() {
    const width = 1024,
      height = 768,
      canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, {
        width,
        height,
        enableDevicePixelRatio: false,
      }),
      fonts = ['DejaVuSans', 'DejaVuSans-Bold'];
    for (const font of fonts) tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
    const context = new Context(
      tvg,
      Object.fromEntries(
        fonts.map((font) => [
          font,
          parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
        ]),
      ),
    );
    const app = new GameAppState(new Town(5, 32, false), {} as never, context),
      controls = vi.spyOn(context, 'control'),
      words = vi.spyOn(context, 'text');
    app.dockBounds = new Rect(200, 640, 600, 100);
    canvas.add(context.scene());
    return {
      app,
      context,
      words: () => words.mock.calls.map(([, text]) => text),
      toast: () => controls.mock.calls.find(([id]) => id === 'notice'),
      draw(now: number) {
        controls.mockClear();
        words.mockClear();
        context.begin(app.theme, new Rect(0, 0, width, height), now);
        noticeToast(app, width, height);
        context.end();
        canvas.update().render();
      },
      dispose() {
        canvas.remove();
        context.dispose();
        app.campResources.dispose();
        canvas.destroy();
      },
    };
  }
  it('is drawn until its time is up', () => {
    const ui = screen();
    try {
      showNotice(ui.app, 'A den is destroyed', 1);
      ui.draw(1);
      expect(ui.words()).toContain('A den is destroyed');
      ui.draw(10.5);
      expect(ui.words()).toContain('A den is destroyed');
      ui.draw(11.1);
      expect(ui.toast()).toBeUndefined();
    } finally {
      ui.dispose();
    }
  });
  it('goes away at a click, making room for the next one at once', () => {
    const ui = screen();
    try {
      showNotice(ui.app, 'A den is destroyed', 1);
      ui.draw(1.5);
      const [, bounds] = ui.toast()!;
      ui.context.pointerDown(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
      ui.context.pointerUp(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
      expect(noticeDue(ui.app, 1.6, false)).toBe(true);
      ui.draw(1.6);
      expect(ui.toast()).toBeUndefined();
      expect(ui.words()).not.toContain('A den is destroyed');
    } finally {
      ui.dispose();
    }
  });
});
