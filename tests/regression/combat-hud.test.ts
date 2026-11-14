import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Town } from '../../packages/engine/src/town';
import { Activity, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { CombatCue, MonsterRank } from '../../packages/engine/src/combat-events';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { Building, Check, Field } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Order, PointerButton, Tool } from '../../packages/engine/src/game-tools';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import { GameApplication } from '../../apps/web/src/native/game-application';
import { issueOrder } from '../../apps/web/src/native/game-commands';
import { pointerDown, pointerUp, select, toScreen } from '../../apps/web/src/native/game-input';
import { groupTabs } from '../../apps/web/src/native/control-groups';
import { keyState, KeyState } from '../../apps/web/src/native/army-keys';
import { holdPosition } from '../../apps/web/src/native/army-orders';
import { commandGroundMarks } from '../../apps/web/src/native/command-ground-marks';
import { bannerNotice, floorForecast, swarmCount, swarmLine } from '../../apps/web/src/native/swarm-hud';
import { toolInfo } from '../../apps/web/src/native/build-menu-tools';
import { SceneNode } from '../../packages/native-renderer/src/paint';
import { commandCard } from '../../apps/web/src/native/game-hud';
import { aimPreview, aimPrompt } from '../../apps/web/src/native/skill-commands';
import { realmPanel } from '../../apps/web/src/native/game-realm-panel';
import { personPanel, personPanelBounds, residentSelection, shelteredSelection } from '../../apps/web/src/native/game-unit-panel';
import {
  combatFrame,
  combatOverlays,
  farewell,
  memorialLines,
  type CombatFrameApp,
} from '../../apps/web/src/native/game-combat-hud';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import type { GameCommandApp } from '../../apps/web/src/native/game-commands';
import type { AppEvent } from '../../apps/web/src/native/application-contracts';
import { Sound } from '../../packages/native-audio/src/sound-types';

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
  tvg = await ThorVG.init({ renderer: 'sw', locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}` });
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

type TestApp = GameHudApp &
  CombatFrameApp &
  GameCommandApp & { toScreen(at: { x: number; y: number }): { x: number; y: number } };
function resident(town: Town, id: number, name: string, calling: Calling, at = point(16, 16)): Person {
  const p = new Person(id, name, Role.Resident, calling, Race.Human, 13880 + id * 977, at);
  p.home = p.village = 0;
  p.food = p.rest = p.hydration = p.health = 1;
  p.stress = 0;
  p.autoMode = false;
  town.folk.push(p);
  town.nextPerson = Math.max(town.nextPerson, id + 1);
  return p;
}
function fixture(width = 1024, height = 768) {
  const memory = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(memory as never, { width, height, enableDevicePixelRatio: false });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const metrics = Object.fromEntries(
      ['DejaVuSans', 'DejaVuSans-Bold'].map((font) => [
        font,
        parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`))),
      ]),
    ),
    context = new Context(tvg, metrics),
    town = new Town(5, 32);
  town.folk = [];
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
    labels = vi.spyOn(context, 'text'),
    rects = vi.spyOn(context, 'rect');
  canvas.add(context.scene());
  const ids = () => controls.mock.calls.map((call) => call[0]),
    text = () => labels.mock.calls.map((call) => String(call[1]));
  return {
    app,
    town,
    context,
    controls,
    rects,
    ids,
    text,
    draw(fn: () => void, time = 1) {
      controls.mockClear();
      labels.mockClear();
      rects.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), time);
      fn();
      context.end();
      canvas.update().render();
    },
    click(id: string, time = 1) {
      const found = controls.mock.calls.find((call) => call[0] === id);
      if (!found) throw new Error(`Missing control ${id}: ${ids().join(', ')}`);
      const r = found[1];
      context.pointerMove(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
      void time;
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
/** Sends one key through the real application dispatch with the given game behind it. */
function press(game: object, text: string, shift = false, control = false, type: 'KeyDown' | 'KeyUp' = 'KeyDown') {
  const application = {
    game,
    script: { ready: () => false },
    scriptContext: { focused: () => false, textFocused: () => false },
    editorAttached: false,
    keys: new Set<string>(),
    dirty: false,
    authoringTool: () => false,
  };
  GameApplication.prototype.event.call(
    application as unknown as GameApplication,
    { type, text, control, meta: false, alt: false, shift } as AppEvent,
  );
}
const release = (game: object, text: string) => press(game, text, false, false, 'KeyUp');
function keyGame(app: TestApp) {
  return Object.assign(app, {
    buildings: null,
    atlas: null,
    editor: null,
    selectedPeople: () => app.chosen,
    setPan: vi.fn(),
    rotate: vi.fn(),
    prepare: vi.fn(),
    stopSelected: vi.fn(),
    openUnitBuild: vi.fn(),
    cycleSpeed: vi.fn(),
    cancel: vi.fn(),
  });
}
function realm(town: Town, party: Person[], guardian?: Monster) {
  town.realmGate = 0;
  vi.spyOn(town, 'realmActive').mockReturnValue(true);
  vi.spyOn(town, 'realmPlan').mockReturnValue({ entry: point(14, 14) } as never);
  vi.spyOn(town, 'realmParty').mockReturnValue(party);
  vi.spyOn(town, 'realmFoes').mockReturnValue(guardian ? [guardian] : []);
  vi.spyOn(town, 'inRealm').mockReturnValue(true);
  if (guardian) {
    town.beasts.push(guardian);
    town.realmGuardian = guardian.id;
  }
}
function guardian(health = 60): Monster {
  const g = new Monster(900, -1, point(19, 16));
  g.rank = MonsterRank.Guardian;
  g.vigor = 100;
  g.health = health;
  return g;
}

describe('skills in the player hands', () => {
  it('Q quick-casts the first skills: a ground skill waits for the release and lands under the cursor', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        warrior = resident(town, 0, 'Askr', Calling.Warrior),
        mage = resident(town, 1, 'Embla', Calling.Mage, point(17, 16)),
        settler = resident(town, 2, 'Geir', Calling.Settler);
      const use = vi.spyOn(town, 'useSkill').mockReturnValue(2),
        game = keyGame(app);
      app.chosen = [warrior.id, mage.id];
      app.mouse = point(400, 300);
      app.cursor = point(18.5, 15);
      press(game, 'q');
      // Held: nothing fires yet, the rune's radius shows under the cursor.
      expect(use).not.toHaveBeenCalled();
      expect(aimPreview(app)).toEqual({ at: point(18.5, 15), rings: [{ radius: 2, inReach: true }] });
      press(game, 'q');
      expect(use).not.toHaveBeenCalled();
      release(game, 'q');
      expect(use).toHaveBeenCalledWith([warrior.id, mage.id], 0, point(18.5, 15));
      expect(app.army.aim).toBeNull();
      // Released over the HUD there is no ground point; the engine picks the thickest pack.
      press(game, 'q');
      vi.spyOn(app.context, 'controlAt').mockReturnValue(true);
      release(game, 'q');
      expect(use).toHaveBeenLastCalledWith([warrior.id, mage.id], 0, undefined);
      vi.mocked(app.context.controlAt).mockRestore();
      // A selection without a ground skill fires at the press.
      app.chosen = [warrior.id];
      press(game, 'q');
      expect(use).toHaveBeenLastCalledWith([warrior.id], 0, point(18.5, 15));
      app.chosen = [settler.id];
      press(game, 'q');
      expect(use).toHaveBeenCalledTimes(3);
      expect(app.status).toBe('No one selected has a skill');
      expect(app.selectTool).not.toHaveBeenCalled();
    } finally {
      ui.dispose();
    }
  });
  it('W fires second skills, and says why nothing fired: locked, on cooldown, or no target in reach', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        warrior = resident(town, 0, 'Askr', Calling.Warrior),
        game = keyGame(app);
      app.chosen = [warrior.id];
      warrior.abilityReadyAt = town.clock() + 6.2;
      const use = vi.spyOn(town, 'useSkill');
      press(game, 'q');
      expect(use).not.toHaveBeenCalled();
      expect(app.status).toBe('Challenge is ready in 7 s');
      warrior.abilityReadyAt = -1;
      press(game, 'q');
      expect(use).toHaveBeenCalledOnce();
      expect(app.status).toBe('Challenge: no monster in reach');
      press(game, 'w');
      expect(app.status).toBe('Whirl comes at level 4');
      warrior.level = 4;
      press(game, 'w');
      expect(use).toHaveBeenLastCalledWith([warrior.id], 1, undefined);
      expect(app.status).toBe('Whirl: no monster in reach');
    } finally {
      ui.dispose();
    }
  });
  it('shows both skills large with descriptions for one resident, the locked one with its level, and an auto toggle each', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        cleric = resident(town, 0, 'Sigrun', Calling.Cleric);
      app.chosen = [cleric.id];
      const plain = personPanelBounds.call(app, 1024, 768, true);
      ui.draw(() => personPanel.call(app, plain));
      expect(ui.ids()).toEqual(
        expect.arrayContaining(['ability-mend', 'skill-auto-mend', 'ability-sanctuary', 'skill-auto-sanctuary', 'unit/card-hold']),
      );
      expect(ui.text()).toEqual(expect.arrayContaining(['Q  Mend', 'Ready', 'Auto on', 'W  Sanctuary', 'Lv 4']));
      expect(ui.text().some((line) => line.startsWith('Heals the most hurt ally'))).toBe(true);
      const auto = vi.spyOn(town, 'setSkillAuto');
      ui.click('skill-auto-mend');
      expect(auto).toHaveBeenCalledWith([cleric.id], 0, false);
      // Touch: a full-size target, no key label.
      app.touchMode = true;
      ui.draw(() => personPanel.call(app, personPanelBounds.call(app, 1024, 768, true)));
      const entry = ui.controls.mock.calls.find((call) => call[0] === 'ability-mend')![1];
      expect(entry.h).toBeGreaterThanOrEqual(44);
      expect(ui.text()).toContain('Mend');
    } finally {
      ui.dispose();
    }
  });
  it('shows one calling of a mixed selection at a time, with calling tabs that Tab cycles', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Ranger),
        b = resident(town, 1, 'Embla', Calling.Ranger),
        c = resident(town, 2, 'Sigrun', Calling.Cleric),
        game = keyGame(app);
      b.abilityReadyAt = town.clock() + 5;
      app.chosen = [a.id, b.id, c.id];
      ui.draw(() => personPanel.call(app, personPanelBounds.call(app, 1024, 768, true)));
      expect(ui.ids()).toEqual(
        expect.arrayContaining([`skill-calling-${Calling.Ranger}`, `skill-calling-${Calling.Cleric}`, 'ability-aimed', 'ability-volley']),
      );
      expect(ui.ids()).not.toContain('ability-mend');
      expect(ui.text()).toEqual(expect.arrayContaining(['Tab', 'Ranger ×2', 'Q  Aimed Shot', '1/2', 'Lv 4']));
      const use = vi.spyOn(town, 'useSkill').mockReturnValue(1);
      ui.click('ability-aimed');
      expect(use).toHaveBeenCalledWith([a.id], 0, undefined);
      press(game, 'tab');
      expect(game.cycleSpeed).not.toHaveBeenCalled();
      ui.draw(() => personPanel.call(app, personPanelBounds.call(app, 1024, 768, true)));
      expect(ui.ids()).toContain('ability-mend');
      ui.click(`skill-calling-${Calling.Ranger}`);
      ui.draw(() => personPanel.call(app, personPanelBounds.call(app, 1024, 768, true)));
      expect(ui.ids()).toContain('ability-aimed');
      // One calling: Tab keeps its game meaning.
      app.chosen = [c.id];
      press(game, 'tab');
      expect(game.cycleSpeed).toHaveBeenCalledOnce();
    } finally {
      ui.dispose();
    }
  });
  it('a ground skill button waits for a click on the ground; right-click puts it down', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        mage = resident(town, 0, 'Embla', Calling.Mage);
      app.chosen = [mage.id];
      const use = vi.spyOn(town, 'useSkill').mockReturnValue(1),
        input = Object.assign(app, {
          pointerMove: (x: number, y: number) => {
            app.mouse = point(x, y);
            app.cursor = point(18, 17);
          },
          dismissBuildDrawer: vi.fn(),
          cancelStroke: vi.fn(),
          issueOrder: vi.fn(),
        });
      ui.draw(() => personPanel.call(app, personPanelBounds.call(app, 1024, 768, true)));
      ui.click('ability-burst');
      expect(app.army.aim).toEqual({ slot: 0, ids: [mage.id], via: 'pointer' });
      expect(aimPrompt(app)).toBe('Rune Burst: click the ground; right-click cancels');
      pointerDown.call(input as never, 500, 200, PointerButton.Secondary);
      expect(app.army.aim).toBeNull();
      ui.click('ability-burst');
      pointerDown.call(input as never, 500, 200, PointerButton.Primary);
      expect(app.boxFrom).toBeNull();
      pointerUp.call(input as never, 500, 200, PointerButton.Primary);
      expect(use).toHaveBeenCalledWith([mage.id], 0, point(18, 17));
      expect(input.issueOrder).not.toHaveBeenCalled();
    } finally {
      ui.dispose();
    }
  });
});

describe('commanding a few residents', () => {
  it('Ctrl+digit makes a group, Shift+digit adds to it, the digit selects it and twice looks at it', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior, point(20, 20)),
        b = resident(town, 1, 'Embla', Calling.Mage, point(22, 20)),
        c = resident(town, 2, 'Sigrun', Calling.Cleric, point(30, 30)),
        game = keyGame(app);
      app.chosen = [a.id, b.id];
      press(game, '1', false, true);
      app.chosen = [c.id];
      press(game, '2', false, true);
      // Shift turns the digit row into symbols; the digit is what was pressed.
      press(game, '!', true);
      expect([...app.army.groups]).toEqual([
        [1, [a.id, b.id, c.id]],
        [2, [c.id]],
      ]);
      app.chosen = [];
      const before = { x: app.camera.x, y: app.camera.y };
      press(game, '2');
      expect(app.chosen).toEqual([c.id]);
      expect(app.camera.x).toBe(before.x);
      press(game, '2');
      expect(app.camera.x).toBe(project(30, 30).x);
      expect(app.camera.y).toBe(project(30, 30).y);
      // A placement tool does not stop a group from being called up.
      app.tool = Tool.Farm;
      press(game, '1');
      expect(app.chosen).toEqual([a.id, b.id, c.id]);
      expect(game.selectTool).not.toHaveBeenCalled();
      // The dead leave their groups; an empty group says how to make it.
      town.killResident(c, 'Killed by monsters');
      press(game, '2');
      expect(app.status).toBe('Group 2 is empty: select residents and press Ctrl+2');
      expect(app.army.groups.get(1)).toEqual([a.id, b.id]);
    } finally {
      ui.dispose();
    }
  });
  it('shows the groups as tabs that select, look on a second click, and + makes one by hand', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior, point(20, 20)),
        b = resident(town, 1, 'Embla', Calling.Mage, point(22, 20));
      app.dockBounds = new Rect(262, 600, 500, 156);
      app.chosen = [a.id, b.id];
      ui.draw(() => groupTabs(app, 768));
      expect(ui.ids()).toEqual(['group-new']);
      expect(ui.text()).toContain('+ 1');
      ui.click('group-new');
      expect(app.army.groups.get(1)).toEqual([a.id, b.id]);
      app.chosen = [];
      b.health = 0.2;
      ui.draw(() => groupTabs(app, 768));
      expect(ui.ids()).toEqual(['group-1']);
      expect(ui.text()).toEqual(expect.arrayContaining(['1', '·2']));
      const tab = ui.controls.mock.calls.find((call) => call[0] === 'group-1')![1];
      expect(tab.x + tab.w).toBeLessThan(app.dockBounds.x);
      ui.click('group-1');
      expect(app.chosen).toEqual([a.id, b.id]);
      ui.click('group-1');
      expect(app.camera.x).toBe(project(21, 20).x);
      // Touch: the tabs sit above the panel, at full finger size.
      app.touchMode = true;
      ui.draw(() => groupTabs(app, 768));
      const touch = ui.controls.mock.calls.find((call) => call[0] === 'group-1')![1];
      expect(touch.h).toBeGreaterThanOrEqual(44);
      expect(touch.y + touch.h).toBeLessThanOrEqual(app.dockBounds.y);
    } finally {
      ui.dispose();
    }
  });
  it('one key rule: with residents selected and no tool the card letters command them; other letters pick buildings', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior),
        game = keyGame(app),
        hold = vi.spyOn(town, 'orderHold');
      expect(keyState(app)).toBe(KeyState.Free);
      press(game, 'm');
      expect(game.selectTool).toHaveBeenLastCalledWith(Tool.Market, false);
      press(game, 'h');
      expect(game.selectTool).toHaveBeenLastCalledWith(Tool.Shrine, false);
      press(game, 'd');
      expect(game.selectTool).toHaveBeenLastCalledWith(Tool.Road, false);
      expect(hold).not.toHaveBeenCalled();
      app.chosen = [a.id];
      expect(keyState(app)).toBe(KeyState.Command);
      vi.mocked(game.selectTool).mockClear();
      press(game, 'm');
      expect(game.prepare).toHaveBeenLastCalledWith(Order.Move);
      press(game, 'a');
      expect(game.prepare).toHaveBeenLastCalledWith(Order.Attack);
      press(game, 'e');
      expect(game.prepare).toHaveBeenLastCalledWith(Order.Work);
      press(game, 's');
      expect(game.stopSelected).toHaveBeenCalledOnce();
      press(game, 'b');
      expect(game.openUnitBuild).toHaveBeenCalledOnce();
      press(game, 'h');
      expect(hold).toHaveBeenCalledWith([a.id]);
      expect(a.holding).toBe(true);
      // Other building letters still pick a building, for the selected residents to raise.
      expect(game.selectTool).not.toHaveBeenCalled();
      press(game, 't');
      expect(game.selectTool).toHaveBeenLastCalledWith(Tool.Tent, true);
      press(game, 'x');
      expect(game.selectTool).toHaveBeenCalledWith(Tool.Demolish, true);
      // A tool in hand: building keys again, with the selected residents as the crew.
      app.tool = Tool.Farm;
      expect(keyState(app)).toBe(KeyState.Placement);
      press(game, 'm');
      expect(game.selectTool).toHaveBeenLastCalledWith(Tool.Market, true);
      // Every card label matches its key.
      expect(['Road', 'Fields', 'Tent', 'Farm', 'Wood', 'Quarry', 'Market', 'Tavern', 'Inn', 'Guild'].map(
        (label) => toolInfo.find((tool) => tool.label === label)!.key,
      )).toEqual(['D', 'E', 'T', 'F', 'L', 'Z', 'M', 'Y', 'I', 'U']);
      expect(toolInfo.some((tool) => /^[0-9]$/.test(tool.key))).toBe(false);
    } finally {
      ui.dispose();
    }
  });
  it('F2 and backquote select the fighters at hand; a double click takes a whole calling on screen', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior, point(16, 16)),
        b = resident(town, 1, 'Embla', Calling.Warrior, point(17, 16)),
        c = resident(town, 2, 'Sigrun', Calling.Cleric, point(16, 17)),
        d = resident(town, 3, 'Geir', Calling.Settler, point(17, 17)),
        far = resident(town, 4, 'Hrafn', Calling.Warrior, point(160, 160)),
        game = keyGame(app);
      b.activity = Activity.Felling;
      far.activity = Activity.Idle;
      press(game, 'f2');
      expect(app.chosen).toEqual([a.id, c.id, far.id]);
      app.chosen = [];
      press(game, '`');
      expect(app.chosen).toEqual([a.id, c.id, far.id]);
      void d;
      // Double click: the first picks the resident, the second every warrior on screen.
      const input = Object.assign(app, { selectPeople: (ids: number[]) => (app.chosen = [...ids]) });
      app.mouse = point(400, 300);
      app.hoveredWorldTarget = { screen: app.mouse, hit: { kind: 'person', id: a.id } as never };
      vi.spyOn(app.context, 'time').mockReturnValue(5);
      select.call(input as never);
      expect(app.chosen).toEqual([a.id]);
      app.hoveredWorldTarget = { screen: app.mouse, hit: { kind: 'person', id: a.id } as never };
      vi.mocked(app.context.time).mockReturnValue(5.2);
      select.call(input as never);
      expect(app.chosen).toEqual([a.id, b.id]);
    } finally {
      ui.dispose();
    }
  });
  it('marks a holding resident in the panel and lays where the moving group will stand on the ground', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior, point(16, 16)),
        b = resident(town, 1, 'Embla', Calling.Mage, point(17, 16));
      app.chosen = [a.id];
      holdPosition(app);
      ui.draw(() => personPanel.call(app, personPanelBounds.call(app, 1024, 768, true)));
      expect(ui.text()).toContain('Holding position: strikes what comes into reach, never chases');
      const hold = ui.controls.mock.calls.find((call) => call[0] === 'unit/card-hold')!;
      expect(hold).toBeDefined();
      const layer = new SceneNode();
      app.renderer = Object.assign(app.renderer, { combatGround: layer });
      app.chosen = [a.id, b.id];
      town.orderAttackMove([a.id, b.id], point(22, 16));
      commandGroundMarks(app);
      expect(layer.children).toHaveLength(1);
      const marks = layer.children[0] as SceneNode,
        slots = marks.children.slice(4).filter((node) => node.alpha > 0);
      // A dark disc and a brush rim for each of the two.
      expect(slots).toHaveLength(4);
      // Ground marks lie on the combat ground layer, under the selection rings and every figure.
      a.path = b.path = [];
      a.ordered = b.ordered = false;
      commandGroundMarks(app);
      expect(marks.alpha).toBe(0);
      expect(layer.children).toHaveLength(1);
    } finally {
      ui.dispose();
    }
  });
});

describe('reading a swarm', () => {
  it('counts dens and monsters, and turns a den falling and the brood breaking into banners instead of notices', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior),
        dens = [new Monster(800, -1, point(30, 30)), new Monster(801, -1, point(34, 30))],
        swarm = Array.from({ length: 5 }, (_, i) => new Monster(810 + i, -1, point(31 + i * 0.5, 31)));
      for (const den of dens) den.rank = MonsterRank.Den;
      for (const m of swarm) m.rank = MonsterRank.Swarmer;
      realm(town, [a]);
      vi.spyOn(town, 'realmDens').mockImplementation(() => dens.filter((d) => d.health > 0));
      vi.spyOn(town, 'realmFoes').mockImplementation(() => [...dens, ...swarm].filter((m) => m.health > 0));
      expect(swarmLine(swarmCount(app)!)).toBe('Dens 2 of 2  ·  Monsters 5');
      combatFrame(app, 0);
      dens[0].health = 0;
      town.emit(CombatCue.DenDestroyed, dens[0].position, { person: a.id, creature: dens[0].id });
      combatFrame(app, 1);
      expect(swarmLine(swarmCount(app)!)).toBe('Dens 1 of 2  ·  Monsters 5');
      expect(app.paused).toBe(false);
      ui.draw(() => combatOverlays(app, 1024, 768), 1);
      expect(ui.text()).toEqual(expect.arrayContaining(['A den is destroyed', 'Askr struck the last blow. 1 of 2 still breeds.']));
      town.emit(CombatCue.BroodBreak, dens[1].position, { amount: 23 });
      combatFrame(app, 1.5);
      ui.draw(() => combatOverlays(app, 1024, 768), 1.5);
      expect(ui.text()).toEqual(expect.arrayContaining(['The brood breaks', '23 monsters die with their dens. The floor is clear.']));
      expect(bannerNotice('A den is destroyed (1 left)')).toBe(true);
      expect(bannerNotice('What was left of the brood dies with it (23)')).toBe(true);
      expect(bannerNotice('The guardian has fallen; 1 den still breeds')).toBe(false);
      ui.draw(() => combatOverlays(app, 1024, 768), 9);
      expect(ui.text()).not.toContain('The brood breaks');
    } finally {
      ui.dispose();
    }
  });
  it('warns of a raid wave with its size and direction, and points an edge arrow at it while it is off screen', () => {
    const ui = fixture();
    try {
      const { app, town } = ui;
      resident(town, 0, 'Askr', Calling.Warrior);
      combatFrame(app, 0);
      town.emit(CombatCue.Wave, point(16, 90), { amount: 12 });
      combatFrame(app, 0.1);
      vi.spyOn(town, 'raiding').mockReturnValue(true);
      ui.draw(() => combatOverlays(app, 1024, 768));
      const warning = ui.text().find((line) => line.startsWith('A raid wave of 12 comes from the'));
      expect(warning).toBeDefined();
      expect(ui.ids()).toContain('wave-arrow');
      expect(ui.text()).toContain('12');
      ui.click('wave-arrow');
      expect(app.camera.x).toBe(project(16, 90).x);
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.ids()).not.toContain('wave-arrow');
      expect(app.paused).toBe(false);
    } finally {
      ui.dispose();
    }
  });
  it('says what a floor holds and the level it wants before a party is sent', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        party = [0, 1, 2].map((i) => resident(town, i, 'R' + i, Calling.Warrior));
      for (const p of party) p.level = 3;
      vi.spyOn(town, 'camp').mockReturnValue(null);
      const lines = floorForecast(app, 0, 0);
      expect(lines).toEqual([
        'Floor 1 holds a swarm and dens that keep breeding more until destroyed.',
        'Recommended: a small party at level 4, using their skills.',
        'Your fighters: 3 at level 3 on average, too few to stand against a swarm.',
      ]);
      app.chosen = party.map((p) => p.id);
      expect(floorForecast(app, 0, 2)[0]).toBe('Floor 3 holds a great swarm and dens that keep breeding more until destroyed.');
      expect(floorForecast(app, 0, 0)[2]).toBe('Selected: 3 at level 3 on average, too few to stand against a swarm.');
    } finally {
      ui.dispose();
    }
  });
});

describe('control beyond a gate', () => {
  it('R recalls the party unless a building is being placed; backquote selects and centres it', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior, point(20, 20)),
        b = resident(town, 1, 'Embla', Calling.Mage, point(22, 20)),
        game = keyGame(app);
      press(game, 'r');
      expect(game.rotate).toHaveBeenCalledOnce();
      realm(town, [a, b]);
      const recall = vi.spyOn(town, 'recallParty').mockReturnValue(true);
      press(game, 'r');
      expect(recall).toHaveBeenCalledOnce();
      expect(game.rotate).toHaveBeenCalledOnce();
      expect(app.camera.x).toBe(project(14, 14).x);
      app.tool = Tool.Farm;
      press(game, 'r');
      expect(recall).toHaveBeenCalledOnce();
      expect(game.rotate).toHaveBeenCalledTimes(2);
      app.tool = Tool.Select;
      press(game, '`');
      expect(app.selectPeople).toHaveBeenLastCalledWith([a.id, b.id]);
      expect(app.camera.x).toBeCloseTo(project(21, 20).x, 3);
      expect(app.camera.y).toBeCloseTo(project(21, 20).y, 3);
    } finally {
      ui.dispose();
    }
  });
  it('right-click on a downed ally sends the selection to revive them, and says why when refused', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        helper = resident(town, 0, 'Askr', Calling.Warrior, point(14, 16)),
        hurt = resident(town, 1, 'Embla', Calling.Mage, point(18, 16));
      town.strikeDown(hurt, 'Killed by monsters');
      expect(town.downedResidents()).toEqual([hurt]);
      app.chosen = [helper.id];
      app.mouse = app.toScreen(hurt.position);
      app.cursor = { ...hurt.position };
      const tend = vi.spyOn(town, 'orderTend');
      issueOrder.call(app, Order.Work);
      expect(tend).toHaveBeenCalledWith([helper.id], hurt.id);
      expect(helper.task).toBe(Activity.Tending);
      tend.mockReturnValueOnce(false);
      vi.spyOn(town, 'inRealm').mockImplementation((p) => p === hurt.position);
      issueOrder.call(app, Order.Work);
      expect(app.status).toBe('Embla lies on the other side of the gate');
    } finally {
      ui.dispose();
    }
  });
  it('right-click on a field puts the selection to work at the farm that tends it, if it has room', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Settler, point(14, 16)),
        farm = new Building(40, Structure.Farm, point(16, 12), 0, 0);
      town.placed.push(farm);
      town.farmland.push(new Field(7, [point(17.5, 13), point(21.5, 13), point(21.5, 16), point(17.5, 16)], 0));
      app.chosen = [a.id];
      app.mouse = point(300, 300);
      app.cursor = point(19, 14.5);
      app.hoveredWorldTarget = { screen: app.mouse, hit: { kind: 'field', id: 7 } as never };
      const assign = vi.spyOn(town, 'assignJob');
      issueOrder.call(app, Order.Work);
      expect(assign).toHaveBeenCalledWith([a.id], farm.id);
      expect(a.job).toBe(farm.id);
      assign.mockReturnValueOnce(false);
      issueOrder.call(app, Order.Work);
      expect(app.status).toBe('The farm by this field has no room for more workers');
      town.placed = town.placed.filter((b) => b !== farm);
      issueOrder.call(app, Order.Work);
      expect(app.status).toBe('No farm stands close enough to work this field');
    } finally {
      ui.dispose();
    }
  });
  it('makes each party member a frame that selects, centres on a second click and shows who would be left behind', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior, point(20, 20)),
        b = resident(town, 1, 'Embla', Calling.Mage, point(24, 22));
      a.woundDays = 2;
      a.health = 0.5;
      town.strikeDown(b, 'Killed by monsters');
      realm(town, [a, b]);
      vi.spyOn(town, 'realmLeftBehind').mockReturnValue([b]);
      vi.spyOn(town, 'canLeaveRealm').mockReturnValue(new Check(true));
      ui.draw(() => realmPanel.call(app, 1024, 768));
      expect(ui.ids()).toEqual(expect.arrayContaining([`realm-member-${a.id}`, `realm-member-${b.id}`]));
      expect(ui.text()).toContain('Go home leaves behind: Embla');
      expect(ui.text()).toContain('45 s');
      expect(ui.text()).toContain('Recall party (R)');
      ui.click(`realm-member-${b.id}`);
      expect(app.selectPeople).toHaveBeenLastCalledWith([b.id]);
      const before = app.camera.x;
      ui.click(`realm-member-${b.id}`);
      expect(app.camera.x).not.toBe(before);
      expect(app.camera.x).toBe(project(24, 22).x);
      vi.spyOn(town, 'canLeaveRealm').mockReturnValue(new Check(false, 'Gather the whole party at the way home'));
      ui.draw(() => realmPanel.call(app, 1024, 768));
      expect(ui.text()).toContain('Gather the whole party at the way home');
      expect(ui.controls.mock.calls.find((call) => call[0] === 'realm-leave')![3]).toBe(false);
    } finally {
      ui.dispose();
    }
  });
});

describe('auto-pause, the downed moment and the death moment', () => {
  it('pauses once when a resident goes down, never twice and never over the player pause', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior),
        b = resident(town, 1, 'Embla', Calling.Mage);
      combatFrame(app, 0);
      town.strikeDown(a, 'Killed by monsters');
      combatFrame(app, 0.1);
      expect(app.paused).toBe(true);
      expect(app.combatHud.autoPause?.title).toBe('Askr is down');
      combatFrame(app, 0.2);
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.ids()).toEqual(expect.arrayContaining(['auto-pause', 'auto-pause-look', 'auto-pause-resume', `downed-${a.id}`]));
      expect(ui.text()).toContain('Paused. You can give orders while paused.');
      ui.click('auto-pause-resume');
      expect(app.paused).toBe(false);
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.ids()).not.toContain('auto-pause');
      combatFrame(app, 0.3);
      expect(app.paused).toBe(false);
      // The player paused first: the next fall neither unpauses nor stacks a banner.
      app.paused = true;
      town.strikeDown(b, 'Killed by monsters');
      combatFrame(app, 0.4);
      expect(app.paused).toBe(true);
      expect(app.combatHud.autoPause).toBeNull();
      // Space resumes and the banner goes with the pause.
      app.paused = false;
      const c = resident(town, 2, 'Geir', Calling.Ranger);
      town.strikeDown(c, 'Killed by monsters');
      combatFrame(app, 0.5);
      expect(app.combatHud.autoPause?.title).toBe('Geir is down');
      press(keyGame(app), 'space');
      expect(app.paused).toBe(false);
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(app.combatHud.autoPause).toBeNull();
    } finally {
      ui.dispose();
    }
  });
  it('pauses once when the guardian is first engaged', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior),
        g = guardian();
      realm(town, [a], g);
      combatFrame(app, 0);
      expect(app.paused).toBe(false);
      g.angry = true;
      combatFrame(app, 0.1);
      expect(app.paused).toBe(true);
      expect(app.combatHud.autoPause?.title).toMatch(/^The guardian of .+ is roused$/);
      app.paused = false;
      combatFrame(app, 0.2);
      expect(app.paused).toBe(false);
    } finally {
      ui.dispose();
    }
  });
  it('keeps a draining alert for the downed that jumps to them and selects the nearest ally', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        far = resident(town, 0, 'Askr', Calling.Warrior, point(8, 8)),
        near = resident(town, 1, 'Geir', Calling.Warrior, point(19, 16)),
        hurt = resident(town, 2, 'Embla', Calling.Mage, point(18, 16));
      void far;
      town.strikeDown(hurt, 'Killed by monsters');
      app.paused = true;
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.text()).toEqual(expect.arrayContaining(['Embla', '45 s']));
      ui.click(`downed-${hurt.id}`);
      expect(app.chosen).toEqual([near.id]);
      expect(app.camera.x).toBe(project(18, 16).x);
    } finally {
      ui.dispose();
    }
  });
  it('raises a memorial for each death, queued until acknowledged', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior),
        b = resident(town, 1, 'Embla', Calling.Mage);
      a.level = 12;
      a.kills = 7;
      a.days = 30;
      combatFrame(app, 0);
      town.killResident(a, 'Killed by the guardian');
      town.killResident(b, 'Starved');
      combatFrame(app, 0.1);
      expect(app.combatHud.memorials.map((f) => f.name)).toEqual(['Askr', 'Embla']);
      ui.draw(() => combatOverlays(app, 1024, 768));
      const lines = memorialLines(town.fallen[0]);
      expect(lines).toEqual([
        'Warrior  ·  Level 12',
        `Killed by the guardian in Midgard, on day ${town.days + 1}.`,
        '7 kills  ·  30 days in the settlement',
        farewell(town.fallen[0]),
      ]);
      expect(ui.text()).toEqual(expect.arrayContaining(['Askr has died', '1 more to remember']));
      const banner = ui.controls.mock.calls.find((call) => call[0] === 'memorial')![1];
      expect(banner.y).toBeLessThan(200);
      expect(banner.h).toBeLessThan(160);
      ui.click('memorial-close');
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.text()).toContain('Embla has died');
      expect(ui.text()).not.toContain('1 more to remember');
      ui.click('memorial-close');
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.ids()).not.toContain('memorial');
    } finally {
      ui.dispose();
    }
  });
  it('shows the guardian bar with its health, the half notch and the wind-up', () => {
    const ui = fixture();
    try {
      const { app, town } = ui,
        a = resident(town, 0, 'Askr', Calling.Warrior),
        g = guardian(60);
      g.angry = true;
      realm(town, [a], g);
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.ids()).toContain('guardian-bar');
      expect(ui.text()).toContain('60%');
      const bar = ui.controls.mock.calls.find((call) => call[0] === 'guardian-bar')![1],
        notch = ui.rects.mock.calls.find((call) => call[0].w === 2 && call[0].h > 9)![0];
      expect(notch.x + 1).toBeCloseTo(bar.x + bar.w / 2, 0);
      g.health = 40;
      g.windupUntil = town.clock() + 1.2;
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.text()).toContain('Enraged');
      expect(ui.text()).toContain('Winding up a slam: move away! (1.2 s)');
      g.windupUntil = -1;
      g.angry = false;
      app.renderer.visible = () => false;
      ui.draw(() => combatOverlays(app, 1024, 768));
      expect(ui.ids()).not.toContain('guardian-bar');
    } finally {
      ui.dispose();
    }
  });
});
