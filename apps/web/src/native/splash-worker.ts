import ThorVG, { type Animation, type Canvas, type ThorVGNamespace } from '@thorvg/webcanvas';

let tvg: ThorVGNamespace | undefined, animation: Animation | undefined, canvas: Canvas | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
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
  const size = animation!.picture!.size(),
    scale = Math.min(width / size.width, height / size.height);
  animation!
    .picture!.size(size.width * scale, size.height * scale)
    .translate((width - size.width * scale) / 2, (height - size.height * scale) / 2);
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
    ++nextFrame;
    nextFrameAt += 1000 / fps;
    timer = setTimeout(tick, Math.max(0, nextFrameAt - performance.now()));
  }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'start') {
      const [namespace, json] = await Promise.all([
        ThorVG.init({ renderer: 'sw', locateFile: () => data.wasmUrl }),
        fetch(data.assetUrl).then(async (response) => {
          if (!response.ok) throw Error('Cannot load ThorVG splash.');
          return response.text();
        }),
      ]);
      tvg = namespace;
      animation = new tvg.Animation().load(json);
      if (!animation.picture) throw Error('Cannot decode ThorVG splash.');
      const info = animation.info()!;
      totalFrames = Math.max(1, Math.ceil(info.totalFrames));
      fps = info.fps;
      reducedMotion = data.reducedMotion;
      canvas = new tvg.Canvas(data.canvas, {
        width: data.width,
        height: data.height,
        enableDevicePixelRatio: false,
      });
      canvas.add(animation.picture);
      resize(data.width, data.height);
      nextFrameAt = performance.now();
      tick();
      self.postMessage({ kind: 'ready' });
    } else if (data.kind === 'resize' && canvas) {
      resize(data.width, data.height);
      render(displayedFrame);
    }
  } catch (error) {
    clearTimeout(timer);
    self.postMessage({ kind: 'error', message: String(error) });
  }
};
