import ThorVG from '@thorvg/webcanvas';

export type CanvasBackend = 'gl' | 'sw' | 'wg';
export async function initializeWebCanvas(renderer: CanvasBackend) {
  let backend = renderer;
  if (backend === 'gl') {
    const probe = document.createElement('canvas'),
      gl = probe.getContext('webgl2');
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
    else backend = 'sw';
  }
  return ThorVG.init({
    renderer: backend,
    locateFile: (path) => new URL(`${import.meta.env.BASE_URL}vendor/${path}`, document.baseURI).href,
  });
}
