import ThorVG from '@thorvg/webcanvas';

/** The game draws on the GPU only: the software rasterizer cannot keep up with its full-screen layers. */
export type CanvasBackend = 'gl' | 'wg';
export async function initializeWebCanvas(renderer: CanvasBackend) {
  if (renderer === 'gl') {
    const probe = document.createElement('canvas'),
      gl = probe.getContext('webgl2');
    if (!gl) throw new Error('Midgard needs WebGL 2, which this browser or device does not provide.');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return ThorVG.init({
    renderer,
    locateFile: (path) => new URL(`${import.meta.env.BASE_URL}vendor/${path}`, document.baseURI).href,
  });
}
