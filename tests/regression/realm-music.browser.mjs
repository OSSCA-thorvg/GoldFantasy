// A party steps through a gate: the loop of that world's floor is fetched only then, is heard, and fades on leaving.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const report = { errors: [], requests: [] };
let server, browser;
try {
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'realm-music-validation',
        configureServer(vite) {
          vite.middlewares.use('/realm-music-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Realm music</title></head><body></body></html>');
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  page.on('request', (request) => {
    if (request.url().endsWith('.ogg')) report.requests.push(new URL(request.url()).pathname);
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/realm-music-probe`);
  await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { BrowserFiles },
      { createNativeServices },
      { Calling, Role },
      { sealable },
      { monsterEntrance },
      { Building },
      { Structure },
      { openExpedition },
      { BrowserSoundDevice },
      { Cue },
      { realmTrack },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/gate-seals.ts'),
      import('/packages/engine/src/town-monsters.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
      import('/apps/web/src/native/expedition-window.ts'),
      import('/packages/native-audio/src/browser-audio.ts'),
      import('/packages/native-audio/src/sound-types.ts'),
      import('/apps/web/src/native/realm-music.ts'),
    ]);
    const tvg = await initializeWebCanvas('gl'),
      fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('realm-music-validation'),
      game = createNativeServices(tvg, fonts, files).createPreview(5),
      town = game.town,
      gate = town.map().dungeons().findIndex(sealable),
      site = town.map().dungeons()[gate];
    site.discovered = true;
    const camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    for (const calling of [Calling.Warrior, Calling.Ranger, Calling.Cleric].slice(town.folk.length)) {
      const p = town.makePerson(Role.Resident, calling, monsterEntrance(site));
      town.folk.push(p);
    }
    for (const p of town.folk) {
      p.level = 20;
      p.position = town.grid.nearestWalkable({ x: monsterEntrance(site).x + 1.5, y: monsterEntrance(site).y + 1.5 });
      p.food = p.rest = p.hydration = 1;
    }
    const device = new BrowserSoundDevice();
    device.fadeIn(0.05);
    await device.ready;
    const node = device.node,
      post = node.port.postMessage.bind(node.port),
      posted = [];
    node.port.postMessage = (message, ...rest) => {
      if (message.kind === 'music') posted.push(message.name);
      return post(message, ...rest);
    };
    const analyser = device.session.context.createAnalyser();
    analyser.fftSize = 4096;
    node.connect(analyser);
    window.probe = {
      game,
      asked: [],
      posted,
      now: 0,
      // Only the music reaches the device, so what the analyser hears is the music alone.
      frame() {
        this.now += 0.05;
        game.render(1280, 800, this.now, true, 0.05, this.now);
        for (const sound of game.takeCues())
          if (sound.cue === Cue.Music) {
            this.asked.push({ track: sound.track, loop: sound.loop });
            device.play(sound);
          }
      },
      level() {
        const pcm = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(pcm);
        return Math.sqrt(pcm.reduce((sum, x) => sum + x * x, 0) / pcm.length);
      },
      expected: () => realmTrack(game.town),
      state: () => device.session.context.state,
      enter() {
        if (!openExpedition(game, gate, town.folk.map((p) => p.id))) throw new Error('The gate has no expedition window');
        this.frame();
        game.handleExpeditionEvent({ type: 'KeyDown', text: 'return', key: 0, x: 0, y: 0, delta: 0, button: 0, shift: false, control: false, alt: false, meta: false });
        for (let t = 0; t < 60 && !game.town.realmActive(); t += 0.2) game.town.advance(0.2);
        return game.town.realmActive();
      },
      leave() {
        return game.town.leaveRealm();
      },
    };
    for (let i = 0; i < 6; ++i) window.probe.frame();
  });
  const read = (expression) => page.evaluate(expression);
  const until = async (expression, seconds = 20) => {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      if (await read(expression)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Timed out: ' + expression + '; errors=' + JSON.stringify(report.errors));
  };
  assert.equal(await read('probe.state()'), 'running');
  const realmRequests = () => report.requests.filter((path) => path.includes('/music/realm/'));
  assert.deepEqual(realmRequests(), [], 'No world music is fetched before a party steps through');
  assert.deepEqual(await read('probe.asked'), []);
  const quiet = await read('probe.level()');
  assert.ok(await read('probe.enter()'), 'The party is carried beyond the gate');
  for (let i = 0; i < 4; ++i) await read('probe.frame()');
  const expected = await read('probe.expected()');
  assert.match(expected, /^music\/realm\/[a-z]+_[123]$/);
  assert.deepEqual(await read('probe.asked'), [{ track: expected, loop: true }]);
  await until(`probe.posted.includes(${JSON.stringify(expected)})`);
  assert.deepEqual(realmRequests(), [`/assets/audio/${expected}.ogg`]);
  // The loop fades in over a few seconds; take the loudest of ten seconds of reads.
  let heard = 0;
  for (let i = 0; i < 50; ++i) {
    await new Promise((r) => setTimeout(r, 200));
    heard = Math.max(heard, await read('probe.level()'));
  }
  assert.ok(heard > 0.004, `The world's music is heard (rms ${heard})`);
  assert.ok(await read('probe.leave()'), 'The party walks home');
  await read('probe.frame()');
  assert.deepEqual((await read('probe.asked')).at(-1), { track: '', loop: false });
  await until('probe.level() < 0.0005', 15);
  console.log(JSON.stringify({ track: expected, quietBefore: quiet, heardRms: heard, requests: realmRequests(), errors: report.errors }));
  assert.deepEqual(report.errors, []);
} finally {
  await browser?.close();
  await server?.close();
}
