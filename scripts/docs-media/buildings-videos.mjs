// Buildings as 3D block models drawn as 2D vector shapes: one smithy built up from its blocks (the boxes, the faces
// and their tones, the hidden-surface order, then the game's own Lottie frame), its construction rise, a turn
// through placement angles, and the Building Studio editing a block. All geometry comes from the game's own
// functions (building-model.ts, building-faces.ts, building-depth.ts, building-animation.ts); the page only draws
// the wireframe and labels over it.
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bootGame } from '../readme-media/capture-session.mjs';
import { docsWork, encodeVideo, recordFrames } from './video-assembly.mjs';

const width = 1280,
  height = 720,
  fps = 30;

export async function captureBuildingVideos(session) {
  const out = {},
    page = await session.page(width, height);
  try {
    await bootGame(page, { width, height, hud: false });
    out.model = await page.evaluate(async () => {
      const [paint, { WebCanvasAdapter }, assets, anim, faces, depth, model, catalog, geometry] = await Promise.all([
        import('/packages/native-renderer/src/paint.ts'),
        import('/packages/native-renderer/src/webcanvas-adapter.ts'),
        import('/packages/native-renderer/src/building-assets.ts'),
        import('/packages/native-renderer/src/building-animation.ts'),
        import('/packages/native-renderer/src/building-faces.ts'),
        import('/packages/native-renderer/src/building-depth.ts'),
        import('/packages/native-renderer/src/building-model.ts'),
        import('/packages/engine/src/building-catalog.ts'),
        import('/packages/engine/src/geometry.ts'),
      ]);
      const kind = catalog.Structure.Weaponsmith,
        variant = 2,
        size = catalog.structureSpec(kind).size,
        k = 6.5,
        cx = 640,
        cy = 560;
      // The game's world is taken off this canvas; one root holds the building's own ThorVG animation.
      media.canvas.remove();
      const adapter = new WebCanvasAdapter(media.tvg),
        root = new paint.SceneNode().add(new paint.ShapeNode().appendRect(0, 0, 1280, 720).fill(24, 28, 25));
      media.canvas.add(adapter.sync(root));
      const over = document.createElement('canvas');
      over.width = 1280;
      over.height = 720;
      over.style.cssText = 'position:absolute;left:0;top:0';
      document.body.append(over);
      const g = over.getContext('2d');
      const build = (angle) => {
        const m = assets.structureModel(kind, variant),
          turn = model.splitAngle(angle);
        model.orientModel(m, turn.quarterTurns, size);
        const motion = new faces.Motion();
        motion.turn = turn.remainder;
        motion.pivot = geometry.point(size / 2, size / 2);
        const fs = faces.buildingFaces(m, motion);
        return { m, fs, batches: depth.depthBatches(fs, 1000) };
      };
      const still = (angle, rise) => {
        const a = rise ? assets.riseAnimation(kind, variant, [], angle) : anim.buildingStillAnimation(assets.structureModel(kind, variant), size, angle),
          node = new paint.AnimationNode(a.json);
        node.transform([k, 0, cx - a.originX * k, 0, k, cy - a.originY * k, 0, 0, 1]);
        return { a, node };
      };
      const proj = new model.BuildingProjection(),
        S = (p) => ({ x: cx + p.x * k, y: cy + p.y * k }),
        poly = (pts, stroke, fill, w = 1.5) => {
          g.beginPath();
          pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
          g.closePath();
          if (fill) {
            g.fillStyle = fill;
            g.fill();
          }
          if (stroke) {
            g.strokeStyle = stroke;
            g.lineWidth = w;
            g.stroke();
          }
        },
        rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`,
        panel = (lines, src) => {
          g.font = '600 17px DejaVu Sans, Verdana, sans-serif';
          const w = Math.max(...lines.map(([s]) => g.measureText(s).width)) + 24;
          g.fillStyle = 'rgba(20,24,22,0.92)';
          g.fillRect(20, 20, w, lines.length * 27 + 14);
          lines.forEach(([s, c], i) => {
            g.fillStyle = c;
            g.fillText(s, 32, 44 + i * 27);
          });
          if (src) {
            g.font = '13px DejaVu Sans, Verdana, sans-serif';
            g.fillStyle = 'rgba(200,196,186,0.8)';
            g.fillText(src, 20, 700);
          }
        };
      const accent = 'rgb(232,190,110)',
        ink = 'rgba(245,238,222,0.96)',
        base = build(0);
      const box = (b) => {
        const lo = b.base,
          hi = b.base + b.wall;
        const c = [
          [b.x0, b.y0],
          [b.x1, b.y0],
          [b.x1, b.y1],
          [b.x0, b.y1],
        ];
        return { bottom: c.map(([x, y]) => S(proj.project(x, y, lo))), top: c.map(([x, y]) => S(proj.project(x, y, hi))) };
      };
      // Which colour role a face plays, matched against its block's own colours.
      const role = (face) => {
        for (const b of base.m.blocks) {
          const same = (c) => c && face.color && c[0] === face.color[0] && c[1] === face.color[1] && c[2] === face.color[2];
          if (same(b.wallLit)) return 'wall lit';
          if (same(b.wallShade)) return 'wall shade';
          if (same(b.roofLit)) return 'roof lit';
          if (same(b.roofShade)) return 'roof shade';
        }
        return 'detail';
      };
      let shown = null;
      const show = (node) => {
        if (shown) root.children = root.children.filter((c) => c !== shown);
        shown = node;
        if (node) root.add(node);
        root.version++;
        adapter.sync(root);
        media.canvas.update().render();
      };
      window.bld = {
        frames: { blocks: 60, faces: 60, order: 90, final: 45, rise: 0, turn: 120 },
        blocks(i) {
          show(null);
          g.clearRect(0, 0, 1280, 720);
          const n = Math.min(base.m.blocks.length, 1 + Math.floor((i / 50) * base.m.blocks.length));
          base.m.blocks.slice(0, n).forEach((b, j) => {
            const { bottom, top } = box(b);
            g.setLineDash(j === n - 1 ? [] : [4, 4]);
            poly(bottom, 'rgba(232,190,110,0.5)');
            poly(top, accent);
            for (let q = 0; q < 4; ++q) {
              g.beginPath();
              g.moveTo(bottom[q].x, bottom[q].y);
              g.lineTo(top[q].x, top[q].y);
              g.stroke();
            }
            g.setLineDash([]);
          });
          const b = base.m.blocks[n - 1];
          panel(
            [
              ['1 · Blocks: boxes in tile space, data in the asset', accent],
              [`block ${n} of ${base.m.blocks.length}: bounds [${[b.x0, b.y0, b.x1, b.y1].map((v) => +v.toFixed(2)).join(', ')}], wall ${+b.wall.toFixed(1)}, roof ${+b.roof.toFixed(1)} (${model.RoofShape[b.shape]})`, ink],
              ['projected 2:1 isometric: x = (x - y)·32, y = (x + y)·16 - z', ink],
            ],
            'packages/content/assets/buildings/weaponsmith.json · building-model.ts BuildingProjection',
          );
        },
        faces(i) {
          show(null);
          g.clearRect(0, 0, 1280, 720);
          const counts = {};
          base.fs.forEach((f) => {
            const r = role(f);
            counts[r] = (counts[r] ?? 0) + 1;
            const pts = f.shape(1000).map(S);
            if (pts.length < 2) return;
            const tone = r === 'wall lit' || r === 'roof lit' ? 'rgba(232,190,110,0.55)' : r === 'detail' ? 'rgba(160,160,160,0.3)' : 'rgba(110,140,170,0.55)';
            poly(pts, ink, i > 20 ? tone : null, 1);
          });
          panel(
            [
              ['2 · Faces: only what can face the camera is made', accent],
              ['front-left walls take the lit colour, front-right walls the shade colour; no back walls', ink],
              [`${base.fs.length} faces: ${Object.entries(counts).map(([r, n]) => `${n} ${r}`).join(', ')}`, ink],
              ['gold = lit, blue = shade: a fixed role per face, no sun or normal maths', ink],
            ],
            'building-faces.ts buildingFaces · wallFaces · roofFaces',
          );
        },
        order(i) {
          show(null);
          g.clearRect(0, 0, 1280, 720);
          const n = Math.min(base.batches.length, Math.floor((i / 80) * base.batches.length) + 1);
          base.batches.slice(0, n).forEach((bt, j) => {
            const f = base.fs[bt.source];
            for (const p of bt.polygons) {
              const pts = p.map(S);
              if (bt.line) {
                g.strokeStyle = rgb(faces.softEdge(f));
                g.lineWidth = 1.5;
                g.beginPath();
                pts.forEach((q, z) => (z ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
                g.stroke();
              } else poly(pts, j === n - 1 ? accent : null, rgb(f.color), 2);
            }
          });
          panel(
            [
              [`3 · Hidden surfaces: ${n} of ${base.batches.length} batches, back to front`, accent],
              ['faces cut into convex pieces, a BSP tree built in screen x, y and depth,', ink],
              ['then walked back to front: a painter’s order with no overlap left ambiguous', ink],
            ],
            'building-depth.ts depthOrder (partition) · depthBatches · building-model.ts sortModel',
          );
        },
        final(i) {
          g.clearRect(0, 0, 1280, 720);
          if (i === 0) {
            const s = still(0, false);
            s.node.frame(Math.max(0, s.a.frames - 1));
            show(s.node);
          } else media.canvas.update().render();
          panel(
            [
              ['4 · One Lottie animation, drawn by ThorVG', accent],
              ['each depth slot a group of hold-keyed paths, a vertical gradient fill and a soft stroke', ink],
              ['loaded once as tvg.Animation; each frame only picks a frame number', ink],
            ],
            'building-animation.ts animation · webcanvas-adapter.ts (AnimationNode) · world-animation.ts',
          );
        },
        rise(i) {
          g.clearRect(0, 0, 1280, 720);
          if (i === 0) {
            this.r = still(0, true);
            show(this.r.node);
            this.frames.rise = this.r.a.frames + 20;
          }
          this.r.node.frame(Math.min(this.r.a.frames - 1, i));
          adapter.sync(root);
          media.canvas.update().render();
          panel(
            [
              ['5 · Construction: block by block', accent],
              ['each block waits its delay, walls grow, then the roof, then details', ink],
              [`frame ${Math.min(this.r.a.frames - 1, i)} of ${this.r.a.frames} · in play the frame follows the build progress`, ink],
            ],
            'building-faces.ts Motion.wall / roof / detail · world-animation.ts',
          );
        },
        turn(i) {
          g.clearRect(0, 0, 1280, 720);
          const angle = (i / 120) * Math.PI * 2,
            s = still(angle, false);
          s.node.frame(Math.max(0, s.a.frames - 1));
          show(s.node);
          const t = model.splitAngle(angle);
          panel(
            [
              [`Placement angle ${Math.round((angle * 180) / Math.PI)}°`, accent],
              [`${t.quarterTurns} quarter turn(s) rewrite the model; the rest turns it smoothly`, ink],
              ['faces are made and ordered again; the lit side stays the screen’s front-left', ink],
            ],
            'building-model.ts splitAngle · orientModel · building-faces.ts Motion.place',
          );
        },
      };
      return {
        kind: 'Weaponsmith',
        variant,
        blocks: base.m.blocks.length,
        patches: base.m.patches?.length ?? 0,
        faces: base.fs.length,
        batches: base.batches.length,
      };
    });
    const folder = resolve(docsWork, 'frames', 'buildings');
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true });
    let n = 0;
    const { screenshot } = { screenshot: (p) => page.screenshot({ path: p }) };
    for (const step of ['blocks', 'faces', 'order', 'final', 'rise']) {
      for (let i = 0; ; ++i) {
        await page.evaluate(([s, i]) => window.bld[s](i), [step, i]);
        await screenshot(resolve(folder, `${String(n++).padStart(4, '0')}.png`));
        const limit = await page.evaluate((s) => window.bld.frames[s], step);
        if (i + 1 >= limit) break;
      }
    }
    out.build = await encodeVideo('buildings', { source: folder, fps, crf: 24 });
    await recordFrames(page, 'buildings-turn', { count: 120, step: ([i]) => window.bld.turn(i) });
    out.turn = await encodeVideo('buildings-turn', { fps, crf: 25 });
  } finally {
    await page.context().close();
  }
  // The Building Studio: a block of the cottage made taller and its roof changed, the preview rebuilding.
  try {
    const studio = await session.page(width, height, '/?test&renderer=gl&seed=5&building-studio');
    try {
      await studio.waitForFunction(() => !!window.goldfantasy || !!document.querySelector('#startup-error'), {}, { timeout: 120000 });
      const info = await studio.evaluate(() => {
        const rt = window.goldfantasy;
        rt.host.stop();
        rt.host.render(0);
        rt.host.render(0.1);
        const game = rt.app.gameSession?.game ?? rt.app.editorSession?.game,
          editor = game?.buildings;
        if (!editor) throw Error(`No studio: ${rt.app.current}`);
        window.studio = { rt, game, editor, t: 1 };
        return { current: rt.app.current };
      });
      out.studioInfo = info;
      const edits = [
        [20, 'select.block', '0'],
        [45, 'property', 'wall=30'],
        [70, 'property', 'wall=38'],
        [95, 'property', 'shape=3'],
        [125, 'property', 'roof=22'],
        [150, 'property', 'windows=3'],
      ];
      await recordFrames(studio, 'studio', {
        count: 190,
        arg: edits,
        step: ([i, edits]) => {
          const { rt, game, editor } = window.studio;
          for (const [at, name, value] of edits) if (i === at) editor.command(name, value);
          window.studio.t += 1 / 30;
          rt.host.render(window.studio.t);
        },
      });
      out.studio = await encodeVideo('buildings-studio', { source: resolve(docsWork, 'frames', 'studio'), fps, crf: 25 });
    } finally {
      await studio.context().close();
    }
  } catch (error) {
    out.studioError = String(error.message ?? error);
  }
  return out;
}
