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
      for (let i = 0; i < 36; ++i) {
        const a = i * 2.39996,
          r = 2.5 + 3 * Math.sqrt((i + 0.5) / 36),
          m = new E.Monster(t.nextMonster++, Math.max(0, lair), { x: dense.x + r * Math.cos(a), y: dense.y + r * Math.sin(a) });
        m.rank = i % 9 === 0 ? MonsterRank.Grunt : MonsterRank.Swarmer;
        m.vigor = m.health = 60;
        m.angry = true;
        t.beasts.push(m);
      }
      t.changes++;
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
      },
    });
    return { setup, outlines: gif };
  } finally {
    await page.context().close();
  }
}
