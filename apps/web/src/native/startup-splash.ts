import type { ThorVGNamespace } from '@thorvg/webcanvas';
import { reducedMotionPreferred } from './motion-preference';

/** A separate worker keeps the supplied animation moving during world generation. */
export function showStartupSplash(element: HTMLElement, tvgReady: Promise<ThorVGNamespace>) {
  let target = element.querySelector('canvas')!;
  const assetUrl = new URL(
    `${import.meta.env.BASE_URL}assets/branding/powered-by-thorvg.json`,
    document.baseURI,
  ).href;
  const reducedMotion = reducedMotionPreferred();
  let worker: Worker | undefined,
    closed = false;
  let disposeFallback: (() => void) | undefined;
  let resizeFallback: (() => void) | undefined;
  const ratio = Math.min(1.5, devicePixelRatio || 1);
  const dimensions = () => ({
    width: Math.max(1, Math.round(innerWidth * ratio)),
    height: Math.max(1, Math.round(innerHeight * ratio)),
  });
  const resize = () => {
    worker?.postMessage({ kind: 'resize', ...dimensions() });
    resizeFallback?.();
  };
  let releasePlayback!: () => void;
  const playback = new Promise<void>((resolve) => {
    releasePlayback = resolve;
  });
  let releaseReady: (() => void) | undefined;
  const startFallback = async () => {
    const [tvg, response] = await Promise.all([tvgReady, fetch(assetUrl)]);
    if (!response.ok) throw Error('Cannot load ThorVG splash.');
    const json = await response.text();
    if (closed) return;
    const animation = new tvg.Animation().load(json),
      picture = animation.picture!;
    const canvas = new tvg.Canvas(target, { ...dimensions(), enableDevicePixelRatio: false });
    const size = picture.size();
    resizeFallback = () => {
      const { width, height } = dimensions();
      canvas.resize(width, height);
      const scale = Math.min(width / size.width, height / size.height);
      picture
        .size(size.width * scale, size.height * scale)
        .translate((width - size.width * scale) / 2, (height - size.height * scale) / 2);
      canvas.update().render();
    };
    canvas.add(picture);
    resizeFallback();
    window.addEventListener('resize', resize);
    const info = animation.info()!,
      lastFrame = Math.max(0, Math.ceil(info.totalFrames) - 1),
      interval = 1000 / info.fps;
    let frame = 0,
      nextFrame = reducedMotion ? lastFrame : 0,
      nextFrameAt = performance.now(),
      finalFrameDrawn = false;
    const draw = (now = performance.now()) => {
      if (closed) return;
      try {
        if (now >= nextFrameAt) {
          if (finalFrameDrawn) {
            releasePlayback();
            return;
          }
          animation.frame(nextFrame);
          canvas.update().render();
          finalFrameDrawn = nextFrame === lastFrame;
          if (reducedMotion) {
            releasePlayback();
            return;
          }
          ++nextFrame;
          // World generation can block this fallback's main thread. Resume at
          // the next frame instead of skipping the middle of the animation.
          if (now - nextFrameAt > interval * 2) nextFrameAt = now;
          nextFrameAt += interval;
        }
      } catch (error) {
        console.warn('Splash animation is unavailable:', error);
        releasePlayback();
        return;
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    element.dataset.ready = 'true';
    disposeFallback = () => {
      cancelAnimationFrame(frame);
      canvas.remove();
      animation.dispose();
      canvas.destroy();
    };
  };
  const ready = (async () => {
    if (!target.transferControlToOffscreen || typeof Worker === 'undefined') return startFallback();
    await new Promise<void>((resolve) => {
      releaseReady = resolve;
      let recovering = false, transferred = false;
      const fail = (error: unknown) => {
        if (closed || recovering) return;
        recovering = true;
        console.warn('Splash worker is unavailable; retrying on the main thread:', error);
        worker?.terminate();
        worker = undefined;
        if (transferred) {
          const replacement = target.cloneNode(false) as HTMLCanvasElement;
          target.replaceWith(replacement);
          target = replacement;
        }
        // Keep playback pending: a failed worker must not silently skip the animation.
        void startFallback().catch((cause) => {
          console.warn('Splash animation is unavailable:', cause);
          releasePlayback();
        }).finally(resolve);
      };
      try {
        worker = new Worker(new URL('./splash-worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          if (closed || recovering) return;
          if (data.kind === 'ready') {
            element.dataset.ready = 'true';
            resolve();
          } else if (data.kind === 'finished') releasePlayback();
          else if (data.kind === 'error') fail(Error(data.message));
        };
        worker.onerror = (event) => {
          event.preventDefault();
          fail(event.error ?? event.message);
        };
        const canvas = target.transferControlToOffscreen();
        transferred = true;
        worker.postMessage(
          {
            kind: 'start', canvas, ...dimensions(), assetUrl,
            wasmUrl: new URL(`${import.meta.env.BASE_URL}vendor/thorvg.wasm`, document.baseURI).href,
            reducedMotion,
          },
          [canvas],
        );
      } catch (error) {
        fail(error);
      }
    });
    if (!closed) window.addEventListener('resize', resize);
  })().catch((error) => {
    console.warn('Splash animation is unavailable:', error);
    worker?.terminate();
    worker = undefined;
    releasePlayback();
  });
  function dispose() {
    if (closed) return;
    closed = true;
    releaseReady?.();
    releasePlayback();
    worker?.terminate();
    disposeFallback?.();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', dispose);
    element.remove();
  }
  window.addEventListener('pagehide', dispose, { once: true });
  return {
    ready,
    async finish() {
      await ready;
      await playback;
      if (closed) return;
      element.classList.add('is-ready');
      if (!reducedMotion) await new Promise((resolve) => setTimeout(resolve, 180));
      dispose();
    },
    dispose,
  };
}
