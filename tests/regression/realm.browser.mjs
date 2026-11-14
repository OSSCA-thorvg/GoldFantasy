import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const wantedGate = process.env.REALM_GATE ?? '';
const output = 'artifacts/regression/realm' + (wantedGate ? '/gate-' + wantedGate : '');
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
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 280000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/realm-probe${wantedGate ? '?gate=' + wantedGate : ''}`);
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
      { decodeTown, encodeTown },
      { Town },
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
      import('/packages/engine/src/save-game.ts'),
      import('/packages/engine/src/town.ts'),
    ]);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    document.body.append(element);
    const canvas = new tvg.Canvas(element, { width: 1280, height: 800, enableDevicePixelRatio: false }),
      fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('realm-validation'),
      game = createNativeServices(tvg, fonts, files).createPreview(5),
      town = game.town,
      params = new URLSearchParams(location.search),
      wanted = Number(params.get('gate') ?? -1),
      gate = wanted >= 0 ? wanted : town.map().dungeons().findIndex(sealable),
      site = town.map().dungeons()[gate];
    site.discovered = true;
    const camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    // A mixed party, armed by calling.
    const kit = [
      [Calling.Warrior, 'sword'],
      [Calling.Warrior, 'sword'],
      [Calling.Ranger, 'bow'],
      [Calling.Mage, 'staff'],
      [Calling.Cleric, 'mace'],
    ];
    for (const [calling, weapon] of kit.slice(town.folk.length)) {
      const p = town.makePerson(Role.Resident, calling, monsterEntrance(site));
      p.inventory[0] = { item: weapon, quantity: 1 };
      p.equipment.weapon = 1;
      town.folk.push(p);
    }
    for (const p of town.folk) {
      p.level = 22;
      p.position = { ...monsterEntrance(site) };
      p.activity = Activity.Expedition;
      p.inside = true;
      p.food = p.rest = p.hydration = 1;
      // Both skills on auto, as a player who uses them would.
      p.abilityAuto = p.abilityAuto2 = 1;
    }
    town.parties.push({ dungeon: gate, members: town.folk.map((p) => p.id), floor: 0 });
    const focus = project(site.origin.x + 1, site.origin.y + 1);
    game.camera = new Camera(focus.x, focus.y, 1.6);
    window.realmProbe = {
      game,
      gate,
      now: 0,
      frame(dt = 0.05) {
        this.now += dt;
        game.render(1280, 800, this.now, true, dt, this.now);
        canvas.update().render();
        game.takeCues();
      },
      run(seconds, order) {
        for (let t = 0; t < seconds; t += 0.2) {
          if (order && Math.round(t * 5) % 40 === 0) order();
          game.town.advance(0.2);
        }
        this.frame();
      },
      heart() {
        // Every den must fall as well as the guardian: the nearest den left first, then the heart.
        const chamber = game.town.realmPlan().chambers.find((c) => c.kind === 2),
          party = game.town.realmParty(),
          lead = party.find((p) => p.downedAt < 0) ?? party[0],
          gap = (m) => Math.hypot(m.position.x - lead.position.x, m.position.y - lead.position.y),
          den = game.town.realmDens().sort((a, b) => gap(a) - gap(b))[0];
        game.town.orderAttackMove(party.map((p) => p.id), den?.position ?? chamber.center);
      },
      reload() {
        game.town = decodeTown(encodeTown(game.town), (map) => new Town(map, 176, false, true));
        const at = project(game.town.map().camp().x, game.town.map().camp().y);
        game.camera = new Camera(at.x, at.y, 1.6);
        game.selectPeople([]);
      },
      zoom(value) {
        game.camera.zoom = value;
      },
      look(x, y, zoom) {
        const at = project(x, y);
        game.camera = new Camera(at.x, at.y, zoom);
      },
      snapshot() {
        const plan = game.town.realmPlan();
        return {
          active: game.town.realmActive(),
          cleared: game.town.realmCleared,
          foes: game.town.realmFoes().length,
          party: game.town.realmParty().length,
          depth: game.town.depth[gate] ?? 0,
          loot: { ...game.town.realmLoot },
          stock: { ...game.town.stock() },
          reward: game.town.realmReward?.title ?? null,
          area: game.town.realmArea,
          camera: { x: game.camera.x, y: game.camera.y },
          entry: plan ? project(plan.entry.x, plan.entry.y) : null,
          chosen: [...game.chosen],
          controls: game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled })),
        };
      },
    };
    canvas.add(game.worldScene()).add(game.hudScene());
    element.addEventListener('pointermove', (e) => game.pointerMove(e.clientX, e.clientY));
    element.addEventListener('pointerdown', (e) => game.pointerDown(e.clientX, e.clientY, 0));
    element.addEventListener('pointerup', (e) => {
      game.pointerUp(e.clientX, e.clientY, 0);
      realmProbe.frame();
    });
    for (let i = 0; i < 6; ++i) realmProbe.frame();
  });
  const snapshot = () => page.evaluate(() => realmProbe.snapshot());
  const frames = (count) => page.evaluate((count) => { for (let i = 0; i < count; ++i) realmProbe.frame(); }, count);
  const click = async (id) => {
    const control = (await snapshot()).controls.find((c) => c.id === id);
    assert(control, `Missing ${id}`);
    assert(control.enabled, `Disabled ${id}`);
    await page.mouse.click(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2);
    await frames(2);
  };
  await frames(4);
  let state = await snapshot();
  assert(state.active, 'The party is carried into the world beyond the gate');
  assert.equal(state.party, 5);
  assert(Math.abs(state.camera.x - state.entry.x) < 1 && Math.abs(state.camera.y - state.entry.y) < 1, 'Camera follows');
  assert.equal(state.chosen.length, 5, 'The party is selected on arrival');
  assert(state.controls.some((c) => c.id === 'realm-panel'));
  await page.screenshot({ path: `${output}/arrival.png` });
  // Quit and Continue in the middle of the delve: the island, the party and the view come back.
  await page.evaluate(() => realmProbe.run(4, () => realmProbe.heart()));
  const before = await snapshot();
  await page.evaluate(() => realmProbe.reload());
  await frames(4);
  state = await snapshot();
  assert(state.active && state.party === 5, 'The delve survives a reload');
  assert.equal(state.foes, before.foes);
  assert.equal(state.chosen.length, 5, 'The party is selected after a reload');
  assert(state.controls.some((c) => c.id === 'realm-panel'));
  const member = await page.evaluate(() => {
    const p = realmProbe.game.town.realmParty()[0].position,
      at = realmProbe.game.camera;
    return { p, at: { x: at.x, y: at.y } };
  });
  await page.screenshot({ path: `${output}/reloaded.png` });
  await page.evaluate(() => {
    const a = realmProbe.snapshot().area;
    realmProbe.look(a.x + a.size / 2, a.y + a.size / 2, 0.62);
    realmProbe.game.town.scout(a.x + a.size / 2, a.y + a.size / 2, 40);
    realmProbe.frame();
  });
  await frames(3);
  await page.screenshot({ path: `${output}/whole-realm.png` });
  await page.evaluate(() => realmProbe.run(40, () => realmProbe.heart()));
  await page.evaluate(() => {
    const p = realmProbe.game.town.realmParty()[0].position;
    realmProbe.look(p.x, p.y, 1.8);
    realmProbe.frame();
  });
  await frames(3);
  await page.screenshot({ path: `${output}/fighting.png` });
  await page.evaluate(() => {
    for (let i = 0; i < 12 && !realmProbe.game.town.realmCleared; ++i) realmProbe.run(40, () => realmProbe.heart());
  });
  state = await snapshot();
  assert(state.cleared, 'The guardian falls');
  assert.equal(state.depth, 1);
  assert.equal(state.reward, 'Floor 1 cleared');
  await frames(3);
  await page.screenshot({ path: `${output}/reward.png` });
  await click('realm-reward-close');
  await page.evaluate(() => realmProbe.run(6));
  await click('realm-leave');
  await frames(4);
  state = await snapshot();
  assert(!state.active, 'The party is home');
  assert(Object.values(state.stock).some((amount) => amount > 0), 'The hoard reached the settlement');
  await page.screenshot({ path: `${output}/home.png` });
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
  else console.log('realm browser validation passed');
}
