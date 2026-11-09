import type { ThorVGNamespace } from '@thorvg/webcanvas';

/** A separate SW worker keeps the supplied animation moving during world generation. */
export function showStartupSplash(element: HTMLElement, tvgReady: Promise<ThorVGNamespace>) {
  const target = element.querySelector('canvas')!;
  const assetUrl = new URL(
    `${import.meta.env.BASE_URL}assets/branding/powered-by-thorvg.json`,
    document.baseURI,
  ).href;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const ready = (async () => {
    if (target.transferControlToOffscreen && typeof Worker !== 'undefined') {
      worker = new Worker(new URL('./splash-worker.ts', import.meta.url), { type: 'module' });
      await new Promise<void>((resolve, reject) => {
        releaseReady = resolve;
        const fail = (error: unknown) => {
          worker?.terminate();
          worker = undefined;
          releasePlayback();
          reject(error);
        };
        worker!.onmessage = ({ data }) => {
          if (data.kind === 'ready') {
            element.dataset.ready = 'true';
            resolve();
          } else if (data.kind === 'finished') releasePlayback();
          else if (data.kind === 'error') fail(Error(data.message));
        };
        worker!.onerror = fail;
        const canvas = target.transferControlToOffscreen();
        worker!.postMessage(
          {
            kind: 'start',
            canvas,
            ...dimensions(),
            assetUrl,
            wasmUrl: new URL(`${import.meta.env.BASE_URL}vendor/thorvg.wasm`, document.baseURI).href,
            reducedMotion,
          },
          [canvas],
        );
      });
      if (closed) return;
      window.addEventListener('resize', resize);
      resize();
    } else {
      const [tvg, response] = await Promise.all([tvgReady, fetch(assetUrl)]);
      if (!response.ok) throw Error('Cannot load ThorVG splash.');
      const json = await response.text();
      if (closed) return;
      const animation = new tvg.Animation().load(json),
        picture = animation.picture!;
      const canvas = new tvg.Canvas(target, { width: innerWidth, height: innerHeight });
      const size = picture.size();
      resizeFallback = () => {
        canvas.resize(innerWidth, innerHeight);
        const scale = Math.min(innerWidth / size.width, innerHeight / size.height);
        picture
          .size(size.width * scale, size.height * scale)
          .translate((innerWidth - size.width * scale) / 2, (innerHeight - size.height * scale) / 2);
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
    }
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
