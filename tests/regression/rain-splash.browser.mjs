import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Pictures and frame cost of rain splashing on land and water; RAIN_SPLASH_OUT overrides the folder.
const output = process.env.RAIN_SPLASH_OUT ?? 'artifacts/regression/rain-splash';
const report = { errors: [], shots: [], cost: {} };
let server, browser;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'rain-splash-validation',
        configureServer(vite) {
          vite.middlewares.use('/rain-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rain</title></head><body style="margin:0"></body></html>');
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
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/rain-probe`);
  const places = await page.evaluate(async () => {
    const [{ initializeWebCanvas }, { loadNativeFonts }, { WorldRenderer }, { Town }, { Traffic }, { Preview }, { Camera, project }, { Building }, { Structure }, { Terrain }, { sharpAnchor }, splash] =
      await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/packages/native-renderer/src/world-renderer.ts'),
        import('/packages/engine/src/town.ts'),
        import('/packages/engine/src/traffic.ts'),
        import('/packages/engine/src/game-tools.ts'),
        import('/packages/engine/src/geometry.ts'),
        import('/packages/engine/src/town-models.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/world-types.ts'),
        import('/packages/engine/src/road-network.ts'),
        import('/packages/native-renderer/src/rain-splash.ts'),
      ]);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    document.body.append(element);
    const canvas = new tvg.Canvas(element, { width: 1280, height: 800, enableDevicePixelRatio: false }),
      renderer = new WorldRenderer(tvg),
      traffic = new Traffic(5),
      town = new Town(5);
    await loadNativeFonts(tvg);
    renderer.reducedMotion = false;
    const map = town.map(),
      origin = map.camp();
    const camp = new Building(0, Structure.Camp, origin, 0, 0);
    const cottage = new Building(1, Structure.Cottage, { x: origin.x - 3, y: origin.y + 1 }, 0, 0);
    camp.village = cottage.village = 0;
    town.placed.push(camp, cottage);
    town.nextId = 2;
    town.foundSettlement(0);
    town.buildRoad([sharpAnchor({ x: origin.x - 1, y: origin.y + 3.5 }), sharpAnchor({ x: origin.x - 6, y: origin.y + 6 })]);
    town.scout(map.width() / 2, map.height() / 2, map.width());
    let camera = new Camera();
    const ground = { terrainAt: (p) => map.terrainAt(p), buildingAt: (p) => town.buildingAt(p) };
    window.rain = {
      now: 0,
      frame(dt = 1 / 60) {
        this.now += dt;
        const preview = new Preview();
        preview.zoom = camera.zoom;
        renderer.update(town, traffic, camera, 1280, 800, this.now, preview, []);
        renderer.fog.opacity(0);
        renderer.adapter.sync(renderer.root);
        canvas.update().render();
      },
      set(x, y, zoom, weather, intensity) {
        const at = project(x, y);
        camera = new Camera(at.x, at.y, zoom);
        town.editHour(11);
        const c = town.climate();
        c.weather = weather;
        c.intensity = intensity;
        c.snow = weather === 4 ? 0.9 : 0;
        town.changes++;
        this.frame(30);
        for (let i = 0; i < 4; ++i) this.frame();
      },
      // Median ms of the splash rebuild alone, and of the render with the layer shown and hidden.
      cost(frames = 120) {
        const median = (list) => +list.sort((a, b) => a - b)[Math.floor(list.length / 2)].toFixed(3);
        const build = [],
          drawn = [];
        for (let i = 0; i < frames; ++i) {
          this.now += 1 / 60;
          const t0 = performance.now();
          const n = splash.paintSplashes(renderer, ground, this.now);
          if (n >= 0) {
            build.push(performance.now() - t0);
            drawn.push(n);
          }
        }
        const render = (shown) => {
          const list = [];
          renderer.splashes.opacity(shown ? 255 : 0);
          for (let i = 0; i < frames; ++i) {
            const t0 = performance.now();
            this.frame();
            renderer.splashes.opacity(shown ? 255 : 0);
            renderer.adapter.sync(renderer.root);
            canvas.update().render();
            list.push(performance.now() - t0);
          }
          return median(list);
        };
        const off = render(false),
          on = render(true),
          off2 = render(false),
          on2 = render(true);
        renderer.splashes.opacity(255);
        return { rebuildMs: median(build), splashes: median(drawn), frameOffMs: Math.min(off, off2), frameOnMs: Math.min(on, on2) };
      },
    };
    canvas.add(renderer.scene());
    for (let i = 0; i < 4; ++i) window.rain.frame();
    let lake = null;
    for (let y = 2; y < map.height() - 2 && !lake; ++y)
      for (let x = 2; x < map.width() - 2 && !lake; ++x) {
        if (map.at(x, y).terrain !== Terrain.Water) continue;
        let n = 0;
        for (let dy = -2; dy <= 2; ++dy) for (let dx = -2; dx <= 2; ++dx) n += map.at(x + dx, y + dy).terrain === Terrain.Water;
        if (n >= 22 && Math.hypot(x - map.hvergelmir().x, y - map.hvergelmir().y) > 12) lake = { x: x + 0.5, y: y + 0.5 };
      }
    let grass = null;
    for (let r = 6; r < 30 && !grass; ++r)
      for (let a = 0; a < 16 && !grass; ++a) {
        const x = Math.round(origin.x + r * Math.cos(a)),
          y = Math.round(origin.y + r * Math.sin(a));
        let ok = true;
        for (let dy = -3; dy <= 3; ++dy)
          for (let dx = -3; dx <= 3; ++dx) {
            const t = map.at(x + dx, y + dy).terrain;
            if ((t !== Terrain.Grass && t !== Terrain.Meadow) || map.at(x + dx, y + dy).trees) ok = false;
          }
        if (ok) grass = { x, y };
      }
    return { camp: origin, lake, grass: grass ?? origin, road: { x: origin.x - 3.5, y: origin.y + 4.8 }, cottage: { x: origin.x - 3, y: origin.y + 1 } };
  });
  const shot = async (name, p, zoom, weather, intensity, title) => {
    await page.evaluate(({ p, zoom, weather, intensity }) => window.rain.set(p.x, p.y, zoom, weather, intensity), { p, zoom, weather, intensity });
    const path = `${output}/${name}.png`;
    await page.screenshot({ path });
    report.shots.push({ file: `${name}.png`, title });
  };
  const Rain = 2,
    Storm = 3,
    Snow = 4;
  await shot('grass', places.grass, 2, Rain, 0.6, 'Rain on grass, zoom 2');
  await shot('road', places.road, 2, Rain, 0.6, 'Rain on a road, zoom 2');
  await shot('building', places.cottage, 1.6, Rain, 0.6, 'Rain beside a cottage, zoom 1.6');
  if (places.lake) await shot('lake', places.lake, 2, Rain, 0.6, 'Rain on a lake, zoom 2');
  await shot('storm', places.camp, 1.6, Storm, 1, 'Storm, zoom 1.6');
  await shot('zoom-in', places.grass, 3.2, Rain, 0.8, 'Rain zoomed in, zoom 3.2');
  await shot('zoom-out', places.camp, 0.5, Rain, 0.8, 'Rain zoomed out, zoom 0.5 (thin)');
  await shot('snow', places.grass, 2, Snow, 0.8, 'Snow: no splashes');
  await shot('clear', places.grass, 2, 0, 0, 'Clear: no splashes');
  for (let i = 0; i < 6; ++i) {
    if (i === 0) await page.evaluate(({ p }) => window.rain.set(p.x, p.y, 3, 2, 0.8), { p: places.lake ?? places.grass });
    else await page.evaluate(() => { for (let k = 0; k < 4; ++k) window.rain.frame(); });
    const name = `strip-${i}`;
    await page.screenshot({ path: `${output}/${name}.png`, clip: { x: 340, y: 200, width: 600, height: 400 } });
    report.shots.push({ file: `${name}.png`, title: `Frame strip ${i} (1/15 s apart), lake edge zoom 3` });
  }
  for (const [label, weather, intensity, zoom] of [['rain zoom 1.6', Rain, 0.6, 1.6], ['storm zoom 1.6', Storm, 1, 1.6], ['storm zoom 1', Storm, 1, 1]]) {
    await page.evaluate(({ p, zoom, weather, intensity }) => window.rain.set(p.x, p.y, zoom, weather, intensity), { p: places.camp, zoom, weather, intensity });
    report.cost[label] = await page.evaluate(() => window.rain.cost());
  }
  const cards = report.shots.map((s) => `<figure><img src="${s.file}" alt="${s.title}"><figcaption>${s.title}</figcaption></figure>`).join('\n');
  await writeFile(
    `${output}/index.html`,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rain splashes</title><style>body{margin:16px;background:#14181c;color:#dde;font:14px sans-serif}figure{display:inline-block;margin:8px;max-width:100%}img{max-width:640px;width:100%}</style></head><body><h1>Rain splashes</h1><pre>${JSON.stringify(report.cost, null, 2)}</pre>${cards}</body></html>`,
  );
  console.log(JSON.stringify(report, null, 1));
} finally {
  await browser?.close();
  await server?.close();
}
