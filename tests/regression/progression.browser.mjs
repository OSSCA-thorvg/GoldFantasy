import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Draws the watchtower, training yard and runestone beside a camp.
const output = 'artifacts/regression/progression';
const report = { errors: [], passed: false };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'progression-validation',
        configureServer(vite) {
          vite.middlewares.use('/progression-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Progression validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 200000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/progression-probe`);
  const placed = await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { BrowserFiles },
      { createNativeServices },
      { Camera, project },
      { Building },
      { Structure },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
    ]);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    document.body.append(element);
    const canvas = new tvg.Canvas(element, { width: 1280, height: 800, enableDevicePixelRatio: false }),
      fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('progression-validation'),
      game = createNativeServices(tvg, fonts, files).createPreview(5),
      town = game.town,
      origin = town.map().camp();
    const camp = new Building(0, Structure.Camp, origin, 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    town.editHour(10);
    town.scout(origin.x, origin.y, 14);
    const kinds = [Structure.Watchtower, Structure.TrainingYard, Structure.Runestone],
      spots = [];
    for (const kind of kinds) {
      let done = false;
      for (let r = 2.5; r < 9 && !done; r += 0.5)
        for (let a = 0; a < 24 && !done; ++a) {
          const p = { x: origin.x + r * Math.cos((a * Math.PI) / 12), y: origin.y + r * Math.sin((a * Math.PI) / 12) };
          if (town.canPlace(kind, p, 0).ok && town.place(kind, p, 0)) {
            spots.push(p);
            done = true;
          }
        }
    }
    town.completeConstruction();
    const cx = spots.reduce((s, p) => s + p.x, origin.x) / (spots.length + 1),
      cy = spots.reduce((s, p) => s + p.y, origin.y) / (spots.length + 1),
      focus = project(cx, cy);
    game.camera = new Camera(focus.x, focus.y, 3);
    canvas.add(game.worldScene()).add(game.hudScene());
    let now = 0;
    // Let the finished buildings rise fully before the picture.
    for (let i = 0; i < 120; ++i) {
      now += 0.05;
      game.render(1280, 800, now, true, 0.05, now);
      canvas.update().render();
      game.takeCues();
    }
    return town.placed.filter((b) => kinds.includes(b.kind) && b.built()).length;
  });
  assert.equal(placed, 3, 'all three buildings placed and built');
  await page.screenshot({ path: `${output}/new-buildings.png` });
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
  else console.log('progression browser validation passed');
}
