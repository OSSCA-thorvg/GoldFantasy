// A party beyond a gate, as in tests/regression/realm.browser.mjs and combat-loop.browser.mjs: the expedition window,
// a formation move and hold, a fight with skills against a den and its swarm, and a fallen resident raised by an ally.
// The party is staged (six residents of the right callings, levelled and armed); the fight is the game's own.
import { bootGame, recordGif, still, wants } from './capture-session.mjs';

const width = 1280,
  height = 720;

/** Sets out a party of six through the first gate; leaves `media.party`. Returns the expedition window's state. */
async function sendParty(page) {
  await page.evaluate(async () => {
    const [{ sealable }, { monsterEntrance }, ex, orders] = await Promise.all([
      import('/packages/engine/src/gate-seals.ts'),
      import('/packages/engine/src/town-monsters.ts'),
      import('/apps/web/src/native/expedition-window.ts'),
      import('/apps/web/src/native/army-orders.ts'),
    ]);
    const { E, game } = media,
      t = game.town,
      map = t.map(),
      gate = map.dungeons().findIndex(sealable),
      site = map.dungeons()[gate];
    media.expedition = ex;
    // The clips play on through a fall or a roused guardian, which would pause a real game for the player.
    media.playOn = () => {
      game.paused = false;
      game.speed = 1;
    };
    media.orders = orders;
    media.gate = gate;
    t.summonRaid = () => {};
    site.discovered = true;
    if (!t.place(E.Structure.Camp, map.camp(), 0)) throw Error('Cannot place the camp');
    t.completeConstruction();
    t.folk = [];
    const shape = (c) => (c === E.Calling.Warrior ? 'sword' : c === E.Calling.Ranger ? 'bow' : c === E.Calling.Mage ? 'staff' : 'mace');
    for (const calling of [E.Calling.Warrior, E.Calling.Warrior, E.Calling.Ranger, E.Calling.Mage, E.Calling.Cleric, E.Calling.Bard]) {
      const p = t.makePerson(E.Role.Resident, calling, monsterEntrance(site));
      p.level = 8;
      p.food = p.rest = p.hydration = p.health = 1;
      const item = E.itemCatalog
        .filter((i) => i.category === 'weapon' && i.visual === shape(calling) && i.minimumLevel <= p.level)
        .sort((a, b) => b.attackBonus - a.attackBonus)[0];
      if (item) {
        p.inventory[0] = { item: item.id, quantity: 1 };
        p.equipment.weapon = 1;
      }
      p.abilityAuto = p.abilityAuto2 = 1;
      // Six different names, so the notices in the clips are plain about who is who.
      p.name = ['Geirmund', 'Vigdis', 'Hallbera', 'Rannveig', 'Ingjald', 'Torvi'][t.folk.length];
      t.folk.push(p);
    }
    for (const [i, p] of t.folk.entries())
      p.position = t.grid.nearestWalkable({ x: site.origin.x + 2 + (i % 3) * 0.6, y: site.origin.y + 3 + Math.floor(i / 3) * 0.6 });
    media.hour(11);
    game.objectivesCollapsed = true;
    media.look({ x: site.origin.x + 1.5, y: site.origin.y + 1.5 }, 1.6);
    media.frames(4, 0.05);
    if (!ex.openExpedition(game, gate, t.folk.map((p) => p.id))) throw Error('The gate has no expedition window');
    media.quiet();
    media.frames(6, 0.001);
  });
}

async function arrive(page) {
  return page.evaluate(() => {
    const { game } = media,
      key = (text) => ({ type: 'KeyDown', text, key: 0, x: 0, y: 0, delta: 0, button: 0, shift: false, control: false, alt: false, meta: false });
    game.handleExpeditionEvent(key('return'));
    if (game.expedition) throw Error('Enter did not set out');
    for (let t = 0; t < 80 && !game.town.realmActive(); t += 0.2) {
      game.town.advance(0.2);
      game.dispatchWork();
    }
    if (!game.town.realmActive()) throw Error('The party did not arrive');
    media.party = game.town.realmParty().map((p) => p.id);
    game.selectPeople(media.party);
    media.quiet();
    media.frames(6, 0.05, true);
    const plan = game.town.realmPlan();
    return { foes: game.town.realmFoes().length, dens: game.town.realmDens().length, chambers: plan.chambers.length };
  });
}

export async function captureArmy(session) {
  const out = {},
    page = await session.page(width, height);
  try {
    await bootGame(page, { width, height });
    await sendParty(page);
    if (wants('expedition')) out.expedition = await still(page, 'expedition');
    out.arrival = await arrive(page);

    // Formation: a move order for the whole party, the marks of where each will stand, then Hold.
    const move = await page.evaluate(() => {
      const { E, game } = media,
        t = game.town,
        plan = t.realmPlan(),
        entry = plan.chambers[0],
        next = plan.chambers[entry.links[0]],
        spot = t.grid.nearestWalkable({
          x: entry.center.x + (next.center.x - entry.center.x) * 0.3,
          y: entry.center.y + (next.center.y - entry.center.y) * 0.3,
        }),
        lead = t.person(media.party[0]).position,
        mid = { x: (spot.x + lead.x) / 2, y: (spot.y + lead.y) / 2 };
      // Staged for a clear picture: the packs nearest the way in are taken off, so the move is not a fight.
      t.beasts = t.beasts.filter((m) => m.rank === 6 || m.id === t.realmGuardian || Math.hypot(m.position.x - spot.x, m.position.y - spot.y) > 14);
      game.realmCollapsed = true;
      media.view = mid;
      media.look(mid, 2);
      media.frames(2, 0.05, true);
      game.selectPeople(media.party);
      game.prepare(E.Order.Move);
      media.frames(2, 0.001);
      return media.screen(spot);
    });
    if (wants('formation'))
      out.formation = await recordGif(page, 'formation', {
        count: 160,
        fps: 12,
        width: 720,
        step: async ([i, at]) => {
          media.playOn();
          if (i === Math.round(4 * media.rate)) {
            media.game.pointerMove(at.x, at.y);
            media.game.pointerDown(at.x, at.y, 0);
            media.game.pointerUp(at.x, at.y, 0);
          }
          const party = media.party.map((id) => media.town.person(id));
          if (media.heldAt === undefined && i > 14 * media.rate && party.every((p) => !p.moving())) {
            media.orders.holdPosition(media.game);
            media.heldAt = i;
          }
          media.look(media.view, 2);
          media.frame(1.5 * media.dt, true);
          return media.heldAt !== undefined && i >= media.heldAt + 14 * media.rate;
        },
        arg: move,
      });

    // The fight: attack-move at the nearest den; both skills of every calling on auto. Filmed to the den's fall.
    const den = await page.evaluate(() => {
      const t = media.town,
        lead = t.person(media.party[0]).position,
        a = t.realmArea,
        middle = { x: a.x + a.size / 2, y: a.y + a.size / 2 },
        // The den nearest the island's middle, so the camera is free to follow the fight on every side.
        gap = (m) => Math.hypot(m.position.x - middle.x, m.position.y - middle.y),
        d = t.realmDens().sort((a, b) => gap(a) - gap(b))[0];
      media.game.realmCollapsed = true;
      media.den = d.id;
      media.denAt = { ...d.position };
      for (const id of media.party) t.person(id).holding = false;
      media.attack = () => {
        const { E, game } = media,
          party = media.party.map((id) => game.town.person(id)).filter((p) => p.downedAt < 0),
          c = party[0].position,
          l = Math.hypot(c.x - media.denAt.x, c.y - media.denAt.y) || 1,
          spot = { x: media.denAt.x + ((c.x - media.denAt.x) / l) * 1.2, y: media.denAt.y + ((c.y - media.denAt.y) / l) * 1.2 };
        game.town.orderAttackMove(party.map((p) => p.id), spot);
      };
      media.attack();
      // The order is given; the selection card would only cover the fight.
      media.game.selectPeople([]);
      media.camera = { ...lead };
      return { id: d.id, at: media.denAt };
    });
    if (wants('army-fight')) {
      out.armyFight = await recordGif(page, 'army-fight', {
        count: 1400,
        last: 88,
        fps: 12,
        width: 672,
        colors: 112,
        clip: { x: 160, y: 56, width: 960, height: 540 },
        step: ([i]) => {
          media.playOn();
          const t = media.town,
            party = media.party.map((id) => t.person(id)),
            up = party.filter((p) => p.downedAt < 0);
          // Fallen are raised at once here: this clip is about the fight; the next one is about the rescue.
          for (const p of party) if (p.downedAt >= 0 && t.clock() - p.downedAt > 4) t.revive?.(p);
          if (i % Math.round(48 * media.rate) === Math.round(48 * media.rate) - 1) media.attack();
          // The thick of it: the den and whoever of the party is near it (a straggler would pull the view away).
          const near = up.filter((p) => Math.hypot(p.position.x - media.denAt.x, p.position.y - media.denAt.y) < 7),
            group = near.length ? near : up,
            c = group.reduce((s, p) => ({ x: s.x + p.position.x / (group.length + 1), y: s.y + p.position.y / (group.length + 1) }), {
              x: media.denAt.x / (group.length + 1),
              y: media.denAt.y / (group.length + 1),
            });
          media.camera.x += (c.x - media.camera.x) * 0.15;
          media.camera.y += (c.y - media.camera.y) * 0.15;
          media.look(media.camera, 1.9);
          media.frame(media.dt, true);
          media.quiet();
          if (!t.realmDens().some((d) => d.id === media.den) && media.fellAt === undefined) media.fellAt = i;
          return media.fellAt !== undefined && i >= media.fellAt + 24 * media.rate;
        },
      });
      out.armyFight.denFell = await page.evaluate(() => media.fellAt ?? -1);
    }

    // A fall and a rescue: a warrior is struck down; the bard runs to kneel beside them and gets them up.
    if (wants('revive')) {
      await page.evaluate(() => {
        const { E, game } = media,
          t = game.town,
          party = media.party.map((id) => t.person(id)),
          warrior = party.find((p) => p.calling === E.Calling.Warrior && p.downedAt < 0),
          helper = party.find((p) => p.calling === E.Calling.Bard && p.downedAt < 0) ?? party.find((p) => p !== warrior && p.downedAt < 0);
        // The cleric's Mend would raise them from afar; the rescue here is by hand.
        const cleric = party.filter((p) => p.calling === E.Calling.Cleric).map((p) => p.id);
        t.setSkillAuto(cleric, 0, false);
        t.setSkillAuto(cleric, 1, false);
        media.fallen = warrior.id;
        media.helper = helper.id;
        // The helper starts a few steps away so the run to the body shows.
        const from = t.grid.nearestWalkable({ x: warrior.position.x + 2.4, y: warrior.position.y + 1.2 });
        helper.position = from;
        helper.path = [];
        t.strikeDown(warrior, 'Killed by monsters');
        media.view = { x: (warrior.position.x + from.x) / 2, y: (warrior.position.y + from.y) / 2 };
        game.selectPeople([helper.id]);
        media.frames(2, 0.05, true);
      });
      out.revive = await recordGif(page, 'revive', {
        count: 400,
        fps: 12,
        width: 720,
        clip: { x: 240, y: 110, width: 800, height: 450 },
        step: ([i]) => {
          media.playOn();
          const t = media.town,
            hurt = t.person(media.fallen);
          if (i === Math.round(10 * media.rate)) t.orderTend([media.helper], media.fallen);
          media.look(media.view, 2.3);
          media.frame(media.dt, true);
          if (hurt.downedAt < 0 && media.upAt === undefined) media.upAt = i;
          return media.upAt !== undefined && i >= media.upAt + 20 * media.rate;
        },
      });
      out.revive.upAtFrame = await page.evaluate(() => media.upAt ?? -1);
    }
  } finally {
    await page.context().close();
  }
  return out;
}
