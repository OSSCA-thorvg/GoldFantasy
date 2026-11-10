/** Real touch input through BrowserHost; no visible windows or shared profiles. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'artifacts/regression/mobile');
const report = { cases: [], errors: [], passed: false };
let server, browser;
await mkdir(output, { recursive: true });
try {
  server = await createServer({
    root,
    base: '/',
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'mobile-probe',
        configureServer(vite) {
          vite.middlewares.use('/mobile-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/apps/web/src/native/native.css"><canvas id="world"></canvas>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  for (const [width, height, renderer] of [
    [390, 844, 'sw'],
    [844, 390, 'gl'],
    [360, 740, 'sw'],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: width === 360 ? 2 : 1,
      reducedMotion: width === 844 ? 'no-preference' : 'reduce',
    });
    const page = await context.newPage();
    const row = { width, height, renderer, checks: [] };
    report.cases.push(row);
    const check = (name, actual) => {
      row.checks.push({ name, passed: !!actual });
      assert.ok(actual, name);
    };
    page.on('pageerror', (e) => report.errors.push(e.stack ?? String(e)));
    const cdp = await context.newCDPSession(page);
    const touch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })),
      });
    const frames = async (count = 2) =>
      page.evaluate((count) => {
        for (let i = 0; i < count; i++) {
          window.mobile.runtime.app.dirty = true;
          window.mobile.labels = [];
          window.mobile.runtime.host.render(++window.mobile.frame / 60);
        }
      }, count);
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/mobile-probe`);
      await page.evaluate(async (renderer) => {
        const [{ startNativeGame }, { Tool }, { Terrain, Layer }, { Town }, { project, Camera }] =
          await Promise.all([
            import('/apps/web/src/native/bootstrap.ts'),
            import('/packages/engine/src/game-tools.ts'),
            import('/packages/engine/src/world-types.ts'),
            import('/packages/engine/src/town.ts'),
            import('/packages/engine/src/geometry.ts'),
          ]);
        const runtime = await startNativeGame(
          document.querySelector('#world'),
          { titleScreen: false, world: 'Random', seed: 5 },
          renderer,
          undefined,
          false,
        );
        const game = runtime.app.game;
        game.town = new Town(5, 32);
        game.paused = true;
        const map = game.town.map(),
          start = map.camp();
        for (const layer of map.layers) layer.fill(0.4);
        map.layer(Layer.Land).fill(1);
        map.layer(Layer.Ridge).fill(-1);
        map.stream = { path: [], width: [] };
        for (const tile of map.tiles)
          Object.assign(tile, { terrain: Terrain.Grass, trees: 0, wild: 0, quarried: true, dungeon: -1 });
        game.town.animals = [];
        game.town.beasts = [];
        map.ymir = null;
        map.fire = null;
        map.reveal(start, 100);
        game.town.scout(start.x, start.y, 100);
        game.town.editHour(12);
        game.chosen = game.town.people().map((p) => p.id);
        for (const p of game.town.people()) p.position = { x: start.x, y: start.y };
        const center = project(start.x, start.y);
        game.setView(new Camera(center.x, center.y, 1.4));
        game.renderer.invalidateMap();
        window.mobile = { runtime, game, Tool, frame: 0, labels: [], orders: [] };
        // Drive the real UI clock with the replay clock, including dock morphs.
        runtime.app.services.frameTime = () => window.mobile.frame / 60;
        const text = game.context.text.bind(game.context),
          move = game.town.orderMove.bind(game.town);
        game.context.text = (...args) => {
          window.mobile.labels.push({ bounds: args[0], text: args[1] });
          return text(...args);
        };
        game.town.orderMove = (...args) => {
          window.mobile.orders.push(structuredClone(args));
          return move(...args);
        };
      }, renderer);
      await frames();
      check(
        'The touch fixture contains a real selected resident group',
        await page.evaluate(() => window.mobile.game.chosen.length >= 2),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-initial.png` });
      const before = await page.evaluate(() => ({
        ...window.mobile.game.camera,
        chosen: [...window.mobile.game.chosen],
      }));
      const y = Math.round(height * 0.46);
      await touch('touchStart', [[width * 0.4, y]]);
      await touch('touchMove', [[width * 0.4 + 64, y + 24]]);
      await touch('touchEnd', []);
      await frames();
      const after = await page.evaluate(() => ({
        ...window.mobile.game.camera,
        chosen: [...window.mobile.game.chosen],
      }));
      check(
        'One finger pans the map without changing selection',
        Math.abs(after.x - before.x) > 20 && JSON.stringify(after.chosen) === JSON.stringify(before.chosen),
      );
      await touch('touchStart', [
        [width * 0.35, y, 0],
        [width * 0.65, y, 1],
      ]);
      await touch('touchMove', [
        [width * 0.25, y + 8, 0],
        [width * 0.75, y + 8, 1],
      ]);
      await touch('touchEnd', []);
      await frames();
      check(
        'Two fingers zoom without clearing selected units',
        await page.evaluate((chosen) => {
          const g = window.mobile.game;
          return g.camera.zoom > 1.4 && JSON.stringify(g.chosen) === JSON.stringify(chosen);
        }, before.chosen),
      );
      const button = async (id) =>
        page.evaluate((id) => {
          const c = window.mobile.game.context.controls.find((c) => c.id === id);
          if (!c) throw Error(`Missing control ${id}`);
          return {
            x: c.bounds.x + c.bounds.w / 2,
            y: c.bounds.y + c.bounds.h / 2,
            w: c.bounds.w,
            h: c.bounds.h,
          };
        }, id);
      const tapControl = async (id) => {
        const p = await button(id);
        await page.touchscreen.tap(p.x, p.y);
        await frames(16);
      };
      await tapControl('unit/card-move');
      await touch('touchStart', [[width * 0.4, y]]);
      await touch('touchMove', [[width * 0.4 + 40, y + 12]]);
      await touch('touchEnd', []);
      await frames(4);
      check(
        'Panning with Move armed keeps the order pending and does not issue a destination',
        await page.evaluate(() => window.mobile.game.pending !== 0 && window.mobile.orders.length === 0),
      );
      await tapControl('command-cancel');
      check(
        'Cancel dismisses an armed order without losing the group',
        await page.evaluate(
          () =>
            window.mobile.game.pending === 0 &&
            window.mobile.game.chosen.length >= 2 &&
            window.mobile.orders.length === 0,
        ),
      );
      await tapControl('unit/card-move');
      await page.touchscreen.tap(width * 0.52, height * 0.4);
      await frames(8);
      check(
        'Tapping a destination issues Move once and keeps the group selected',
        await page.evaluate(() => window.mobile.orders.length === 1 && window.mobile.game.chosen.length >= 2),
      );
      // Use the actual on-canvas Build flow, including its touch-accessible menu.
      await page.evaluate(() => {
        const g = window.mobile.game;
        g.chosen = [];
        g.setView({
          ...g.camera,
          x: (g.town.map().camp().x - g.town.map().camp().y) * 32,
          y: (g.town.map().camp().x + g.town.map().camp().y) * 16,
          zoom: 1.4,
        });
      });
      await frames(16);
      check(
        'Build and Units are available without hovering',
        (await button('build-handle')).h >= 44 && (await button('unit-roster')).h >= 44,
      );
      await tapControl('build-handle');
      await tapControl('global/card-group-Housing');
      await tapControl('global/card-pick-Camp');
      check(
        'A building starts as a visible preview, with no construction placed',
        await page.evaluate(() => {
          const g = window.mobile.game;
          return !!g.touchPlacement && g.current.preview.valid && g.town.buildings().length === 0;
        }),
      );
      check(
        'Placement controls are at least 44 pixels and stay inside the viewport',
        await page.evaluate(() => {
          const g = window.mobile.game;
          return g.context.controls
            .filter((c) => c.id.startsWith('placement-'))
            .every(
              ({ bounds: r }) =>
                r.w >= 44 &&
                r.h >= 44 &&
                r.x >= 0 &&
                r.y >= 0 &&
                r.x + r.w <= innerWidth &&
                r.y + r.h <= innerHeight,
            );
        }),
      );
      check(
        'Quests do not cover building placement',
        await page.evaluate(
          () => !window.mobile.game.context.controls.some((c) => c.id === 'objectives-panel'),
        ),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-placement.png` });
      const candidateBefore = await page.evaluate(() => ({ ...window.mobile.game.touchPlacement }));
      await tapControl('placement-rotate');
      check(
        'Releasing a touch button does not leave a focused tooltip on the map',
        await page.evaluate(() => !window.mobile.labels.some((l) => l.text === 'Rotate')),
      );
      check(
        'Rotating from the dock does not move the building onto the dock',
        await page.evaluate((before) => {
          const g = window.mobile.game;
          return (
            JSON.stringify(before) === JSON.stringify(g.touchPlacement) && g.town.buildings().length === 0
          );
        }, candidateBefore),
      );
      // Rotate the browser while a deliberately high candidate is selected.
      if (width === 390) {
        const camera = await page.evaluate(() => ({ ...window.mobile.game.camera }));
        await page.touchscreen.tap(width / 2, 180);
        await frames(4);
        const site = await page.evaluate(() => ({ ...window.mobile.game.touchPlacement }));
        await page.setViewportSize({ width: 844, height: 390 });
        await frames(16);
        check(
          'Rotation retains the chosen world site and keeps it above the dock',
          await page.evaluate((site) => {
            const g = window.mobile.game,
              screen = g.toScreen(g.touchPlacement);
            return (
              JSON.stringify(site) === JSON.stringify(g.touchPlacement) &&
              screen.y >= 64 &&
              screen.y < g.dockBounds.y - 24 &&
              screen.x > 12 &&
              screen.x < innerWidth - 12
            );
          }, site),
        );
        await page.screenshot({ path: `${output}/rotation-placement.png` });
        await page.setViewportSize({ width, height });
        await frames(16);
        await page.evaluate((camera) => window.mobile.game.setView(camera), camera);
        await frames(4);
      }
      const target = { x: width * 0.52, y: height * 0.42 };
      await touch('touchStart', [[target.x - 15, target.y]]);
      await touch('touchMove', [[target.x, target.y + 10]]);
      await touch('touchEnd', []);
      await frames(8);
      check(
        'Moving the preview does not place the building on touch-down',
        await page.evaluate(() => window.mobile.game.town.buildings().length === 0),
      );
      const chosen = await page.evaluate(() => ({ ...window.mobile.game.touchPlacement }));
      check(
        'A valid world position enables Place',
        await page.evaluate(
          () => window.mobile.game.context.controls.find((c) => c.id === 'placement-confirm').enabled,
        ),
      );
      const confirm = await button('placement-confirm');
      await touch('touchStart', [[confirm.x, confirm.y]]);
      await frames(3);
      check(
        'The preview remains visible while holding Place',
        await page.evaluate(() => window.mobile.game.current.preview.kind !== 0),
      );
      await touch('touchEnd', []);
      await frames(16);
      row.placement = await page.evaluate(() => {
        const g = window.mobile.game;
        return {
          candidate: g.touchPlacement,
          actual: g.town.camp()?.center,
          status: g.status,
          problem: g.current.problem,
          tool: g.tool,
        };
      });
      check(
        'Place builds at the preview location, never at the button',
        await page.evaluate((at) => {
          const camp = window.mobile.game.town.camp();
          return !!camp && Math.hypot(camp.center.x - at.x, camp.center.y - at.y) < 1;
        }, chosen),
      );
      await page.evaluate(() => {
        const g = window.mobile.game;
        g.town.camp().progress = 1;
      });
      await frames(16);
      check(
        'A completed Camp shows supplies in the bottom inspector on touch',
        await page.evaluate(() => {
          const g = window.mobile.game;
          return (
            window.mobile.labels.some((l) => l.text === 'Village stores') &&
            window.mobile.labels.some((l) => l.text === 'Bones') &&
            g.dockBounds.y + g.dockBounds.h === g.viewHeight - 12
          );
        }),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-stores.png` });
      await page.evaluate(() => {
        const g = window.mobile.game;
        g.selected = -1;
        g.chosen = [];
        g.selectTool(window.mobile.Tool.Road);
      });
      await frames(16);
      const start = { x: width * 0.35, y: height * 0.46 };
      const roadsBefore = await page.evaluate(() => window.mobile.game.town.roads().roads().length);
      await touch('touchStart', [[start.x, start.y, 0]]);
      await touch('touchMove', [[start.x + 20, start.y, 0]]);
      await touch('touchStart', [
        [start.x + 20, start.y, 0],
        [start.x + 85, start.y, 1],
      ]);
      await touch('touchMove', [
        [start.x + 10, start.y, 0],
        [start.x + 95, start.y, 1],
      ]);
      await touch('touchEnd', [[start.x + 10, start.y, 0]]);
      await touch('touchMove', [[start.x + 30, start.y, 0]]);
      await touch('touchEnd', []);
      await frames(16);
      check(
        'Pinching cancels a road stroke and ignores the remaining finger',
        await page.evaluate((n) => {
          const g = window.mobile.game;
          return g.roadPress === null && g.town.roads().roads().length === n;
        }, roadsBefore),
      );
      const line = await page.evaluate(async () => {
        const { point, project, add, rotated } = await import('/packages/engine/src/geometry.ts');
        const { sharpAnchor } = await import('/packages/engine/src/road-network.ts');
        const g = window.mobile.game,
          camp = g.town.camp(),
          a = add(camp.center, rotated(point(1, 0), camp.angle)),
          b = add(camp.center, rotated(point(5, 0), camp.angle)),
          focus = project((a.x + b.x) / 2, (a.y + b.y) / 2);
        const check = g.town.canBuildRoad([sharpAnchor(a), sharpAnchor(b)]);
        if (!check.ok) throw Error(check.reason);
        g.setView({ x: focus.x, y: focus.y + 45, zoom: 1.2 });
        return { a: g.toScreen(a), b: g.toScreen(b) };
      });
      await frames(16);
      await touch('touchStart', [[line.a.x, line.a.y]]);
      for (let step = 1; step <= 8; ++step)
        await touch('touchMove', [
          [line.a.x + ((line.b.x - line.a.x) * step) / 8, line.a.y + ((line.b.y - line.a.y) * step) / 8],
        ]);
      await touch('touchEnd', []);
      await frames(16);
      check(
        'A one-finger road stroke creates an actual construction request',
        await page.evaluate(
          (before) => window.mobile.game.town.roads().roads().length === before + 1,
          roadsBefore,
        ),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-road.png` });
      await page.evaluate(() => window.mobile.game.selectTool(window.mobile.Tool.Road));
      await frames(16);
      await tapControl('placement-cancel');
      await tapControl('speed-toggle');
      check(
        'All time controls are visible and tappable',
        await page.evaluate(() => {
          const controls = window.mobile.game.context.controls.filter(
            (c) => c.id.startsWith('speed-') && c.id !== 'speed-toggle',
          );
          return (
            controls.length === 6 &&
            controls.every(({ bounds: r }) => r.w >= 44 && r.h >= 44 && r.x >= 0 && r.x + r.w <= innerWidth)
          );
        }),
      );
      await page.screenshot({ path: `${output}/${width}x${height}-controls.png` });
      // Exercise the same offset/size change produced by display cutout insets.
      const insetStyle = await page.addStyleTag({
        content:
          '#world{left:20px;top:16px;width:calc(100vw - 40px)!important;height:calc(100dvh - 32px)!important}',
      });
      await frames(8);
      const inset = await page.evaluate(() => {
        const g = window.mobile.game,
          r = document.querySelector('#world').getBoundingClientRect();
        return {
          x: g.camera.x,
          zoom: g.camera.zoom,
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        };
      });
      await touch('touchStart', [[inset.left + inset.width * 0.4, inset.top + inset.height * 0.46]]);
      await touch('touchMove', [[inset.left + inset.width * 0.4 + 50, inset.top + inset.height * 0.46]]);
      await touch('touchEnd', []);
      await frames(4);
      check(
        'Inset canvas coordinates pan correctly and match the logical game viewport',
        await page.evaluate((before) => {
          const g = window.mobile.game;
          return (
            Math.abs(g.camera.x - (before.x - 50 / before.zoom)) < 0.01 &&
            g.viewWidth === before.width &&
            g.viewHeight === before.height
          );
        }, inset),
      );
      await insetStyle.evaluate((style) => style.remove());
    } finally {
      await page.evaluate(() => window.mobile?.runtime.dispose()).catch(() => {});
      await context.close();
    }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
