import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
// Exercise the production renderer and dispatcher; audio is mixed offline only.
const output = process.env.GOLDFANTASY_TEST_OUTPUT ?? 'artifacts/work-audio/integration';
const maximumContactSkew = 1 / 60 + 128 / 44100;
let server, browser, deadline;
const report = { errors: [], cases: [], passed: false };
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [
      {
        name: 'work-contact-host',
        configureServer(vite) {
          vite.middlewares.use('/work-contact-host', (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Work contact validation</title></head><body></body></html>',
            );
          });
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 120000);
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on('pageerror', (e) => report.errors.push(String(e.stack ?? e)));
  await page.addInitScript(() => {
    window.liveAudioContexts = 0;
    window.AudioContext = class {
      constructor() {
        liveAudioContexts++;
        throw Error('No live audio output is allowed in this probe');
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/work-contact-host`);
  await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { BrowserFiles },
      { createNativeServices },
      { Town },
      { Traffic },
      people,
      { Building },
      { Structure },
      { Terrain },
      geometry,
      { SoundLibrary },
      { SoundBoard },
      audio,
      { default: endings },
      timing,
      equipment,
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/packages/engine/src/town.ts'),
      import('/packages/engine/src/traffic.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
      import('/packages/engine/src/world-types.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/native-audio/src/sound-library.ts'),
      import('/packages/native-audio/src/sound-board.ts'),
      import('/packages/native-audio/src/sound-types.ts'),
      import('/packages/native-audio/src/data/effect-endings.json'),
      import('/packages/engine/src/work-timing.ts'),
      import('/packages/engine/src/equipment.ts'),
    ]);
    const tvg = await initializeWebCanvas('sw'),
      element = document.createElement('canvas');
    document.body.append(element);
    const canvas = new tvg.Canvas(element, { width: 640, height: 480, enableDevicePixelRatio: false }),
      fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('work-audio-integration'),
      services = createNativeServices(tvg, fonts, files),
      game = services.createPreview(5),
      library = new SoundLibrary(endings);
    await Promise.all(
      ['sfx/chop_01', 'sfx/hammer_01', 'sfx/tree_fall_01'].map((name) => library.load(undefined, name)),
    );
    canvas.add(game.worldScene());
    window.probe = {
      tvg,
      canvas,
      files,
      game,
      library,
      SoundBoard,
      Town,
      Traffic,
      people,
      Building,
      Structure,
      Terrain,
      ...geometry,
      ...audio,
      ...timing,
      ...equipment,
    };
  });
  for (const title of [false, true])
    for (const mode of ['chop', 'hammer']) {
      const row = await page.evaluate(
        async ({ title, mode }) => {
          const {
            game,
            canvas,
            library,
            SoundBoard,
            Town,
            Traffic,
            people,
            Building,
            Structure,
            Terrain,
            point,
            project,
            Camera,
            Cue,
            treeFallTiming,
            addInventory,
            workItem,
          } = probe;
          const { Person, Role, Calling, Race, TreeWorkKind } = people,
            town = new Town(5, 32, false),
            p = new Person(0, 'Worker', Role.Resident, Calling.Settler, Race.Human, 499096, point(18, 18));
          for (let y = 0; y < 32; y++)
            for (let x = 0; x < 32; x++)
              Object.assign(town.map().at(x, y), {
                terrain: Terrain.Grass,
                trees: 0,
                wild: 0,
                revealed: true,
              });
          const home = new Building(0, Structure.Camp, point(12, 12), 0, 0);
          home.village = 0;
          town.placed.push(home);
          town.nextId = 1;
          town.foundSettlement(0);
          p.home = p.village = 0;
          p.food = p.rest = p.health = p.hydration = 1;
          town.folk.push(p);
          town.nextPerson = 1;
          // This probe checks decoded tool contacts against the corresponding
          // tool poses. The game starts barehanded; its fixture must own and
          // equip a real item instead of relying on an implicit starter tool.
          const tool = mode === 'chop' ? 'axe' : 'hammer',
            work = mode === 'chop' ? 'woodcutting' : 'construction';
          if (!addInventory(p, tool) || !town.equipItem(p.id, 1, 'tool1') || workItem(p, work)?.id !== tool)
            throw Error(`Could not equip the fixture's ${tool}`);
          town.titleAutoplay = title;
          town.titlePlanTimer = 1000;
          town.titleWeatherTimer = 1000;
          town.titleBuilder = p.id;
          town.changes++;
          town.tick(0);
          game.town = town;
          game.traffic = new Traffic(town.map().seed());
          game.chosen = [];
          game.objectivesCollapsed = true;
          game.paused = false;
          game.speed = 1;
          game.last = 0;
          game.heardTree = 0n;
          game.cues = [];
          game.renderer.invalidateMap();
          const center = project(19, 19);
          game.camera = new Camera(center.x, center.y, 3);
          game.render(640, 480, 0, false);
          canvas.update().render();
          game.takeCues();
          if (mode === 'chop') {
            town.map().at(20, 20).trees = 1;
            town.changes++;
            if (!town.orderChop([p.id], 20 * 32 + 20)) throw Error('OrderChop rejected');
          } else {
            const site = new Building(town.nextId++, Structure.Storehouse, point(20, 18), 0, 0);
            site.progress = 0;
            site.village = 0;
            town.placed.push(site);
            town.changes++;
            if (!town.orderBuild([p.id], site.id)) throw Error('OrderBuild rejected');
          }
          const board = new SoundBoard(library),
            rate = title ? 4 : 1,
            origin = town.clock(),
            events = [],
            cues = [],
            frames = [],
            samples = [],
            audioFrames = 735;
          let serial = 0n,
            fallEvent,
            groundWall = null;
          for (let i = 0; i < Math.ceil((12 * 60) / rate); i++) {
            const wall = (i + 1) / 60;
            if (title) town.advanceTitleAutoplay(1 / 60);
            game.render(640, 480, wall, !title);
            canvas.update().render();
            for (const event of town.treeEvents())
              if (event.serial >= serial) {
                serial = event.serial + 1n;
                const recorded = { ...event, serial: String(event.serial) };
                events.push(recorded);
                if (event.kind === TreeWorkKind.Fall) fallEvent = recorded;
              }
            const figure = game.renderer.figures.get(p.id),
              falling = game.renderer.fallingTrees[0];
            frames.push({
              wall,
              time: town.clock(),
              activity: p.activity,
              bodyY: figure?.parts.body?.matrix[4],
              fallCos: falling?.body.matrix[0],
            });
            if (falling && groundWall === null && Math.abs(falling.body.matrix[0] - Math.cos(1.46)) < 1e-5)
              groundWall = wall;
            for (const cue of game.takeCues()) {
              if ([Cue.Chop, Cue.Hammer, Cue.TreeFall].includes(cue.cue))
                cues.push({ ...cue, kind: Cue[cue.cue], wall, time: town.clock() });
              board.play(cue);
            }
            const chunk = new Float32Array(audioFrames * 2);
            board.render(chunk, audioFrames);
            for (let j = 0; j < audioFrames; j++)
              samples.push({ time: wall + j / 44100, value: chunk[j * 2] });
            if (mode === 'chop' && fallEvent && town.clock() > fallEvent.at + 2 * rate) break;
            if (mode === 'hammer' && events.filter((e) => e.kind === TreeWorkKind.Hammer).length >= 5) break;
            if (i % 60 === 0) await new Promise(requestAnimationFrame);
          }
          const peak = (from, to) =>
            samples
              .filter((s) => s.time >= from && s.time <= to)
              .reduce((best, s) => (Math.abs(s.value) > Math.abs(best.value) ? s : best), {
                time: 0,
                value: 0,
              });
          let result = {
            title,
            mode,
            speed: rate,
            origin,
            events,
            cues,
            liveAudioContexts,
            activity: p.activity,
            equippedTool: workItem(p, work)?.id,
          };
          if (mode === 'chop') {
            if (!fallEvent)
              throw Error(
                'No actual tree fall: ' +
                  JSON.stringify({
                    activity: p.activity,
                    position: p.position,
                    until: p.until,
                    time: town.clock(),
                  }),
              );
            const expected = (fallEvent.at + treeFallTiming.impact - origin) / rate,
              audioPeak = peak(expected - 0.04, expected + 0.12);
            result = {
              ...result,
              expected,
              groundWall,
              audioPeak,
              errorFromVisibleGround: audioPeak.time - groundWall,
              fallCues: cues.filter((c) => c.cue === Cue.TreeFall).length,
            };
          } else {
            result.contacts = events
              .filter((e) => e.kind === TreeWorkKind.Hammer)
              .map((event) => {
                const expected = (event.at - origin) / rate,
                  audioPeak = peak(expected - 0.002, expected + 0.025),
                  nearby = frames.filter((f) => Math.abs(f.wall - expected) <= 0.035),
                  visual = nearby.reduce(
                    (best, f) => ((f.bodyY ?? 1) < (best.bodyY ?? 1) ? f : best),
                    nearby[0],
                  );
                return { expected, audioPeak, visual, errorFromVisibleContact: audioPeak.time - visual.wall };
              });
          }
          return result;
        },
        { title, mode },
      );
      report.cases.push(row);
      assert.equal(row.equippedTool, mode === 'chop' ? 'axe' : 'hammer');
      await page.screenshot({ path: `${output}/${title ? 'title4x' : 'normal'}-${mode}.png` });
      if (mode === 'chop') {
        assert.equal(row.fallCues, 1);
        assert.notEqual(row.groundWall, null);
        assert.ok(Math.abs(row.errorFromVisibleGround) <= maximumContactSkew);
        assert.ok(row.audioPeak.value !== 0);
      } else {
        assert.ok(row.contacts.length >= 3);
        for (const contact of row.contacts) {
          assert.ok(Number.isFinite(contact.visual.bodyY) && contact.visual.bodyY < 0.98);
          assert.ok(contact.audioPeak.value !== 0);
          assert.ok(Math.abs(contact.errorFromVisibleContact) <= maximumContactSkew, JSON.stringify(contact));
        }
      }
      assert.equal(row.liveAudioContexts, 0);
      console.log(
        JSON.stringify({
          title,
          mode,
          error: row.errorFromVisibleGround,
          contacts: row.contacts?.map((c) => c.errorFromVisibleContact),
        }),
      );
    }
  await page.evaluate(async () => {
    probe.canvas.remove();
    probe.game.dispose();
    probe.canvas.destroy();
    await probe.files.close();
    probe.tvg.term();
  });
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (e) {
  report.failure = e.stack ?? String(e);
  throw e;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server?.close();
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2) + '\n');
}
