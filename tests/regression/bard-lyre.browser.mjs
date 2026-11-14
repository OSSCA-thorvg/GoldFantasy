// A bard in view plucks a lyre phrase that is heard; between phrases, and with the bard off screen, nothing is.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const report = { errors: [] };
let server, browser;
try {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'bard-lyre-validation',
        configureServer(vite) {
          vite.middlewares.use('/bard-lyre-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bard lyre</title></head><body></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: [
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
      '--use-angle=gl',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/bard-lyre-probe`);
  await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { BrowserFiles },
      { createNativeServices },
      { Calling, Role, Activity },
      { Building },
      { Structure },
      { BrowserSoundDevice },
      { Cue },
      { Camera, project },
      { mayPlay, playing },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
      import('/packages/native-audio/src/browser-audio.ts'),
      import('/packages/native-audio/src/sound-types.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/bard-phrases.ts'),
    ]);
    const tvg = await initializeWebCanvas('gl'),
      fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('bard-lyre-validation'),
      game = createNativeServices(tvg, fonts, files).createPreview(5),
      town = game.town,
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    const bard = town.makePerson(
      Role.Resident,
      Calling.Bard,
      town.grid.nearestWalkable({ x: camp.center.x + 2, y: camp.center.y + 1 }),
    );
    town.folk.push(bard);
    for (const p of town.folk) p.food = p.rest = p.hydration = 1;
    const look = (at, zoom = 1.4) => {
      const c = project(at.x, at.y);
      game.camera = new Camera(c.x, c.y, zoom);
    };
    look(bard.position);
    const device = new BrowserSoundDevice();
    device.fadeIn(0.05);
    await device.ready;
    const { context, library } = device.session;
    await Promise.all(
      library.entries.filter((e) => e.name.startsWith('sfx/bard/')).map((e) => library.load(context, e.name)),
    );
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    device.node.connect(analyser);
    window.probe = {
      game,
      bard,
      lyres: [],
      now: 0,
      // Only the lyre reaches the device, so what the analyser hears is the bard alone.
      frame() {
        this.now += 0.05;
        game.render(1280, 800, this.now, true, 0.05, this.now);
        for (const sound of game.takeCues())
          if (sound.cue === Cue.Lyre) {
            this.lyres.push({ take: sound.take, gain: sound.gain, at: game.town.clock() });
            device.play(sound);
          }
      },
      level() {
        const pcm = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(pcm);
        return Math.sqrt(pcm.reduce((sum, x) => sum + x * x, 0) / pcm.length);
      },
      soon() {
        bard.activity = Activity.Idle;
        bard.phraseDue = game.town.clock() + 0.3;
      },
      playing: () => playing(bard, game.town.clock()),
      free: () => mayPlay(game.town, bard),
      away() {
        look({ x: bard.position.x + 60, y: bard.position.y + 60 });
      },
      state: () => context.state,
    };
    for (let i = 0; i < 4; ++i) window.probe.frame();
  });
  const read = (expression) => page.evaluate(expression);
  const frames = async (count) => {
    for (let i = 0; i < count; ++i) await read('probe.frame()');
  };
  const listen = async (seconds) => {
    let loudest = 0;
    for (let i = 0; i < seconds * 10; ++i) {
      await new Promise((r) => setTimeout(r, 100));
      await read('probe.frame()');
      loudest = Math.max(loudest, await read('probe.level()'));
    }
    return loudest;
  };
  assert.equal(await read('probe.state()'), 'running');
  assert.ok(await read('probe.free()'), 'The bard is free to play at the camp');
  const before = await listen(1);
  await read('probe.soon()');
  for (let i = 0; i < 40 && !(await read('probe.playing()')); ++i) await frames(1);
  assert.ok(await read('probe.playing()'), 'A phrase begins');
  assert.equal((await read('probe.lyres')).length, 1, 'It is cued once');
  const heard = await listen(3);
  assert.ok(heard > 0.002, `The phrase is heard (rms ${heard})`);
  await listen(3);
  const after = await listen(2);
  assert.ok(after < 0.0005, `Silence between phrases (rms ${after})`);
  await read('probe.away()');
  await read('probe.soon()');
  for (let i = 0; i < 40 && !(await read('probe.playing()')); ++i) await frames(1);
  assert.ok(await read('probe.playing()'), 'The bard plays again with the camera elsewhere');
  const offscreen = await listen(3);
  assert.equal((await read('probe.lyres')).length, 1, 'Nothing is cued off screen');
  assert.ok(offscreen < 0.0005, `Silence off screen (rms ${offscreen})`);
  const lyres = await read('probe.lyres');
  console.log(JSON.stringify({ before, heard, after, offscreen, lyres, errors: report.errors }));
  assert.deepEqual(report.errors, []);
} finally {
  await browser?.close();
  await server?.close();
}
