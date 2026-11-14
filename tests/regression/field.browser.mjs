import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const output = 'artifacts/regression/field';
const report = { errors: [], passed: false };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'realm-validation',
        configureServer(vite) {
          vite.middlewares.use('/realm-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Realm validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 280000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/realm-probe`);
  await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { BrowserFiles },
      { createNativeServices },
      { Activity, Calling, Role },
      { Camera, project },
      { sealable },
      { monsterEntrance },
      { Building },
      { Structure },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/gate-seals.ts'),
      import('/packages/engine/src/town-monsters.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
    ]);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    document.body.append(element);
    const canvas = new tvg.Canvas(element, { width: 1280, height: 800, enableDevicePixelRatio: false }),
      fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('field-validation'),
      game = createNativeServices(tvg, fonts, files).createPreview(5),
      town = game.town,
      origin = town.map().camp();
    const camp = new Building(0, Structure.Camp, origin, 0, 0);
    camp.village = 0;
    const farm = new Building(1, Structure.Farm, { x: origin.x + 3, y: origin.y }, 0, 0);
    farm.village = 0;
    farm.workers = 2;
    town.placed.push(camp, farm);
    town.nextId = 2;
    town.foundSettlement(0);
    town.stock().food = 50;
    for (const p of town.folk) {
      p.job = farm.id;
      p.village = p.home = 0;
      p.food = p.rest = p.hydration = 1;
    }
    town.editHour(9);
    town.scout(origin.x + 3, origin.y + 3, 12);
    const outline = [
      { x: origin.x + 1.5, y: origin.y + 1.6 },
      { x: origin.x + 5.5, y: origin.y + 1.6 },
      { x: origin.x + 5.5, y: origin.y + 4.6 },
      { x: origin.x + 1.5, y: origin.y + 4.6 },
    ];
    const planted = town.plantField(outline),
      reason = town.canPlantField(outline).reason,
      focus = project(origin.x + 3.5, origin.y + 3);
    game.camera = new Camera(focus.x, focus.y, 3.2);
    window.fieldProbe = {
      planted,
      reason,
      now: 0,
      frame(dt = 0.05) {
        this.now += dt;
        game.render(1280, 800, this.now, true, dt, this.now);
        canvas.update().render();
        game.takeCues();
      },
      run(until) {
        for (let i = 0; i < 4000 && (town.fields()[0]?.tilled ?? 1) < until; ++i) town.advance(0.1);
        for (let i = 0; i < 4; ++i) this.frame();
        return {
          tilled: town.fields()[0]?.tilled,
          workers: town.folk.map((p) => ({ activity: p.activity, field: p.workField, moving: p.path.length > 0 })),
        };
      },
    };
    canvas.add(game.worldScene()).add(game.hudScene());
    for (let i = 0; i < 6; ++i) fieldProbe.frame();
  });
  const info = await page.evaluate(() => ({ planted: fieldProbe.planted, reason: fieldProbe.reason }));
  assert(info.planted, 'Field planted: ' + info.reason);
  await page.screenshot({ path: `${output}/staked.png` });
  let state = await page.evaluate(() => fieldProbe.run(0.5));
  assert(state.tilled >= 0.5, JSON.stringify(state));
  await page.screenshot({ path: `${output}/half-tilled.png` });
  state = await page.evaluate(() => fieldProbe.run(1));
  assert.equal(state.tilled, 1);
  await page.screenshot({ path: `${output}/tilled.png` });
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)).catch(() => {});
  if (!report.passed) console.error(report.errors.join('\n'));
  else console.log('field browser validation passed');
}
