// The title preview over a long simulated session in a hidden browser: a screenshot every so often, what the
// camera was on, and the frame cost. node tests/regression/title-player.browser.mjs [titleSeconds] [shotEvery] [outDir] [cost]
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const total = Number(process.argv[2] ?? 1800),
  every = Number(process.argv[3] ?? 60),
  out = process.argv[4] ?? 'artifacts/regression/title-player',
  measure = process.argv[5] === 'cost';
mkdirSync(out, { recursive: true });
let server, browser;
const log = [];
try {
  server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`,
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${origin}/?test&renderer=gl`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => !!window.goldfantasy, null, { timeout: 120000, polling: 100 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2'),
      ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('GPU:', gpu);
  await page.evaluate(() => {
    const g = window.goldfantasy;
    g.host.stop();
    window.titleClock = 1;
    window.titleSample = () => {
      const app = g.app,
        preview = app.preview,
        town = preview?.state(),
        view = preview?.view(),
        play = app.titlePlay,
        subject = play ? play.subject?.() : town?.titleAutoplaySubject?.(),
        focus = play?.director?.focusLabel?.() ?? '';
      const residents = town ? town.people().filter((p) => p.role === 0 && p.faction === 0 && p.health > 0) : [];
      return {
        clock: Math.round(town?.clock() ?? 0),
        day: +((town?.clock() ?? 0) / 300).toFixed(2),
        population: residents.length,
        camera: view ? { x: Math.round(view.x), y: Math.round(view.y), zoom: +view.zoom.toFixed(2) } : null,
        subject: subject ? { id: subject.id, name: subject.name, x: +subject.position.x.toFixed(1), y: +subject.position.y.toFixed(1), inside: subject.inside, health: +subject.health.toFixed(2) } : null,
        focus,
        realm: town?.realmActive?.() ?? false,
        night: +(town?.climate().night ?? 0).toFixed(2),
        goal: play?.player?.goalTitle?.() ?? '',
        sent: play?.player?.party?.sent ?? 0,
        cleared: play?.player?.party?.cleared ?? 0,
        seed: play?.player?.seed ?? -1,
        note: play?.player?.party?.note ?? '',
      };
    };
    window.titleLuma = () => {
      const canvas = document.querySelector('#world'),
        small = document.createElement('canvas');
      small.width = 96;
      small.height = 54;
      const c = small.getContext('2d');
      c.drawImage(canvas, 0, 0, 96, 54);
      const d = c.getImageData(0, 0, 96, 54).data;
      let sum = 0,
        sq = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l;
        sq += l * l;
      }
      const n = d.length / 4,
        mean = sum / n;
      return { mean: +mean.toFixed(1), spread: +Math.sqrt(Math.max(0, sq / n - mean * mean)).toFixed(1) };
    };
    // Frames of 0.1 s of title time, as the scene clamps them.
    window.titleFrames = (n) => {
      const g2 = window.goldfantasy,
        started = performance.now();
      let worst = 0;
      for (let i = 0; i < n; ++i) {
        const t0 = performance.now();
        g2.host.render((window.titleClock += 0.1));
        worst = Math.max(worst, performance.now() - t0);
      }
      return { mean: (performance.now() - started) / n, worst };
    };
    window.titleShot = () => {
      g.host.render((window.titleClock += 0.1));
      return window.titleLuma();
    };
  });
  const measureCost = async (label) => {
    // Real-time frames: the scene's own dt of one sixtieth, all through the host (GPU included).
    const cost = await page.evaluate(async () => {
      const g = window.goldfantasy,
        times = [];
      for (let i = 0; i < 600; ++i) {
        const t0 = performance.now();
        g.host.render((window.titleClock += 1 / 60));
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { mean: times.reduce((s, t) => s + t, 0) / times.length, p50: times[300], p95: times[570], worst: times.at(-1) };
    });
    console.log(`frame cost ${label} (ms):`, JSON.stringify(cost));
    return cost;
  };
  const costs = {};
  if (measure) costs.start = await measureCost('at the start');
  let shot = 0,
    realmShots = 0;
  // Every `every` seconds, and every 15 s while the party is beyond a gate.
  for (let t = 0; t <= total; t += 15) {
    const cost = await page.evaluate((n) => window.titleFrames(n), t === 0 ? 1 : 150),
      peek = await page.evaluate(() => window.titleSample());
    if (t % every !== 0 && !(peek.realm && realmShots++ < 40)) continue;
    const luma = await page.evaluate(() => window.titleShot()),
      sample = await page.evaluate(() => window.titleSample()),
      file = `shot-${String(shot++).padStart(3, '0')}.png`;
    await page.screenshot({ path: `${out}/${file}` });
    const entry = { t, file, luma, cost: +cost.mean.toFixed(2), ...sample };
    log.push(entry);
    console.log(JSON.stringify(entry));
  }
  if (measure) costs.end = await measureCost('at the end');
  writeFileSync(`${out}/log.json`, JSON.stringify({ gpu, errors, costs, log }, null, 1));
  const rows = log
    .map(
      (e) =>
        `<figure><img src="${e.file}" loading="lazy"><figcaption>t=${e.t}s day ${e.day} pop ${e.population} · ${e.focus || (e.subject ? 'following ' + e.subject.name : 'no subject')}${e.realm ? ' · beyond a gate' : ''} · parties ${e.sent}/${e.cleared} · luma ${e.luma.mean}/${e.luma.spread}${e.goal ? ' · ' + e.goal : ''}</figcaption></figure>`,
    )
    .join('\n');
  writeFileSync(
    `${out}/index.html`,
    `<!doctype html><meta charset="utf-8"><title>Title player strip</title><style>body{background:#1d1f1b;color:#e8e0cc;font:13px sans-serif;margin:16px}figure{display:inline-block;margin:6px;width:420px}img{width:420px}</style><h1>Title preview, ${total} s of title time</h1><p>GPU: ${gpu}. Errors: ${errors.length}</p>${rows}`,
  );
  if (errors.length) console.log('ERRORS', errors.slice(0, 10));
  await context.close();
} finally {
  await browser?.close();
  await server?.close();
}
