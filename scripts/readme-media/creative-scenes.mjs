// The creative tools: the whole world in the Map Editor (a still), and real brush strokes, undo and redo in it (a GIF).
// Carried over from the earlier scripts/capture-map-media.mjs: real pointer input on the real editor.
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assembleGif, still, wants, workFolder } from './capture-session.mjs';

async function openEditor(session, width, height) {
  const page = await session.page(width, height, '/?test&renderer=gl&seed=5&map-editor');
  await page.waitForFunction(() => !!window.goldfantasy || !!document.querySelector('#startup-error'), {}, { timeout: 120000 });
  await page.evaluate(async () => {
    const rt = window.goldfantasy;
    if (!rt) throw Error(document.querySelector('#startup-error')?.textContent);
    rt.host.stop();
    rt.host.render(0);
    rt.host.render(0.1);
    if (rt.app.current !== 'MapEditor') throw Error('Map Editor did not open');
    window.mediaEngine = await import('/packages/engine/src/index.ts');
  });
  return page;
}

function curve(knots, steps) {
  const points = [];
  for (let i = 0; i <= steps; ++i) {
    const u = ((knots.length - 1) * i) / steps,
      k = Math.min(knots.length - 2, Math.floor(u)),
      t = u - k,
      p0 = knots[Math.max(0, k - 1)],
      p1 = knots[k],
      p2 = knots[k + 1],
      p3 = knots[Math.min(knots.length - 1, k + 2)];
    points.push(
      [0, 1].map(
        (a) =>
          0.5 *
          (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t * t * t),
      ),
    );
  }
  return points;
}

export async function captureCreativeTools(session) {
  const out = {};
  if (wants('world-map')) {
    const page = await openEditor(session, 1600, 1000);
    try {
      await page.evaluate(() => {
        const rt = window.goldfantasy,
          editor = rt.app.editorSession.game.atlas;
        editor.fit();
        editor.view().zoom *= 1.7;
        rt.host.render(5.2);
        rt.host.render(5.3);
      });
      out.worldMap = await still(page, 'world-map');
    } finally {
      await page.context().close();
    }
  }
  if (wants('map-editor')) {
    const page = await openEditor(session, 1280, 800),
      folder = resolve(workFolder, 'frames', 'map-editor');
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    let number = 0;
    const frame = async (count = 1) => {
      for (let i = 0; i < count; ++i) {
        await page.evaluate((index) => {
          const rt = window.goldfantasy,
            game = rt.app.editorSession.game,
            seconds = 2 + index / 10;
          game.render(innerWidth, innerHeight, seconds, false, 0.25, seconds);
          rt.host.canvas.update().render();
        }, number);
        await page.screenshot({ path: resolve(folder, `${String(number++).padStart(4, '0')}.png`) });
      }
    };
    const click = async (id) => {
      const b = await page.evaluate((id) => {
        const c = window.goldfantasy.app.editorSession.game.context.controls.find((c) => c.id === id);
        if (!c) throw Error(`Missing Map Editor control: ${id}`);
        return { ...c.bounds };
      }, id);
      await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
      await frame(2);
      await page.mouse.down();
      await frame();
      await page.mouse.up();
      await frame();
    };
    const stroke = async (knots, steps) => {
      const screen = await page.evaluate((points) => {
        const e = window.goldfantasy.app.editorSession.game.atlas,
          b = e.canvasBounds(),
          camera = e.view();
        return points.map(([x, y]) => {
          const p = camera.toScreen(window.mediaEngine.project(x, y), b.w, b.h);
          return { x: p.x + b.x, y: p.y + b.y };
        });
      }, curve(knots, steps));
      await page.mouse.move(screen[0].x, screen[0].y);
      await frame(3);
      await page.mouse.down();
      await frame();
      for (const p of screen.slice(1)) {
        await page.mouse.move(p.x, p.y);
        await frame();
      }
      await page.mouse.up();
      await frame(7);
    };
    const count = () =>
      page.evaluate(() => {
        const map = window.goldfantasy.app.editorSession.game.atlas.document().map();
        let water = 0,
          trees = 0;
        for (const tile of map.tiles) {
          if (window.mediaEngine.Terrain[tile.terrain] === 'Water') ++water;
          trees += tile.trees;
        }
        return { water, trees };
      });
    try {
      await page.evaluate(() => {
        const rt = window.goldfantasy,
          game = rt.app.editorSession.game,
          focus = window.mediaEngine.project(107.5, 61.5);
        Object.assign(game.atlas.view(), { x: focus.x, y: focus.y, zoom: 0.7 });
      });
      // The terrain tiles fill in over the first frames; wait for them before the first picture.
      for (let i = 0; i < 30; ++i) {
        await page.evaluate((i) => {
          const rt = window.goldfantasy;
          rt.app.editorSession.game.render(innerWidth, innerHeight, 1 + i / 30, false, 0.25, 1 + i / 30);
          rt.host.canvas.update().render();
        }, i);
        await page.waitForTimeout(50);
      }
      const before = await count();
      await frame(6);
      await click('map-tool-3');
      await click('map-radius-down');
      await stroke([[105, 45], [104, 49], [105, 53], [108, 56], [108, 60], [112, 64]], 30);
      const water = await count();
      if (water.water <= before.water) throw Error('The water stroke added no water');
      await click('map-tool-2');
      await click('map-radius-up');
      await stroke([[103, 63], [104, 65], [106, 65], [108, 64]], 24);
      const forest = await count();
      if (forest.trees <= water.trees) throw Error('The forest stroke added no trees');
      await click('map-undo');
      await frame(6);
      await click('map-redo');
      await frame(10);
      out.mapEditor = { ...(await assembleGif('map-editor', { fps: 10, width: 800, colors: 192 })), before, water, forest };
    } finally {
      await page.evaluate(() => window.goldfantasy?.dispose()).catch(() => {});
      await page.context().close();
    }
  }
  return out;
}
