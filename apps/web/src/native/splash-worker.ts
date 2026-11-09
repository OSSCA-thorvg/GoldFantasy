import ThorVG, { type Animation, type Canvas, type ThorVGNamespace } from '@thorvg/webcanvas';

let tvg: ThorVGNamespace | undefined, animation: Animation | undefined, canvas: Canvas | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let started = 0,
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
  const frame =
    reducedMotion || finished
      ? totalFrames - 1
      : Math.min(totalFrames - 1, ((performance.now() - started) / 1000) * fps);
  render(frame);
  if (frame < totalFrames - 1) timer = setTimeout(tick, 1000 / fps);
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
      totalFrames = info.totalFrames;
      fps = info.fps;
      reducedMotion = data.reducedMotion;
      canvas = new tvg.Canvas(data.canvas, {
        width: data.width,
        height: data.height,
        enableDevicePixelRatio: false,
      });
      canvas.add(animation.picture);
      resize(data.width, data.height);
      started = performance.now();
      tick();
      self.postMessage({ kind: 'ready' });
    } else if (data.kind === 'finish' && canvas) {
      finished = true;
      clearTimeout(timer);
      render(totalFrames - 1);
      self.postMessage({ kind: 'finished' });
    } else if (data.kind === 'resize' && canvas) {
      clearTimeout(timer);
      resize(data.width, data.height);
      tick();
    }
  } catch (error) {
    clearTimeout(timer);
    self.postMessage({ kind: 'error', message: String(error) });
  }
};
