import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

let server, browser, deadline;
try {
  server = await createServer({
    logLevel: 'error',
    plugins: [
      {
        name: 'webcanvas-lifetime-probe',
        configureServer(vite) {
          vite.middlewares.use('/webcanvas-lifetime', (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(`<!doctype html><canvas width="100" height="100"></canvas><script type="module">
            import ThorVG from '/node_modules/@thorvg/webcanvas/dist/webcanvas.esm.js';
            window.makeSurface = async () => {
              const tvg = await ThorVG.init({renderer:'sw', locateFile:()=>'/vendor/thorvg.wasm'});
              const canvas = new tvg.Canvas(document.querySelector('canvas'), {width:100,height:100,enableDevicePixelRatio:false});
              const shape = new tvg.Shape().appendRect(10,10,30,30).fill(30,120,240);
              canvas.add(shape); canvas.update().render();
              return {tvg,canvas,shape};
            };
            window.retired = await makeSurface();
            window.oldAddress = retired.shape.ptr;
            retired.canvas.remove(); retired.canvas.destroy(); retired.tvg.term();
            window.live = await makeSurface();
            if (live.shape.ptr !== oldAddress) throw Error('Native address collision was not exercised');
            window.retired = null;
            window.ready = true;
          </script>`);
          });
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 120000);
  const page = await browser.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.finalized = [];
    const OriginalRegistry = FinalizationRegistry;
    window.FinalizationRegistry = class extends OriginalRegistry {
      constructor(cleanup) {
        super((record) => {
          finalized.push(record?.ptr);
          cleanup(record);
        });
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/webcanvas-lifetime`);
  await page.waitForFunction(() => window.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForFunction(() => finalized.includes(oldAddress));
  await page.evaluate(() => {
    live.canvas.update().render();
    live.canvas.remove(live.shape);
    live.shape.fill(200, 30, 20);
    live.canvas.add(live.shape);
    live.canvas.update().render();
  });
  // Within a live module, the native parent still owns paints whose JS wrappers
  // have been collected. Also stress repeated native detach/reattach references.
  const transient = await page.evaluate(() => {
    const scene = new live.tvg.Scene(),
      shape = new live.tvg.Shape().appendCircle(70, 70, 10).fill(20, 200, 80);
    scene.add(shape);
    live.canvas.add(scene);
    window.retainedScene = scene;
    return shape.ptr;
  });
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForFunction((address) => finalized.includes(address), transient);
  await page.evaluate(() => {
    live.canvas.update().render();
    for (let i = 0; i < 70000; i++) {
      live.canvas.remove(live.shape);
      live.canvas.add(live.shape);
    }
    live.canvas.update().render();
    live.canvas.remove();
    retainedScene.dispose();
    live.shape.dispose();
    live.canvas.destroy();
    live.tvg.term();
  });
  assert.deepEqual(errors, []);
  console.log('PASS WebCanvas lifetime: GC/module recreation, live-parent GC, 70,000 reattachments');
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
}
