// The end of an expedition is staged: a fall beyond a gate is a short held moment, the last fall dims into a result
// screen, and none of it changes what the simulation does.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Key, Rect } from '../../packages/native-ui/src';
import { defaultLocale, hasHangul, setLocale, translate } from '../../packages/localization/src/index';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Role, type Person } from '../../packages/engine/src/person';
import { MonsterRank } from '../../packages/engine/src/combat-events';
import { Camera, distance, project, type Point } from '../../packages/engine/src/geometry';
import { lairOf, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { sealable } from '../../packages/engine/src/gate-seals';
import { realmRules } from '../../packages/engine/src/town-realm';
import { ExpeditionEnd, MemberState, type ExpeditionResult } from '../../packages/engine/src/expedition-record';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Order } from '../../packages/engine/src/game-tools';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import { combatFrame, combatOverlays, type CombatFrameApp } from '../../apps/web/src/native/game-combat-hud';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import { Beat, stagingFrame, stagingHeld, stagingRules, stagingVeil } from '../../apps/web/src/native/expedition-staging';
import {
  closeExpeditionResult,
  handleResultEvent,
  homeGlide,
  renderExpeditionResult,
  resultText,
  type ResultApp,
} from '../../apps/web/src/native/expedition-result';
import { Cue, Sound } from '../../packages/native-audio/src/sound-types';
import type { AppEvent } from '../../apps/web/src/native/application-contracts';

class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { putImageData() {}, clearRect() {} };
  }
}
let tvg: ThorVGNamespace;
let base: WorldMap;
let metrics: ConstructorParameters<typeof Context>[1];
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({ renderer: 'sw', locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}` });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  metrics = Object.fromEntries(
    ['DejaVuSans', 'DejaVuSans-Bold'].map((font) => [
      font,
      parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
    ]),
  );
  base = WorldMap.generate(5);
}, 120000);
afterAll(() => {
  setLocale(defaultLocale);
  tvg.term();
  vi.unstubAllGlobals();
});

/** A settlement with a party of `callings` already stepped through the nearest gate. */
function expedition(callings: Calling[], level: number, floor = 0) {
  const town = new Town(base, 176, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  const gate = town
    .map()
    .dungeons()
    .map((site, index) => ({ site, index }))
    .filter((g) => sealable(g.site))
    .sort((a, b) => distance(lairOf(a.site), camp.center) - distance(lairOf(b.site), camp.center))[0].index;
  town.map().dungeons()[gate].discovered = true;
  town.depth = town.map().dungeons().map((_, index) => (index === gate ? floor : 0));
  const members = callings.map((calling) => {
    const p = town.makePerson(Role.Resident, calling, monsterEntrance(town.map().dungeons()[gate]));
    town.folk.push(p);
    p.level = level;
    p.activity = Activity.Expedition;
    p.inside = true;
    return p;
  });
  town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor });
  town.advance(0.1);
  town.notices = [];
  return { town, gate, members };
}

type TestApp = GameHudApp & CombatFrameApp & ResultApp;
/** The app around a town, driven the way `render` drives it: advance unless held, then staging, then the combat HUD. */
function harness(town: Town, options: { reduced?: boolean; width?: number; height?: number } = {}) {
  // Fonts are loaded per canvas, as the other HUD suites do: destroying a canvas lets them go.
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const width = options.width ?? 1024,
    height = options.height ?? 768,
    canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, { width, height, enableDevicePixelRatio: false }),
    context = new Context(tvg, metrics),
    renderer = { visible: () => true, invalidatePresentation: vi.fn(), pick: () => null },
    app = new GameAppState(town, renderer as never, context) as TestApp;
  app.viewWidth = width;
  app.viewHeight = height;
  const camp = project(town.map().camp().x, town.map().camp().y);
  app.camera = new Camera(camp.x, camp.y, 1.4);
  app.skyBounds = new Rect((width - 356) / 2, 14, 356, 32);
  app.dockBounds = new Rect(0, height - 160, width, 150);
  app.selectPeople = vi.fn((ids: readonly number[]) => {
    app.chosen = [...ids];
  });
  app.gameSpeed = () => (app.paused ? 0 : app.speed);
  app.reducedMotion = () => !!options.reduced;
  app.spatial = (cue) => new Sound(cue, 0.8);
  app.sayLine = vi.fn(() => true);
  canvas.add(context.scene());
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  let now = 10;
  const h = {
    app,
    held: 0,
    advanced: 0,
    get now() {
      return now;
    },
    /** One frame of `dt` seconds. */
    frame(dt = 0.1) {
      now += dt;
      if (stagingHeld(app)) ++h.held;
      else if (!app.paused) {
        town.advance(dt);
        ++h.advanced;
      }
      stagingFrame(app, now);
      combatFrame(app, dt);
      h.draw();
    },
    frames(seconds: number, dt = 0.1) {
      for (let t = 0; t < seconds - 1e-6; t += dt) h.frame(dt);
    },
    draw() {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), now);
      if (app.expeditionResult) renderExpeditionResult.call(app, width, height);
      else {
        stagingVeil(app, width, height);
        combatOverlays(app, width, height);
      }
      context.end();
    },
    ids: () => controls.mock.calls.map((call) => call[0]),
    text: () => labels.mock.calls.map((call) => String(call[1])),
    dispose() {
      app.combatHud.dispose();
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
  return h;
}
const keyDown = (text: string): AppEvent => ({
  type: 'KeyDown',
  x: 0,
  y: 0,
  delta: 0,
  button: 0,
  key: Key.None,
  text,
  shift: false,
  control: false,
  alt: false,
  meta: false,
});
const centred = (app: GameAppState, at: Point) => {
  const p = project(at.x, at.y);
  return Math.abs(app.camera.x - p.x) < 0.5 && Math.abs(app.camera.y - p.y) < 0.5;
};

describe('a fall beyond a gate', () => {
  it('raises one short emphasis on the fallen and gives control straight back', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Warrior, Calling.Warrior], 3),
      h = harness(town),
      [hurt] = members;
    h.frame();
    town.strikeDown(hurt, 'Killed by monsters');
    h.frame();
    const clock = town.clock(),
      moment = h.app.staging.moment!;
    expect(moment.beat).toBe(Beat.Down);
    expect(moment.names).toEqual([hurt.name]);
    // The combat auto-pause holds the world; the emphasis only moves the camera and veils the rest.
    expect(h.app.paused).toBe(true);
    expect(h.app.combatHud.autoPause?.title).toBe(`${hurt.name} is down`);
    expect(h.ids()).not.toContain('staging-banner');
    h.frames(stagingRules.glide + 0.05);
    expect(centred(h.app, hurt.position)).toBe(true);
    h.frames(stagingRules.down);
    expect(h.app.staging.moment).toBeNull();
    // Control is back at once, the camera stays where the moment left it and the world is as it was.
    const camera = { x: h.app.camera.x, y: h.app.camera.y };
    h.frames(0.5);
    expect({ x: h.app.camera.x, y: h.app.camera.y }).toEqual(camera);
    expect(town.clock()).toBe(clock);
    h.app.paused = false;
    h.frame();
    expect(town.clock()).toBeGreaterThan(clock);
    h.dispose();
  }, 120000);
  it('makes one emphasis of falls close together, and never steals the camera from an order in progress', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Warrior, Calling.Warrior, Calling.Warrior, Calling.Warrior], 3),
      h = harness(town),
      [a, b, c, d] = members;
    h.frame();
    town.strikeDown(a, 'Killed by monsters');
    town.strikeDown(b, 'Killed by monsters');
    h.frame();
    expect(h.app.staging.moment!.names).toEqual([a.name, b.name]);
    expect(h.app.combatHud.autoPause?.title).toBe(`${a.name} and ${b.name} are down`);
    h.frames(stagingRules.down + 0.1);
    h.app.paused = false;
    h.app.combatHud.autoPause = null;
    // Within the coalescing window a new fall only joins the banners.
    town.strikeDown(c, 'Killed by monsters');
    h.frame();
    expect(h.app.staging.moment).toBeNull();
    expect(h.app.staging.glide).toBeNull();
    expect(h.app.combatHud.autoPause?.title).toBe(`${c.name} is down`);
    h.frames(stagingRules.coalesce);
    h.app.paused = false;
    h.app.combatHud.autoPause = null;
    // Mid-order (an attack being aimed): the banner comes, the camera stays.
    h.app.pending = Order.Attack;
    const camera = { x: h.app.camera.x, y: h.app.camera.y };
    town.strikeDown(d, 'Killed by monsters');
    h.frame();
    expect(h.app.staging.moment?.names).toEqual([d.name]);
    expect(h.app.staging.glide).toBeNull();
    h.frames(0.6);
    expect({ x: h.app.camera.x, y: h.app.camera.y }).toEqual(camera);
    h.dispose();
  }, 120000);
  it('holds the world on a death, then lets the memorial card speak', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Warrior], 3),
      h = harness(town),
      [lost] = members;
    h.frame();
    town.killResident(lost, 'Killed by monsters', `${lost.name} has died`);
    h.frame();
    expect(h.app.staging.moment?.beat).toBe(Beat.Death);
    const clock = town.clock();
    h.frames(stagingRules.death - 0.2);
    expect(town.clock()).toBe(clock);
    expect(h.held).toBeGreaterThan(5);
    expect(h.ids()).toContain('staging-banner');
    expect(h.text()).toContain(`${lost.name} has died`);
    expect(h.ids()).not.toContain('memorial');
    expect(h.app.combatHud.memorials.map((f) => f.name)).toEqual([lost.name]);
    h.frames(0.4);
    expect(h.app.staging.moment).toBeNull();
    expect(h.ids()).toContain('memorial');
    expect(town.clock()).toBeGreaterThan(clock);
    expect(h.app.cues.some((sound) => sound.cue === Cue.Fall)).toBe(true);
    h.dispose();
  }, 120000);
});

describe('the last fall', () => {
  it('holds on the last one down, dims, and opens the result screen instead of going straight home', () => {
    const { town, gate, members } = expedition([Calling.Warrior, Calling.Warrior], 3),
      h = harness(town),
      site = town.map().dungeons()[gate];
    town.realmLoot.gold = 40;
    h.app.speed = 4;
    h.frame();
    const [first, last] = members;
    town.strikeDown(first, 'Killed by monsters');
    town.strikeDown(last, 'Killed by monsters');
    h.frame();
    expect(h.app.staging.moment?.beat).toBe(Beat.Last);
    // No auto-pause to rescue anyone: there is no one left to send.
    expect(h.app.combatHud.autoPause).toBeNull();
    expect(h.ids()).toContain('staging-banner');
    expect(h.text()).toContain('No one is left standing. The gate casts the party out.');
    const clock = town.clock();
    h.frames(stagingRules.last - 0.15);
    expect(town.clock()).toBe(clock);
    expect(centred(h.app, last.position)).toBe(true);
    h.frames(0.2);
    expect(h.app.staging.moment?.beat).toBe(Beat.Dim);
    expect(h.app.paused).toBe(false);
    // The world runs again until the gate casts the party out; the realm is still there meanwhile.
    expect(town.realmActive()).toBe(true);
    h.frames(realmRules.castOutDelay + 0.2);
    expect(town.realmActive()).toBe(false);
    const result = h.app.expeditionResult!;
    expect(result.outcome.end).toBe(ExpeditionEnd.CastOut);
    expect(h.app.paused).toBe(true);
    expect(h.ids()).toContain('expedition-result-close');
    const text = h.text();
    expect(text).toContain('Thrown back through the gate');
    expect(text).toContain('You barely made it out of the gate.');
    expect(text).toContain('The spoils were lost.');
    expect(text.some((line) => line.startsWith('Spoils lost: 40 gold'))).toBe(true);
    // The screen speaks for the cast-out notice; it is not toasted as well.
    expect(town.notices.some((n) => n.includes('casts the fallen party back out'))).toBe(false);
    expect(h.app.cues.some((sound) => sound.cue === Cue.WaveHorn)).toBe(true);
    // Enter returns to Midgard: pause and speed as they were, the view easing to the gate they came out of.
    const handled = handleResultEvent.call(h.app, keyDown('return'));
    expect(handled).toBe(true);
    expect(h.app.expeditionResult).toBeNull();
    expect(h.app.paused).toBe(false);
    expect(h.app.speed).toBe(4);
    expect(h.app.chosen.sort()).toEqual(members.map((p) => p.id).sort());
    h.frames(homeGlide + 0.2);
    expect(centred(h.app, monsterEntrance(site))).toBe(true);
    h.dispose();
  }, 120000);
  it('keeps the pause the player had chosen before the expedition ended', () => {
    const { town } = expedition([Calling.Warrior], 3),
      h = harness(town);
    h.app.paused = true;
    expect(town.leaveRealm()).toBe(true);
    h.frame();
    expect(h.app.expeditionResult?.outcome.end).toBe(ExpeditionEnd.Withdrew);
    closeExpeditionResult(h.app);
    expect(h.app.paused).toBe(true);
    h.dispose();
  }, 120000);
  it('with reduced motion keeps only the banners and the result screen: no hold, veil or camera move', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Warrior], 3),
      h = harness(town, { reduced: true }),
      camera = () => ({ x: h.app.camera.x, y: h.app.camera.y });
    h.frame();
    const start = camera();
    town.killResident(members[0], 'Killed by monsters');
    h.frame();
    expect(h.app.staging.moment).toBeNull();
    expect(h.ids()).toContain('memorial');
    town.strikeDown(members[1], 'Killed by monsters');
    h.frame();
    expect(h.app.staging.moment?.beat).toBe(Beat.Dim);
    expect(h.ids()).toContain('staging-banner');
    h.frames(realmRules.castOutDelay - 0.3);
    expect(camera()).toEqual(start);
    h.frames(0.5);
    expect(h.held).toBe(0);
    const home = h.app.expeditionResult!.outcome.home;
    expect(h.app.expeditionResult?.outcome.end).toBe(ExpeditionEnd.CastOut);
    closeExpeditionResult(h.app);
    h.frame();
    // The way home is a cut, not a glide.
    expect(centred(h.app, home)).toBe(true);
    h.dispose();
  }, 120000);
});

describe('the result screen', () => {
  /** Ends the floor by felling its dens and guardian through the engine's own kill path. */
  function clearFloor(town: Town): void {
    const dens = town.realmDens(),
      guardian = town.realmFoes().find((m) => m.id === town.realmGuardian)!;
    for (const m of [...dens, guardian]) {
      m.health = 0;
      town.realmKill(m);
    }
  }
  it('tells a cleared floor: what fell, what was earned, who came back and what opened', () => {
    const { town, gate, members } = expedition([Calling.Warrior, Calling.Ranger, Calling.Mage], 1),
      dens = town.realmDens().length,
      swarmers = town.realmFoes().filter((m) => m.rank === MonsterRank.Swarmer).slice(0, 5);
    for (const m of swarmers) {
      m.health = 0;
      town.realmKill(m);
    }
    town.advance(30);
    members[0].level += 2;
    clearFloor(town);
    // Clearing the floor itself is not the end: the brood breaks, then the party walks home.
    town.advance(0.1);
    expect(town.realmOutcome).toBeNull();
    expect(town.leaveRealm()).toBe(true);
    const outcome = town.realmOutcome!,
      site = town.map().dungeons()[gate];
    expect(outcome).toMatchObject({
      end: ExpeditionEnd.Cleared,
      site: site.name,
      floor: 0,
      floors: 3,
      dens,
      densDestroyed: dens,
      guardianFell: true,
      spoilsKept: true,
    });
    expect(outcome.seconds).toBeGreaterThanOrEqual(30);
    // Five swarmers, every den and the guardian, and the rest of the brood when it broke.
    expect(outcome.slain).toBeGreaterThan(5 + dens);
    expect(outcome.spoils.empty()).toBe(false);
    expect(outcome.rewards[0]).toBe(`Floor 2 of ${site.name} is now open.`);
    expect(outcome.rewards.some((line) => line.startsWith('Hoard') || line.startsWith('Go home'))).toBe(false);
    expect(outcome.members.map((m) => m.id)).toEqual(members.map((p) => p.id));
    for (const m of outcome.members) {
      expect(m.state).toBe(MemberState.Unhurt);
      expect(m.gained).toBe(m.level - 1);
    }
    expect(outcome.members[0].gained).toBeGreaterThanOrEqual(2);
    const text = resultText(outcome);
    expect(text.slice(0, 2)).toEqual(['Floor 1 cleared', 'The floor is cleared.']);
    expect(text).toContain(`Dens destroyed: ${dens} of ${dens}`);
    expect(text).toContain('The guardian fell');
    expect(text).toContain(`Monsters slain: ${outcome.slain}`);
    expect(text.some((line) => line.startsWith('Spoils brought home: '))).toBe(true);
  }, 120000);
  it('tells a withdrawal, with a wounded member and one left behind', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Warrior, Calling.Warrior], 3),
      [walker, wounded, lost] = members,
      plan = town.realmPlan()!;
    wounded.woundDays = 2;
    lost.position = town.grid.nearestWalkable({ x: plan.entry.x + 6, y: plan.entry.y + 6 });
    town.strikeDown(lost, 'Killed by monsters');
    const swarmer = town.realmFoes().find((m) => m.rank === MonsterRank.Swarmer)!;
    swarmer.health = 0;
    town.realmKill(swarmer);
    walker.position = wounded.position = { ...plan.entry };
    expect(town.leaveRealm()).toBe(true);
    const outcome = town.realmOutcome!;
    expect(outcome).toMatchObject({ end: ExpeditionEnd.Withdrew, densDestroyed: 0, guardianFell: false, slain: 1, spoilsKept: true });
    expect(outcome.members.map((m) => m.state)).toEqual([MemberState.Unhurt, MemberState.Wounded, MemberState.Fallen]);
    const text = resultText(outcome);
    expect(text.slice(0, 2)).toEqual(['The party withdrew', 'The party came home before the floor was cleared.']);
    expect(text).toContain('The guardian still stands');
    expect(text).toContain('Wounded: heals in 2 days');
    expect(text).toContain(`Fallen: Left behind beyond ${outcome.site}`);
  }, 120000);
  it('tells a cast-out: everyone home gravely wounded, the spoils lost', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Cleric], 3);
    town.realmLoot.gold = 25;
    for (const p of members) town.strikeDown(p, 'Killed by monsters');
    town.advance(realmRules.castOutDelay + 0.2);
    const outcome = town.realmOutcome!;
    expect(outcome).toMatchObject({ end: ExpeditionEnd.CastOut, spoilsKept: false });
    expect(outcome.spoils.gold).toBe(25);
    for (const m of outcome.members) expect(m).toMatchObject({ state: MemberState.Wounded, woundDays: realmRules.wipeWoundDays });
    expect(resultText(outcome).slice(0, 3)).toEqual([
      'Thrown back through the gate',
      'You barely made it out of the gate.',
      'The spoils were lost.',
    ]);
  }, 120000);
  it('tells a party that never came back, each with the cause of their death', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Bard], 3);
    for (const p of members) town.killResident(p, 'Killed by monsters');
    town.advance(0.1);
    // The gate waits its beat before it closes behind the dead.
    expect(town.realmActive()).toBe(true);
    town.advance(realmRules.castOutDelay + 0.1);
    expect(town.realmActive()).toBe(false);
    const outcome = town.realmOutcome!;
    expect(outcome.end).toBe(ExpeditionEnd.Lost);
    expect(outcome.members.map((m) => [m.state, m.cause])).toEqual([
      [MemberState.Fallen, 'Killed by monsters'],
      [MemberState.Fallen, 'Killed by monsters'],
    ]);
    expect(outcome.members.every((m) => m.fallen !== null)).toBe(true);
    const text = resultText(outcome);
    expect(text.slice(0, 3)).toEqual(['No one came back', 'The whole party fell beyond the gate.', 'Nothing was carried out.']);
    expect(text).toContain('Fallen: Killed by monsters');
  }, 120000);
  it('draws at phone size and in Korean with no English left but names', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Bard], 3);
    town.realmLoot.gold = 12;
    for (const p of members) town.strikeDown(p, 'Killed by monsters');
    town.advance(realmRules.castOutDelay + 0.2);
    const h = harness(town, { width: 390, height: 780 });
    h.frame();
    expect(h.app.expeditionResult).not.toBeNull();
    expect(h.text()).toContain('You barely made it out of the gate.');
    for (const p of members) expect(h.text()).toContain(p.name);
    const outcome = h.app.expeditionResult!.outcome,
      names = new Set([...members.map((p) => p.name), ...outcome.site.split(/\W+/), ...outcome.world.split(/\W+/)]),
      lines = [...resultText(outcome), `${outcome.site}  ·  ${outcome.world}  ·  Floor 1 of 3`, 'Return to Midgard (Enter)', 'Return to Midgard'];
    setLocale('KR');
    try {
      const english = lines
        .map((line) => translate(line))
        .filter((line) => [...line.matchAll(/[A-Za-z]{3,}/g)].some((hit) => !names.has(hit[0])));
      expect(english).toEqual([]);
      for (const line of lines) if (/[A-Za-z]{3}/.test(line.replace(/\b\w+\b/g, (w) => (names.has(w) ? '' : w)))) expect(hasHangul(translate(line)), line).toBe(true);
      for (const title of ['A and B have died', '3 residents have died', 'No one is left standing. The gate casts the party out.', 'No one is left alive beyond the gate.'])
        expect(hasHangul(translate(title)), title).toBe(true);
    } finally {
      setLocale(defaultLocale);
    }
    h.dispose();
  }, 120000);
});

describe('staging never changes the simulation', () => {
  /** A weak party sent at the dens: it is downed, some die, the gate casts the rest out. */
  function script(town: Town, members: Person[]): (time: number) => void {
    const ids = members.map((p) => p.id),
      target = () => town.realmDens()[0]?.position ?? town.realmPlan()?.entry;
    let next = 0;
    return (time) => {
      if (time < next || !town.realmActive()) return;
      next = time + 8;
      const at = target();
      if (at) town.orderAttackMove(ids, at);
    };
  }
  const state = (town: Town) => {
    const copy = decodeTown(encodeTown(town), (map) => new Town(map, 176, false, true));
    copy.notices = [];
    return encodeTown(copy);
  };
  it('runs the same scripted expedition to the same end with and without the held moments', () => {
    const until = 150,
      bare = expedition([Calling.Settler, Calling.Settler, Calling.Warrior], 1),
      staged = expedition([Calling.Settler, Calling.Settler, Calling.Warrior], 1),
      plain = script(bare.town, bare.members),
      directed = script(staged.town, staged.members);
    while (bare.town.clock() < until) {
      plain(bare.town.clock());
      bare.town.advance(0.1);
    }
    const h = harness(staged.town);
    let results = 0,
      moments = 0;
    for (let frame = 0; staged.town.clock() < until && frame < 20000; ++frame) {
      // The player resumes every auto-pause and returns from every result screen at once.
      if (h.app.combatHud.autoPause) {
        h.app.paused = false;
        h.app.combatHud.autoPause = null;
      }
      if (h.app.expeditionResult) {
        ++results;
        closeExpeditionResult(h.app);
      }
      if (h.app.staging.moment && h.app.staging.moment.start === h.now) ++moments;
      if (!stagingHeld(h.app) && !h.app.paused) directed(staged.town.clock());
      h.frame();
    }
    expect(bare.town.realmActive()).toBe(false);
    expect(moments).toBeGreaterThan(0);
    expect(h.held).toBeGreaterThan(0);
    expect(results).toBe(1);
    expect(staged.town.clock()).toBeCloseTo(bare.town.clock(), 6);
    expect(state(staged.town)).toEqual(state(bare.town));
    h.dispose();
  }, 240000);
});

describe('saving around the end of an expedition', () => {
  it('rebuilds the record after a mid-way load and leaves out what was not kept', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Warrior], 3),
      dens = town.realmDens().length,
      swarmer = town.realmFoes().find((m) => m.rank === MonsterRank.Swarmer)!;
    swarmer.health = 0;
    town.realmKill(swarmer);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 176, false, true));
    expect(loaded.realmRecord).toBeNull();
    for (const p of loaded.realmParty()) loaded.strikeDown(p, 'Killed by monsters');
    loaded.advance(realmRules.castOutDelay + 0.2);
    const outcome = loaded.realmOutcome!;
    expect(outcome).toMatchObject({ end: ExpeditionEnd.CastOut, seconds: -1, slain: -1, dens });
    expect(outcome.members.map((m) => m.id).sort()).toEqual(members.map((p) => p.id).sort());
    for (const m of outcome.members) expect(m.gained).toBe(-1);
    const text = resultText(outcome);
    expect(text).toContain('The time, the slain and the levels gained are not known across a load.');
    expect(text.some((line) => line.startsWith('Monsters slain') || line.startsWith('Beyond the gate for'))).toBe(false);
  }, 120000);
  it('casts out a party saved while it lay fallen, after the beat starts again', () => {
    const { town } = expedition([Calling.Warrior], 3);
    for (const p of town.realmParty()) town.strikeDown(p, 'Killed by monsters');
    town.advance(1);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 176, false, true));
    loaded.advance(1);
    expect(loaded.realmActive()).toBe(true);
    loaded.advance(realmRules.castOutDelay + 0.1);
    expect(loaded.realmActive()).toBe(false);
    expect(loaded.realmOutcome?.end).toBe(ExpeditionEnd.CastOut);
  }, 120000);
  it('does not carry an open result screen across a load: the loaded game is simply home', () => {
    const { town } = expedition([Calling.Warrior], 3),
      h = harness(town);
    h.app.paused = false;
    expect(town.leaveRealm()).toBe(true);
    h.frame();
    expect(h.app.expeditionResult).not.toBeNull();
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 176, false, true));
    expect(loaded.realmOutcome).toBeNull();
    h.app.town = loaded;
    h.frame();
    expect(h.app.staging.moment).toBeNull();
    // The window belongs to the town it was opened for and closes with it.
    expect(h.app.expeditionResult).toBeNull();
    h.dispose();
  }, 120000);
});
