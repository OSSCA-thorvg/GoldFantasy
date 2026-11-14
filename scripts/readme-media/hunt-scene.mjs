// A hunt: two armed residents are ordered at a wild animal near the camp and bring it down.
// The hunters are staged (two settlers with wooden spears); the chase and the kill are the game's own.
import { bootGame, recordGif } from './capture-session.mjs';

export async function captureHunt(session) {
  const page = await session.page(1280, 720);
  try {
    await bootGame(page, { width: 1280, height: 720 });
    const setup = await page.evaluate(() => {
      const { E, game } = media,
        t = game.town,
        c = t.map().camp();
      t.summonRaid = () => {};
      t.releaseMonster = () => {};
      t.scout(c.x, c.y, 40);
      if (!t.place(E.Structure.Camp, c, 0)) throw Error('Cannot place the camp');
      t.completeConstruction();
      media.hour(10);
      for (let i = 0; i < 40; ++i) t.advance(0.1);
      const map = t.map(),
        gap = (a) => Math.hypot(a.position.x - c.x, a.position.y - c.y),
        // Out in the open, so the chase is not hidden by the forest; a cow, the largest of the game.
        open = (a) => {
          for (let y = Math.floor(a.position.y) - 3; y <= a.position.y + 3; ++y)
            for (let x = Math.floor(a.position.x) - 3; x <= a.position.x + 3; ++x) if (map.inside(x, y) && map.at(x, y).trees) return false;
          return true;
        },
        prey = t
          .wildlife()
          .filter((a) => a.health > 0 && [E.AnimalKind.Cow, E.AnimalKind.Pig].includes(a.animal) && map.revealed(a.position) && open(a))
          .sort((a, b) => b.animal - a.animal === 0 ? gap(a) - gap(b) : a.animal - b.animal)[0];
      if (!prey) throw Error('No animal to hunt near the camp');
      const kit = [
        [E.Calling.Settler, 'spear'],
        [E.Calling.Settler, 'spear'],
      ];
      t.folk = [];
      for (const [k, [calling, visual]] of kit.entries()) {
        const at = t.grid.nearestWalkable({ x: prey.position.x + 3.6 + k * 0.8, y: prey.position.y + 2.2 });
        const p = t.makePerson(E.Role.Resident, calling, at);
        p.position = at;
        p.level = 1;
        p.food = p.rest = p.hydration = p.health = 1;
        const item = E.itemCatalog.filter((i) => i.category === 'weapon' && i.visual === visual).sort((a, b) => a.minimumLevel - b.minimumLevel)[0];
        if (item) {
          p.inventory[0] = { item: item.id, quantity: 1 };
          p.equipment.weapon = 1;
        }
        t.folk.push(p);
      }
      media.hunters = t.folk.map((p) => p.id);
      media.prey = prey.id;
      media.camera = { x: prey.position.x + 2, y: prey.position.y + 1.2 };
      game.objectivesCollapsed = true;
      game.selectPeople([]);
      media.look(media.camera, 2.8);
      media.quiet();
      media.frames(4, 0.05);
      return { animal: E.AnimalKind[prey.animal], weapons: t.folk.map((p) => p.inventory[0]?.item) };
    });
    const gif = await recordGif(page, 'hunt', {
      // The chase runs long; shown at three times its pace.
      count: 400,
      keep: 72,
      fps: 12,
      width: 720,
      clip: { x: 240, y: 135, width: 800, height: 450 },
      step: ([i]) => {
        const t = media.town,
          prey = t.creature(media.prey),
          hunters = media.hunters.map((id) => t.person(id));
        if (i === Math.round(6 * media.rate) && !t.orderAttack(media.hunters, media.prey)) throw Error('The hunt was refused');
        if (media.rate === 1) {
          t.advance(media.dt);
          media.game.dispatchWork();
        }
        if (prey && prey.health > 0) media.preyAt = { ...prey.position };
        const all = [...hunters.map((p) => p.position), media.preyAt ?? hunters[0].position],
          c = all.reduce((s, p) => ({ x: s.x + p.x / all.length, y: s.y + p.y / all.length }), { x: 0, y: 0 });
        media.camera.x += (c.x - media.camera.x) * 0.25;
        media.camera.y += (c.y - media.camera.y) * 0.25;
        media.look(media.camera, 2.8);
        media.frame(media.dt, media.rate !== 1);
        if ((!prey || prey.health <= 0) && media.killedAt === undefined) media.killedAt = i;
        return media.killedAt !== undefined && i >= media.killedAt + 24 * media.rate;
      },
    });
    return { setup, hunt: { ...gif, killedAtFrame: await page.evaluate(() => media.killedAt ?? -1) } };
  } finally {
    await page.context().close();
  }
}
