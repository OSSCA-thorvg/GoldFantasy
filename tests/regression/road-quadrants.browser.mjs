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
];
const sources = new Map();
for (const file of pinnedFiles)
  sources.set(
    file,
    baseline
      ? execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' })
      : await readFile(resolve(root, file), 'utf8'),
  );
const report = {
  baseline: baseline ?? null,
  commissionCamp,
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
        people: town
          .people()
          .map((p) => ({
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
      people: town
        .people()
        .map((p) => ({
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
        result.fixture = await page.evaluate(
          ({ selected, quadrant }) => {
            const E = window.roadEngine,
              game = window.goldfantasy.app.gameSession.game,
              town = game.state(),
              c = town.camp().center;
            if (game.selectedPeople().length !== (selected ? town.people().length : 0))
              throw Error('Selection changed while activating road tool');
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
              people: town
                .people()
                .map((p) => ({
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
