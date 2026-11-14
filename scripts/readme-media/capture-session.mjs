// The browser, server and GIF assembly every README capture shares. Headless Chromium on the real GPU, muted,
// on its own Vite server (port 0); frames come from the game's own renderer.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, rename, rm, stat, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

export const root = resolve(import.meta.dirname, '../..');
export const mediaFolder = resolve(root, '.github/media');
export const workFolder = resolve(root, 'artifacts/readme-media');
/**
 * MEDIA_VIDEO_FPS=30 runs the same scenes for the presentation page instead: frames at that rate, the game's own
 * sound mixed offline for the span, and an MP4 in public/docs. Nothing in .github/media is touched then.
 */
export const videoFps = Number(process.env.MEDIA_VIDEO_FPS || 0);
const videoFolder = resolve(root, 'public/docs');

export async function startSession() {
  const errors = [];
  const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'readme-media',
        configureServer(vite) {
          vite.middlewares.use('/readme-media', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>README media</title></head><body style="margin:0;background:#11191c;overflow:hidden"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  const browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  return {
    errors,
    base,
    /** A blank page on the capture server, or a game URL such as `/?test&seed=5`. */
    async page(width, height, path = '/readme-media') {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
      await page.goto(base + path, { timeout: 120000 });
      return page;
    },
    async close() {
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

/**
 * Boots the game in the page as the browser walks in tests/regression do: one preview game of seed `seed`, its
 * world and (unless `hud` is false) its HUD on a canvas of the page's size. Leaves `window.media` with helpers.
 */
export async function bootGame(page, { width, height, seed = 5, hud = true }) {
  const rate = videoFps ? videoFps / 12 : 1;
  await page.evaluate(
    async ({ width, height, seed, hud, rate }) => {
      const [
        { initializeWebCanvas },
        ui,
        { BrowserFiles },
        { createNativeServices },
        engine,
        guide,
        localization,
        gameTools,
        carried,
      ] = await Promise.all([
        import('/apps/web/src/native/startup-canvas.ts'),
        import('/packages/native-ui/src/index.ts'),
        import('/apps/web/src/native/browser-files.ts'),
        import('/apps/web/src/native/bootstrap.ts'),
        import('/packages/engine/src/index.ts'),
        import('/apps/web/src/native/game-guide.ts'),
        import('/packages/localization/src/index.ts'),
        import('/packages/engine/src/game-tools.ts'),
        import('/packages/engine/src/carried-resources.ts'),
      ]);
      // The first-time guide is captured on purpose in one clip only.
      (await import('/apps/web/src/native/guide-preferences.ts')).setGuidePreference('cards', false);
      const tvg = await initializeWebCanvas('gl'),
        element = document.createElement('canvas');
      element.style.cssText = `display:block;width:${width}px;height:${height}px`;
      document.body.append(element);
      const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
        fonts = await ui.loadNativeFonts(tvg),
        files = await BrowserFiles.open(`readme-media-${width}x${height}`),
        game = createNativeServices(tvg, fonts, files).createPreview(seed);
      game.town.awaiting = false;
      canvas.add(game.worldScene());
      if (hud) canvas.add(game.hudScene());
      const E = { ...engine, ...carried, ...gameTools };
      window.media = {
        E,
        ui,
        tvg,
        fonts,
        canvas,
        game,
        guide,
        localization,
        gameTools,
        width,
        height,
        now: 0,
        /** Seconds per recorded frame (1/12 for the GIFs) and how many recorded frames stand for one GIF frame. */
        dt: 1 / (12 * rate),
        rate,
        /** Every sound the game asked for, with the presentation time it was asked at. */
        heard: [],
        ambient: [],
        get town() {
          return game.town;
        },
        /** One drawn frame; `simulate` lets the game advance its own world by `dt` as in play. */
        frame(dt = 0.05, simulate = false) {
          this.now += dt;
          game.render(width, height, this.now, simulate, dt, this.now);
          canvas.update().render();
          game.worldPresented(1);
          for (const sound of game.takeCues()) this.heard.push({ sound, at: this.now });
          if (this.heard.length > 4000) this.heard.splice(0, this.heard.length - 4000);
          // For the videos: the background the game would set for this view (rain, wind, birds, woods, a swarm).
          if (rate !== 1 || this.keepAmbience) {
            this.ambient.push({ at: this.now, mix: game.ambience() });
            if (this.ambient.length > 8000) this.ambient.splice(0, this.ambient.length - 8000);
          }
        },
        /**
         * One step of play: in the GIFs the world is advanced by hand and drawn; in the videos the game runs it on
         * the drawn frame, as in play, so it also asks for the sounds of what happens.
         */
        step(dt) {
          if (rate === 1) {
            game.town.advance(dt);
            game.dispatchWork();
            this.frame(dt);
          } else this.frame(dt, true);
        },
        /**
         * The heard sounds and the background from `from` to `to`, mixed by the game's own sound board into `seconds`
         * of interleaved stereo at 44.1 kHz (a time-lapse is squeezed: its sounds come closer together).
         */
        async mix(from, to, seconds = to - from) {
          const [{ SoundBoard }, { sounds }] = await Promise.all([
            import('/packages/native-audio/src/sound-board.ts'),
            import('/packages/native-audio/src/sound-library.ts'),
          ]);
          await sounds.loadEffects();
          const board = new SoundBoard(),
            rate = 44100,
            squeeze = (to - from) / seconds,
            total = Math.max(1, Math.round(seconds * rate)),
            out = new Int16Array(total * 2),
            events = [
              ...this.heard.filter((h) => h.at >= from && h.at < to).map((h) => ({ at: h.at, play: h.sound })),
              ...this.ambient.filter((h) => h.at >= from && h.at < to).map((h) => ({ at: h.at, set: h.mix })),
            ].sort((a, b) => a.at - b.at);
          // The background glides in; start it two seconds early and keep only what follows.
          const first = this.ambient.find((h) => h.at >= from);
          if (first) board.setAmbience(first.mix);
          const scratch = new Float32Array(441 * 2);
          for (let k = 0; k < 200; ++k) board.render(scratch, 441);
          let done = 0;
          const render = (until) => {
            while (done < Math.min(until, total)) {
              const n = Math.min(441, Math.min(until, total) - done),
                pcm = new Float32Array(n * 2);
              board.render(pcm, n);
              for (let k = 0; k < n * 2; ++k) out[done * 2 + k] = Math.max(-32768, Math.min(32767, Math.round(pcm[k] * 32767)));
              done += n;
            }
          };
          let cues = 0;
          for (const e of events) {
            render(Math.round(((e.at - from) / squeeze) * rate));
            if (e.play) {
              board.play(e.play);
              ++cues;
            } else board.setAmbience(e.set);
          }
          render(total);
          let peak = 0;
          for (let k = 0; k < out.length; ++k) peak = Math.max(peak, Math.abs(out[k]));
          let text = '';
          const bytes = new Uint8Array(out.buffer);
          for (let k = 0; k < bytes.length; k += 32768) text += String.fromCharCode(...bytes.subarray(k, k + 32768));
          return { cues, peak: peak / 32767, pcm: btoa(text) };
        },
        frames(count, dt = 0.05, simulate = false) {
          for (let i = 0; i < count; ++i) this.frame(dt, simulate);
        },
        /** Runs the world `seconds` without drawing (orders and work dispatched as in play), then catches up. */
        live(seconds, until = () => false, step = 0.1) {
          for (let t = 0; t < seconds && !until(); t += step) {
            game.town.advance(step);
            game.dispatchWork();
          }
          this.frames(3);
        },
        look(at, zoom = game.camera.zoom) {
          const s = E.project(at.x, at.y);
          game.camera = new E.Camera(s.x, s.y, zoom);
          game.invalidatePresentation?.();
        },
        screen(at) {
          return game.camera.toScreen(E.project(at.x, at.y), width, height);
        },
        /** Clear sky at hour `h`. */
        hour(h) {
          game.town.editHour(h);
          game.town.weather().force(E.Weather.Clear, 0);
          game.town.changes++;
        },
        controls() {
          return game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled }));
        },
        quiet() {
          while (game.town.takeNotice?.()) {
            /* Setup notices are not part of the picture. */
          }
          game.town.notices?.splice?.(0);
          game.notice = '';
          game.noticeUntil = 0;
          game.status = '';
        },
        /** A caption over the picture (a page element, so it is sharp and never part of the game's HUD). */
        label(key, text, x, y) {
          let div = document.getElementById(`media-label-${key}`);
          if (!div) {
            div = document.createElement('div');
            div.id = `media-label-${key}`;
            div.style.cssText =
              'position:absolute;transform:translate(-50%,-50%);padding:4px 9px;border-radius:4px;background:rgba(27,34,38,.84);color:#f2ead8;font:600 15px DejaVu Sans,Verdana,sans-serif;white-space:nowrap;pointer-events:none';
            document.body.append(div);
          }
          div.textContent = text;
          div.style.left = `${Math.round(x)}px`;
          div.style.top = `${Math.round(y)}px`;
          div.style.display = text ? 'block' : 'none';
        },
        async korean(on) {
          if (on) await ui.loadKoreanFont(tvg, fonts);
          localization.setLocale(on ? 'KR' : 'ENG');
          game.invalidatePresentation?.();
        },
      };
      const pointer = (e) => ({ x: e.clientX, y: e.clientY, button: e.button === 2 ? 1 : 0 });
      element.addEventListener('pointermove', (e) => game.pointerMove(e.clientX, e.clientY));
      element.addEventListener('pointerdown', (e) => game.pointerDown(pointer(e).x, pointer(e).y, pointer(e).button));
      element.addEventListener('pointerup', (e) => game.pointerUp(pointer(e).x, pointer(e).y, pointer(e).button));
      element.addEventListener('contextmenu', (e) => e.preventDefault());
      window.media.frames(6);
    },
    { width, height, seed, hud, rate },
  );
}

const ffmpeg = (args) => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || 'ffmpeg failed');
};

/**
 * Records up to `count` frames, calling `step(i, arg)` in the page before each screenshot (a step that returns
 * true ends the recording after that frame), and assembles `.github/media/midgard-<name>.gif`. `keep` thins a long
 * recording to that many evenly spaced frames; `last` keeps only that many frames from the end. Also writes a four-frame contact sheet to artifacts/readme-media/review.
 */
export async function recordGif(page, name, { count, step, arg, clip, keep, last, ...gif }) {
  const rate = videoFps ? videoFps / 12 : 1,
    base = resolve(workFolder, videoFps ? 'video-frames' : 'frames'),
    folder = resolve(base, name),
    raw = keep || last ? resolve(base, `${name}.raw`) : folder,
    times = [];
  await rm(folder, { recursive: true, force: true });
  await rm(raw, { recursive: true, force: true });
  await mkdir(raw, { recursive: true });
  let recorded = 0;
  for (let i = 0; i < Math.round(count * rate); ++i) {
    // A step may return `{ done, clip }` to move the crop with the action.
    const result = await page.evaluate(step, [i, arg]),
      done = result === true || result?.done === true,
      area = result?.clip ?? clip;
    await page.screenshot({ path: resolve(raw, `${String(i).padStart(4, '0')}.png`), ...(area ? { clip: area } : {}) });
    times.push(await page.evaluate(() => (typeof media === 'undefined' ? 0 : media.now)));
    recorded = i + 1;
    if (i % 30 === 0) process.stdout.write(`  ${name}: frame ${i}/${Math.round(count * rate)}\n`);
    if (done === true) break;
  }
  let kept = times;
  if (last) {
    await mkdir(folder, { recursive: true });
    const from = Math.max(0, recorded - Math.round(last * rate));
    for (let k = from; k < recorded; ++k)
      await copyFile(resolve(raw, `${String(k).padStart(4, '0')}.png`), resolve(folder, `${String(k - from).padStart(4, '0')}.png`));
    await rm(raw, { recursive: true, force: true });
    kept = times.slice(from);
  } else if (keep && recorded > keep * rate) {
    await mkdir(folder, { recursive: true });
    const n = Math.round(keep * rate);
    kept = [];
    for (let k = 0; k < n; ++k) {
      const from = Math.round((k * (recorded - 1)) / (n - 1));
      await copyFile(resolve(raw, `${String(from).padStart(4, '0')}.png`), resolve(folder, `${String(k).padStart(4, '0')}.png`));
      kept.push(times[from]);
    }
    await rm(raw, { recursive: true, force: true });
  } else if (keep) await rename(raw, folder);
  if (videoFps) return { ...(await videoOf(page, name, folder, kept, gif.width)), recorded };
  return { ...(await assembleGif(name, gif)), recorded };
}

/** The presentation video of a recording: H.264, with the game's own sound when the clip runs at the pace of play. */
async function videoOf(page, name, folder, times, width = 720) {
  await mkdir(videoFolder, { recursive: true });
  const out = resolve(videoFolder, `${name}.mp4`),
    args = ['-framerate', String(videoFps), '-i', resolve(folder, '%04d.png')];
  let cues = 0;
  // What the game asked to play over the recorded span, squeezed to the clip's length when it is a time-lapse.
  let peak = 0;
  if (times?.length) {
    const seconds = times.length / videoFps,
      mixed = await page.evaluate(([from, to, seconds]) => media.mix(from, to, seconds), [times[0], times.at(-1) + (times.at(-1) - times[0]) / Math.max(1, times.length - 1), seconds]);
    cues = mixed.cues;
    peak = mixed.peak;
    if (peak > 0.002) {
      const pcm = Buffer.from(mixed.pcm, 'base64'),
        header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + pcm.length, 4);
      header.write('WAVEfmt ', 8);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(2, 22);
      header.writeUInt32LE(44100, 24);
      header.writeUInt32LE(44100 * 4, 28);
      header.writeUInt16LE(4, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36);
      header.writeUInt32LE(pcm.length, 40);
      const wav = resolve(folder, 'sound.wav');
      await writeFile(wav, Buffer.concat([header, pcm]));
      args.push('-i', wav);
    }
  }
  args.push('-vf', `scale=${Math.max(width, 1280)}:-2:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart');
  const sound = peak > 0.002;
  if (sound) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  else args.push('-an');
  ffmpeg([...args, out]);
  ffmpeg(['-i', out, '-vf', 'select=eq(n\\,0)', '-frames:v', '1', '-q:v', '4', resolve(videoFolder, `${name}.jpg`)]);
  return { file: `docs/${name}.mp4`, bytes: (await stat(out)).size, fps: videoFps, sound, cues, peak: +peak.toFixed(3) };
}

/** Turns the frames in artifacts/readme-media/frames/<name> into the README GIF. */
export async function assembleGif(name, { fps = 12, width = 720, colors = 160, dither = 'none', labels = [] } = {}) {
  const folder = resolve(workFolder, 'frames', name),
    count = (await readdir(folder)).filter((f) => f.endsWith('.png')).length,
    path = resolve(mediaFolder, `midgard-${name}.gif`),
    use = dither === 'none' ? 'dither=none' : `dither=${dither}:bayer_scale=4`;
  await mkdir(mediaFolder, { recursive: true });
  ffmpeg([
    '-framerate',
    String(fps),
    '-i',
    resolve(folder, '%04d.png'),
    '-filter_complex',
    `[0:v]${labels.map(labelFilter).join('')}scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=${use}:diff_mode=rectangle`,
    '-loop',
    '0',
    path,
  ]);
  await reviewSheet(name, count);
  const bytes = (await stat(path)).size;
  return { file: `midgard-${name}.gif`, frames: count, fps, seconds: +(count / fps).toFixed(1), width, bytes };
}

const labelFont = resolve(root, 'public/assets/native-fonts/DejaVuSans-Bold.ttf').replace(/:/g, '\\:');
/** A short plain caption burnt into the frames, in the game's label style, centred on (x, y) of the source frame. */
const labelFilter = ({ text, x, y, size = 18 }) =>
  `drawtext=fontfile='${labelFont}':text='${text.replace(/'/g, '')}':fontsize=${size}:fontcolor=0xF2EAD8:box=1:boxcolor=0x1B2226@0.82:boxborderw=8:x=${Math.round(x)}-tw/2:y=${Math.round(y)}-th/2,`;

/** Four frames of a GIF side by side, to look at. */
async function reviewSheet(name, count) {
  const review = resolve(workFolder, 'review');
  await mkdir(review, { recursive: true });
  const picks = [0, Math.floor(count / 3), Math.floor((2 * count) / 3), count - 1];
  ffmpeg([
    '-i',
    resolve(mediaFolder, `midgard-${name}.gif`),
    '-vf',
    `select='${picks.map((n) => `eq(n\\,${n})`).join('+')}',scale=480:-2,tile=2x2`,
    '-frames:v',
    '1',
    resolve(review, `${name}.png`),
  ]);
}

/** A still straight into the media folder. */
export async function still(page, name, clip) {
  if (videoFps) return null;
  const path = resolve(mediaFolder, `midgard-${name}.png`);
  await mkdir(mediaFolder, { recursive: true });
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  return { file: `midgard-${name}.png`, bytes: (await stat(path)).size };
}

/** Clicks a HUD control by id (or id suffix) and draws two frames. */
export async function clickControl(page, id) {
  const controls = await page.evaluate(() => media.controls());
  const c = controls.find((c) => c.id === id) ?? controls.find((c) => c.id.endsWith(id));
  if (!c) throw new Error(`Missing control ${id}: ${controls.map((c) => c.id).join(', ')}`);
  await page.mouse.click(c.bounds.x + c.bounds.w / 2, c.bounds.y + c.bounds.h / 2);
  await page.evaluate(() => media.frames(2, 0.001));
  return c;
}

/** MEDIA_ONLY=settlement,day-night limits a run to those outputs (by file name without `midgard-`). */
export const wants = (name) => {
  const only = (process.env.MEDIA_ONLY ?? '').split(',').filter(Boolean);
  return !only.length || only.includes(name);
};
