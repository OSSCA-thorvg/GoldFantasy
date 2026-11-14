import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Pictures of the camp and tent inspectors listing who lives there, on a desktop and a phone.
const output = 'artifacts/regression/home-profiles';
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
        name: 'home-profiles-validation',
        configureServer(vite) {
          vite.middlewares.use('/home-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home profiles validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 280000);
  const open = async (width, height, touch) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/home-probe`);
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
          files = await BrowserFiles.open('home-profiles-validation'),
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
        while (town.population() < 6) {
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
          tent: placed[Structure.Tent],
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
  const states = () =>
    page.evaluate(() => {
      const { town, game } = probe,
        [a, b, c, d, e, f] = town.folk;
      b.calling = 2;
      b.level = 4;
      c.calling = 3;
      c.level = 3;
      c.woundDays = 2;
      d.calling = 4;
      d.level = 5;
      d.activity = 15;
      e.calling = 5;
      e.level = 2;
      f.home = probe.tent.id;
      f.calling = 6;
      f.level = 2;
      a.downedAt = town.time;
      a.activity = 29;
      town.fallen = [];
      void game;
    });
  const shot = async (name) => {
    await page.screenshot({ path: `${output}/${name}.png` });
    report.shots.push(`${output}/${name}.png`);
  };
  const center = async (id) => {
    const control = (await page.evaluate(() => probe.controls())).find((c) => c.id.startsWith(id));
    assert(control, `Missing ${id}`);
    return { x: control.bounds.x + control.bounds.w / 2, y: control.bounds.y + control.bounds.h / 2 };
  };
  const show = async (which, name, hover) => {
    await page.mouse.move(5, 300);
    await page.evaluate((which) => {
      probe.clear();
      probe.game.selectBuilding(which === 'camp' ? 0 : probe.tent.id);
    }, which);
    await page.evaluate(() => probe.frames(10));
    await states();
    await page.evaluate(() => probe.frames(1, 0.001));
    if (hover) {
      const at = await center(hover);
      await page.mouse.move(at.x, at.y);
      await page.evaluate(() => probe.frames(2, 0.001));
    }
    await shot(name);
  };
  let page = await open(width, height, false);
  await show('camp', 'camp', 'home-profile-');
  await show('tent', 'tent');
  await page.context().close();
  page = await open(390, 844, true);
  await show('camp', 'mobile-camp');
  await show('tent', 'mobile-tent');
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
  else console.log('home profiles browser validation passed');
}
