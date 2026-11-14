import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Frames are simulated, as in play: the guide hears the world only on frames that advance it.
// Plays a new game far enough to meet the guide: the opening, a gate, the first tree, the camp, the first
// crafted gear, a monster and the first kill (read in Korean), the log; then the card and log on a phone.
const output = 'artifacts/regression/guide';
const report = { errors: [], passed: false, shots: [], moments: [], phone: {} };
let server, browser, deadline;

/** Boots a new game on a hidden canvas and leaves `window.probe` to drive it. */
async function boot(page, { width, height, touch }) {
  await page.evaluate(
    async ({ width, height, touch }) => {
      const [
        { initializeWebCanvas },
        { loadNativeFonts, loadKoreanFont },
        { BrowserFiles },
        { createNativeServices },
        { Camera, project },
        { Structure, Product },
        { Activity, Monster },
        { heldAmount },
        { treePosition },
        { itemSpec },
        { emptyEvent },
        guide,
        localization,
      ] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'),
        import('/apps/web/src/native/bootstrap.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/person.ts'),
        import('/packages/engine/src/carried-resources.ts'),
        import('/packages/engine/src/world-map.ts'),
        import('/packages/engine/src/equipment.ts'),
        import('/apps/web/src/native/application-contracts.ts'),
        import('/apps/web/src/native/game-guide.ts'),
        import('/packages/localization/src/index.ts'),
      ]);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      document.body.append(element);
      const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
        fonts = await loadNativeFonts(tvg),
        files = await BrowserFiles.open(`guide-validation-${width}`),
        game = createNativeServices(tvg, fonts, files).createPreview(5),
        town = game.town;
      game.touchMode = touch;
      // Raids would arrive on their own schedule; this walk brings its own monster.
      town.summonRaid = () => {};
      town.releaseMonster = () => {};
      const nearestTree = (from) => {
        const w = town.map().width();
        let best = -1,
          gap = Infinity;
        for (let y = Math.floor(from.y) - 20; y < from.y + 20; ++y)
          for (let x = Math.floor(from.x) - 20; x < from.x + 20; ++x) {
            if (!town.map().inside(x, y) || !town.map().at(x, y).trees) continue;
            const foot = treePosition(town.map(), x, y, town.map().at(x, y).trees - 1);
            if (!town.map().revealed(foot) || town.people().some((p) => p.tree === y * w + x)) continue;
            const d = Math.hypot(foot.x - from.x, foot.y - from.y);
            if (d < gap) [gap, best] = [d, y * w + x];
          }
        return best;
      };
      canvas.add(game.worldScene()).add(game.hudScene());
      window.probe = {
        game,
        town,
        guide,
        now: 0,
        frame(dt = 0.05, simulate = true) {
          this.now += dt;
          game.render(width, height, this.now, simulate, dt, this.now);
          canvas.update().render();
          game.worldPresented(1);
          game.takeCues();
        },
        frames(count, dt = 0.05, simulate = true) {
          for (let i = 0; i < count; ++i) this.frame(dt, simulate);
        },
        /** Runs the world, drawing a frame every game second so the guide hears what happens. */
        advance(seconds, until = () => false) {
          for (let t = 0; t < seconds && !until(); t += 0.1) {
            town.advance(0.1);
            game.dispatchWork();
            if (Math.round(t * 10) % 10 === 9) this.frame(0.05);
          }
          this.frames(4);
        },
        state() {
          const s = game.guide;
          return {
            card: s.card?.entry.key ?? '',
            looked: s.card?.looked ?? false,
            at: s.card?.entry.at ?? null,
            queue: s.queue.map((e) => e.key),
            log: s.log.map((e) => e.key),
            told: [...town.told],
            open: s.logOpen,
            notices: [...town.notices],
            camera: { x: game.camera.x, y: game.camera.y },
          };
        },
        controls() {
          return game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled }));
        },
        project(at) {
          return project(at.x, at.y);
        },
        /** Lets cards go until `key` is on screen, or none is left. */
        until(key) {
          for (let i = 0; i < 12 && game.guide.card?.entry.key !== key; ++i) {
            if (!game.guide.card && !game.guide.queue.length) break;
            guide.dismissGuideCard(game);
            this.frames(2);
          }
          return game.guide.card?.entry.key === key;
        },
        foundCamp() {
          if (!town.place(Structure.Camp, town.map().camp(), 0)) return false;
          game.queueWork(Activity.Building, town.camp().id);
          this.advance(400, () => town.camp().built());
          return town.camp().built();
        },
        build(name) {
          const camp = town.camp(),
            kind = Structure[name];
          for (let r = 2.5; r < 9; r += 0.5)
            for (let a = 0; a < 24; ++a) {
              const at = { x: camp.center.x + r * Math.cos((a * Math.PI) / 12), y: camp.center.y + r * Math.sin((a * Math.PI) / 12) };
              if (!town.canPlace(kind, at, 0).ok || !town.place(kind, at, 0)) continue;
              const site = town.buildings().at(-1);
              game.queueWork(Activity.Building, site.id);
              this.advance(300, () => site.built());
              return site.built() ? site.id : -1;
            }
          return -1;
        },
        fell() {
          const p = town.people()[0],
            before = heldAmount(p, Product.Wood);
          if (!town.orderChop([p.id], nearestTree(p.position))) return false;
          this.advance(150, () => heldAmount(p, Product.Wood) > before);
          return heldAmount(p, Product.Wood) > before;
        },
        /** Crafts a wooden axe wherever wooden gear is made now: the camp, or a workbench built for it. */
        craft() {
          const shop = itemSpec('wooden-axe').workshop,
            place = shop === Structure.Camp ? town.camp().id : this.build(Structure[shop]),
            p = town.people()[1];
          town.stock().wood += 12;
          if (place < 0 || !town.orderCraft(p.id, place, 'wooden-axe')) return '';
          this.advance(200, () => town.told.includes('craft'));
          return Structure[shop];
        },
        /** A lone monster climbs up beside the founders, who fight it off. */
        monster() {
          const p = town.people()[0],
            foe = new Monster(town.nextMonster++, 0, { x: p.position.x + 2.2, y: p.position.y });
          foe.home = { ...foe.position };
          foe.health = foe.vigor = 1.5;
          foe.raider = true;
          town.beasts.push(foe);
          const at = project(p.position.x, p.position.y);
          game.camera.x = at.x;
          game.camera.y = at.y;
          this.frames(4);
          this.advance(60, () => town.told.includes('kill'));
          return town.told.includes('kill');
        },
        async korean(on) {
          if (on) await loadKoreanFont(tvg, fonts);
          localization.setLocale(on ? 'KR' : 'ENG');
        },
        key(text) {
          return guide.guideHotkey(game, text);
        },
      };
      const event = (type, e) => ({ ...emptyEvent(type), x: e.clientX, y: e.clientY, button: 1, pointerType: e.pointerType });
      element.addEventListener('pointermove', (e) => (e.pointerType === 'touch' ? game.handleTouchEvent(event('PointerMove', e)) : game.pointerMove(e.clientX, e.clientY)));
      element.addEventListener('pointerdown', (e) => (e.pointerType === 'touch' ? game.handleTouchEvent(event('PointerDown', e)) : game.pointerDown(e.clientX, e.clientY, 0)));
      element.addEventListener('pointerup', (e) => (e.pointerType === 'touch' ? game.handleTouchEvent(event('PointerUp', e)) : game.pointerUp(e.clientX, e.clientY, 0)));
      probe.frames(20);
    },
    { width, height, touch },
  );
  const frames = (count, dt = 0.05) => page.evaluate(([count, dt]) => probe.frames(count, dt), [count, dt]);
  const controls = () => page.evaluate(() => probe.controls());
  const bounds = async (id) => {
    const control = (await controls()).find((c) => c.id === id);
    assert(control, `Missing ${id}: ${(await controls()).map((c) => c.id).join(', ')}`);
    return control.bounds;
  };
  const state = () => page.evaluate(() => probe.state());
  const shot = async (name) => {
    await page.screenshot({ path: `${output}/${name}.png` });
    report.shots.push(`${output}/${name}.png`);
  };
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  /** The card keeps clear of the quest panel, the unit dock and the notice above it. */
  const clear = async () => {
    const all = await controls(),
      card = all.find((c) => c.id === 'guide-card');
    assert(card, 'a card is drawn');
    for (const id of ['objectives-panel', 'context-dock', 'notice']) {
      const other = all.find((c) => c.id === id);
      if (other) assert(!overlaps(card.bounds, other.bounds), `the card covers ${id}`);
    }
    return card.bounds;
  };
  return { frames, controls, bounds, state, shot, clear };
}

try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'guide-validation',
        configureServer(vite) {
          vite.middlewares.use('/guide-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Guide validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  // The real GPU through ANGLE; SwiftShader would take most of a second a frame.
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 500000);
  const url = `http://127.0.0.1:${server.httpServer.address().port}/guide-probe`;

  // Desktop.
  {
    const width = 1280,
      height = 800,
      context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }),
      page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(url);
    const ui = await boot(page, { width, height, touch: false });
    const click = async (id) => {
      const b = await ui.bounds(id);
      await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
      await ui.frames(4);
    };

    // 1. The opening: the founders wait, the camera stays where it woke.
    let s = await ui.state();
    assert.equal(s.card, 'opening', JSON.stringify(s));
    assert.ok(s.log.includes('gate'), 'the gate in sight at the start is told');
    const woke = s.camera;
    await ui.clear();
    await ui.shot('01-opening-card');

    // 2. "Got it" brings the gate's card, and the camera eases to the gate (nobody has given an order yet).
    await click('guide-card/ok');
    s = await ui.state();
    assert.equal(s.card, 'gate', JSON.stringify(s));
    assert.equal(s.looked, true);
    await ui.frames(16);
    s = await ui.state();
    const gate = await page.evaluate((at) => probe.project(at), s.at);
    assert.notDeepEqual(s.camera, woke, 'the camera moved');
    assert.ok(Math.hypot(s.camera.x - gate.x, s.camera.y - gate.y) < 1, `the camera rests on the gate: ${JSON.stringify([s.camera, gate])}`);
    await ui.clear();
    await page.mouse.move(5, 400);
    await ui.shot('02-gate-camera-moved');

    // 3. The first tree: the wait ends with the order, the card says where the wood goes.
    assert.ok(await page.evaluate(() => probe.fell()), 'a founder fells a tree');
    s = await ui.state();
    assert.ok(s.told.includes('wood'), JSON.stringify(s));
    assert.ok(!s.told.includes('opening') || s.card !== 'opening');
    assert.ok(await page.evaluate(() => probe.until('wood')), 'the tree card shows');
    await ui.clear();
    await ui.shot('03-first-tree');

    // 4. The first building: the camp.
    assert.ok(await page.evaluate(() => probe.foundCamp()), 'the camp is built');
    assert.ok(await page.evaluate(() => probe.until('built:Camp')), 'the camp card shows');
    await ui.clear();
    await ui.shot('04-first-building');

    // 5. The first crafted gear: the notice becomes the card's own line instead of a second toast.
    const shop = await page.evaluate(() => probe.craft());
    assert.ok(shop, 'a wooden axe is crafted');
    s = await ui.state();
    assert.ok(s.told.includes('craft'), JSON.stringify(s));
    assert.ok(!s.notices.some((n) => / crafted Wooden axe$/.test(n)), 'the crafting notice was folded');
    assert.ok(await page.evaluate(() => probe.until('craft')), 'the crafting card shows');
    await ui.clear();
    await ui.shot('05-first-craft');

    // 6. In Korean: a monster comes and falls.
    await page.evaluate(() => probe.korean(true));
    assert.ok(await page.evaluate(() => probe.monster()), 'the founders kill the monster');
    s = await ui.state();
    assert.ok(s.told.includes('monster') && s.told.includes('kill'), JSON.stringify(s));
    assert.ok(await page.evaluate(() => probe.until('kill')), 'the kill card shows');
    await ui.frames(4);
    await ui.clear();
    await ui.shot('06-korean-kill-card');
    await page.evaluate(() => probe.korean(false));

    // 7. The log: F1 opens it, newest first, with a Look per placed entry.
    assert.ok(await page.evaluate(() => probe.key('f1')));
    await ui.frames(4);
    const ids = (await ui.controls()).map((c) => c.id);
    assert.ok(ids.includes('guide-log') && ids.includes('guide-log/focus') && ids.includes('guide-log/cards'), ids.join(', '));
    assert.ok(ids.some((id) => id.startsWith('guide-log/look/')), 'entries with a place offer Look');
    await ui.shot('07-guide-log');
    const look = (await ui.controls()).find((c) => c.id.startsWith('guide-log/look/'));
    await page.mouse.click(look.bounds.x + look.bounds.w / 2, look.bounds.y + look.bounds.h / 2);
    await ui.frames(16);
    await click('guide-log/older');
    await ui.shot('08-guide-log-older');
    assert.ok(await page.evaluate(() => probe.key('escape')));
    s = await ui.state();
    assert.equal(s.open, false);
    report.moments = s.log;
    await context.close();
  }

  // Phone: tapping the card and the log with a finger.
  {
    const width = 390,
      height = 844,
      context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      }),
      page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(url);
    const ui = await boot(page, { width, height, touch: true });
    const tap = async (id) => {
      const b = await ui.bounds(id);
      assert.ok(b.w >= 44 && b.h >= 44, `${id} is ${b.w}x${b.h}, too small for a finger`);
      await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
      await ui.frames(4);
    };
    let s = await ui.state();
    assert.equal(s.card, 'opening');
    const card = await ui.clear();
    assert.ok(card.x >= 12 && card.x + card.w <= width - 12, 'the card fits the phone');
    await ui.shot('09-phone-card');
    await tap('guide-card/ok');
    s = await ui.state();
    assert.equal(s.card, 'gate', JSON.stringify(s));
    await tap('guide-log-button');
    s = await ui.state();
    assert.equal(s.open, true, 'a tap opens the log');
    await ui.shot('10-phone-log');
    for (const id of ['guide-log/close', 'guide-log/focus', 'guide-log/cards', 'guide-log/older']) {
      const b = await ui.bounds(id);
      assert.ok(b.h >= 44, `${id} is ${b.h} tall`);
    }
    await tap('guide-log/cards');
    s = await page.evaluate(() => JSON.parse(localStorage.getItem('midgard.guide')));
    assert.deepEqual(s, { focus: true, cards: false }, 'the setting is kept');
    await tap('guide-log/cards');
    await tap('guide-log/close');
    s = await ui.state();
    assert.equal(s.open, false, 'a tap closes the log');
    report.phone = { card };
    await context.close();
  }
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
  else console.log('guide browser validation passed', report.moments.join(', '));
}
