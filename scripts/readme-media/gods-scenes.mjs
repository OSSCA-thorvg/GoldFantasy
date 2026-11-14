// Thor's visit and Jormungandr, as tests/regression/gods.browser.mjs sets them up: a small settlement that has an
// altar and a fire to call him, Thor coming down in his bolt, his night hunt with the hammer, and the world serpent
// rising round the land in a storm.
import { bootGame, recordGif, wants } from './capture-session.mjs';

async function stageSettlement(page) {
  await page.evaluate(async () => {
    const ring = await import('/packages/native-renderer/src/serpent-ring.ts'),
      thor = await import('/packages/engine/src/thor-visit.ts'),
      realm = await import('/packages/engine/src/realm-layout.ts');
    const { E, game } = media,
      town = game.town,
      map = town.map(),
      origin = map.camp();
    media.ring = ring;
    media.copyNative = (await import('/packages/engine/src/native-copy.ts')).copyNative;
    media.thorRules = thor.thorRules;
    media.findRealmArea = realm.findRealmArea;
    town.summonRaid = () => {};
    town.releaseMonster = () => {};
    const place = (kind, dx, dy) => {
      for (let r = 0; r < 6; r += 0.5)
        for (let a = 0; a < 12; ++a) {
          const at = { x: origin.x + dx + r * Math.cos(a * 0.52), y: origin.y + dy + r * Math.sin(a * 0.52) };
          if (!town.canPlace(kind, at, 0).ok) continue;
          const b = new E.Building(town.nextId++, kind, at, 0, 0);
          b.village = 0;
          town.placed.push(b);
          return b;
        }
      return null;
    };
    const camp = new E.Building(town.nextId++, E.Structure.Camp, origin, 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.foundSettlement(camp.id);
    town.stock().wood = town.stock().stone = town.stock().food = 300;
    place(E.Structure.Shrine, 5, -2);
    place(E.Structure.Tavern, -5, 3);
    place(E.Structure.Cottage, 3, 5);
    place(E.Structure.Cottage, -4, -4);
    while (town.population() < 6) {
      const p = town.makePerson(E.Role.Resident, E.Calling.Settler, { x: origin.x + town.population() * 0.6 - 2, y: origin.y + 1.6 });
      town.folk.push(p);
    }
    for (const p of town.folk) p.food = p.rest = p.hydration = 1;
    town.changes++;
    town.scout(map.width() / 2, map.height() / 2, map.width());
    game.objectivesCollapsed = true;
    media.origin = origin;
    media.look(origin, 1.4);
    media.frames(10, 0.05);
  });
}

export async function captureGods(session) {
  const out = {},
    width = 1280,
    height = 720;
  if (wants('thor-arrival') || wants('thor-night-hunt')) {
    const page = await session.page(width, height);
    try {
      await bootGame(page, { width, height });
      await stageSettlement(page);
      // Just before the hour he comes down; the clip runs through his bolt and his landing.
      await page.evaluate(() => {
        const t = media.town;
        media.hour(media.thorRules.arriveHour * 24 - 0.05);
        t.thor.nextVisit = t.days;
        // Where he will land, found on a copy of the town (the simulation is deterministic), so the camera waits there.
        const probe = media.copyNative(t);
        for (let i = 0; i < 400 && !probe.thor.present; ++i) probe.advance(1 / 12);
        media.thorAt = { ...probe.thor.position };
        media.look({ x: media.thorAt.x, y: media.thorAt.y - 0.4 }, 2.4);
        media.frames(4, 0.05);
        media.quiet();
      });
      if (wants('thor-arrival'))
        out.thorArrival = await recordGif(page, 'thor-arrival', {
          count: 200,
          fps: 12,
          width: 720,
          clip: { x: 200, y: 60, width: 880, height: 495 },
          step: ([i]) => {
            const t = media.town;
            if (t.thor.present && media.cameAt === undefined) media.cameAt = i;
            media.look({ x: media.thorAt.x, y: media.thorAt.y - 0.4 }, 2.4);
            // The game runs its own world on this frame, as in play, so it also asks for its sounds.
            media.frame(media.dt, true);
            media.quiet();
            return media.cameAt !== undefined && i >= media.cameAt + 46 * media.rate;
          },
        });
      if (wants('thor-night-hunt')) {
        // The night hunt: raiders come in out of the dark and he throws Mjolnir.
        await page.evaluate(() => {
          const { E, game } = media,
            t = game.town,
            o = media.origin;
          if (!t.thor.present) {
            t.thor.nextVisit = t.days;
            media.hour(media.thorRules.arriveHour * 24 + 0.1);
            for (let i = 0; i < 400 && !t.thor.present; ++i) t.advance(0.1);
          }
          for (let h = 18; h < 23.5; h += 0.1) {
            media.hour(h);
            if (t.climate().night > 0.62) break;
          }
          const thor = t.thor,
            at = { x: o.x + 2, y: o.y + 2 };
          thor.doing = 2; // Strolling: the night draws him to the raiders on his own.
          thor.position = { ...at };
          thor.goal = null;
          thor.path = [];
          thor.look = null;
          thor.since = t.clock();
          thor.until = t.clock() + 1000;
          thor.throwAt = -1;
          const from = { x: o.x + 8, y: o.y + 6 };
          for (let i = 0; i < 6; ++i) {
            const p = t.grid.nearestWalkable({ x: from.x + (i % 3) * 0.9, y: from.y + Math.floor(i / 3) * 0.9 });
            const m = new E.Monster(t.nextMonster++, 0, p);
            m.home = { ...p };
            m.health = m.vigor = 13.5;
            m.raider = true;
            t.beasts.push(m);
          }
          media.view = { x: o.x + 4.6, y: o.y + 3.8 };
          media.look(media.view, 2.2);
          media.frames(3, 0.05);
          media.quiet();
        });
        out.thorNightHunt = await recordGif(page, 'thor-night-hunt', {
          count: 300,
          fps: 12,
          width: 720,
          clip: { x: 200, y: 100, width: 880, height: 495 },
          step: ([i]) => {
            const t = media.town,
              thor = t.thor;
            media.look(media.view, 2.2);
            media.frame(media.dt, true);
            media.quiet();
            if (thor.throwAt >= 0 && media.firstThrow === undefined) media.firstThrow = i;
            const raiders = t.beasts.filter((m) => m.raider && m.health > 0).length;
            if (!raiders && media.clearAt === undefined) media.clearAt = i;
            return (media.clearAt !== undefined && i >= media.clearAt + 18 * media.rate) || (media.firstThrow !== undefined && i >= media.firstThrow + 70 * media.rate);
          },
        });
      }
    } finally {
      await page.context().close();
    }
  }
  if (wants('jormungandr')) {
    const page = await session.page(width, height);
    try {
      await bootGame(page, { width, height });
      await stageSettlement(page);
      const coil = await page.evaluate(() => {
        const { E, game } = media,
          t = game.town,
          map = t.map(),
          ring = media.ring;
        media.hour(12);
        const serpent = () => {
          const area = t.realmArea ?? media.findRealmArea(map),
            r = ring.serpentRing(map, area),
            c = t.climate(),
            spell = ring.weatherSpell(t.weather().snapshot().peak),
            e = ring.serpentEmergence(map.seed(), c.weather, c.intensity, spell);
          return r ? ring.serpentParts(r, map.seed(), spell).map((p) => ({ kind: ring.SerpentPartKind[p.kind], mid: ring.partMiddle(p, r), rise: ring.partRise(p, r, e, t.clock()) })) : [];
        };
        // A storm spell he rises in (named by the sky's peak strength).
        for (let k = 0; k < 40; ++k) {
          const intensity = 0.8 + k * 0.004;
          t.weather().force(E.Weather.Storm, intensity);
          if (ring.serpentEmergence(map.seed(), E.Weather.Storm, intensity, ring.weatherSpell(t.weather().snapshot().peak)) > 0.5) break;
        }
        t.changes++;
        for (let s = 0; s < 30; s += 0.5) {
          t.time += 0.5;
          media.frame(0.5);
        }
        // The coil nearest the settlement, risen well up.
        let best = null;
        for (let i = 0; i < 400 && !best; ++i) {
          const part = serpent()
            .filter((p) => p.kind === 'Coil')
            .sort((a, b) => Math.hypot(a.mid.x - media.origin.x, a.mid.y - media.origin.y) - Math.hypot(b.mid.x - media.origin.x, b.mid.y - media.origin.y))[0];
          if (part && part.rise > 0.85) best = part;
          else t.time += 0.5;
        }
        if (!best) throw Error('No coil rose');
        // Back to a clear sea, then the storm comes on and he rises out of it.
        media.view = { x: best.mid.x - 3.5, y: best.mid.y - 3.5 };
        media.hour(12);
        for (let s = 0; s < 30; s += 0.5) {
          t.time += 0.5;
          media.frame(0.5);
        }
        for (let k = 0; k < 40; ++k) {
          const intensity = 0.8 + k * 0.004;
          t.weather().force(E.Weather.Storm, intensity);
          if (ring.serpentEmergence(map.seed(), E.Weather.Storm, intensity, ring.weatherSpell(t.weather().snapshot().peak)) > 0.5) break;
        }
        game.storm = new E.Thunderstorm(11);
        game.selectPeople([]);
        media.look(media.view, 1.1);
        media.frames(2, 0.05);
        media.quiet();
        return best;
      });
      out.jormungandr = {
        coil,
        ...(await recordGif(page, 'jormungandr', {
          count: 72,
          fps: 12,
          width: 720,
          colors: 160,
          step: ([i]) => {
            // Two bolts of the storm show the body dark against the flash.
            const k = Math.round(34 * media.rate),
              l = Math.round(58 * media.rate);
            if (i === k || i === l)
              media.game.renderer.lightning({ reach: 1, at: media.now + 0.3 / media.rate - 0.04, delay: 0, brightness: 0.9, across: i === k ? 0.35 : 0.7, down: 0.4, seed: i });
            media.town.time += 0.3 / media.rate;
            media.look(media.view, 1.1);
            media.frame(0.3 / media.rate);
            media.quiet();
          },
        })),
      };
    } finally {
      await page.context().close();
    }
  }
  return out;
}
