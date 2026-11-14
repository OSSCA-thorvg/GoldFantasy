import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// A party beyond a gate under real keys and clicks: skills, control groups, hold, attack-move, a den and the brood,
// the guardian, a fall, a rescue and a death.
const output = 'artifacts/regression/combat-loop';
const report = { errors: [], passed: false, shots: [] };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'combat-loop-validation',
        configureServer(vite) {
          vite.middlewares.use('/combat-loop-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Combat loop validation</title></head><body style="margin:0;background:#11191c;overflow:hidden"></body></html>',
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
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/combat-loop-probe`);
  await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { BrowserFiles },
      { createNativeServices },
      { BrowserHost },
      { defaultLaunchOptions },
      { Activity, Calling, Role },
      { project },
      { sealable },
      { monsterEntrance },
      { Building },
      { Structure },
      { itemCatalog },
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
    ]);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    element.style.cssText = 'display:block;width:1280px;height:800px';
    document.body.append(element);
    const fonts = await loadNativeFonts(tvg),
      files = await BrowserFiles.open('combat-loop-validation'),
      services = createNativeServices(tvg, fonts, files),
      app = services.createApplication({ ...defaultLaunchOptions(), world: 'Random', seed: 5 }),
      host = new BrowserHost(element, tvg, app, { autoStart: false, devicePixelRatio: false }),
      game = app.game,
      town = game.town,
      gate = town.map().dungeons().findIndex(sealable),
      site = town.map().dungeons()[gate];
    game.touchMode = false;
    // A new game waits for the first order; the start is not what this run is about.
    town.awaiting = false;
    site.discovered = true;
    const camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    town.folk = [];
    for (const calling of [Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Bard])
      town.folk.push(town.makePerson(Role.Resident, calling, monsterEntrance(site)));
    // Each with the best weapon of its calling's shape: blows beyond a gate lose most of their force to the hide.
    const shape = (c) => (c === Calling.Warrior ? 'sword' : c === Calling.Ranger ? 'bow' : c === Calling.Mage ? 'staff' : 'mace');
    for (const p of town.folk) {
      p.level = 22;
      p.food = p.rest = p.hydration = 1;
      const item = itemCatalog
        .filter((i) => i.category === 'weapon' && i.visual === shape(p.calling) && i.minimumLevel <= p.level)
        .sort((a, b) => b.attackBonus - a.attackBonus)[0];
      if (item) {
        p.inventory[0] = { item: item.id, quantity: 1 };
        p.equipment.weapon = 1;
      }
    }
    window.enterGate = () => {
      for (const p of town.folk) {
        p.position = { ...monsterEntrance(site) };
        p.activity = Activity.Expedition;
        p.inside = true;
      }
      town.parties.push({ dungeon: gate, members: town.folk.map((p) => p.id), floor: 0 });
    };
    window.gate = gate;
    window.loop = {
      app,
      host,
      game,
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
      member(calling) {
        return game.town.realmParty().find((p) => p.calling === calling);
      },
      look(p, zoom = 1.7) {
        const at = project(p.x, p.y);
        game.camera.x = at.x;
        game.camera.y = at.y;
        game.camera.zoom = zoom;
        game.invalidatePresentation();
      },
      snapshot() {
        const t = game.town;
        return {
          active: t.realmActive(),
          clock: t.clock(),
          paused: game.paused,
          status: game.status,
          chosen: [...game.chosen],
          party: t.realmParty().map((p) => ({
            id: p.id,
            calling: p.calling,
            downed: p.downedAt >= 0,
            task: p.task,
            activity: p.activity,
            ready: p.abilityReadyAt,
            health: p.health,
            woundDays: p.woundDays,
          })),
          fallen: t.fallen.map((f) => f.name),
          memorials: game.combatHud.memorials.length,
          autoPause: game.combatHud.autoPause?.title ?? null,
          camera: { x: game.camera.x, y: game.camera.y },
          entry: t.realmPlan() ? project(t.realmPlan().entry.x, t.realmPlan().entry.y) : null,
          controls: game.context.controls.map((c) => ({ id: c.id, bounds: { ...c.bounds }, enabled: c.enabled })),
          groups: Object.fromEntries([...game.army.groups].map(([digit, ids]) => [digit, [...ids]])),
          aim: game.army.aim ? { ...game.army.aim } : null,
          dens: t.realmActive() ? t.realmDens().map((d) => ({ id: d.id, x: d.position.x, y: d.position.y })) : [],
          banners: game.army.banners.map((b) => b.title),
          cleared: t.realmCleared,
          skills: t.realmParty().map((p) => ({ id: p.id, calling: p.calling, first: p.abilityReadyAt, second: p.abilityReadyAt2, holding: p.holding })),
        };
      },
    };
    loop.frames(6);
    element.focus();
  });
  const snapshot = () => page.evaluate(() => loop.snapshot());
  const frames = (count, dt = 0.05) => page.evaluate(([count, dt]) => loop.frames(count, dt), [count, dt]);
  const shot = async (name) => {
    await frames(2, 0.001);
    const path = `${output}/${name}.png`;
    await page.screenshot({ path });
    report.shots.push(path);
  };
  // A new selection slides the panel in; its buttons exist once it has settled.
  const settle = () =>
    page.evaluate(() => {
      for (let i = 0; i < 20 && loop.game.animatingUi(); ++i) loop.frame(0.05);
    });
  const click = async (id, options = {}) => {
    const control = (await snapshot()).controls.find((c) => c.id === id);
    assert(control, `Missing ${id}`);
    assert(control.enabled, `Disabled ${id}`);
    await page.mouse.click(control.bounds.x + control.bounds.w / 2, control.bounds.y + control.bounds.h / 2, options);
    await frames(2, 0.001);
    await settle();
  };
  // The gate's dialog says what the floor holds before anyone goes in.
  await page.evaluate(() => {
    const t = loop.game.town,
      site = t.map().dungeons()[window.gate];
    loop.game.selectPeople([]);
    loop.game.selectedDungeon = window.gate;
    for (const p of t.folk) p.position = { x: site.origin.x + 2, y: site.origin.y + 3 };
    loop.look({ x: site.origin.x + 1, y: site.origin.y + 2 }, 1.3);
  });
  await frames(8);
  await shot('expedition-forecast');
  await page.evaluate(() => {
    loop.game.selectedDungeon = -1;
    window.enterGate();
  });
  // Arrival: the party is beyond the gate and selected.
  await frames(6);
  let state = await snapshot();
  assert(state.active, 'The party is beyond the gate');
  assert.equal(state.party.length, 5);
  assert.equal(state.chosen.length, 5);
  assert(state.controls.some((c) => c.id === 'skill-calling-4'), 'The card has a tab for each calling');
  await shot('abilities-party');
  // Tab cycles the card through the callings of the selection: warrior, ranger, mage.
  await page.mouse.move(640, 300);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await frames(1, 0.001);
  state = await snapshot();
  assert(state.controls.some((c) => c.id === 'ability-burst'), 'Tab shows the mage skills');
  assert(state.controls.some((c) => c.id === 'ability-frost'), 'The mage card lists the Frost Ring');
  await shot('abilities-tab-mage');
  // A party frame selects the mage alone: one ability entry with its auto-use toggle.
  const mage = state.party.find((p) => p.calling === 4);
  await click(`realm-member-${mage.id}`);
  state = await snapshot();
  assert.deepEqual(state.chosen, [mage.id]);
  assert(state.controls.some((c) => c.id === 'skill-auto-burst'));
  await shot('abilities-mage');
  // Q quick-casts the rune at the ground under the cursor.
  const ground = await page.evaluate(() => {
    const p = loop.member(4).position;
    return loop.screen({ x: p.x + 2, y: p.y + 1 });
  });
  await page.mouse.move(ground.x, ground.y);
  // Held: the rune's true radius lies on the ground under the cursor; the release casts it there.
  await page.keyboard.down('q');
  await frames(2, 0.001);
  state = await snapshot();
  assert.equal(state.aim?.slot, 0, 'Holding Q aims the Rune Burst');
  await shot('skill-aim-radius');
  await page.keyboard.up('q');
  await frames(2);
  state = await snapshot();
  assert(state.party.find((p) => p.id === mage.id).ready > state.clock, `Q cast the Rune Burst (${state.status})`);
  await page.keyboard.press('q');
  await frames(1, 0.001);
  state = await snapshot();
  assert.match(state.status, /^Rune Burst is ready in \d+ s$/);
  await shot('ability-cooldown');
  // Backquote selects the whole party again.
  await page.keyboard.press('`');
  await frames(1, 0.001);
  assert.equal((await snapshot()).chosen.length, 5);
  // A hard blow downs the warrior: the game pauses and says so; the alert drains over them.
  await page.evaluate(() => {
    const warrior = loop.member(2),
      cleric = loop.member(5);
    // The cleric's Mend would get the warrior up at once; leave the rescue to the player.
    loop.game.town.setAbilityAuto([cleric.id], false);
    loop.game.town.strikeDown(warrior, 'Killed by the guardian');
    loop.look(warrior.position);
  });
  await frames(2);
  state = await snapshot();
  assert(state.paused, 'A fall pauses the game');
  assert.match(state.autoPause, /is down$/);
  const warrior = state.party.find((p) => p.calling === 2);
  assert(warrior.downed);
  assert(state.controls.some((c) => c.id === `downed-${warrior.id}`));
  await shot('downed-auto-pause');
  // Orders while paused: the alert selects the nearest helper, a right-click on the body sends them.
  await click(`downed-${warrior.id}`);
  state = await snapshot();
  assert.equal(state.chosen.length, 1, 'The alert selects the nearest ally');
  // Another ally is sent by hand: select the ranger from the party list, right-click the body.
  const helper = state.party.find((p) => p.calling === 3).id;
  await click(`realm-member-${helper}`);
  assert.deepEqual((await snapshot()).chosen, [helper]);
  const body = await page.evaluate(() => loop.screen(loop.member(2).position));
  await page.mouse.click(body.x, body.y, { button: 'right' });
  await frames(1, 0.001);
  state = await snapshot();
  assert.equal(state.party.find((p) => p.id === helper).task, 30 /* Activity.Tending */, `The helper goes to tend (${state.status})`);
  // Space resumes; the helper kneels and gets the warrior up.
  await page.keyboard.press('Space');
  await frames(2);
  assert(!(await snapshot()).paused, 'Space resumes');
  for (let i = 0; i < 30 && (await snapshot()).party.find((p) => p.id === warrior.id).downed; ++i) await frames(10, 0.1);
  state = await snapshot();
  const revived = state.party.find((p) => p.id === warrior.id);
  assert(!revived.downed && revived.woundDays > 0, 'The warrior is back up, wounded');
  // R recalls the party to the way home and brings the view there.
  await page.mouse.move(640, 400);
  await page.keyboard.press('r');
  await frames(1, 0.001);
  state = await snapshot();
  assert(Math.abs(state.camera.x - state.entry.x) < 1 && Math.abs(state.camera.y - state.entry.y) < 1, 'R recalls');
  // The guardian is roused: one pause, a bar at the top and its wind-up.
  await page.evaluate(() => {
    const t = loop.game.town,
      g = t.creature(t.realmGuardian),
      p = loop.member(2).position;
    // Its lair is far from the way home; bring the lair along so it stays on the party.
    loop.lair = { ...g.home };
    g.position = { x: p.x + 1.6, y: p.y + 0.6 };
    g.home = { ...g.position };
    g.path = [];
    g.angry = true;
    loop.look(p, 1.5);
  });
  await frames(2);
  state = await snapshot();
  assert(state.paused, 'The roused guardian pauses the game');
  assert.match(state.autoPause, /^The guardian of .+ is roused$/);
  await page.evaluate(() => {
    const t = loop.game.town,
      g = t.creature(t.realmGuardian);
    g.health = g.vigor * 0.42;
    g.windupUntil = t.clock() + 1.6;
    t.emit(9, { ...g.position }, { creature: g.id, radius: 2.2, duration: 1.6 });
  });
  await frames(2, 0.001);
  assert((await snapshot()).controls.some((c) => c.id === 'guardian-bar'));
  await shot('guardian-windup');
  await click('auto-pause-resume');
  state = await snapshot();
  assert(!state.paused && !state.autoPause, 'Resume clears the banner');
  await page.evaluate(() => {
    const t = loop.game.town,
      g = t.creature(t.realmGuardian);
    g.windupUntil = -1;
    g.angry = false;
    g.position = { ...loop.lair };
    g.home = { ...loop.lair };
  });
  // Commanding a few: two control groups, one holds a chokepoint, the other attack-moves at a den and fires
  // both skills of the ranger and the mage by hand with the cursor; the den falls and the brood breaks.
  // The fight below shows the controls, not the balance: the party is healed and the wandering packs are taken
  // off the floor, so the run stays short.
  await page.evaluate(() => {
    const t = loop.game.town,
      e = t.realmPlan().entry,
      gap = (m, at) => Math.hypot(m.position.x - at.x, m.position.y - at.y),
      den = t.realmDens().sort((a, b) => gap(a, e) - gap(b, e))[0];
    // The packs of the other dens stay in their chambers, so something is left for the brood to break.
    const dens = t.realmDens();
    t.beasts = t.beasts.filter(
      (m) => m.rank === 6 || m.id === t.realmGuardian || !t.inRealm(m.home) || gap(m, den.position) < 5 || dens.some((d) => d !== den && gap(m, d.position) < 6),
    );
    for (const p of t.realmParty()) {
      p.health = 1;
      p.woundDays = 0;
    }
  });
  state = await snapshot();
  const id = (calling) => state.party.find((p) => p.calling === calling).id,
    [warriorId, rangerId, mageId, clericId, bardId] = [2, 3, 4, 5, 6].map(id);
  const resume = async () => {
    const now = await snapshot();
    if (!now.paused) return;
    if (now.controls.some((c) => c.id === 'memorial-close')) await click('memorial-close');
    await page.keyboard.press('Space');
    await frames(1, 0.001);
  };
  const fight = async (count, until) => {
    for (let i = 0; i < count; ++i) {
      await resume();
      await frames(4, 0.25);
      if (until && (await until())) return true;
    }
    return false;
  };
  const toScreen = (p) => page.evaluate((p) => loop.screen(p), p);
  // Group 1: the warrior and the bard hold; group 2: the ranger, the mage and the cleric who keeps them up.
  await click(`realm-member-${warriorId}`);
  await page.keyboard.press('Control+1');
  await click(`realm-member-${bardId}`);
  await page.keyboard.press('Shift+1');
  await click(`realm-member-${rangerId}`);
  await page.keyboard.press('Control+2');
  await click(`realm-member-${mageId}`);
  await page.keyboard.press('Shift+2');
  await click(`realm-member-${clericId}`);
  await page.keyboard.press('Shift+2');
  await frames(1, 0.001);
  state = await snapshot();
  assert.deepEqual(state.groups, { 1: [warriorId, bardId], 2: [rangerId, mageId, clericId] }, 'Ctrl and Shift with a digit make the groups');
  assert(state.controls.some((c) => c.id === 'group-1') && state.controls.some((c) => c.id === 'group-2'));
  await page.keyboard.press('1');
  await frames(1, 0.001);
  assert.deepEqual((await snapshot()).chosen, [warriorId, bardId], '1 selects group 1');
  const away = await page.evaluate(() => {
    loop.look({ x: loop.member(2).position.x + 12, y: loop.member(2).position.y + 9 });
    return { x: loop.game.camera.x, y: loop.game.camera.y };
  });
  await page.keyboard.press('1');
  await page.keyboard.press('1');
  await frames(1, 0.001);
  state = await snapshot();
  assert(Math.hypot(state.camera.x - away.x, state.camera.y - away.y) > 50, '1 twice looks at group 1');
  await shot('control-groups');
  // Group 1 walks to the mouth of the corridor out of the first chamber and holds it.
  const choke = await page.evaluate(() => {
    const t = loop.game.town,
      plan = t.realmPlan(),
      entry = plan.chambers[0],
      next = plan.chambers[entry.links[0]],
      spot = t.grid.nearestWalkable({
        x: entry.center.x + (next.center.x - entry.center.x) * 0.45,
        y: entry.center.y + (next.center.y - entry.center.y) * 0.45,
      });
    loop.look(spot, 1.5);
    loop.game.speed = 3;
    return spot;
  });
  await frames(2, 0.001);
  await page.keyboard.press('1');
  await page.keyboard.press('m');
  // The panel steps aside for the armed order before the click lands.
  await frames(2, 0.001);
  await settle();
  let at = await toScreen(choke);
  await page.mouse.click(at.x, at.y);
  await fight(20, () =>
    page.evaluate(
      (choke) =>
        [loop.member(2), loop.member(6)].every((p) => !p.moving() && Math.hypot(p.position.x - choke.x, p.position.y - choke.y) < 2.5),
      choke,
    ),
  );
  await page.keyboard.press('h');
  await frames(2, 0.001);
  state = await snapshot();
  assert(state.skills.filter((p) => p.holding).map((p) => p.id).sort().join() === [warriorId, bardId].sort().join(), 'H holds group 1');
  await shot('hold-chokepoint');
  // The ranger's and the mage's skills are timed by hand: their auto toggles go off with real clicks.
  await click(`realm-member-${rangerId}`);
  await click('skill-auto-aimed');
  await click('skill-auto-volley');
  await click(`realm-member-${mageId}`);
  await click('skill-auto-burst');
  await click('skill-auto-frost');
  // Group 2 attack-moves at the nearest den. Where each will stand shows on the ground while they walk.
  const den = await page.evaluate(() => {
    const t = loop.game.town,
      e = t.realmPlan().entry,
      d = t.realmDens().sort((a, b) => Math.hypot(a.position.x - e.x, a.position.y - e.y) - Math.hypot(b.position.x - e.x, b.position.y - e.y))[0];
    return { id: d.id, x: d.position.x, y: d.position.y };
  });
  // Open floor in the first chamber, a few steps toward the den.
  const leg = await page.evaluate((den) => {
    const room = loop.game.town.realmPlan().chambers[0],
      dx = den.x - room.center.x,
      dy = den.y - room.center.y,
      l = Math.hypot(dx, dy) || 1,
      at = { x: room.center.x + (dx / l) * room.radius * 0.5, y: room.center.y + (dy / l) * room.radius * 0.5 };
    loop.look(at, 1.7);
    return at;
  }, den);
  await frames(2, 0.001);
  await page.keyboard.press('2');
  await page.keyboard.press('m');
  await frames(2, 0.001);
  await settle();
  // A first leg within sight, so the formation marks are in view; Move ignores the brood.
  at = await toScreen(leg);
  await page.mouse.click(at.x, at.y);
  await frames(3, 0.05);
  await shot('move-formation');
  const group2 = [rangerId, mageId, clericId];
  const selectGroup2 = async () => {
    if ((await snapshot()).chosen.join() !== group2.join()) await page.keyboard.press('2');
  };
  let everyone = false;
  const attackDen = async () => {
    await page.evaluate((den) => loop.look(den, 1.3), den);
    await frames(1, 0.001);
    if (everyone) await page.keyboard.press('`');
    else await selectGroup2();
    await page.keyboard.press('a');
    await frames(2, 0.001);
    await settle();
    // Ground beside the den, not the den itself: attack-move fights the brood on the way and then the den.
    const mage = await page.evaluate(() => ({ ...loop.member(4).position })),
      l = Math.hypot(mage.x - den.x, mage.y - den.y) || 1,
      spot = await toScreen({ x: den.x + ((mage.x - den.x) / l) * 1.2, y: den.y + ((mage.y - den.y) / l) * 1.2 });
    await page.mouse.click(spot.x, spot.y);
  };
  await attackDen();
  await frames(2, 0.05);
  await shot('attack-move-formation');
  const engaged = await fight(40, () =>
    page.evaluate(() => {
      // Close enough for the ranger's Aimed Shot (6 tiles) and both casters' ground skills (8 tiles).
      const r = loop.member(3).position,
        m = loop.member(4).position;
      return loop.game.town
        .realmFoes()
        .some((f) => f.rank !== 6 && Math.hypot(f.position.x - r.x, f.position.y - r.y) < 5 && Math.hypot(f.position.x - m.x, f.position.y - m.y) < 6);
    }),
  );
  assert(engaged, 'Group 2 meets the brood');
  // Paused, the player aims both skills of the ranger and the mage at the thick of the pack.
  await resume();
  await page.keyboard.press('Space');
  // Skills fired on their own before the toggles went off may still be recovering.
  await page.evaluate(() => {
    for (const p of [loop.member(3), loop.member(4)]) p.abilityReadyAt = p.abilityReadyAt2 = 0;
  });
  const before = (await snapshot()).skills;
  // The nearest of the brood, brought to the middle of the view, clear of the panels.
  const pack = await page.evaluate(() => {
    const t = loop.game.town,
      m = loop.member(4).position,
      near = t
        .realmFoes()
        .filter((f) => f.rank !== 6)
        .sort((a, b) => Math.hypot(a.position.x - m.x, a.position.y - m.y) - Math.hypot(b.position.x - m.x, b.position.y - m.y))[0],
      at = { x: (near.position.x * 2 + m.x) / 3, y: (near.position.y * 2 + m.y) / 3 };
    loop.look(at, 1.6);
    return at;
  });
  await frames(1, 0.001);
  await selectGroup2();
  await frames(2, 0.001);
  await settle();
  at = await toScreen(pack);
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down('q');
  await frames(2, 0.001);
  await shot('skills-aim-pack');
  await page.keyboard.up('q');
  await frames(1, 0.001);
  await page.keyboard.down('w');
  await frames(2, 0.001);
  assert.equal((await snapshot()).aim?.slot, 1, 'Holding W aims the second skills');
  await page.keyboard.up('w');
  await frames(1, 0.001);
  state = await snapshot();
  const cast = (who, slot) => state.skills.find((p) => p.id === who)[slot] > before.find((p) => p.id === who)[slot];
  assert(cast(rangerId, 'first') && cast(rangerId, 'second'), `Q and W fire the ranger's Aimed Shot and Volley (${state.status} ${JSON.stringify([before, state.skills, state.clock])})`);
  assert(cast(mageId, 'first') && cast(mageId, 'second'), `Q and W fire the mage's Rune Burst and Frost Ring (${state.status})`);
  await page.keyboard.press('Space');
  await frames(3, 0.1);
  await shot('skills-landed');
  // Three cannot outlast a den that keeps breeding: the skills go back on auto and the holding group joins.
  await click(`realm-member-${rangerId}`);
  await click('skill-auto-aimed');
  await click('skill-auto-volley');
  await click(`realm-member-${mageId}`);
  await click('skill-auto-burst');
  await click('skill-auto-frost');
  everyone = true;
  await attackDen();
  // Attack-move again at the den until it falls: once seen, clicking it makes it everyone's target.
  let tries = 0;
  const fallen = await fight(80, async () => {
    const now = await snapshot();
    assert(now.active, 'The party is still beyond the gate');
    if (!now.dens.some((d) => d.id === den.id)) return true;
    if (!now.paused && ++tries % 4 === 0) await attackDen();
    return false;
  });
  assert(fallen, 'The den falls');
  await frames(1, 0.001);
  state = await snapshot();
  assert(
    state.banners.some((title) => /den is destroyed/.test(title)),
    'A banner marks the den falling ' +
      (await page.evaluate(() => JSON.stringify([loop.game.town.combatEvents().filter((e) => e.cue === 13).map((e) => [e.at, String(e.serial)]), String(loop.game.combatHud.heardEvent), loop.game.town.clock(), loop.now, loop.game.army.banners]))),
  );
  await shot('den-destroyed');
  // The rest of the floor is finished by script to keep the run short; the brood dies with it.
  await page.evaluate(() => {
    const t = loop.game.town,
      ranger = loop.member(3);
    for (const m of [...t.realmDens(), t.creature(t.realmGuardian)]) if (m && m.health > 0) t.hurtCreature(m, m.health + 1, ranger);
  });
  const broken = await fight(10, async () => (await snapshot()).banners.includes('The brood breaks'));
  assert(broken, 'The brood breaks once the floor falls');
  state = await snapshot();
  assert(state.cleared);
  await frames(1, 0.001);
  await shot('brood-break');
  await page.evaluate(() => {
    loop.game.town.realmReward = null;
    loop.game.speed = 1;
  });
  // A death: the bard falls and bleeds out.
  await page.evaluate(() => {
    const bard = loop.member(6);
    loop.game.town.strikeDown(bard, 'Killed by the guardian');
  });
  await frames(2);
  assert((await snapshot()).paused);
  await page.keyboard.press('Space');
  await page.evaluate(() => {
    const bard = loop.member(6);
    // Let the bleed-out run its course at once (the clock is past one full bleed-out by now).
    bard.downedAt = Math.max(0, loop.game.town.clock() - loop.game.town.bleedOutTotal(bard) - 0.5);
  });
  for (let i = 0; i < 10 && !(await snapshot()).fallen.length; ++i) await frames(2, 0.1);
  state = await snapshot();
  assert.equal(state.fallen.length, 1, 'The bard died');
  assert.equal(state.memorials, 1);
  assert(state.controls.some((c) => c.id === 'memorial'));
  await page.evaluate(() => (loop.game.paused = true));
  await shot('memorial');
  // The same moment at 1024x768, with a second resident down beside the memorial.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => {
    document.querySelector('canvas').style.cssText = 'display:block;width:1024px;height:768px';
    loop.game.town.strikeDown(loop.member(3), 'Killed by monsters');
  });
  await shot('memorial-downed-1024');
  await click('memorial-close');
  state = await snapshot();
  assert.equal(state.memorials, 0);
  assert(!state.controls.some((c) => c.id === 'memorial'));
  await shot('after-farewell');
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
  else console.log('combat loop browser validation passed');
}
