import ThorVG, { type Animation, type Canvas, type ThorVGNamespace } from '@thorvg/webcanvas';

let tvg: ThorVGNamespace | undefined, animation: Animation | undefined, canvas: Canvas | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let viewport = { width: 1, height: 1 }, sourceSize = { width: 1, height: 1 };
let nextFrame = 0,
  displayedFrame = 0,
  nextFrameAt = 0,
  totalFrames = 1,
  fps = 30,
  reducedMotion = false,
  finished = false;
function render(frame: number) {
  animation!.frame(frame);
  canvas!.update().render();
}
function resize(width: number, height: number) {
  canvas!.resize(width, height);
  const scale = Math.min(width / sourceSize.width, height / sourceSize.height);
  animation!
    .picture!.size(sourceSize.width * scale, sourceSize.height * scale)
    .translate((width - sourceSize.width * scale) / 2, (height - sourceSize.height * scale) / 2);
}
function tick() {
  if (finished) return;
  displayedFrame = reducedMotion ? totalFrames - 1 : nextFrame;
  render(displayedFrame);
  if (displayedFrame === totalFrames - 1) {
    finished = true;
    // Present the final authored frame for its full interval before handing off.
    timer = setTimeout(() => self.postMessage({ kind: 'finished' }), reducedMotion ? 0 : 1000 / fps);
  } else {
    // Keep every authored frame even when rendering is slow; loading waits for playback.
    ++nextFrame;
    const now = performance.now(), interval = 1000 / fps;
    if (now - nextFrameAt > interval * 2) nextFrameAt = now;
    nextFrameAt += interval;
    timer = setTimeout(tick, Math.max(0, nextFrameAt - performance.now()));
  }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'start') {
      viewport = { width: data.width, height: data.height };
      const [namespace, json] = await Promise.all([
        ThorVG.init({ renderer: 'gl', locateFile: () => data.wasmUrl }),
        fetch(data.assetUrl).then(async (response) => {
          if (!response.ok) throw Error('Cannot load ThorVG splash.');
          return response.text();
        }),
      ]);
      tvg = namespace;
      animation = new tvg.Animation().load(json);
      if (!animation.picture) throw Error('Cannot decode ThorVG splash.');
      sourceSize = animation.picture.size();
      const info = animation.info()!;
      totalFrames = Math.max(1, Math.ceil(info.totalFrames));
      fps = info.fps;
      reducedMotion = data.reducedMotion;
      canvas = new tvg.Canvas(data.canvas, {
        ...viewport,
        enableDevicePixelRatio: false,
      });
      canvas.add(animation.picture);
      resize(viewport.width, viewport.height);
      nextFrameAt = performance.now();
      tick();
      self.postMessage({ kind: 'ready' });
    } else if (data.kind === 'resize') {
      viewport = { width: data.width, height: data.height };
      if (canvas) {
        resize(viewport.width, viewport.height);
        render(displayedFrame);
      }
    }
  } catch (error) {
    clearTimeout(timer);
    self.postMessage({ kind: 'error', message: String(error) });
  }
};
