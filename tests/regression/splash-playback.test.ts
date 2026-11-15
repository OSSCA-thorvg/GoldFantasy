import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const playback = vi.hoisted(() => ({
  frames: [] as number[], now: 0,
  loading: undefined as Promise<void> | undefined,
  surfaces: [] as { width: number; height: number }[],
  picture: { width: 200, height: 100, x: 0, y: 0 },
}));
vi.mock('@thorvg/webcanvas', () => {
  class Picture {
    size(...args: number[]) {
      if (!args.length) return { width: playback.picture.width, height: playback.picture.height };
      [playback.picture.width, playback.picture.height] = args;
      return this;
    }
    translate(x: number, y: number) { Object.assign(playback.picture, { x, y }); return this; }
  }
  class Animation {
    picture = new Picture();
    load() { return this; }
    info() { return { totalFrames: 4, fps: 30 }; }
    frame(frame: number) { playback.frames.push(frame); return this; }
  }
  class Canvas {
    constructor(_target: unknown, size: { width: number; height: number }) {
      playback.surfaces.push({ width: size.width, height: size.height });
    }
    add() { return this; }
    resize(width: number, height: number) {
      Object.assign(playback.surfaces.at(-1)!, { width, height });
      return this;
    }
    update() { return this; }
    render() { playback.now += 120; return this; }
  }
  return { default: { init: async () => { await playback.loading; return { Animation, Canvas }; } } };
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  playback.frames = [];
  playback.now = 0;
  playback.loading = undefined;
  playback.surfaces = [];
  playback.picture = { width: 200, height: 100, x: 0, y: 0 };
  vi.spyOn(performance, 'now').mockImplementation(() => playback.now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each([false, true])('keeps slow splash frames unless animation is explicitly off (%s)', async (off) => {
  const scope = { onmessage: undefined as undefined | ((event: unknown) => Promise<void>), postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '{}' }));
  await import('../../apps/web/src/native/splash-worker');
  await scope.onmessage!({ data: { kind: 'start', width: 800, height: 500, canvas: {}, reducedMotion: off } });
  await vi.runAllTimersAsync();
  expect(playback.frames).toEqual(off ? [3] : [0, 1, 2, 3]);
  expect(scope.postMessage).toHaveBeenCalledWith({ kind: 'finished' });
});

it('uses the latest size when the viewport changes while WASM is still loading', async () => {
  let release!: () => void;
  playback.loading = new Promise<void>((resolve) => { release = resolve; });
  const scope = { onmessage: undefined as undefined | ((event: unknown) => Promise<void>), postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '{}' }));
  await import('../../apps/web/src/native/splash-worker');
  const starting = scope.onmessage!({ data: { kind: 'start', width: 800, height: 500, canvas: {}, reducedMotion: false } });
  await scope.onmessage!({ data: { kind: 'resize', width: 600, height: 1000 } });
  expect(playback.surfaces).toEqual([]);
  release();
  await starting;
  expect(playback.surfaces).toEqual([{ width: 600, height: 1000 }]);
  expect(playback.picture).toEqual({ width: 600, height: 300, x: 0, y: 350 });
  expect(playback.frames).toEqual([0]);
});

it.each([false, true])('resizes the current frame without restarting or skipping playback (off=%s)', async (off) => {
  const scope = { onmessage: undefined as undefined | ((event: unknown) => Promise<void>), postMessage: vi.fn() };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('fetch', async () => ({ ok: true, text: async () => '{}' }));
  await import('../../apps/web/src/native/splash-worker');
  await scope.onmessage!({ data: { kind: 'start', width: 800, height: 500, canvas: {}, reducedMotion: off } });
  if (!off) await vi.advanceTimersToNextTimerAsync();
  for (const [width, height] of [[300, 700], [1000, 300], [800, 500]]) {
    await scope.onmessage!({ data: { kind: 'resize', width, height } });
    expect(playback.frames.at(-1)).toBe(off ? 3 : 1);
    expect(playback.surfaces).toEqual([{ width, height }]);
  }
  expect(playback.picture).toEqual({ width: 800, height: 400, x: 0, y: 50 });
  await vi.runAllTimersAsync();
  expect(playback.frames).toEqual(off ? [3, 3, 3, 3] : [0, 1, 1, 1, 1, 2, 3]);
  await scope.onmessage!({ data: { kind: 'resize', width: 640, height: 360 } });
  expect(playback.frames.at(-1)).toBe(3);
  expect(scope.postMessage.mock.calls.filter(([event]) => event.kind === 'finished')).toHaveLength(1);
});
