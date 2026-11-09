// Exercise the shipping entry point with trusted touch and deliberately late modules.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

let server, browser;
try {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--autoplay-policy=document-user-activation-required'],
  });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  for (const mode of ['worker', 'reduced-motion', 'fallback', 'missing-animation']) {
    const context = await browser.newContext({
      viewport: { width: 800, height: 500 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: mode === 'reduced-motion' ? 'reduce' : 'no-preference',
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      ({ fallback }) => {
        window.testAudioContexts = [];
        window.testAudioNodes = [];
        const Original = AudioContext,
          Node = AudioWorkletNode;
        window.AudioContext = class extends Original {
          constructor(options) {
            super(options);
            window.testAudioContexts.push(this);
          }
        };
        window.AudioWorkletNode = class extends Node {
          constructor(...args) {
            super(...args);
            window.testAudioNodes.push(this);
          }
        };
        if (fallback) HTMLCanvasElement.prototype.transferControlToOffscreen = undefined;
      },
      { fallback: mode === 'fallback' },
    );
    const cdp = await context.newCDPSession(page);
    const read = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: false,
      });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (expression) => {
      const deadline = Date.now() + 60000;
      while (!(await read(expression))) {
        if (Date.now() > deadline) throw Error(`Timed out: ${expression}; errors=${errors.join(';')}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    let releaseGame, releaseAudio;
    const gameGate = new Promise((resolve) => {
      releaseGame = resolve;
    });
    const audioGate = new Promise((resolve) => {
      releaseAudio = resolve;
    });
    await page.route('**/apps/web/src/native/bootstrap.ts*', async (route) => {
      await gameGate;
      await route.continue();
    });
    await page.route('**/packages/native-audio/src/browser-audio.ts*', async (route) => {
      await audioGate;
      await route.continue();
    });
    if (mode === 'missing-animation')
      await page.route('**/assets/branding/powered-by-thorvg.json', (route) =>
        route.fulfill({ status: 404, body: 'Missing test asset' }),
      );
    await page.goto(`${origin}/?test&renderer=sw&seed=5`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await until('testAudioContexts.length === 1');
    assert.equal(await read('navigator.userActivation.hasBeenActive'), false);
    assert.equal(await read('testAudioContexts[0].state'), 'suspended');
    // This gesture occurs before the audio module can register its own handlers.
    await page.touchscreen.tap(20, 20);
    await until('testAudioContexts[0].state === "running"');
    releaseAudio();
    await until('testAudioNodes.length > 0');
    assert.equal(await read('testAudioContexts.length'), 1, 'The startup gesture context must be adopted');
    await read(
      'window.loadingAnalyser=testAudioContexts[0].createAnalyser();loadingAnalyser.fftSize=512;for(const n of testAudioNodes)n.connect(loadingAnalyser)',
    );
    await until(
      '(()=>{const d=new Float32Array(512);loadingAnalyser.getFloatTimeDomainData(d);return d.some(v=>Math.abs(v)>0.000001)})()',
    );
    assert.equal(
      await read('!!window.goldfantasy'),
      false,
      'Sound must be available while the game module is still loading',
    );
    if (mode !== 'missing-animation') {
      await until('document.querySelector("#startup")?.dataset.ready === "true"');
      const before = await page.screenshot();
      await new Promise((resolve) => setTimeout(resolve, 600));
      const after = await page.screenshot();
      if (mode === 'reduced-motion')
        assert.deepEqual(before, after, 'Reduced motion must hold a static authored frame');
      else assert.notDeepEqual(before, after, 'The supplied splash animation must advance');
    }
    releaseGame();
    await until('!!window.goldfantasy || !!document.querySelector("#startup-error")');
    assert.equal(await read('document.querySelector("#startup-error")?.textContent ?? ""'), '');
    assert.equal(
      await read('!!document.querySelector("#startup")'),
      false,
      'No minimum seven-second splash delay',
    );
    assert.equal(await read('goldfantasy.app.command("scene.is-title")'), true);
    assert.deepEqual(errors, []);
    await read('goldfantasy.dispose()');
    await context.close();
    console.log(`PASS loading: ${mode}, early touch, loading audio, title handoff`);
  }
} finally {
  await browser?.close();
  await server?.close();
}
