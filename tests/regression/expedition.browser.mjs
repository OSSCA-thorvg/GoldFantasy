import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// The expedition window under real mouse, keys and touch: empty, a party chosen, a party too weak, a sealed gate,
// Korean, and a phone; then a party sent through it. Pictures and a gallery go to artifacts/regression/expedition.
const output = 'artifacts/regression/expedition';
const report = { errors: [], passed: false, shots: [] };
let server, browser, deadline;
const setup = async (page, width, height, touch) =>
  page.evaluate(
    async ([width, height, touch]) => {
      const [
        { initializeWebCanvas },
        { loadNativeFonts, loadKoreanFont },
        { BrowserFiles },
        { createNativeServices },
        { BrowserHost },
        { defaultLaunchOptions },
        { Calling, Role },
        { project },
        { sealable },
        { monsterEntrance },
        { Building },
        { Structure },
        { itemCatalog },
        localization,
      ] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'),
        import('/apps/web/src/native/bootstrap.ts'),
        import('/apps/web/src/native/browser-host.ts'),
        import('/apps/web/src/native/application-contracts.ts'),
        import('/packages/engine/src/person.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/gate-seals.ts'),
        import('/packages/engine/src/town-monsters.ts'),
        import('/packages/engine/src/town-models.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/equipment.ts'),
        import('/packages/localization/src/index.ts'),
      ]);
      (await import('/apps/web/src/native/guide-preferences.ts')).setGuidePreference('cards', false);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      element.style.cssText = `display:block;width:${width}px;height:${height}px`;
      document.body.append(element);
      const fonts = await loadNativeFonts(tvg);
      await loadKoreanFont(tvg, fonts);
      const files = await BrowserFiles.open('expedition-validation'),
        services = createNativeServices(tvg, fonts, files),
        app = services.createApplication({ ...defaultLaunchOptions(), world: 'Random', seed: 5 }),
        host = new BrowserHost(element, tvg, app, { autoStart: false, devicePixelRatio: false }),
        game = app.game,
        town = game.town,
        gate = town.map().dungeons().findIndex(sealable),
        site = town.map().dungeons()[gate];
      if (touch) app.setTouchInput?.(true);
      game.touchMode = touch;
      town.awaiting = false;
      site.discovered = true;
      const camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
      camp.village = 0;
      town.placed.push(camp);
      town.nextId = 1;
      town.foundSettlement(0);
      town.folk = [];
      const shape = (c) => (c === Calling.Warrior ? 'sword' : c === Calling.Ranger ? 'bow' : c === Calling.Mage ? 'staff' : 'mace');
      const near = monsterEntrance(site);
      [
        [Calling.Warrior, 5],
        [Calling.Ranger, 4],
        [Calling.Mage, 4],
        [Calling.Cleric, 4],
        [Calling.Bard, 2],
        [Calling.Warrior, 3],
        [Calling.Settler, 2],
        [Calling.Settler, 1],
      ].forEach(([calling, level], i) => {
        const p = town.makePerson(Role.Resident, calling, town.grid.nearestWalkable({ x: near.x + 1 + (i % 4) * 0.8, y: near.y + 1.5 + Math.floor(i / 4) }));
        p.level = level;
        p.food = p.rest = p.hydration = 1;
        p.stress = 0;
        const item = itemCatalog
          .filter((it) => it.category === 'weapon' && it.visual === shape(calling) && it.minimumLevel <= level)
          .sort((a, b) => b.attackBonus - a.attackBonus)[0];
        if (item && calling !== Calling.Settler) {
          p.inventory[0] = { item: item.id, quantity: 1 };
          p.equipment.weapon = 1;
        }
        town.folk.push(p);
      });
      // Two who cannot go: a wounded warrior and an overwhelmed settler.
      town.folk[5].woundDays = 2;
      town.folk[5].health = 0.4;
      town.folk[7].stressRecovery = true;
      window.probe = {
        app,
        host,
        game,
        gate,
        localization,
        now: 1,
        frames(count, dt = 0.05) {
          for (let i = 0; i < count; ++i) {
            this.now += dt;
            app.dirty = true;
            host.render(this.now);
          }
        },
        look() {
          const at = project(site.origin.x + 1, site.origin.y + 2);
          game.camera.x = at.x;
          game.camera.y = at.y;
          game.camera.zoom = touch ? 1.1 : 1.3;
          game.invalidatePresentation();
        },
        gateScreen() {
          const o = site.origin;
          for (const [dx, dy] of [[1, 1], [1, 0.6], [1, 1.5], [0.6, 1], [1.4, 1], [1, 2], [0.5, 0.5], [1.5, 1.5]]) {
            const at = game.toScreen({ x: o.x + dx, y: o.y + dy });
            if (game.renderer.pick(at)?.kind === 'dungeon') return at;
          }
          return null;
        },
        snapshot() {
          const w = game.expedition;
          return {
            open: !!w,
            party: w ? [...w.party] : [],
            paused: game.paused,
            active: game.town.realmActive(),
            marching: game.town.parties.length,
            controls: game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled })),
          };
        },
      };
      probe.look();
      probe.frames(8);
      element.focus();
    },
    [width, height, touch],
  );

try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'expedition-validation',
        configureServer(vite) {
          vite.middlewares.use('/expedition-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Expedition validation</title></head><body style="margin:0;background:#11191c;overflow:hidden"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 400000);
  const url = `http://127.0.0.1:${server.httpServer.address().port}/expedition-probe`;

  // ---------------------------------------------------------------- desktop
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(url);
    await setup(page, 1280, 800, false);
    const snapshot = () => page.evaluate(() => probe.snapshot());
    const frames = (count, dt = 0.05) => page.evaluate(([count, dt]) => probe.frames(count, dt), [count, dt]);
    const shot = async (name) => {
      await frames(2, 0.001);
      const path = `${output}/${name}.png`;
      await page.screenshot({ path });
      report.shots.push(name);
    };
    const click = async (id) => {
      const control = (await snapshot()).controls.find((c) => c.id === id);
      assert(control, `Missing ${id}`);
      assert(control.enabled, `Disabled ${id}`);
      await page.mouse.click(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2);
      await frames(2, 0.001);
    };
    const gate = await page.evaluate(() => probe.gateScreen());
    assert(gate, 'The gate can be pointed at');
    // A plain click on the gate opens the window with nobody chosen.
    await page.mouse.click(gate.x, gate.y);
    await frames(2, 0.001);
    let state = await snapshot();
    assert(state.open && state.paused, 'A click on the gate opens the window and pauses');
    assert.equal(state.party.length, 0);
    assert(!state.controls.find((c) => c.id === 'expedition-set-out').enabled, 'Nothing to send yet');
    await shot('window-empty');
    await click('expedition-pick-fighters');
    state = await snapshot();
    assert.equal(state.party.length, 5, 'All fighters who can go');
    await shot('window-party');
    await click('expedition-pick-clear');
    const bard = await page.evaluate(() => probe.game.town.folk[4].id);
    await click(`expedition-member-${bard}`);
    assert.deepEqual((await snapshot()).party, [bard]);
    await shot('window-too-weak');
    await page.keyboard.press('Escape');
    await frames(2, 0.001);
    state = await snapshot();
    assert(!state.open && !state.paused, 'Escape closes and the game runs again');
    // A sealed gate is shown read-only.
    await page.evaluate(() => (probe.game.town.depth[probe.gate] = 3));
    await page.mouse.click(gate.x, gate.y);
    await frames(2, 0.001);
    state = await snapshot();
    assert(state.open);
    assert(!state.controls.some((c) => c.id.startsWith('expedition-member-')), 'No roster at a sealed gate');
    await shot('window-sealed');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (probe.game.town.depth[probe.gate] = 0));
    await frames(2, 0.001);
    // Korean.
    await page.evaluate(() => probe.localization.setLocale('KR'));
    await page.mouse.click(gate.x, gate.y);
    await frames(2, 0.001);
    await click('expedition-pick-fighters');
    await shot('window-korean');
    await page.keyboard.press('Escape');
    await page.evaluate(() => probe.localization.setLocale('EN'));
    await frames(2, 0.001);
    await frames(2, 0.001);
    // Selected residents and a right-click on the gate: they come chosen; Enter sends them; they walk in.
    await page.evaluate(() => probe.game.selectPeople(probe.game.town.folk.slice(0, 4).map((p) => p.id)));
    await frames(2, 0.001);
    await page.mouse.click(gate.x, gate.y, { button: 'right' });
    await frames(2, 0.001);
    state = await snapshot();
    assert.equal(state.party.length, 4, 'Right-click brings the selection in chosen');
    await page.keyboard.press('Enter');
    await frames(2, 0.001);
    state = await snapshot();
    assert(!state.open && state.marching === 1, 'Enter sets out');
    for (let i = 0; i < 40 && !(await snapshot()).active; ++i) await frames(4, 0.25);
    assert((await snapshot()).active, 'The party walked in and the world beyond rose');
    await shot('party-beyond');
    await context.close();
  }

  // ---------------------------------------------------------------- phone
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(url);
    await setup(page, 390, 844, true);
    const snapshot = () => page.evaluate(() => probe.snapshot());
    const frames = (count, dt = 0.05) => page.evaluate(([count, dt]) => probe.frames(count, dt), [count, dt]);
    const tap = async (id) => {
      const control = (await snapshot()).controls.find((c) => c.id === id);
      assert(control, `Missing ${id}`);
      await page.touchscreen.tap(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2);
      await frames(2, 0.001);
    };
    const gate = await page.evaluate(() => probe.gateScreen());
    assert(gate, 'The gate can be tapped');
    await page.touchscreen.tap(gate.x, gate.y);
    await frames(2, 0.001);
    let state = await snapshot();
    assert(state.open, 'A tap on the gate opens the window');
    await tap('expedition-pick-fighters');
    state = await snapshot();
    assert.equal(state.party.length, 5);
    for (const c of state.controls.filter((c) => c.id.startsWith('expedition-') && !['expedition-backdrop', 'expedition-panel', 'expedition-list'].includes(c.id))) {
      assert(c.bounds.x >= 0 && c.bounds.y >= 0 && c.bounds.x + c.bounds.w <= 390 && c.bounds.y + c.bounds.h <= 844, `${c.id} on screen`);
      assert(c.bounds.h >= 44, `${c.id} tall enough for a finger (${c.bounds.h})`);
    }
    const first = state.party[0];
    await tap(`expedition-member-${first}`);
    assert(!(await snapshot()).party.includes(first), 'A tap leaves a resident behind');
    await tap(`expedition-member-${first}`);
    await frames(2, 0.001);
    await page.screenshot({ path: `${output}/window-phone.png` });
    report.shots.push('window-phone');
    await context.close();
  }

  const captions = {
    'window-empty': 'A click on the gate: nobody chosen yet, Set out disabled',
    'window-party': 'All fighters chosen: the verdict says ready',
    'window-too-weak': 'One low bard: too few to stand against a swarm',
    'window-sealed': 'A sealed gate, read-only',
    'window-korean': 'Korean',
    'party-beyond': 'The party sent with Enter has walked through',
    'window-phone': 'Phone, 390 x 844, touch',
  };
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Expedition window</title><style>body{background:#151a1c;color:#ddd;font:14px sans-serif;margin:16px}figure{display:inline-block;margin:0 16px 24px 0;vertical-align:top}img{max-width:640px;max-height:640px;border:1px solid #444}</style></head><body><h1>Expedition window</h1>${report.shots
      .map((name) => `<figure><img src="${name}.png" alt="${name}"><figcaption>${captions[name] ?? name}</figcaption></figure>`)
      .join('')}</body></html>`,
  );
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
  else console.log('expedition browser validation passed');
}
