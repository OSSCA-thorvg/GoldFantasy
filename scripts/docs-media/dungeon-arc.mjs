// A whole expedition in one clip with chapter titles and the game's sound: the party chosen in the expedition window,
// the walk to the gate, the world beyond rising, the swarm and a den falling, the guardian, and the way home.
// The party is staged (six residents, levelled and armed); to keep it short the second den is finished by script
// and the guardian is brought to the party half spent. Everything else is the game's own play.
import { mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bootGame } from '../readme-media/capture-session.mjs';
import { docsFolder, docsWork, ffmpeg } from './video-assembly.mjs';

const width = 1280,
  height = 720,
  fps = 30;

export async function captureDungeonArc(session) {
  const page = await session.page(width, height),
    folder = resolve(docsWork, 'arc');
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const chapters = [];
  /** Records one chapter: frames until `step` returns true (or `count`), keeping the last `last` seconds if given. */
  const chapter = async (title, { count, last, step, arg }) => {
    const index = chapters.length,
      dir = resolve(folder, String(index));
    await mkdir(dir, { recursive: true });
    await page.evaluate((t) => media.chapter(t), `${index + 1} · ${title}`);
    const times = [];
    let n = 0;
    for (let i = 0; i < count; ++i) {
      const done = await page.evaluate(step, [i, arg]);
      await page.screenshot({ path: resolve(dir, `${String(i).padStart(4, '0')}.png`) });
      times.push(await page.evaluate(() => media.now));
      n = i + 1;
      if (i % 90 === 0) process.stdout.write(`  arc ${index + 1}: frame ${i}\n`);
      if (done === true) break;
    }
    const from = last ? Math.max(0, n - Math.round(last * fps)) : 0;
    chapters.push({ title, dir, from, frames: n - from, start: times[from], end: times[n - 1] + 1 / fps });
  };
  try {
    await bootGame(page, { width, height });
    await page.evaluate(async () => {
      const [{ sealable }, { monsterEntrance }, ex] = await Promise.all([
        import('/packages/engine/src/gate-seals.ts'),
        import('/packages/engine/src/town-monsters.ts'),
        import('/apps/web/src/native/expedition-window.ts'),
      ]);
      const { E, game } = media,
        t = game.town,
        map = t.map(),
        gate = map.dungeons().findIndex(sealable),
        site = map.dungeons()[gate];
      media.ex = ex;
      media.gate = gate;
      media.site = site;
      t.summonRaid = () => {};
      site.discovered = true;
      t.place(E.Structure.Camp, map.camp(), 0);
      t.completeConstruction();
      t.folk = [];
      const shape = (c) => (c === E.Calling.Warrior ? 'sword' : c === E.Calling.Ranger ? 'bow' : c === E.Calling.Mage ? 'staff' : 'mace'),
        names = ['Geirmund', 'Vigdis', 'Hallbera', 'Rannveig', 'Ingjald', 'Torvi'];
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
        p.name = names[t.folk.length];
        t.folk.push(p);
      }
      // They wait a short walk from the gate, so the walk in is seen.
      for (const [i, p] of t.folk.entries())
        p.position = t.grid.nearestWalkable({ x: site.origin.x + 4.5 + (i % 3) * 0.6, y: site.origin.y + 5.5 + Math.floor(i / 3) * 0.6 });
      media.hour(11);
      game.objectivesCollapsed = true;
      game.realmCollapsed = true;
      media.home = { x: site.origin.x + 2.5, y: site.origin.y + 3.5 };
      media.look(media.home, 2);
      media.frames(4, 0.05);
      ex.openExpedition(game, gate, []);
      media.quiet();
      media.frames(4, 0.001);
      // The chapter title over the picture.
      const title = document.createElement('div');
      title.style.cssText = 'position:absolute;left:24px;top:64px;padding:8px 14px;border-radius:6px;background:rgba(20,24,22,.88);border:1px solid rgba(191,161,99,.8);color:rgb(232,190,110);font:700 20px DejaVu Sans,Verdana,sans-serif';
      document.body.append(title);
      media.chapter = (text) => (title.textContent = text);
      media.key = (text) => ({ type: 'KeyDown', text, key: 0, x: 0, y: 0, delta: 0, button: 0, shift: false, control: false, alt: false, meta: false });
    });
    // 1. The window: members are ticked one by one, then Enter sets out.
    await chapter('Gather the party', {
      count: 4.5 * fps,
      step: ([i]) => {
        const ids = media.town.folk.map((p) => p.id),
          k = Math.floor((i - 12) / 15);
        if (i >= 12 && (i - 12) % 15 === 0 && k < ids.length) media.ex.toggleMember(media.game, ids[k]);
        media.frame(1 / 30, true);
        return false;
      },
    });
    // 2. Set out: they walk to the gate and step through.
    await page.evaluate(() => {
      media.game.handleExpeditionEvent(media.key('return'));
      media.game.selectPeople([]);
    });
    await chapter('Through the gate', {
      count: 40 * fps,
      step: ([i]) => {
        media.game.paused = false;
        if (!media.town.realmActive()) media.look(media.home, 2);
        media.frame(1 / 30, true);
        if (media.town.realmActive() && media.inAt === undefined) media.inAt = i;
        return media.inAt !== undefined && i >= media.inAt;
      },
    });
    // 3. The world beyond: the party on the island raised from the sea.
    await chapter('The world beyond', {
      count: 3 * fps,
      step: () => {
        media.game.paused = false;
        media.game.selectPeople([]);
        const e = media.town.realmPlan().entry;
        media.look({ x: e.x, y: e.y }, 1.6);
        media.frame(1 / 30, true);
        return false;
      },
    });
    // 4. The swarm and a den: attack-move at the den nearest the middle of the island.
    await page.evaluate(() => {
      const t = media.town,
        a = t.realmArea,
        middle = { x: a.x + a.size / 2, y: a.y + a.size / 2 },
        gap = (m) => Math.hypot(m.position.x - middle.x, m.position.y - middle.y),
        den = t.realmDens().sort((x, y) => gap(x) - gap(y))[0];
      media.den = den.id;
      media.denAt = { ...den.position };
      media.party = t.realmParty().map((p) => p.id);
      media.attack = () => {
        const up = media.party.map((id) => t.person(id)).filter((p) => p && p.downedAt < 0);
        if (up.length) t.orderAttackMove(up.map((p) => p.id), media.denAt);
      };
      media.attack();
      media.camera = { ...t.person(media.party[0]).position };
    });
    await chapter('Fight the swarm', {
      count: 120 * fps,
      last: 9,
      step: ([i]) => {
        const g = media.game,
          t = media.town,
          up = media.party.map((id) => t.person(id)).filter((p) => p && p.downedAt < 0);
        g.paused = false;
        for (const id of media.party) {
          const p = t.person(id);
          if (p && p.downedAt >= 0 && t.clock() - p.downedAt > 4) t.revive(p);
        }
        if (i % 120 === 119) media.attack();
        const near = up.filter((p) => Math.hypot(p.position.x - media.denAt.x, p.position.y - media.denAt.y) < 7),
          group = near.length ? near : up,
          c = group.reduce((s, p) => ({ x: s.x + p.position.x / (group.length + 1), y: s.y + p.position.y / (group.length + 1) }), {
            x: media.denAt.x / (group.length + 1),
            y: media.denAt.y / (group.length + 1),
          });
        media.camera.x += (c.x - media.camera.x) * 0.08;
        media.camera.y += (c.y - media.camera.y) * 0.08;
        media.look(media.camera, 1.8);
        media.frame(1 / 30, true);
        if (!t.realmDens().some((d) => d.id === media.den) && media.fellAt === undefined) media.fellAt = i;
        return media.fellAt !== undefined && i >= media.fellAt + 45;
      },
    });
    // 5. The guardian: the other den is finished by script; the guardian comes to the party, half spent.
    await page.evaluate(() => {
      const t = media.town,
        lead = media.party.map((id) => t.person(id)).find((p) => p && p.downedAt < 0);
      for (const d of t.realmDens()) t.hurtCreature(d, d.health + 1, lead);
      const g = t.creature(t.realmGuardian);
      media.guardian = g?.id ?? -1;
      if (g) {
        g.position = t.grid.nearestWalkable({ x: lead.position.x + 2.2, y: lead.position.y + 1 });
        g.home = { ...g.position };
        g.path = [];
        g.angry = true;
        g.health = g.vigor * 0.45;
        t.orderAttack(media.party.filter((id) => t.person(id)?.downedAt < 0), g.id);
      }
      media.camera = { ...lead.position };
    });
    await chapter('The guardian', {
      count: 90 * fps,
      step: ([i]) => {
        const t = media.town,
          g = t.creature(media.guardian);
        media.game.paused = false;
        for (const id of media.party) {
          const p = t.person(id);
          if (p && p.downedAt >= 0 && t.clock() - p.downedAt > 4) t.revive(p);
        }
        if (g && g.health > 0) {
          media.camera.x += (g.position.x - media.camera.x) * 0.1;
          media.camera.y += (g.position.y - media.camera.y) * 0.1;
          if (i % 90 === 89) t.orderAttack(media.party.filter((id) => t.person(id)?.downedAt < 0), g.id);
        }
        media.look(media.camera, 1.9);
        media.frame(1 / 30, true);
        if ((!g || g.health <= 0) && media.slainAt === undefined) media.slainAt = i;
        return media.slainAt !== undefined && i >= media.slainAt + 75;
      },
    });
    // 6. Home: the reward is closed and the party goes home with the spoils.
    const controls = await page.evaluate(() => media.controls().map((c) => c.id));
    for (const id of ['realm-reward-close', 'realm-leave']) {
      // The party panel was folded away for the fight; its Go home button is used here as a player would.
      await page.evaluate(() => {
        media.game.realmCollapsed = false;
        media.frames(6, 0.001);
      });
      const c = (await page.evaluate(() => media.controls())).find((c) => c.id === id);
      if (c) await page.mouse.click(c.bounds.x + c.bounds.w / 2, c.bounds.y + c.bounds.h / 2);
      await page.evaluate(() => media.frames(1, 1 / 30, true));
    }
    await page.evaluate(() => (media.game.realmCollapsed = true));
    await chapter('Home with the spoils', {
      count: 5 * fps,
      step: () => {
        media.game.paused = false;
        if (!media.town.realmActive()) media.look(media.home, 1.9);
        media.frame(1 / 30, true);
        return false;
      },
    });
    // Sound per chapter, then each chapter encoded and the lot joined.
    const parts = [];
    for (const [k, c] of chapters.entries()) {
      const mixed = await page.evaluate(([from, to]) => media.mix(from, to), [c.start, c.end]),
        pcm = Buffer.from(mixed.pcm, 'base64'),
        header = Buffer.alloc(44);
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + pcm.length, 4);
      header.write('WAVEfmt ', 8);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(2, 22);
      header.writeUInt32LE(44100, 24);
      header.writeUInt32LE(44100 * 4, 28);
      header.writeUInt16LE(4, 32);
      header.writeUInt16LE(16, 34);
      header.write('data', 36);
      header.writeUInt32LE(pcm.length, 40);
      const wav = resolve(folder, `${k}.wav`),
        mp4 = resolve(folder, `${k}.mp4`);
      await writeFile(wav, Buffer.concat([header, pcm]));
      ffmpeg([
        '-framerate', String(fps), '-start_number', String(c.from), '-i', resolve(c.dir, '%04d.png'), '-i', wav,
        '-frames:v', String(c.frames), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-shortest', mp4,
      ]);
      parts.push({ title: c.title, seconds: +(c.frames / fps).toFixed(1), cues: mixed.cues, peak: +mixed.peak.toFixed(3) });
      await writeFile(resolve(folder, 'list.txt'), chapters.slice(0, k + 1).map((_, j) => `file '${resolve(folder, `${j}.mp4`)}'`).join('\n') + '\n');
    }
    const out = resolve(docsFolder, 'dungeon-arc.mp4');
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', resolve(folder, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', out]);
    ffmpeg(['-ss', String(chapters[0].frames / fps + 1), '-i', out, '-frames:v', '1', '-q:v', '4', resolve(docsFolder, 'dungeon-arc.jpg')]);
    return { dungeonArc: { file: 'docs/dungeon-arc.mp4', bytes: (await stat(out)).size, chapters: parts, controls } };
  } finally {
    await page.context().close();
  }
}
