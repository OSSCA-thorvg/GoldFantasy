import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Pictures of the quest panel, build-menu unlocks, the new inspectors and the winter outlook at 1024x768.
const output = 'artifacts/regression/progress-hud';
const width = 1024,
  height = 768;
const report = { errors: [], passed: false, shots: [] };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'progress-hud-validation',
        configureServer(vite) {
          vite.middlewares.use('/progress-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Progress HUD validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 280000);
  const open = async (width, height, touch) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/progress-probe`);
    await page.evaluate(
      async ({ width, height, touch }) => {
        const [
          { initializeWebCanvas },
          { loadNativeFonts },
          { BrowserFiles },
          { createNativeServices },
          { Camera, project },
          { Building },
          { Structure, Resources },
          { Calling, Role },
          { freehandRoad },
          { sealable },
          { GoalBranch },
        ] = await Promise.all([
          import('/apps/web/src/native/startup-canvas.ts'),
          import('/packages/native-ui/src/index.ts'),
          import('/apps/web/src/native/browser-files.ts'),
          import('/apps/web/src/native/bootstrap.ts'),
          import('/packages/engine/src/geometry.ts'),
          import('/packages/engine/src/town-models.ts'),
          import('/packages/engine/src/building-catalog.ts'),
          import('/packages/engine/src/person.ts'),
          import('/packages/engine/src/road-network.ts'),
          import('/packages/engine/src/gate-seals.ts'),
          import('/packages/engine/src/settlement-progression.ts'),
        ]);
        const tvg = await initializeWebCanvas('gl'),
          element = document.createElement('canvas');
        document.body.append(element);
        const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
          fonts = await loadNativeFonts(tvg),
          files = await BrowserFiles.open('progress-hud-validation'),
          game = createNativeServices(tvg, fonts, files).createPreview(5),
          town = game.town,
          origin = town.map().camp();
        game.touchMode = touch;
        const camp = new Building(0, Structure.Camp, origin, 0, 0);
        camp.village = 0;
        town.placed.push(camp);
        town.nextId = 1;
        town.foundSettlement(0);
        town.editHour(10);
        town.scout(origin.x, origin.y, 18);
        while (town.population() < 20) {
          const p = town.makePerson(Role.Resident, Calling.Settler, { x: origin.x + 0.5, y: origin.y + 0.5 });
          p.home = p.village = 0;
          town.folk.push(p);
        }
        const spiral = (kind) => {
          for (let r = 2.5; r < 16; r += 0.5)
            for (let a = 0; a < 32; ++a) {
              const p = {
                x: origin.x + r * Math.cos((a * Math.PI) / 16),
                y: origin.y + r * Math.sin((a * Math.PI) / 16),
              };
              if (town.canPlace(kind, p, 0).ok && town.place(kind, p, 0)) return town.placed.at(-1);
            }
          return null;
        };
        let road = false;
        for (let a = 0; a < 16 && !road; ++a) {
          const dx = Math.cos((a * Math.PI) / 8),
            dy = Math.sin((a * Math.PI) / 8),
            points = [0.8, 2, 3.5, 5, 6.5].map((r) => ({ x: origin.x + dx * r, y: origin.y + dy * r }));
          road = town.buildRoad(freehandRoad(points, 0.2));
        }
        const placed = {};
        for (const kind of [
          Structure.Shrine,
          Structure.Lumberyard,
          Structure.Farm,
          Structure.Well,
          Structure.Tent,
          Structure.Quarry,
          Structure.Storehouse,
          Structure.Sawmill,
          Structure.Stoneworks,
          Structure.MarketStalls,
          Structure.MageTower,
          Structure.Runestone,
          Structure.Guild,
        ])
          placed[kind] = spiral(kind);
        town.completeConstruction();
        // The guild stays a site until the unlock moment below.
        const guild = placed[Structure.Guild];
        guild.progress = 0.6;
        if (!(town.fieldAcres() > 0)) town.fieldAcres = () => 6;
        town.stock(0).add(new Resources(240, 60, 40, 30, 60));
        for (const kind of [Structure.MarketStalls, Structure.MageTower])
          if (placed[kind]) town.setWorkers(placed[kind].id, 1);
        for (const [name, calling, level, cause, place, day] of [
          ['Sigrun Ashfall', Calling.Ranger, 6, 'Killed by the guardian', 'Muspelheim', 9],
          ['Ulf Stonehand', Calling.Warrior, 4, 'Killed by monsters', 'Midgard', 14],
        ])
          town.fallen.push({
            id: 900 + day,
            name,
            past: '',
            look: 0,
            calling,
            race: 0,
            level,
            days: day,
            kills: 3,
            cause,
            place,
            day,
            at: day * 600,
            position: { ...origin },
          });
        const gates = town.map().dungeons();
        let gate = gates.findIndex((site, i) => sealable(site) && i > 0);
        if (gate < 0) gate = gates.findIndex(sealable);
        gates[gate].discovered = true;
        const focus = project(origin.x, origin.y);
        game.camera = new Camera(focus.x, focus.y, 2.2);
        game.chosen = [];
        canvas.add(game.worldScene()).add(game.hudScene());
        window.probe = {
          game,
          town,
          placed,
          gate,
          road,
          now: 0,
          frame(dt = 0.05) {
            this.now += dt;
            game.render(width, height, this.now, true, dt, this.now);
            canvas.update().render();
            game.worldPresented(1);
            game.takeCues();
          },
          frames(count, dt = 0.05) {
            for (let i = 0; i < count; ++i) this.frame(dt);
          },
          clear() {
            game.selectTool(0);
            game.chosen = [];
            game.selected = game.selectedDungeon = -1;
            game.globalCard = game.card = -1;
            game.drawerPinned = false;
          },
          controls() {
            return game.context.controls.map((c) => ({
              id: c.id,
              bounds: { ...c.bounds },
              enabled: c.enabled,
            }));
          },
          finishGuild() {
            town.notices = [];
            game.noticeUntil = 0;
            guild.progress = 1;
            town.completeConstruction();
          },
          quests(branch) {
            game.questBranch = GoalBranch[branch];
          },
        };
        element.addEventListener('pointermove', (e) => game.pointerMove(e.clientX, e.clientY));
        element.addEventListener('pointerdown', (e) => game.pointerDown(e.clientX, e.clientY, 0));
        element.addEventListener('pointerup', (e) => game.pointerUp(e.clientX, e.clientY, 0));
        probe.frames(30);
      },
      { width, height, touch },
    );
    return page;
  };
  let page = await open(width, height, false);
  const frames = (count) => page.evaluate((count) => probe.frames(count), count);
  const controls = () => page.evaluate(() => probe.controls());
  const center = async (id) => {
    const control = (await controls()).find((c) => c.id === id);
    assert(control, `Missing ${id}`);
    return { x: control.bounds.x + control.bounds.w / 2, y: control.bounds.y + control.bounds.h / 2 };
  };
  const click = async (id) => {
    const at = await center(id);
    await page.mouse.click(at.x, at.y);
    await frames(8);
  };
  const shot = async (name) => {
    await page.screenshot({ path: `${output}/${name}.png` });
    report.shots.push(`${output}/${name}.png`);
  };
  const setup = await page.evaluate(() => ({
    road: probe.road,
    gate: probe.gate,
    missing: Object.entries(probe.placed)
      .filter(([, b]) => !b)
      .map(([k]) => k),
  }));
  assert.deepEqual(setup.missing, [], 'every building found a spot');

  // Locked buildings stay in the menu with their requirements.
  await page.mouse.move(5, 300);
  await page.evaluate(() => {
    probe.clear();
    probe.game.globalCard = 7;
    probe.game.drawerPinned = true;
  });
  await frames(10);
  const tower = await center('global/card-pick-Tower');
  await page.mouse.move(tower.x, tower.y);
  await frames(4);
  await shot('build-menu-locked');

  // Completing the guild unlocks the training yard: a toast and a "new" mark.
  await page.mouse.move(5, 300);
  await page.evaluate(() => {
    probe.game.globalCard = 0;
    probe.finishGuild();
  });
  await frames(6);
  const notice = await page.evaluate(() => probe.game.notice);
  assert.match(notice, /^Unlocked: .*Training yard/);
  await shot('build-menu-new');
  await click('global/card-group-Arms & defence');
  await page.mouse.move(5, 300);
  await frames(4);
  await shot('build-menu-new-page');

  // The quest panel on a deed goal.
  await page.evaluate(() => {
    probe.clear();
    probe.quests('Arms');
  });
  await frames(80);
  await shot('quest-deed');

  // Inspectors.
  for (const [name, kind] of [
    ['market', 5],
    ['mage-tower', 14],
    ['runestone', 37],
  ]) {
    await page.evaluate((kind) => {
      probe.clear();
      probe.game.selectBuilding(probe.placed[kind].id);
    }, kind);
    await frames(10);
    if (name === 'market') {
      const buy = (await controls()).find((c) => c.id.startsWith('market-buy-'));
      assert(buy, 'market offers are listed');
    }
    await shot(name);
  }
  await page.evaluate(() => {
    probe.clear();
    probe.game.selectedDungeon = probe.gate;
  });
  await frames(10);
  await shot('gate');

  // Winter outlook in autumn, short of food: on the calendar and on the camp's stores.
  await page.evaluate(() => {
    probe.clear();
    probe.town.days = 35;
    probe.town.editHour(10);
    probe.town.stock(0).food = 4;
  });
  await frames(4);
  const sky = await center('sky-calendar');
  await page.mouse.move(sky.x, sky.y);
  await frames(4);
  await shot('winter-calendar');
  // Find a pixel of the camp itself, clear of residents, to hover for its stores.
  const roof = await page.evaluate(() => {
    const game = probe.game,
      camp = probe.town.placed[0];
    const seen = new Set();
    for (let y = 60; y < 700; y += 8)
      for (let x = 20; x < 1000; x += 8) {
        const at = { x, y },
          hit = game.renderer.pick(at),
          id = hit?.kind === 'building' ? hit.id : -1;
        seen.add(id);
        if (id === camp.id) return at;
      }
    return { miss: [...seen], camp: camp.id, kinds: probe.town.placed.map((b) => b.id + ':' + b.kind) };
  });
  assert(roof && !roof.miss, 'the camp is on screen ' + JSON.stringify(roof));
  await page.mouse.move(roof.x, roof.y);
  await frames(4);
  await shot('winter-stores');

  // A phone in touch mode: the market's narrow layout, and a tapped locked card listing its needs.
  await page.context().close();
  page = await open(390, 844, true);
  await page.evaluate(() => {
    probe.clear();
    probe.game.selectBuilding(probe.placed[5].id);
  });
  await frames(10);
  await shot('mobile-market');
  await page.evaluate(() => {
    probe.clear();
    probe.game.globalCard = 7;
    probe.game.drawerPinned = true;
  });
  await frames(10);
  await click('global/card-pick-Tower');
  assert.equal(
    await page.evaluate(() => probe.game.buildHint),
    29,
    'a tapped locked card keeps its requirements open',
  );
  await shot('mobile-build-locked');
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
  else console.log('progress HUD browser validation passed');
}
