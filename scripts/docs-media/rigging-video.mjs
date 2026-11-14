// One clip, many bodies: Thor and four monsters on the shared skeleton, each playing the same humanoid clip (the warg
// its quadruped one), with the solved skeleton drawn over the art. Art and poses are the game's own code
// (thor-figure.ts, monster-*.ts, rig-pose-bank.ts); the skeleton lines are drawn over it by this page.
import { encodeVideo, recordFrames } from './video-assembly.mjs';

export async function captureRiggingVideo(session) {
  const width = 1280,
    height = 720,
    fps = 30,
    page = await session.page(width, height);
  try {
    await page.evaluate(
      async ({ width, height }) => {
        const [{ initializeWebCanvas }, paint, thor, goblin, draugr, imp, jotunn, warg, humanoid, quadruped, ranks] = await Promise.all([
          import('/apps/web/src/native/startup-canvas.ts'),
          import('/packages/native-renderer/src/paint.ts'),
          import('/packages/native-renderer/src/thor-figure.ts'),
          import('/packages/native-renderer/src/monster-goblin.ts'),
          import('/packages/native-renderer/src/monster-draugr.ts'),
          import('/packages/native-renderer/src/monster-imp.ts'),
          import('/packages/native-renderer/src/monster-jotunn.ts'),
          import('/packages/native-renderer/src/monster-warg.ts'),
          import('/packages/native-renderer/src/humanoid-rig.ts'),
          import('/packages/native-renderer/src/quadruped-rig.ts'),
          import('/packages/engine/src/combat-events.ts'),
        ]);
        const { WebCanvasAdapter } = await import('/packages/native-renderer/src/webcanvas-adapter.ts');
        const tvg = await initializeWebCanvas('gl'),
          element = document.createElement('canvas');
        element.style.cssText = 'position:absolute;left:0;top:0';
        document.body.append(element);
        const canvas = new tvg.Canvas(element, { width, height, enableDevicePixelRatio: false }),
          adapter = new WebCanvasAdapter(tvg),
          root = new paint.SceneNode(),
          ground = new paint.ShapeNode().appendRect(0, 0, width, height).fill(20, 24, 22);
        root.add(ground);
        const floor = 560;
        root.add(new paint.ShapeNode().appendRect(60, floor, width - 120, 2).fill(70, 74, 64));
        const overlay = document.createElement('canvas');
        overlay.width = width;
        overlay.height = height;
        overlay.style.cssText = 'position:absolute;left:0;top:0';
        document.body.append(overlay);
        const g = overlay.getContext('2d');
        // Five bodies, feet on one line, each drawn about the same height.
        const figures = [];
        const parts = thor.thorParts();
        figures.push({ name: 'Thor', node: parts.node, top: thor.thorHeight, thor: parts });
        for (const [name, make] of [
          ['Goblin', goblin.goblinKind],
          ['Draugr', draugr.draugrKind],
          ['Imp', imp.impKind],
          ['Jotunn', jotunn.jotunnKind],
          ['Warg', warg.wargKind],
        ]) {
          const kind = make(),
            dress = kind.dress(3, ranks.MonsterRank.Grunt),
            node = new paint.SceneNode().add(dress.skin.node);
          figures.push({ name, node, top: kind.top, kind, dress, quadruped: name === 'Warg' });
        }
        figures.forEach((f, i) => {
          f.scale = 220 / f.top;
          f.x = 150 + i * 196;
          f.y = floor;
          f.node.transform([f.scale, 0, f.x, 0, f.scale, f.y, 0, 0, 1]);
          root.add(f.node);
        });
        const labels = figures.map((f) => {
          const div = document.createElement('div');
          div.textContent = f.name;
          div.style.cssText = `position:absolute;top:${floor + 22}px;left:${f.x - 80}px;width:160px;text-align:center;color:#d8cfb8;font:600 18px DejaVu Sans,Verdana,sans-serif`;
          document.body.append(div);
          return div;
        });
        const title = document.createElement('div');
        title.style.cssText = 'position:absolute;top:34px;left:0;right:0;text-align:center;color:#e9dfc6;font:600 24px DejaVu Sans,Verdana,sans-serif';
        const sub = document.createElement('div');
        sub.style.cssText = 'position:absolute;top:72px;left:0;right:0;text-align:center;color:#a99c7d;font:16px DejaVu Sans,Verdana,sans-serif';
        document.body.append(title, sub);
        void labels;
        // The program: the same clip on every humanoid at once; the warg runs its own four-legged version.
        const H = humanoid.humanoidClips,
          Q = quadruped.quadrupedClips,
          program = [
            { seconds: 3.2, human: H.walk, beast: Q.walk, name: 'walk' },
            { seconds: 2.4, human: H.slash, beast: Q.bite, name: 'slash' },
            { seconds: 2.4, human: H.chop, beast: Q.bite, name: 'chop' },
            { seconds: 2.4, human: H.shout, beast: Q.idle, name: 'shout' },
          ];
        const length = program.reduce((s, p) => s + p.seconds, 0);
        const bones = (skeleton, joint) => {
          for (let b = 0; b < skeleton.count; ++b) {
            const p = skeleton.parents[b];
            if (p < 0) continue;
            const a = joint(p),
              c = joint(b);
            g.beginPath();
            g.moveTo(a.x, a.y);
            g.lineTo(c.x, c.y);
            g.stroke();
          }
          for (let b = 0; b < skeleton.count; ++b) {
            const j = joint(b);
            g.beginPath();
            g.arc(j.x, j.y, 3.2, 0, Math.PI * 2);
            g.fill();
          }
        };
        let clock = 0;
        window.rig = {
          frame(dt) {
            clock += dt;
            const t = clock % length;
            let at = 0,
              step = program[0];
            for (const p of program) {
              if (t < at + p.seconds) {
                step = p;
                break;
              }
              at += p.seconds;
            }
            const local = (t - at) * 30;
            title.textContent = `One clip, six bodies: ${step.name}`;
            sub.textContent = `humanoid-${step.name}.json · ${step.human.frames} frames at 30 fps · joint-angle targets solved on each body's own bone lengths`;
            g.clearRect(0, 0, width, height);
            g.strokeStyle = 'rgba(232,190,110,0.95)';
            g.fillStyle = 'rgba(255,236,190,1)';
            g.lineWidth = 2;
            for (const f of figures) {
              const clip = f.quadruped ? step.beast : step.human,
                frame = local % clip.frames;
              let skeleton, joint;
              if (f.thor) {
                f.thor.figure.play(clip, frame, dt, 0);
                f.thor.skin.pose(Array.from({ length: f.thor.figure.skeleton.count }, (_, b) => f.thor.figure.frame.matrix(b)));
                skeleton = f.thor.figure.skeleton;
                const fr = f.thor.figure.frame;
                joint = (b) => ({ x: f.x + fr.jointX[b] * f.scale, y: f.y + fr.jointY[b] * f.scale });
              } else {
                const matrices = f.kind.bank.pose(clip, frame);
                f.dress.skin.pose(matrices);
                skeleton = f.kind.bank.figure.skeleton;
                joint = (b) => {
                  const m = matrices[b],
                    x = skeleton.restX[b],
                    y = skeleton.restY[b];
                  return { x: f.x + (m[0] * x + m[1] * y + m[2]) * f.scale, y: f.y + (m[3] * x + m[4] * y + m[5]) * f.scale };
                };
              }
              f.joint = joint;
              f.skeleton = skeleton;
            }
            adapter.sync(root);
            canvas.update().render();
            for (const f of figures) bones(f.skeleton, f.joint);
          },
        };
        window.rigCanvas = { canvas, adapter, root };
      },
      { width, height },
    );
    // Hook the synced root to the canvas once (the adapter returns the root's native paint).
    await page.evaluate(() => {
      const { canvas, adapter, root } = window.rigCanvas;
      canvas.add(adapter.sync(root));
    });
    const frames = await recordFrames(page, 'rigging', {
      count: Math.round(10.4 * fps),
      step: ([, dt]) => window.rig.frame(dt),
      arg: 1 / fps,
    });
    return { rigging: { ...(await encodeVideo('rigging', { fps, width: 1280, crf: 22 })), frames: frames.frames } };
  } finally {
    await page.context().close();
  }
}
