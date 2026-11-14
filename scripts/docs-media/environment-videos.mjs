// How each environment effect is built in ThorVG, layer by layer, on the live renderer; and two sample clips with the
// game's sound (clouds over the town, water and lava). A build-up switches the renderer's own nodes on one at a time:
// after the game's frame is drawn, chosen nodes are given opacity 0 (or a demo fill) and the tree is synced again;
// the next frame restores them, so the game's own state is never changed. Labels name the nodes and ThorVG calls.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bootGame } from '../readme-media/capture-session.mjs';
import { overlay } from './optimisation-videos.mjs';
import { docsWork, encodeVideo } from './video-assembly.mjs';

const width = 1280,
  height = 720,
  fps = 30;

/** Page-side machinery: overrides that last one frame, demo nodes, and a step label. */
async function machinery(page) {
  await page.evaluate(async () => {
    const paint = await import('/packages/native-renderer/src/paint.ts');
    media.paint = paint;
    const touched = [],
      added = [];
    media.env = {
      hide(node) {
        if (!node) return;
        touched.push([node, node.alpha]);
        node.opacity(0);
      },
      show(node, a = 255) {
        if (!node) return;
        touched.push([node, node.alpha]);
        node.opacity(a);
      },
      /** A node added to the world's top for this frame only. */
      add(node, first = false) {
        const w = media.game.renderer.world;
        if (first) {
          w.children.unshift(node);
          w.version++;
        } else w.add(node);
        added.push(node);
      },
      restore() {
        while (touched.length) {
          const [node, a] = touched.pop();
          node.opacity(a);
        }
        const w = media.game.renderer.world;
        if (added.length) {
          w.children = w.children.filter((c) => !added.includes(c));
          w.version++;
          added.length = 0;
        }
      },
      resync() {
        const r = media.game.renderer;
        r.adapter.sync(r.root);
        media.canvas.update().render();
      },
    };
  });
}

/**
 * Records a build-up: `steps` names page functions on `media.steps[k]` ({ seconds, title, lines, frame(i) }).
 * Writes artifacts/docs-media/frames/<name>/NNNN.png across all steps. `inset` puts the last frame of step k into
 * the next step's corner.
 */
async function buildUp(page, name, insetAfter = -1) {
  const folder = resolve(docsWork, 'frames', name);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const count = await page.evaluate(() => media.steps.length);
  let n = 0;
  for (let k = 0; k < count; ++k) {
    const frames = await page.evaluate((k) => Math.round(media.steps[k].seconds * 30), k);
    for (let i = 0; i < frames; ++i) {
      await page.evaluate(
        ([k, i, count]) => {
          const step = media.steps[k],
            { o } = media;
          media.env.restore();
          step.frame(i);
          media.env.resync();
          o.clear();
          o.panel(20, 20, [[`${k + 1} / ${count} · ${step.title}`, o.accent], ...step.lines.map((l) => [l, o.ink])], 15);
          if (step.source) o.text(20, media.height - 16, step.source, o.grey, 13, false);
        },
        [k, i, count],
      );
      await page.screenshot({ path: resolve(folder, `${String(n++).padStart(4, '0')}.png`) });
    }
    if (k === insetAfter) {
      const shot = (await page.screenshot({ type: 'jpeg', quality: 80 })).toString('base64');
      await page.evaluate((src) => {
        const img = document.createElement('img');
        img.id = 'env-inset';
        img.src = `data:image/jpeg;base64,${src}`;
        img.style.cssText = 'position:absolute;right:20px;bottom:44px;width:384px;border:2px solid rgb(191,161,99);border-radius:4px';
        const tag = document.createElement('div');
        tag.id = 'env-inset-tag';
        tag.textContent = 'the mask source, from step 3';
        tag.style.cssText = 'position:absolute;right:20px;bottom:262px;padding:3px 8px;background:rgba(20,24,22,.9);color:rgb(232,190,110);font:600 14px DejaVu Sans,Verdana,sans-serif';
        document.body.append(img, tag);
      }, shot);
    }
    if (k === insetAfter + 1) await page.evaluate(() => document.querySelectorAll('#env-inset,#env-inset-tag').forEach((e) => e.remove()));
  }
  return encodeVideo(name, { fps, crf: 26 });
}

/** A sample of the effect with the game's own sound: the game runs its world, its sounds and background mixed offline. */
async function sample(page, name, seconds, frame) {
  const folder = resolve(docsWork, 'frames', name);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  await page.evaluate(() => {
    media.keepAmbience = true;
    media.o.clear();
  });
  let from = 0,
    to = 0;
  for (let i = 0; i < seconds * fps; ++i) {
    const now = await page.evaluate(frame, i);
    if (i === 0) from = now;
    to = now + 1 / fps;
    await page.screenshot({ path: resolve(folder, `${String(i).padStart(4, '0')}.png`) });
  }
  const mixed = await page.evaluate(([a, b]) => media.mix(a, b), [from, to]),
    pcm = Buffer.from(mixed.pcm, 'base64'),
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
  return { ...(await encodeVideo(name, { fps, crf: 25, audio: mixed.peak > 0.002 ? wav : undefined })), cues: mixed.cues, peak: +mixed.peak.toFixed(3) };
}

export async function captureEnvironmentVideos(session) {
  const out = {},
    page = await session.page(width, height);
  try {
    await bootGame(page, { width, height, hud: false });
    await overlay(page);
    await machinery(page);
    // A camp with homes, a fire, torches and lit windows, and people about.
    await page.evaluate(() => {
      const { E, game } = media,
        t = game.town,
        c = t.map().camp();
      t.summonRaid = () => {};
      t.releaseMonster = () => {};
      t.scout(c.x, c.y, 18);
      t.place(E.Structure.Camp, c, 0);
      t.completeConstruction();
      t.reward(new E.Resources(500, 500, 500, 500, 0, 0, 50, 50, 0));
      const road = [[1.2, 0], [7, 0]].map(([x, y]) => E.sharpAnchor(E.add(c, E.point(x, y))));
      if (t.canBuildRoad(road).ok) t.buildRoad(road);
      t.completeConstruction();
      for (const [name, x, y] of [
        ['Tent', 2.6, -1.5],
        ['Tent', 4.2, -1.5],
        ['Tent', 2.6, 1.5],
        ['Workbench', 4.6, 1.8],
      ]) {
        const p = t.fit(E.Structure[name], E.add(c, E.point(x, y)), 0);
        if (t.place(E.Structure[name], p.center, p.angle)) t.completeConstruction();
      }
      for (const [x, y] of [[3.4, 0.4], [5.8, 0.4]]) t.place(E.Structure.Torch, E.add(c, E.point(x, y)), 0);
      t.recruit(E.Role.Resident, E.Calling.Settler, 4);
      for (const p of t.people()) p.food = p.rest = p.hydration = 1;
      media.camp = c;
      media.view = E.add(c, E.point(2.6, 0.4));
      media.look(media.view, 2);
      media.frames(10, 0.05);
    });

    // Night: one dark sheet, cut away by an inverse-alpha mask of soft discs, warmed by a screen-blended layer.
    await page.evaluate(() => {
      const { E, game, env, paint } = media,
        t = game.town,
        r = game.renderer;
      media.hour(22.5);
      media.frames(10, 0.05);
      const still = () => media.frame(0.001),
        live = () => media.frame(1 / 30);
      const world = () => r.world.children;
      media.steps = [
        {
          seconds: 1.6,
          title: 'The night scene, its night layers off',
          lines: ['darkness and warmth set to opacity 0 for this picture'],
          source: 'world-vision.ts buildDarkness · world-animation.ts animate',
          frame() {
            still();
            env.hide(r.darkness);
            env.hide(r.warmth);
          },
        },
        {
          seconds: 1.6,
          title: 'One dark sheet over everything',
          lines: ['ShapeNode rect · fill (4, 6, 22) at alpha 170 × night', 'this is darkVeil, drawn here without its mask'],
          source: 'world-vision.ts buildDarkness (darkVeil) · world-animation.ts (alpha 170 × night)',
          frame() {
            still();
            env.hide(r.darkness);
            env.hide(r.warmth);
            env.add(new paint.ShapeNode().appendRect(-1e5, -1e5, 2e5, 2e5).fill(4, 6, 22, Math.round(170 * t.climate().night)));
          },
        },
        {
          seconds: 1.8,
          title: 'The mask source: where light is let through',
          lines: ['SceneNode `lit` of softDisc shapes: radial-gradient discs, alpha falling to 0', 'shown here as the veil made opaque black over white:', 'white is where the mask is opaque'],
          source: 'vector-paint.ts softDisc (fillGradient radial) · world-vision.ts (pools[i].hole)',
          frame() {
            still();
            for (const c of world()) if (c !== r.darkness) env.hide(c);
            env.hide(r.warmth);
            env.add(new paint.ShapeNode().appendRect(-1e5, -1e5, 2e5, 2e5).fill(255, 255, 255), true);
            r.darkVeil.fill(0, 0, 0, 255);
          },
        },
        {
          seconds: 2,
          title: "The sheet masked: darkVeil.mask(lit, 'inverseAlpha')",
          lines: ['the sheet is cut away where the mask is opaque', 'ThorVG MaskMethod.InvAlpha, set by the adapter'],
          source: 'world-vision.ts:34 · webcanvas-adapter.ts (mask methods)',
          frame() {
            still();
            env.hide(r.warmth);
          },
        },
        {
          seconds: 1.6,
          title: "Warmth: tinted discs blended with 'screen'",
          lines: ['SceneNode warmth · blend screen · softDisc in each light’s colour', 'lights (the glows round lamps) sit under the units'],
          source: 'world-renderer-state.ts (warmth.blend) · world-vision.ts (pools[i].tint)',
          frame: still,
        },
        {
          seconds: 2.4,
          title: 'Flicker',
          lines: ['every 1/20 s each pool’s hole, glow and tint is moved, scaled and faded', 'nothing is rebuilt: only transforms and opacity are sent'],
          source: 'world-animation.ts animate (flicker)',
          frame: live,
        },
      ];
    });
    out.night = await buildUp(page, 'env-night', 2);

    // Clouds: the shadows of 30 clusters of radial-gradient puffs, mottled by one noise picture and its duplicates.
    await page.evaluate(() => {
      const { E, game, env } = media,
        t = game.town,
        r = game.renderer;
      media.hour(12);
      t.weather().force(E.Weather.Cloudy, 0.9);
      media.look(media.view, 1.1);
      for (let i = 0; i < 40; ++i) media.frame(0.05, true);
      const still = () => {
        media.look(media.view, 1.1);
        media.frame(0.001);
      };
      const one = () => {
        let best = null,
          gap = 1e9;
        for (const c of r.cloudShapes) {
          if (!c.alpha) continue;
          const d = Math.hypot(c.matrix[2] - r.view.x, c.matrix[5] - r.view.y);
          if (d < gap) [gap, best] = [d, c];
        }
        return best;
      };
      media.steps = [
        { seconds: 1.4, title: 'The ground, no clouds', lines: ['clouds layer at opacity 0'], source: 'world-weather.ts drift', frame() { still(); env.hide(r.clouds); } },
        {
          seconds: 1.8,
          title: 'One cluster',
          lines: ['a SceneNode of 20 puffs: circles filled with a radial gradient', 'dark (8, 14, 24), fading to 0 at the rim; squashed to half height', 'what is drawn is the cloud’s shadow on the ground'],
          source: 'world-weather.ts drift (cloudShapes, fillGradient radial)',
          frame() {
            still();
            const keep = one();
            for (const c of r.cloudShapes) if (c !== keep) env.hide(c);
            if (r.mottle) env.hide(r.mottle.scene);
          },
        },
        {
          seconds: 1.8,
          title: 'Thirty clusters, recycled',
          lines: ['6 × 5 clusters built once and placed over 1150-px tiles by a hash', 'about a third of the tiles are left empty; normal blend, opacity only'],
          source: 'world-weather.ts drift',
          frame() {
            still();
            if (r.mottle) env.hide(r.mottle.scene);
          },
        },
        {
          seconds: 1.8,
          title: 'Mottled by one noise picture',
          lines: ['PictureNode from raw ARGB pixels, 1024 × 512 shown at 2048 × 1024', '44 duplicate()s tile the sky: 45 tiles, one decoded image', 'no clip, mask or blend: the picture’s alpha and an opacity'],
          source: 'cloud-mottle.ts (CloudMottle, duplicate)',
          frame: still,
        },
        {
          seconds: 2.4,
          title: 'Drift with the wind',
          lines: ['each cluster gets a transform: 42 px/s across, 15 px/s down, scaled by the wind'],
          source: 'world-weather.ts drift',
          frame() {
            media.look(media.view, 1.1);
            media.frame(1 / 30, true);
          },
        },
      ];
    });
    out.clouds = await buildUp(page, 'env-clouds');
    out.cloudsSample = await sample(page, 'clouds', 5, () => {
      media.look(media.view, 1.1);
      media.frame(1 / 30, true);
      return media.now;
    });

    // Rain: a grey overcast rect, one shape of stroked streaks rebuilt each frame, and splashes under the units.
    await page.evaluate(() => {
      const { E, game, env } = media,
        t = game.town,
        r = game.renderer;
      t.weather().force(E.Weather.Rain, 1);
      media.look(media.view, 1.8);
      for (let i = 0; i < 40; ++i) media.frame(0.05, true);
      const run = () => {
        media.look(media.view, 1.8);
        media.frame(1 / 30, true);
      };
      media.steps = [
        { seconds: 1.4, title: 'The scene, no rain', lines: ['overcast, precipitation and splashes off'], source: 'world-weather.ts weather', frame() { run(); env.hide(r.overcast); env.hide(r.precipitation); env.hide(r.splashes); } },
        { seconds: 1.4, title: 'Overcast', lines: ['one rect over the view, filled grey (24, 28, 38) by how wet the sky is'], source: 'world-weather.ts weather (overcast)', frame() { run(); env.hide(r.precipitation); env.hide(r.splashes); } },
        {
          seconds: 2,
          title: 'One shape of streaks',
          lines: ['precipitation: a single ShapeNode, its path rebuilt every frame', 'moveTo/lineTo segments, stroked (strokeFill, strokeWidth), no fill', 'up to 420 in a storm, 260 in rain, at most 40 per 320-px tile'],
          source: 'world-weather.ts weather',
          frame() {
            run();
            env.hide(r.splashes);
          },
        },
        {
          seconds: 2,
          title: 'Splashes on the ground',
          lines: ['filled circles and stroked rings from a pool of 160, rebuilt 15× a second', 'in their own layer under the units, so feet stand in them'],
          source: 'rain-splash.ts paintSplashes · world-renderer-state.ts (splashes)',
          frame: run,
        },
      ];
    });
    out.rain = await buildUp(page, 'env-rain');

    // Lightning: filled strips for the bolt, a radial glow, a flash sheet; held at one instant, then played.
    await page.evaluate(() => {
      const { E, game, env } = media,
        t = game.town,
        r = game.renderer;
      t.weather().force(E.Weather.Storm, 0.9);
      media.hour(15);
      media.look(media.view, 1.2);
      for (let i = 0; i < 20; ++i) media.frame(0.05, true);
      const strike = () => r.lightning({ reach: 1, at: media.now - 0.06, delay: 0, brightness: 0.9, across: 0.45, down: 0.45, seed: 9 });
      const held = () => {
        if (!media.struck) {
          strike();
          media.struck = true;
        }
        media.look(media.view, 1.2);
        media.frame(0);
      };
      const parts = (keep) => r.storm.children.forEach((c, k) => !keep(k) && env.hide(c));
      media.steps = [
        { seconds: 1.2, title: 'A storm, no strike drawn', lines: ['storm layer at opacity 0'], source: 'world-weather.ts paintStorm', frame() { held(); env.hide(r.storm); } },
        { seconds: 1.8, title: 'The bolt', lines: ['filled strips (appendStrip), not strokes: a pale blue outer, a white core', 'a 14-step path and two forks, shown only in the first 0.26 s'], source: 'world-weather.ts paintStorm · vector-paint.ts appendStrip', frame() { held(); parts((k) => k >= 2); } },
        { seconds: 1.6, title: 'Its glow', lines: ['a radial-gradient glow round the strike'], source: 'world-weather.ts paintStorm (glow)', frame() { held(); parts((k) => k >= 1); } },
        { seconds: 1.6, title: 'The flash', lines: ['one rect over the whole view, (214, 224, 255) at 95 × strength', 'normal blend over everything; it does not touch the night mask'], source: 'world-weather.ts paintStorm', frame: held },
        {
          seconds: 2.4,
          title: 'A quarter of a second',
          lines: ['pulse: 1, then 0.3, then 0.9 at 0.1 s, then fading; the layer is rebuilt each frame', 'the whole strike lasts 0.9 s'],
          source: 'world-weather.ts paintStorm',
          frame(i) {
            if (i % 30 === 0) strike();
            media.look(media.view, 1.2);
            media.frame(1 / 60);
          },
        },
      ];
    });
    out.lightning = await buildUp(page, 'env-lightning');

    // Water and lava: marching-squares bands with solid fills, moved by translation; lava's bands, spots and glow.
    const lava = await page.evaluate(async () => {
      const { lavaPatches } = await import('/packages/native-renderer/src/lava-motion.ts');
      const { E, game, env } = media,
        t = game.town,
        r = game.renderer,
        v = t.map().volcano();
      if (!v) return false;
      const heart = v.center();
      t.weather().force(E.Weather.Clear, 0);
      media.hour(12);
      t.folk.slice(0, 3).forEach((p, k) => {
        p.position = t.grid.nearestWalkable({ x: heart.x + 6 + k, y: heart.y + 7 });
        p.path = [];
        p.autoMode = false;
      });
      t.scout(heart.x, heart.y, 20);
      media.lavaView = { x: heart.x + 7, y: heart.y + 8 };
      media.look(media.lavaView, 1);
      for (let i = 0; i < 20; ++i) media.frame(0.05, true);
      const tints = r.groundTints.map((d) => d.shape),
        patches = () => lavaPatches(r.ground),
        still = () => {
          media.look(media.lavaView, 1);
          media.frame(0.001);
        };
      const lavaParts = (bands, glow) => {
        for (const p of patches()) {
          p.bands.forEach((b, k) => k >= bands && env.hide(b.shape));
          if (!glow) env.hide(p.glow);
        }
      };
      media.steps = [
        { seconds: 1.4, title: 'The land, no water or lava colour', lines: ['the depth bands and lava bands at opacity 0'], source: 'terrain-painter.ts paintSea · lava-motion.ts paintLava', frame() { still(); tints.forEach((s) => env.hide(s)); lavaParts(0, false); } },
        {
          seconds: 2.4,
          title: 'Depth bands, one after another',
          lines: ['marching squares turn the depth field into closed polygons (contours.ts region)', 'each band one ShapeNode with a solid fill: no gradient', 'five sea bands at depths 0.32, 0.18, 0.09, 0.04, 0.012'],
          source: 'contours.ts region · terrain-painter.ts paintSea · tintGround',
          frame(i) {
            still();
            const shown = Math.floor((i / 72) * tints.length * 1.3);
            tints.forEach((s, k) => k >= shown && env.hide(s));
            lavaParts(0, false);
          },
        },
        {
          seconds: 1.8,
          title: 'Lava: three bands',
          lines: ['the same contours, three solid fills: dark crust, (204, 92, 34), (240, 150, 56)'],
          source: 'lava-motion.ts paintLava',
          frame(i) {
            still();
            lavaParts(Math.min(3, 1 + Math.floor(i / 18)), false);
          },
        },
        { seconds: 1.8, title: 'Lava: breathing spots in a clipped glow', lines: ['glow: a SceneNode clipped to the molten band (clip)', 'spots inside it scale and fade with a slow breath'], source: 'lava-motion.ts paintLava (glow.clip) · updateLava', frame: still },
        {
          seconds: 2.6,
          title: 'Drift',
          lines: ['water bands move by translate only, 12× a second (6 when zoomed out)', 'lava bands 6× a second, only while seen; at night lava also cuts the dark sheet'],
          source: 'water-motion.ts moveWater · lava-motion.ts updateLava · lightLava',
          frame() {
            media.look(media.lavaView, 1);
            media.frame(1 / 30, true);
          },
        },
      ];
      return true;
    });
    if (lava) {
      out.waterLava = await buildUp(page, 'env-water-lava');
      out.waterLavaSample = await sample(page, 'water-lava', 5, () => {
        media.look(media.lavaView, 1);
        media.frame(1 / 30, true);
        return media.now;
      });
    }
  } finally {
    await page.context().close();
  }
  return out;
}
