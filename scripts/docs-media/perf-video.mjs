// The frame cost of a large fight: 20 residents and 150 monsters in a forest, drawn by the game, with the measured
// time of each frame (update, sync to ThorVG and draw call) printed over it. Set up as the "ghosts" part of
// tests/regression/environment.browser.mjs does.
import { bootGame } from '../readme-media/capture-session.mjs';
import { encodeVideo, recordFrames } from './video-assembly.mjs';

export async function capturePerfVideo(session) {
  const width = 1280,
    height = 720,
    fps = 30,
    page = await session.page(width, height);
  try {
    await bootGame(page, { width, height, hud: false });
    const setup = await page.evaluate(async () => {
      const { MonsterRank } = await import('/packages/engine/src/combat-events.ts');
      const { E, game } = media,
        t = game.town,
        map = t.map(),
        c = map.camp();
      t.summonRaid = () => {};
      let best = -1,
        dense = null;
      for (let y = Math.floor(c.y) - 30; y < c.y + 30; ++y)
        for (let x = Math.floor(c.x) - 30; x < c.x + 30; ++x) {
          if (!map.inside(x - 4, y - 4) || !map.inside(x + 4, y + 4) || !map.at(x, y).trees) continue;
          let n = 0;
          for (let dy = -4; dy <= 4; ++dy) for (let dx = -4; dx <= 4; ++dx) n += map.at(x + dx, y + dy).trees;
          if (n > best) [best, dense] = [n, { x: x + 0.5, y: y + 0.5 }];
        }
      t.scout(dense.x, dense.y, 22);
      media.hour(11);
      const callings = [E.Calling.Warrior, E.Calling.Ranger, E.Calling.Mage, E.Calling.Cleric, E.Calling.Bard],
        arms = ['sword', 'bow', 'staff', 'mace', 'mace'];
      t.folk = [];
      for (let i = 0; i < 20; ++i) {
        const a = (i * Math.PI * 2) / 20,
          r = i < 8 ? 0.8 : 1.8,
          q = t.grid.nearestWalkable({ x: dense.x + r * Math.cos(a), y: dense.y + r * Math.sin(a) }),
          p = t.makePerson(E.Role.Resident, callings[i % 5], { ...q });
        p.position = { ...q };
        p.level = 12;
        p.food = p.rest = p.hydration = 1;
        t.folk.push(p);
        if (E.addInventory(p, arms[i % 5])) t.equipItem(p.id, p.inventory.findIndex((s) => s?.item === arms[i % 5]) + 1, 'weapon');
      }
      const lair = map.dungeons().findIndex((d) => d.kind === 1);
      for (let i = 0; i < 150; ++i) {
        const a = i * 2.39996,
          r = 3 + 4.5 * Math.sqrt((i + 0.5) / 150),
          m = new E.Monster(t.nextMonster++, Math.max(0, lair), { x: dense.x + r * Math.cos(a), y: dense.y + r * Math.sin(a) });
        m.rank = i % 25 === 0 ? MonsterRank.Brute : i % 6 === 0 ? MonsterRank.Grunt : MonsterRank.Swarmer;
        m.vigor = m.health = 400;
        m.angry = true;
        t.beasts.push(m);
      }
      t.changes++;
      media.view = dense;
      media.times = [];
      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;left:24px;top:20px;padding:10px 14px;border-radius:6px;background:rgba(20,24,22,.86);color:#f2ead8;font:600 17px/1.5 DejaVu Sans,Verdana,sans-serif;white-space:pre';
      document.body.append(label);
      media.costLabel = label;
      const gl = document.createElement('canvas').getContext('webgl2'),
        info = gl?.getExtension('WEBGL_debug_renderer_info');
      media.gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown GPU';
      for (let i = 0; i < 30; ++i) {
        t.advance(1 / 30);
        media.look(dense, 1.2);
        media.frame(1 / 30);
      }
      return { trees: best, gpu: media.gpu };
    });
    // Measured cleanly first: rounds of frames with only the frame in the timed span (no screenshot readback).
    const clean = await page.evaluate(() => {
      const { game } = media,
        measure = (zoom) => {
          media.look(media.view, zoom);
          for (let i = 0; i < 20; ++i) media.frame(1 / 60);
          const medians = [];
          for (let round = 0; round < 7; ++round) {
            const times = [];
            for (let i = 0; i < 30; ++i) {
              const t0 = performance.now();
              game.render(media.width, media.height, (media.now += 1 / 60), false, 1 / 60, media.now);
              media.canvas.update().render();
              times.push(performance.now() - t0);
            }
            times.sort((a, b) => a - b);
            medians.push(times[15]);
          }
          medians.sort((a, b) => a - b);
          return +medians[3].toFixed(1);
        };
      return { closeMs: measure(1.2), wideMs: measure(0.55) };
    });
    const frames = await recordFrames(page, 'perf', {
      count: 9 * fps,
      step: ([i]) => {
        const t = media.town,
          zoom = i < 135 ? 1.2 : 0.55;
        t.advance(1 / 30);
        media.look(media.view, zoom);
        const t0 = performance.now();
        media.frame(1 / 30);
        media.times.push(performance.now() - t0);
        const recent = media.times.slice(-30).sort((a, b) => a - b),
          median = recent[Math.floor(recent.length / 2)],
          foes = t.beasts.filter((m) => m.health > 0).length,
          folk = t.people().filter((p) => p.health > 0).length;
        media.costLabel.textContent = `${folk} residents · ${foes} monsters · zoom ${zoom}\nframe: ${median.toFixed(1)} ms (median of 30: update, sync, draw call)\n${media.gpu}`;
      },
    });
    const times = await page.evaluate(() => {
      const near = media.times.slice(30, 135).sort((a, b) => a - b),
        far = media.times.slice(165).sort((a, b) => a - b);
      return { nearMs: +near[Math.floor(near.length / 2)].toFixed(1), farMs: +far[Math.floor(far.length / 2)].toFixed(1), gpu: media.gpu };
    });
    return { setup, clean, perf: { ...(await encodeVideo('perf', { fps, width: 1280, crf: 24 })), frames: frames.frames, ...times } };
  } finally {
    await page.context().close();
  }
}
