// Units behind trees are drawn as outlines, so a fight in a forest stays readable. As in the "ghosts" part of
// tests/regression/environment.browser.mjs: a party mustered in the densest wood, a swarm round it. World only, no HUD.
import { bootGame, recordGif } from './capture-session.mjs';

export async function captureForestOutlines(session) {
  const page = await session.page(1280, 720);
  try {
    await bootGame(page, { width: 1280, height: 720, hud: false });
    const setup = await page.evaluate(async () => {
      const { MonsterRank } = await import('/packages/engine/src/combat-events.ts');
      const { E, game } = media,
        t = game.town,
        map = t.map(),
        c = map.camp();
      t.summonRaid = () => {};
      // The densest wood within a walk of the camp.
      let best = -1,
        dense = null;
      for (let y = Math.floor(c.y) - 30; y < c.y + 30; ++y)
        for (let x = Math.floor(c.x) - 30; x < c.x + 30; ++x) {
          if (!map.inside(x - 4, y - 4) || !map.inside(x + 4, y + 4) || !map.at(x, y).trees) continue;
          let n = 0;
          for (let dy = -4; dy <= 4; ++dy) for (let dx = -4; dx <= 4; ++dx) n += map.at(x + dx, y + dy).trees;
          if (n > best) [best, dense] = [n, { x: x + 0.5, y: y + 0.5 }];
        }
      t.scout(dense.x, dense.y, 16);
      media.hour(11);
      const callings = [E.Calling.Warrior, E.Calling.Ranger, E.Calling.Mage, E.Calling.Cleric, E.Calling.Warrior, E.Calling.Bard];
      const arms = ['sword', 'bow', 'staff', 'mace', 'sword', 'mace'];
      t.folk = [];
      for (let i = 0; i < 6; ++i) {
        const a = (i * Math.PI * 2) / 6,
          q = t.grid.nearestWalkable({ x: dense.x + 1.2 * Math.cos(a), y: dense.y + 1.2 * Math.sin(a) }),
          p = t.makePerson(E.Role.Resident, callings[i], { ...q });
        p.position = { ...q };
        p.level = 10;
        p.food = p.rest = p.hydration = 1;
        t.folk.push(p);
        if (E.addInventory(p, arms[i])) t.equipItem(p.id, p.inventory.findIndex((s) => s?.item === arms[i]) + 1, 'weapon');
      }
      const lair = map.dungeons().findIndex((d) => d.kind === 1);
      for (let i = 0; i < 12; ++i) {
        const a = i * 2.39996,
          r = 2.2 + 1.5 * Math.sqrt((i + 0.5) / 12),
          m = new E.Monster(t.nextMonster++, Math.max(0, lair), { x: dense.x + r * Math.cos(a), y: dense.y + r * Math.sin(a) });
        m.rank = i % 3 === 0 ? MonsterRank.Grunt : MonsterRank.Swarmer;
        m.vigor = m.health = 30;
        m.angry = true;
        t.beasts.push(m);
      }
      t.changes++;
      // The party goes at them: every unit moves with purpose (a thinner pack, so none is left shoving at a crowd's edge).
      t.orderAttackMove(t.folk.map((p) => p.id), { x: dense.x + 2.5, y: dense.y + 1 });
      media.view = dense;
      media.look(dense, 2);
      for (let i = 0; i < 24; ++i) {
        t.advance(1 / 12);
        media.frame(1 / 12);
      }
      return { trees: best, at: dense };
    });
    const gif = await recordGif(page, 'forest-outlines', {
      count: 60,
      fps: 12,
      width: 720,
      colors: 128,
      clip: { x: 200, y: 112, width: 880, height: 495 },
      step: () => {
        media.look(media.view, 2);
        media.step(media.dt);
        // Watch for a unit that only shuffles: direction flips with no ground covered (reported, not changed).
        media.tracks ??= new Map();
        for (const u of [...media.town.people(), ...media.town.beasts]) {
          const key = (u.calling !== undefined ? 'p' : 'm') + u.id,
            tr = media.tracks.get(key) ?? { last: { ...u.position }, dx: 0, flips: 0, moved: 0 };
          const dx = u.position.x - tr.last.x;
          if (Math.abs(dx) > 0.004 && tr.dx && Math.sign(dx) !== Math.sign(tr.dx)) ++tr.flips;
          if (Math.abs(dx) > 0.004) tr.dx = dx;
          tr.moved += Math.hypot(dx, u.position.y - tr.last.y);
          tr.last = { ...u.position };
          tr.kind = u.calling !== undefined ? 'resident' : 'monster';
          tr.activity = u.activity;
          media.tracks.set(key, tr);
        }
      },
    });
    const jitter = await page.evaluate(() =>
      [...(media.tracks ?? new Map())].filter(([, t]) => t.flips >= 10).map(([k, t]) => ({ unit: k, kind: t.kind, flips: t.flips, moved: +t.moved.toFixed(2), activity: t.activity })),
    );
    return { setup, outlines: gif, jitter };
  } finally {
    await page.context().close();
  }
}
