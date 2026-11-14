import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Screenshots of the land, water, gates and the worlds beyond them; ENVIRONMENT_OUT overrides the folder.
const output = process.env.ENVIRONMENT_OUT ?? 'artifacts/regression/environment';
const only = (process.env.ENVIRONMENT_ONLY ?? '').split(',').filter(Boolean);
const wanted = (group) => !only.length || only.includes(group);
const report = { errors: [], shots: [], cost: null, passed: false };
let server, browser, deadline;
try {
  await mkdir(output, { recursive: true });
  server = await createServer({
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [
      {
        name: 'environment-validation',
        configureServer(vite) {
          vite.middlewares.use('/environment-probe', (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Environment validation</title></head><body style="margin:0;background:#11191c"></body></html>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    args: ['--mute-audio', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  deadline = setTimeout(() => void browser.close().catch(() => {}), 600000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.stack ?? error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/environment-probe`);
  await page.evaluate(async () => {
    const [
      { initializeWebCanvas },
      { loadNativeFonts },
      { WorldRenderer },
      { Town },
      { Traffic },
      { Preview },
      { Activity, Calling, Role, TreeWorkKind, Monster },
      { Camera, project },
      { monsterEntrance },
      { Building },
      { Structure },
      { Terrain, Layer },
      { sharpAnchor },
      { addInventory, workItem },
      { MonsterRank },
      { pickSource },
    ] = await Promise.all([
      import('/apps/web/src/native/startup-canvas.ts'),
      import('/packages/native-ui/src/index.ts'),
      import('/packages/native-renderer/src/world-renderer.ts'),
      import('/packages/engine/src/town.ts'),
      import('/packages/engine/src/traffic.ts'),
      import('/packages/engine/src/game-tools.ts'),
      import('/packages/engine/src/person.ts'),
      import('/packages/engine/src/geometry.ts'),
      import('/packages/engine/src/town-monsters.ts'),
      import('/packages/engine/src/town-models.ts'),
      import('/packages/engine/src/building-catalog.ts'),
      import('/packages/engine/src/world-types.ts'),
      import('/packages/engine/src/road-network.ts'),
      import('/packages/engine/src/equipment.ts'),
      import('/packages/engine/src/combat-events.ts'),
      import('/packages/native-renderer/src/world-pick-registry.ts'),
    ]);
    const tvg = await initializeWebCanvas('gl'),
      element = document.createElement('canvas');
    document.body.append(element);
    const canvas = new tvg.Canvas(element, { width: 1280, height: 800, enableDevicePixelRatio: false }),
      renderer = new WorldRenderer(tvg),
      traffic = new Traffic(5),
      town = new Town(5);
    await loadNativeFonts(tvg);
    // The world renderer alone, without the HUD, so the pictures show only the land.
    let seen = town.realmRevision;
    const game = {
        renderer,
        town,
        camera: new Camera(),
        fogged: false,
        ghostsOff: false,
        render(width, height, seconds, simulate, dt) {
          if (simulate) town.advance(dt);
          if (seen !== town.realmRevision) {
            seen = town.realmRevision;
            renderer.invalidateMap();
          }
          const preview = new Preview();
          preview.zoom = this.camera.zoom;
          renderer.update(town, traffic, this.camera, width, height, seconds, preview, []);
          // The "before" pictures of hidden units: the same scene without the ghost layer.
          if (this.ghostsOff && renderer.ghosts) {
            renderer.ghosts.opacity(0);
            renderer.adapter.sync(renderer.root);
          }
          // The pictures judge the land itself: the memory veil is lifted unless a shot asks for fog.
          if (!this.fogged) {
            renderer.fog.opacity(0);
            renderer.adapter.sync(renderer.root);
          }
        },
        takeCues() {},
        selectPeople() {},
        worldScene: () => renderer.scene(),
      },
      map = town.map(),
      origin = map.camp();
    for (const site of map.dungeons()) site.discovered = true;
    const camp = new Building(0, Structure.Camp, origin, 0, 0);
    camp.village = 0;
    const farm = new Building(1, Structure.Farm, { x: origin.x + 3, y: origin.y }, 0, 0);
    farm.village = 0;
    const cottage = new Building(2, Structure.Cottage, { x: origin.x - 3, y: origin.y + 1 }, 0, 0);
    cottage.village = 0;
    town.placed.push(camp, farm, cottage);
    town.nextId = 3;
    town.foundSettlement(0);
    town.stock().food = 50;
    town.stock().wood = 200;
    town.stock().stone = 200;
    for (const p of town.folk) p.food = p.rest = p.hydration = 1;
    town.plantField([
      { x: origin.x + 1.5, y: origin.y + 1.8 },
      { x: origin.x + 5.5, y: origin.y + 1.8 },
      { x: origin.x + 5.5, y: origin.y + 4.8 },
      { x: origin.x + 1.5, y: origin.y + 4.8 },
    ]);
    town.buildRoad([
      sharpAnchor({ x: origin.x - 1, y: origin.y + 3.5 }),
      sharpAnchor({ x: origin.x - 6, y: origin.y + 6 }),
    ]);
    town.scout(map.width() / 2, map.height() / 2, map.width());
    const climate = () => town.climate();
    window.envProbe = {
      game,
      canvas,
      now: 0,
      // Still frames: the town does not advance, so the forced weather holds.
      frame(dt = 0.05) {
        this.now += dt;
        game.render(1280, 800, this.now, false, dt, this.now);
        canvas.update().render();
        game.takeCues();
      },
      live(dt = 0.05) {
        this.now += dt;
        game.render(1280, 800, this.now, true, dt, this.now);
        canvas.update().render();
        game.takeCues();
      },
      look(x, y, zoom) {
        const at = project(x, y);
        game.camera = new Camera(at.x, at.y, zoom);
        game.selectPeople([]);
      },
      weather({ hour = 11, snow = 0, frost = 0, autumn = 0 } = {}) {
        town.editHour(hour);
        const c = climate();
        c.snow = snow;
        c.frost = frost;
        c.autumn = autumn;
        c.weather = 0;
        c.intensity = 0;
        town.changes++;
      },
      places() {
        const tiles = [];
        let lake = null,
          coast = null,
          frost = null;
        for (let y = 2; y < map.height() - 2; ++y)
          for (let x = 2; x < map.width() - 2; ++x) {
            const t = map.at(x, y).terrain;
            if (!lake && t === Terrain.Water) {
              let n = 0;
              for (let dy = -2; dy <= 2; ++dy)
                for (let dx = -2; dx <= 2; ++dx) n += map.at(x + dx, y + dy).terrain === Terrain.Water;
              if (n >= 22 && Math.hypot(x - map.hvergelmir().x, y - map.hvergelmir().y) > 12)
                lake = { x: x + 0.5, y: y + 0.5 };
            }
            if (t === Terrain.Frost && !frost && map.at(x, y).trees) frost = { x, y };
            if (t === Terrain.Sea && Math.hypot(x - origin.x, y - origin.y) < 18 && !coast) {
              let land = 0;
              for (let dy = -3; dy <= 3; ++dy)
                for (let dx = -3; dx <= 3; ++dx) land += map.at(x + dx, y + dy).terrain !== Terrain.Sea;
              if (land > 12 && land < 30) coast = { x, y };
            }
          }
        const river = map.river().path;
        return {
          lake,
          coast,
          frost,
          river: river[Math.floor(river.length * 0.6)],
          camp: origin,
          giant: map.giant()?.center(),
          volcano: map.volcano()?.center(),
          spring: map.hvergelmir(),
          gates: map.dungeons().map((d, i) => ({ i, kind: d.kind, x: d.origin.x + 1, y: d.origin.y + 1 })),
        };
      },
      // Residents standing at these tiles: lava is only animated and lit where someone can see it.
      stand(points) {
        const folk = town.folk.filter((p) => p.role === Role.Resident);
        while (folk.length < points.length) {
          const p = town.makePerson(Role.Resident, Calling.Warrior, points[folk.length]);
          town.folk.push(p);
          folk.push(p);
        }
        folk.forEach((p, i) => {
          const q = points[i % points.length];
          p.position = { x: q.x, y: q.y };
          p.food = p.rest = p.hydration = 1;
        });
        town.changes++;
      },
      // Median milliseconds per frame (update, sync and render) over several rounds.
      // A forest edge near the camp (a wooded tile beside open grass) and the densest stretch of forest.
      forest() {
        const c = origin;
        let edge = null,
          best = -1,
          dense = null,
          bestSnow = -1,
          snowy = null;
        for (let y = 6; y < map.height() - 6; ++y)
          for (let x = 6; x < map.width() - 6; ++x) {
            const t = map.at(x, y);
            if (!t.trees) continue;
            if (t.trees >= 2 && map.at(x + 1, y + 1).trees === 0 && map.at(x + 1, y + 1).terrain !== Terrain.Water && map.at(x + 1, y + 1).terrain !== Terrain.Sea) {
              const d = Math.hypot(x - c.x, y - c.y);
              if (d > 4 && (!edge || d < edge.d)) edge = { x, y, d };
            }
            if ((x + y) % 3) continue;
            let n = 0;
            for (let dy = -4; dy <= 4; ++dy) for (let dx = -4; dx <= 4; ++dx) n += map.at(x + dx, y + dy).trees;
            if (n > best && t.terrain !== Terrain.Frost) {
              best = n;
              dense = { x: x + 0.5, y: y + 0.5 };
            }
            if (n > bestSnow && t.terrain === Terrain.Frost) {
              bestSnow = n;
              snowy = { x: x + 0.5, y: y + 0.5 };
            }
          }
        return { edge, dense, snowy, cell: edge.y * map.width() + edge.x };
      },
      // Drawn heights at zoom 1 (screen pixels): a resident, the cottage, and the trees and peaks in view.
      sizes(p) {
        this.look(p.x, p.y, 1);
        this.frame();
        game.renderer.scene();
        const a = game.renderer.adapter,
          h = (paint) => a.renderedBounds(paint)?.h ?? 0,
          people = [...game.renderer.figures.values()].map((f) => h(f.paint)).filter((v) => v > 0),
          cottage = h(game.renderer.visuals.get(2)?.picture);
        return { resident: Math.max(...people), cottage };
      },
      // The tallest peak near the camp, a high ridge with forest in front of it, and a snow ridge.
      mountains() {
        let near = null,
          wooded = null,
          snow = null;
        const ridge = (x, y) => map.value(Layer.Ridge, { x: x + 0.5, y: y + 0.5 });
        for (let y = 4; y < map.height() - 4; ++y)
          for (let x = 4; x < map.width() - 4; ++x) {
            if (map.at(x, y).terrain !== Terrain.Mountain || map.value(Layer.Heat, { x: x + 0.5, y: y + 0.5 }) > 0.62) continue;
            const r = ridge(x, y),
              d = Math.hypot(x - origin.x, y - origin.y);
            if (d < 16 && (!near || r > near.r)) near = { x, y, r };
            let trees = 0;
            for (let k = 1; k <= 3; ++k) trees += map.at(x + k, y + k).trees + map.at(x + k - 1, y + k).trees;
            if (trees >= 6 && (!wooded || r > wooded.r)) wooded = { x, y, r };
            if (map.value(Layer.Heat, { x: x + 0.5, y: y + 0.5 }) < 0.3 && (!snow || r > snow.r)) snow = { x, y, r };
          }
        return { near, wooded, snow };
      },
      // Peaks drawn in the current view (scenes of the tree rows that pick nothing) and their path commands.
      peakCount() {
        const rows = new Set(game.renderer.rowTrees.flatMap((row) => row.children));
        let scenes = 0,
          commands = 0;
        const walk = (p) => {
          if (p.commands) commands += p.commands.length;
          for (const c of p.children ?? []) walk(c);
        };
        for (const paint of game.renderer.objects.children)
          if (rows.has(paint) && pickSource(paint)?.ref === null) {
            ++scenes;
            walk(paint);
          }
        return { scenes, commands };
      },
      // A tile on open ground with mountain right in front of it on screen: whoever stands there is behind a ridge.
      behindRidge() {
        let best = null;
        for (let y = 6; y < map.height() - 6; ++y)
          for (let x = 6; x < map.width() - 6; ++x) {
            const t = map.at(x, y).terrain;
            if (t === Terrain.Mountain || t === Terrain.Water || t === Terrain.Sea || t === Terrain.Lava) continue;
            if (map.value(Layer.Heat, { x: x + 0.5, y: y + 0.5 }) > 0.55) continue;
            let front = 0;
            for (let k = 1; k <= 3; ++k) front += map.at(x + k, y + k).terrain === Terrain.Mountain;
            const d = Math.hypot(x - origin.x, y - origin.y);
            if (front === 3 && (!best || d < best.d)) best = { x: x + 0.5, y: y + 0.5, d };
          }
        return best;
      },
      // Residents of every calling at these places, level 8, standing their ground.
      muster(points) {
        town.folk = town.folk.filter((p) => p.role !== Role.Resident || points.length === 0);
        const callings = [Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Warrior, Calling.Settler];
        const folk = points.map((q, i) => {
          const p = town.makePerson(Role.Resident, callings[i % callings.length], { ...q });
          p.position = { ...q };
          p.level = 8;
          p.food = p.rest = p.hydration = 1;
          town.folk.push(p);
          return p;
        });
        town.changes++;
        return folk.map((p) => p.id);
      },
      // A swarm round a point: mostly swarmers, a few grunts and brutes, all roused.
      swarm(centre, count, spread) {
        town.beasts = [];
        const lair = map.dungeons().findIndex((d) => d.kind === 1);
        for (let i = 0; i < count; ++i) {
          const a = i * 2.39996,
            r = spread * Math.sqrt((i + 0.5) / count),
            m = new Monster(town.nextMonster++, Math.max(0, lair), { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
          m.rank = i % 25 === 0 ? MonsterRank.Brute : i % 6 === 0 ? MonsterRank.Grunt : MonsterRank.Swarmer;
          // Tough enough that the crowd is still whole while frames are measured.
          m.vigor = m.health = 400;
          m.angry = true;
          town.beasts.push(m);
        }
        town.changes++;
      },
      // Residents told to fell the trees next to them; live frames until most have struck a blow.
      fell(ids, cells) {
        town.stock().wood = 0;
        ids.forEach((id, i) => {
          const p = town.person(id);
          addInventory(p, 'axe');
          town.equipItem(p.id, p.inventory.length, 'tool1');
          town.orderChop([id], cells[i % cells.length]);
        });
        for (let i = 0; i < 900; ++i) {
          this.live(1 / 30);
          const chopping = new Set(town.treeEvents().filter((e) => e.kind === TreeWorkKind.Chop).map((e) => e.person));
          if (ids.filter((id) => chopping.has(id)).length >= ids.length - 1) return i;
        }
        return -1;
      },
      // Milliseconds of the ghost pass per live frame (coverage ten times a second, ghosts moved every frame).
      async ghostCost(frames) {
        const ghosts = await import('/packages/native-renderer/src/hidden-unit-ghosts.ts');
        let spent = 0,
          shown = 0,
          tested = 0,
          passes = 0;
        for (let i = 0; i < frames; ++i) {
          this.now += 1 / 60;
          town.advance(1 / 60);
          const t0 = performance.now();
          ghosts.updateHiddenUnitGhosts(game.renderer, town, this.now);
          spent += performance.now() - t0;
          shown += ghosts.hiddenUnitGhosts(game.renderer).length;
          const work = ghosts.ghostWork(game.renderer);
          if (work.units) (tested += work.tested / work.units), ++passes;
          game.render(1280, 800, this.now, false, 0, this.now);
          canvas.update().render();
        }
        return {
          msPerFrame: +(spent / frames).toFixed(3),
          ghostsShown: +(shown / frames).toFixed(1),
          units: town.folk.length + town.beasts.length,
          silhouettesTestedPerUnit: +(tested / Math.max(1, passes)).toFixed(2),
        };
      },
      // One resident with an axe told to fell a tree; live frames until the first blow, or the fall.
      chop(cell, until) {
        const p = town.folk.find((q) => q.role === Role.Resident);
        if (!workItem(p, 'woodcutting')) {
          addInventory(p, 'axe');
          town.equipItem(p.id, p.inventory.length, 'tool1');
        }
        p.food = p.rest = p.hydration = 1;
        // Room in the store, or the order is refused.
        town.stock().wood = 0;
        if (!town.orderChop([p.id], cell)) return 'rejected';
        for (let i = 0; i < 2400; ++i) {
          this.live(1 / 30);
          const events = town.treeEvents().filter((e) => e.cell === cell);
          if (until === 'blow' && events.some((e) => e.kind === TreeWorkKind.Chop)) return 'blow';
          const fall = events.find((e) => e.kind === TreeWorkKind.Fall);
          // Mid-fall: the drop lasts 0.8 s.
          if (until === 'fall' && fall && town.clock() > fall.at + 0.4) return 'fall';
        }
        return 'timeout';
      },
      // Microseconds of lava work per update (each one past the rate limit), and the cells it touched.
      async lavaWork(zoom) {
        const lava = await import('/packages/native-renderer/src/lava-motion.ts').catch(() => null);
        if (!lava) return null;
        const climate = town.climate(),
          count = 300;
        let t = this.now + 1,
          cells = 0;
        const t0 = performance.now();
        // Half a second apart: past the rate limit at every zoom, so every call does its work.
        for (let i = 0; i < count; ++i) {
          t += 0.5;
          cells = Math.max(cells, lava.updateLava(game.renderer, t, climate, false, zoom));
        }
        this.now = t;
        return { us: +(((performance.now() - t0) * 1000) / count).toFixed(1), cells };
      },
      // Median milliseconds of the world update and sync, and of the native render, over a few frames.
      split(frames = 60) {
        const update = [],
          render = [];
        for (let i = 0; i < frames; ++i) {
          this.now += 1 / 60;
          const t0 = performance.now();
          game.render(1280, 800, this.now, false, 1 / 60, this.now);
          const t1 = performance.now();
          canvas.update().render();
          render.push(performance.now() - t1);
          update.push(t1 - t0);
        }
        const median = (list) => +list.sort((a, b) => a - b)[Math.floor(list.length / 2)].toFixed(2);
        return { updateMs: median(update), renderMs: median(render) };
      },
      cost(frames = 30, rounds = 5) {
        for (let i = 0; i < 10; ++i) this.frame(1 / 60);
        const medians = [];
        for (let round = 0; round < rounds; ++round) {
          const times = [];
          for (let i = 0; i < frames; ++i) {
            const t0 = performance.now();
            this.frame(1 / 60);
            times.push(performance.now() - t0);
          }
          times.sort((a, b) => a - b);
          medians.push(times[Math.floor(times.length / 2)]);
        }
        medians.sort((a, b) => a - b);
        return +medians[Math.floor(medians.length / 2)].toFixed(2);
      },
      seal(index, sealed) {
        while (town.depth.length <= index) town.depth.push(0);
        town.depth[index] = sealed ? 3 : 0;
        town.changes++;
      },
      enter(gate) {
        const site = map.dungeons()[gate];
        const party = town.folk.filter((p) => p.role === Role.Resident).slice(0, 3);
        while (party.length < 3) {
          const p = town.makePerson(Role.Resident, Calling.Warrior, monsterEntrance(site));
          town.folk.push(p);
          party.push(p);
        }
        for (const p of party) {
          p.level = 22;
          p.position = { ...monsterEntrance(site) };
          p.activity = Activity.Expedition;
          p.inside = true;
          p.food = p.rest = p.hydration = 1;
        }
        town.parties.push({ dungeon: gate, members: party.map((p) => p.id), floor: 0 });
        for (let i = 0; i < 8 && !town.realmActive(); ++i) this.live(0.2);
        return town.realmActive();
      },
      realm() {
        const area = town.realmArea,
          plan = town.realmPlan();
        return area && plan
          ? { area, entry: plan.entry, heart: plan.chambers.find((c) => c.kind === 2).center }
          : null;
      },
      leave() {
        town.realmCleared = true;
        for (const p of town.realmParty()) p.activity = Activity.Idle;
        const left = town.leaveRealm();
        this.frame();
        return left;
      },
      // Per-frame milliseconds (median) with every frame a water update, so the figure is the worst case.
      measure(frames, still) {
        game.renderer.reducedMotion = still;
        const times = [];
        for (let i = 0; i < frames; ++i) {
          const t0 = performance.now();
          this.frame(1 / 12);
          times.push(performance.now() - t0);
        }
        game.renderer.reducedMotion = false;
        times.sort((a, b) => a - b);
        return times[Math.floor(times.length / 2)];
      },
    };
    canvas.add(game.worldScene());
    for (let i = 0; i < 4; ++i) envProbe.frame();
  });
  const shot = async (name, setup) => {
    await page.evaluate(setup.fn, setup.arg);
    await page.evaluate(() => {
      for (let i = 0; i < 3; ++i) envProbe.frame();
    });
    const path = `${output}/${name}.png`;
    await page.screenshot({ path });
    report.shots.push(path);
  };
  const places = await page.evaluate(() => envProbe.places());
  const at = (p, zoom, weather = {}) => ({
    fn: ({ p, zoom, weather }) => {
      envProbe.weather(weather);
      envProbe.look(p.x, p.y, zoom);
    },
    arg: { p, zoom, weather },
  });
  if (wanted('land')) {
    await shot('midgard-day', at(places.camp, 1.6));
    await shot('midgard-wide', at(places.camp, 0.8));
    await shot('midgard-dusk', at(places.camp, 1.6, { hour: 19.2 }));
    await shot('midgard-snow', at(places.camp, 1.6, { snow: 0.9, frost: 0.7 }));
    await shot('midgard-autumn', at(places.camp, 1.6, { autumn: 1 }));
    await shot('north-frost', at(places.frost, 1.1));
    await shot('north-hvergelmir', at(places.spring, 1.2));
    await shot('south-volcano', at(places.volcano, 0.55));
    await shot('ymir-bay', at(places.giant, 1.1));
    await shot('overview', at({ x: 88, y: 88 }, 0.3));
    await shot('midgard-fog', {
      fn: (p) => {
        envProbe.game.fogged = true;
        envProbe.weather({});
        envProbe.look(p.x, p.y, 0.8);
      },
      arg: places.camp,
    });
    await page.evaluate(() => (envProbe.game.fogged = false));
  }
  if (wanted('water')) {
    await shot('coast-a', at(places.coast, 2.4));
    await page.evaluate(() => {
      for (let i = 0; i < 40; ++i) envProbe.frame(0.1);
    });
    const path = `${output}/coast-b.png`;
    await page.screenshot({ path });
    report.shots.push(path);
    await shot('lake', at(places.lake, 2));
    await shot('river', at(places.river, 2));
    await shot('lava-flow', at({ x: places.volcano.x + 9, y: places.volcano.y + 9 }, 1.4));
    await shot('frozen-coast', at(places.coast, 2.4, { snow: 1, frost: 1 }));
    report.cost = await page.evaluate(() => {
      envProbe.weather({});
      const p = envProbe.places().coast;
      envProbe.look(p.x, p.y, 1);
      envProbe.measure(20, false);
      const result = {};
      for (const zoom of [1, 0.45]) {
        envProbe.look(p.x, p.y, zoom);
        envProbe.measure(10, true);
        const still = [],
          moving = [];
        for (let round = 0; round < 4; ++round) {
          still.push(envProbe.measure(30, true));
          moving.push(envProbe.measure(30, false));
        }
        const median = (list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
        result[`zoom ${zoom}`] = {
          stillMs: median(still),
          movingMs: median(moving),
          addedMs: median(moving) - median(still),
        };
      }
      return result;
    });
  }
  if (wanted('gates')) {
    for (const gate of places.gates) {
      const kind = ['cave', 'crypt', 'portal', 'ruin', 'giant-hall', 'return'][gate.kind];
      await shot(`gate-${gate.i}-${kind}`, at({ x: gate.x, y: gate.y - 0.5 }, 3));
    }
    await page.evaluate(() => {
      envProbe.seal(0, true);
      envProbe.seal(4, true);
    });
    for (const index of [0, 4])
      await shot(`gate-${index}-sealed`, at({ x: places.gates[index].x, y: places.gates[index].y - 0.5 }, 3));
    await page.evaluate(() => {
      envProbe.seal(0, false);
      envProbe.seal(4, false);
    });
  }
  if (wanted('worlds')) {
    const names = [
      'jotunheim',
      'helheim',
      'niflheim',
      'muspelheim',
      'asgard',
      'alfheim',
      'vanaheim',
      'svartalfheim',
    ];
    for (let gate = 0; gate < 8; ++gate) {
      const entered = await page.evaluate((gate) => envProbe.enter(gate), gate);
      assert(entered, `The party enters gate ${gate}`);
      const realm = await page.evaluate(() => envProbe.realm());
      await shot(`world-${names[gate]}-island`, {
        fn: (r) => {
          envProbe.weather({});
          envProbe.game.town.scout(r.area.x + r.area.size / 2, r.area.y + r.area.size / 2, r.area.size);
          envProbe.look(r.area.x + r.area.size / 2, r.area.y + r.area.size / 2, 0.62);
        },
        arg: realm,
      });
      await shot(`world-${names[gate]}-entry`, at(realm.entry, 1.7));
      await shot(`world-${names[gate]}-heart`, at(realm.heart, 1.4));
      assert(await page.evaluate(() => envProbe.leave()), `The party leaves gate ${gate}`);
    }
  }
  if (wanted('trees')) {
    // The same cameras before and after a change to the trees: TREES_PREFIX names the set.
    const prefix = process.env.TREES_PREFIX ?? 'after',
      forest = await page.evaluate(() => envProbe.forest()),
      open = { x: forest.edge.x + 1.4, y: forest.edge.y + 1.4 },
      treeShot = (name, setup) => shot(`trees-${prefix}-${name}`, setup);
    await page.evaluate(
      (o) => envProbe.stand([o, { x: o.x + 0.8, y: o.y - 0.5 }, { x: o.x - 0.6, y: o.y + 0.7 }]),
      open,
    );
    await treeShot('forest-edge', at(open, 2));
    await treeShot('dense-forest', at(forest.dense, 1));
    await treeShot('snowy-forest', at(forest.snowy, 1.4, { snow: 0.9, frost: 0.6 }));
    const treeCost = {};
    for (const zoom of [1, 0.45])
      treeCost[`dense forest, zoom ${zoom}`] = await page.evaluate(
        ({ p, zoom }) => {
          envProbe.weather({});
          envProbe.look(p.x, p.y, zoom);
          return { frameMs: envProbe.cost(), ...envProbe.split() };
        },
        { p: forest.dense, zoom },
      );
    report.treeCost = treeCost;
    console.log('tree frame cost (ms)', JSON.stringify(treeCost));
    await page.evaluate((o) => {
      envProbe.weather({});
      envProbe.look(o.x, o.y - 0.6, 3.2);
    }, forest.edge);
    const blow = await page.evaluate((cell) => envProbe.chop(cell, 'blow'), forest.cell);
    assert.equal(blow, 'blow', 'The resident starts felling');
    await treeShot('felling', { fn: () => {}, arg: null });
    const fall = await page.evaluate((cell) => envProbe.chop(cell, 'fall'), forest.cell);
    assert.equal(fall, 'fall', 'The tree falls');
    await treeShot('fallen', { fn: () => {}, arg: null });
    const entered = await page.evaluate(() => envProbe.enter(5));
    assert(entered, 'The party enters Alfheim');
    const realm = await page.evaluate(() => envProbe.realm());
    await treeShot('world-alfheim', at(realm.entry, 1.2));
    assert(await page.evaluate(() => envProbe.leave()), 'The party leaves Alfheim');
  }
  if (wanted('mountains')) {
    const prefix = process.env.MOUNTAINS_PREFIX ?? 'after',
      m = await page.evaluate(() => envProbe.mountains()),
      camp = places.camp,
      between = { x: (camp.x + m.near.x) / 2, y: (camp.y + m.near.y) / 2 },
      mountainShot = async (name, setup) => {
        await shot(`mountains-${prefix}-${name}`, setup);
        (report.peaks ??= {})[name] = await page.evaluate(() => envProbe.peakCount());
      };
    // A resident beside the cottage, between the camp and the nearest high peak.
    await page.evaluate((p) => envProbe.stand([p, { x: p.x + 0.6, y: p.y + 0.4 }]), {
      x: camp.x - 1.6,
      y: camp.y + 2.6,
    });
    await mountainShot('settlement', at(between, 1.4));
    report.sizes = await page.evaluate((p) => envProbe.sizes(p), camp);
    console.log('drawn sizes at zoom 1', JSON.stringify(report.sizes));
    await mountainShot('ridge-and-forest', at({ x: m.wooded.x + 1.5, y: m.wooded.y + 1.5 }, 1));
    await mountainShot('volcano', at(places.volcano, 0.45));
    await mountainShot('snow-ridge', at(m.snow, 0.9, { snow: 0.9, frost: 0.6 }));
    await mountainShot('zoomed-out', at({ x: 88, y: 88 }, 0.3));
    const mountainCost = {};
    for (const zoom of [1, 0.45])
      mountainCost[`mountains, zoom ${zoom}`] = await page.evaluate(
        ({ p, zoom }) => {
          envProbe.weather({});
          envProbe.look(p.x, p.y, zoom);
          return { frameMs: envProbe.cost(), ...envProbe.split() };
        },
        { p: { x: m.wooded.x, y: m.wooded.y }, zoom },
      );
    report.mountainCost = mountainCost;
    console.log('mountain frame cost (ms)', JSON.stringify(mountainCost));
    console.log('peaks on screen', JSON.stringify(report.peaks));
  }
  if (wanted('ghosts')) {
    // Units hidden behind trees and peaks. GHOSTS_PREFIX names the set; "before" hides the ghost layer.
    const prefix = process.env.GHOSTS_PREFIX ?? 'after',
      forest = await page.evaluate(() => envProbe.forest()),
      ridge = await page.evaluate(() => envProbe.behindRidge()),
      ghostShot = async (name, setup, clip) => {
        await page.evaluate(setup.fn, setup.arg);
        await page.evaluate(() => {
          for (let i = 0; i < 3; ++i) envProbe.frame();
        });
        const path = `${output}/ghosts-${prefix}-${name}.png`;
        await page.screenshot({ path, ...(clip ? { clip } : {}) });
        report.shots.push(path);
      };
    await page.evaluate((off) => (envProbe.game.ghostsOff = off), prefix === 'before');
    const d = forest.dense,
      ring = (c, r, n) =>
        Array.from({ length: n }, (_, k) => ({
          x: c.x + r * Math.cos((k * 2 * Math.PI) / n + 0.3),
          y: c.y + r * Math.sin((k * 2 * Math.PI) / n + 0.3),
        }));
    await page.evaluate((c) => {
      envProbe.weather({});
      envProbe.game.town.scout(c.x, c.y, 14);
    }, d);
    // Five residents felling trees deep in the forest.
    const fellers = await page.evaluate((points) => envProbe.muster(points), ring(d, 1.6, 5));
    const cells = await page.evaluate((c) => {
      const map = envProbe.game.town.map(),
        found = [];
      for (let r = 1; r < 5 && found.length < 5; ++r)
        for (let y = Math.floor(c.y) - r; y <= Math.floor(c.y) + r; ++y)
          for (let x = Math.floor(c.x) - r; x <= Math.floor(c.x) + r; ++x)
            if (map.at(x, y).trees && !found.includes(y * map.width() + x) && found.length < 5) found.push(y * map.width() + x);
      return found;
    }, d);
    report.fellingAfter = await page.evaluate(({ ids, cells }) => envProbe.fell(ids, cells), { ids: fellers, cells });
    await ghostShot('felling', at(d, 1.6));
    // A fight in the forest: 20 residents against a swarm of 150.
    await page.evaluate((points) => envProbe.muster(points), [...ring(d, 0.8, 8), ...ring(d, 1.8, 12)]);
    await page.evaluate((c) => envProbe.swarm(c, 150, 5.5), d);
    await page.evaluate(() => {
      for (let i = 0; i < 45; ++i) envProbe.live(1 / 30);
    });
    await ghostShot('forest-fight', at(d, 1));
    await ghostShot('forest-fight-zoomed-out', at(d, 0.45));
    // A phone held upright: a 390 x 800 slice of the screen at the scale a phone shows the world.
    await ghostShot('phone', at(d, 1.3), { x: 445, y: 0, width: 390, height: 800 });
    report.ghostCost = {};
    for (const zoom of [1, 0.45])
      report.ghostCost[`forest fight, zoom ${zoom}`] = await page.evaluate(
        async ({ p, zoom }) => {
          envProbe.look(p.x, p.y, zoom);
          return { ...(await envProbe.ghostCost(240)), frameMs: envProbe.cost() };
        },
        { p: d, zoom },
      );
    console.log('ghost cost', JSON.stringify(report.ghostCost));
    // Three residents just behind a ridge.
    await page.evaluate(() => (envProbe.game.town.beasts = []));
    await page.evaluate(
      (r) => {
        envProbe.muster([r, { x: r.x - 0.5, y: r.y + 0.1 }, { x: r.x + 0.2, y: r.y - 0.6 }]);
        envProbe.game.town.scout(r.x, r.y, 10);
      },
      ridge,
    );
    await ghostShot('behind-ridge', at({ x: ridge.x + 1, y: ridge.y + 1 }, 1.3));
    await page.evaluate(() => (envProbe.game.ghostsOff = false));
  }
  if (wanted('lava')) {
    const v = places.volcano,
      ring = (c, r, n) =>
        Array.from({ length: n }, (_, k) => ({
          x: c.x + r * Math.cos((k * 2 * Math.PI) / n),
          y: c.y + r * Math.sin((k * 2 * Math.PI) / n),
        })),
      flow = { x: v.x + 9, y: v.y + 9 },
      lavaCost = {};
    const measure = async (name, look, zoom, hour) => {
      lavaCost[name] = await page.evaluate(
        async ({ look, zoom, hour }) => {
          envProbe.weather({ hour });
          envProbe.look(look.x, look.y, zoom);
          const frameMs = envProbe.cost();
          return { frameMs, update: await envProbe.lavaWork(zoom) };
        },
        { look, zoom, hour },
      );
    };
    await page.evaluate((points) => envProbe.stand(points), [...ring(v, 9, 6), flow]);
    for (const [hour, name] of [
      [11, 'day'],
      [19.4, 'dusk'],
      [23, 'night'],
    ]) {
      await shot(`lava-volcano-${name}`, at(v, 0.55, { hour }));
      await shot(`lava-flow-${name}`, at(flow, 1.4, { hour }));
    }
    for (const hour of [11, 23]) {
      const when = hour === 11 ? 'day' : 'night';
      await measure(`no lava, ${when}`, places.camp, 1, hour);
      await measure(`a little lava, ${when}`, { x: v.x - 12, y: v.y + 14 }, 1, hour);
      await measure(`volcano, ${when}`, v, 0.55, hour);
    }
    const entered = await page.evaluate(() => envProbe.enter(3));
    assert(entered, 'The party enters Muspelheim');
    const realm = await page.evaluate(() => envProbe.realm()),
      middle = { x: realm.area.x + realm.area.size / 2, y: realm.area.y + realm.area.size / 2 },
      grid = [];
    // Residents all over the island: every lane in sight, the worst case for cost.
    for (let y = realm.area.y + 4; y < realm.area.y + realm.area.size; y += 8)
      for (let x = realm.area.x + 4; x < realm.area.x + realm.area.size; x += 8) grid.push({ x, y });
    await page.evaluate((points) => envProbe.stand(points), grid);
    await page.evaluate(
      (r) => envProbe.game.town.scout(r.area.x + r.area.size / 2, r.area.y + r.area.size / 2, r.area.size),
      realm,
    );
    for (const [hour, name] of [
      [11, 'day'],
      [23, 'night'],
    ]) {
      await shot(`lava-muspelheim-${name}`, at(middle, 0.62, { hour }));
      await shot(`lava-muspelheim-lane-${name}`, at(realm.heart, 1.2, { hour }));
      await measure(`Muspelheim zoom 1, ${name}`, middle, 1, hour);
      await measure(`Muspelheim zoom 0.45, ${name}`, middle, 0.45, hour);
    }
    report.lavaCost = lavaCost;
    console.log('lava frame cost (ms)', JSON.stringify(lavaCost));
  }
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
  else console.log('environment browser validation passed', JSON.stringify(report.cost));
}
