import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const backend = process.env.GOLDFANTASY_TEST_RENDERER ?? 'sw';
const baseline = process.env.GOLDFANTASY_TEST_BASELINE === '1';
const modes = (process.env.GOLDFANTASY_TEST_MODES ?? 'worker,fallback').split(',');
const output = process.env.GOLDFANTASY_TEST_OUTPUT ?? 'artifacts/runtime-lifecycle/splash-runtime';
let server, browser, deadline;
const report = { backend, baseline, cases: [], errors: [], passed: false };
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    plugins: [
      {
        name: 'observe-hidden-game-rendering',
        enforce: 'pre',
        transform(source, id) {
          if (id.split('?')[0].endsWith('/apps/web/src/native/browser-host.ts')) {
            const needle = 'this.canvas.update().render();';
            assert.ok(source.includes(needle));
            return source.replace(
              needle,
              needle +
                `
            window.dispatchEvent(new CustomEvent('test-game-render', { detail: {
              hidden: !!document.querySelector('#startup'),
              clock: this.app.preview?.state().clock(), at: performance.now()
            }}));`,
            );
          }
          if (baseline && id.split('?')[0].endsWith('/apps/web/src/native/main.ts')) {
            const needle = 'startNativeGame(element, options, backend, tvg, false)';
            assert.ok(source.includes(needle));
            return source.replace(needle, 'startNativeGame(element, options, backend, tvg, true)');
          }
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 180000);
  for (const mode of modes) {
    const context = await browser.newContext({ viewport: { width: 800, height: 500 } });
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
      await page.addInitScript((fallback) => {
        if (fallback) HTMLCanvasElement.prototype.transferControlToOffscreen = undefined;
        window.gameRenders = [];
        window.addEventListener('test-game-render', (event) => gameRenders.push(event.detail));
      }, mode === 'fallback');
      await page.goto(
        `http://127.0.0.1:${server.httpServer.address().port}/?test&renderer=${backend}&seed=5`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForFunction(
        () => !!window.goldfantasy || !!document.querySelector('#startup-error'),
        {},
        { timeout: 90000 },
      );
      const result = await page.evaluate(() => {
        if (!window.goldfantasy) throw Error(document.querySelector('#startup-error')?.textContent);
        return {
          title: goldfantasy.app.command('scene.is-title'),
          backend: goldfantasy.host.canvas.renderer,
          splashPresent: !!document.querySelector('#startup'),
          renders: gameRenders,
          readyAt: performance.now(),
        };
      });
      result.mode = mode;
      report.cases.push(result);
      assert.equal(result.backend, backend);
      assert.equal(result.title, true);
      assert.equal(result.splashPresent, false);
      const hidden = result.renders.filter((frame) => frame.hidden);
      if (baseline) assert.ok(hidden.length > 1, 'Baseline must reproduce invisible ongoing game work');
      else {
        assert.equal(hidden.length, 1, 'Render the prepared title once, then wait for the splash');
        // The native starting time is 30% of the first 300-second game day.
        assert.equal(hidden.at(-1).clock, hidden[0].clock, 'No subsequent title ticks behind the splash');
      }
      await page.waitForFunction(() => gameRenders.filter((frame) => !frame.hidden).length >= 3);
      await page.evaluate(() => goldfantasy.host.stop());
      await page.screenshot({ path: `${output}/${mode}.png` });
      await page.evaluate(() => goldfantasy.dispose());
      assert.deepEqual(report.errors, []);
      console.log(
        JSON.stringify({
          mode,
          backend,
          baseline,
          readyAt: result.readyAt,
          hiddenFrames: hidden.length,
          lastHiddenClock: hidden.at(-1)?.clock,
        }),
      );
    } finally {
      await context.close();
    }
  }
  report.passed = true;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
