import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const baseline = process.env.MIDGARD_TEST_BASELINE === '1';
const output = `artifacts/performance-optimization/${baseline ? 'before' : 'after'}`;
const originals = new Map();
let server, browser;
const report = { baseline, errors: [], passed: false };
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    plugins: baseline ? [{
      name: 'measure-original-code', enforce: 'pre',
      transform(_source, id) {
        const match = id.replaceAll('\\', '/').match(/\/(apps|packages)\/.*\.ts$/);
        if (!match) return;
        const path = match[0].slice(1);
        if (!originals.has(path)) {
          try { originals.set(path, execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
          catch { originals.set(path, null); }
        }
        return originals.get(path) ?? undefined;
      },
    }] : [],
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  browser = await chromium.launch({ channel: process.env.MIDGARD_TEST_BROWSER || undefined, headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.addInitScript(() => {
    // Keep both the world's seed and the title player's decisions identical across A/B runs.
    crypto.getRandomValues = (values) => { values.fill(101); return values; };
    window.startupLongTasks = [];
    new PerformanceObserver((list) => startupLongTasks.push(...list.getEntries().map((e) => e.duration)))
      .observe({ entryTypes: ['longtask'] });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?test&seed=5`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.goldfantasy || !!document.querySelector('#startup-error'));
  report.startup = await page.evaluate(() => {
    if (!window.goldfantasy) throw Error(document.querySelector('#startup-error')?.textContent);
    goldfantasy.host.stop();
    window.frameClock = goldfantasy.app.lastFrame;
    window.cost = (frames = 180) => {
      const times = [];
      for (let i = 0; i < frames; ++i) {
        const at = performance.now();
        goldfantasy.host.render(frameClock += 1 / 60);
        if (i >= 30) times.push(performance.now() - at);
      }
      times.sort((a, b) => a - b);
      return { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], worst: times.at(-1) };
    };
    window.profile = () => {
      const host = goldfantasy.host, app = goldfantasy.app,
        game = app.preview && app.current === 'Title' ? app.preview : app.gameSession.game,
        sections = {}, undo = [];
      for (const [target, name, label] of [
        [app.titlePlay, 'advance', 'titleSimulation'], [game.town, 'advance', 'town'],
        [game, app.current === 'Title' && game.renderTitle ? 'renderTitle' : 'render', 'gameApp'], [game.renderer, 'update', 'world'],
        [game.renderer.adapter, 'sync', 'treeSync'], [game.renderer.adapter, 'collect', 'collect'],
        [game.renderer.picker, 'groundSelection', 'selection'], [game.context, 'end', 'hud'],
        [host.canvas, 'update', 'gpuUpdate'], [host.canvas, 'render', 'gpuDraw'],
      ]) {
        if (!target) continue;
        const original = target[name];
        let depth = 0;
        sections[label] = 0;
        target[name] = function (...args) {
          const outer = depth++ === 0, at = outer ? performance.now() : 0;
          try { return original.apply(this, args); }
          finally { --depth; if (outer) sections[label] += performance.now() - at; }
        };
        undo.push(() => target[name] = original);
      }
      try {
        const result = cost(90);
        return { ...result, sections: Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, value / 90])) };
      } finally { undo.forEach((restore) => restore()); }
    };
    return { renderer: goldfantasy.host.canvas.renderer, dpr: goldfantasy.host.canvas.dpr, longTasks: startupLongTasks, readyAt: performance.now() };
  });
  report.title = await page.evaluate(() => {
    const game = goldfantasy.app.preview, original = game.hud;
    let hudFrames = 0;
    game.hud = function (...args) { ++hudFrames; return original.apply(this, args); };
    try { return { ...cost(), hudFrames }; }
    finally { game.hud = original; }
  });
  if (process.env.MIDGARD_TEST_PROFILE) report.titleProfile = await page.evaluate(() => profile());
  report.titleSimulation = await page.evaluate(() => {
    const app = goldfantasy.app, elapsed = app.titlePlay.elapsed, clock = app.preview.state().clock();
    app.openSettings();
    goldfantasy.host.render(frameClock += 1 / 60);
    let renders = 0;
    const method = app.preview.renderTitle ? 'renderTitle' : 'render', original = app.preview[method];
    app.preview[method] = function (...args) { ++renders; return original.apply(this, args); };
    for (let i = 0; i < 60; ++i) goldfantasy.host.render(frameClock += 1 / 60);
    app.preview[method] = original;
    const result = { elapsedBefore: elapsed, elapsedAfter: app.titlePlay.elapsed, clockBefore: clock, clockAfter: app.preview.state().clock(), renders };
    app.closeSettings();
    return result;
  });
  await page.evaluate(async () => {
    for (let i = 0; i < 600; ++i) {
      goldfantasy.host.render(frameClock += 0.1);
      if (i % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  report.titleAfterOneMinute = await page.evaluate(() => ({ ...cost(), people: goldfantasy.app.preview.state().people().length }));
  await page.evaluate(() => {
    const app = goldfantasy.app, attached = [], original = app.root.add;
    app.root.add = function (paint) { attached.push(paint); return original.call(this, paint); };
    goldfantasy.app.beginGame(false, undefined, true);
    for (let i = 0; i < 9; ++i) goldfantasy.host.render(frameClock += 0.1);
    app.root.add = original;
    window.sagaBackgroundAttached = attached.includes(app.preview.worldScene());
  });
  report.saga = await page.evaluate(() => {
    const app = goldfantasy.app;
    if (!app.saga) throw Error('The opening saga did not start');
    const elapsed = app.titlePlay.elapsed, clock = app.preview.state().clock();
    const result = cost();
    return { ...result, elapsedBefore: elapsed, elapsedAfter: app.titlePlay.elapsed, clockBefore: clock, clockAfter: app.preview.state().clock(), backgroundAttached: sagaBackgroundAttached };
  });
  await page.screenshot({ path: `${output}/saga.png` });
  report.sagaPanels = await page.evaluate(() => {
    const app = goldfantasy.app, captions = [app.saga.caption().text];
    for (let panel = 1; panel < 6; ++panel) {
      app.saga.next();
      for (let frame = 0; frame < 12; ++frame) goldfantasy.host.render(frameClock += 0.1);
      captions.push(app.saga.caption().text);
    }
    return captions;
  });
  await page.evaluate(() => {
    goldfantasy.app.command('scene.skip-saga');
    for (let i = 0; i < 22; ++i) goldfantasy.host.render(frameClock += 0.1);
    if (!goldfantasy.app.command('scene.is-game')) throw Error('The saga did not hand off to the game');
  });
  report.game = await page.evaluate(() => cost());
  if (process.env.MIDGARD_TEST_PROFILE) report.gameProfile = await page.evaluate(() => profile());
  await page.screenshot({ path: `${output}/game.png` });
  if (!baseline) {
    report.settings = [];
    for (const [width, height] of [[1280, 720], [390, 844], [844, 390], [568, 320]]) {
      await page.setViewportSize({ width, height });
      const bounds = await page.evaluate(() => {
        const app = goldfantasy.app;
        app.openSettings();
        goldfantasy.host.render(frameClock += 1 / 60);
        return app.overlay.controls.filter((control) => control.id.startsWith('settings/motion/')).map((control) => ({ id: control.id, ...control.bounds }));
      });
      assert.equal(bounds.length, 2);
      assert.ok(bounds.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= width && b.y + b.h <= height));
      for (const choice of ['Off', 'On']) {
        const box = bounds.find((b) => b.id.endsWith(`/${choice}`));
        await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
        const result = await page.evaluate(() => {
          goldfantasy.host.render(frameClock += 1 / 60);
          return { stored: localStorage.getItem('midgard.motion'), still: goldfantasy.app.gameSession.game.reducedMotion() };
        });
        assert.equal(result.stored, choice);
        assert.equal(result.still, choice === 'Off');
      }
      await page.screenshot({ path: `${output}/settings-${width}x${height}.png` });
      report.settings.push({ width, height, passed: true });
      await page.evaluate(() => goldfantasy.app.closeSettings());
    }
  }
  if (!baseline) {
    assert.equal(report.title.hudFrames, 0, 'The title must not prepare an invisible game HUD');
    assert.equal(report.saga.elapsedAfter, report.saga.elapsedBefore, 'No title AI behind the saga');
    assert.equal(report.saga.clockAfter, report.saga.clockBefore, 'No title simulation behind the saga');
    assert.equal(report.saga.backgroundAttached, false, 'The opaque saga must detach the title world');
    assert.equal(report.titleSimulation.elapsedAfter, report.titleSimulation.elapsedBefore, 'Settings pause the title');
    assert.equal(report.titleSimulation.clockAfter, report.titleSimulation.clockBefore);
    assert.equal(report.titleSimulation.renders, 0, 'The paused title needs no repeated world rebuilds');
  }
  assert.deepEqual(report.errors, []);
  assert.equal(report.startup.renderer, 'gl', 'Performance measurements must use the shipping WebGL backend');
  assert.equal(new Set(report.sagaPanels).size, 6, 'Every story panel must render before the game handoff');
  await page.evaluate(() => goldfantasy.dispose());
  report.passed = true;
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
