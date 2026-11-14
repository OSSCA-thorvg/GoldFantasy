// Two stills of the interface: a first-time guide card (a gate comes into view) and the game in Korean.
import { bootGame, still, wants } from './capture-session.mjs';
import { stageSettlement } from './settlement-scenes.mjs';

export async function captureInterface(session) {
  const out = {};
  if (wants('guide')) {
    const page = await session.page(1280, 720);
    try {
      await bootGame(page, { width: 1280, height: 720 });
      out.guide = await page.evaluate(async () => {
        (await import('/apps/web/src/native/guide-preferences.ts')).setGuidePreference('cards', true);
        const { sealable } = await import('/packages/engine/src/gate-seals.ts');
        const { E, game, guide } = media,
          t = game.town,
          map = t.map(),
          gate = map.dungeons().find(sealable);
        t.summonRaid = () => {};
        t.releaseMonster = () => {};
        // A new game: the founders wait for the first order, so nothing else asks to be told first.
        t.awaiting = true;
        media.hour(10);
        t.scout(gate.origin.x, gate.origin.y, 8);
        gate.discovered = true;
        game.objectivesCollapsed = true;
        // Only what a resident sees right now counts: the founders stand before the gate.
        t.people().forEach((p, i) => (p.position = t.grid.nearestWalkable({ x: gate.origin.x + 1 + i * 0.7, y: gate.origin.y + 3.6 })));
        media.look({ x: gate.origin.x + 1, y: gate.origin.y + 1.5 }, 2.2);
        // The guide hears the world only on frames that advance it; earlier cards are passed by.
        for (let i = 0; i < 60 && game.guide.card?.entry.key !== 'gate'; ++i) {
          if (game.guide.card && game.guide.card.entry.key !== 'gate') guide.dismissGuideCard(game);
          media.look({ x: gate.origin.x + 1, y: gate.origin.y + 1.5 }, 2.2);
          media.frames(2, 0.05, true);
        }
        const key = game.guide.card?.entry.key ?? JSON.stringify({ told: [...t.told], log: game.guide.log.map((e) => e.key), queue: game.guide.queue.map((e) => e.key), awaiting: t.awaiting });
        media.quiet();
        media.look({ x: gate.origin.x + 1, y: gate.origin.y + 1.5 }, 2.2);
        media.frames(20, 0.05);
        return key;
      });
      if (out.guide !== 'gate') throw Error(`The gate card did not show (${out.guide})`);
      await page.mouse.move(5, 400);
      out.guideStill = await still(page, 'guide');
    } finally {
      await page.context().close();
    }
  }
  if (wants('korean')) {
    const page = await session.page(1280, 720);
    try {
      await bootGame(page, { width: 1280, height: 720 });
      await stageSettlement(page);
      await page.evaluate(async () => {
        const { E, game } = media,
          t = game.town,
          bench = t.buildings().find((b) => b.kind === E.Structure.Workbench);
        await media.korean(true);
        game.objectivesCollapsed = true;
        media.hour(11);
        game.selectBuilding(bench.id);
        media.look({ x: bench.center.x - 1.5, y: bench.center.y + 1 }, 2);
        media.frames(20, 0.05);
        media.quiet();
        media.frames(2, 0.05);
      });
      out.korean = await still(page, 'korean');
    } finally {
      await page.context().close();
    }
  }
  return out;
}
