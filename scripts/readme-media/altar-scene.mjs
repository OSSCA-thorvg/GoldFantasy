// An offering at Odin's altar in the grown town, as tests/regression/prayer.browser.mjs drives it: the gifts are
// filled in (a kingly offering, which is never refused), the rite plays, and Odin answers with a new resident.
import { bootGame, recordGif, videoFps } from './capture-session.mjs';
import { stageSettlement } from './settlement-scenes.mjs';

export async function captureAltar(session) {
  const page = await session.page(1280, 720);
  try {
    await bootGame(page, { width: 1280, height: 720 });
    await stageSettlement(page);
    const setup = await page.evaluate(() => {
      const { E, game } = media,
        t = game.town,
        altar = t.buildings().find((b) => b.kind === E.Structure.Shrine);
      if (!altar) throw Error('The staged town has no altar');
      t.stock().add({ gold: 99, wood: 0, stone: 99, food: 99, mana: 0, water: 99, planks: 0, cutStone: 0, bones: 99 });
      media.hour(17);
      game.selectPeople([]);
      game.openPrayer(altar.id);
      const kingly = { water: 60, bones: 60, gold: 60, food: 60, stone: 60 };
      for (const [key, value] of Object.entries(kingly)) game.prayer.inputs[key].value = String(value);
      media.frames(4, 0.05, true);
      media.prayerEvent = (type, x, y) =>
        game.handlePrayerEvent({ type, x, y, button: 1, key: 0, text: '', shift: false, control: false, alt: false, meta: false, delta: 0 });
      return { altar: altar.id, offering: { ...game.prayer.offering } };
    });
    const gif = await recordGif(page, 'altar', {
      count: 800,
      // The GIF is thinned to twice the pace; the presentation video keeps the rite's own pace and sound.
      keep: videoFps ? undefined : 84,
      fps: 12,
      width: 720,
      colors: 192,
      // The offering window alone.
      clip: { x: 136, y: 10, width: 1008, height: 700 },
      step: ([i]) => {
        const g = media.game;
        // A second and a half on the filled-in offering, then the offering is made.
        if (i === Math.round(18 * media.rate)) {
          const c = g.context.controls.find((c) => c.id.endsWith('prayer-confirm'));
          if (!c?.enabled) throw Error('The offering cannot be made');
          const x = c.bounds.x + c.bounds.w / 2,
            y = c.bounds.y + c.bounds.h / 2;
          media.prayerEvent('PointerMove', x, y);
          media.prayerEvent('PointerDown', x, y);
          media.prayerEvent('PointerUp', x, y);
        }
        media.frame(media.dt, true);
        const p = g.prayer;
        if (p?.finished && media.doneAt === undefined) media.doneAt = i;
        return media.doneAt !== undefined && i >= media.doneAt + 30 * media.rate;
      },
    });
    const result = await page.evaluate(() => {
      const p = media.game.prayer;
      return { born: p?.born ? { name: p.born.name, calling: p.born.calling } : null, refused: p?.refused, rite: p?.rite ? { end: p.rite.end } : null };
    });
    return { setup, altar: { ...gif, ...result } };
  } finally {
    await page.context().close();
  }
}
