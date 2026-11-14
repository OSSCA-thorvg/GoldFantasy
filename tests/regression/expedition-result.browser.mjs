// The end of an expedition on screen: a fall, a death, the last fall and the result screens, in English, in Korean
// and at phone size. Headless, muted, on its own Vite server; pictures go to artifacts/regression/expedition-result.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const output = 'artifacts/regression/expedition-result';
const report = { errors: [], shots: [], passed: false };
let server, browser, deadline;

/** Runs in the page: a fresh game with a party of five beyond the nearest gate, and a probe to drive it. */
async function setup({ width, height, korean, touch }) {
  const [
    { initializeWebCanvas },
    { loadNativeFonts, loadKoreanFont },
    { BrowserFiles },
    { createNativeServices },
    { Calling, Role },
    { Camera, project },
    { sealable },
    { monsterEntrance },
    { Building },
    { Structure },
    { openExpedition },
    localization,
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
    import('/apps/web/src/native/expedition-window.ts'),
    import('/packages/localization/src/index.ts'),
  ]);
  const tvg = await initializeWebCanvas('gl'),
    element = document.createElement('canvas');
  element.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.append(element);
  const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
    fonts = await loadNativeFonts(tvg);
  if (korean) {
    await loadKoreanFont(tvg, fonts);
    localization.setLocale('KR');
  }
  const files = await BrowserFiles.open('expedition-result-validation'),
    game = createNativeServices(tvg, fonts, files).createPreview(5),
    town = game.town,
    gate = town.map().dungeons().findIndex(sealable),
    site = town.map().dungeons()[gate];
  game.touchMode = !!touch;
  town.awaiting = false;
  site.discovered = true;
  const camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  const kit = [
    [Calling.Warrior, 'Warrior'],
    [Calling.Warrior, 'Warrior'],
    [Calling.Ranger, 'Ranger'],
    [Calling.Mage, 'Mage'],
    [Calling.Cleric, 'Cleric'],
  ];
  for (const [calling] of kit.slice(town.folk.length)) town.folk.push(town.makePerson(Role.Resident, calling, monsterEntrance(site)));
  for (const p of town.folk) {
    p.level = 4;
    p.position = town.grid.nearestWalkable({ x: monsterEntrance(site).x + 1.5, y: monsterEntrance(site).y + 1.5 });
    p.food = p.rest = p.hydration = 1;
  }
  const focus = project(site.origin.x + 1, site.origin.y + 1);
  game.camera = new Camera(focus.x, focus.y, 1.6);
  canvas.add(game.worldScene()).add(game.hudScene());
  const key = (text) => ({ type: 'KeyDown', text, key: 0, x: 0, y: 0, delta: 0, button: 0, shift: false, control: false, alt: false, meta: false });
  window.probe = {
    game,
    gate,
    now: 0,
    key,
    frame(dt = 1 / 30) {
      this.now += dt;
      game.render(width, height, this.now, true, dt, this.now);
      canvas.update().render();
      game.takeCues();
    },
    frames(seconds, dt = 1 / 30) {
      for (let t = 0; t < seconds - 1e-6; t += dt) this.frame(dt);
    },
    party() {
      return game.town.realmParty();
    },
    look(dx, dy, zoom = 1.7) {
      const p = game.town.realmPlan().entry,
        at = project(p.x + dx, p.y + dy);
      game.camera = new Camera(at.x, at.y, zoom);
    },
    resume() {
      game.paused = false;
      game.combatHud.autoPause = null;
    },
    clearFloor() {
      const town = game.town,
        guardian = town.realmFoes().find((m) => m.id === town.realmGuardian);
      for (const m of [...town.realmDens(), guardian]) {
        m.health = 0;
        town.realmKill(m);
      }
      town.realmReward = null;
    },
    state() {
      const s = game.staging.moment;
      return {
        active: game.town.realmActive(),
        moment: s ? { beat: s.beat, names: [...s.names], held: s.held } : null,
        result: game.expeditionResult ? { end: game.expeditionResult.outcome.end } : null,
        paused: game.paused,
        clock: game.town.clock(),
        camera: { x: game.camera.x, y: game.camera.y },
        controls: game.context.controls.map((c) => c.id),
      };
    },
  };
  for (let i = 0; i < 6; ++i) probe.frame();
  if (!openExpedition(game, gate, town.folk.map((p) => p.id))) throw new Error('The gate has no expedition window');
  probe.frame();
  game.handleExpeditionEvent(key('return'));
  for (let t = 0; t < 60 && !game.town.realmActive(); t += 0.2) game.town.advance(0.2);
  probe.frames(0.3);
  // Someone stays home, so a party lost to the last is not the end of the saga.
  const keeper = town.makePerson(Role.Resident, Calling.Settler, town.map().camp());
  keeper.food = keeper.rest = keeper.hydration = 1;
  game.town.folk.push(keeper);
  // A little off the party, so the camera's ease onto the fallen shows.
  probe.look(5, 3);
  probe.frames(0.2);
}

try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'expedition-result-validation',
        configureServer(vite) {
          vite.middlewares.use('/expedition-result-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Expedition result</title></head><body style="margin:0;background:#11191c"></body></html>',
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
  deadline = setTimeout(() => void browser.close().catch(() => {}), 290000);
  const url = `http://127.0.0.1:${server.httpServer.address().port}/expedition-result-probe`;
  async function scenario(options) {
    const width = options.width ?? 1280,
      height = options.height ?? 800,
      context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }),
      page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(url);
    await page.evaluate(setup, { width, height, korean: !!options.korean, touch: !!options.touch });
    const run = (fn, arg) => page.evaluate(fn, arg),
      state = () => run(() => probe.state()),
      shot = async (name, caption) => {
        await page.screenshot({ path: `${output}/${name}.png` });
        report.shots.push({ name, caption });
      };
    return { page, context, run, state, shot };
  }

  // A fall, a death, then a cleared floor taken home.
  {
    const { context, run, state, shot } = await scenario({});
    await shot('arrival', 'The party beyond the gate, the view a little off them');
    await run(() => probe.game.town.strikeDown(probe.party()[1], 'Killed by monsters'));
    await run(() => probe.frame());
    let s = await state();
    assert(s.paused, 'The fall pauses the world');
    assert.equal(s.moment?.beat, 0, 'A fall is a Down moment');
    for (let i = 0; i < 8; ++i) {
      await shot(`fall-strip-${i}`, `Fall emphasis at ${(i * 0.1).toFixed(1)} s`);
      await run(() => probe.frames(0.1));
    }
    await shot('fall-held', 'A fall: the camera on the fallen, the rest veiled, the banner');
    await run(() => probe.frames(0.6));
    s = await state();
    assert.equal(s.moment, null, 'The fall emphasis is short');
    await shot('fall-after', 'Control back: the auto-pause banner stays, the veil is gone');
    await run(() => {
      probe.resume();
      probe.frames(3.4);
      probe.look(-4, 4);
      probe.frames(0.1);
      probe.game.town.killResident(probe.party()[2], 'Killed by monsters');
    });
    await run(() => probe.frames(0.6));
    s = await state();
    assert.equal(s.moment?.beat, 1, 'A death is a Death moment');
    assert(s.moment.held, 'A death holds the world');
    assert(!s.controls.includes('memorial'), 'The memorial waits for the emphasis');
    await shot('death-held', 'A death: the world held, the name in the banner');
    await run(() => probe.frames(1.1));
    s = await state();
    assert.equal(s.moment, null);
    assert(s.controls.includes('memorial'), 'The memorial is the release');
    await shot('death-memorial', 'Then the memorial card');
    await run(() => {
      probe.game.combatHud.memorials = [];
      probe.resume();
      probe.clearFloor();
      probe.frames(0.3);
      probe.game.town.leaveRealm();
      probe.frames(0.4);
    });
    s = await state();
    assert(!s.active && s.result?.end === 0, 'A cleared floor ends in its result screen');
    assert(s.controls.includes('expedition-result-close'));
    await shot('clear-result', 'Result: a cleared floor');
    const before = s.camera;
    await run(() => {
      probe.game.handleResultEvent(probe.key('return'));
      probe.frames(0.45);
    });
    await shot('clear-home-glide', 'Closing: the view eases home');
    await run(() => probe.frames(0.8));
    s = await state();
    assert(!s.result && s.paused === false, 'Closing restores the pause');
    assert(s.camera.x !== before.x || s.camera.y !== before.y, 'The view moved home');
    await shot('clear-home', 'Home at the gate, the survivors selected');
    await context.close();
  }
  // A withdrawal.
  {
    const { context, run, state, shot } = await scenario({});
    await run(() => {
      const town = probe.game.town,
        foe = town.realmFoes().find((m) => m.rank === 4);
      foe.health = 0;
      town.realmKill(foe);
      probe.frames(2);
      town.leaveRealm();
      probe.frames(0.3);
    });
    assert.equal((await state()).result?.end, 2);
    await shot('withdraw-result', 'Result: the party withdrew');
    await context.close();
  }
  // The last fall in English, in Korean and at phone size; and a party lost to the last.
  for (const variant of [
    { name: '', options: {} },
    { name: '-ko', options: { korean: true } },
    { name: '-phone', options: { width: 390, height: 844, touch: true } },
  ]) {
    const { context, run, state, shot } = await scenario(variant.options);
    await run(() => {
      for (const p of probe.party()) probe.game.town.strikeDown(p, 'Killed by monsters');
      probe.frames(0.7);
    });
    let s = await state();
    assert.equal(s.moment?.beat, 2, 'The last fall is held longer');
    assert(s.moment.held);
    await shot(`last-held${variant.name}`, 'The last one down: a longer hold');
    await run(() => probe.frames(1.6));
    s = await state();
    assert.equal(s.moment?.beat, 3, 'Then the screen dims while the gate casts them out');
    await run(() => probe.frames(1.2));
    await shot(`last-dim${variant.name}`, 'The screen dims');
    await run(() => probe.frames(1.4));
    s = await state();
    assert(!s.active && s.result?.end === 3, 'The cast-out ends in its result screen, not straight home');
    await shot(`castout-result${variant.name}`, 'Result: thrown back through the gate');
    await context.close();
  }
  {
    const { context, run, state, shot } = await scenario({});
    await run(() => {
      // All down at the very end of their bleeding: they die while the gate waits.
      const town = probe.game.town;
      for (const p of probe.party()) {
        town.strikeDown(p, 'Killed by monsters');
        p.downedAt = town.clock() - 44.5;
      }
      probe.frames(0.6);
    });
    await shot('lost-held', 'All down and bleeding out: the hold on the last to fall');
    await run(() => probe.frames(2.2));
    await shot('lost-dim', 'They die while the gate waits: the banner says so');
    await run(() => probe.frames(2.5));
    const s = await state();
    assert(!s.active && s.result?.end === 4, 'A party lost to the last ends in its result screen');
    await shot('lost-result', 'Result: no one came back');
    await context.close();
  }
  const strip = report.shots.filter((s) => s.name.startsWith('fall-strip-'));
  const rest = report.shots.filter((s) => !s.name.startsWith('fall-strip-'));
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Expedition result</title>
<style>body{margin:16px;background:#14181a;color:#e6e1d6;font:14px sans-serif}figure{display:inline-block;margin:0 12px 18px 0;vertical-align:top}
img{max-width:640px;border:1px solid #333}.strip img{max-width:200px}figcaption{margin-top:4px;color:#b9b2a3}</style></head><body>
<h1>The end of an expedition</h1><h2>Fall emphasis, frame strip</h2><div class="strip">${strip
      .map((s) => `<figure><img src="${s.name}.png"><figcaption>${s.caption}</figcaption></figure>`)
      .join('')}</div><h2>Held moments and result screens</h2>${rest
      .map((s) => `<figure><img src="${s.name}.png"><figcaption>${s.name}: ${s.caption}</figcaption></figure>`)
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
  else console.log('expedition result browser validation passed');
}
