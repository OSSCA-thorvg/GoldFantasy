/** Production BrowserHost + GameApp picking, using trusted pointer input and real WebCanvas surfaces. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { BrowserCaseLifetime } from './browser-case-lifetime.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = process.env.GOLDFANTASY_TEST_OUTPUT ?? resolve(root, 'artifacts/regression/picking');
const only = process.env.GOLDFANTASY_PICKING_CASE;
const combinations = [
  ['sw', 1],
  ['sw', 2],
  ['gl', 1],
  ['gl', 2],
].filter(([backend, dpr]) => !only || only === `${backend}-${dpr}`);
const report = { cases: [], errors: [], passed: false };
let browser, server, page;
const interrupt = () => {
  process.exitCode = 130;
  void browser?.close().catch(() => {});
  void server?.close().catch(() => {});
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
await mkdir(output, { recursive: true });
try {
  server = await createServer({
    root,
    base: '/',
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'picking-regression-host',
        configureServer(vite) {
          vite.middlewares.use('/picking-host', (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Picking validation</title><style>html,body{margin:0;overflow:hidden}#world{display:block;width:100vw!important;height:100dvh!important;touch-action:none}</style></head><body><canvas id="world" aria-label="Midgard"></canvas></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--autoplay-policy=user-gesture-required'],
  });
  for (const [backend, dpr] of combinations) {
    const name = `${backend}-${dpr}`;
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      deviceScaleFactor: dpr,
      reducedMotion: 'reduce',
    });
    page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push({ name, error: error.stack ?? String(error) }));
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.push({ name, error: message.text() });
    });
    const started = Date.now();
    const row = { name, checks: [], passed: false };
    report.cases.push(row);
    const lifetime = new BrowserCaseLifetime(name, context);
    let primaryError;
    try {
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/picking-host`);
      await page.evaluate(async (backend) => {
        const [
          bootstrap,
          people,
          geometry,
          { Town },
          { Traffic },
          { Building },
          { Structure },
          world,
          roads,
          trees,
        ] = await Promise.all([
          import('/apps/web/src/native/bootstrap.ts'),
          import('/packages/engine/src/person.ts'),
          import('/packages/engine/src/geometry.ts'),
          import('/packages/engine/src/town.ts'),
          import('/packages/engine/src/traffic.ts'),
          import('/packages/engine/src/town-models.ts'),
          import('/packages/engine/src/building-catalog.ts'),
          import('/packages/engine/src/world-types.ts'),
          import('/packages/engine/src/road-network.ts'),
          import('/packages/native-renderer/src/tree-painter.ts'),
        ]);
        const runtime = await bootstrap.startNativeGame(
          document.querySelector('#world'),
          { titleScreen: false, world: 'Random', seed: 5 },
          backend,
          undefined,
          false,
        );
        const game = runtime.app.game;
        const { point, project, Camera } = geometry;
        const text = game.context.text.bind(game.context);
        const probe = (window.picking = {
          runtime,
          game,
          frames: 0,
          draws: [],
          events: [],
          calls: [],
          ...people,
          ...geometry,
          ...world,
          ...roads,
          ...trees,
        });
        game.context.text = (...args) => {
          probe.draws.push({ bounds: args[0], text: args[1] });
          return text(...args);
        };
        for (const type of ['pointerdown', 'pointerup', 'pointermove'])
          document
            .querySelector('#world')
            .addEventListener(type, (event) => probe.events.push({ type, trusted: event.isTrusted }));
        probe.frame = (count = 1) => {
          for (let i = 0; i < count; ++i) {
            probe.draws = [];
            runtime.app.dirty = true;
            runtime.host.render(++probe.frames / 60);
          }
        };
        probe.reset = (kind) => {
          const town = new Town(5, 32, false);
          town.beasts = [];
          town.animals = [];
          town.placed = [];
          town.folk = [];
          town.neutralSettlements = [];
          town.world.ymir = null;
          town.world.fire = null;
          for (const tile of town.world.tiles)
            Object.assign(tile, {
              terrain: world.Terrain.Grass,
              trees: 0,
              wild: 0,
              revealed: true,
              quarried: true,
            });
          const addPerson = (id, at, role = people.Role.Resident, faction = 0) => {
            const person = new people.Person(
              id,
              `Picker ${id}`,
              role,
              people.Calling.Settler,
              people.Race.Human,
              499096 + id,
              at,
            );
            person.faction = faction;
            person.autoMode = false;
            person.entrance = { ...at };
            person.threshold = { ...at };
            town.folk.push(person);
            return person;
          };
          let focus = point(16, 16),
            data = {};
          if (kind === 'people') {
            const back = addPerson(10, point(16, 16)),
              front = addPerson(11, point(16.08, 16.08));
            data = { back: back.id, front: front.id, at: front.position };
          } else if (kind === 'tree') {
            let chosen;
            for (let y = 12; y < 22 && !chosen; ++y)
              for (let x = 12; x < 22; ++x) {
                const tree = trees.treeAt(town.world, x, y, 0);
                if (tree.kind === trees.TreeKind.Fir && tree.size < 0.7) {
                  chosen = { tree, x, y };
                  break;
                }
              }
            if (!chosen) throw Error('No deterministic small fir fixture');
            const { tree, x, y } = chosen;
            town.world.at(x, y).trees = 1;
            const back = addPerson(10, point(tree.foot.x - 0.08, tree.foot.y - 0.08));
            addPerson(11, point(tree.foot.x + 2, tree.foot.y - 2));
            focus = tree.foot;
            data = { cell: y * 32 + x, x, y, tree, person: back.id };
          } else if (kind === 'building') {
            const building = new Building(20, Structure.Tent, point(16, 16), 0, 0);
            town.placed.push(building);
            addPerson(10, point(15.5, 15.5));
            addPerson(11, point(18, 14));
            data = { building: building.id, person: 10 };
          } else if (kind === 'road') {
            const id = town.network.add(
              [point(13, 13), point(19, 13), point(19, 19)].map(roads.sharpAnchor),
              1,
            );
            addPerson(10, point(12, 17));
            data = { road: id, filled: point(16, 13), gap: point(16, 16) };
          } else if (kind === 'marquee') {
            addPerson(10, point(15, 15));
            addPerson(11, point(16, 15)).stressRecovery = true;
            addPerson(12, point(15, 16), people.Role.Guest);
            addPerson(13, point(16, 16), people.Role.Resident, 1);
            data = { friends: [10, 11], others: [12, 13] };
          }
          game.town = town;
          game.traffic = new Traffic(5);
          game.paused = true;
          game.selected =
            game.selectedTree =
            game.selectedRock =
            game.selectedDungeon =
            game.selectedAnimal =
              -1;
          game.chosen = [];
          game.selectedObjects = [];
          game.selectedTreeInstance = -1;
          game.rosterOpen = false;
          game.objectivesCollapsed = true;
          game.dockView = 0;
          game.dockAmount = 0;
          game.card = game.globalCard = -1;
          const center = project(focus.x, focus.y);
          game.setView(new Camera(center.x, center.y, 2));
          town.scout(focus.x, focus.y, 20);
          town.changes++;
          game.renderer.invalidateMap();
          game.invalidatePresentation();
          probe.calls = [];
          for (const name of ['orderChop', 'orderMove', 'orderBuild', 'orderAttack', 'orderRoadwork']) {
            const original = town[name].bind(town);
            town[name] = (...args) => {
              probe.calls.push({ name, args: structuredClone(args) });
              return original(...args);
            };
          }
          probe.frame(1);
          if (kind === 'building') {
            const visual = game.renderer.visuals.get(data.building);
            probe.frames += Math.ceil((visual.layout.frames / visual.layout.frameRate) * 60) + 1;
            probe.frame(1);
            if (visual.frame < visual.layout.frames) throw Error('Building rise animation is not complete');
          }
          probe.data = data;
          return data;
        };
        probe.pick = (at) => game.renderer.pick(at);
        probe.selected = () => ({
          people: game.chosen,
          building: game.selected,
          tree: game.selectedTree,
          treeInstance: game.selectedTreeInstance,
          objects: game.selectedObjects,
        });
        probe.find = (ref, behind) => {
          const g = game.renderer.selectionGeometry(ref);
          if (!g) throw Error(`Missing presented geometry ${JSON.stringify(ref)}`);
          let b = g.bounds;
          if (behind) {
            const other = game.renderer.selectionGeometry(behind)?.bounds;
            if (!other) throw Error(`Missing rear geometry ${JSON.stringify(behind)}`);
            const x = Math.max(b.x, other.x),
              y = Math.max(b.y, other.y);
            b = {
              x,
              y,
              w: Math.min(b.x + b.w, other.x + other.w) - x,
              h: Math.min(b.y + b.h, other.y + other.h) - y,
            };
          }
          const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
          const samples = [];
          for (let y = b.y + 2; y < b.y + b.h - 1; y += 2)
            for (let x = b.x + 2; x < b.x + b.w - 1; x += 2) samples.push({ x, y });
          samples.sort(
            (a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y),
          );
          for (const { x, y } of samples) {
            if (game.context.controlAt(x, y)) continue;
            const hit = probe.pick({ x, y });
            if (hit?.kind !== ref.kind || hit.id !== ref.id) continue;
            if (
              behind &&
              ![
                [0, 0],
                [-1.5, 0],
                [1.5, 0],
                [0, -1.5],
                [0, 1.5],
              ].every(([dx, dy]) =>
                game.renderer
                  .querySelection({
                    x: x + dx,
                    y: y + dy,
                    w: 1 / runtime.host.canvas.dpr,
                    h: 1 / runtime.host.canvas.dpr,
                  })
                  .some((h) => h.kind === behind.kind && h.id === behind.id),
              )
            )
              continue;
            probe.lastFind = { ref, behind, at: { x, y } };
            return { x, y };
          }
          throw Error(`No visible painted point for ${JSON.stringify(ref)} in ${JSON.stringify(g)}`);
        };
        // The first fixture performs the first presentation; the discarded
        // default 176-tile world does not need its own warm-up frames.
      }, backend);
      const frame = (n = 1) => page.evaluate((n) => picking.frame(n), n);
      const reset = (kind) => page.evaluate((kind) => picking.reset(kind), kind);
      const hover = async (at) => {
        await page.mouse.move(at.x, at.y);
        await frame();
        return page.evaluate(() => picking.game.hoveredWorldTarget?.hit ?? null);
      };
      const click = async (at, button = 'left') => {
        await page.mouse.click(at.x, at.y, { button });
        await frame();
        return page.evaluate(() => picking.selected());
      };
      const find = (ref, behind) =>
        page.evaluate(({ ref, behind }) => picking.find(ref, behind), { ref, behind });
      const control = async (id) => {
        const b = await page.evaluate((id) => {
          const c = picking.game.context.controls.find((c) => c.id === id && c.enabled);
          if (!c) throw Error(`Missing enabled control ${id}`);
          return c.bounds;
        }, id);
        return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      };
      const persons = await reset('people');
      row.surface = await page.evaluate(() => ({
        renderer: picking.runtime.host.canvas.renderer,
        dpr: picking.runtime.host.canvas.dpr,
        width: document.querySelector('#world').width,
        logicalWidth: document.querySelector('#world').clientWidth,
      }));
      assert.equal(row.surface.renderer, backend);
      assert.equal(row.surface.dpr, Math.min(dpr, 1.75));
      assert.equal(row.surface.width, row.surface.logicalWidth * row.surface.dpr);

      const frontPoint = await find(
        { kind: 'person', id: persons.front },
        { kind: 'person', id: persons.back },
      );
      assert.equal((await hover(frontPoint))?.id, persons.front);
      assert.deepEqual((await click(frontPoint)).people, [persons.front]);
      row.checks.push('front painted resident wins hover and click');
      await page.evaluate(() => {
        const p = picking.game.town.person(picking.data.front);
        p.position = picking.point(20, 12);
        picking.frame();
      });
      assert.equal((await hover(frontPoint))?.id, persons.back);
      assert.deepEqual((await click(frontPoint)).people, [persons.back]);
      row.checks.push('moving front resident exposes the rear silhouette');

      const tree = await reset('tree');
      const treePoint = await find(
        { kind: 'tree', id: tree.cell, instanceIndex: 0 },
        { kind: 'person', id: tree.person },
      );
      const treeHover = await hover(treePoint);
      assert.equal(treeHover?.kind, 'tree');
      assert.equal(treeHover.id, tree.cell);
      assert.equal(treeHover.instanceIndex, 0);
      const treeSelection = await click(treePoint);
      assert.equal(treeSelection.tree, tree.cell);
      assert.equal(treeSelection.treeInstance, 0);
      await page.evaluate(() => picking.game.selectPeople([11]));
      await frame();
      assert.deepEqual((await click(treePoint, 'right')).people, [11]);
      assert.equal(await page.evaluate(() => picking.calls.at(-1)?.name), 'orderChop');
      assert.equal(await page.evaluate(() => picking.calls.at(-1)?.args[1]), tree.cell);
      row.checks.push('small tree hover, click and contextual right-click share one painted winner');
      await page.evaluate(() => picking.game.selectPeople([]));
      await frame();
      const gap = await page.evaluate(() => {
        const g = picking.game.renderer.selectionGeometry({
          kind: 'tree',
          id: picking.data.cell,
          instanceIndex: 0,
        });
        return { x: g.bounds.x + 1, y: g.bounds.y + 1 };
      });
      assert.equal(await hover(gap), null, 'Transparent canopy bounding-box corner must not hit');
      assert.equal((await click(gap)).tree, -1);
      row.checks.push('transparent small-tree bounding-box corner does not select');

      const building = await reset('building');
      const buildingPoint = await find(
        { kind: 'building', id: building.building },
        { kind: 'person', id: building.person },
      );
      assert.equal((await hover(buildingPoint))?.kind, 'building');
      assert.equal((await click(buildingPoint)).building, building.building);
      await page.screenshot({ path: `${output}/${name}-building.png` });
      await page.evaluate(() => {
        const town = picking.game.town;
        town.placed = [];
        town.changes++;
        picking.frame();
      });
      assert.equal((await hover(buildingPoint))?.id, building.person);
      assert.deepEqual((await click(buildingPoint)).people, [building.person]);
      row.checks.push(
        'front building artwork wins over an overlapping resident, then removal exposes that resident',
      );

      const road = await reset('road');
      const roadPoints = await page.evaluate(() => ({
        path: picking.game.toScreen(picking.data.filled),
        gap: picking.game.toScreen(picking.data.gap),
      }));
      assert.equal(await hover(roadPoints.gap), null, 'Empty bent-road bounding-box interior must not hit');
      assert.equal((await click(roadPoints.gap)).objects.length, 0);
      assert.equal((await hover(roadPoints.path))?.kind, 'road');
      assert.deepEqual(
        (await click(roadPoints.path)).objects.map(({ kind, id }) => ({ kind, id })),
        [{ kind: 'road', id: road.road }],
      );
      row.checks.push('bent road picks its painted path, never the empty enclosing box');

      const crew = await reset('marquee');
      const box = await page.evaluate(() => {
        const boxes = picking.game.town
          .people()
          .map((p) => picking.game.renderer.selectionGeometry({ kind: 'person', id: p.id }).bounds);
        return {
          x: Math.min(...boxes.map((b) => b.x)) - 12,
          y: Math.min(...boxes.map((b) => b.y)) - 12,
          r: Math.max(...boxes.map((b) => b.x + b.w)) + 12,
          b: Math.max(...boxes.map((b) => b.y + b.h)) + 12,
        };
      });
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      await page.mouse.move(box.r, box.b, { steps: 8 });
      await page.mouse.up();
      await frame();
      assert.deepEqual(
        (await page.evaluate(() => picking.game.chosen)).sort((a, b) => a - b),
        crew.friends,
      );
      row.checks.push('trusted marquee selects only friendly residents, including overwhelmed residents');

      const personPoint = await find({ kind: 'person', id: 10 });
      await click(personPoint);
      const before = await page.evaluate(() => ({
        x: picking.game.camera.x,
        y: picking.game.camera.y,
        zoom: picking.game.camera.zoom,
      }));
      await page.mouse.move(800, 400);
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(840, 420, { steps: 4 });
      await page.mouse.up({ button: 'middle' });
      assert.equal(
        await page.evaluate((at) => picking.pick(at), personPoint),
        null,
        'Camera changes must invalidate old native hit geometry until the next presentation',
      );
      await frame();
      const panned = await page.evaluate(() => ({ x: picking.game.camera.x, y: picking.game.camera.y }));
      assert.notDeepEqual(panned, { x: before.x, y: before.y });
      await page.mouse.wheel(0, -100);
      await frame();
      assert.notEqual(await page.evaluate(() => picking.game.camera.zoom), before.zoom);
      const movedPoint = await find({ kind: 'person', id: 10 });
      assert.notDeepEqual(movedPoint, personPoint);
      assert.equal((await hover(movedPoint))?.id, 10);
      assert.deepEqual((await click(movedPoint)).people, [10]);
      row.checks.push('post-present picking follows trusted camera pan and zoom');

      await page.setViewportSize({ width: 390, height: 844 });
      await frame(1);
      const bottom = await page.evaluate(() => ({
        bounds: picking.game.dockBounds,
        inventory: picking.game.context.controls.filter((c) => c.id.startsWith('inventory-slot-')).length,
      }));
      assert(bottom.bounds.y > 844 / 2);
      assert.equal(bottom.inventory, 0);
      const management = await control('unit-management');
      await hover(management);
      const tooltip = await page.evaluate(() => {
        const text = picking.draws.findLast((draw) => draw.text === 'Unit equipment and inventory');
        return {
          text,
          controls: picking.game.context.controls
            .filter((c) => c.focusable)
            .map((c) => ({ id: c.id, bounds: c.bounds })),
        };
      });
      assert(tooltip.text, 'Management tooltip must remain visible above the completed UI');
      for (const c of tooltip.controls) {
        const a = tooltip.text.bounds,
          b = c.bounds;
        assert(
          !(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
          `Tooltip covers ${c.id}`,
        );
      }
      await page.screenshot({ path: `${output}/${name}-bottom-tooltip.png` });
      await click(management);
      await frame(1);
      const center = await page.evaluate(() => ({
        open: picking.game.rosterOpen,
        reducedMotion: picking.game.reducedMotion(),
        dockStarted: picking.game.dockStarted,
        bounds: picking.game.dockBounds,
        inventory: picking.game.context.controls.filter((c) => c.id.startsWith('inventory-slot-')).length,
        chosen: picking.game.chosen,
      }));
      assert.equal(center.open, true);
      // Reduced motion settles this layout immediately, rather than after an
      // arbitrary number of full-resolution raster frames.
      assert.equal(center.reducedMotion, true);
      assert.equal(center.dockStarted, -1);
      assert.equal(center.inventory, 16);
      assert.deepEqual(center.chosen, [10]);
      assert(Math.abs(center.bounds.y + center.bounds.h / 2 - 844 / 2) < 2);
      await page.screenshot({ path: `${output}/${name}-unit-center.png` });
      row.checks.push(
        'portrait selection stays compact at bottom; explicit Unit action opens centered gear; tooltips clear icons',
      );
      assert.equal(await page.evaluate(() => picking.events.every((event) => event.trusted)), true);
      await page.evaluate(() => picking.runtime.dispose());
      row.passed = true;
      console.log(`${name}: ${row.checks.length} browser picking checks passed`);
    } catch (error) {
      primaryError = lifetime.failure(error);
      row.failure = primaryError.stack ?? String(primaryError);
      console.error(row.failure);
      row.diagnostics = await page
        .evaluate(() => ({
          lastFind: picking.lastFind,
          hit: picking.lastFind ? picking.pick(picking.lastFind.at) : null,
          hovered: picking.game.hoveredWorldTarget,
          camera: picking.game.camera,
          time: picking.game.town.clock(),
          selected: picking.selected(),
        }))
        .catch(() => null);
      await page.screenshot({ path: `${output}/${name}-failure.png` }).catch(() => {});
      console.error(
        JSON.stringify({ case: name, completedChecks: row.checks, diagnostics: row.diagnostics }),
      );
      throw primaryError;
    } finally {
      row.durationSeconds = (Date.now() - started) / 1000;
      await lifetime.finish(primaryError);
    }
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', interrupt);
  await browser?.close();
  await server?.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report));
