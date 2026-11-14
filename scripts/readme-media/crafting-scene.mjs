// Items are made in the world: a founder makes a wooden axe at the workbench, then two founders fell trees side by
// side, one with the new axe and one by hand. As in tests/regression/workbench.browser.mjs, with the camp and the
// bench put up at once (staged) so the clips are about the work.
import { bootGame, recordGif, wants } from './capture-session.mjs';

export async function captureCrafting(session) {
  const out = {},
    page = await session.page(1280, 720);
  try {
    await bootGame(page, { width: 1280, height: 720 });
    out.setup = await page.evaluate(() => {
      const { E, game } = media,
        t = game.town,
        c = t.map().camp();
      t.summonRaid = () => {};
      t.releaseMonster = () => {};
      t.scout(c.x, c.y, 30);
      if (!t.place(E.Structure.Camp, c, 0)) throw Error('Cannot place the camp');
      t.completeConstruction();
      let bench = null;
      for (let r = 2.5; r < 9 && !bench; r += 0.5)
        for (let a = 0; a < 24 && !bench; ++a) {
          const at = { x: c.x + r * Math.cos((a * Math.PI) / 12), y: c.y + r * Math.sin((a * Math.PI) / 12) };
          if (t.canPlace(E.Structure.Workbench, at, 0).ok && t.place(E.Structure.Workbench, at, 0)) bench = t.buildings().at(-1);
        }
      if (!bench) throw Error('No room for the workbench');
      t.completeConstruction();
      t.stock().wood += 20;
      for (const p of t.people()) p.food = p.rest = p.hydration = 1;
      media.hour(10);
      media.bench = bench.id;
      media.crafter = t.people()[0].id;
      if (!t.orderCraft(media.crafter, bench.id, 'wooden-axe')) throw Error('The axe cannot be ordered: ' + t.craftReason(media.crafter, bench.id, 'wooden-axe'));
      media.live(60, () => t.person(media.crafter).activity === E.Activity.Crafting && !t.person(media.crafter).moving());
      game.objectivesCollapsed = true;
      game.selectPeople([]);
      media.look({ x: bench.center.x, y: bench.center.y - 0.2 }, 4);
      media.quiet();
      media.frames(6, 0.1);
      return { bench: bench.id, crafter: media.crafter, at: media.screen(bench.center) };
    });
    if (wants('workbench'))
      out.workbench = await recordGif(page, 'workbench', {
        count: 400,
        keep: 60,
        fps: 12,
        width: 640,
        // Close on the bench: the crafter's work and the progress over it.
        clip: { x: Math.round(out.setup.at.x - 340), y: Math.round(out.setup.at.y - 230), width: 640, height: 360 },
        step: ([i]) => {
          const t = media.town,
            p = t.person(media.crafter);
          // The videos let the game run its own world on the drawn frame, so the work is heard.
          if (media.rate !== 1) media.frame(0.2 / media.rate, i > 0);
          else {
            if (i > 0)
              for (let n = 0; n < 2; ++n) {
                t.advance(0.1);
                media.game.dispatchWork();
              }
            media.frame(0.1);
          }
          if (!p.craftItem && media.madeAt === undefined) media.madeAt = i;
          return media.madeAt !== undefined && i >= media.madeAt + 8;
        },
      });
    // The axe is in the crafter's hand; the other founder still works by hand. Two trees close together.
    const felling = await page.evaluate(() => {
      const { E, game } = media,
        t = game.town,
        map = t.map(),
        w = map.width(),
        [axe, bare] = t.people(),
        from = axe.position;
      const tree = (x, y) => map.inside(x, y) && map.at(x, y).trees > 0 && map.revealed(E.treePosition(map, x, y, map.at(x, y).trees - 1));
      // A tree at the forest's near edge: nothing stands between it and the camera.
      const open = (x, y) => tree(x, y) && !tree(x + 1, y + 1) && (!tree(x + 1, y) || !tree(x, y + 1));
      const edge = [];
      for (let y = Math.floor(from.y) - 30; y <= from.y + 30; ++y)
        for (let x = Math.floor(from.x) - 30; x <= from.x + 30; ++x) if (open(x, y)) edge.push({ x, y, d: Math.hypot(x - from.x, y - from.y) });
      edge.sort((a, b) => a.d - b.d);
      let pair = null;
      // Two at about the same depth on screen, a few steps apart.
      for (const a of edge) {
        const b = edge.find((b) => b !== a && Math.abs(b.x + b.y - a.x - a.y) <= 1 && Math.abs(b.x - b.y - (a.x - a.y)) >= 2 && Math.abs(b.x - b.y - (a.x - a.y)) <= 4);
        if (b) {
          pair = [a.y * w + a.x, b.y * w + b.x];
          break;
        }
      }
      if (!pair) throw Error('No two trees side by side');
      media.fellers = [axe.id, bare.id];
      media.before = [axe, bare].map((p) => E.heldAmount(p, E.Product.Wood));
      if (!t.orderChop([axe.id], pair[0]) || !t.orderChop([bare.id], pair[1])) throw Error('Chop orders refused');
      media.live(90, () => [axe, bare].every((p) => p.activity === E.Activity.Felling && !p.moving()));
      const mid = { x: (axe.position.x + bare.position.x) / 2, y: (axe.position.y + bare.position.y) / 2 };
      game.selected = -1;
      game.selectPeople([]);
      media.look({ x: mid.x, y: mid.y - 0.4 }, 3);
      media.quiet();
      media.frames(4, 0.1);
      media.track = [];
      return {
        held: axe.inventory.filter(Boolean).map((s) => s.item),
        labels: [axe, bare].map((p) => media.screen(p.position)),
      };
    });
    out.feltWith = felling.held;
    if (wants('felling'))
      out.felling = await recordGif(page, 'felling', {
        count: 400,
        keep: 66,
        fps: 12,
        width: 720,
        clip: { x: 240, y: 90, width: 800, height: 540 },
        step: ([i]) => {
          const { E } = media,
            t = media.town,
            [axe, bare] = media.fellers.map((id) => t.person(id));
          if (media.rate !== 1) media.frame(0.1 / media.rate, i > 0);
          else {
            if (i > 0) {
              t.advance(0.1);
              media.game.dispatchWork();
            }
            media.frame(0.1);
          }
          const got = [axe, bare].map((p, k) => E.heldAmount(p, E.Product.Wood) > media.before[k]);
          [axe, bare].forEach((p, k) => {
            const s = media.screen(p.position),
              wood = Math.max(0, E.heldAmount(p, E.Product.Wood) - media.before[k]);
            media.label(k, `${k ? 'Bare hands' : 'Wooden axe'} · ${wood} wood`, s.x, s.y + 30);
          });
          media.track.push([axe, bare].map((p) => [E.Activity[p.activity], E.heldAmount(p, E.Product.Wood)]));
          if (got[0] && media.axeAt === undefined) media.axeAt = i;
          if (got[1] && media.bareAt === undefined) media.bareAt = i;
          // Until the axe has brought in a second load while the hands brought in one.
          if (E.heldAmount(axe, E.Product.Wood) - media.before[0] >= 6 && media.secondAt === undefined) media.secondAt = i;
          return media.bareAt !== undefined && media.secondAt !== undefined && i >= Math.max(media.bareAt, media.secondAt) + 12;
        },
      });
    if (out.felling) out.felling.loads = await page.evaluate(() => ({ axeFrame: media.axeAt, bareFrame: media.bareAt, track: media.track.filter((_, i) => i % 8 === 0) }));
  } finally {
    await page.context().close();
  }
  return out;
}
