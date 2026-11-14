// One short annotated clip per optimisation on the presentation page. Every counter and highlight is read from the
// live renderer (`game.renderer` is the WorldRendererState): which paints were attached this frame, which tree rows
// are switched on, when water and lava last moved, how many poses a bank solved. Nothing in the game is changed;
// the overlays are a page canvas over (or around) the game's own canvas.
import { spawnSync } from 'node:child_process';
import { loadavg, cpus } from 'node:os';
import { resolve } from 'node:path';
import { bootGame, root } from '../readme-media/capture-session.mjs';
import { encodeVideo, recordFrames } from './video-assembly.mjs';

const width = 1280,
  height = 720,
  fps = 30;

/** Overlay canvas and drawing helpers, and a way to shrink the game canvas to show what lies outside the view. */
export async function overlay(page) {
  await page.evaluate(() => {
    const game = document.querySelector('canvas'),
      over = document.createElement('canvas');
    over.width = media.width;
    over.height = media.height;
    over.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    document.body.append(over);
    const g = over.getContext('2d');
    game.style.position = 'absolute';
    game.style.transformOrigin = '0 0';
    const o = {
      g,
      k: 1,
      x0: 0,
      y0: 0,
      accent: 'rgb(232,190,110)',
      teal: 'rgb(120,190,180)',
      bad: 'rgb(226,104,84)',
      grey: 'rgba(200,196,186,0.75)',
      ink: 'rgba(245,238,222,0.96)',
      /** Shows the game canvas at `k` of its size in the middle of the page (1 = full page). */
      shrink(k) {
        this.k = k;
        this.x0 = Math.round((media.width * (1 - k)) / 2);
        this.y0 = Math.round((media.height * (1 - k)) / 2);
        game.style.left = `${this.x0}px`;
        game.style.top = `${this.y0}px`;
        game.style.transform = `scale(${k})`;
        document.body.style.background = '#0d100e';
      },
      /** A point in the game's screen pixels to page pixels. */
      page(p) {
        return { x: this.x0 + p.x * this.k, y: this.y0 + p.y * this.k };
      },
      /** A point in projected world pixels (project(), treeBounds, lava boxes) to the game's screen pixels. */
      fromProjected(p) {
        return media.game.camera.toScreen(p, media.width, media.height);
      },
      clear() {
        g.clearRect(0, 0, media.width, media.height);
      },
      rect(r, stroke, fill, dash = [], w = 1.5) {
        g.setLineDash(dash);
        if (fill) {
          g.fillStyle = fill;
          g.fillRect(r.x, r.y, r.w, r.h);
        }
        if (stroke) {
          g.strokeStyle = stroke;
          g.lineWidth = w;
          g.strokeRect(r.x, r.y, r.w, r.h);
        }
        g.setLineDash([]);
      },
      dot(p, color, r = 4) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.fill();
      },
      cross(p, color, r = 4) {
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(p.x - r, p.y - r);
        g.lineTo(p.x + r, p.y + r);
        g.moveTo(p.x + r, p.y - r);
        g.lineTo(p.x - r, p.y + r);
        g.stroke();
      },
      text(x, y, s, color = this.ink, size = 16, bold = true) {
        g.font = `${bold ? 600 : 400} ${size}px DejaVu Sans, Verdana, sans-serif`;
        g.fillStyle = color;
        g.fillText(s, x, y);
      },
      panel(x, y, lines, size = 16) {
        g.font = `600 ${size}px DejaVu Sans, Verdana, sans-serif`;
        const w = Math.max(...lines.map(([s]) => g.measureText(s).width)) + 24,
          h = lines.length * (size + 9) + 14;
        g.fillStyle = 'rgba(20,24,22,0.9)';
        g.fillRect(x, y, w, h);
        g.strokeStyle = 'rgba(191,161,99,0.8)';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        lines.forEach(([s, color], i) => this.text(x + 12, y + 22 + i * (size + 9), s, color ?? this.ink, size));
      },
    };
    media.o = o;
    o.shrink(1);
  });
}

/** A camp, a few homes and roads, residents at work and monsters roaming, half of it under fog. */
async function stageWorld(page) {
  return page.evaluate(() => {
    const { E, game } = media,
      t = game.town,
      c = t.map().camp();
    t.summonRaid = () => {};
    t.releaseMonster = () => {};
    t.scout(c.x, c.y, 16);
    t.place(E.Structure.Camp, c, 0);
    t.completeConstruction();
    t.reward(new E.Resources(500, 500, 500, 500, 0, 0, 50, 50, 0));
    for (const [name, x, y] of [
      ['Tent', 3, -1.5],
      ['Tent', 4.5, -1.5],
      ['Workbench', 0, 2.4],
      ['Farm', 6, 2.5],
      ['Well', 3, 1.6],
    ]) {
      const p = t.fit(E.Structure[name], E.add(c, E.point(x, y)), 0);
      if (t.place(E.Structure[name], p.center, p.angle)) t.completeConstruction();
    }
    t.recruit(E.Role.Resident, E.Calling.Settler, 8);
    for (const p of t.people()) p.food = p.rest = p.hydration = 1;
    t.orderAutomatic(t.people().map((p) => p.id));
    // Monsters scattered far and wide, calm: most of them off screen, some under fog.
    const lair = t.map().dungeons().findIndex((d) => d.kind === 1);
    for (let i = 0; i < 60; ++i) {
      const a = i * 2.39996,
        r = 6 + 22 * Math.sqrt((i + 0.5) / 60),
        at = t.grid.nearestWalkable({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) }),
        m = new E.Monster(t.nextMonster++, Math.max(0, lair), at);
      m.home = { ...at };
      m.vigor = m.health = 40;
      t.beasts.push(m);
    }
    t.changes++;
    media.hour(11);
    for (let i = 0; i < 300; ++i) {
      t.advance(0.1);
      game.dispatchWork();
    }
    media.camp = c;
    media.look(c, 1.2);
    media.frames(20, 0.05);
    return { people: t.people().length, monsters: t.beasts.length };
  });
}

export async function captureOptimisationVideos(session) {
  const out = {};
  const page = await session.page(width, height);
  try {
    await bootGame(page, { width, height, hud: false });
    await overlay(page);
    out.world = await stageWorld(page);

    // 1. View culling and fog.
    await page.evaluate(() => {
      media.o.shrink(0.56);
      media.pan = { from: { x: media.camp.x - 9, y: media.camp.y + 7 }, to: { x: media.camp.x + 9, y: media.camp.y - 6 } };
    });
    await recordFrames(page, 'opt-culling', {
      count: 6 * fps,
      arg: 6 * fps,
      step: ([i, n]) => {
        const { o, game } = media,
          t = game.town,
          r = game.renderer,
          u = i / (n - 1),
          at = { x: media.pan.from.x + (media.pan.to.x - media.pan.from.x) * u, y: media.pan.from.y + (media.pan.to.y - media.pan.from.y) * u };
        media.look(at, 1.1);
        media.step(1 / 30);
        const drawn = new Set(r.objects.children);
        let total = 0;
        for (const rows of [r.rowBuildings, r.rowLamps, r.rowTrees, r.rows]) for (const row of rows) for (const p of row.children) if (p.alpha) ++total;
        o.clear();
        // The view, and the margin it is widened by (64 px at this zoom) for what is about to enter.
        const view = { x: o.x0, y: o.y0, w: media.width * o.k, h: media.height * o.k },
          m = 64 * o.k;
        o.rect(view, o.accent, null, [], 2);
        o.rect({ x: view.x - m, y: view.y - m, w: view.w + 2 * m, h: view.h + 2 * m }, o.accent, null, [6, 5], 1.2);
        o.text(view.x + 6, view.y - 8, 'view', o.accent, 14);
        o.text(view.x - m + 6, view.y - m - 8, 'view + margin', o.accent, 14);
        let fog = 0,
          off = 0;
        const mark = (paint, pos) => {
          const s = o.page(media.screen(pos)),
            inside = s.x > view.x - m && s.x < view.x + view.w + m && s.y > view.y - m && s.y < view.y + view.h + m + 40;
          if (drawn.has(paint)) {
            if (!inside) return;
            o.dot(s, o.teal, 3);
          } else if (inside) {
            ++fog;
            o.dot(s, 'rgb(160,120,200)', 4);
          } else {
            ++off;
            o.cross(s, o.grey, 4);
          }
        };
        for (const [id, f] of r.figures) {
          const p = t.person(id);
          if (p && f.paint.alpha) mark(f.paint, p.position);
        }
        for (const [id, b] of r.beasts) {
          const m2 = t.creature(id);
          if (m2 && b.paint.alpha) mark(b.paint, m2.position);
        }
        o.panel(20, 20, [
          [`drawn this frame: ${r.objects.children.length} of ${total} paints in the rows`, o.ink],
          ['×  outside the view and margin: not attached', o.grey],
          ['●  in view but under unexplored fog: dropped', 'rgb(190,160,225)'],
          ['●  attached and drawn', o.teal],
        ]);
        o.text(20, media.height - 20, 'sortWorldObjects() · viewRect() · underVeil() · world-depth.ts', o.grey, 13, false);
      },
    });
    out.culling = await encodeVideo('opt-culling', { fps, crf: 26 });

    // 2. Depth order: paints labelled with their place in the order; reused while nothing moves.
    await page.evaluate(() => {
      media.o.shrink(1);
      media.look({ x: media.camp.x + 2, y: media.camp.y + 0.5 }, 2.4);
      media.lastOrder = null;
      media.sorts = 0;
      media.reuses = 0;
    });
    await recordFrames(page, 'opt-depth', {
      count: 6 * fps,
      step: ([i]) => {
        const { o, game } = media,
          t = game.town,
          r = game.renderer;
        // The first half the world stands still; then it runs again and people walk.
        if (i < 75) media.frame(1 / 30);
        else media.step(1 / 30);
        const order = r.objects.children,
          resorted = media.lastOrder !== null && order !== media.lastOrder;
        if (media.lastOrder !== null) resorted ? ++media.sorts : ++media.reuses;
        media.lastOrder = order;
        o.clear();
        const index = new Map(order.map((p, k) => [p, k]));
        for (const [id, f] of r.figures) {
          const p = t.person(id),
            k = index.get(f.paint);
          if (!p || k === undefined) continue;
          const s = media.screen(p.position);
          if (s.x < 0 || s.x > media.width || s.y < 0 || s.y > media.height) continue;
          o.g.fillStyle = 'rgba(20,24,22,0.85)';
          o.g.fillRect(s.x - 15, s.y + 6, 30, 18);
          o.text(s.x - 11, s.y + 20, String(k).padStart(3, ' '), o.accent, 13);
        }
        // The x-sweep, drawn moving across: only boxes it finds overlapping are compared.
        const x = ((i % 45) / 45) * media.width;
        o.g.setLineDash([5, 6]);
        o.g.strokeStyle = 'rgba(232,190,110,0.6)';
        o.g.beginPath();
        o.g.moveTo(x, 90);
        o.g.lineTo(x, media.height - 40);
        o.g.stroke();
        o.g.setLineDash([]);
        o.panel(20, 20, [
          [i < 75 ? 'nothing moves: the cached order is reused' : 'people walk: the order is worked out again when it changes', o.ink],
          [resorted ? 'this frame: RESORTED (x-sweep, then topological sort)' : 'this frame: reused', resorted ? o.bad : o.teal],
          [`${order.length} paints in order · resorted ${media.sorts} · reused ${media.reuses} frames`, o.grey],
        ]);
        o.text(20, media.height - 20, 'orderedPaints() · compareBaselines() · orderCache · world-depth.ts', o.grey, 13, false);
      },
    });
    out.depth = await encodeVideo('opt-depth', { fps, crf: 26 });

    // 3. Trees and peaks: one scene per diagonal row, switched off whole as it leaves the view.
    await page.evaluate(() => {
      media.o.shrink(0.56);
      media.pan = { from: { x: media.camp.x - 8, y: media.camp.y - 8 }, to: { x: media.camp.x + 8, y: media.camp.y + 8 } };
    });
    await recordFrames(page, 'opt-rows', {
      count: 6 * fps,
      arg: 6 * fps,
      step: ([i, n]) => {
        const { o, game } = media,
          r = game.renderer,
          u = i / (n - 1),
          at = { x: media.pan.from.x + (media.pan.to.x - media.pan.from.x) * u, y: media.pan.from.y + (media.pan.to.y - media.pan.from.y) * u };
        media.look(at, 1.1);
        media.frame(1 / 30);
        o.clear();
        let on = 0,
          rows = 0;
        r.rowTrees.forEach((row, k) => {
          const b = r.treeBounds[k];
          if (!b || b.w <= 0 || !row.children.length) return;
          ++rows;
          const a = o.page(o.fromProjected({ x: b.x, y: b.y })),
            z = o.page(o.fromProjected({ x: b.x + b.w, y: b.y + b.h })),
            box = { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y };
          if (row.alpha) {
            ++on;
            o.rect(box, null, k % 2 ? 'rgba(232,190,110,0.10)' : 'rgba(120,190,180,0.10)');
            o.g.fillStyle = k % 2 ? o.accent : o.teal;
            o.g.fillRect(box.x - 6, box.y + box.h / 2 - 1, 4, 3);
          } else if (box.y + box.h > -50 && box.y < media.height + 50) o.rect(box, 'rgba(200,196,186,0.35)', null, [3, 6], 1);
        });
        const view = { x: o.x0, y: o.y0, w: media.width * o.k, h: media.height * o.k };
        o.rect(view, o.accent, null, [], 2);
        o.panel(20, 20, [
          [`tree rows switched on: ${on} of ${rows}`, o.ink],
          ['tinted: a row in view, drawn as one scene', o.accent],
          ['dashed: a row out of view, opacity 0, not even visited', o.grey],
        ]);
        o.text(20, media.height - 20, 'buildTreeRow() · cullTrees() · treeBounds · world-trees.ts', o.grey, 13, false);
      },
    });
    out.rows = await encodeVideo('opt-rows', { fps, crf: 26 });

    // 6. Lava and water update rates, from when they really move.
    const lava = await page.evaluate(async () => {
      const { lavaPatches } = await import('/packages/native-renderer/src/lava-motion.ts');
      const { E, game } = media,
        t = game.town,
        v = t.map().volcano();
      if (!v) return null;
      media.lavaPatches = lavaPatches;
      const heart = v.center();
      // Someone must see the lava for it to move: three residents stand on its slopes.
      t.folk.slice(0, 3).forEach((p, k) => {
        p.position = t.grid.nearestWalkable({ x: heart.x + 6 + k, y: heart.y + 7 });
        p.path = [];
        p.autoMode = false;
      });
      t.scout(heart.x, heart.y, 18);
      media.o.shrink(1);
      media.lavaView = { x: heart.x + 5, y: heart.y + 6 };
      media.look(media.lavaView, 0.9);
      media.frames(10, 1 / 30);
      media.ticks = [];
      media.lastWater = media.game.renderer.waterAt;
      media.lastLava = -1;
      return { heart };
    });
    if (lava) {
      await recordFrames(page, 'opt-rates', {
        count: 8 * fps,
        step: ([i]) => {
          const { o, game } = media,
            r = game.renderer,
            phase = i < 90 ? 0 : i < 180 ? 1 : 2,
            zoom = phase === 1 ? 0.45 : 0.9,
            at = phase === 2 ? { x: media.lavaView.x - 6 - (i - 180) * 0.25, y: media.lavaView.y - 14 - (i - 180) * 0.25 } : media.lavaView;
          media.look(at, zoom);
          media.frame(1 / 30);
          const patches = media.lavaPatches(r.ground);
          let sum = 0;
          for (const p of patches) for (const b of p.bands) sum += b.shape.version;
          const lavaMoved = media.lastLava >= 0 && sum !== media.lastLava,
            waterMoved = r.waterAt !== media.lastWater;
          media.lastLava = sum;
          media.lastWater = r.waterAt;
          media.ticks.push({ i, lava: lavaMoved, water: waterMoved });
          o.clear();
          if (lavaMoved)
            for (const p of patches) {
              const a = o.fromProjected({ x: p.box.x, y: p.box.y }),
                z = o.fromProjected({ x: p.box.x + p.box.w, y: p.box.y + p.box.h });
              if (p.shown) o.rect({ x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y }, 'rgba(232,150,90,0.9)', null, [], 1.5);
            }
          const recent = media.ticks.filter((k) => k.i > i - 30);
          o.panel(20, 20, [
            [phase === 0 ? 'zoom 0.9: lava 6, water 12 times a second' : phase === 1 ? 'zoom 0.45 (under 0.5): both rates halved' : 'lava out of view: it stops; water in view goes on', o.ink],
            [`last second: lava moved ${recent.filter((k) => k.lava).length}×, water ${recent.filter((k) => k.water).length}×`, o.accent],
          ]);
          // Two strips of ticks: one mark for each frame the lava or the water really moved.
          const x0 = 20,
            w = media.width - 40,
            y = media.height - 70,
            span = 8 * 30;
          o.g.fillStyle = 'rgba(20,24,22,0.85)';
          o.g.fillRect(x0 - 8, y - 26, w + 16, 66);
          o.text(x0, y - 8, 'lava', 'rgb(232,150,90)', 13);
          o.text(x0, y + 22, 'water', o.teal, 13);
          for (const k of media.ticks) {
            const x = x0 + 60 + ((w - 60) * k.i) / span;
            if (k.lava) {
              o.g.fillStyle = 'rgb(232,150,90)';
              o.g.fillRect(x, y - 20, 2, 14);
            }
            if (k.water) {
              o.g.fillStyle = o.teal;
              o.g.fillRect(x, y + 10, 2, 14);
            }
          }
          o.text(20, media.height - 4, 'updateLava() lavaRate 6 · moveWater() waterRate 12 · lava-motion.ts · water-motion.ts', o.grey, 12, false);
        },
      });
      out.rates = await encodeVideo('opt-rates', { fps, crf: 26 });
    }

    // 8. Frame cost, measured cleanly before filming: rounds of frames with nothing but the frame in the timed span.
    const load = loadavg()[0],
      cores = cpus().length;
    const cost = await page.evaluate(() => {
      const { game } = media,
        t = game.town,
        c = media.camp;
      // The fight of the perf clip: twenty residents and a hundred and fifty monsters in the densest wood near the camp.
      const measure = (zoom, at) => {
        media.look(at, zoom);
        for (let i = 0; i < 20; ++i) media.frame(1 / 60);
        const series = [],
          medians = [];
        for (let round = 0; round < 7; ++round) {
          const times = [];
          for (let i = 0; i < 30; ++i) {
            const t0 = performance.now();
            game.render(media.width, media.height, (media.now += 1 / 60), false, 1 / 60, media.now);
            media.canvas.update().render();
            times.push(performance.now() - t0);
          }
          series.push(...times);
          times.sort((a, b) => a - b);
          medians.push(times[15]);
        }
        medians.sort((a, b) => a - b);
        return { median: +medians[3].toFixed(1), series: series.map((v) => +v.toFixed(2)) };
      };
      void t;
      return { close: measure(1.2, c), wide: measure(0.5, c) };
    });
    out.cost = { closeMs: cost.close.median, wideMs: cost.wide.median, load, cores };
    await page.evaluate((cost) => (media.cost = cost), cost);
    await recordFrames(page, 'opt-cost', {
      count: 7 * fps,
      step: ([i]) => {
        const { o } = media,
          wide = i >= 105,
          series = wide ? media.cost.wide.series : media.cost.close.series;
        media.look(media.camp, wide ? 0.5 : 1.2);
        media.frame(1 / 30);
        o.clear();
        const x0 = 40,
          y0 = media.height - 40,
          w = media.width - 80,
          h = 200,
          top = Math.max(40, ...media.cost.close.series, ...media.cost.wide.series) * 1.1;
        o.g.fillStyle = 'rgba(20,24,22,0.88)';
        o.g.fillRect(x0 - 20, y0 - h - 60, w + 40, h + 80);
        for (const ms of [8, 16.7, 33.3]) {
          const y = y0 - (ms / top) * h;
          o.g.strokeStyle = 'rgba(200,196,186,0.35)';
          o.g.setLineDash([4, 5]);
          o.g.beginPath();
          o.g.moveTo(x0, y);
          o.g.lineTo(x0 + w, y);
          o.g.stroke();
          o.g.setLineDash([]);
          o.text(x0 + w - 70, y - 4, `${ms} ms`, o.grey, 12, false);
        }
        const shown = Math.min(series.length, Math.round(((wide ? i - 105 : i) / 105) * series.length * 1.6));
        o.g.strokeStyle = wide ? o.teal : o.accent;
        o.g.lineWidth = 2;
        o.g.beginPath();
        for (let k = 0; k < shown; ++k) {
          const x = x0 + (w * k) / (series.length - 1),
            y = y0 - (Math.min(series[k], top) / top) * h;
          k ? o.g.lineTo(x, y) : o.g.moveTo(x, y);
        }
        o.g.stroke();
        o.text(x0, y0 - h - 30, `${wide ? 'wide view, zoom 0.5' : 'close view, zoom 1.2'}: median ${wide ? media.cost.wide.median : media.cost.close.median} ms a frame (7 rounds of 30 frames)`, wide ? o.teal : o.accent, 16);
        o.text(x0, y0 + 16, 'timed: game.render() and canvas.update().render() only; no screenshot, no simulation step inside', o.grey, 12, false);
      },
    });
    out.costClip = await encodeVideo('opt-cost', { fps, crf: 26 });
  } finally {
    await page.context().close();
  }

  // 4 and 5. A crowd on the real skeletons, poses and outlines: what the pose bank solves and what the paths share.
  const crowd = await session.page(width, height);
  try {
    await crowd.evaluate(
      async ({ width, height }) => {
        const [{ initializeWebCanvas }, paint, goblin, { WebCanvasAdapter }, ranks, humanoid, wildlife, person] = await Promise.all([
          import('/apps/web/src/native/startup-canvas.ts'),
          import('/packages/native-renderer/src/paint.ts'),
          import('/packages/native-renderer/src/monster-goblin.ts'),
          import('/packages/native-renderer/src/webcanvas-adapter.ts'),
          import('/packages/engine/src/combat-events.ts'),
          import('/packages/native-renderer/src/humanoid-rig.ts'),
          import('/packages/native-renderer/src/wildlife-sprites.ts'),
          import('/packages/engine/src/person.ts'),
        ]);
        const tvg = await initializeWebCanvas('gl'),
          element = document.createElement('canvas');
        element.style.cssText = 'position:absolute;left:0;top:0';
        document.body.append(element);
        const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
          adapter = new WebCanvasAdapter(tvg),
          root = new paint.SceneNode().add(new paint.ShapeNode().appendRect(0, 0, width, height).fill(24, 28, 25));
        canvas.add(adapter.sync(root));
        const over = document.createElement('canvas');
        over.width = width;
        over.height = height;
        over.style.cssText = 'position:absolute;left:0;top:0';
        document.body.append(over);
        const g = over.getContext('2d');
        const kind = goblin.goblinKind(),
          bank = kind.bank,
          skeleton = bank.figure.skeleton,
          solvedCount = () => [...bank.solved.values()].reduce((s, list) => s + list.filter(Boolean).length, 0);
        // A hundred goblins in five ranks, all walking in step.
        const crowd = [],
          bankRoot = new paint.SceneNode();
        for (let i = 0; i < 100; ++i) {
          const dress = kind.dress(i + 1, ranks.MonsterRank.Grunt),
            node = new paint.SceneNode().add(dress.skin.node),
            x = 120 + (i % 20) * 54 + (Math.floor(i / 20) % 2) * 27,
            y = 250 + Math.floor(i / 20) * 92;
          node.transform([3.4, 0, x, 0, 3.4, y, 0, 0, 1]);
          bankRoot.add(node);
          crowd.push({ dress, x, y });
        }
        // Sixty cows walking in three groups, each group in step: their outlines share one path per group.
        const herd = [],
          herdRoot = new paint.SceneNode();
        for (let i = 0; i < 60; ++i) {
          const group = i % 3,
            id = group * 8 + 24 * Math.floor(i / 3),
            sprite = wildlife.animalSprite(person.AnimalKind.Cow),
            x = 110 + (i % 15) * 72 + (group % 2) * 20,
            y = 240 + Math.floor(i / 15) * 110;
          sprite.transform([3.1, 0, x, 0, 3.1, y, 0, 0, 1]);
          herdRoot.add(sprite);
          herd.push({ sprite, id, group, x, y });
        }
        const background = root.children[0];
        let clock = 0,
          scene = 'bank';
        const joints = (m, b) => {
          const x = skeleton.restX[b],
            y = skeleton.restY[b];
          return { x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5] };
        };
        window.crowd = {
          show(which) {
            scene = which;
            root.children = [background, which === 'bank' ? bankRoot : herdRoot];
            root.version++;
          },
          frame(dt) {
            clock += dt;
            g.clearRect(0, 0, width, height);
            const panel = (lines) => {
              g.font = '600 17px DejaVu Sans, Verdana, sans-serif';
              const w = Math.max(...lines.map(([s]) => g.measureText(s).width)) + 24;
              g.fillStyle = 'rgba(20,24,22,0.92)';
              g.fillRect(20, 20, w, lines.length * 27 + 14);
              lines.forEach(([s, c], i) => {
                g.fillStyle = c;
                g.fillText(s, 32, 44 + i * 27);
              });
            };
            if (scene === 'bank') {
              const before = solvedCount(),
                matrices = bank.pose(humanoid.humanoidClips.walk, clock * 30);
              for (const c of crowd) c.dress.skin.pose(matrices);
              const solved = solvedCount() - before;
              adapter.sync(root);
              canvas.update().render();
              // The one skeleton, drawn over three of the hundred.
              g.strokeStyle = 'rgba(232,190,110,0.95)';
              g.fillStyle = 'rgb(255,236,190)';
              g.lineWidth = 2;
              for (const c of [crowd[21], crowd[47], crowd[73]])
                for (let b = 0; b < skeleton.count; ++b) {
                  const p = skeleton.parents[b],
                    j = joints(matrices[b], b),
                    k = 3.4;
                  if (p >= 0) {
                    const q = joints(matrices[p], p);
                    g.beginPath();
                    g.moveTo(c.x + q.x * k, c.y + q.y * k);
                    g.lineTo(c.x + j.x * k, c.y + j.y * k);
                    g.stroke();
                  }
                  g.beginPath();
                  g.arc(c.x + j.x * k, c.y + j.y * k, 2.5, 0, 7);
                  g.fill();
                }
              panel([
                [`figures drawn: ${crowd.length} · skeletons solved this frame: ${solved}`, solved ? 'rgb(226,104,84)' : 'rgb(120,190,180)'],
                [`poses held in the bank: ${solvedCount()} (one per clip frame, then reused)`, 'rgba(245,238,222,0.96)'],
                ['PoseBank.pose() · rig-pose-bank.ts', 'rgba(200,196,186,0.75)'],
              ]);
            } else {
              for (const h of herd) wildlife.poseAnimal(h.sprite, false, true, clock, h.id, 1);
              adapter.sync(root);
              canvas.update().render();
              // The outline shapes of each cow: a group in step holds the very same command list.
              const pathsOf = (h) => {
                const skin = h.sprite.children[1].children[0];
                return skin.children.filter((c) => c.type === 'shape' && c.commands.length).map((c) => c.commands);
              };
              // Only the outlines are posed through shared lists; a list met on more than one cow is shared.
              const counts = new Map();
              for (const h of herd) for (const cmds of pathsOf(h)) counts.set(cmds, (counts.get(cmds) ?? 0) + 1);
              const distinct = new Map([...counts].filter(([, n]) => n > 1));
              const colors = ['rgb(232,190,110)', 'rgb(120,190,180)', 'rgb(226,104,84)'];
              for (const h of herd) {
                g.strokeStyle = colors[h.group];
                g.lineWidth = 2;
                g.beginPath();
                g.ellipse(h.x, h.y - 14, 34, 26, 0, 0, 7);
                g.stroke();
              }
              const outlines = [...distinct.values()].reduce((s, n) => s + n, 0);
              panel([
                [`outline shapes drawn: ${outlines} · distinct paths this frame: ${distinct.size}`, 'rgba(245,238,222,0.96)'],
                ['ringed by colour: animals in step, sharing each outline path', 'rgb(232,190,110)'],
                ['SkinnedPath.commands() cached per pose · rig-skinned-path.ts · RigSkin.pose()', 'rgba(200,196,186,0.75)'],
              ]);
            }
          },
        };
      },
      { width, height },
    );
    await crowd.evaluate(() => window.crowd.show('bank'));
    await recordFrames(crowd, 'opt-bank', { count: 5 * fps, step: () => window.crowd.frame(1 / 30) });
    out.bank = await encodeVideo('opt-bank', { fps, crf: 26 });
    await crowd.evaluate(() => window.crowd.show('herd'));
    await recordFrames(crowd, 'opt-paths', { count: 4 * fps, step: () => window.crowd.frame(1 / 30) });
    out.paths = await encodeVideo('opt-paths', { fps, crf: 26 });
  } finally {
    await crowd.context().close();
  }

  // 7. Budgets held by tests: the combat layer's own measurement and each lair's swarmer shape count.
  const test = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.regression.config.ts', 'tests/regression/combat-effects.test.ts', '-t', 'keeps a crowd of 150 cheap'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }),
    measured = Number(/(\d+\.\d+) ms a frame \(JS update\)/.exec(test.stderr + test.stdout)?.[1] ?? NaN);
  const chart = await session.page(width, height);
  try {
    const shapes = await chart.evaluate(async () => {
      const [paint, figures, ranks, world] = await Promise.all([
        import('/packages/native-renderer/src/paint.ts'),
        import('/packages/native-renderer/src/monster-figures.ts'),
        import('/packages/engine/src/combat-events.ts'),
        import('/packages/engine/src/world-types.ts'),
      ]);
      const count = (node) => (node instanceof paint.SceneNode ? node.children.reduce((s, c) => s + count(c), 0) : node instanceof paint.ShapeNode ? 1 : 0);
      const out = {};
      for (const [name, lair] of [
        ['goblin', world.DungeonKind.Ruin],
        ['warg', world.DungeonKind.Cave],
        ['draugr', world.DungeonKind.Crypt],
        ['imp', world.DungeonKind.Portal],
      ]) {
        const body = new paint.SceneNode();
        figures.monsterBody(body, lair, 1, ranks.MonsterRank.Swarmer);
        out[name] = count(body);
      }
      return out;
    });
    out.budgets = { combatLayerMs: measured, limitMs: 4, swarmerShapes: shapes, swarmerLimit: 12, testExit: test.status };
    await chart.evaluate(
      ({ budgets }) => {
        const c = document.createElement('canvas');
        c.width = 1280;
        c.height = 720;
        document.body.style.margin = '0';
        document.body.append(c);
        const g = c.getContext('2d');
        window.chart = (u) => {
          g.fillStyle = '#181c19';
          g.fillRect(0, 0, 1280, 720);
          g.font = '600 26px DejaVu Sans, Verdana, sans-serif';
          g.fillStyle = 'rgb(232,190,110)';
          g.fillText('Budgets the regression tests hold', 60, 80);
          const bar = (y, label, value, limit, unit, source) => {
            const w = 900,
              shown = Math.min(value, limit * 1.2) * Math.min(1, u * 1.4);
            g.font = '600 19px DejaVu Sans, Verdana, sans-serif';
            g.fillStyle = 'rgba(245,238,222,0.96)';
            g.fillText(label, 60, y - 16);
            g.fillStyle = 'rgba(255,255,255,0.08)';
            g.fillRect(60, y, w, 30);
            g.fillStyle = value <= limit ? 'rgb(120,190,180)' : 'rgb(226,104,84)';
            g.fillRect(60, y, (w * shown) / (limit * 1.2), 30);
            const lx = 60 + w / 1.2;
            g.strokeStyle = 'rgb(232,190,110)';
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(lx, y - 8);
            g.lineTo(lx, y + 38);
            g.stroke();
            g.font = '600 16px DejaVu Sans, Verdana, sans-serif';
            g.fillStyle = 'rgb(232,190,110)';
            g.fillText(`limit ${limit} ${unit}`, lx + 8, y + 52);
            g.fillStyle = 'rgba(245,238,222,0.96)';
            g.fillText(`${value} ${unit}`, 70, y + 21);
            g.font = '14px DejaVu Sans, Verdana, sans-serif';
            g.fillStyle = 'rgba(200,196,186,0.8)';
            g.fillText(source, 60, y + 52);
          };
          bar(170, 'Combat layer update, 150 monsters and 60 blows a second (per frame, JS)', budgets.combatLayerMs, budgets.limitMs, 'ms', 'tests/regression/combat-effects.test.ts · "keeps a crowd of 150 cheap" · measured now in Node');
          let y = 330;
          for (const [name, n] of Object.entries(budgets.swarmerShapes)) {
            bar(y, `Shapes in a ${name} swarmer`, n, budgets.swarmerLimit, 'shapes', 'tests/regression/rig-system.test.ts · "keeps lair … within a crowd’s paint budget"');
            y += 100;
          }
        };
      },
      { budgets: out.budgets },
    );
    await recordFrames(chart, 'opt-budgets', { count: 3 * fps, arg: 3 * fps, step: ([i, n]) => window.chart(i / (n - 1)) });
    out.budgetsClip = await encodeVideo('opt-budgets', { fps, crf: 26 });
  } finally {
    await chart.context().close();
  }
  return out;
}
