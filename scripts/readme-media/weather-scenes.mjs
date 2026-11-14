// Rain, snow and a thunderstorm over the grown town, each from the game's own sky and weather drawing.
import { bootGame, recordGif, wants } from './capture-session.mjs';
import { stageSettlement } from './settlement-scenes.mjs';

async function setWeather(page, kind) {
  return page.evaluate((kind) => {
    const { E, game } = media,
      t = game.town,
      c = t.map().camp();
    if (kind === 'snow') {
      // A winter day, and several minutes of the sky's own snowfall so the ground has whitened.
      t.days = 50;
      t.editHour(11);
      const sky = new E.Sky(5);
      sky.force(E.Weather.Snow, 1);
      const end = t.clock(),
        start = end - 400;
      for (let i = 1; i <= 4000; ++i) {
        const clock = start + i * 0.1;
        sky.advance(0.1, E.Town.secondsPerDay, ((clock / E.Town.secondsPerDay) % 60) / 60, (clock % E.Town.secondsPerDay) / E.Town.secondsPerDay);
      }
      t.weather().restore(sky.snapshot());
      t.weather().force(E.Weather.Snow, 1);
    } else {
      t.editHour(kind === 'thunderstorm' ? 15 : 13);
      t.weather().force(kind === 'thunderstorm' ? E.Weather.Storm : E.Weather.Rain, 1);
    }
    game.storm = new E.Thunderstorm(7);
    media.view = { x: c.x + 4, y: c.y + 0.5 };
    media.zoom = kind === 'thunderstorm' ? 1.1 : 1.6;
    media.look(media.view, media.zoom);
    media.quiet();
    // The weather settles in: drops and flakes fill the air before the first frame.
    for (let i = 0; i < 40; ++i) {
      media.look(media.view, media.zoom);
      media.frame(0.1, true);
    }
    media.quiet();
    return { weather: E.Weather[t.climate().weather], intensity: t.climate().intensity, snow: t.climate().snow };
  }, kind);
}

export async function captureWeather(session) {
  const out = {};
  for (const kind of ['rain', 'snow', 'thunderstorm']) {
    if (!wants(kind)) continue;
    const page = await session.page(960, 540);
    try {
      await bootGame(page, { width: 960, height: 540 });
      await stageSettlement(page);
      const climate = await setWeather(page, kind);
      out[kind] = {
        climate,
        ...(await recordGif(page, kind, {
          // The storm is filmed until a near bolt has fallen and two seconds have passed; the last five seconds stay.
          count: kind === 'thunderstorm' ? 600 : 48,
          last: kind === 'thunderstorm' ? 60 : undefined,
          arg: kind,
          fps: 12,
          width: 720,
          colors: 128,
          step: ([i, kind]) => {
            media.look(media.view, media.zoom);
            media.frame(media.dt, true);
            media.quiet();
            if (kind !== 'thunderstorm') return false;
            const s = media.game.renderer.strike;
            if (s && s.reach === 1 && s.across > 0.2 && s.across < 0.8 && media.now - s.at < 0.2 && i > 36 * media.rate && media.struck === undefined) media.struck = media.now;
            return media.struck !== undefined && media.now - media.struck > 2;
          },
        })),
      };
    } finally {
      await page.context().close();
    }
  }
  return out;
}
