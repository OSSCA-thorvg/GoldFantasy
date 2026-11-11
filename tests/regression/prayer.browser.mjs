import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const renderer = process.argv.find((arg) => arg.startsWith('--renderer='))?.slice(11) ?? 'sw';
assert(['sw', 'gl'].includes(renderer));
const onlyWeather = process.argv.find((arg) => arg.startsWith('--weather='))?.slice(10);
const output = 'artifacts/regression/prayer' + (renderer === 'sw' ? '' : '/' + renderer);
const report = { renderer, cases: [], errors: [], passed: false };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'prayer-validation',
        configureServer(vite) {
          vite.middlewares.use('/prayer-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Offering validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 240000);
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/prayer-probe`);
  await page.evaluate(async (renderer) => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts, Key },
      { BrowserFiles },
      { createNativeServices },
      { Town },
      { WorldMap },
      { Layer, Terrain },
      { Building },
      { Resources, Structure },
      { Person, Role, Calling, Race, Activity },
      { Camera, project, point },
      { copyNative },
      { Weather },
      { encodeTown },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/packages/engine/src/town.ts'),
      import('/packages/engine/src/world-map.ts'),
      import('/packages/engine/src/world-types.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/native-copy.ts'),
      import('/packages/engine/src/climate.ts'),
      import('/packages/engine/src/save-game.ts'),
    ]);
    const tvg = await initializeWebCanvas(renderer),
      element = document.createElement('canvas');
    document.body.append(element);
    element.tabIndex = 0;
    const canvas = new tvg.Canvas(element, { width: 1024, height: 768, enableDevicePixelRatio: false }),
      fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('prayer-validation'),
      services = createNativeServices(tvg, fonts, files),
      game = services.createPreview(5);
    const map = WorldMap.generate(5, 32, 32);
    map.ymir = map.fire = null;
    map.sites = [];
    map.stream = { path: [], width: [] };
    for (const layer of map.layers) layer.fill(0.4);
    map.layer(Layer.Land).fill(1);
    map.layer(Layer.Ridge).fill(-1);
    for (let y = 0; y < 32; ++y)
      for (let x = 0; x < 32; ++x)
        Object.assign(map.at(x, y), { terrain: Terrain.Grass, trees: 0, revealed: true, dungeon: -1 });
    map.reveal(16, 16, 100);
    const base = new Town(map, 32, false);
    base.placed = [
      new Building(0, Structure.Camp, point(10, 10), 0, 0),
      new Building(1, Structure.Shrine, point(14, 14), 0, 0),
    ];
    base.nextId = 2;
    base.migrateSettlements();
    Object.assign(base.stock(), new Resources(60, 60, 60, 60, 60, 60, 0, 0, 60));
    base.folk = [0, 1].map((id) => {
      const p = new Person(
        id,
        ['Eira', 'Halvor'][id],
        Role.Resident,
        Calling.Settler,
        Race.Human,
        id === 0 ? 13880 : 35710,
        point(12 + id, 13),
      );
      p.home = p.village = 0;
      p.food = p.rest = p.hydration = p.health = 1;
      p.stress = 0;
      p.autoMode = false;
      return p;
    });
    base.nextPerson = 2;
    base.wildlifeDay = base.days;
    base.editHour(12);
    base.tick(0);
    const focus = project(12, 12);
    window.prayerProbe = {
      game,
      canvas,
      tvg,
      files,
      now: 0,
      width: 1024,
      height: 768,
      frame(dt = 0) {
        this.now += dt;
        game.render(this.width, this.height, this.now, true, 0.25, this.now);
        canvas.update().render();
        game.takeCues();
      },
      reset(weather, hour, paused = false) {
        game.town = copyNative(base);
        game.selected = -1;
        game.chosen = [];
        game.town.editHour(hour);
        game.paused = paused;
        game.prayer = null;
        game.camera = new Camera(focus.x, focus.y, 2.8);
        game.renderer.invalidateMap();
        game.selectBuilding(1);
        for (let i = 0; i < 12; ++i) this.frame(0.05);
        // Freeze an actual climate checkpoint. Advancing spring time would
        // legitimately convert forced snow to rain before the modal opens.
        game.town.sky.force(Weather[weather], 0.9);
        if (weather === 'Snow') Object.assign(game.town.sky.now(), { snow: 0.7, temperature: -8 });
      },
      snapshot() {
        const d = game.prayer;
        return {
          clock: game.town.clock(),
          stock: { ...game.town.stock() },
          count: game.town.population(),
          paused: game.paused,
          open: !!d,
          started: d?.started,
          committed: d?.committed,
          finished: d?.finished,
          born: d?.born
            ? {
                name: d.born.name,
                calling: d.born.calling,
                level: d.born.level,
                inventory: d.born.inventory,
                equipment: d.born.equipment,
              }
            : null,
          weather: game.town.climate().weather,
          night: game.town.climate().night,
          ritualClimate: d ? { ...d.scene.climate } : null,
          actors: d?.scene.root.children.length,
          tasks: game.town
            .people()
            .slice(0, 2)
            .map((p) => ({ id: p.id, task: p.task, site: p.taskSite, position: { ...p.position } })),
          controls: game.context.controls.map((c) => ({
            id: c.id,
            bounds: { ...c.bounds },
            enabled: c.enabled,
          })),
        };
      },
      encodeTown,
    };
    canvas.add(game.worldScene()).add(game.hudScene());
    const event = (type, e, extra = {}) => {
      game.handlePrayerEvent({
        type,
        x: e.clientX ?? 0,
        y: e.clientY ?? 0,
        button: e.button === 0 ? 1 : 2,
        key: Key[e.key] ?? Key.Unknown,
        text: '',
        shift: !!e.shiftKey,
        ...extra,
      });
      prayerProbe.frame();
    };
    element.addEventListener('pointermove', (e) => {
      if (game.prayer) event('PointerMove', e);
      else game.pointerMove(e.clientX, e.clientY);
    });
    element.addEventListener('pointerdown', (e) => {
      if (game.prayer) event('PointerDown', e);
      else game.pointerDown(e.clientX, e.clientY, 0);
    });
    element.addEventListener('pointerup', (e) => {
      if (game.prayer) event('PointerUp', e);
      else {
        game.pointerUp(e.clientX, e.clientY, 0);
        prayerProbe.frame();
      }
    });
    window.addEventListener('keydown', (e) => {
      e.preventDefault();
      event('KeyDown', e);
      if (/^[0-9]$/.test(e.key)) event('Text', e, { text: e.key });
    });
  }, renderer);
  const frame = (dt) => page.evaluate((dt) => prayerProbe.frame(dt), dt);
  const snapshot = () => page.evaluate(() => prayerProbe.snapshot());
  const click = async (suffix) => {
    const state = await snapshot(),
      control = state.controls.find((c) => c.id.endsWith(suffix));
    assert(control, `Missing ${suffix}: ${state.controls.map((c) => c.id).join(', ')}`);
    assert(control.enabled, `Disabled ${suffix}`);
    await page.mouse.click(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2);
    await frame(0);
  };
  const fill = async (key, value) => {
    await click(`offering-${key}`);
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; ++i) await page.keyboard.press('Delete');
    await page.keyboard.type(String(value));
    await frame(0);
  };
  for (const [weather, hour, paused] of process.argv.includes('--picking-only')
    ? []
    : [
        ['Clear', 12, false],
        ['Rain', 12, false],
        ['Snow', 23, true],
        ['Storm', 23, false],
      ]) {
    if (onlyWeather && weather !== onlyWeather) continue;
    await page.evaluate(({ weather, hour, paused }) => prayerProbe.reset(weather, hour, paused), {
      weather,
      hour,
      paused,
    });
    await click('altar-pray');
    const before = await snapshot();
    if (!before.open || !before.paused) {
      report.entryFailure = before;
      await page.screenshot({ path: `${output}/entry-failure.png` });
    }
    assert(before.open && before.paused, JSON.stringify(before));
    assert.equal(before.weather, { Clear: 0, Rain: 2, Snow: 4, Storm: 3 }[weather]);
    assert.equal(before.weather, before.ritualClimate.weather);
    assert.equal(before.night, before.ritualClimate.night);
    assert(!before.controls.some((c) => c.id.includes('civic-person-')));
    for (const [key, value] of Object.entries({ water: 8, bones: 12, gold: 10, food: 16, stone: 6 }))
      await fill(key, value);
    if (weather === 'Clear') await page.screenshot({ path: `${output}/offering-configuration.png` });
    await click('prayer-confirm');
    await frame(0.8);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Space');
    await page.mouse.click(2, 2);
    const praying = await snapshot();
    assert(praying.open && praying.paused && !praying.committed);
    assert.equal(praying.count, before.count);
    assert.deepEqual(praying.stock, before.stock);
    assert.equal(praying.clock, before.clock);
    await page.screenshot({ path: `${output}/${weather.toLowerCase()}-prayer.png` });
    for (let i = 0; i < 80; ++i) await frame(0.05);
    await page.requestGC();
    await frame(0.2);
    const born = await snapshot();
    assert(born.committed && born.born);
    assert.equal(born.count, before.count + 1);
    for (const [key, count] of Object.entries({ water: 8, bones: 12, gold: 10, food: 16, stone: 6 }))
      assert.equal(born.stock[key], before.stock[key] - count);
    assert(born.born.inventory.every((item) => item === null));
    assert(Object.values(born.born.equipment).every((slot) => slot === -1));
    assert.equal(born.clock, before.clock);
    assert.deepEqual(born.tasks, before.tasks);
    await page.screenshot({ path: `${output}/${weather.toLowerCase()}-transformation.png` });
    await frame(2.5);
    const finished = await snapshot();
    assert(finished.finished);
    assert.equal(finished.count, born.count);
    await page.screenshot({ path: `${output}/${weather.toLowerCase()}-arrival.png` });
    await click('prayer-return');
    const after = await snapshot();
    assert(!after.open);
    assert.equal(after.paused, paused);
    report.cases.push({ weather, before, born, after, passed: true });
    console.log(`${weather}: prayer, transformation, unarmed arrival and pause restoration PASS`);
  }
  const altarHit = await page.evaluate(() => {
    prayerProbe.reset('Clear', 12, false);
    const g = prayerProbe.game;
    g.selected = -1;
    prayerProbe.frame();
    g.worldPresented(1);
    const at = g.toScreen(g.town.building(1).center);
    for (let y = at.y - 110; y < at.y + 8; y += 4)
      for (let x = at.x - 30; x <= at.x + 30; x += 4) {
        const hit = g.renderer.pick({ x, y });
        if (hit?.kind === 'building' && hit.id === 1) return { x, y };
      }
    const v = g.renderer.visuals.get(1);
    throw Error(
      'The rendered altar could not be picked by its real silhouette: ' +
        JSON.stringify({
          at,
          geometry: g.renderer.selectionGeometry({ kind: 'building', id: 1 }),
          bounds: v?.picture && g.renderer.adapter.renderedBounds(v.picture),
          candidates: g.renderer.picker.candidates.map((c) => ({ hit: c.hit?.key, bounds: c.bounds })),
        }),
    );
  });
  await page.mouse.click(altarHit.x, altarHit.y);
  await frame(0.2);
  assert.equal(await page.evaluate(() => prayerProbe.game.selectedBuilding()), 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    prayerProbe.width = 390;
    prayerProbe.height = 844;
    prayerProbe.canvas.resize(390, 844);
    prayerProbe.reset('Snow', 23, false);
    prayerProbe.game.openPrayer(1);
    prayerProbe.frame();
  });
  const phone = await snapshot();
  for (const c of phone.controls.filter((c) => c.id.startsWith('offering-') || c.id === 'prayer-confirm')) {
    assert(
      c.bounds.x >= 0 && c.bounds.y >= 0 && c.bounds.x + c.bounds.w <= 390 && c.bounds.y + c.bounds.h <= 844,
    );
  }
  await page.screenshot({ path: `${output}/mobile-offering.png` });
  await page.keyboard.press('Escape');
  await page.requestGC();
  const beforeCancelLoops = await page.evaluate(() => prayerProbe.encodeTown(prayerProbe.game.town));
  for (let i = 0; i < 6; ++i) {
    await page.evaluate(() => {
      prayerProbe.game.openPrayer(1);
      prayerProbe.frame(0.01);
    });
    await page.requestGC();
    await page.keyboard.press('Escape');
    await frame(0);
  }
  assert.equal(
    await page.evaluate(() => prayerProbe.encodeTown(prayerProbe.game.town)),
    beforeCancelLoops,
    'Cancelling a preview must not consume resources, create units or consume simulation RNG',
  );
  await page.evaluate(async () => {
    prayerProbe.canvas.remove();
    prayerProbe.game.dispose();
    prayerProbe.canvas.destroy();
    await prayerProbe.files.close();
    prayerProbe.tvg.term();
  });
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack ?? String(error);
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
}
