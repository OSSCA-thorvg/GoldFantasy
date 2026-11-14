import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Pictures of the army, a fight beyond a gate and the newer buildings in Korean, to look at for English left behind
// and for words that do not fit their boxes.
const output = 'artifacts/regression/korean';
const report = { errors: [], passed: false, shots: [], untranslated: [] };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'korean-hud-validation',
        configureServer(vite) {
          vite.middlewares.use('/korean-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Korean HUD validation</title></head><body style="margin:0;background:#11191c;overflow:hidden"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    // The real GPU: SwiftShader takes most of a second per frame in a full world.
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 560000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/korean-probe`);
  await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts, loadKoreanFont },
      { BrowserFiles },
      { createNativeServices },
      { BrowserHost },
      { defaultLaunchOptions },
      { Activity, Calling, Role },
      { project },
      { sealable, sealFloors },
      { monsterEntrance },
      { Building },
      { Structure, Resources },
      { itemCatalog },
      localization,
      { freehandRoad },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/apps/web/src/native/browser-files.ts'),
      import('/apps/web/src/native/bootstrap.ts'),
      import('/apps/web/src/native/browser-host.ts'),
      import('/apps/web/src/native/application-contracts.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/gate-seals.ts'),
      import('/packages/engine/src/town-monsters.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
      import('/packages/engine/src/equipment.ts'),
      import('/packages/localization/src/index.ts'),
      import('/packages/engine/src/road-network.ts'),
    ]);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    element.style.cssText = 'display:block;width:1280px;height:800px';
    document.body.append(element);
    const fonts = await loadNativeFonts(tvg);
    await loadKoreanFont(tvg, fonts);
    localization.setLocale('KR');
    const files = await BrowserFiles.open('korean-hud-validation'),
      services = createNativeServices(tvg, fonts, files),
      app = services.createApplication({ ...defaultLaunchOptions(), world: 'Random', seed: 5 }),
      host = new BrowserHost(element, tvg, app, { autoStart: false, devicePixelRatio: false }),
      game = app.game,
      town = game.town,
      sites = town.map().dungeons(),
      gate = sites.findIndex(sealable),
      site = sites[gate],
      origin = town.map().camp();
    game.touchMode = false;
    town.awaiting = false;
    site.discovered = true;
    const camp = new Building(0, Structure.Camp, origin, 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    town.editHour(10);
    town.scout(origin.x, origin.y, 18);
    town.folk = [];
    // The party: one of each fighting calling, armed, at a level that has both skills.
    const shape = (c) => (c === Calling.Warrior ? 'sword' : c === Calling.Ranger ? 'bow' : c === Calling.Mage ? 'staff' : 'mace');
    for (const calling of [Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Bard]) {
      const p = town.makePerson(Role.Resident, calling, { x: origin.x + 1.5, y: origin.y + 1.5 });
      p.home = p.village = 0;
      p.level = 8;
      p.food = p.rest = p.hydration = 1;
      const item = itemCatalog
        .filter((i) => i.category === 'weapon' && i.visual === shape(p.calling) && i.minimumLevel <= p.level)
        .sort((a, b) => b.attackBonus - a.attackBonus)[0];
      if (item) {
        p.inventory[0] = { item: item.id, quantity: 1 };
        p.equipment.weapon = 1;
      }
      town.folk.push(p);
    }
    // Settlers for the buildings, and the buildings of the inspectors.
    while (town.population() < 16) {
      const p = town.makePerson(Role.Resident, Calling.Settler, { x: origin.x + 0.5, y: origin.y + 0.5 });
      p.home = p.village = 0;
      town.folk.push(p);
    }
    const spiral = (kind) => {
      for (let r = 2.5; r < 18; r += 0.5)
        for (let a = 0; a < 32; ++a) {
          const p = { x: origin.x + r * Math.cos((a * Math.PI) / 16), y: origin.y + r * Math.sin((a * Math.PI) / 16) };
          if (town.canPlace(kind, p, 0).ok && town.place(kind, p, 0)) return town.placed.at(-1);
        }
      return null;
    };
    for (let a = 0, road = false; a < 16 && !road; ++a) {
      const dx = Math.cos((a * Math.PI) / 8),
        dy = Math.sin((a * Math.PI) / 8);
      road = town.buildRoad(freehandRoad([0.8, 2, 3.5, 5, 6.5].map((r) => ({ x: origin.x + dx * r, y: origin.y + dy * r })), 0.2));
    }
    const placed = {};
    for (const kind of [
      Structure.Shrine,
      Structure.MarketStalls,
      Structure.MageTower,
      Structure.Runestone,
      Structure.Guild,
      Structure.Watchtower,
      Structure.TrainingYard,
    ])
      placed[kind] = spiral(kind);
    town.completeConstruction();
    town.stock(0).add(new Resources(240, 60, 40, 30, 60));
    town.stock(0).mana = 30;
    const settlers = town.folk.filter((p) => p.calling === Calling.Settler);
    for (const kind of [Structure.MarketStalls, Structure.MageTower]) if (placed[kind]) town.setWorkers(placed[kind].id, 1);
    for (const [name, calling, level, cause, place, day] of [
      ['Sigrun', Calling.Ranger, 6, 'Killed by the guardian', 'Muspelheim', 9],
      ['Ulf', Calling.Warrior, 4, 'Killed by monsters', 'Midgard', 14],
    ])
      town.fallen.push({ id: 900 + day, name, past: '', look: 0, calling, race: 0, level, days: day, kills: 3, cause, place, day, at: day * 600, position: { ...origin } });
    window.korean = {
      app,
      host,
      game,
      town,
      gate,
      placed,
      settlers,
      Activity,
      Calling,
      sealFloors,
      now: 1,
      frame(dt = 0.05) {
        this.now += dt;
        host.render(this.now);
      },
      frames(count, dt = 0.05) {
        for (let i = 0; i < count; ++i) this.frame(dt);
      },
      screen(p) {
        return game.toScreen(p);
      },
      look(p, zoom = 1.7) {
        const at = project(p.x, p.y);
        game.camera.x = at.x;
        game.camera.y = at.y;
        game.camera.zoom = zoom;
        game.invalidatePresentation();
      },
      clear() {
        game.selectTool(0);
        game.selectPeople([]);
        game.selected = game.selectedDungeon = -1;
        game.globalCard = game.card = -1;
        game.drawerPinned = false;
      },
      fighters() {
        return town.folk.filter((p) => p.calling !== Calling.Settler && p.health > 0);
      },
      member(calling) {
        return town.folk.find((p) => p.calling === calling);
      },
      enterGate() {
        const entry = monsterEntrance(site);
        for (const p of this.fighters()) {
          p.position = { ...entry };
          p.activity = Activity.Expedition;
          p.inside = true;
        }
        town.parties.push({ dungeon: gate, members: this.fighters().map((p) => p.id), floor: 0 });
      },
      controls() {
        return game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled }));
      },
      untranslated() {
        return localization.untranslated();
      },
    };
    korean.frames(6);
    element.focus();
  });
  const frames = (count, dt = 0.05) => page.evaluate(([count, dt]) => korean.frames(count, dt), [count, dt]);
  const controls = () => page.evaluate(() => korean.controls());
  const settle = () =>
    page.evaluate(() => {
      for (let i = 0; i < 20 && korean.game.animatingUi(); ++i) korean.frame(0.05);
    });
  const center = async (id) => {
    const control = (await controls()).find((c) => c.id === id);
    assert(control, `Missing ${id}: ${(await controls()).map((c) => c.id).join(', ')}`);
    return { x: control.bounds.x + control.bounds.w / 2, y: control.bounds.y + control.bounds.h / 2 };
  };
  const hover = async (id) => {
    const at = await center(id);
    await page.mouse.move(at.x, at.y);
    await frames(3, 0.001);
  };
  const away = () => page.mouse.move(640, 330);
  const shot = async (name) => {
    await frames(2, 0.001);
    const path = `${output}/${name}.png`;
    await page.screenshot({ path });
    report.shots.push(path);
  };

  // The expedition forecast: the gate dialog with the fighters selected.
  await page.evaluate(() => {
    const t = korean.town,
      site = t.map().dungeons()[korean.gate];
    korean.clear();
    for (const p of korean.fighters()) p.position = { x: site.origin.x + 2, y: site.origin.y + 3 };
    // Nobody selected: the dialog weighs every fighter of the settlement.
    korean.game.selectPeople([]);
    korean.game.selectedDungeon = korean.gate;
    korean.look({ x: site.origin.x + 1, y: site.origin.y + 2 }, 1.3);
  });
  await frames(8);
  await settle();
  await shot('expedition-forecast');

  // Beyond the gate: the party selected, the orders card and the skill card.
  await page.evaluate(() => {
    korean.clear();
    korean.enterGate();
  });
  await frames(6);
  await settle();
  await away();
  await shot('orders-card');
  await hover('unit/card-hold');
  await shot('orders-card-tooltip');
  await hover('skill-calling-' + 4);
  await shot('skill-calling-tooltip');
  await away();
  // One mage: both skills large, with a tooltip on the second.
  await page.evaluate(() => korean.game.selectPeople([korean.member(korean.Calling.Mage).id]));
  await frames(4);
  await settle();
  await hover('ability-frost');
  await shot('skill-card-tooltip');
  await hover('skill-auto-burst');
  await shot('skill-auto-tooltip');
  await away();
  // Control groups: the whole party as group 1, the front line as group 2.
  await page.evaluate(() => korean.game.selectPeople(korean.fighters().map((p) => p.id)));
  await frames(2, 0.001);
  await page.keyboard.press('Control+1');
  await page.evaluate(() =>
    korean.game.selectPeople([korean.member(korean.Calling.Warrior).id, korean.member(korean.Calling.Cleric).id]),
  );
  await frames(2, 0.001);
  await page.keyboard.press('Control+2');
  await page.evaluate(() => korean.game.selectPeople([korean.member(korean.Calling.Ranger).id]));
  await frames(4);
  await settle();
  await hover('group-1');
  await shot('control-groups-tooltip');
  await hover('group-new');
  await shot('control-groups-new-tooltip');
  await away();

  // A den falls: the banner, the dens counter in the realm panel.
  await page.evaluate(() => {
    const t = korean.town,
      den = t.realmDens()[0],
      warrior = korean.member(korean.Calling.Warrior);
    korean.game.selectPeople(korean.fighters().map((p) => p.id));
    for (const p of korean.fighters()) p.position = { x: den.position.x - 2, y: den.position.y + 1 };
    korean.look(den.position, 1.5);
    den.health = 0;
    t.combatState.slayers.set(den.id, warrior.id);
  });
  await frames(4);
  const banner = await page.evaluate(() => ({
    banners: korean.game.army.banners.map((b) => ({ ...b })),
    time: korean.game.context.time(),
    cues: korean.town.combatEvents().slice(-6).map((e) => [e.cue, e.at]),
    clock: korean.town.clock(),
  }));
  assert(banner.banners.length, 'A den falling raises a banner ' + JSON.stringify(banner));
  await shot('swarm-den-banner');

  // The guardian roused: the auto-pause, then its bar winding up a slam.
  await page.evaluate(() => {
    const t = korean.town,
      g = t.creature(t.realmGuardian),
      p = korean.member(korean.Calling.Warrior).position;
    g.position = { x: p.x + 1.6, y: p.y + 0.6 };
    g.home = { ...g.position };
    g.path = [];
    g.angry = true;
    korean.look(p, 1.5);
  });
  await frames(2);
  await shot('guardian-auto-pause');
  await page.keyboard.press('Space');
  await page.evaluate(() => {
    const t = korean.town,
      g = t.creature(t.realmGuardian);
    g.health = g.vigor * 0.42;
    g.windupUntil = t.clock() + 1.6;
    korean.game.paused = true;
  });
  await frames(2, 0.001);
  await shot('guardian-bar');

  // A resident goes down: the auto-pause banner and the downed card with its tooltip.
  await page.evaluate(() => {
    const t = korean.town,
      g = t.creature(t.realmGuardian);
    g.windupUntil = -1;
    korean.game.paused = false;
    korean.game.combatHud.autoPause = null;
    for (const p of korean.fighters()) t.setSkillAuto([p.id], 0, false);
    t.strikeDown(korean.member(korean.Calling.Bard), 'Killed by the guardian');
  });
  await frames(2);
  const bard = await page.evaluate(() => korean.member(korean.Calling.Bard).id);
  await shot('downed-auto-pause');
  await hover(`downed-${bard}`);
  await shot('downed-card-tooltip');
  await hover(`realm-member-${bard}`);
  await shot('realm-member-tooltip');
  await away();

  // The bard bleeds out: the memorial.
  await page.evaluate(() => {
    const t = korean.town,
      b = korean.member(korean.Calling.Bard);
    korean.game.paused = false;
    korean.game.combatHud.autoPause = null;
    b.downedAt = Math.max(0, t.clock() - t.bleedOutTotal(b) - 0.5);
  });
  for (let i = 0; i < 10 && !(await page.evaluate(() => korean.town.fallen.length > 2)); ++i) await frames(2, 0.1);
  await page.evaluate(() => (korean.game.paused = true));
  await frames(2, 0.001);
  await shot('memorial');

  // The same fight on a phone, in touch mode.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.querySelector('canvas').style.cssText = 'display:block;width:390px;height:844px';
    korean.game.touchMode = true;
    korean.town.strikeDown(korean.member(korean.Calling.Ranger), 'Killed by monsters');
    korean.game.selectPeople(korean.fighters().filter((p) => p.downedAt < 0).map((p) => p.id));
  });
  await frames(4);
  await settle();
  await shot('phone-combat');
  await page.evaluate(() => {
    korean.game.combatHud.memorials = [];
    korean.game.selectPeople([korean.member(korean.Calling.Mage).id]);
  });
  await frames(4);
  await settle();
  await shot('phone-skill-card');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    document.querySelector('canvas').style.cssText = 'display:block;width:1280px;height:800px';
    korean.game.touchMode = false;
    korean.game.paused = false;
    korean.game.combatHud.memorials = [];
    korean.game.combatHud.autoPause = null;
  });
  // Home again: the party walks out through the portal-free way home.
  await page.evaluate(() => {
    const t = korean.town;
    for (const g of t.realmFoes()) g.health = 0;
    t.stir(0.1);
    t.realmReward = null;
    for (const p of t.realmParty()) {
      if (p.downedAt >= 0) t.revive(p);
      p.activity = korean.Activity.Idle;
    }
    t.leaveRealm();
    korean.clear();
    korean.game.paused = false;
  });
  await frames(4);

  // The settlement's newer buildings.
  for (const [name, kind] of [
    ['altar', 13],
    ['market', 5],
    ['mage-tower', 14],
    ['runestone', 37],
    ['watchtower', 35],
    ['training-yard', 36],
  ]) {
    await page.evaluate(
      ([kind, name]) => {
        const t = korean.town,
          b = korean.placed[kind];
        korean.clear();
        if (name === 'watchtower') korean.settlers[0].job = b.id;
        if (name === 'training-yard') {
          korean.settlers[1].job = korean.settlers[2].job = b.id;
          korean.settlers[2].level = 12;
          b.attendance = 0.5;
        }
        korean.game.selectBuilding(b.id);
        korean.look(b.center, 1.6);
        void t;
      },
      [kind, name],
    );
    await frames(10);
    await settle();
    await away();
    if (name === 'market') {
      const buy = (await controls()).find((c) => c.id.startsWith('market-buy-'));
      assert(buy, 'market offers are listed');
      await shot(name);
      await page.mouse.move(buy.bounds.x + buy.bounds.w / 2, buy.bounds.y + buy.bounds.h / 2);
      await frames(3, 0.001);
      await shot('market-hover');
      continue;
    }
    await shot(name);
  }
  // Boons: the gate's boon, then every gate sealed and the boons beside the gates counter.
  await page.evaluate(() => {
    korean.clear();
    korean.game.selectedDungeon = korean.gate;
  });
  await frames(10);
  await shot('gate-boon');
  await page.evaluate(() => {
    const t = korean.town;
    korean.clear();
    t.depth = t.map().dungeons().map((site, i) => (i % 2 === 0 ? korean.sealFloors : 0));
  });
  await frames(10);
  await hover('quest-boons');
  await shot('boons');
  await away();

  // Winter outlook in autumn, short of food, on the calendar.
  await page.evaluate(() => {
    korean.clear();
    korean.town.days = 35;
    korean.town.editHour(10);
    korean.town.stock(0).food = 4;
  });
  await frames(4);
  await hover('sky-calendar');
  await shot('winter-calendar');

  report.untranslated = await page.evaluate(() => korean.untranslated());
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)).catch(() => {});
  if (!report.passed) console.error(report.errors.join('\n'));
  else console.log('Korean HUD browser validation passed');
}
