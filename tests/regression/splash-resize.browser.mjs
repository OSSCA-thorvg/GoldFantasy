import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const output = 'artifacts/splash-resize';
const report = [];
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    plugins: [{
      name: 'observe-splash-resize',
      enforce: 'pre',
      transform(source, id) {
        if (!id.split('?')[0].endsWith('/apps/web/src/native/splash-worker.ts')) return;
        const needle = 'canvas!.update().render();';
        assert.ok(source.includes(needle));
        return source
          .replace("if (data.kind === 'start') {", "if (data.kind === 'start') { self.testTarget = data.canvas;")
          .replace(needle, needle + `
            self.postMessage({kind:'test-frame', frame,
              width:self.testTarget.width, height:self.testTarget.height,
              picture:animation!.picture!.size(), renderer:canvas!.renderer});`);
      },
      configureServer(vite) {
        vite.middlewares.use('/splash-resize', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
            <div id="startup"><canvas></canvas></div><script type="module">
            import ThorVG from '/node_modules/@thorvg/webcanvas/dist/webcanvas.esm.js';
            import {showStartupSplash} from '/apps/web/src/native/startup-splash.ts';
            import '/apps/web/src/native/native.css';
            const tvgReady=ThorVG.init({renderer:'gl',locateFile:()=>'/vendor/thorvg.wasm'}).then(tvg=>({
              ...tvg,
              Animation:class extends tvg.Animation {
                load(json){super.load(json);window.splashPicture=this.picture;return this;}
                frame(frame){window.splashFrame=frame;return super.frame(frame);}
              },
              Canvas:class extends tvg.Canvas {
                render(){
                  super.render();
                  if(window.splashFrame!==undefined){
                    const target=document.querySelector('#startup canvas');
                    splashDraws.push({frame:splashFrame,width:target.width,height:target.height,
                      picture:splashPicture.size(),renderer:this.renderer});
                  }
                  return this;
                }
              }
            }));
            window.splash=showStartupSplash(document.querySelector('#startup'),tvgReady);
            </script>`);
        });
      },
    }],
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 180000);
  for (const mode of ['worker', 'fallback', 'worker-off', 'fallback-off', 'worker-failure']) {
    const context = await browser.newContext({ viewport: { width: 800, height: 500 }, reducedMotion: 'reduce' });
    let releaseAsset;
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((mode) => {
        window.splashDraws = [];
        if (mode.endsWith('-off')) localStorage.setItem('midgard.motion', 'Off');
        if (mode.startsWith('fallback')) HTMLCanvasElement.prototype.transferControlToOffscreen = undefined;
        const OriginalWorker = Worker;
        window.Worker = class extends OriginalWorker {
          constructor(...args) {
            super(...args);
            this.addEventListener('message', ({ data }) => {
              if (data.kind === 'test-frame') splashDraws.push(data);
            });
          }
          postMessage(data, ...args) {
            if (mode === 'worker-failure' && data.kind === 'start')
              setTimeout(() => this.dispatchEvent(new MessageEvent('message', {
                data: { kind: 'error', message: 'Test worker failure' },
              })), 0);
            else super.postMessage(data, ...args);
          }
        };
      }, mode);
      const assetGate = new Promise((resolve) => { releaseAsset = resolve; });
      await page.route('**/assets/branding/powered-by-thorvg.json', async (route) => {
        await assetGate;
        await route.continue();
      });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/splash-resize`, {
        waitUntil: 'domcontentloaded', timeout: 60000,
      });
      await page.waitForFunction(() => !!window.splash);
      // This resize happens before the animation asset/worker can become ready.
      await page.setViewportSize({ width: 390, height: 844 });
      releaseAsset();
      const checks = [];
      const checkSize = async (width, height) => {
        try {
          await page.waitForFunction(({ width, height }) => {
            const last = splashDraws.at(-1);
            return last?.width === width && last?.height === height;
          }, { width, height }, { timeout: 15000 });
        } catch (error) {
          console.error(mode, { width, height, errors }, await page.evaluate(() => ({
            ratio: devicePixelRatio, css: document.querySelector('canvas')?.getBoundingClientRect().toJSON(),
            resolution: matchMedia('(resolution: 1dppx)').matches, last: splashDraws.at(-1),
          })));
          throw error;
        }
        const last = await page.evaluate(() => splashDraws.at(-1));
        const scale = Math.min(width / 1920, height / 1080);
        assert.ok(Math.abs(last.picture.width - 1920 * scale) < 0.05);
        assert.ok(Math.abs(last.picture.height - 1080 * scale) < 0.05);
        assert.equal(last.renderer, 'gl');
        checks.push({ width, height, frame: last.frame });
      };
      await checkSize(390, 844);
      assert.equal(await page.evaluate(() => splashDraws[0].width), 390, 'The first render must use the latest loading size');
      await page.setViewportSize({ width: 1280, height: 720 });
      await checkSize(1280, 720);
      await page.screenshot({ path: `${output}/${mode}.png` });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 720, deviceScaleFactor: 2, mobile: false,
      });
      // CDP changes DPR without invalidating media queries; request a media update.
      await page.emulateMedia({ colorScheme: 'dark' });
      await checkSize(2560, 1440);
      // CSS-only changes must update the drawing buffer too, without a window resize.
      await page.addStyleTag({ content: '#startup canvas {width:400px!important;height:300px!important}' });
      await checkSize(800, 600);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1280, height: 720, deviceScaleFactor: 3, mobile: false,
      });
      await page.emulateMedia({ colorScheme: 'light' });
      await checkSize(1200, 900);
      await page.evaluate(() => splash.finish());
      assert.equal(await page.locator('#startup').count(), 0);
      const frames = await page.evaluate(() => splashDraws.map((draw) => draw.frame)
        .filter((frame, i, all) => !i || frame !== all[i - 1]));
      assert.deepEqual(frames, mode.endsWith('-off') ? [209] : Array.from({ length: 210 }, (_, i) => i));
      assert.deepEqual(errors, []);
      report.push({ mode, checks, frames: frames.length, passed: true });
      console.log(`PASS splash resize: ${mode}, loading/viewport/CSS/DPR 1-3, ${frames.length} authored frames`);
    } finally {
      releaseAsset?.();
      await context.close();
    }
  }
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
