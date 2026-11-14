// Effect showcase clips for the presentation page, each with the game's own sound: weapon strikes by shape, every
// calling's two skills, floating numbers, and one strike slowed down with its phases labelled. Staged on open ground
// (residents and monsters placed, health raised so the targets stay up); the blows, skills and effects are the game's.
// The den and Thor's bolt are cut from the dungeon and Thor clips.
import { bootGame } from '../readme-media/capture-session.mjs';
import { sample } from './environment-videos.mjs';
import { overlay } from './optimisation-videos.mjs';
import { docsFolder, ffmpeg } from './video-assembly.mjs';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';

const width = 1280,
  height = 720;

async function stage(page) {
  await page.evaluate(async () => {
    const { MonsterRank } = await import('/packages/engine/src/combat-events.ts');
    const { combatEffectsOf } = await import('/packages/native-renderer/src/combat-effects.ts');
    const { E, game } = media,
      t = game.town,
      c = t.map().camp();
    media.ranks = MonsterRank;
    media.effectsOf = () => combatEffectsOf(game.renderer);
    t.summonRaid = () => {};
    t.releaseMonster = () => {};
    t.scout(c.x, c.y, 18);
    media.hour(11);
    // Open ground east of the camp.
    media.spot = t.grid.nearestWalkable({ x: c.x + 4, y: c.y + 4 });
    const lair = t.map().dungeons().findIndex((d) => d.kind === 3);
    media.lair = Math.max(0, lair);
    media.person = (calling, visual, dx, dy, level = 14) => {
      const at = t.grid.nearestWalkable({ x: media.spot.x + dx, y: media.spot.y + dy }),
        p = t.makePerson(E.Role.Resident, calling, at);
      p.position = at;
      p.level = level;
      p.food = p.rest = p.hydration = p.health = 1;
      p.autoMode = false;
      if (visual) {
        const item = E.itemCatalog.filter((i) => i.category === 'weapon' && i.visual === visual && i.minimumLevel <= level).sort((a, b) => b.attackBonus - a.attackBonus)[0];
        if (item) {
          p.inventory[0] = { item: item.id, quantity: 1 };
          p.equipment.weapon = 1;
        }
      }
      t.folk.push(p);
      return p;
    };
    media.monster = (dx, dy, rank, health = 400) => {
      const at = t.grid.nearestWalkable({ x: media.spot.x + dx, y: media.spot.y + dy }),
        m = new E.Monster(t.nextMonster++, media.lair, at);
      m.home = { ...at };
      m.rank = rank;
      m.vigor = m.health = health;
      m.angry = true;
      t.beasts.push(m);
      return m;
    };
    media.reset = () => {
      t.folk = [];
      t.beasts = [];
      t.changes++;
    };
    media.caption = (text) => {
      media.o.clear();
      if (text) media.o.panel(20, 20, [[text, media.o.accent]], 18);
    };
    game.objectivesCollapsed = true;
    media.look(media.spot, 2.6);
    media.frames(4, 0.05);
  });
}

export async function captureEffectsShowcase(session) {
  const out = {},
    page = await session.page(width, height);
  try {
    await bootGame(page, { width, height, hud: false });
    await overlay(page);
    await stage(page);

    // Weapon strikes by shape: one wielder at a time against a pack.
    await page.evaluate(() => {
      const { E, game } = media,
        t = game.town;
      media.reset();
      media.wielders = [
        ['Sword: cleaves up to three', media.person(E.Calling.Warrior, 'sword', -1.2, 0)],
        ['Mace: crushes and staggers', media.person(E.Calling.Cleric, 'mace', -1.2, 0.8)],
        ['Bow: pierces a second foe behind', media.person(E.Calling.Ranger, 'bow', -3.2, 0.4)],
        ['Staff: a bolt that splashes', media.person(E.Calling.Mage, 'staff', -3.2, -0.6)],
      ];
      for (const [, p] of media.wielders) t.setSkillAuto([p.id], 0, false), t.setSkillAuto([p.id], 1, false);
      for (let i = 0; i < 7; ++i) media.monster(0.6 + (i % 3) * 0.6, -0.6 + Math.floor(i / 3) * 0.6, media.ranks.Swarmer);
      for (const [, p] of media.wielders) t.orderHold([p.id]);
    });
    out.strikes = await sample(page, 'fx-strikes', 8, (i) => {
      const t = media.town,
        k = Math.floor(i / 60) % 4,
        [label, p] = media.wielders[k];
      if (i % 60 === 0) {
        const foe = t.beasts.find((m) => m.health > 0);
        for (const [, q] of media.wielders) t.orderHold([q.id]);
        if (foe) t.orderAttack([p.id], foe.id);
      }
      media.look({ x: media.spot.x - 1, y: media.spot.y }, 3.4);
      media.frame(1 / 30, true);
      media.game.paused = false;
      media.caption(label);
      return media.now;
    });

    // Every calling's two skills, fired by hand in turn.
    await page.evaluate(() => {
      const { E, game } = media,
        t = game.town;
      media.reset();
      media.casters = [
        media.person(E.Calling.Warrior, 'sword', -0.6, 0),
        media.person(E.Calling.Ranger, 'bow', -2.6, 0.6),
        media.person(E.Calling.Mage, 'staff', -2.8, -0.6),
        media.person(E.Calling.Cleric, 'mace', -1.6, 1.2),
        media.person(E.Calling.Bard, 'mace', -1.8, -1.2),
      ];
      for (const p of media.casters) {
        t.setSkillAuto([p.id], 0, false);
        t.setSkillAuto([p.id], 1, false);
        p.health = 0.6;
      }
      for (let i = 0; i < 8; ++i) media.monster(0.8 + (i % 4) * 0.55, -0.8 + Math.floor(i / 4) * 0.8, media.ranks.Swarmer);
      for (const p of media.casters) t.orderHold([p.id]);
      media.casts = [];
      for (const p of media.casters) for (const slot of [0, 1]) media.casts.push([p, slot]);
    });
    out.skills = await sample(page, 'fx-skills', 10, (i) => {
      const t = media.town,
        k = Math.floor(i / 30);
      if (i % 30 === 0 && k < media.casts.length) {
        const [p, slot] = media.casts[k],
          foe = t.beasts.find((m) => m.health > 0);
        p.abilityReadyAt = p.abilityReadyAt2 = 0;
        // Skills that aim at the ground are cast on the pack; the rest act on their own.
        t.useSkill([p.id], slot, foe ? { ...foe.position } : undefined);
        media.cast = t.skillsOf(p)[slot]?.name ?? '';
        media.castBy = E_name(p);
      }
      function E_name(p) {
        return ['Settler', 'Traveller', 'Warrior', 'Ranger', 'Mage', 'Cleric', 'Bard'][p.calling];
      }
      media.look({ x: media.spot.x - 0.8, y: media.spot.y }, 3);
      media.frame(1 / 30, true);
      media.game.paused = false;
      media.caption(media.cast ? `${media.castBy}: ${media.cast}` : '');
      return media.now;
    });

    // Floating numbers: hits merge on a target, crits stand out, a resident's own losses show in another colour.
    await page.evaluate(() => {
      const { E } = media;
      media.reset();
      const a = media.person(E.Calling.Warrior, 'sword', -0.8, 0, 22),
        b = media.person(E.Calling.Ranger, 'bow', -2.4, 0.5, 22);
      for (const p of [a, b]) media.town.setSkillAuto([p.id], 0, true);
      media.monster(0.4, 0, media.ranks.Brute, 2000);
      media.monster(0.6, 0.9, media.ranks.Grunt, 2000);
      media.town.orderAttack([a.id, b.id], media.town.beasts[0].id);
    });
    out.numbers = await sample(page, 'fx-numbers', 5, () => {
      media.look(media.spot, 3);
      media.frame(1 / 30, true);
      media.game.paused = false;
      media.caption('Floating numbers: merged per target, crits larger, losses in red');
      return media.now;
    });

    // One sword blow slowed four times, its phases named from the effect's own age and life.
    await page.evaluate(() => {
      const { E } = media;
      media.reset();
      media.blade = media.person(E.Calling.Warrior, 'sword', -0.7, 0, 22);
      media.town.setSkillAuto([media.blade.id], 0, false);
      media.town.setSkillAuto([media.blade.id], 1, false);
      for (let i = 0; i < 3; ++i) media.monster(0.2 + i * 0.35, -0.3 + i * 0.3, media.ranks.Swarmer);
      media.town.orderAttack([media.blade.id], media.town.beasts[0].id);
    });
    out.timeline = await sample(page, 'fx-timeline', 6, () => {
      media.look({ x: media.spot.x - 0.2, y: media.spot.y }, 4.2);
      media.frame(1 / 120, true);
      media.game.paused = false;
      const fx = media.effectsOf().filter((e) => e.life > 0).sort((a, b) => b.at - a.at)[0],
        u = fx ? (media.town.clock() - fx.at) / fx.life : -1,
        phase = !fx || u < 0 || u > 1 ? 'Anticipation: the swing winds up (clip frames before contact)' : u < 0.25 ? 'Strike: the bold peak, inside the first quarter of its life' : u < 0.55 ? 'Hold: the shape stays, flat and two-toned' : 'Leave: strokes thin and the shape breaks into pieces, no fade-out glow';
      media.caption(`Shown at a quarter of its speed · ${phase}`);
      return media.now;
      // Slowed down, the sound would be a quarter of the clip long: this one stays silent.
    }, { silent: true });
  } finally {
    await page.context().close();
  }
  // The den and Thor's bolt, cut from the clips that already show them with their sound.
  const cut = async (from, name, start, seconds) => {
    const src = resolve(docsFolder, `${from}.mp4`),
      dst = resolve(docsFolder, `${name}.mp4`);
    ffmpeg(['-ss', String(start), '-i', src, '-t', String(seconds), '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dst]);
    ffmpeg(['-ss', '1', '-i', dst, '-frames:v', '1', '-q:v', '4', resolve(docsFolder, `${name}.jpg`)]);
    return { file: `docs/${name}.mp4`, bytes: (await stat(dst)).size };
  };
  out.den = await cut('dungeon-arc', 'fx-den', 16.2, 6.5);
  out.thor = await cut('thor-night-hunt', 'fx-thor', 0, 6.5);
  return out;
}
