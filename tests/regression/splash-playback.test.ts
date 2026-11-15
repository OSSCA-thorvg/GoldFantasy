import { afterEach, expect, it, vi } from 'vitest';

const playback = vi.hoisted(() => ({ frames: [] as number[], now: 0 }));
vi.mock('@thorvg/webcanvas', () => {
  class Picture {
    size(...args: number[]) { return args.length ? this : { width: 100, height: 100 }; }
    translate() { return this; }
  }
  class Animation {
    picture = new Picture();
    load() { return this; }
    info() { return { totalFrames: 4, fps: 30 }; }
    frame(frame: number) { playback.frames.push(frame); return this; }
  }
  class Canvas {
    add() { return this; }
    resize() { return this; }
    update() { return this; }
    render() { playback.now += 120; return this; }
  }
  return { default: { init: async () => ({ Animation, Canvas }) } };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([false, true])('keeps slow splash frames unless animation is explicitly off (%s)', async (off) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  playback.frames = [];
  playback.now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => playback.now);
  const scope = { onmessage: undefined as undefined | ((event: unknown) => Promise<void>), postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '{}' }));
  await import('../../apps/web/src/native/splash-worker');
  await scope.onmessage!({ data: { kind: 'start', width: 800, height: 500, canvas: {}, reducedMotion: off } });
  await vi.runAllTimersAsync();
  expect(playback.frames).toEqual(off ? [3] : [0, 1, 2, 3]);
  expect(scope.postMessage).toHaveBeenCalledWith({ kind: 'finished' });
});
