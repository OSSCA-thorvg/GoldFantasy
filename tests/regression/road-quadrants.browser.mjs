/**
 * Shipping browser regression: first camp, real road gestures, actual work through completion.
 * Run: npm run test:roads
 * Historical reproduction: node tests/regression/road-quadrants.browser.mjs
 *   --baseline=f369e26 --commission-camp --label=red
 * The optional commissioning flag only bypasses the old first-camp admission deadlock;
 * the default/CI run creates the camp entirely through UI and ordinary simulation.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
const root = resolve(import.meta.dirname, '../..');
const baseline = process.argv.find((arg) => arg.startsWith('--baseline='))?.slice(11);
const label =
  process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) ?? (baseline ? 'before' : 'current');
const commissionCamp = process.argv.includes('--commission-camp');
const only = process.argv.find((arg) => arg.startsWith('--case='))?.slice(7);
assert.match(label, /^[a-z0-9_-]+$/i);
const output = resolve(root, 'artifacts/regression/road-quadrants', label);
await mkdir(output, { recursive: true });
const pinnedFiles = [
  'apps/web/src/native/game-commands.ts',
  'packages/engine/src/unit-scheduler.ts',
  'packages/engine/src/unit-orders.ts',
  'packages/engine/src/town-people.ts',
  'packages/engine/src/town-residents.ts',
  'packages/engine/src/town-construction.ts',
  'packages/engine/src/town-tick.ts',
  'packages/engine/src/road-construction.ts',
  'packages/engine/src/construction-work.ts',
  'packages/engine/src/walk-paths.ts',
  'packages/engine/src/automatic-work.ts',
  'packages/engine/src/stress-control.ts',
];
const sources = new Map();
const absentBaselineFiles = [];
for (const file of pinnedFiles) {
  let source;
  if (baseline) {
    try {
      source = execFileSync('git', ['show', `${baseline}:${file}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // The original first-camp reproduction predates these helper modules.
      // Pin the current fallback explicitly; never silently substitute an old core module.
      if (!['automatic-work.ts', 'stress-control.ts'].some((name) => file.endsWith('/' + name))) throw error;
      absentBaselineFiles.push(file);
    }
  }
  sources.set(file, source ?? (await readFile(resolve(root, file), 'utf8')));
}
const report = {
  baseline: baseline ?? null,
  commissionCamp,
  absentBaselineFiles,
  startedAt: new Date().toISOString(),
  errors: [],
  cases: [],
  sourceHashes: Object.fromEntries(
    [...sources].map(([name, source]) => [name, createHash('sha256').update(source).digest('hex')]),
  ),
};
let server, browser, context, page;
const interrupt = () => {
  process.exitCode = 130;
  void browser?.close().catch(() => {});
  void server?.close().catch(() => {});
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  server = await createServer({
    root,
    base: '/',
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'road-regression-source-snapshot',
        enforce: 'pre',
        transform(_code, id) {
          for (const [name, source] of sources) if (id.split('?')[0] === resolve(root, name)) return source;
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${address.port}/?test&renderer=sw&seed=5`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForFunction(
    () => window.goldfantasy?.app.preview || document.querySelector('#startup-error'),
    {},
    { timeout: 120000 },
  );
  await page.evaluate(async () => {
    if (!window.goldfantasy)
      throw Error(document.querySelector('#startup-error')?.textContent ?? 'Runtime unavailable');
    window.goldfantasy.host.stop();
    window.goldfantasy.host.render(window.goldfantasy.host.renderedAt);
    window.roadEngine = {
      ...(await import('/packages/engine/src/index.ts')),
      ...(await import('/packages/engine/src/game-tools.ts')),
    };
    window.roadEvents = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
      document
        .querySelector('#world')
        .addEventListener(type, (event) =>
          window.roadEvents.push({ type, trusted: event.isTrusted, x: event.clientX, y: event.clientY }),
        );
  });
  const frames = async (count = 1, dt = 0.1) =>
    page.evaluate(
      ({ n, dt }) => {
        for (let i = 0; i < n; ++i) window.goldfantasy.host.render(window.goldfantasy.host.renderedAt + dt);
      },
      { n: count, dt },
    );
  const control = async (id, title = false) => {
    const at = await page.evaluate(
      ({ id, title }) => {
        const app = window.goldfantasy.app,
          context = title ? app.overlay : app.gameSession.game.context;
        const c = context.controls.find((c) => c.id === id && c.enabled);
        if (!c) throw Error(`Missing enabled UI control ${id}`);
        return { x: c.bounds.x + c.bounds.w / 2, y: c.bounds.y + c.bounds.h / 2 };
      },
      { id, title },
    );
    await page.mouse.click(at.x, at.y);
    await frames(2);
  };
  await control('new-game', true);
  await frames(30);
  report.initial = await page.evaluate(async () => {
    const game = window.goldfantasy.app.gameSession.game,
      town = game.state(),
      map = town.map();
    if (window.goldfantasy.app.current !== 'Game' || town.camp())
      throw Error('Expected a fresh game before its first camp');
    game.setSpeed(5);
    game.selectPeople(town.people().map((p) => p.id));
    window.roadTerrain = map.tiles.map((tile) => tile.terrain);
    return {
      seed: map.seed(),
      width: map.width(),
      height: map.height(),
      people: town.people().map((p) => ({ id: p.id, name: p.name, autoMode: p.autoMode })),
      start: map.camp(),
    };
  });
  assert.equal(report.initial.seed, 5);
  assert.equal(report.initial.width, 176);
  await control('quest-action/0');
  const campScreen = await page.evaluate(() => {
    const game = window.goldfantasy.app.gameSession.game;
    if (game.tool !== window.roadEngine.Tool.Camp)
      throw Error('First objective did not activate the camp tool');
    return game.toScreen(game.state().map().camp());
  });
  await page.mouse.click(campScreen.x, campScreen.y);
  await frames(2);
  await page.evaluate((commission) => {
    const town = window.goldfantasy.app.gameSession.game.state(),
      camp = town.camp();
    if (!camp) throw Error('First camp UI placement failed');
    // This opt-in baseline escape hatch does not complete or supply the camp.
    // The default green run and every road gesture receive no such assistance.
    if (
      commission &&
      !town.orderBuild(
        town.people().map((p) => p.id),
        camp.id,
      )
    )
      throw Error('First camp construction order rejected');
  }, commissionCamp);
  let campReady = false;
  const campTrace = [];
  for (let i = 0; i < 192 && !campReady; i += 8) {
    await frames(8, 0.25);
    const status = await page.evaluate(() => {
      const town = window.goldfantasy.app.gameSession.game.state(),
        camp = town.camp();
      return {
        clock: town.clock(),
        progress: camp?.progress ?? null,
        people: town.people().map((p) => ({
          id: p.id,
          activity: window.roadEngine.Activity[p.activity],
          task: window.roadEngine.Activity[p.task],
          taskSite: p.taskSite,
          ordered: p.ordered,
          autoMode: p.autoMode,
          carrying: p.carrying,
          position: p.position,
        })),
      };
    });
    campTrace.push(status);
    campReady = status.progress === 1;
    console.log('Camp construction', JSON.stringify(status));
  }
  report.camp = { naturalCompletion: campReady, trace: campTrace };
  assert(campReady, 'First camp did not complete naturally within 240 simulation seconds');
  await frames(4);
  // Keep a real automatic-gathering state at the moment of the new player request.
  // Otherwise the UI preparation itself can finish a harvest and hide admission bugs.
  let gathering = false;
  for (let i = 0; i < 60 && !gathering; ++i) {
    gathering = await page.evaluate(() => {
      const E = window.roadEngine,
        town = window.goldfantasy.app.gameSession.game.state(),
        map = town.map();
      return town
        .people()
        .every(
          (p) =>
            p.autoMode &&
            !p.ordered &&
            p.activity === E.Activity.Felling &&
            p.task === E.Activity.Felling &&
            p.taskSite >= 0 &&
            map.at(p.taskSite % map.width(), Math.floor(p.taskSite / map.width())).trees > 0,
        );
    });
    if (!gathering) await frames(2);
  }
  assert(gathering, 'Founders did not naturally begin routine automatic gathering');
  report.baselineCamp = await page.evaluate(() => {
    const E = window.roadEngine,
      game = window.goldfantasy.app.gameSession.game,
      town = game.state();
    if (town.map().tiles.some((tile, i) => tile.terrain !== window.roadTerrain[i]))
      throw Error('Camp fixture changed map terrain');
    // Food/water remove unrelated starvation from this navigation/dispatch regression.
    // No terrain, roads, construction progress or worker task is altered.
    town.reward(new E.Resources(0, 0, 0, 100, 0, 100));
    for (const p of town.people()) {
      p.autoMode = true;
      p.food = p.rest = p.health = 1;
    }
    const saved = E.encodeTown(town);
    window.goldfantasy.files.stage('/tests/first-camp.goldfantasy', saved);
    return {
      clock: town.clock(),
      camp: town.camp().center,
      terrainUnchanged: true,
      roads: town.roads().roads().length,
      people: town.people().map((p) => ({
        id: p.id,
        activity: E.Activity[p.activity],
        task: E.Activity[p.task],
        taskSite: p.taskSite,
        ordered: p.ordered,
        autoMode: p.autoMode,
      })),
    };
  });
  console.log('First camp completed naturally', JSON.stringify(report.baselineCamp));
  const quadrants = [
    { name: 'NE', direction: [0, -1] },
    { name: 'SE', direction: [1, 0] },
    { name: 'SW', direction: [0, 1] },
    { name: 'NW', direction: [-1, 0] },
  ];
  for (const selected of [false, true])
    for (const quadrant of quadrants) {
      const name = `${quadrant.name}-${selected ? 'selected' : 'unselected'}`;
      if (only && only !== name) continue;
      const result = { name, selected, snapshots: [], failures: [] };
      try {
        await page.evaluate((selected) => {
          const runtime = window.goldfantasy,
            game = runtime.app.gameSession.game;
          if (!runtime.app.command('session.load', '/tests/first-camp.goldfantasy'))
            throw Error('Cannot reset first-camp save');
          game.workQueue = [];
          game.stoppedWork.clear();
          game.selectPeople(
            selected
              ? game
                  .state()
                  .people()
                  .map((p) => p.id)
              : [],
          );
          game.objectivesCollapsed = false;
          game.setSpeed(5);
          game.togglePause();
          game.renderer.invalidateMap();
        }, selected);
        await frames(2);
        await control('quest-action/1');
        await control('objectives-toggle');
        // Objectives intentionally create global requests. The real shortcut
        // honors the selected crew, so selected cases exercise direct orders.
        if (selected) {
          await page.keyboard.press('1');
          await frames();
        }
        result.fixture = await page.evaluate(
          ({ selected, quadrant }) => {
            const E = window.roadEngine,
              game = window.goldfantasy.app.gameSession.game,
              town = game.state(),
              c = town.camp().center;
            if (game.selectedPeople().length !== (selected ? town.people().length : 0))
              throw Error('Selection changed while activating road tool');
            if (game.crew.length !== (selected ? town.people().length : 0))
              throw Error('Road tool did not retain the intended direct/global crew');
            const at = (r) => E.point(c.x + quadrant.direction[0] * r, c.y + quadrant.direction[1] * r);
            let path;
            for (const reach of [5, 4, 3, 2.2]) {
              const candidate = [E.sharpAnchor(at(1.2)), E.sharpAnchor(at(reach))];
              if (
                town.canBuildRoad(candidate).ok &&
                E.flatten(candidate, 0.05).every(
                  (p) => !E.isWater(town.map().terrainAt(p)) && !E.impassable(town.map().terrainAt(p)),
                )
              ) {
                path = candidate;
                break;
              }
            }
            if (!path) throw Error(`No valid dry road in actual ${quadrant.name} camp quadrant`);
            const focus = E.project(c.x, c.y);
            game.setView(new E.Camera(focus.x, focus.y, 1.2));
            return {
              worldPath: path.map((p) => p.point),
              allowed: town.canBuildRoad(path),
              camp: c,
              selectedIds: [...game.selectedPeople()],
              autoModes: town.people().map((p) => p.autoMode),
              clock: town.clock(),
            };
          },
          { selected, quadrant },
        );
        await frames();
        const screen = await page.evaluate((path) => {
          const game = window.goldfantasy.app.gameSession.game;
          if (game.tool !== window.roadEngine.Tool.Road)
            throw Error('Draw a road did not activate Road tool');
          const points = path.map((p) => game.toScreen(p));
          for (const p of points)
            if (game.context.controls.some((c) => c.bounds.contains(p.x, p.y)))
              throw Error('Road gesture overlaps UI');
          window.roadEvents.length = 0;
          return points;
        }, result.fixture.worldPath);
        await page.evaluate(() => {
          const game = window.goldfantasy.app.gameSession.game;
          if (game.paused) game.togglePause();
        });
        await page.mouse.move(screen[0].x, screen[0].y);
        await page.mouse.down();
        await page.mouse.move(screen[1].x, screen[1].y, { steps: 12 });
        await page.mouse.up();
        result.pointer = await page.evaluate(() => window.roadEvents);
        assert(
          result.pointer.every((e) => e.trusted) &&
            result.pointer.filter((e) => e.type === 'pointerup').length === 1 &&
            !result.pointer.some((e) => e.type === 'pointercancel'),
          'Road gesture was not one trusted completed stroke',
        );
        const snapshot = async () =>
          page.evaluate(() => {
            const E = window.roadEngine,
              game = window.goldfantasy.app.gameSession.game,
              town = game.state(),
              road = town.roads().roads().at(-1),
              front = road?.workPoint();
            return {
              clock: town.clock(),
              status: game.status,
              roadCount: town.roads().roads().length,
              road: road
                ? {
                    id: road.id,
                    built: road.built,
                    path: road.path.map((a) => a.point),
                    constructionStart: road.constructionStart,
                    parent: road.parent,
                    front,
                    frontWalkable: town.walking().walkable(front),
                    required: road.materials.required,
                    delivered: road.materials.delivered,
                  }
                : null,
              queue: game.workQueue.map((w) => ({ ...w })),
              people: town.people().map((p) => ({
                id: p.id,
                activity: E.Activity[p.activity],
                activityId: p.activity,
                task: E.Activity[p.task],
                taskId: p.task,
                taskSite: p.taskSite,
                target: p.target,
                ordered: p.ordered,
                autoMode: p.autoMode,
                position: { ...p.position },
                next: p.path[0] ?? null,
                pathLength: p.path.length,
                carrying: p.carrying,
                rest: p.rest,
                health: p.health,
                directFrontPath: front ? town.walking().path(p.position, front) : [],
              })),
            };
          });
        result.snapshots.push(await snapshot());
        const initial = result.snapshots[0];
        let firstAssigned =
          initial.road && initial.people.some((p) => p.task === 'Roadwork' && p.taskSite === initial.road.id)
            ? initial.clock
            : null;
        let firstProgress = initial.road?.built > 0 ? initial.clock : null;
        for (let frame = 0; frame < 240; frame += 2) {
          await frames(2, frame < 8 ? 0.1 : 0.25);
          const value = await snapshot();
          result.snapshots.push(value);
          if (
            firstAssigned === null &&
            value.road &&
            value.people.some((p) => p.task === 'Roadwork' && p.taskSite === value.road.id)
          )
            firstAssigned = value.clock;
          if (firstProgress === null && value.road?.built > 0) firstProgress = value.clock;
          if (value.road?.built === 1 || value.clock - result.snapshots[0].clock >= 120) break;
        }
        const first = result.snapshots[0],
          last = result.snapshots.at(-1);
        result.firstAssignedSeconds = firstAssigned === null ? null : firstAssigned - first.clock;
        result.firstProgressSeconds = firstProgress === null ? null : firstProgress - first.clock;
        result.completedSeconds = last.road?.built === 1 ? last.clock - first.clock : null;
        if (first.roadCount !== 1) result.failures.push('Gesture did not create exactly one road');
        if (selected && first.queue.length)
          result.failures.push('Selected road unexpectedly entered the global queue');
        if (selected && !first.people.every((p) => p.ordered && p.taskSite === first.road?.id))
          result.failures.push('Selected road did not issue direct orders to the selected crew');
        if (result.firstAssignedSeconds === null || result.firstAssignedSeconds > 2)
          result.failures.push('No worker assigned within 2 simulation seconds');
        if (result.firstProgressSeconds === null || result.firstProgressSeconds > 20)
          result.failures.push('No construction progress within 20 simulation seconds');
        if (last.road?.built !== 1)
          result.failures.push('Road did not fully complete within 120 simulation seconds');
        await page.screenshot({ path: resolve(output, `${name}.png`) });
      } catch (error) {
        result.failures.push(error.stack ?? String(error));
      }
      result.passed = result.failures.length === 0;
      report.cases.push(result);
      console.log(
        `${name}: ${result.passed ? 'PASS' : 'FAIL'} assigned=${result.firstAssignedSeconds}s progress=${result.firstProgressSeconds}s complete=${result.completedSeconds}s ${result.failures.join('; ')}`,
      );
      await writeFile(
        resolve(output, 'report.json'),
        JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
      );
    }
  // A connected request must finish its unfinished prerequisite, survive a new
  // global building request, and then finish itself. Retaining taskSite alone is
  // insufficient: a worker can remain assigned while execution stops forever.
  for (const selected of [false, true]) {
    const name = `connected-${selected ? 'selected' : 'unselected'}`;
    if (only && only !== name) continue;
    const result = { name, selected, snapshots: [], failures: [] };
    try {
      await page.evaluate((selected) => {
        const runtime = window.goldfantasy,
          game = runtime.app.gameSession.game,
          E = window.roadEngine;
        if (!runtime.app.command('session.load', '/tests/first-camp.goldfantasy'))
          throw Error('Cannot reset first-camp save');
        game.workQueue = [];
        game.stoppedWork.clear();
        game.selectPeople(
          selected
            ? game
                .state()
                .people()
                .map((p) => p.id)
            : [],
        );
        game.objectivesCollapsed = false;
        game.setSpeed(5);
        if (!game.paused) game.togglePause();
        game.renderer.invalidateMap();
        const town = game.state();
        // This case tests work continuity, not discovery of a distant stone deposit.
        // Supply exactly the missing Altar cost to the camp; workers must still
        // fetch and deliver it normally after the real road gestures.
        const stockBefore = { ...town.stock() },
          altarCost = E.structureSpec(E.Structure.Shrine).cost;
        const stockAdded = new E.Resources();
        for (const resource of E.resourceKeys)
          stockAdded[resource] = Math.max(0, altarCost[resource] - stockBefore[resource]);
        town.reward(stockAdded);
        const fixtureStock = { before: stockBefore, added: { ...stockAdded }, after: { ...town.stock() } };
        const snapshot = () => ({
          clock: town.clock(),
          status: game.status,
          paused: game.paused,
          queue: game.workQueue.map((work) => ({ ...work, name: E.Activity[work.activity] })),
          stock: { ...town.stock() },
          raids: town.raids(),
          hits: town.hits().map((hit) => ({ at: hit.at, onPerson: hit.onPerson, person: hit.person })),
          monsters: town.monsters().map((m) => ({ id: m.id, position: { ...m.position } })),
          roads: town
            .roads()
            .roads()
            .map((road) => {
              const front = road.workPoint();
              return {
                id: road.id,
                built: road.built,
                parent: road.parent,
                parentAt: road.parentAt,
                constructionStart: road.constructionStart,
                path: road.path.map((a) => ({ ...a.point })),
                front,
                frontWalkable: town.walking().walkable(front),
                required: { ...road.materials.required },
                delivered: { ...road.materials.delivered },
              };
            }),
          buildings: town.buildings().map((b) => ({
            id: b.id,
            kind: E.Structure[b.kind],
            progress: b.progress,
            center: { ...b.center },
            door: b.door(),
            required: { ...b.materials.required },
            delivered: { ...b.materials.delivered },
          })),
          people: town.people().map((p) => ({
            id: p.id,
            activity: E.Activity[p.activity],
            task: E.Activity[p.task],
            taskSite: p.taskSite,
            target: p.target,
            ordered: p.ordered,
            autoMode: p.autoMode,
            position: { ...p.position },
            goal: { ...p.goal },
            path: p.path.map((at) => ({ ...at })),
            carrying: p.carrying,
            carriedProduct: E.Product[p.carriedProduct],
            supplyTarget: p.supplyTarget,
            supplyRoad: p.supplyRoad,
            tree: p.tree,
            food: p.food,
            hydration: p.hydration,
            rest: p.rest,
            health: p.health,
            stress: p.stress,
            recoveringRest: p.recoveringRest,
            recoveringHealth: p.recoveringHealth,
            stressRecovery: p.stressRecovery,
            foe: p.foe,
            attackPerson: p.attackPerson,
            inside: p.inside,
            doorway: p.doorway,
            until: p.until,
            scheduleAt: p.scheduleAt,
            requestedRoad: p.task === E.Activity.Roadwork ? p.taskSite : -1,
            actualWorkRoad:
              p.task === E.Activity.Roadwork
                ? typeof town.roadWorkTargetFor === 'function'
                  ? town.roadWorkTargetFor(p)
                  : town.roadWorkTarget(p.taskSite)
                : -1,
          })),
        });
        const trace = { events: [], snapshot, previous: '', stage: 'parent', fixtureStock };
        const record = (source) => {
          // Observe every engine tick and global dispatch, including transitions
          // that occur between two browser frames. These wrappers never issue orders.
          const signature = JSON.stringify({
            queue: game.workQueue.map((work) => [work.activity, work.target, String(work.serial)]),
            people: town
              .people()
              .map((p) => [
                p.id,
                p.activity,
                p.task,
                p.taskSite,
                p.target,
                p.ordered,
                p.autoMode,
                p.supplyTarget,
                p.supplyRoad,
                p.tree,
                p.carrying,
                p.carriedProduct,
                p.inside,
                p.doorway === 0 ? 0 : p.doorway === 1 ? 1 : 0.5,
                p.recoveringRest,
                p.recoveringHealth,
                p.stressRecovery,
                p.path.length > 0,
              ]),
          });
          if (signature !== trace.previous) {
            trace.previous = signature;
            trace.events.push({ source, stage: trace.stage, ...snapshot() });
          }
        };
        const tick = town.tick,
          dispatch = game.dispatchWork;
        town.tick = function (dt) {
          const value = tick.call(this, dt);
          record('tick');
          return value;
        };
        game.dispatchWork = function (...args) {
          const value = dispatch.apply(this, args);
          record('dispatch');
          return value;
        };
        window.roadTrace = trace;
        window.stopRoadTrace = () => {
          town.tick = tick;
          game.dispatchWork = dispatch;
        };
        record('fixture');
      }, selected);
      await frames(2);
      await control('quest-action/1');
      await control('objectives-toggle');
      result.fixture = await page.evaluate(() => {
        const E = window.roadEngine,
          game = window.goldfantasy.app.gameSession.game,
          town = game.state(),
          c = town.camp().center;
        const dry = (path) =>
          E.flatten(path, 0.05).every(
            (at) => !E.isWater(town.map().terrainAt(at)) && !E.impassable(town.map().terrainAt(at)),
          );
        for (const [dx, dy] of [
          [0, -1],
          [-1, 0],
          [0, 1],
          [1, 0],
        ])
          for (const reach of [5, 4, 3]) {
            const parent = [
              E.sharpAnchor(E.point(c.x + dx * 1.2, c.y + dy * 1.2)),
              E.sharpAnchor(E.point(c.x + dx * reach, c.y + dy * reach)),
            ];
            const from = parent[1].point;
            const children = [
              [dx, dy],
              [-dy, dx],
              [dy, -dx],
            ].map(([x, y]) => [
              E.sharpAnchor(from),
              E.sharpAnchor(E.point(from.x + x * 2.5, from.y + y * 2.5)),
            ]);
            if (!town.canBuildRoad(parent).ok || !dry(parent) || !children.some(dry)) continue;
            const focus = E.project(c.x, c.y);
            game.setView(new E.Camera(focus.x, focus.y, 1.2));
            return {
              camp: c,
              parent: parent.map((a) => a.point),
              children: children.filter(dry).map((path) => path.map((a) => a.point)),
              selectedIds: [...game.selectedPeople()],
              terrainUnchanged: true,
              stock: window.roadTrace.fixtureStock,
            };
          }
        throw Error('No dry connected-road fixture on the actual seed-5 world');
      });
      const stroke = async (path) => {
        if (selected) await page.keyboard.press('1');
        await frames();
        const points = await page.evaluate(
          ({ path, selected }) => {
            const game = window.goldfantasy.app.gameSession.game;
            if (game.tool !== window.roadEngine.Tool.Road) throw Error('Expected the real Road tool');
            if (
              game.crew.length !== (selected ? game.selectedPeople().length : 0) ||
              (selected && game.crew.length === 0)
            )
              throw Error('Road tool did not retain the intended direct/global crew');
            const points = path.map((p) => game.toScreen(p));
            for (const p of points)
              if (game.context.controls.some((c) => c.bounds.contains(p.x, p.y)))
                throw Error('Connected road gesture overlaps UI');
            window.roadEvents.length = 0;
            return points;
          },
          { path, selected },
        );
        await page.mouse.move(points[0].x, points[0].y);
        await page.mouse.down();
        for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 12 });
        await page.mouse.up();
        const events = await page.evaluate(() => window.roadEvents);
        assert(
          events.every((e) => e.trusted) &&
            events.filter((e) => e.type === 'pointerup').length === 1 &&
            !events.some((e) => e.type === 'pointercancel'),
          'Expected one trusted completed road stroke',
        );
        return events;
      };
      result.parentPointer = await stroke(result.fixture.parent);
      const snapshot = () => page.evaluate(() => window.roadTrace.snapshot());
      result.snapshots.push(await snapshot());
      assert.equal(result.snapshots[0].roads.length, 1, 'Parent road gesture was not accepted');
      const parentId = result.snapshots[0].roads[0].id;
      await page.evaluate(() => window.goldfantasy.app.gameSession.game.togglePause());
      for (let elapsed = 0; elapsed < 20; elapsed += 0.5) {
        await frames(1, 0.1);
        const current = await snapshot();
        result.snapshots.push(current);
        if (current.roads[0].built > 0) break;
      }
      const partial = result.snapshots.at(-1);
      assert(
        partial.roads[0].built > 0 && partial.roads[0].built < 1,
        'Parent must make real progress and still be unfinished before connecting the child',
      );
      await page.evaluate(() => {
        window.goldfantasy.app.gameSession.game.togglePause();
        window.roadTrace.stage = 'child';
      });
      result.fixture.child = await page.evaluate((children) => {
        const E = window.roadEngine,
          town = window.goldfantasy.app.gameSession.game.state();
        const path = children.find((candidate) => town.canBuildRoad(candidate.map(E.sharpAnchor)).ok);
        if (!path) throw Error('No accepted child route adjoining the unfinished parent');
        return path;
      }, result.fixture.children);
      await control('objectives-toggle');
      await control('quest-action/1');
      await control('objectives-toggle');
      result.childPointer = await stroke(result.fixture.child);
      const connected = await snapshot();
      result.snapshots.push(connected);
      assert.equal(connected.roads.length, 2, 'Child road gesture was not accepted');
      const child = connected.roads[1];
      assert.equal(child.parent, parentId, 'The child must depend on the unfinished parent');
      assert(connected.roads[0].built < 1 && child.built === 0, 'Both roads must still be unfinished');
      if (selected) {
        assert.equal(connected.queue.length, 0, 'Direct road requests must not rely on the global queue');
        assert(
          connected.people.some((p) => p.requestedRoad === child.id && p.actualWorkRoad === parentId),
          'Selected child request must execute its prerequisite road first',
        );
      } else
        assert(
          connected.queue.some((work) => work.name === 'Roadwork' && work.target === child.id),
          'Unselected child must enter the real global construction queue',
        );

      // Submit another global construction request while both roads are active.
      // Only the UI is paused; no worker's order, needs, materials or position is changed.
      await page.evaluate(() => {
        const game = window.goldfantasy.app.gameSession.game;
        game.selectPeople([]);
        game.selectTool(window.roadEngine.Tool.Select, false);
        window.roadTrace.stage = 'global-building';
      });
      await frames();
      await page.mouse.move(640, 775);
      await frames(4);
      await control('build-handle');
      await frames(2);
      await control('global/card-group-Faith & arcane');
      await frames(2);
      await control('global/card-pick-Shrine');
      await frames(2);
      result.fixture.building = await page.evaluate(() => {
        const E = window.roadEngine,
          game = window.goldfantasy.app.gameSession.game,
          town = game.state(),
          c = town.camp().center;
        if (game.tool !== E.Tool.Shrine || game.selectedPeople().length)
          throw Error('Build UI did not activate a global Altar placement');
        for (const radius of [2.5, 3, 4, 5, 6])
          for (let turn = 0; turn < 16; ++turn) {
            const cursor = E.point(
                c.x + Math.cos((turn * Math.PI) / 8) * radius,
                c.y + Math.sin((turn * Math.PI) / 8) * radius,
              ),
              spot = town.fit(E.Structure.Shrine, cursor, 0),
              screen = game.toScreen(cursor);
            if (
              town.canPlace(E.Structure.Shrine, spot.center, spot.angle).ok &&
              screen.x > 20 &&
              screen.x < 1260 &&
              screen.y > 80 &&
              screen.y < 650 &&
              !game.context.controls.some((control) => control.bounds.contains(screen.x, screen.y))
            )
              return { cursor, center: spot.center, angle: spot.angle, screen };
          }
        throw Error('No legal global Altar placement on the unchanged first-camp terrain');
      });
      await page.mouse.click(result.fixture.building.screen.x, result.fixture.building.screen.y);
      await frames();
      const queued = await snapshot();
      result.snapshots.push(queued);
      const altar = queued.buildings.find((b) => b.kind === 'Shrine');
      assert(altar && altar.progress < 1, 'Global Altar request did not create an unfinished building');
      assert(
        queued.queue.some((work) => work.name === 'Building' && work.target === altar.id),
        'Intervening building must enter the actual global construction queue',
      );
      assert(
        queued.roads.every((road) => road.built < 1),
        'UI setup unexpectedly advanced construction',
      );
      await page.evaluate(() => {
        window.roadTrace.stage = 'completion';
        window.goldfantasy.app.gameSession.game.togglePause();
      });
      const complete = (state) =>
        state.roads.length === 2 &&
        state.roads.every((road) => road.built === 1) &&
        state.buildings.some((b) => b.id === altar.id && b.progress === 1);
      // Keep the original 120-second per-site ceiling: two roads and one building.
      // All time advances through BrowserHost -> GameApp -> Town, with no forced work.
      for (let elapsed = 0; elapsed < 360; ++elapsed) {
        await frames(1, 0.2);
        const current = await snapshot();
        result.snapshots.push(current);
        if (complete(current) || current.clock - queued.clock >= 360) break;
      }
      const last = result.snapshots.at(-1);
      result.completedSeconds = complete(last) ? last.clock - queued.clock : null;
      result.siteCompletionSeconds = Object.fromEntries([
        ...[parentId, child.id].map((id) => {
          const finished = result.snapshots.find((state) =>
            state.roads.some((road) => road.id === id && road.built === 1),
          );
          return [`road-${id}`, finished ? finished.clock - queued.clock : null];
        }),
        [
          `altar-${altar.id}`,
          result.snapshots.find((state) => state.buildings.some((b) => b.id === altar.id && b.progress === 1))
            ?.clock - queued.clock,
        ],
      ]);
      assert.equal(
        last.roads.find((road) => road.id === parentId)?.built,
        1,
        'Accepted prerequisite road failed to complete after another global construction request',
      );
      assert.equal(
        last.roads.find((road) => road.id === child.id)?.built,
        1,
        'Accepted connected road failed to complete after its prerequisite',
      );
      assert.equal(
        last.buildings.find((b) => b.id === altar.id)?.progress,
        1,
        'Queued building failed to resume after the connected roads',
      );
      const roadsFinishedAt = result.snapshots.find(
        (state) => state.roads.length === 2 && state.roads.every((road) => road.built === 1),
      ).clock;
      // Distant raids and later encounters during the additional Altar job do
      // not invalidate an already finished, uninterrupted road transaction.
      assert(
        result.snapshots
          .filter((state) => state.clock <= roadsFinishedAt)
          .every((state) => !state.hits.some((hit) => hit.onPerson)),
        'An enemy attacked a worker during this non-combat construction regression',
      );
      assert(
        await page.evaluate(
          (roadsFinishedAt) =>
            window.roadTrace.events
              .filter((state) => state.clock <= roadsFinishedAt)
              .every((state) =>
                state.people.every(
                  (p) => p.activity !== 'Fighting' && p.foe < 0 && p.attackPerson < 0 && p.health === 1,
                ),
              ),
          roadsFinishedAt,
        ),
        'Combat or injury interrupted a worker during this construction regression',
      );
      assert(
        await page.evaluate(() =>
          window.goldfantasy.app.gameSession.game
            .state()
            .map()
            .tiles.every((tile, i) => tile.terrain === window.roadTerrain[i]),
        ),
        'Fixture changed the original terrain',
      );
      await page.screenshot({ path: resolve(output, `${name}.png`) });
    } catch (error) {
      result.failures.push(error.stack ?? String(error));
    } finally {
      result.transitions = await page
        .evaluate(() => {
          const events = window.roadTrace?.events ?? [];
          window.stopRoadTrace?.();
          window.stopRoadTrace = null;
          window.roadTrace = null;
          return events;
        })
        .catch(() => []);
    }
    result.passed = result.failures.length === 0;
    report.cases.push(result);
    console.log(
      `${name}: ${result.passed ? 'PASS' : 'FAIL'} complete=${result.completedSeconds}s ${result.failures.join('; ')}`,
    );
    await writeFile(
      resolve(output, 'report.json'),
      JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
    );
  }
  report.passed = report.cases.length > 0 && !report.errors.length && report.cases.every((c) => c.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  report.passed = false;
  console.error(error);
  process.exitCode = 1;
} finally {
  await page?.evaluate(() => window.goldfantasy?.dispose()).catch(() => {});
  await context?.close();
  await browser?.close();
  await server?.close();
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(report, (_key, value) => (typeof value === 'bigint' ? value.toString() : value), 2),
  );
  console.log(resolve(output, 'report.json'));
}
