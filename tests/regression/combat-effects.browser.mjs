import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Stages every combat cue by hand (the simulation stays paused) and saves close-ups for review.
const output = 'artifacts/regression/combat-effects';
const report = { errors: [], passed: false, font: null, shots: [], cost: null };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'combat-effects-validation',
        configureServer(vite) {
          vite.middlewares.use('/combat-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Combat effects validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  // The real GPU: SwiftShader's WebGL is far too slow for a crowd.
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 540000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/combat-probe`);
  report.font = await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { combatFace, loadKoreanFont },
      { setLocale },
      { StrikeKind, skillSpec },
      { WorldRenderer },
      { Town },
      { Traffic },
      { Preview },
      { Activity, Calling, Monster, Role },
      { Camera, project },
      { CombatCue, MonsterRank },
      { treePosition },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/packages/native-ui/src/fonts.ts'),
      import('/packages/localization/src/index.ts'),
      import('/packages/engine/src/skill-catalog.ts'),
      import('/packages/native-renderer/src/world-renderer.ts'),
      import('/packages/engine/src/town.ts'),
      import('/packages/engine/src/traffic.ts'),
      import('/packages/engine/src/game-tools.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/combat-events.ts'),
      import('/packages/engine/src/world-map.ts'),
    ]);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    document.body.append(element);
    const canvas = new tvg.Canvas(element, { width: 1280, height: 800, enableDevicePixelRatio: false });
    const fonts = await loadNativeFonts(tvg);
    await loadKoreanFont(tvg, fonts);
    // The renderer alone, without the app's building files, so other sessions' asset work cannot block it.
    const town = new Town(5, 64, false),
      renderer = new WorldRenderer(tvg),
      traffic = new Traffic(),
      preview = new Preview(),
      game = { camera: new Camera(0, 0, 3), chosen: [] };
    // Noon, so the shapes are judged in daylight.
    const day = 600;
    town.time = Math.ceil(town.time / day) * day + day * 0.5;
    const land = town.map().camp(),
      base = { x: Math.round(land.x) + 2, y: Math.round(land.y) + 2 };
    const at = (dx, dy) => ({ x: base.x + dx, y: base.y + dy });
    const lair = town
      .map()
      .dungeons()
      .findIndex((d) => d.kind === 1);
    const people = [],
      beasts = [];
    const resident = (dx, dy, calling) => {
      const p = town.makePerson(Role.Resident, calling, at(dx, dy));
      p.position = at(dx, dy);
      p.level = 8;
      p.food = p.rest = p.hydration = 1;
      p.activity = Activity.Holding;
      town.folk.push(p);
      people.push(p);
      return p;
    };
    const monster = (dx, dy, rank) => {
      const m = new Monster(town.nextMonster++, lair, at(dx, dy));
      m.rank = rank;
      m.vigor = m.health = 30;
      m.angry = true;
      town.beasts.push(m);
      beasts.push(m);
      return m;
    };
    let now = 0;
    window.combatProbe = {
      game,
      town,
      people,
      beasts,
      CombatCue,
      MonsterRank,
      Calling,
      StrikeKind,
      setLocale,
      cast(skill, position, person) {
        const spec = skillSpec(skill);
        town.emit(CombatCue.Ability, position, {
          person: person.id,
          skill,
          text: spec.name,
          radius: spec.radius,
          duration: spec.duration || spec.delay,
        });
      },
      delayOf: (skill) => skillSpec(skill).delay,
      /** The nearest tree to the probe's base, as an offset from it. */
      treeNear() {
        const map = town.map();
        let best = null;
        for (let r = 1; r < 30 && !best; r++)
          for (let dx = -r; dx <= r && !best; dx++)
            for (const dy of [-r, r]) {
              const x = base.x + dx,
                y = base.y + dy;
              if (map.inside(x, y) && map.at(x, y).trees > 0) {
                const p = treePosition(map, x, y, 0);
                best = { dx: p.x - base.x, dy: p.y - base.y };
                break;
              }
            }
        return best;
      },
      /** Jumps the clock on to the next time of day (0 midnight, 0.5 noon). */
      toTime(share) {
        // The probe never ticks the town, so the sky is set straight to that time of day.
        town.weather().previewTime(town.yearFraction(), share);
        this.frame(1 / 30);
      },
      // A swing over several enemies: one blow each, at one moment, the first being the target.
      swing(from, targets, damage, strike, fields = {}) {
        targets.forEach((to, i) =>
          this.blow(from, to, i ? Math.round(damage * 0.6) : damage, { strike, primary: i === 0, ...fields }),
        );
      },
      at,
      resident,
      monster,
      reset() {
        town.folk.length = 0;
        town.beasts.length = 0;
        people.length = 0;
        beasts.length = 0;
        // On to the next noon: every lasting skill area (8 s at most) runs out, and each stage is lit alike.
        for (let i = 0; i < 4; ++i) this.frame(0.5);
        this.frame((((day * 0.5 - (town.time % day)) % day) + day) % day || day);
        for (let i = 0; i < 2; ++i) this.frame(0.5);
      },
      blow(from, to, damage, fields = {}) {
        town.blows.push({
          serial: town.nextBlow++,
          from: { ...from.position },
          to: { ...to.position },
          damage,
          onPerson: false,
          ranged: false,
          at: town.time,
          person: from.id ?? -1,
          attacker: from.id,
          ...fields,
        });
      },
      emit(cue, position, fields = {}) {
        town.emit(cue, position, fields);
      },
      look(dx, dy, zoom) {
        const p = project(base.x + dx, base.y + dy);
        game.camera = new Camera(p.x, p.y, zoom);
      },
      frame(dt = 1 / 30) {
        town.time += dt;
        now += dt;
        town.scout?.(base.x, base.y, 12);
        const start = performance.now();
        renderer.update(town, traffic, game.camera, 1280, 800, now, preview, game.chosen);
        const mid = performance.now();
        canvas.update().render();
        return { update: mid - start, render: performance.now() - mid };
      },
      run(seconds) {
        for (let t = 0; t < seconds - 1e-6; t += 1 / 30) this.frame(1 / 30);
      },
    };
    canvas.add(renderer.scene());
    combatProbe.look(0, 0, 3);
    for (let i = 0; i < 6; ++i) combatProbe.frame(0.2);
    return combatFace(tvg);
  });
  assert.equal(report.font, 'Cinzel-Black', 'The combat face loads');
  const shot = async (name, clip = { x: 340, y: 160, width: 600, height: 420 }) => {
    const path = `${output}/${name}.png`;
    await page.screenshot({ path, clip });
    report.shots.push(path);
  };
  const stage = (fn, arg) => page.evaluate(fn, arg);

  // 1. Numbers and contact shards around one fight.
  await stage(() => {
    const { resident, monster, blow, Calling, MonsterRank } = combatProbe;
    combatProbe.reset();
    const warrior = resident(0, 0, Calling.Warrior),
      ranger = resident(-2.4, 1.2, Calling.Ranger),
      grunt = monster(0.8, -0.2, MonsterRank.Grunt),
      brute = monster(1.6, 1.4, MonsterRank.Brute);
    combatProbe.look(0.3, 0.4, 3.2);
    combatProbe.frame();
    blow(warrior, grunt, 120);
    combatProbe.frame(0.05);
    blow(warrior, grunt, 80);
    combatProbe.run(0.2);
    blow(warrior, grunt, 340, { crit: true });
    blow(ranger, brute, 90, { ranged: true });
    blow(grunt, warrior, 7, { onPerson: true, person: warrior.id, attacker: undefined });
    blow(brute, ranger, 0, { onPerson: true, person: ranger.id, attacker: undefined, blocked: true });
    grunt.health = 14;
    brute.health = 21;
    combatProbe.emit(combatProbe.CombatCue.Heal, ranger.position, { person: ranger.id, amount: 35 });
    combatProbe.frame(0.06);
  });
  await shot('numbers-and-shards-peak');
  await stage(() => combatProbe.run(0.25));
  await shot('numbers-and-shards-breakup');
  await stage(() => combatProbe.run(0.3));
  await shot('numbers-rising');

  // 2. Bars with chip, ranks side by side, a guardian winding up.
  await stage(() => {
    const { resident, monster, blow, Calling, MonsterRank } = combatProbe;
    combatProbe.reset();
    const hero = resident(-1.5, 2, Calling.Cleric),
      hurt = resident(-0.5, 2.6, Calling.Bard);
    hurt.health = 0.45;
    hero.health = 1;
    const ranks = [MonsterRank.Grunt, MonsterRank.Brute, MonsterRank.Stalker, MonsterRank.Guardian].map(
      (rank, i) => monster(i * 1.1 - 0.6, -i * 1.1 + 0.6, rank),
    );
    combatProbe.look(1.2, -0.2, 2.2);
    combatProbe.game.chosen = [hero.id];
    combatProbe.frame();
    for (const [i, m] of ranks.entries()) {
      m.health = 30 * [0.7, 0.5, 0.35, 0.6][i];
      blow(hero, m, 40);
    }
    hurt.health = 0.3;
    combatProbe.frame(0.1);
  });
  await shot('bars-and-ranks', { x: 240, y: 100, width: 800, height: 560 });
  await stage(() => {
    const guardian = combatProbe.beasts[3];
    guardian.windupUntil = combatProbe.town.time + 0.8;
    combatProbe.emit(combatProbe.CombatCue.Telegraph, guardian.position, {
      creature: guardian.id,
      radius: 2.4,
      duration: 1.6,
    });
    combatProbe.frame(0.5);
  });
  await shot('guardian-windup-telegraph', { x: 240, y: 100, width: 800, height: 560 });
  await stage(() => {
    combatProbe.run(0.3);
    const guardian = combatProbe.beasts[3];
    guardian.windupUntil = -1;
    combatProbe.emit(combatProbe.CombatCue.Slam, guardian.position, { creature: guardian.id, radius: 2.4 });
    combatProbe.frame(0.1);
  });
  await shot('slam', { x: 240, y: 100, width: 800, height: 560 });
  await stage(() => combatProbe.run(0.3));
  await shot('slam-breakup', { x: 240, y: 100, width: 800, height: 560 });

  // 3. A kill: the monster breaks into drifting pieces and dust.
  await stage(() => {
    const { resident, monster, blow, Calling, MonsterRank } = combatProbe;
    combatProbe.reset();
    const hero = resident(-0.6, 0.3, Calling.Warrior),
      foe = monster(0.4, 0, MonsterRank.Brute);
    combatProbe.look(0, 0, 3.2);
    combatProbe.frame();
    blow(hero, foe, 260, { crit: true });
    combatProbe.town.beasts.splice(combatProbe.town.beasts.indexOf(foe), 1);
    combatProbe.emit(combatProbe.CombatCue.Kill, foe.position, { creature: foe.id, person: hero.id });
    combatProbe.frame(0.12);
  });
  await shot('kill-early');
  await stage(() => combatProbe.run(0.2));
  await shot('kill-breakup');

  // 4. Downed ring with its word, and a death wisp beside it.
  await stage(() => {
    const { resident, Calling } = combatProbe;
    combatProbe.reset();
    const down = resident(-0.6, 0, Calling.Ranger),
      dead = resident(0.9, 0.2, Calling.Warrior);
    combatProbe.look(0, 0, 3.2);
    combatProbe.frame();
    down.downedAt = combatProbe.town.time - 20;
    down.health = 0;
    down.activity = 29;
    combatProbe.emit(combatProbe.CombatCue.Downed, down.position, { person: down.id });
    combatProbe.town.folk.splice(combatProbe.town.folk.indexOf(dead), 1);
    combatProbe.town.fallen.push({
      id: dead.id,
      name: dead.name,
      past: '',
      look: dead.look,
      calling: dead.calling,
      race: dead.race,
      level: dead.level,
      days: 1,
      kills: 0,
      cause: 'monsters',
      place: 'Midgard',
      day: 1,
      at: combatProbe.town.time,
      position: { ...dead.position },
    });
    combatProbe.emit(combatProbe.CombatCue.Death, dead.position, { person: dead.id, text: 'monsters' });
    combatProbe.run(0.25);
  });
  await shot('downed-and-death');
  await stage(() => combatProbe.run(0.9));
  await shot('death-wisp-rising');

  // 5. Abilities, level-up and enrage.
  await stage(() => {
    const { resident, monster, Calling, MonsterRank, CombatCue, emit } = combatProbe;
    combatProbe.reset();
    const warrior = resident(-2, 0, Calling.Warrior),
      mage = resident(-2, 2, Calling.Mage),
      cleric = resident(0, 2.2, Calling.Cleric),
      bard = resident(1.4, 1.4, Calling.Bard),
      guardian = monster(1.8, -1.6, MonsterRank.Guardian);
    combatProbe.look(0, 0.2, 2.2);
    combatProbe.frame();
    emit(CombatCue.Ability, warrior.position, {
      person: warrior.id,
      text: 'Challenge',
      radius: 4,
      duration: 5,
    });
    emit(CombatCue.Ability, combatProbe.at(0, -0.6), {
      person: mage.id,
      text: 'Rune Burst',
      radius: 2,
      duration: 0.8,
    });
    emit(CombatCue.Ability, bard.position, {
      person: bard.id,
      text: 'Rallying Verse',
      radius: 5,
      duration: 8,
    });
    emit(CombatCue.Heal, cleric.position, { person: cleric.id, amount: 35 });
    emit(CombatCue.LevelUp, mage.position, { person: mage.id, amount: 6 });
    emit(CombatCue.Enrage, guardian.position, { creature: guardian.id });
    combatProbe.frame(0.25);
  });
  await shot('abilities', { x: 240, y: 100, width: 800, height: 560 });
  await stage(() => combatProbe.run(0.6));
  await shot('abilities-rune-burst', { x: 240, y: 100, width: 800, height: 560 });
  await shot('overview', { x: 0, y: 0, width: 1280, height: 800 });
  const wide = { x: 240, y: 100, width: 800, height: 560 };

  // 6. Ordinary blows by weapon, each at its peak.
  const strikes = [
    ['strike-single', 'Single'],
    ['strike-cleave', 'Cleave'],
    ['strike-crush', 'Crush'],
    ['strike-pierce', 'Pierce'],
    ['strike-splash', 'Splash'],
  ];
  for (const [name, kind] of strikes) {
    await stage((kind) => {
      const { resident, monster, Calling, MonsterRank, StrikeKind } = combatProbe;
      combatProbe.reset();
      const calling = kind === 'Pierce' ? Calling.Ranger : kind === 'Splash' ? Calling.Mage : Calling.Warrior,
        ranged = kind === 'Pierce' || kind === 'Splash',
        hero = resident(ranged ? -2.6 : -0.6, ranged ? 0.4 : 0.2, calling),
        foes = [monster(0.4, 0, MonsterRank.Grunt), monster(0.2, 0.9, MonsterRank.Swarmer), monster(1.4, 0.1, MonsterRank.Swarmer)];
      combatProbe.look(-0.2, 0.2, 3);
      combatProbe.frame();
      const targets = kind === 'Cleave' ? foes.slice(0, 2) : kind === 'Pierce' ? [foes[0], foes[2]] : kind === 'Splash' ? [foes[0], foes[1]] : [foes[0]];
      combatProbe.swing(hero, targets, 40, StrikeKind[kind], { ranged });
      combatProbe.frame(kind === 'Pierce' ? 0.03 : 0.06);
    }, kind);
    await shot(name);
  }
  await stage(() => combatProbe.run(0.15));
  await shot('strike-splash-breakup');

  // 7. All ten skills, each at its peak; lasting areas a moment after they land.
  const skillShots = [
    ['skill-challenge', 'challenge', 0.12, 2.6],
    ['skill-whirl', 'whirl', 0.32, 2.2],
    ['skill-aimed', 'aimed', 0.05, 2.6],
    ['skill-volley-mark', 'volley', 0.35, 1.8],
    ['skill-volley-rain', 'volley', 0.7, 1.8],
    ['skill-burst', 'burst', 0.5, 2],
    ['skill-frost', 'frost', 1.2, 1.6],
    ['skill-mend', 'mend', 0.25, 2.6],
    ['skill-sanctuary', 'sanctuary', 1.4, 1.8],
    ['skill-rally', 'rally', 0.4, 2.6],
    ['skill-dirge', 'dirge', 0.3, 1.1],
    ['skill-dirge-held', 'dirge', 1.6, 1.8],
  ];
  for (const [name, skill, wait, zoom] of skillShots) {
    await stage(
      ([skill, wait, zoom]) => {
        const { resident, monster, Calling, MonsterRank } = combatProbe;
        combatProbe.reset();
        const calling = {
            challenge: Calling.Warrior,
            whirl: Calling.Warrior,
            aimed: Calling.Ranger,
            volley: Calling.Ranger,
            burst: Calling.Mage,
            frost: Calling.Mage,
            mend: Calling.Cleric,
            sanctuary: Calling.Cleric,
            rally: Calling.Bard,
            dirge: Calling.Bard,
          }[skill],
          hero = resident(-1, 0.4, calling),
          ally = resident(-1.6, 1.4, Calling.Warrior),
          foes = [
            monster(0.6, -0.2, MonsterRank.Grunt),
            monster(1.2, 0.6, MonsterRank.Swarmer),
            monster(0.4, 1.0, MonsterRank.Swarmer),
            monster(1.8, -0.4, MonsterRank.Swarmer),
          ];
        ally.health = 0.5;
        combatProbe.look(0, 0.3, zoom);
        combatProbe.frame();
        const ground = ['volley', 'burst', 'frost'].includes(skill) ? combatProbe.at(1, 0.3) : hero.position;
        combatProbe.cast(skill, skill === 'aimed' ? foes[0].position : ground, hero);
        if (skill === 'aimed') combatProbe.blow(hero, foes[0], 120, { ranged: true });
        if (skill === 'mend') combatProbe.emit(combatProbe.CombatCue.Heal, ally.position, { person: ally.id, amount: 35 });
        const lands = combatProbe.delayOf(skill);
        let fired = !['whirl', 'volley', 'burst'].includes(skill);
        for (let t = 0; t < wait - 1e-6; t += 1 / 30) {
          // The engine's blows land with the skill.
          if (!fired && t + 1e-6 >= lands) {
            fired = true;
            combatProbe.swing(hero, foes.slice(0, 3), 30, 0, { ranged: skill !== 'whirl' });
          }
          combatProbe.frame(1 / 30);
        }
      },
      [skill, wait, zoom],
    );
    await shot(name, wide);
  }

  // 8. The brood: a swarmer's fall, a spawn, a den collapsing and the brood breaking.
  await stage(() => {
    const { resident, monster, Calling, MonsterRank, CombatCue, emit } = combatProbe;
    combatProbe.reset();
    const hero = resident(-1, 0.2, Calling.Warrior),
      swarmer = monster(0.2, 0, MonsterRank.Swarmer);
    combatProbe.look(-0.4, 0.1, 3.2);
    combatProbe.frame();
    combatProbe.town.beasts.splice(combatProbe.town.beasts.indexOf(swarmer), 1);
    emit(CombatCue.Kill, swarmer.position, { creature: swarmer.id, person: hero.id });
    combatProbe.frame(0.1);
  });
  await shot('swarm-kill');
  await stage(() => {
    const { resident, monster, Calling, MonsterRank, CombatCue, emit } = combatProbe;
    combatProbe.reset();
    resident(-1.4, 0.6, Calling.Warrior);
    const den = monster(0, 0, MonsterRank.Den);
    combatProbe.look(0, 0, 3.2);
    combatProbe.frame();
    const newcomer = monster(0.4, 0.3, MonsterRank.Swarmer);
    emit(CombatCue.Spawn, newcomer.position, { creature: newcomer.id, amount: den.id });
    combatProbe.frame(0.12);
  });
  await shot('swarm-spawn');
  await stage(() => {
    const { resident, monster, Calling, MonsterRank, CombatCue, emit } = combatProbe;
    combatProbe.reset();
    const hero = resident(-1.2, 0.4, Calling.Warrior),
      den = monster(0, 0, MonsterRank.Den);
    combatProbe.look(0, 0, 2.6);
    combatProbe.frame();
    combatProbe.town.beasts.splice(combatProbe.town.beasts.indexOf(den), 1);
    emit(CombatCue.DenDestroyed, den.position, { creature: den.id, person: hero.id });
    combatProbe.frame(0.18);
  });
  await shot('den-collapse', wide);
  await stage(() => combatProbe.run(0.35));
  await shot('den-collapse-breakup', wide);
  await stage(() => {
    const { resident, monster, Calling, MonsterRank, CombatCue, emit } = combatProbe;
    combatProbe.reset();
    for (let i = 0; i < 5; i++) resident(-1 + i * 0.5, 1 + (i % 2) * 0.4, Calling.Warrior);
    for (let i = 0; i < 12; i++) monster(-3 + (i % 4) * 1.8, -2 + Math.floor(i / 4) * 1.8, MonsterRank.Swarmer);
    combatProbe.look(0, 0, 1.1);
    combatProbe.frame();
    emit(CombatCue.BroodBreak, combatProbe.at(0, 0), { amount: 12 });
    combatProbe.frame(0.5);
  });
  await shot('brood-break', { x: 0, y: 0, width: 1280, height: 800 });

  // 9. A crowd of 120 with a party of five, 60 swings a second; frame cost against the same crowd at rest.
  report.cost = await stage(() => {
    const { resident, monster, Calling, MonsterRank, StrikeKind } = combatProbe;
    combatProbe.reset();
    const party = [0, 1, 2, 3, 4].map((i) => resident(-1 + (i % 2) * 0.7, -2 + i * 0.9, [Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Bard][i])),
      horde = [];
    for (let i = 0; i < 120; i++)
      horde.push(monster(0.4 + (i % 12) * 0.55, -3.2 + Math.floor(i / 12) * 0.65, i === 0 ? MonsterRank.Den : i < 3 ? MonsterRank.Brute : i < 10 ? MonsterRank.Spitter : MonsterRank.Swarmer));
    combatProbe.look(1.6, -0.4, 1.6);
    const measure = (fighting) => {
      const out = { update: 0, render: 0, frames: 0 };
      for (let f = 0; f < 90; f++) {
        if (fighting) {
          const hero = party[f % 5],
            foe = horde[1 + ((f * 7) % 119)];
          foe.health = Math.max(2, foe.health - 3);
          const strike = [StrikeKind.Cleave, StrikeKind.Pierce, StrikeKind.Splash, StrikeKind.Crush, StrikeKind.Single][f % 5];
          combatProbe.swing(hero, [foe, horde[1 + ((f * 7 + 1) % 119)]], 9, strike, { crit: f % 9 === 0, ranged: f % 5 === 1 || f % 5 === 2 });
          if (f % 15 === 0) combatProbe.blow(foe, hero, 4, { onPerson: true, person: hero.id, attacker: undefined });
        }
        // 60 blows a second at 60 frames a second.
        const cost = combatProbe.frame(1 / 60);
        if (f >= 10) {
          out.update += cost.update;
          out.render += cost.render;
          out.frames++;
        }
        combatProbe.town.blows = combatProbe.town.blows.filter((h) => combatProbe.town.time - h.at <= 2);
      }
      return { update: out.update / out.frames, render: out.render / out.frames };
    };
    const rest = measure(false),
      fight = measure(true);
    return { renderer: 'WebGL (real GPU)', monsters: 120, rest, fight };
  });
  await shot('crowd', { x: 0, y: 0, width: 1280, height: 800 });

  // 10. Draw order: each tier with a resident in front of it and one behind it, and a night look.
  const orderShots = [
    // Body: a slash on a monster with a resident standing between it and the viewer, then one behind it.
    [
      'order-body-front',
      () => {
        const { resident, monster, Calling, MonsterRank } = combatProbe;
        combatProbe.reset();
        const hero = resident(-0.8, 0, Calling.Warrior),
          foe = monster(0, 0, MonsterRank.Grunt);
        resident(0.45, 0.45, Calling.Cleric);
        combatProbe.look(0.1, 0.2, 4);
        combatProbe.frame();
        combatProbe.blow(hero, foe, 30, { crit: true });
        combatProbe.frame(0.05);
      },
    ],
    [
      'order-body-behind',
      () => {
        const { resident, monster, Calling, MonsterRank } = combatProbe;
        combatProbe.reset();
        const hero = resident(-0.8, 0, Calling.Warrior),
          foe = monster(0, 0, MonsterRank.Grunt);
        resident(-0.45, -0.45, Calling.Cleric);
        combatProbe.look(0.1, 0.2, 4);
        combatProbe.frame();
        combatProbe.blow(hero, foe, 30, { crit: true });
        combatProbe.frame(0.05);
      },
    ],
    // Standing: frost crystals with units inside the ring and outside it, on the near and the far rim.
    [
      'order-standing-frost',
      () => {
        const { resident, monster, Calling, MonsterRank } = combatProbe;
        combatProbe.reset();
        const mage = resident(-2.6, -1.2, Calling.Mage);
        // Far rim: one just inside, one just outside; near rim the same.
        monster(-1.6, -1.6, MonsterRank.Grunt);
        resident(-2.6, -2.6, Calling.Warrior);
        monster(1.7, 1.7, MonsterRank.Grunt);
        resident(2.5, 2.5, Calling.Warrior);
        monster(0.3, 0.2, MonsterRank.Swarmer);
        combatProbe.look(0, 0, 2.6);
        combatProbe.frame();
        combatProbe.cast('frost', combatProbe.at(0, 0), mage);
        combatProbe.run(1.2);
      },
    ],
    // Standing: arrows of a volley landing among units.
    [
      'order-standing-volley',
      () => {
        const { resident, monster, Calling, MonsterRank } = combatProbe;
        combatProbe.reset();
        const ranger = resident(-3, -0.5, Calling.Ranger);
        for (let i = 0; i < 9; i++) monster(-1 + (i % 3) * 0.9, -1 + Math.floor(i / 3) * 0.9, MonsterRank.Swarmer);
        resident(1.5, 1.2, Calling.Warrior);
        combatProbe.look(0, 0, 3);
        combatProbe.frame();
        combatProbe.cast('volley', combatProbe.at(0, 0), ranger);
        for (let t = 0; t < 0.72; t += 1 / 30) combatProbe.frame(1 / 30);
      },
    ],
    // Ground: a rune circle with units standing on it.
    [
      'order-ground-rune',
      () => {
        const { resident, monster, Calling, MonsterRank } = combatProbe;
        combatProbe.reset();
        const mage = resident(-2.6, 0, Calling.Mage);
        monster(0, 0, MonsterRank.Grunt);
        monster(0.9, -0.6, MonsterRank.Swarmer);
        resident(0.6, 0.9, Calling.Warrior);
        combatProbe.look(0, 0, 3);
        combatProbe.game.chosen = [mage.id];
        combatProbe.frame();
        combatProbe.cast('burst', combatProbe.at(0.2, 0.1), mage);
        combatProbe.run(0.5);
      },
    ],
    // Standing: the whirl round a warrior with allies in front and behind.
    [
      'order-whirl',
      () => {
        const { resident, monster, Calling, MonsterRank } = combatProbe;
        combatProbe.reset();
        const warrior = resident(0, 0, Calling.Warrior);
        resident(-1.2, -1.1, Calling.Ranger);
        resident(1.1, 1.2, Calling.Cleric);
        monster(1.4, -0.3, MonsterRank.Swarmer);
        monster(-0.4, 1.5, MonsterRank.Swarmer);
        combatProbe.look(0, 0, 3);
        combatProbe.frame();
        combatProbe.cast('whirl', warrior.position, warrior);
        combatProbe.run(0.33);
      },
    ],
    // Standing: a den collapsing behind a tree.
    [
      'order-den-tree',
      () => {
        const { resident, Calling, MonsterRank, CombatCue, emit } = combatProbe;
        combatProbe.reset();
        const tree = combatProbe.treeNear() ?? { dx: 0, dy: 0 },
          den = combatProbe.monster(tree.dx - 0.8, tree.dy - 0.8, MonsterRank.Den);
        resident(tree.dx + 1.2, tree.dy + 0.6, Calling.Warrior);
        combatProbe.look(tree.dx - 0.3, tree.dy - 0.4, 3);
        combatProbe.frame();
        combatProbe.town.beasts.splice(combatProbe.town.beasts.indexOf(den), 1);
        emit(CombatCue.DenDestroyed, den.position, { creature: den.id });
        combatProbe.frame(0.25);
      },
    ],
    // Overhead: bars and numbers stay over a resident who stands in front.
    [
      'order-overhead',
      () => {
        const { resident, monster, Calling, MonsterRank } = combatProbe;
        combatProbe.reset();
        const hero = resident(-0.8, 0, Calling.Warrior),
          foe = monster(0, 0, MonsterRank.Brute);
        resident(0.4, 0.4, Calling.Cleric);
        foe.health = 12;
        combatProbe.look(0.1, 0.1, 4);
        combatProbe.frame();
        combatProbe.blow(hero, foe, 40);
        combatProbe.frame(0.15);
      },
    ],
  ];
  for (const [name, fn] of orderShots) {
    await stage(fn);
    await shot(name, wide);
  }
  await stage(() => {
    const { resident, monster, Calling, MonsterRank } = combatProbe;
    combatProbe.reset();
    combatProbe.toTime(0.02);
    const mage = resident(-2.4, -0.8, Calling.Mage),
      warrior = resident(-0.6, 0.4, Calling.Warrior),
      cleric = resident(-1.6, 1.4, Calling.Cleric),
      foes = [monster(0.4, 0.2, MonsterRank.Grunt), monster(1, -0.6, MonsterRank.Swarmer), monster(1.4, 0.8, MonsterRank.Swarmer)];
    combatProbe.look(-0.2, 0.2, 2.6);
    combatProbe.frame();
    combatProbe.cast('frost', combatProbe.at(1, 0.1), mage);
    combatProbe.cast('sanctuary', cleric.position, cleric);
    combatProbe.run(0.6);
    combatProbe.swing(warrior, foes.slice(0, 2), 30, combatProbe.StrikeKind.Cleave, { crit: true });
    combatProbe.frame(0.05);
  });
  await shot('order-night', wide);
  await stage(() => combatProbe.toTime(0.5));

  // 11. Words in Korean.
  await stage(() => {
    const { resident, monster, Calling, MonsterRank, CombatCue, emit } = combatProbe;
    combatProbe.reset();
    combatProbe.setLocale('KR');
    const hero = resident(-0.6, 0.2, Calling.Warrior),
      foe = monster(0.6, 0, MonsterRank.Grunt);
    combatProbe.look(0, 0, 3.2);
    combatProbe.frame();
    emit(CombatCue.LevelUp, hero.position, { person: hero.id, amount: 6 });
    combatProbe.cast('challenge', hero.position, hero);
    combatProbe.blow(foe, hero, 0, { onPerson: true, person: hero.id, attacker: undefined, blocked: true });
    combatProbe.blow(hero, foe, 260, { crit: true });
    combatProbe.frame(0.2);
  });
  await shot('words-korean');
  await stage(() => combatProbe.setLocale('ENG'));
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
  else console.log('combat effects browser validation passed');
}
