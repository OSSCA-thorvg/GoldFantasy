import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Thor's visit and Jormungandr in the sea, on the real game with its HUD: pictures to judge as a player, two
// frame strips (GIFs), the frame cost with the serpent up, and a gallery. GODS_ONLY=thor,serpent picks groups.
const output = 'artifacts/regression/gods';
const only = (process.env.GODS_ONLY ?? '').split(',').filter(Boolean);
const wanted = (group) => !only.length || only.includes(group);
const report = { errors: [], shots: [], gifs: [], cost: {}, checks: {}, passed: false };
let server, browser, deadline;

async function boot(page, { width, height }) {
  await page.evaluate(
    async ({ width, height }) => {
      const [
        { initializeWebCanvas },
        { loadNativeFonts, loadKoreanFont },
        { BrowserFiles },
        { createNativeServices },
        { Camera, project },
        { Structure },
        { Activity, Calling, Monster, Role },
        { Building },
        { Weather },
        { ThorDoing, thorRules },
        { serpentRing, serpentParts, partRise, partMiddle, serpentEmergence, weatherSpell, SerpentPartKind },
        { findRealmArea },
        { emptyEvent },
        { Reach },
        guide,
        localization,
      ] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'),
        import('/apps/web/src/native/bootstrap.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/person.ts'),
        import('/packages/engine/src/town-models.ts'),
        import('/packages/engine/src/climate.ts'),
        import('/packages/engine/src/thor-visit.ts'),
        import('/packages/native-renderer/src/serpent-ring.ts'),
        import('/packages/engine/src/realm-layout.ts'),
        import('/apps/web/src/native/application-contracts.ts'),
        import('/packages/engine/src/thunderstorm.ts'),
        import('/apps/web/src/native/game-guide.ts'),
        import('/packages/localization/src/index.ts'),
      ]);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      document.body.append(element);
      const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
        fonts = await loadNativeFonts(tvg),
        files = await BrowserFiles.open(`gods-validation-${width}`),
        game = createNativeServices(tvg, fonts, files).createPreview(5),
        town = game.town,
        map = town.map(),
        origin = map.camp();
      town.summonRaid = () => {};
      town.releaseMonster = () => {};
      town.awaiting = false;
      // A settlement that has called Thor: a camp, an altar, a tavern, homes and six residents.
      const place = (kind, dx, dy) => {
        for (let r = 0; r < 6; r += 0.5)
          for (let a = 0; a < 12; ++a) {
            const at = { x: origin.x + dx + r * Math.cos(a * 0.52), y: origin.y + dy + r * Math.sin(a * 0.52) };
            if (!town.canPlace(kind, at, 0).ok) continue;
            const b = new Building(town.nextId++, kind, at, 0, 0);
            b.village = 0;
            town.placed.push(b);
            return b;
          }
        return null;
      };
      const camp = new Building(town.nextId++, Structure.Camp, origin, 0, 0);
      camp.village = 0;
      town.placed.push(camp);
      town.foundSettlement(camp.id);
      town.stock().wood = town.stock().stone = town.stock().food = 300;
      const altar = place(Structure.Shrine, 5, -2),
        tavern = place(Structure.Tavern, -5, 3);
      place(Structure.Cottage, 3, 5);
      place(Structure.Cottage, -4, -4);
      while (town.population() < 6) {
        const p = town.makePerson(Role.Resident, Calling.Settler, { x: origin.x + town.population() * 0.6 - 2, y: origin.y + 1.6 });
        town.folk.push(p);
      }
      for (const p of town.folk) p.food = p.rest = p.hydration = 1;
      town.changes++;
      town.scout(map.width() / 2, map.height() / 2, map.width());
      canvas.add(game.worldScene()).add(game.hudScene());
      const look = (at, zoom) => {
        const s = project(at.x, at.y);
        game.camera = new Camera(s.x, s.y, zoom);
      };
      window.probe = {
        game,
        town,
        now: 0,
        frame(dt = 0.05, simulate = false) {
          this.now += dt;
          game.render(width, height, this.now, simulate, dt, this.now);
          canvas.update().render();
          game.worldPresented(1);
          for (const sound of game.takeCues()) this.heard.push({ sound, at: this.now });
          if (this.heard.length > 400) this.heard.splice(0, this.heard.length - 400);
        },
        heard: [],
        /**
         * Mixes what the game asked to play from `since` on, offline through the game's own mixer, and returns the
         * cue names, the clip groups they draw from and the loudness in tenths of a second.
         */
        async listen(since, only) {
          const [{ SoundBoard }, { sounds }, { cueClips }, { Cue }] = await Promise.all([
            import('/packages/native-audio/src/sound-board.ts'),
            import('/packages/native-audio/src/sound-library.ts'),
            import('/packages/native-audio/src/sound-catalog.ts'),
            import('/packages/native-audio/src/sound-types.ts'),
          ]);
          await sounds.loadEffects();
          const picked = this.heard.filter((h) => h.at >= since && (!only || only.includes(Cue[h.sound.cue])));
          if (!picked.length) return { cues: [], groups: [], rms: [], loudest: 0 };
          const board = new SoundBoard(),
            rate = 44100,
            start = picked[0].at,
            rms = [];
          let clock = 0,
            window = [];
          const render = (until) => {
            while (clock < until) {
              const n = 441, pcm = new Float32Array(n * 2);
              board.render(pcm, n);
              let sum = 0;
              for (let i = 0; i < n * 2; ++i) sum += pcm[i] * pcm[i];
              window.push(sum / (n * 2));
              if (window.length === 10) {
                rms.push(Math.sqrt(window.reduce((a, b) => a + b, 0) / 10));
                window = [];
              }
              clock += n / rate;
            }
          };
          for (const h of picked) {
            render(h.at - start);
            board.play(h.sound);
          }
          render(picked[picked.length - 1].at - start + 3);
          return {
            cues: picked.map((h) => ({ cue: Cue[h.sound.cue], at: +(h.at - start).toFixed(2), delay: +h.sound.delay.toFixed(2), gain: +h.sound.gain.toFixed(2) })),
            groups: [...new Set(picked.flatMap((h) => cueClips[h.sound.cue] ?? []))],
            rms: rms.map((v) => +v.toFixed(4)),
            loudest: Math.max(...rms),
          };
        },
        frames(count, dt = 0.05, simulate = false) {
          for (let i = 0; i < count; ++i) this.frame(dt, simulate);
        },
        live(seconds, until = () => false) {
          for (let t = 0; t < seconds && !until(); t += 0.1) {
            town.advance(0.1);
            game.dispatchWork();
            if (Math.round(t * 10) % 5 === 4) this.frame(0.05);
          }
          this.frames(3);
        },
        look,
        hour(h) {
          town.editHour(h);
          const c = town.climate();
          c.weather = Weather.Clear;
          c.intensity = 0;
          town.changes++;
        },
        /** Early night: dark enough for him to hunt, light enough to see by. */
        dusk() {
          for (let h = 18; h < 23.5; h += 0.1) {
            this.hour(h);
            if (town.climate().night > 0.62) break;
          }
          this.frames(2);
        },
        /** Runs the world until a throw is `phase` seconds old; the frame then shows that moment. */
        untilThrow(phase) {
          for (let t = 0; t < 90; t += 0.02) {
            town.advance(0.02);
            const thor = town.thor;
            if (Math.round(t * 50) % 12 === 0) this.frame(0.02);
            if (thor.throwAt >= 0 && town.clock() - thor.throwAt >= phase && town.clock() - thor.throwAt < phase + 0.05) break;
          }
          this.frame(0.016);
          return this.thor();
        },
        weather(kind, intensity) {
          town.weather().force(Weather[kind], intensity);
          town.changes++;
        },
        sites() {
          return { origin, altar: altar?.center, tavern: tavern?.center };
        },
        /** Thor comes down this morning; the frame right after his bolt. */
        arrive() {
          this.hour(8);
          town.thor.nextVisit = town.days;
          for (let i = 0; i < 400 && !town.thor.present; ++i) town.advance(0.1);
          look(town.thor.position, 2.4);
          this.frames(2, 0.02);
          return { ...town.thor.position };
        },
        /** Holds Thor at a pastime `t` seconds in, standing at `at`, looking at `toward`. */
        pastime(name, at, toward, t) {
          const thor = town.thor;
          thor.doing = ThorDoing[name];
          thor.position = { ...at };
          thor.goal = null;
          thor.path = [];
          thor.look = toward ? { ...toward } : null;
          thor.since = town.clock() - t;
          thor.until = town.clock() + 1000;
          thor.throwAt = -1;
          this.frames(3, 0.05);
          this.frames(2, 0.0);
        },
        /** Thor alone, close up, in one pose: a pastime `t` seconds in, or a throw. */
        studio(name, t) {
          const at = town.grid.nearestWalkable({ x: origin.x + 3, y: origin.y + 6 }),
            thor = town.thor;
          this.hour(11);
          if (name === 'Throw') {
            this.pastime('Hunting', at, { x: at.x + 3, y: at.y - 3 }, 0);
            thor.throwAt = town.clock() - t;
            thor.throwFrom = { ...at };
            thor.throwTo = { x: at.x + 3, y: at.y - 3 };
          } else if (name === 'Arriving') this.pastime('Arriving', at, null, t);
          else this.pastime(name, at, name === 'Fireside' ? { x: at.x + 2, y: at.y } : null, t);
          const s = project(at.x, at.y);
          game.camera = new Camera(s.x, s.y - 26, 6);
          game.selectedObjects = [];
          this.frames(4, 0.05);
          return at;
        },
        /** A resident at work near Thor, for him to watch. */
        worker(at) {
          const p = town.folk[2];
          p.position = { ...at };
          p.inside = false;
          p.activity = Activity.Building;
          p.path = [];
          return p.id;
        },
        /** Monsters out in the night round the settlement, coming in. */
        monsters(count, from) {
          const out = [];
          for (let i = 0; i < count; ++i) {
            const at = town.grid.nearestWalkable({ x: from.x + (i % 3) * 0.9, y: from.y + Math.floor(i / 3) * 0.9 });
            const m = new Monster(town.nextMonster++, 0, at);
            m.home = { ...at };
            m.health = m.vigor = 13.5;
            m.raider = true;
            town.beasts.push(m);
            out.push(m.id);
          }
          return out;
        },
        thor() {
          const t = town.thor;
          return { present: t.present, doing: ThorDoing[t.doing], position: { ...t.position }, throwAt: t.throwAt, target: t.target, bolts: t.bolts.length, clock: town.clock() };
        },
        thorRules() {
          return { ...thorRules };
        },
        screen(at) {
          return game.camera.toScreen(project(at.x, at.y), width, height);
        },
        guideCard() {
          return game.guide.card?.entry.key ?? '';
        },
        until(key) {
          // The guide hears the world only on frames that advance it.
          for (let i = 0; i < 24 && game.guide.card?.entry.key !== key; ++i) {
            if (game.guide.card) guide.dismissGuideCard(game);
            this.frames(2, 0.02, true);
          }
          return game.guide.card?.entry.key === key;
        },
        dismiss() {
          for (let i = 0; i < 24 && (game.guide.card || game.guide.queue.length); ++i) {
            guide.dismissGuideCard(game);
            this.frames(1, 0.02, true);
          }
        },
        async korean(on) {
          if (on) await loadKoreanFont(tvg, fonts);
          localization.setLocale(on ? 'KR' : 'ENG');
        },
        /** The serpent's parts in the current weather, with how far each is up now. */
        serpent() {
          const realm = town.realmArea ?? findRealmArea(map),
            ring = serpentRing(map, realm),
            c = town.climate(),
            spell = weatherSpell(town.weather().snapshot().peak),
            e = serpentEmergence(map.seed(), c.weather, c.intensity, spell);
          if (!ring) return null;
          return {
            emergence: e,
            points: ring.points.length,
            parts: serpentParts(ring, map.seed(), spell).map((p) => ({
              kind: SerpentPartKind[p.kind],
              mid: partMiddle(p, ring),
              rise: partRise(p, ring, e, town.clock()),
            })),
          };
        },
        /** A storm spell the serpent rises in (the spell is named by the sky's peak strength). */
        serpentStorm() {
          for (let k = 0; k < 40; ++k) {
            const intensity = 0.8 + k * 0.004;
            town.weather().force(Weather.Storm, intensity);
            if (serpentEmergence(map.seed(), Weather.Storm, intensity, weatherSpell(town.weather().snapshot().peak)) > 0.5) break;
          }
          town.changes++;
        },
        /** Runs the serpent's clock until the part of `kind` nearest `near` is well up; returns that part. */
        rise(kind, near) {
          let best = null;
          for (let i = 0; i < 400; ++i) {
            const info = this.serpent(),
              part = info.parts
                .filter((p) => p.kind === kind)
                .sort((a, b) => Math.hypot(a.mid.x - near.x, a.mid.y - near.y) - Math.hypot(b.mid.x - near.x, b.mid.y - near.y))[0];
            if (part && part.rise > 0.85) {
              best = part;
              break;
            }
            town.time += 0.5;
          }
          if (best) this.look(best.mid, 1.1);
          this.frames(8, 0.06);
          return best;
        },
        /** Runs the clock with the world still, so the serpent and the sea move on. */
        drift(seconds, dt = 0.1) {
          for (let t = 0; t < seconds; t += dt) {
            town.time += dt;
            this.frame(dt);
          }
        },
        strike() {
          game.renderer.lightning({ reach: Reach.Near, at: this.now, delay: 0, brightness: 0.9, across: 0.5, down: 0.4, seed: 7 });
        },
        /** Median milliseconds of one whole frame: update, sync and draw. */
        cost(rounds = 40) {
          const times = [];
          for (let i = 0; i < rounds; ++i) {
            const t0 = performance.now();
            town.time += 0.05;
            this.frame(0.05);
            times.push(performance.now() - t0);
          }
          times.sort((a, b) => a - b);
          return times[Math.floor(times.length / 2)];
        },
        serpentShapes() {
          let n = 0;
          const walk = (p) => {
            if (p.type === 'shape' && p.alpha) ++n;
            for (const c of p.children ?? []) if (c.alpha) walk(c);
          };
          if (game.renderer.serpent.alpha) walk(game.renderer.serpent);
          return n;
        },
      };
      const event = (type, e) => ({ ...emptyEvent(type), x: e.clientX, y: e.clientY, button: 1, pointerType: e.pointerType });
      element.addEventListener('pointermove', (e) => (e.pointerType === 'touch' ? game.handleTouchEvent(event('PointerMove', e)) : game.pointerMove(e.clientX, e.clientY)));
      element.addEventListener('pointerdown', (e) => (e.pointerType === 'touch' ? game.handleTouchEvent(event('PointerDown', e)) : game.pointerDown(e.clientX, e.clientY, 0)));
      element.addEventListener('pointerup', (e) => (e.pointerType === 'touch' ? game.handleTouchEvent(event('PointerUp', e)) : game.pointerUp(e.clientX, e.clientY, 0)));
      probe.frames(10);
    },
    { width, height },
  );
}
const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code ? reject(new Error(`${cmd} ${code}: ${err}`)) : resolve()));
  });

try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'gods-validation',
        configureServer(vite) {
          vite.middlewares.use('/gods-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gods validation</title></head><body style="margin:0;background:#11191c"></body></html>');
          });
        },
      },
    ],
  });
  await server.listen();
  // The real GPU through ANGLE; SwiftShader would take most of a second a frame.
  browser = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 900000);
  const url = `http://127.0.0.1:${server.httpServer.address().port}/gods-probe`;
  const open = async (width, height) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 }),
      page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(url);
    await boot(page, { width, height });
    report.gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2'),
        info = gl?.getExtension('WEBGL_debug_renderer_info');
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    return page;
  };
  const shot = async (page, name) => {
    await page.screenshot({ path: `${output}/${name}.png` });
    report.shots.push(name);
  };
  const ev = (page, fn, arg) => page.evaluate(fn, arg);
  /** Frames at 24 a second while the world runs, then one GIF. */
  const strip = async (page, name, count, step, clip) => {
    const dir = `${output}/.frames-${name}`;
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < count; ++i) {
      await page.evaluate(step);
      await page.screenshot({ path: `${dir}/frame-${String(i).padStart(3, '0')}.png`, clip });
    }
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '24', '-i', `${dir}/frame-%03d.png`, '-vf', 'scale=560:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none', '-loop', '0', `${output}/${name}.gif`]);
    await rm(dir, { recursive: true, force: true });
    report.gifs.push(name);
  };

  if (wanted('poses')) {
    const page = await open(1280, 800);
    await ev(page, () => { probe.frames(10, 0.05, true); probe.dismiss(); probe.arrive(); probe.dismiss(); });
    const poses = [['Arriving', 0.1], ['Arriving', 0.8], ['Strolling', 0], ['Fireside', 3], ['Watching', 0.7], ['Watching', 4.9], ['Lifting', 0.8], ['Lifting', 1.3], ['Lifting', 2.4], ['Drinking', 0.6], ['Drinking', 1.4], ['Throw', 0.05], ['Throw', 0.25], ['Throw', 0.4], ['Throw', 0.8]];
    const dir = `${output}/.poses`;
    await mkdir(dir, { recursive: true });
    for (const [i, [name, t]] of poses.entries()) {
      await ev(page, ([n, t]) => probe.studio(n, t), [name, t]);
      await page.screenshot({ path: `${dir}/pose-${String(i).padStart(2, '0')}.png`, clip: { x: 470, y: 230, width: 340, height: 340 } });
    }
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', `${dir}/pose-%02d.png`, '-vf', 'scale=220:-1,tile=5x3', '-frames:v', '1', `${output}/thor-pose-sheet.png`]);
    await rm(dir, { recursive: true, force: true });
    report.shots.push('thor-pose-sheet');
    await page.context().close();
  }

  if (wanted('small')) {
    // A small map whose land meets the edge on one side: the ring runs on past the edge there.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }),
      page = await context.newPage();
    page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
    await page.goto(url);
    await page.evaluate(async () => {
      const [{ initializeWebCanvas }, { loadNativeFonts }, { WorldRenderer }, { Town }, { Traffic }, { Preview }, { Camera, project }, { Weather }, ring] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/packages/native-renderer/src/world-renderer.ts'),
        import('/packages/engine/src/town.ts'),
        import('/packages/engine/src/traffic.ts'),
        import('/packages/engine/src/game-tools.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/climate.ts'),
        import('/packages/native-renderer/src/serpent-ring.ts'),
      ]);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      document.body.append(element);
      const canvas = new tvg.Canvas(element, { width: 1280, height: 800, enableDevicePixelRatio: false }),
        renderer = new WorldRenderer(tvg),
        town = new Town(5, 96),
        traffic = new Traffic(5),
        map = town.map();
      await loadNativeFonts(tvg);
      canvas.add(renderer.scene());
      town.editHour(12);
      town.scout(map.width() / 2, map.height() / 2, map.width() * 2);
      for (let k = 0; k < 400; ++k) {
        const intensity = 0.8 + k * 0.0005;
        town.weather().force(Weather.Storm, intensity);
        if (ring.serpentEmergence(map.seed(), Weather.Storm, intensity, ring.weatherSpell(town.weather().snapshot().peak)) > 0.5) break;
      }
      let now = 0,
        camera = new Camera();
      const frame = (dt = 0.1) => {
        now += dt;
        town.time += dt;
        const preview = new Preview();
        preview.zoom = camera.zoom;
        renderer.update(town, traffic, camera, 1280, 800, now, preview, []);
        canvas.update().render();
      };
      const r = ring.serpentRing(map),
        parts = ring.serpentParts(r, map.seed(), ring.weatherSpell(town.weather().snapshot().peak));
      window.small = {
        whole() {
          const c = project(map.width() / 2, map.height() / 2);
          camera = new Camera(c.x, c.y + 60, 0.27);
          for (let i = 0; i < 120; ++i) frame(0.25);
        },
        edge() {
          const edge = parts.filter((p) => p.edge);
          for (let i = 0; i < 400; ++i) {
            const up = edge.find((p) => ring.partRise(p, r, 1, town.clock()) > 0.85);
            if (up) {
              const m = ring.partMiddle(up, r),
                c = project(m.x, m.y);
              camera = new Camera(c.x, c.y - 40, 0.6);
              for (let k = 0; k < 6; ++k) frame(0.05);
              return { edge: edge.length, at: m };
            }
            town.time += 0.5;
          }
          return { edge: edge.length, at: null };
        },
        count: () => ({ parts: parts.length, edge: parts.filter((p) => p.edge).length, beyond: [...r.beyond].filter(Boolean).length }),
      };
    });
    report.checks.small = await page.evaluate(() => small.count());
    await page.evaluate(() => small.whole());
    await shot(page, 'serpent-08-small-map-ring');
    report.checks.smallEdge = await page.evaluate(() => small.edge());
    assert.ok(report.checks.smallEdge.at, 'a coil at the map edge rises');
    await shot(page, 'serpent-09-small-map-edge');
    await context.close();
  }

  if (wanted('thor')) {
    const page = await open(1280, 800);
    // Arrival: the bolt and the guide card (the settlement's other first-time cards are heard first).
    await ev(page, () => { probe.look(probe.sites().origin, 1); probe.frames(10, 0.05, true); probe.dismiss(); });
    await ev(page, () => probe.arrive());
    await shot(page, 'thor-01-arrival-bolt');
    await ev(page, () => probe.frames(30, 0.05));
    assert.ok(await ev(page, () => probe.until('thor')), `the Thor card shows when he is in view: ${JSON.stringify(await ev(page, () => ({ told: probe.town.told, card: probe.guideCard(), queue: probe.game.guide.queue.map((e) => e.key), thor: probe.thor(), visible: probe.game.renderer.visible(probe.town.thor.position) })))}`);
    await shot(page, 'thor-02-guide-card-en');
    await ev(page, () => probe.korean(true));
    await ev(page, () => probe.frames(3));
    await shot(page, 'thor-03-guide-card-ko');
    await ev(page, () => probe.korean(false));
    await ev(page, () => probe.dismiss());
    // Daytime pastimes, each held still at a telling moment.
    const sites = await ev(page, () => probe.sites());
    const near = (p, dx, dy) => ({ x: p.x + dx, y: p.y + dy });
    await ev(page, ([a, o]) => { probe.hour(11); probe.look(a, 2.6); probe.pastime('Fireside', a, o, 3); }, [near(sites.origin, 1.4, 1.2), sites.origin]);
    await shot(page, 'thor-04-day-fireside');
    const worker = near(sites.origin, 3, 3.2);
    await ev(page, ([w, a]) => { probe.worker(w); probe.look(a, 2.6); probe.pastime('Watching', a, w, 0.7); }, [worker, near(worker, -1.2, 1.6)]);
    await shot(page, 'thor-05-day-watching');
    await ev(page, ([a]) => { probe.look(a, 2.6); probe.pastime('Lifting', a, null, 3); }, [near(sites.origin, 3, -3)]);
    await shot(page, 'thor-06-day-lifting');
    await ev(page, ([a]) => { probe.pastime('Lifting', a, null, 0.7); }, [near(sites.origin, 3, -3)]);
    await shot(page, 'thor-07-day-lifting-bend');
    if (sites.tavern) {
      await ev(page, ([a, t]) => { probe.look(a, 2.6); probe.pastime('Drinking', a, t, 1.1); }, [near(sites.tavern, 1.2, 2), sites.tavern]);
      await shot(page, 'thor-08-day-drinking');
    }
    await ev(page, ([a]) => { probe.look(a, 2.6); probe.pastime('Strolling', a, null, 0); }, [near(sites.origin, -3, -1)]);
    await shot(page, 'thor-09-day-strolling');
    // Inspector and name plate: hover him, then click.
    await ev(page, ([a]) => { probe.look(a, 2.6); probe.pastime('Strolling', a, null, 0); probe.frames(4); }, [near(sites.origin, 2, 2)]);
    const s = await ev(page, ([a]) => probe.screen({ x: a.x, y: a.y }), [near(sites.origin, 2, 2)]);
    await page.mouse.move(s.x, s.y - 30);
    await ev(page, () => probe.frames(4));
    await shot(page, 'thor-10-name-plate');
    await page.mouse.click(s.x, s.y - 30);
    await ev(page, () => probe.frames(4));
    await page.mouse.move(640, 760);
    await ev(page, () => probe.frames(4));
    await shot(page, 'thor-11-inspector');
    // The night hunt: raiders come in, he throws Mjolnir.
    const rules = await ev(page, () => probe.thorRules());
    await ev(page, () => { probe.game.selectedObjects = []; probe.dusk(); });
    await ev(page, ([a]) => probe.pastime('Strolling', a, null, 0), [near(sites.origin, 2, 2)]);
    await ev(page, ([d]) => probe.monsters(6, d), [near(sites.origin, 8, 6)]);
    await ev(page, ([a]) => probe.look(a, 2.2), [near(sites.origin, 5, 4.5)]);
    const flight = await ev(page, (p) => probe.untilThrow(p), rules.windup + rules.flight * 0.6);
    assert.ok(flight.throwAt >= 0, 'Thor throws at night');
    await shot(page, 'thor-12-night-hammer-flight');
    await ev(page, (p) => probe.untilThrow(p), rules.windup + rules.flight + 0.03);
    await shot(page, 'thor-13-night-hammer-strike');
    await ev(page, (p) => { probe.untilThrow(p); probe.look(probe.town.thor.position, 2); }, 0.1);
    await strip(page, 'thor-night-hunt', 84, () => { probe.town.advance(1 / 24); probe.frame(1 / 24); }, { x: 200, y: 120, width: 880, height: 560 });
    // What is heard when he strikes at night: the frames run live, as in play, so the game asks for its sounds.
    const hunted = await ev(page, () => {
      const t = probe.town.thor.position;
      probe.monsters(4, { x: t.x + 4, y: t.y + 3 });
      probe.game.paused = false;
      probe.look(t, 2);
      const since = probe.now;
      for (let i = 0; i < 160; ++i) probe.frame(1 / 30, true);
      return { since, bolts: probe.town.thor.bolts.filter((b) => b.kind === 1).length };
    });
    report.sound = { nightStrike: await ev(page, (since) => probe.listen(since, ['ThunderCrack', 'ThunderStrike', 'ThunderClap', 'ThunderRumble', 'Crush']), hunted.since) };
    assert.ok(report.sound.nightStrike.cues.some((c) => c.cue.startsWith('Thunder')), `thunder is asked for at a night strike: ${JSON.stringify(report.sound.nightStrike.cues)}`);
    assert.ok(report.sound.nightStrike.loudest > 0.005, `the night strike is heard: ${report.sound.nightStrike.loudest}`);
    // A storm with Thor present: lightning far more often.
    await ev(page, () => {
      probe.hour(13);
      probe.weather('Storm', 0.9);
      probe.town.thor.doing = 2;
      probe.town.beasts = [];
      // The fight may have paused the game for a fallen resident; the storm is heard only while time runs.
      for (const p of probe.town.folk) {
        p.downedAt = -1;
        p.health = Math.max(p.health, 0.8);
      }
      probe.game.paused = false;
    });
    await ev(page, ([a]) => probe.look(a, 1.4), [sites.origin]);
    const stormed = await ev(page, () => {
      const since = probe.now;
      let strikes = 0;
      for (let i = 0; i < 30 * 25 && strikes < 2; ++i) {
        const before = probe.game.renderer.strike;
        probe.frame(1 / 30, true);
        if (probe.game.renderer.strike && probe.game.renderer.strike !== before) ++strikes;
      }
      return { since, strikes, seconds: +(probe.now - since).toFixed(1), paused: probe.game.paused };
    });
    report.sound.storm = { ...stormed, ...(await ev(page, (since) => probe.listen(since, ['ThunderCrack', 'ThunderStrike', 'ThunderClap', 'ThunderRumble']), stormed.since)) };
    assert.ok(stormed.strikes >= 1, 'lightning strikes in the storm while he is here');
    assert.ok(report.sound.storm.loudest > 0.005, `the storm's thunder is heard: ${report.sound.storm.loudest}`);
    await ev(page, () => probe.live(2));
    await ev(page, () => { probe.strike(); probe.frame(0.02); });
    await shot(page, 'thor-14-storm');
    report.checks.thor = await ev(page, () => probe.thor());
    await page.context().close();
  }

  if (wanted('serpent')) {
    const page = await open(1280, 800);
    await ev(page, () => { probe.hour(12); probe.serpentStorm(); probe.frames(4); probe.drift(30, 0.5); });
    const info = await ev(page, () => probe.serpent());
    assert.ok(info && info.parts.length > 10, 'the serpent has a body round the land');
    report.checks.serpent = { emergence: info.emergence, points: info.points, parts: info.parts.length };
    const origin = (await ev(page, () => probe.sites())).origin;
    const coil = await ev(page, ([o]) => probe.rise('Coil', o), [origin]);
    assert.ok(coil, 'a coil near the settlement rises');
    const up = [coil];
    await shot(page, 'serpent-01-coils-storm');
    // A lightning flash shows the body dark against it.
    await ev(page, () => { probe.strike(); probe.frame(0.03); });
    await shot(page, 'serpent-02-coils-flash');
    await ev(page, () => probe.frames(20, 0.05));
    const head = await ev(page, ([o]) => probe.rise('Head', o), [origin]);
    assert.ok(head, 'the head rises');
    await shot(page, 'serpent-03-head-and-tail');
    // The guide card the first time it is seen.
    await ev(page, ([p]) => { probe.look(p, 1); probe.frames(4); }, [up[0].mid]);
    const card = await ev(page, () => probe.until('serpent'));
    assert.ok(card, 'the serpent card shows');
    await shot(page, 'serpent-04-guide-card');
    await ev(page, () => probe.dismiss());
    // Zoomed out over the whole land: the parts read as one ring.
    await ev(page, () => { const m = probe.town.map(); probe.look({ x: m.width() / 2, y: m.height() / 2 }, 0.2); probe.frames(6); });
    await shot(page, 'serpent-05-ring-zoomed-out');
    report.cost.zoomedOut = await ev(page, () => ({ ms: probe.cost(), shapes: probe.serpentShapes() }));
    await ev(page, ([p]) => { probe.look(p, 1); probe.frames(4); }, [up[0].mid]);
    report.cost.coil = await ev(page, () => ({ ms: probe.cost(), shapes: probe.serpentShapes() }));
    // The same sea in clear weather.
    await ev(page, () => { probe.hour(12); probe.drift(30, 0.5); });
    await shot(page, 'serpent-06-same-sea-clear');
    report.cost.coilClear = await ev(page, () => ({ ms: probe.cost(), shapes: probe.serpentShapes() }));
    await ev(page, () => { const m = probe.town.map(); probe.look({ x: m.width() / 2, y: m.height() / 2 }, 0.2); probe.frames(6); });
    report.cost.zoomedOutClear = await ev(page, () => ({ ms: probe.cost(), shapes: probe.serpentShapes() }));
    // Rising: a strip from a clear sky into the storm.
    await ev(page, ([p]) => { probe.serpentStorm(); probe.look(p, 0.9); probe.frames(2); }, [up[0].mid]);
    await strip(page, 'serpent-rising', 72, () => { probe.drift(0.35, 0.35); }, { x: 140, y: 100, width: 1000, height: 600 });
    await page.context().close();
    // A phone.
    const phone = await open(390, 844);
    await ev(phone, () => { probe.hour(12); probe.serpentStorm(); probe.frames(4); probe.drift(30, 0.5); probe.dismiss(); });
    await ev(phone, ([o]) => { probe.rise('Coil', o); probe.game.camera.zoom = 0.8; probe.frames(6); probe.dismiss(); probe.frames(2); }, [origin]);
    await shot(phone, 'serpent-07-phone');
    await phone.context().close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  // Before-and-after rows for the fixes after the first review; `before/` holds the pictures from before them.
  const fixes = [
    ['2. The night strike is the brightest thing at night', ['thor-13-night-hammer-strike.png', 'thor-12-night-hammer-flight.png', 'thor-night-hunt.gif']],
    ['3. A brushed, forked bolt instead of a geometric zigzag', ['thor-01-arrival-bolt.png', 'thor-13-night-hammer-strike.png']],
    ['4. A near-black silhouette against the lightning flash', ['serpent-02-coils-flash.png']],
    ['5. The ring closes: the tail tip in the jaws', ['serpent-03-head-and-tail.png']],
    ['6. A whole ring on a small map; past the edge where land meets it (top-down: loop, coils, head; cyan = coil at the edge)', [['ring-96-before.png', 'ring-96-after.png'], ['', 'serpent-08-small-map-ring.png'], ['', 'serpent-09-small-map-edge.png']]],
    ['7. No lit ovals round the coils under the veil', ['serpent-01-coils-storm.png', 'serpent-05-ring-zoomed-out.png']],
  ];
  const cell = (src) => (src ? `<figure><img src="${src}" alt="${src}"><figcaption>${src}</figcaption></figure>` : '<figure></figure>');
  const rows = fixes
    .map(([title, pairs]) => `<h2>${title}</h2>${pairs.map((p) => `<div class="pair">${Array.isArray(p) ? cell(p[0]) + cell(p[1]) : cell(`before/${p}`) + cell(p)}</div>`).join('')}`)
    .join('');
  const pics = [...report.shots.map((n) => `${n}.png`), ...report.gifs.map((n) => `${n}.gif`)];
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Thor and Jormungandr</title><style>body{margin:0;padding:16px;background:#14181c;color:#ddd;font:14px sans-serif}figure{display:inline-block;margin:8px;vertical-align:top;min-width:200px}img{max-width:620px;display:block}figcaption{padding:4px 0}.pair{display:flex;flex-wrap:wrap}h2{font-size:16px;margin:24px 8px 0}</style></head><body><h1>Thor and Jormungandr</h1><p>GPU: ${report.gpu ?? '?'} · frame cost ${JSON.stringify(report.cost)}</p><p>Sound: ${JSON.stringify({ night: report.sound?.nightStrike && { cues: report.sound.nightStrike.cues.map((c) => c.cue), groups: report.sound.nightStrike.groups, loudest: report.sound.nightStrike.loudest }, storm: report.sound?.storm && { strikes: report.sound.storm.strikes, seconds: report.sound.storm.seconds, groups: report.sound.storm.groups, loudest: report.sound.storm.loudest } })}</p><h1>Before and after (left before, right after)</h1>${rows}<h1>Every picture</h1>${pics.map((p) => cell(p)).join('')}</body></html>`,
  );
  console.log(JSON.stringify({ passed: report.passed, errors: report.errors, cost: report.cost, checks: report.checks }, null, 2));
}
