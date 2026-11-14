import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// The wider tool set in the real app: the bench's grouped recipe list, a stone axe, a shovel and a spear crafted
// there and used, a craft called off at the bench, each new item in a resident's hand, the unit window with a pack
// basket, and the bench list at phone width.
const output = 'artifacts/regression/tool-variety';
const report = { errors: [], passed: false, shots: [], timings: {}, notes: [] };
const gpu = ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'];
let server, browser, deadline;

async function open(width, height, mobile) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(mobile ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tool-variety-probe`);
  await page.evaluate(
    async ({ width, height }) => {
      const [
        { initializeWebCanvas },
        { loadNativeFonts },
        { BrowserFiles },
        { createNativeServices },
        { Camera, project },
        { Structure, Resources },
        { Activity },
        { addInventory, equipmentSlots },
        { sharpAnchor },
        { treePosition },
      ] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'),
        import('/apps/web/src/native/bootstrap.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/person.ts'),
        import('/packages/engine/src/equipment.ts'),
        import('/packages/engine/src/road-network.ts'),
        import('/packages/engine/src/world-map.ts'),
      ]);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      document.body.append(element);
      const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
        fonts = await loadNativeFonts(tvg),
        files = await BrowserFiles.open('tool-variety-validation'),
        game = createNativeServices(tvg, fonts, files).createPreview(5),
        town = game.town,
        origin = town.map().camp(),
        focus = project(origin.x, origin.y);
      town.summonRaid = () => {};
      town.releaseMonster = () => {};
      game.camera = new Camera(focus.x, focus.y, 2.4);
      canvas.add(game.worldScene()).add(game.hudScene());
      const history = [],
        notify = town.notify.bind(town);
      town.notify = (text) => {
        history.push(text);
        notify(text);
      };
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
        /** A camp and a workbench stand finished beside the clearing, with plenty in store. */
        settle() {
          if (!town.place(Structure.Camp, origin, 0)) return -1;
          const camp = town.camp();
          camp.progress = 1;
          camp.materials.delivered = camp.materials.required.clone();
          town.foundSettlement?.(camp.id);
          for (let r = 2.5; r < 9; r += 0.5)
            for (let a = 0; a < 24; ++a) {
              const at = {
                x: camp.center.x + r * Math.cos((a * Math.PI) / 12),
                y: camp.center.y + r * Math.sin((a * Math.PI) / 12),
              };
              if (!town.canPlace(Structure.Workbench, at, 0).ok || !town.place(Structure.Workbench, at, 0))
                continue;
              const bench = town.buildings().at(-1);
              bench.progress = 1;
              bench.materials.delivered = bench.materials.required.clone();
              // Upgraded once: stone tools are on the list.
              bench.variant = 1;
              town.stock().add(new Resources(20, 120, 120));
              town.changes++;
              this.advance(1);
              return bench.id;
            }
          return -1;
        },
        /** A finished level-1 smithy beside the camp, for the weapons that left the bench. */
        smithy() {
          const camp = town.camp();
          for (let r = 3; r < 10; r += 0.5)
            for (let a = 0; a < 24; ++a) {
              const at = {
                x: camp.center.x + r * Math.cos((a * Math.PI) / 12),
                y: camp.center.y + r * Math.sin((a * Math.PI) / 12),
              };
              if (!town.canPlace(Structure.Weaponsmith, at, 0).ok || !town.place(Structure.Weaponsmith, at, 0)) continue;
              const smith = town.buildings().at(-1);
              smith.progress = 1;
              smith.materials.delivered = smith.materials.required.clone();
              town.changes++;
              this.advance(1);
              return smith.id;
            }
          return -1;
        },
        look(at, scale = 2.4) {
          const p = project(at.x, at.y);
          game.camera = new Camera(p.x, p.y, scale);
        },
        lookBuilding(id) {
          this.look(town.building(id).center);
        },
        founders() {
          return town
            .people()
            .filter((p) => p.health > 0)
            .map((p) => p.id);
        },
        held(id) {
          return town
            .person(id)
            .inventory.filter(Boolean)
            .map((s) => s.item);
        },
        /** Puts exactly `items` in a resident's hands, in a free slot each. */
        equip(id, items) {
          const p = town.person(id);
          for (const slot of equipmentSlots) p.equipment[slot] = -1;
          for (const item of items) {
            let index = p.inventory.findIndex((s) => s?.item === item);
            if (index < 0) {
              addInventory(p, item);
              index = p.inventory.findIndex((s) => s?.item === item);
            }
            if (!town.equipItem(id, index + 1)) return false;
          }
          return true;
        },
        fell(id) {
          const p = town.person(id);
          if (!town.orderChop([p.id], nearestTree(p.position))) return -1;
          for (let t = 0; t < 120 && (p.activity !== Activity.Felling || p.moving()); t += 0.1) {
            town.advance(0.1);
            game.dispatchWork();
          }
          return p.activity === Activity.Felling ? 1 : -1;
        },
        road(id) {
          const p = town.person(id),
            camp = town.camp().center,
            tries = [];
          let path = null;
          // Any free 6-tile stretch near the camp.
          const door = town.camp().door();
          for (let r = 5; r < 9 && !path; r += 1)
            for (let a = 0; a < 16 && !path; ++a) {
              const at = [
                  sharpAnchor(door),
                  sharpAnchor({
                    x: door.x + r * Math.cos((a * Math.PI) / 8),
                    y: door.y + r * Math.sin((a * Math.PI) / 8),
                  }),
                ],
                check = town.canBuildRoad(at);
              if (check.ok) path = at;
              else tries.push(check.reason);
            }
          if (!path || !town.buildRoad(path)) return 'no road: ' + tries.slice(0, 4).join('; ');
          const road = town.roads().roads().at(-1);
          road.materials.delivered = road.materials.required.clone();
          if (!town.orderRoadwork([p.id], road.id)) return -1;
          for (
            let t = 0;
            t < 120 && !(p.activity === Activity.Roadwork && !p.moving() && road.built > 0.05);
            t += 0.1
          ) {
            town.advance(0.1);
            game.dispatchWork();
          }
          return p.activity === Activity.Roadwork
            ? road.id
            : `not at work: ${Activity[p.activity]} built ${road.built}`;
        },
        /** Stands a resident in a fighting pose where it is, for a look at what the fight puts in hand. */
        pose(id) {
          const p = town.person(id),
            camp = town.camp().center;
          p.position = town.grid.nearestWalkable({ x: camp.x + 2.5, y: camp.y + 2.5 });
          p.inside = false;
          p.path = [];
          p.activity = Activity.Fighting;
          p.ready = town.clock() + 0.6;
          this.look(p.position, 6);
          game.selectPeople([]);
          this.frames(12, 0.05, false);
        },
        Activity,
      };
      element.addEventListener('pointermove', (e) => game.pointerMove(e.clientX, e.clientY));
      element.addEventListener('pointerdown', (e) => game.pointerDown(e.clientX, e.clientY, 0));
      element.addEventListener('pointerup', (e) => game.pointerUp(e.clientX, e.clientY, 0));
      probe.frames(20);
    },
    { width, height },
  );
  return page;
}

try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'tool-variety-validation',
        configureServer(vite) {
          vite.middlewares.use('/tool-variety-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tool variety validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: gpu });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 500000);

  const page = await open(1280, 800, false);
  const frames = (count, dt = 0.05, simulate = false) =>
    page.evaluate(([count, dt, simulate]) => probe.frames(count, dt, simulate), [count, dt, simulate]);
  const controls = () => page.evaluate(() => probe.controls());
  const click = async (id) => {
    const control = (await controls()).find((c) => c.id === id);
    assert(control, `Missing ${id}: ${(await controls()).map((c) => c.id).join(', ')}`);
    assert(control.enabled, `${id} is disabled`);
    await page.mouse.click(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2);
    await frames(6);
  };
  const shot = async (name, target = page) => {
    await target.screenshot({ path: `${output}/${name}.png` });
    report.shots.push(`${output}/${name}.png`);
  };
  const away = () => page.mouse.move(5, 400);

  // 1. A bench with plenty in store; its list opens on the group the quest wants.
  const bench = await page.evaluate(() => probe.settle());
  assert(bench >= 0, 'a workbench stands');
  const [a, b] = await page.evaluate(() => probe.founders());
  await page.evaluate(
    ([bench, a]) => {
      probe.game.selectPeople([a]);
      probe.game.selectBuilding(bench);
      probe.lookBuilding(bench);
    },
    [bench, a],
  );
  await away();
  await frames(10);
  const ids = (await controls()).map((c) => c.id);
  for (const tab of ['tools', 'gear']) assert(ids.includes(`station-group-${tab}-${bench}`), tab);
  assert(!ids.includes(`station-group-weapons-${bench}`), 'weapons are made at the smithy now');
  assert(
    ids.includes('station-craft-stone-axe') && ids.includes('station-craft-wooden-pick') && ids.includes(`station-page-next-${bench}`),
    ids.join(', '),
  );
  assert(!ids.includes('station-craft-wooden-spear'), 'weapons are not on the bench');
  await shot('01-bench-tools');

  // 2. A stone axe from the Tools tab, by the crafter the panel names.
  await click('station-craft-stone-axe');
  const axeMaker = await page.evaluate(
    (bench) => probe.town.people().find((p) => p.craftWorkshop === bench)?.id ?? -1,
    bench,
  );
  assert(
    axeMaker >= 0,
    'someone goes to make the stone axe: ' +
      (await page.evaluate(() => probe.game.status + ' | ' + probe.history.slice(-3).join(' | '))),
  );
  await page.evaluate((id) => probe.advance(200, () => !probe.town.person(id).craftItem), axeMaker);
  assert(
    (await page.evaluate((id) => probe.held(id), axeMaker)).includes('stone-axe'),
    'the stone axe is made',
  );

  // 3. A wooden spear from the smithy's Weapons tab.
  const smith = await page.evaluate(() => probe.smithy());
  assert(smith >= 0, 'a smithy stands');
  await page.evaluate(
    ([smith, b]) => {
      probe.game.selectPeople([b]);
      probe.game.selectBuilding(smith);
      probe.lookBuilding(smith);
    },
    [smith, b],
  );
  await away();
  await frames(6);
  await shot('02-smithy-weapons');
  await click(`station-page-next-${smith}`);
  await click('station-craft-wooden-spear');
  const spearMaker = await page.evaluate(
    (smith) => probe.town.people().find((p) => p.craftWorkshop === smith)?.id ?? -1,
    smith,
  );
  assert(spearMaker >= 0, 'someone goes to make the spear');
  await page.evaluate((id) => probe.advance(200, () => !probe.town.person(id).craftItem), spearMaker);
  assert(
    (await page.evaluate((id) => probe.held(id), spearMaker)).includes('wooden-spear'),
    'the spear is made',
  );

  // 4. The bench's Gear tab.
  await page.evaluate((bench) => {
    probe.game.selectBuilding(bench);
    probe.lookBuilding(bench);
  }, bench);
  await frames(4);
  await click(`station-group-gear-${bench}`);
  await away();
  await frames(6);
  await shot('03-bench-gear');

  // 5. A shovel, then a basket called off half made: the button at the bench, then the bench free and nothing spent.
  const shovelReason = await page.evaluate(
    ([bench, a]) => probe.town.craftReason(a, bench, 'wooden-shovel') || String(probe.town.orderCraft(a, bench, 'wooden-shovel')),
    [bench, axeMaker],
  );
  assert.equal(shovelReason, 'true', 'the shovel is ordered: ' + shovelReason);
  await page.evaluate((id) => probe.advance(200, () => !probe.town.person(id).craftItem), axeMaker);
  assert(
    (await page.evaluate((id) => probe.held(id), axeMaker)).includes('wooden-shovel'),
    'the shovel is made',
  );
  const before = await page.evaluate(
    ([bench, b]) => {
      const t = probe.town;
      probe.game.selectPeople([b]);
      t.orderCraft(b, bench, 'pack-basket');
      probe.advance(60, () => t.person(b).craftProgress > 3);
      return { wood: t.stock().wood, stone: t.stock().stone, held: probe.held(b) };
    },
    [bench, spearMaker],
  );
  await page.evaluate((bench) => {
    probe.game.selectBuilding(bench);
    probe.lookBuilding(bench);
  }, bench);
  await away();
  await frames(10, 0.1, true);
  await shot('04-cancel-at-bench');
  await click(`station-cancel-${bench}`);
  await frames(10, 0.1, true);
  await shot('05-bench-free');
  const after = await page.evaluate(
    ([bench, b]) => {
      const t = probe.town;
      return {
        wood: t.stock().wood,
        stone: t.stock().stone,
        held: probe.held(b),
        working: t.craftingAt(bench)?.id ?? -1,
        notice: probe.history.at(-1),
      };
    },
    [bench, spearMaker],
  );
  assert.equal(after.working, -1, 'the bench is free');
  assert.deepEqual(
    [after.wood, after.stone, after.held],
    [before.wood, before.stone, before.held],
    'nothing spent',
  );
  report.notes.push(`cancel notice: ${after.notice}`);

  // 6. Each new item in hand in the world.
  await page.evaluate((id) => probe.equip(id, ['stone-axe']), axeMaker);
  assert.equal(await page.evaluate((id) => probe.fell(id), axeMaker), 1, 'felling with the stone axe');
  await page.evaluate((id) => {
    const p = probe.town.person(id);
    probe.game.selectPeople([]);
    probe.look(p.position, 6);
    probe.frames(30, 0.05, true);
  }, axeMaker);
  await shot('06-stone-axe-felling');
  await page.evaluate((id) => {
    probe.town.orderStop([id]);
    probe.pose(id);
  }, axeMaker);
  await shot('06b-stone-axe');
  await page.evaluate(
    ([id, other]) => {
      probe.equip(id, ['wooden-shovel']);
      probe.town.person(other).position = probe.town.grid.nearestWalkable({
        x: probe.town.camp().center.x - 6,
        y: probe.town.camp().center.y - 6,
      });
    },
    [axeMaker, spearMaker],
  );
  const road = await page.evaluate((id) => probe.road(id), axeMaker);
  assert(typeof road === 'number', 'road work with the shovel: ' + road);
  const digging = await page.evaluate(
    async ([id, other]) => {
      const t = probe.town,
        p = t.person(id);
      t.orderMove([other], t.grid.nearestWalkable({ x: t.camp().center.x - 7, y: t.camp().center.y - 7 }));
      for (let i = 0; i < 400 && !(i > 20 && p.activity === probe.Activity.Roadwork && !p.moving()); ++i) {
        probe.look(p.position, 6);
        probe.frames(1, 0.05, true);
      }
      const { workItem } = await import('/packages/engine/src/equipment.ts');
      return {
        activity: probe.Activity[p.activity],
        moving: p.moving(),
        tool: workItem(p, 'construction')?.id,
      };
    },
    [axeMaker, spearMaker],
  );
  report.notes.push('at the road: ' + JSON.stringify(digging));
  assert.equal(digging.tool, 'wooden-shovel');
  await shot('07-shovel-road');
  await page.evaluate((id) => {
    probe.town.orderStop([id]);
    probe.equip(id, ['wooden-spear']);
    probe.pose(id);
  }, spearMaker);
  await shot('08-spear');
  for (const [item, name] of [
    ['flint-sickle', '09-sickle'],
    ['hunting-knife', '10-knife'],
    ['shovel', '11-iron-shovel'],
    ['sickle', '12-iron-sickle'],
    ['spear', '13-iron-spear'],
    ['stone-pick', '14-stone-pick'],
    ['stone-hammer', '15-stone-hammer'],
    ['stone-hoe', '16-stone-hoe'],
  ]) {
    await page.evaluate(
      ([id, item]) => {
        probe.town.person(id).level = 5;
        probe.equip(id, [item]);
        probe.pose(id);
      },
      [spearMaker, item],
    );
    await shot(name);
  }

  // 7. The unit window with a pack basket: the carry limit it shows is the resident's own.
  const pack = await page.evaluate((id) => {
    const t = probe.town;
    probe.equip(id, ['pack-basket']);
    t.person(id).activity = probe.Activity.Idle;
    probe.game.selectPeople([id]);
    probe.game.rosterOpen = true;
    probe.game.rosterTab = 'units';
    probe.game.rosterSelected = 'units:' + id;
    probe.game.equipmentTab = 'equipment';
    probe.look(t.person(id).position, 6);
    probe.frames(10);
    return probe.game.context.controls.length;
  }, spearMaker);
  assert(pack > 0);
  await shot('17-unit-window-basket');
  await page.evaluate(() => {
    probe.game.rosterOpen = false;
    probe.frames(4);
  });
  report.notices = await page.evaluate(() => probe.history.slice(-12));
  await page.context().close();

  // 8. The bench list at phone width.
  const phone = await open(390, 844, true);
  const phoneBench = await phone.evaluate(() => probe.settle());
  await phone.evaluate((bench) => {
    probe.game.selectBuilding(bench);
    probe.lookBuilding(bench);
    probe.frames(10);
  }, phoneBench);
  await shot('18-phone-bench-tools', phone);
  const small = await phone.evaluate((bench) => {
    const tabs = probe.controls().filter((c) => c.id.startsWith('station-group-'));
    return { tabs, crafts: probe.controls().filter((c) => c.id.startsWith('station-craft-')).length, bench };
  }, phoneBench);
  assert.equal(small.tabs.length, 2, 'two tabs at phone width');
  for (const tab of small.tabs)
    assert(tab.bounds.x >= 0 && tab.bounds.x + tab.bounds.w <= 390, `${tab.id} fits`);
  report.timings.phone = small;
  await phone.evaluate((bench) => {
    const t = probe.town,
      [p] = probe.founders();
    t.orderCraft(p, bench, 'stone-pick');
    probe.advance(60, () => t.person(p).craftProgress > 2);
    probe.frames(6);
  }, phoneBench);
  await shot('19-phone-bench-working', phone);
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
  else console.log('tool variety browser validation passed', report.shots.length, 'shots');
}
