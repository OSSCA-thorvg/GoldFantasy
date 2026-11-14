// The settlement pictures: the hero still, a grown town living its day, a camp built from nothing, day into night.
// The grown town is staged for photography (placed through the town's own placement rules and finished at once);
// everything that moves afterwards is the unmodified simulation.
import { bootGame, recordGif, still, wants } from './capture-session.mjs';

/** Lays out a grown settlement of seed 5 round its camp, with residents on Auto. Runs in the page. */
export async function stageSettlement(page) {
  await page.evaluate(async () => {
    media.sealable = (await import('/packages/engine/src/gate-seals.ts')).sealable;
  });
  return page.evaluate(() => {
    const { E, game } = media,
      t = game.town,
      c = t.map().camp(),
      at = (x, y) => E.add(c, E.point(x, y));
    // Raids are not what this picture is about.
    t.summonRaid = () => {};
    t.releaseMonster = () => {};
    t.scout(c.x, c.y, 40);
    if (!t.place(E.Structure.Camp, c, 0)) throw Error('Cannot place the camp');
    t.completeConstruction();
    t.reward(new E.Resources(4000, 4000, 4000, 2000, 1000, 1000, 400, 400, 200));
    const road = (points) => {
      const path = points.map(([x, y]) => E.sharpAnchor(at(x, y)));
      if (!t.canBuildRoad(path).ok) return false;
      t.buildRoad(path);
      t.completeConstruction();
      return true;
    };
    for (const r of [
      [[1.2, 0], [12, 0]],
      [[2, 0], [2, -7]],
      [[2, 0], [2, 8]],
      [[7, 0], [7, -6]],
      [[7, 0], [7, 8]],
      [[2, -6], [11, -6]],
      [[2, 7], [11, 7]],
      [[12, 0], [12, -6]],
      [[-4, 0], [1.2, 0]],
    ])
      road(r);
    // Homes are placed as tents; `Tent>Cottage` stands for one the town has already grown (homes grow in place).
    const planned = [
      ['Workbench', 0, 2.2],
      ['Tent', 3.4, -1.5],
      ['Tent>Cottage', 4.9, -1.6],
      ['Tent>Cottage', 3.4, -3.2],
      ['Tent>Townhouse', 5.4, -3.8],
      ['Farm', 10, 3],
      ['Lumberyard', -3, 3.5],
      ['Sawmill', -3, -2.5],
      ['Well', 3.6, 1.5],
      ['MarketStalls', 5.2, 2.4],
      ['Hostel', 9.2, -2.6],
      ['Tavern', 9.5, -4.4],
      ['Storehouse', -0.6, -3.6],
      ['Shrine', 13.5, -2],
      ['Weaponsmith', 3.6, 4.6],
      ['Armorer', 5.4, 4.8],
      ['Apothecary', 9.4, 5.2],
      ['Chapel', 1, -9],
      ['MageTower', 13.5, -7],
      ['Guild', 9, 9],
      ['TrainingYard', 4.6, 9.4],
      ['Watchtower', 14, 2.5],
      ['Granary', 0, 5.5],
      ['Stoneworks', -2, 7.5],
      ['Runestone', 5, -7.6],
      ['Tent>Cottage', 9.5, -7.8],
      ['Tent>Cottage', 3.5, -8.2],
      ['Tent', 8.6, -1.3],
      ['Tent>Cottage', 3.4, 6.2],
      ['Tent', 5.6, 6.3],
      ['Tent>Townhouse', 9.6, 7.8],
      ['Tent', 11, -1.4],
    ];
    const placed = [],
      rejected = [];
    for (const [entry, x, y] of planned) {
      const [name, grown] = entry.split('>');
      let done = false;
      for (let n = 0; n < 200 && !done; ++n) {
        const radius = Math.floor(n / 16) * 0.38,
          angle = n * 2.399963;
        const p = t.fit(E.Structure[name], at(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius), 0);
        if (t.place(E.Structure[name], p.center, p.angle)) {
          t.completeConstruction();
          if (grown) t.buildings().at(-1).kind = E.Structure[grown];
          placed.push(entry);
          done = true;
        }
      }
      if (!done) rejected.push(entry);
    }
    for (const r of t.roads().list) if (t.canPave(r.id).ok) t.pave(r.id);
    for (const [x, y] of [
      [2.6, 0.4],
      [5.5, 0.4],
      [9, 0.4],
      [2.4, -4],
      [7.4, -3],
      [2.4, 4],
      [7.4, 4],
      [11.6, -3],
    ])
      if (t.place(E.Structure.Torch, at(x, y), 0)) placed.push('Torch');
    const farm = t.buildings().find((b) => b.kind === E.Structure.Farm);
    for (let n = 0; n < 300 && t.fields().length < 2 && farm; ++n) {
      const radius = 2 + Math.floor(n / 20) * 0.4,
        angle = n * 2.399963;
      const p = E.add(farm.center, E.point(Math.cos(angle) * radius, Math.sin(angle) * radius));
      t.plantField([p, E.add(p, E.point(2.5, 0)), E.add(p, E.point(2.5, 2)), E.add(p, E.point(0, 2))]);
    }
    t.completeConstruction();
    // A town this size has fought for it: two floors cleared beyond each of three gates lift Odin's limit on residents.
    t.map()
      .dungeons()
      .map((d, i) => i)
      .filter((i) => media.sealable(t.map().dungeons()[i]))
      .slice(0, 3)
      .forEach((i) => (t.depth[i] = 2));
    t.recruit(E.Role.Resident, E.Calling.Settler, 16);
    for (const calling of [E.Calling.Warrior, E.Calling.Ranger, E.Calling.Mage, E.Calling.Cleric, E.Calling.Bard])
      t.recruit(E.Role.Resident, calling, 1);
    for (const p of t.people()) p.food = p.rest = p.hydration = 1;
    t.editHour(10);
    t.weather().force(E.Weather.Clear, 0);
    t.orderAutomatic(t.people().map((p) => p.id));
    // A few minutes of ordinary life so the residents are spread over their work, not standing where they arrived.
    for (let n = 0; n < 900; ++n) {
      t.advance(0.1);
      game.dispatchWork();
    }
    game.selectPeople([]);
    game.objectivesCollapsed = true;
    media.quiet();
    // Finished buildings settle into place over a few seconds of drawing.
    media.frames(40, 0.1);
    return {
      population: t.population(),
      buildings: t.buildings().length,
      roads: t.roads().list.length,
      fields: t.fields().length,
      placed,
      rejected,
      camp: c,
    };
  });
}

export async function captureSettlement(session) {
  const out = {};
  // The hero still.
  if (wants('settlement')) {
    const page = await session.page(1600, 900);
    try {
      await bootGame(page, { width: 1600, height: 900 });
      out.staged = await stageSettlement(page);
      await page.evaluate(() => {
        const c = media.town.map().camp();
        media.hour(11);
        media.look({ x: c.x + 5, y: c.y + 0.5 }, 1.35);
        media.live(2);
        media.quiet();
        media.frames(2);
      });
      out.hero = await still(page, 'settlement');
    } finally {
      await page.context().close();
    }
  }
  // A grown town living its day at three times the pace of play; a still camera keeps the GIF small.
  if (wants('town-life')) {
    const page = await session.page(1280, 720);
    try {
      await bootGame(page, { width: 1280, height: 720 });
      await stageSettlement(page);
      await page.evaluate(() => {
        const c = media.town.map().camp();
        media.hour(9);
        media.look({ x: c.x + 4.5, y: c.y + 1 }, 2.1);
        media.live(1);
        media.quiet();
      });
      out.townLife = await recordGif(page, 'town-life', {
        count: 72,
        fps: 12,
        width: 800,
        colors: 192,
        step: ([i]) => {
          if (media.rate !== 1) media.frame(0.3 / media.rate, true);
          else {
            for (let n = 0; n < 3; ++n) {
              media.town.advance(0.1);
              media.game.dispatchWork();
            }
            media.frame(0.1);
          }
          media.quiet();
        },
      });
    } finally {
      await page.context().close();
    }
  }
  // A camp built from nothing by the two founders, in real simulation, as a time-lapse.
  if (wants('construction')) {
    const page = await session.page(960, 540);
    try {
      await bootGame(page, { width: 960, height: 540 });
      await page.evaluate(() => {
        const { E, game } = media,
          t = game.town,
          c = t.map().camp();
        t.summonRaid = () => {};
        t.releaseMonster = () => {};
        t.scout(c.x, c.y, 14);
        const ids = t.people().map((p) => p.id);
        t.orderStop(ids);
        if (!t.place(E.Structure.Camp, c, 0)) throw Error('Camp placement failed');
        media.site = t.buildings().at(-1).id;
        if (!t.orderBuild(ids, media.site)) throw Error('Construction order failed');
        media.hour(10);
        game.selectPeople([]);
        game.objectivesCollapsed = true;
        media.look({ x: c.x - 1.6, y: c.y - 0.6 }, 1.7);
        media.quiet();
        media.frames(4);
      });
      // Recorded every 0.4 s of play until the camp stands, then thinned to six seconds.
      out.construction = await recordGif(page, 'construction', {
        count: 600,
        keep: 72,
        fps: 12,
        width: 720,
        step: ([i]) => {
          const t = media.town;
          if (i > 0)
            for (let n = 0; n < 4; ++n) {
              t.advance(0.1);
              media.game.dispatchWork();
            }
          media.frame(0.1);
          if (t.building(media.site).progress >= 1 && media.doneAt === undefined) media.doneAt = i;
          return media.doneAt !== undefined && i >= media.doneAt + 8;
        },
      });
      out.construction.finished = await page.evaluate(() => ({
        progress: media.town.building(media.site).progress,
        doneAtFrame: media.doneAt ?? -1,
      }));
    } finally {
      await page.context().close();
    }
  }
  // Day into night and back over the grown town.
  if (wants('day-night')) {
    const page = await session.page(960, 540);
    try {
      await bootGame(page, { width: 960, height: 540 });
      await stageSettlement(page);
      await page.evaluate(() => {
        const c = media.town.map().camp();
        media.hour(14);
        media.look({ x: c.x + 5, y: c.y + 0.5 }, 0.95);
        media.live(1);
        media.quiet();
      });
      out.dayNight = await recordGif(page, 'day-night', {
        count: 80,
        fps: 10,
        width: 800,
        colors: 160,
        step: ([i]) => {
          const t = media.town;
          if (i > 0)
            for (let n = 0; n < Math.round(25 / media.rate); ++n) {
              t.advance(0.1);
              media.game.dispatchWork();
            }
          media.frame(0.2);
          media.quiet();
        },
      });
    } finally {
      await page.context().close();
    }
  }
  return out;
}
