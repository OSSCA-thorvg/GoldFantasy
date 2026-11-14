// Korean for what the player reads in a fight, beyond a gate and in the newer buildings: every string here is built
// by the code that shows it, drawn or called in Korean, and must come out with no English left but names and keys.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { defaultLocale, hasHangul, setLocale, translate } from '../../packages/localization/src/index';
import { korean } from '../../packages/localization/src/korean';
import { combatPhrases } from '../../packages/localization/src/korean/combat';
import { progressPhrases } from '../../packages/localization/src/korean/progress';
import { expeditionResultPhrases } from '../../packages/localization/src/korean/expedition-result';
import { Town } from '../../packages/engine/src/town';
import { Activity, Calling, Monster, Person, Race, Role, callingName } from '../../packages/engine/src/person';
import { CombatCue, MonsterRank, type Fallen } from '../../packages/engine/src/combat-events';
import { Camera, distance, point, project } from '../../packages/engine/src/geometry';
import { Building, Check } from '../../packages/engine/src/town-models';
import { Product, Resources, Structure, structureSpec } from '../../packages/engine/src/building-catalog';
import { WorldMap } from '../../packages/engine/src/world-map';
import { lairOf, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { skills } from '../../packages/engine/src/skill-catalog';
import { Boon, boonName, boonText } from '../../packages/engine/src/gate-boons';
import { sealFloors, sealable } from '../../packages/engine/src/gate-seals';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import { commandCard, inspector } from '../../apps/web/src/native/game-hud';
import {
  personPanel,
  personPanelBounds,
  residentSelection,
  shelteredSelection,
} from '../../apps/web/src/native/game-unit-panel';
import { recallGroup, setGroup, groupTabs } from '../../apps/web/src/native/control-groups';
import { controlReason } from '../../packages/engine/src/faction';
import { holdPosition } from '../../apps/web/src/native/army-orders';
import { selectFighters } from '../../apps/web/src/native/army-keys';
import { aimPrompt, beginSkill, callingSkills, fireSkill } from '../../apps/web/src/native/skill-commands';
import { skillTooltip } from '../../apps/web/src/native/skill-card';
import { unitOrders } from '../../apps/web/src/native/unit-orders-card';
import { floorForecast } from '../../apps/web/src/native/swarm-hud';
import { realmPanel } from '../../apps/web/src/native/game-realm-panel';
import { winterOutlookLine } from '../../apps/web/src/native/camp-resource-hud';
import {
  combatFrame,
  combatHints,
  combatOverlays,
  farewell,
  memorialLines,
  type CombatFrameApp,
} from '../../apps/web/src/native/game-combat-hud';
import type { GameCommandApp } from '../../apps/web/src/native/game-commands';
import { Sound } from '../../packages/native-audio/src/sound-types';
import { toScreen } from '../../apps/web/src/native/game-input';

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
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({
    renderer: 'sw',
    locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
  });
  setLocale('KR');
});
afterAll(() => {
  setLocale(defaultLocale);
  tvg.term();
  vi.unstubAllGlobals();
});

/** Words that stay as they are in Korean: keys the player presses and the level mark. Names are added per town. */
const kept = new Set(['Ctrl', 'Shift', 'Space', 'Tab', 'Lv']);
/** English left after translation: runs of three or more Latin letters that are not a kept word. */
function leftover(text: string, names: ReadonlySet<string>): string[] {
  return [...translate(text).matchAll(/[A-Za-z]{3,}/g)]
    .map((hit) => hit[0])
    .filter((word) => !kept.has(word) && !names.has(word));
}
/** Every worded line comes out in Korean, with nothing English left but names and keys. */
function expectKorean(lines: Iterable<string>, names: Iterable<string> = []): void {
  const known = new Set(names),
    bare = (text: string) => text.replace(/[A-Za-z]+/g, (word) => (kept.has(word) || known.has(word) ? '' : word));
  const bad = [...new Set(lines)].filter(
    (line) => leftover(line, known).length > 0 || (/[A-Za-z]{2}/.test(bare(line)) && !hasHangul(translate(line))),
  );
  expect(bad).toEqual([]);
}
const namesOf = (town: Town) => [...town.folk.map((p) => p.name), ...town.fallen.map((f) => f.name)];

type TestApp = GameHudApp &
  CombatFrameApp &
  GameCommandApp & { toScreen(at: { x: number; y: number }): { x: number; y: number } };
function resident(town: Town, id: number, name: string, calling: Calling, at = point(16, 16), level = 1): Person {
  const p = new Person(id, name, Role.Resident, calling, Race.Human, 13880 + id * 977, at);
  p.home = p.village = 0;
  p.food = p.rest = p.hydration = p.health = 1;
  p.stress = 0;
  p.level = level;
  p.autoMode = false;
  town.folk.push(p);
  town.nextPerson = Math.max(town.nextPerson, id + 1);
  return p;
}
function fixture(town = new Town(5, 32), width = 1024, height = 768) {
  const canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, {
    width,
    height,
    enableDevicePixelRatio: false,
  });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const metrics = Object.fromEntries(
      ['DejaVuSans', 'DejaVuSans-Bold'].map((font) => [
        font,
        parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
      ]),
    ),
    context = new Context(tvg, metrics);
  const renderer = { visible: () => true, invalidatePresentation: vi.fn(), pick: () => null },
    app = new GameAppState(town, renderer as never, context) as TestApp;
  app.viewWidth = width;
  app.viewHeight = height;
  const focus = project(16, 16);
  app.camera = new Camera(focus.x, focus.y, 1.6);
  app.skyBounds = new Rect((width - 356) / 2, 14, 356, 32);
  app.dockBounds = new Rect(0, height - 160, width, 150);
  app.selectPeople = vi.fn((ids: readonly number[]) => {
    app.chosen = [...ids];
  });
  app.selectTool = vi.fn();
  app.selectBuilding = vi.fn();
  app.dismissBuildDrawer = vi.fn();
  app.togglePause = () => (app.paused = !app.paused);
  app.gameSpeed = () => (app.paused ? 0 : app.speed);
  app.reducedMotion = () => true;
  app.spatial = (cue) => new Sound(cue, 0.8);
  app.sayLine = vi.fn(() => true);
  app.toScreen = toScreen.bind(app);
  app.cue = vi.fn();
  app.residentSelection = residentSelection.bind(app);
  app.shelteredSelection = shelteredSelection.bind(app);
  app.commandCard = commandCard.bind(app);
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  const seen: string[] = [];
  const draw = (fn: () => void, time = 1) => {
    controls.mockClear();
    labels.mockClear();
    context.begin(app.theme, new Rect(0, 0, width, height), time);
    fn();
    context.end();
    canvas.update().render();
    seen.push(...labels.mock.calls.map((call) => String(call[1])));
  };
  return {
    app,
    town,
    seen,
    draw,
    /** Draws once, then again with the pointer over every control whose id passes `pick`, to open its tooltip. */
    hoverAll(fn: () => void, pick: (id: string) => boolean, time = 1) {
      draw(fn, time);
      const targets = controls.mock.calls.filter((call) => pick(call[0])).map((call) => call[1]);
      for (const r of targets) {
        const at = point(r.x + r.w / 2, r.y + r.h / 2);
        context.pointerMove(at.x, at.y);
        app.mouse = at;
        draw(fn, time);
      }
      context.pointerMove(-10, -10);
      app.mouse = point(-10, -10);
    },
    dispose() {
      app.combatHud.dispose();
      for (const entry of app.dockPortraits.values()) entry.paint.dispose();
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
}
function realm(town: Town, party: Person[], foes: Monster[] = [], guardian?: Monster) {
  town.realmGate = town.map().dungeons().findIndex(sealable);
  vi.spyOn(town, 'realmActive').mockReturnValue(true);
  vi.spyOn(town, 'realmPlan').mockReturnValue({ entry: point(14, 14) } as never);
  vi.spyOn(town, 'realmParty').mockReturnValue(party);
  vi.spyOn(town, 'realmFoes').mockImplementation(() =>
    [...foes, ...(guardian ? [guardian] : [])].filter((m) => m.health > 0),
  );
  vi.spyOn(town, 'realmDens').mockImplementation(() => foes.filter((m) => m.rank === MonsterRank.Den && m.health > 0));
  vi.spyOn(town, 'inRealm').mockReturnValue(true);
  if (guardian) {
    town.beasts.push(guardian);
    town.realmGuardian = guardian.id;
  }
}
function settlement(): Town {
  const town = new Town(5, 32, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  town.notices = [];
  return town;
}
function facility(town: Town, kind: Structure, workers = 1): Building {
  const b = new Building(town.nextId++, kind, point(4 + town.nextId * 3, 4), 0, 0);
  b.village = 0;
  b.workers = workers;
  b.progress = 1;
  town.placed.push(b);
  return b;
}

describe('Korean tables', () => {
  it('use only syllables the Korean font subset carries, and keep every placeholder', () => {
    // The subset holds the KS X 1001 syllables, which are exactly the two-byte Hangul of EUC-KR.
    const decoder = new TextDecoder('euc-kr'),
      carried = new Set<string>();
    for (let lead = 0xb0; lead < 0xc9; ++lead)
      for (let trail = 0xa1; trail < 0xff; ++trail) carried.add(decoder.decode(new Uint8Array([lead, trail])));
    const tables = [combatPhrases, progressPhrases, expeditionResultPhrases],
      used = new Set(tables.flatMap((t) => [...Object.values(t).join('')]).filter((c) => /[\uac00-\ud7a3]/.test(c)));
    expect([...used].filter((c) => !carried.has(c))).toEqual([]);
    const placeholders = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map((hit) => hit[1]).sort();
    for (const table of tables)
      for (const [key, value] of Object.entries(table)) expect(placeholders(value), key).toEqual(placeholders(key));
  });
});

describe('the army in Korean', () => {
  it('orders card, skill card and control groups, with every tooltip, for pointer and touch', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        warrior = resident(town, 0, 'Askr', Calling.Warrior, point(16, 16), 4),
        mage = resident(town, 1, 'Embla', Calling.Mage, point(17, 16)),
        mage2 = resident(town, 2, 'Geir', Calling.Mage, point(17, 17), 4),
        cleric = resident(town, 3, 'Sigrun', Calling.Cleric, point(18, 16)),
        settler = resident(town, 4, 'Hild', Calling.Settler, point(18, 17));
      mage2.abilityReadyAt = town.clock() + 5;
      const panel = () => personPanel.call(app, personPanelBounds.call(app, 1024, 768, true)),
        tipped = (id: string) => /^(ability-|skill-auto-|skill-calling-|unit\/card-|group-)/.test(id);
      // One resident, then a mixed selection with calling tabs, then a whole calling.
      for (const chosen of [[cleric.id], [warrior.id, mage.id, mage2.id, cleric.id], [mage.id, mage2.id]]) {
        app.chosen = chosen;
        ui.hoverAll(panel, tipped);
        app.army.focus = Calling.Mage;
        ui.hoverAll(panel, tipped);
        app.army.focus = Calling.Warrior;
      }
      warrior.holding = true;
      app.chosen = [warrior.id];
      ui.draw(panel);
      // Groups: the tabs, their tooltips and the + tab.
      app.chosen = [warrior.id, mage.id, cleric.id];
      setGroup(app, 1, false);
      mage.downedAt = town.clock();
      app.dockBounds = new Rect(262, 600, 500, 156);
      app.chosen = [mage2.id];
      ui.hoverAll(() => groupTabs(app, 768), (id) => id.startsWith('group-'));
      mage.downedAt = -1;
      // Touch: the same panel and tabs at finger size.
      app.touchMode = true;
      for (const chosen of [[cleric.id], [warrior.id, mage.id, cleric.id]]) {
        app.chosen = chosen;
        ui.draw(panel);
        ui.draw(() => groupTabs(app, 768));
      }
      app.touchMode = false;
      const statuses: string[] = [];
      const status = (fn: () => unknown) => {
        app.status = '';
        fn();
        statuses.push(app.status);
      };
      app.chosen = [];
      status(() => setGroup(app, 2, false));
      status(() => recallGroup(app, 3));
      status(() => holdPosition(app));
      app.chosen = [settler.id];
      status(() => fireSkill(app, app.chosen, 0));
      status(() => fireSkill(app, app.chosen, 1));
      app.chosen = [mage.id];
      status(() => fireSkill(app, app.chosen, 1));
      app.chosen = [mage.id, cleric.id];
      status(() => fireSkill(app, app.chosen, 1));
      app.chosen = [mage2.id];
      status(() => fireSkill(app, app.chosen, 0));
      mage.abilityReadyAt = town.clock() + 4;
      app.chosen = [mage.id, mage2.id];
      status(() => fireSkill(app, app.chosen, 0));
      app.chosen = [warrior.id];
      status(() => fireSkill(app, app.chosen, 0));
      status(() => fireSkill(app, app.chosen, 1));
      app.chosen = [cleric.id];
      status(() => fireSkill(app, app.chosen, 0));
      status(() => fireSkill(app, app.chosen, 1));
      status(() => fireSkill(app, [mage2.id], 1, point(30, 30)));
      town.folk = town.folk.filter((p) => p !== warrior);
      for (const p of town.folk) p.inside = true;
      status(() => selectFighters(app));
      for (const p of town.folk) p.inside = false;
      town.folk.push(warrior);
      // The prompt while a ground skill waits for its point, by key, pointer and touch.
      const prompts: string[] = [];
      mage2.abilityReadyAt = mage2.abilityReadyAt2 = -1;
      mage2.level = 4;
      for (const via of ['key', 'pointer'] as const) {
        app.chosen = [mage2.id];
        beginSkill(app, app.chosen, 1, via);
        prompts.push(aimPrompt(app));
        app.touchMode = via === 'pointer';
        prompts.push(aimPrompt(app));
        app.touchMode = false;
        app.army.aim = null;
      }
      // Both pointer and touch tooltips of every slot of every calling with skills.
      const tips: string[] = [];
      for (const calling of [Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric, Calling.Bard]) {
        const a = resident(town, 20 + calling * 2, 'Ulf', calling, point(10, 10), 4),
          b = resident(town, 21 + calling * 2, 'Ulf', calling, point(10, 11), 1);
        for (const group of callingSkills(town, [a.id, b.id]))
          for (const slot of [0, 1])
            for (const touch of [false, true]) tips.push(...skillTooltip(group.slots[slot], slot, touch));
        for (const group of callingSkills(town, [b.id]))
          for (const touch of [false, true]) tips.push(...skillTooltip(group.slots[1], 1, touch));
      }
      app.shelteredSelection = () => true;
      const orders = unitOrders(app).flatMap((order) => [order.label, ...order.lines]);
      const names = [...namesOf(town), 'Ulf'];
      expectKorean(ui.seen, names);
      expectKorean(statuses.filter(Boolean), names);
      expectKorean(prompts, names);
      expectKorean(tips, names);
      expectKorean(orders, names);
      expectKorean(combatHints);
      expectKorean(skills.flatMap((spec) => [spec.name, spec.description]));
      expect(statuses.filter(Boolean).length).toBeGreaterThan(10);
      expect(prompts.filter(Boolean)).toHaveLength(4);
    } finally {
      ui.dispose();
    }
  });
});

describe('a fight beyond a gate in Korean', () => {
  it('the swarm banners, the guardian, the party panel, the downed and the forecast', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior, point(20, 20), 5),
        b = resident(town, 1, 'Embla', Calling.Mage, point(24, 22), 5),
        c = resident(town, 2, 'Geir', Calling.Cleric, point(21, 20), 5),
        dens = [800, 801, 802].map((id, i) => new Monster(id, -1, point(30 + i * 3, 30))),
        swarm = Array.from({ length: 5 }, (_, i) => new Monster(810 + i, -1, point(31 + i * 0.5, 31))),
        g = new Monster(900, -1, point(19, 16));
      for (const den of dens) den.rank = MonsterRank.Den;
      for (const m of swarm) m.rank = MonsterRank.Swarmer;
      g.rank = MonsterRank.Guardian;
      g.vigor = 100;
      g.health = 60;
      realm(town, [a, b, c], [...dens, ...swarm], g);
      const overlays = (time: number) => ui.draw(() => combatOverlays(app, 1024, 768), time);
      combatFrame(app, 0);
      // The guardian wakes: the auto-pause and its bar, then the wind-up once enraged.
      g.angry = true;
      combatFrame(app, 0.1);
      overlays(0.1);
      app.paused = false;
      g.health = 40;
      g.windupUntil = town.clock() + 1.2;
      overlays(0.2);
      g.windupUntil = -1;
      // Dens fall one by one; the last; the brood breaks.
      for (const [i, den] of dens.entries()) {
        den.health = 0;
        town.emit(CombatCue.DenDestroyed, den.position, { person: i === 1 ? -1 : a.id, creature: den.id });
        combatFrame(app, 1 + i);
        overlays(1 + i);
      }
      town.emit(CombatCue.BroodBreak, dens[0].position, { amount: 1 });
      combatFrame(app, 5);
      overlays(5);
      town.emit(CombatCue.BroodBreak, dens[0].position, { amount: 23 });
      combatFrame(app, 6);
      overlays(6);
      // A raid wave from each side.
      vi.spyOn(town, 'raiding').mockReturnValue(true);
      for (const [i, at] of [point(16, 90), point(90, 16), point(-40, 16), point(16, -40)].entries()) {
        town.emit(CombatCue.Wave, at, { amount: 12 });
        combatFrame(app, 10 + i);
        overlays(10 + i);
      }
      vi.mocked(town.raiding).mockReturnValue(false);
      // One down, then two, then three: the pause, the cards with their tooltips, the party panel.
      for (const [i, group] of [[b], [a, c], [a, b, c]].entries()) {
        for (const p of [a, b, c]) {
          p.downedAt = -1;
          p.health = 1;
        }
        app.paused = false;
        app.combatHud.autoPause = null;
        for (const p of group) town.strikeDown(p, 'Killed by monsters');
        combatFrame(app, 20 + i);
        ui.hoverAll(() => combatOverlays(app, 1024, 768), (id) => id.startsWith('downed-'), 20 + i);
      }
      for (const p of [a, b, c]) {
        p.downedAt = -1;
        p.health = 1;
      }
      town.strikeDown(b, 'Killed by monsters');
      a.woundDays = 2;
      a.health = 0.5;
      a.holding = true;
      c.woundDays = 1;
      c.abilityReadyAt = town.clock() + 3;
      vi.spyOn(town, 'realmLeftBehind').mockReturnValue([b, c]);
      vi.spyOn(town, 'canLeaveRealm').mockReturnValue(new Check(true));
      ui.hoverAll(() => realmPanel.call(app, 1024, 768), (id) => id.startsWith('realm-member-'));
      for (const reason of ['The party is fighting', 'Gather the whole party at the way home', 'No party is beyond a gate']) {
        vi.mocked(town.canLeaveRealm).mockReturnValue(new Check(false, reason));
        ui.draw(() => realmPanel.call(app, 1024, 768));
      }
      const portal = new Check(true);
      portal.cost.mana = 8;
      vi.mocked(town.canLeaveRealm).mockReturnValue(portal);
      ui.draw(() => realmPanel.call(app, 1024, 768));
      app.realmCollapsed = true;
      ui.draw(() => realmPanel.call(app, 1024, 768));
      app.realmCollapsed = false;
      // Touch: the same fight at phone size.
      app.touchMode = true;
      ui.draw(() => combatOverlays(app, 390, 844));
      ui.draw(() => realmPanel.call(app, 390, 844));
      app.touchMode = false;
      // What a floor holds, for every verdict.
      vi.mocked(town.realmActive).mockReturnValue(false);
      const forecast: string[] = [];
      for (const [count, level] of [[3, 1], [5, 1], [5, 3], [5, 4], [5, 9]]) {
        town.folk = [];
        const party = Array.from({ length: count }, (_, i) =>
          resident(town, 40 + i, 'Ulf', Calling.Warrior, point(16, 16), level),
        );
        app.chosen = [];
        for (const floor of [0, 1, 2]) forecast.push(...floorForecast(app, town.realmGate, floor));
        app.chosen = party.map((p) => p.id);
        forecast.push(...floorForecast(app, town.realmGate, 0));
      }
      expect(forecast.some((line) => line.startsWith('Selected:'))).toBe(true);
      expectKorean(ui.seen, ['Askr', 'Embla', 'Geir', 'Ulf']);
      expectKorean(forecast, ['Ulf']);
    } finally {
      ui.dispose();
    }
  });
  it('the memorial, its farewells and every cause of death', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        causes = [
          'Killed by monsters',
          'Killed by the guardian',
          'Killed by a provoked giant',
          'Killed by Hrolf',
          'Killed by a wolf',
          'Died of wounds',
          'Starved',
          'Died of the cold',
          'Left behind beyond The Mist Gate',
        ];
      combatFrame(app, 0);
      causes.forEach((cause, i) => {
        const p = resident(town, i, 'Askr', [Calling.Warrior, Calling.Mage, Calling.Settler][i % 3]);
        p.kills = i % 3;
        p.days = i % 2 ? 0 : i;
        town.killResident(p, cause);
      });
      combatFrame(app, 0.1);
      for (let i = 0; i < causes.length; ++i) {
        ui.draw(() => combatOverlays(app, 1024, 768));
        app.combatHud.memorials.shift();
      }
      const fallen: Fallen[] = town.fallen.map((f, i) => ({ ...f, place: i % 2 ? 'Midgard' : 'Vanaheim' }));
      const lines = fallen.flatMap((f) => memorialLines(f));
      // The place and the day stay outside the cause, whatever pattern the cause itself has.
      for (const f of fallen) expect(translate(memorialLines(f)[1]).endsWith('.'), f.cause).toBe(true);
      // Every farewell, whichever one the hash picks.
      const farewells = new Set<string>();
      for (let id = 0; farewells.size < 4 && id < 400; ++id) farewells.add(farewell({ ...fallen[0], id }));
      expect(farewells.size).toBe(4);
      expectKorean(ui.seen, ['Askr', 'Hrolf']);
      expectKorean(lines, ['Askr', 'Hrolf']);
      expectKorean(farewells, ['Askr']);
      expectKorean(causes, ['Hrolf']);
      expectKorean(town.notices, ['Askr', 'Hrolf']);
    } finally {
      ui.dispose();
    }
  });
});

describe('the settlement in Korean', () => {
  it('the market, its refusals and its notices', () => {
    const town = settlement(),
      ui = fixture(town),
      stalls = facility(town, Structure.MarketStalls, 1),
      inspect = () => {
        ui.app.selected = stalls.id;
        ui.app.selectedDungeon = -1;
        ui.hoverAll(
          () => inspector.call(ui.app, new Rect(100, 100, 620, 560), true),
          (id) => id.startsWith('market-'),
        );
      };
    try {
      const reasons: string[] = [];
      town.stock(0).add(new Resources(100, 30));
      inspect();
      town.stock(0).gold = 0;
      inspect();
      town.stock(0).gold = 900;
      town.stock(0).wood = town.capacity(0).wood;
      for (const product of [Product.Food, Product.Wood, Product.Stone, Product.Planks, Product.CutStone])
        for (const amount of [5, -5, 500, -500, 0]) reasons.push(town.canTrade(0, product, amount).reason);
      reasons.push(town.canTrade(0, Product.Water, 5).reason);
      town.trade(0, Product.Food, 5);
      town.trade(0, Product.Wood, -5);
      // A narrow inspector stacks each row into one line.
      ui.draw(() => inspector.call(ui.app, new Rect(10, 100, 300, 560), true));
      stalls.workers = 0;
      reasons.push(town.canTrade(0, Product.Food, 1).reason);
      inspect();
      const hall = facility(town, Structure.MarketHall, 1),
        bazaar = facility(town, Structure.Bazaar, 1);
      ui.app.selected = stalls.id;
      ui.draw(() => inspector.call(ui.app, new Rect(100, 100, 620, 560), true));
      hall.workers = 0;
      ui.draw(() => inspector.call(ui.app, new Rect(100, 100, 620, 560), true));
      void bazaar;
      expectKorean(ui.seen);
      expectKorean(reasons.filter(Boolean));
      expectKorean(town.notices);
      expect(town.notices.length).toBeGreaterThanOrEqual(2);
    } finally {
      ui.dispose();
    }
  });
  it('the rites, the boons, the memorial stone, the watch, the drill and the winter', () => {
    const town = settlement(),
      ui = fixture(town),
      tower = facility(town, Structure.MageTower, 1),
      stone = facility(town, Structure.Runestone),
      watch = facility(town, Structure.Watchtower, 1),
      yard = facility(town, Structure.TrainingYard, 1),
      inspect = (building: Building | null, gate = -1) => {
        ui.app.selected = building?.id ?? -1;
        ui.app.selectedDungeon = gate;
        ui.draw(() => inspector.call(ui.app, new Rect(100, 100, 620, 560), true));
      };
    try {
      const reasons: string[] = [];
      const someone = town.makePerson(Role.Resident, Calling.Warrior, town.map().camp());
      someone.home = someone.village = 0;
      town.folk.push(someone);
      for (const mana of [0, 100]) {
        town.stock(0).mana = mana;
        inspect(tower);
        for (const rite of town.rites()) reasons.push(town.canPerformRite(rite.id, 0).reason);
      }
      someone.health = 0.5;
      for (const rite of town.rites()) town.performRite(rite.id, 0);
      inspect(tower);
      for (const rite of town.rites()) reasons.push(town.canPerformRite(rite.id, 0).reason);
      reasons.push(town.canPerformRite('none', 0).reason, town.canPerformRite('ward', 7).reason);
      tower.workers = 0;
      reasons.push(town.canPerformRite('ward', 0).reason);
      // The memorial stone, empty and with names from Midgard and beyond.
      inspect(stone);
      for (const [i, cause] of ['Killed by the guardian', 'Starved', 'Left behind beyond The Mist Gate'].entries())
        town.fallen.push({
          id: 90 + i,
          name: 'Ulf',
          past: '',
          look: 0,
          calling: Calling.Warrior,
          race: 0,
          level: 3,
          days: 4,
          kills: 2,
          cause,
          place: i ? 'Midgard' : 'Muspelheim',
          day: 12,
          at: 1200,
          position: point(),
        });
      inspect(stone);
      // The watchtower and the yard, empty and staffed, with one who has learned all the yard teaches.
      inspect(watch);
      inspect(yard);
      someone.job = watch.id;
      inspect(watch);
      const novice = town.makePerson(Role.Resident, Calling.Ranger, town.map().camp()),
        veteran = town.makePerson(Role.Resident, Calling.Mage, town.map().camp());
      veteran.level = 30;
      for (const p of [novice, veteran]) {
        p.home = p.village = 0;
        p.job = yard.id;
        town.folk.push(p);
      }
      yard.attendance = 0.5;
      inspect(yard);
      // Every boon: a gate's boon to win, then held with the others.
      const sites = town.map().dungeons();
      for (let i = sites.length; i < 8; ++i)
        sites.push({ name: 'The Mist Gate', kind: DungeonKind.Cave, origin: { x: 2 * i, y: 20 }, discovered: true });
      const gate = sites.findIndex(sealable);
      inspect(null, gate);
      town.depth = sites.map(() => sealFloors);
      inspect(null, gate);
      inspect(watch);
      const boons = Array.from({ length: Boon.Barrow + 1 }, (_, b) => [
        boonName(b),
        boonText(b),
        `${boonName(b)}: ${boonText(b)}`,
      ]).flat();
      // The winter outlook, a day away and many days away, and the autumn warning.
      const winter: string[] = [];
      for (let i = 0; i < 6; ++i) {
        const p = town.makePerson(Role.Resident, Calling.Settler, town.map().camp());
        p.home = p.village = 0;
        town.folk.push(p);
      }
      town.stock().food = 5;
      for (const day of [35, 44, 50]) {
        town.days = day;
        winter.push(winterOutlookLine(town, 0)?.text ?? '');
      }
      town.days = 35;
      town.notices = [];
      town.advance(1);
      winter.push(...town.notices.filter((n) => n.startsWith('Winter')));
      expect(winter.filter(Boolean).length).toBeGreaterThanOrEqual(3);
      const names = namesOf(town);
      expectKorean(ui.seen, names);
      expectKorean(reasons.filter(Boolean));
      expectKorean(boons);
      expectKorean(winter.filter(Boolean));
      expectKorean(town.notices, names);
    } finally {
      ui.dispose();
    }
  });
  it('callings, the fallen and engine notices of the downed', () => {
    const town = settlement(),
      a = town.makePerson(Role.Resident, Calling.Warrior, town.map().camp()),
      b = town.makePerson(Role.Resident, Calling.Cleric, town.map().camp());
    town.folk.push(a, b);
    town.strikeDown(a, 'Killed by the guardian', a.name + ' was killed by the guardian');
    town.revive(a);
    town.strikeDown(b, 'Killed by monsters');
    const refusals = [controlReason(b)];
    // Nobody kneels beside them: the one standing is away indoors.
    a.inside = true;
    a.activity = Activity.Sleeping;
    for (let i = 0; i < 700 && town.fallen.length === 0; ++i) town.advance(0.1);
    expect(town.fallen).toHaveLength(1);
    a.inside = true;
    a.activity = Activity.Expedition;
    refusals.push(controlReason(a));
    expect(refusals.every(Boolean)).toBe(true);
    expectKorean(refusals);
    expectKorean(town.notices, namesOf(town));
    expectKorean([callingName(Calling.Warrior), 'Block', 'DOWN', 'Level 4', 'Health']);
    // The calling and the build card share the word; the calling must not read as the tower.
    expect(translate(callingName(Calling.Mage))).not.toBe(translate(structureSpec(Structure.MageTower).name));
    expect(korean.translate('Valor, Plenty')).not.toBe('Valor, Plenty');
  });
});

describe('beyond a gate in Korean, from the engine', () => {
  let base: WorldMap;
  beforeAll(() => {
    base = WorldMap.generate(5);
  }, 120000);
  function expedition(level: number) {
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
    const members = [Calling.Warrior, Calling.Cleric, Calling.Mage].map((calling) => {
      const p = town.makePerson(Role.Resident, calling, monsterEntrance(town.map().dungeons()[gate]));
      town.folk.push(p);
      p.level = level;
      p.food = p.rest = p.hydration = 1;
      p.activity = Activity.Expedition;
      p.inside = true;
      return p;
    });
    town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor: 0 });
    town.advance(0.1);
    return { town, members };
  }
  it('says what a den, the guardian, the brood and the way home do, and why the way is shut', () => {
    const { town, members } = expedition(10),
      guardian = town.realmFoes().find((m) => m.id === town.realmGuardian)!,
      [first, ...others] = town.realmDens(),
      reasons: string[] = [];
    guardian.health = town.guardianVigor() * 0.4;
    town.advance(0.1);
    guardian.health = 0;
    town.stir(0.1);
    first.health = 0;
    town.combatState.slayers.set(first.id, members[0].id);
    town.stir(0.1);
    for (const den of others) den.health = 0;
    town.stir(0.1);
    expect(town.realmCleared).toBe(true);
    reasons.push(...(town.realmReward ? [town.realmReward.title, ...town.realmReward.lines] : []));
    // One goes down far away and would be left behind; then the party walks out.
    town.strikeDown(members[2], 'Killed by monsters');
    reasons.push(town.canLeaveRealm().reason);
    town.leaveRealm();
    expect(town.realmActive()).toBe(false);
    reasons.push(town.canLeaveRealm().reason);
    const names = namesOf(town);
    expectKorean(town.notices, names);
    expectKorean(reasons.filter(Boolean), names);
  }, 120000);
  it('warns who would be left behind, and says so when they are', () => {
    const { town, members } = expedition(10),
      plan = town.realmPlan()!,
      [kept, other, lost] = members;
    for (const p of [kept, other]) p.position = town.grid.nearestWalkable(plan.entry);
    town.strikeDown(lost, 'Killed by monsters');
    lost.position = town.grid.nearestWalkable(plan.chambers.at(-1)!.center);
    const warned = town.canLeaveRealm().reason;
    kept.activity = Activity.Fighting;
    const fighting = town.canLeaveRealm().reason;
    kept.activity = Activity.Idle;
    expect(warned).toContain(lost.name);
    town.leaveRealm();
    expect(town.fallen.map((f) => f.name)).toEqual([lost.name]);
    const names = namesOf(town);
    expectKorean([warned, fighting, ...town.fallen.flatMap((f) => memorialLines(f))], names);
    expectKorean(town.notices, names);
  }, 120000);
  it('says so when the last one standing falls and the gate casts the party out', () => {
    const { town, members } = expedition(22);
    for (const p of members) town.strikeDown(p, 'Killed by monsters');
    town.advance(2.2);
    expect(town.realmActive()).toBe(false);
    expectKorean(town.notices, namesOf(town));
  }, 120000);
});
