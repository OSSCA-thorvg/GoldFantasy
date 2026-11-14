// The expedition window is the one way a party is sent through a gate: every entry point opens it, it pauses the
// settlement, and the party is chosen there by click or tap before it sets out.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Town } from '../../packages/engine/src/town';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Camera, distance, point, project } from '../../packages/engine/src/geometry';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { sealFloors, sealable } from '../../packages/engine/src/gate-seals';
import { lairOf, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { Order, PointerButton } from '../../packages/engine/src/game-tools';
import { setLocale, defaultLocale, translate, hasHangul } from '../../packages/localization/src/index';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import { issueOrder, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { pointerUp, select } from '../../apps/web/src/native/game-input';
import {
  closeExpedition,
  handleExpeditionEvent,
  openExpedition,
  renderExpedition,
  setOutProblem,
  type ExpeditionApp,
} from '../../apps/web/src/native/expedition-window';
import { jumpToGate } from '../../apps/web/src/native/game-progress-hud';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
import type { AppEvent } from '../../apps/web/src/native/application-contracts';
import { presentedHit } from './fixtures/presented-hit';

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
let base: Town;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
  const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
  tvg = await ThorVG.init({ renderer: 'sw', locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}` });
  base = new Town(5, 176, false);
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});

type TestApp = ExpeditionApp & GameHudApp & GameCommandApp;
/** A founded settlement on the designed map with the nearest gate found, and residents by calling and level. */
function settlement(people: [Calling, number][]) {
  const town = new Town(base.map(), 176, false),
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
  const near = monsterEntrance(town.map().dungeons()[gate]),
    folk = people.map(([calling, level], i) => {
      const p = new Person(i, `Hero${'ABCDEFGH'[i]}`, Role.Resident, calling, Race.Human, 13880 + i * 977, town.grid.nearestWalkable({ x: near.x + 2 + (i % 3), y: near.y + 2 + Math.floor(i / 3) }));
      p.home = p.village = 0;
      p.level = level;
      p.food = p.rest = p.hydration = p.health = 1;
      p.stress = 0;
      town.folk.push(p);
      town.nextPerson = i + 1;
      return p;
    });
  town.notices = [];
  return { town, gate, folk };
}
function fixture(town: Town, width = 1024, height = 768, touch = false) {
  const canvas = new tvg.Canvas(new MemoryCanvas(width, height) as never, { width, height, enableDevicePixelRatio: false });
  for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
    tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  const metrics = Object.fromEntries(
      ['DejaVuSans', 'DejaVuSans-Bold'].map((font) => [font, parseFontMetrics(new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)))]),
    ),
    context = new Context(tvg, metrics),
    renderer = { visible: () => true, invalidatePresentation: vi.fn(), pick: () => null as unknown },
    app = new GameAppState(town, renderer as never, context) as TestApp;
  app.viewWidth = width;
  app.viewHeight = height;
  app.touchMode = touch;
  const focus = project(town.map().camp().x, town.map().camp().y);
  app.camera = new Camera(focus.x, focus.y, 1.4);
  app.selectPeople = vi.fn((ids: readonly number[]) => {
    app.chosen = [...ids];
  });
  app.selectTool = vi.fn();
  app.cue = vi.fn();
  app.pointerMove = vi.fn();
  app.select = select.bind(app);
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  const control = (id: string) => controls.mock.calls.find((call) => call[0] === id);
  return {
    app,
    context,
    renderer,
    control,
    ids: () => controls.mock.calls.map((call) => call[0]),
    words: () => labels.mock.calls.map((call) => String(call[1])),
    draw() {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), 1);
      renderExpedition.call(app, width, height);
      context.end();
      canvas.update().render();
    },
    click(id: string) {
      const found = control(id);
      if (!found) throw new Error(`Missing control ${id}`);
      const r = found[1];
      const pointerType = touch ? 'touch' : 'mouse';
      handleExpeditionEvent.call(app, { type: 'PointerDown', x: r.x + r.w / 2, y: r.y + r.h / 2, button: 1, pointerType } as AppEvent);
      handleExpeditionEvent.call(app, { type: 'PointerUp', x: r.x + r.w / 2, y: r.y + r.h / 2, button: 1, pointerType } as AppEvent);
    },
    enabled: (id: string) => control(id)?.[3] !== false,
    dispose() {
      app.combatHud.dispose();
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
}
const key = (text: string, k = 0): AppEvent => ({ type: 'KeyDown', text, key: k } as AppEvent);

describe('the expedition window', () => {
  it('opens paused with the selection chosen, picks and toggles a party, and weighs it as it changes', () => {
    const { town, gate, folk } = settlement([
      [Calling.Warrior, 4],
      [Calling.Ranger, 4],
      [Calling.Mage, 4],
      [Calling.Cleric, 4],
      [Calling.Settler, 2],
    ]);
    const ui = fixture(town);
    try {
      ui.app.army.town = town;
      ui.app.army.groups.set(2, [folk[0].id, folk[1].id]);
      expect(openExpedition(ui.app, gate, [folk[0].id])).toBe(true);
      expect(ui.app.paused).toBe(true);
      ui.draw();
      expect(ui.words()).toEqual(expect.arrayContaining([town.map().dungeons()[gate].name, 'Floor 1', 'All fighters', 'Selected (1)', 'Group 2']));
      expect(ui.words().some((w) => w.startsWith('Party: 1 at level 4 on average, too few'))).toBe(true);
      // A tap on a row takes them along; a second tap leaves them behind.
      ui.click(`expedition-member-${folk[1].id}`);
      expect(ui.app.expedition!.party).toEqual([folk[0].id, folk[1].id]);
      ui.click(`expedition-member-${folk[1].id}`);
      expect(ui.app.expedition!.party).toEqual([folk[0].id]);
      ui.draw();
      ui.click('expedition-pick-fighters');
      expect(ui.app.expedition!.party).toEqual(folk.slice(0, 4).map((p) => p.id));
      ui.draw();
      expect(ui.words()).toContain('Party: 4 at level 4 on average, ready.');
      expect(ui.words()).toContain('Set out (4)');
      ui.click('expedition-pick-group-2');
      expect(ui.app.expedition!.party).toEqual([folk[0].id, folk[1].id]);
      ui.draw();
      ui.click('expedition-pick-clear');
      ui.draw();
      expect(ui.app.expedition!.party).toEqual([]);
      expect(ui.enabled('expedition-set-out')).toBe(false);
      expect(setOutProblem(ui.app)).toBe('Choose who goes');
      // Escape closes it and the settlement takes up its pace again.
      handleExpeditionEvent.call(ui.app, key('escape', 4));
      expect(ui.app.expedition).toBeNull();
      expect(ui.app.paused).toBe(false);
    } finally {
      ui.dispose();
    }
  });
  it('lists who cannot go and why, and never takes them along', () => {
    const { town, gate, folk } = settlement([
      [Calling.Warrior, 4],
      [Calling.Ranger, 4],
      [Calling.Mage, 4],
      [Calling.Cleric, 4],
    ]);
    folk[1].downedAt = town.time;
    folk[1].health = 0;
    folk[1].activity = Activity.Downed;
    folk[2].woundDays = 2;
    folk[3].stressRecovery = true;
    const ui = fixture(town);
    try {
      openExpedition(ui.app, gate, folk.map((p) => p.id));
      expect(ui.app.expedition!.party).toEqual([folk[0].id]);
      ui.draw();
      expect(ui.words()).toEqual(
        expect.arrayContaining(['Cannot go now', 'Downed: must be raised first', 'Wounded: heals in 2 days', 'Overwhelmed: resting until calm']),
      );
      expect(ui.enabled(`expedition-member-${folk[2].id}`)).toBe(false);
      ui.click(`expedition-member-${folk[2].id}`);
      expect(ui.app.expedition!.party).toEqual([folk[0].id]);
    } finally {
      ui.dispose();
    }
  });
  it('sets out with Enter: the party walks to the gate, the window closes and the old pause returns', () => {
    const { town, gate, folk } = settlement([
      [Calling.Warrior, 4],
      [Calling.Ranger, 4],
      [Calling.Mage, 4],
    ]);
    const ui = fixture(town);
    try {
      ui.app.paused = true;
      openExpedition(ui.app, gate, folk.map((p) => p.id));
      ui.draw();
      expect(ui.enabled('expedition-set-out')).toBe(true);
      handleExpeditionEvent.call(ui.app, key('return', 2));
      expect(ui.app.expedition).toBeNull();
      expect(ui.app.paused).toBe(true);
      expect(folk.every((p) => p.activity === Activity.Expedition && p.target === gate)).toBe(true);
      expect(town.parties[0]).toMatchObject({ dungeon: gate, floor: 0 });
      expect(ui.app.selectPeople).toHaveBeenCalledWith(folk.map((p) => p.id));
      // Called back before stepping in, as before: any other order takes them off the march.
      town.orderMove([folk[0].id], folk[0].position);
      expect(folk[0].activity).not.toBe(Activity.Expedition);
    } finally {
      ui.dispose();
    }
  });
  it('chooses among open floors only and shows a sealed or unexplored gate read-only', () => {
    const { town, gate, folk } = settlement([[Calling.Warrior, 8]]);
    town.depth[gate] = 1;
    const ui = fixture(town);
    try {
      openExpedition(ui.app, gate, [folk[0].id]);
      ui.draw();
      expect(ui.enabled('expedition-floor-1')).toBe(true);
      expect(ui.enabled('expedition-floor-2')).toBe(false);
      ui.click('expedition-floor-1');
      expect(ui.app.expedition!.floor).toBe(1);
      ui.draw();
      expect(ui.words().some((w) => w.startsWith('Floor 2 holds'))).toBe(true);
      closeExpedition(ui.app);
      town.depth[gate] = sealFloors;
      openExpedition(ui.app, gate, [folk[0].id]);
      ui.draw();
      expect(setOutProblem(ui.app)).toBe('Sealed: no raid leaves this gate and no party goes through it');
      expect(ui.words().join(' ')).toContain('Sealed: no raid leaves this gate and no party goes');
      expect(ui.words().some((w) => w.startsWith('Floor 3 holds'))).toBe(false);
      expect(ui.enabled('expedition-set-out')).toBe(false);
      expect(ui.control(`expedition-member-${folk[0].id}`)).toBeUndefined();
      closeExpedition(ui.app);
      town.depth[gate] = 0;
      town.map().dungeons()[gate].discovered = false;
      openExpedition(ui.app, gate);
      ui.draw();
      expect(setOutProblem(ui.app)).toBe('This gate is not yet explored');
    } finally {
      ui.dispose();
    }
  });
  it('is opened by every entry point, with the selection already chosen', () => {
    const { town, gate, folk } = settlement([
      [Calling.Warrior, 4],
      [Calling.Ranger, 4],
    ]);
    const ui = fixture(town),
      app = ui.app,
      ids = folk.map((p) => p.id);
    try {
      // Right-click on the gate with residents selected: the window, not a march.
      app.chosen = [...ids];
      app.mouse = point(50, 50);
      app.hoveredWorldTarget = { screen: point(50, 50), hit: presentedHit('dungeon', gate) };
      issueOrder.call(app, Order.Work);
      expect(app.expedition).toMatchObject({ gate, party: ids });
      expect(folk.every((p) => p.activity !== Activity.Expedition)).toBe(true);
      closeExpedition(app);
      // A left click or tap on the gate.
      app.chosen = [ids[1]];
      app.hoveredWorldTarget = { screen: point(50, 50), hit: presentedHit('dungeon', gate) };
      app.boxFrom = point(50, 50);
      pointerUp.call(app, 50, 50, PointerButton.Primary);
      expect(app.expedition).toMatchObject({ gate, party: [ids[1]] });
      expect(app.selectedDungeon).toBe(gate);
      closeExpedition(app);
      // The gate's inspector and the quest button.
      app.chosen = [];
      jumpToGate(app);
      expect(app.expedition).toMatchObject({ gate, party: [] });
    } finally {
      ui.dispose();
    }
  });
  it('fits a phone in touch: rows and buttons a finger can hit, nothing off screen, the list pages', () => {
    const { town, gate, folk } = settlement(
      Array.from({ length: 14 }, (_, i): [Calling, number] => [[Calling.Warrior, Calling.Ranger, Calling.Mage, Calling.Cleric][i % 4], 3 + (i % 5)]),
    );
    const ui = fixture(town, 390, 844, true);
    try {
      openExpedition(ui.app, gate, [folk[0].id]);
      ui.draw();
      const ours = (ui.ids() as string[]).filter((id) => id.startsWith('expedition-') && id !== 'expedition-backdrop' && id !== 'expedition-panel' && id !== 'expedition-list');
      for (const id of ours) {
        const r = ui.control(id)![1] as Rect;
        expect(r.x, id).toBeGreaterThanOrEqual(0);
        expect(r.y, id).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, id).toBeLessThanOrEqual(390);
        expect(r.y + r.h, id).toBeLessThanOrEqual(844);
        expect(r.h, id).toBeGreaterThanOrEqual(44);
      }
      const rows = ours.filter((id) => id.startsWith('expedition-member-'));
      expect(rows.length).toBeGreaterThan(3);
      expect(rows.length).toBeLessThan(folk.length);
      ui.click('expedition-page-down');
      ui.draw();
      expect(ui.ids()).not.toContain(rows[0]);
      // A touch lifted leaves no row looking hovered.
      expect(ui.app.expedition!.pointer).toEqual({ x: -1, y: -1 });
    } finally {
      ui.dispose();
    }
  });
  it('speaks Korean', () => {
    const { town, gate, folk } = settlement([
      [Calling.Warrior, 4],
      [Calling.Mage, 2],
    ]);
    folk[1].woundDays = 1;
    const ui = fixture(town);
    setLocale('KR');
    try {
      ui.app.army.town = town;
      ui.app.army.groups.set(1, [folk[0].id]);
      openExpedition(ui.app, gate, [folk[0].id]);
      ui.draw();
      const names = new Set([...folk.map((p) => p.name), town.map().dungeons()[gate].name, 'Lv']);
      const english = ui
        .words()
        .map((w) => translate(w))
        .filter((w) => [...w.matchAll(/[A-Za-z]{3,}/g)].some((hit) => !names.has(hit[0])));
      expect(english).toEqual([]);
      expect(ui.words().some((w) => hasHangul(translate(w)))).toBe(true);
      for (const text of [
        'Choose who goes',
        'Choose who goes: click or tap a resident to take them along.',
        'This gate is not yet explored',
        'Sealed: no raid leaves this gate and no party goes through it',
        'Beyond a gate already',
        'On the way to a gate',
        'Downed: must be raised first',
        'Overwhelmed: resting until calm',
        'Send to join (2)',
        'A party fights beyond this gate on floor 2; those you send now join it.',
        'More (3)',
        'Previous',
        'No resident can be sent yet.',
        'Plan an expedition',
        'Click the gate, or the button below, to choose a party and a floor and set out.',
      ])
        expect(hasHangul(translate(text)), text).toBe(true);
    } finally {
      setLocale(defaultLocale);
      ui.dispose();
    }
  });
});
