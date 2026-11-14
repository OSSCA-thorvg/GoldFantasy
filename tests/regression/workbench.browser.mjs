import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Walks crafting at a workbench in the real app: found the camp, build the bench, fell wood by hand,
// open the bench from the quest, craft a wooden axe there, see it go to the pack and work from there, queue a
// second crafter, open the smithy's list and the unit window's way to the bench; then fell again, faster.
const output = 'artifacts/regression/workbench';
const width = 1280,
  height = 800;
const report = { errors: [], passed: false, shots: [], timings: {} };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'workbench-validation',
        configureServer(vite) {
          vite.middlewares.use('/workbench-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Workbench validation</title></head><body style="margin:0;background:#11191c"></body></html>',
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
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/workbench-probe`);
  await page.evaluate(
    async ({ width, height }) => {
      const [
        { initializeWebCanvas },
        { loadNativeFonts },
        { BrowserFiles },
        { createNativeServices },
        { Camera, project },
        { Structure, Product },
        { Activity },
        { heldAmount },
        { currentGoal, GoalBranch, settlementGoals },
        mining,
        { treePosition },
      ] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'),
        import('/apps/web/src/native/bootstrap.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/person.ts'),
        import('/packages/engine/src/carried-resources.ts'),
        import('/packages/engine/src/settlement-progression.ts'),
        import('/packages/engine/src/mining.ts'),
        import('/packages/engine/src/world-map.ts'),
      ]);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      document.body.append(element);
      const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
        fonts = await loadNativeFonts(tvg),
        files = await BrowserFiles.open('workbench-validation'),
        game = createNativeServices(tvg, fonts, files).createPreview(5),
        town = game.town,
        origin = town.map().camp(),
        focus = project(origin.x, origin.y);
      // Raids are the combat pass's business; keep this walk about items.
      town.summonRaid = () => {};
      town.releaseMonster = () => {};
      game.camera = new Camera(focus.x, focus.y, 2.4);
      canvas.add(game.worldScene()).add(game.hudScene());
      const founders = () => town.people().filter((p) => p.health > 0);
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
      const history = [],
        notify = town.notify.bind(town);
      town.notify = (text) => {
        history.push(text);
        notify(text);
      };
      window.probe = {
        game,
        town,
        history,
        now: 0,
        frame(dt = 0.05, simulate = false) {
          this.now += dt;
          game.render(width, height, this.now, simulate, dt, this.now);
          canvas.update().render();
          game.worldPresented(1);
          game.takeCues();
        },
        frames(count, dt = 0.05, simulate = false) {
          for (let i = 0; i < count; ++i) this.frame(dt, simulate);
        },
        /** Fast-forward the world without drawing, then let the HUD catch up. */
        advance(seconds, until = () => false) {
          for (let t = 0; t < seconds && !until(); t += 0.1) {
            town.advance(0.1);
            game.dispatchWork();
          }
          this.frames(4);
        },
        controls() {
          return game.context.controls.map((c) => ({
            id: c.id,
            bounds: { ...c.bounds },
            enabled: c.enabled,
          }));
        },
        quest() {
          const index = currentGoal(town, GoalBranch.Core);
          return { index, title: settlementGoals()[index]?.title ?? '' };
        },
        /** Places a building of `kind` near the camp where its door can be reached, and has the founders build it. */
        build(name) {
          const camp = town.camp(),
            kind = Structure[name];
          for (let r = 2.5; r < 9; r += 0.5)
            for (let a = 0; a < 24; ++a) {
              const at = {
                x: camp.center.x + r * Math.cos((a * Math.PI) / 12),
                y: camp.center.y + r * Math.sin((a * Math.PI) / 12),
              };
              if (!town.canPlace(kind, at, 0).ok || !town.place(kind, at, 0)) continue;
              const site = town.buildings().at(-1);
              game.queueWork(Activity.Building, site.id);
              this.advance(300, () => site.built());
              return site.built() ? site.id : -1;
            }
          return -1;
        },
        crafting(id) {
          return town.person(id).activity === Activity.Crafting;
        },
        look(id) {
          const b = town.building(id),
            at = project(b.center.x, b.center.y);
          game.camera.x = at.x;
          game.camera.y = at.y;
        },
        foundCamp() {
          if (!town.place(Structure.Camp, origin, 0)) return false;
          game.queueWork(Activity.Building, town.camp().id);
          this.advance(400, () => town.camp().built());
          return town.camp().built();
        },
        /** Orders the founder `index` to fell the nearest tree and returns seconds of felling until the load is in hand. */
        fell(id, show = false) {
          const p = town.person(id);
          const before = heldAmount(p, Product.Wood);
          if (!town.orderChop([p.id], nearestTree(p.position))) return -1;
          for (let t = 0; t < 120 && (p.activity !== Activity.Felling || p.moving()); t += 0.1) {
            town.advance(0.1);
            game.dispatchWork();
          }
          const started = town.clock();
          if (show) {
            game.selectPeople([p.id]);
            const at = project(p.position.x, p.position.y);
            game.camera.x = at.x;
            game.camera.y = at.y;
            this.frames(40, 0.1, true);
          }
          for (let t = 0; t < 120 && heldAmount(p, Product.Wood) <= before; t += 0.1) {
            town.advance(0.1);
            game.dispatchWork();
          }
          return town.clock() - started;
        },
        wood(id) {
          return heldAmount(town.person(id), Product.Wood);
        },
        founder(id = founders()[0].id) {
          const p = town.person(id);
          return {
            id: p.id,
            name: p.name,
            craft: p.craftItem,
            held: p.inventory.filter(Boolean).map((s) => s.item),
          };
        },
      };
      element.addEventListener('pointermove', (e) => game.pointerMove(e.clientX, e.clientY));
      element.addEventListener('pointerdown', (e) => game.pointerDown(e.clientX, e.clientY, 0));
      element.addEventListener('pointerup', (e) => game.pointerUp(e.clientX, e.clientY, 0));
      probe.frames(30);
    },
    { width, height },
  );
  const frames = (count, dt = 0.05, simulate = false) =>
    page.evaluate(([count, dt, simulate]) => probe.frames(count, dt, simulate), [count, dt, simulate]);
  const controls = () => page.evaluate(() => probe.controls());
  const center = async (id) => {
    const control = (await controls()).find((c) => c.id === id);
    assert(control, `Missing ${id}: ${(await controls()).map((c) => c.id).join(', ')}`);
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
  const quest = () => page.evaluate(() => probe.quest());
  const away = () => page.mouse.move(5, 400);

  // 1. Found the camp; the next quest is the workbench.
  await away();
  assert.equal(await page.evaluate(() => probe.foundCamp()), true, 'the founders build the camp');
  await frames(10);
  assert.equal((await quest()).title, 'Build a workbench');
  await shot('01-quest-workbench');

  // 2. Build it: the founders carry its 4 wood by hand.
  const bench = await page.evaluate(() => probe.build('Workbench'));
  assert(bench >= 0, 'the workbench is built');
  await page.evaluate((id) => {
    probe.look(id);
    probe.town.notices.splice(0);
    probe.game.selectPeople([]);
  }, bench);
  await frames(30);
  assert.equal((await quest()).title, 'Craft a wooden axe');
  await shot('02-bench-built');

  // 3. Fell wood by hand.
  const felling = (await page.evaluate(() => probe.founder())).id;
  const bare = await page.evaluate((id) => probe.fell(id), felling);
  report.timings.bareHands = bare;
  for (let i = 0; i < 3 && (await page.evaluate((id) => probe.wood(id), felling)) < 3; ++i)
    await page.evaluate((id) => probe.fell(id), felling);
  await page.evaluate(() => {
    probe.game.selectPeople([]);
    probe.frames(6);
  });

  // 4. The quest button selects the bench with the founder who holds the wood as crafter.
  await click(`quest-action/${(await quest()).index}`);
  assert.equal(await page.evaluate(() => probe.game.selected), bench, 'the quest selects the workbench');
  await away();
  await frames(10);
  await shot('03-bench-recipes');

  // 5. Craft the axe from the bench's own list; the crafter walks there and works in the open.
  await click('station-craft-wooden-axe');
  const crafter = await page.evaluate(
    (bench) => probe.town.people().find((p) => p.craftWorkshop === bench)?.id ?? -1,
    bench,
  );
  assert(crafter >= 0, 'someone was sent to the bench');
  assert(
    (await page.evaluate((id) => probe.wood(id), crafter)) >= 3,
    'the crafter is the one holding the wood',
  );
  await page.evaluate((id) => probe.advance(60, () => probe.crafting(id)), crafter);
  // A second founder is sent to the same bench and waits.
  await click(`station-crafter-next-${bench}`);
  await frames(4);
  const second = await page.evaluate(
    ([bench, crafter]) => {
      const p = probe.town.people().find((q) => q.id !== crafter);
      probe.town.stock().wood += 6;
      return probe.town.orderCraft(p.id, bench, 'wooden-hoe') ? p.id : -1;
    },
    [bench, crafter],
  );
  assert(second >= 0, 'a second crafter was sent');
  await page.evaluate((id) => probe.advance(30, () => !probe.town.person(id).moving()), second);
  await page.evaluate((bench) => probe.look(bench), bench);
  await frames(30, 0.1, true);
  const busy = await page.evaluate(
    (bench) => ({
      working: probe.town.craftingAt(bench)?.id ?? -1,
      waiting: probe.town.craftQueue(bench).map((p) => p.id),
    }),
    bench,
  );
  assert.equal(busy.working, crafter, 'the first crafter works the bench');
  assert.deepEqual(busy.waiting, [second], 'the second waits their turn');
  await shot('04-working-and-waiting');
  await page.evaluate(() => probe.game.selectPeople([]));
  await frames(4);
  await shot('05-world-progress');

  // 6. The axe is made and works from the pack: two notices, in that order.
  await page.evaluate((id) => probe.advance(60, () => !probe.town.person(id).craftItem), crafter);
  for (let i = 0; i < 2; ++i) {
    await frames(4, 0.1, true);
    await shot(`06-notice-${i + 1}`);
    await frames(30, 0.1, true);
  }
  const name = (await page.evaluate((id) => probe.founder(id), crafter)).name;
  const said = await page.evaluate(() => probe.history.slice());
  const taken = said.indexOf(`${name} crafted Wooden axe`),
    inHand = said.indexOf('Wooden axe in the pack · Fells trees faster');
  assert(taken >= 0 && inHand > taken, JSON.stringify(said));
  assert.equal((await page.evaluate((id) => probe.founder(id), crafter)).held.includes('wooden-axe'), true);
  await page.evaluate((id) => probe.advance(120, () => !probe.town.person(id).craftItem), second);
  const later = await page.evaluate((id) => {
    const p = probe.town.person(id);
    return {
      ...probe.founder(id),
      activity: p.activity,
      task: p.task,
      progress: p.craftProgress,
      wood: probe.town.stock().wood,
    };
  }, second);
  assert.equal(later.held.includes('wooden-hoe'), true, JSON.stringify(later));

  // 7. The unit window leads to the bench instead of crafting itself.
  await page.evaluate((id) => {
    probe.game.selectPeople([id]);
    probe.frames(8);
  }, second);
  await shot('07-unit-window-button');
  await click('unit-workbench');
  assert.equal(
    await page.evaluate(() => probe.game.selected),
    bench,
    'the unit window button selects the bench',
  );

  // 8. The smithy works the same way: its own list of weapons, shields and armor.
  const smith = await page.evaluate(() => {
    probe.town
      .stock()
      .add({ gold: 99, wood: 99, stone: 99, food: 0, mana: 0, water: 0, planks: 20, cutStone: 20, bones: 0 });
    return probe.build('Weaponsmith');
  });
  assert(smith >= 0, 'a smithy stands');
  await page.evaluate((id) => {
    probe.game.selectPeople([]);
    probe.game.selectBuilding(id);
    probe.look(id);
  }, smith);
  await away();
  await frames(10);
  assert(
    (await controls()).some((c) => c.id === 'station-craft-wooden-sword'),
    'the smithy lists its own recipes',
  );
  await shot('08-smithy-recipes');

  // 9. Fell again with the axe: faster.
  const axe = await page.evaluate((id) => probe.fell(id), crafter);
  report.timings.woodenAxe = axe;
  report.notices = await page.evaluate(() => probe.history.slice());
  assert(
    axe > 0 && bare > 0 && axe < bare * 0.75,
    `felling ${bare.toFixed(1)} s by hand, ${axe.toFixed(1)} s with the axe`,
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
  else console.log('workbench browser validation passed', JSON.stringify(report.timings));
}
