import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect, Key, Cursor } from '../../packages/native-ui/src';
import { handleTouchEvent } from '../../apps/web/src/native/game-touch';
import { emptyEvent } from '../../apps/web/src/native/application-contracts';
import { civicInspector } from '../../apps/web/src/native/game-civic-panel';
import { closePrayer, renderPrayer } from '../../apps/web/src/native/game-prayer';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { Building } from '../../packages/engine/src/town-models';
import { Town } from '../../packages/engine/src/town';
import { Activity, Calling, Role, Person, Race } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { GameAppState, DockView } from '../../apps/web/src/native/game-app-state';
import { addInventory } from '../../packages/engine/src/equipment';
import {
  updateContextDock,
  renderDockContent,
  dismissBuildDrawer,
  taskbar,
} from '../../apps/web/src/native/game-context-dock';
import { rosterPanel, rosterBounds } from '../../apps/web/src/native/game-roster';
import {
  commandCard,
  inspector,
  buildMenuBounds,
  buildGroups,
  placementPanel,
  placementPanelBounds,
} from '../../apps/web/src/native/game-hud';
import { objectives } from '../../apps/web/src/native/game-objectives';
import * as input from '../../apps/web/src/native/game-input';
import { PointerButton, Tool, Order } from '../../packages/engine/src/game-tools';
import { actionButton } from '../../apps/web/src/native/hud-actions';
import {
  worldNameplateBounds,
  paintWorldNameplate,
  worldNameplateStyle,
} from '../../apps/web/src/native/world-nameplate';
import {
  personPanel,
  personPanelBounds,
  residentSelection,
  shelteredSelection,
} from '../../apps/web/src/native/game-unit-panel';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';
class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels = new Uint8ClampedArray();
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      putImageData: (image: Pixels) => {
        this.pixels = image.data.slice();
      },
      clearRect() {},
    };
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
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});
function fixture(width = 880, height = 600) {
  const memory = new MemoryCanvas(width, height);
  const canvas = new tvg.Canvas(memory as any, {
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
  );
  const context = new Context(tvg, metrics),
    town = new Town(5, 32),
    app = new GameAppState(town, {} as any, context) as GameHudApp;
  app.selectPeople = vi.fn();
  app.toggleAuto = vi.fn();
  app.commandCard = vi.fn();
  app.residentSelection = residentSelection.bind(app);
  app.shelteredSelection = shelteredSelection.bind(app);
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  return {
    app,
    town,
    context,
    controls,
    labels,
    capture(name: string) {
      const directory = process.env.GOLDFANTASY_UI_CAPTURE;
      if (!directory) return;
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${directory}/${name}.rgba`, memory.pixels);
      writeFileSync(`${directory}/${name}.json`, JSON.stringify({ width, height }));
    },
    draw(fn: () => void) {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), 1);
      fn();
      context.end();
      canvas.update().render();
    },
    dispose() {
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      for (const entry of app.dockPortraits.values()) entry.paint.dispose();
      canvas.destroy();
    },
  };
}
it.each([
  [360, 740],
  [390, 844],
  [844, 390],
])('keeps mobile placement and unit actions tappable at %ix%i', (width, height) => {
  const ui = fixture(width, height);
  try {
    ui.app.touchMode = true;
    ui.app.viewWidth = width;
    ui.app.viewHeight = height;
    ui.app.tool = Tool.Camp;
    ui.app.toolStructure = () => Structure.Camp;
    ui.app.touchPlacement = point(16, 16);
    ui.app.current.preview.valid = true;
    ui.app.confirmTouchPlacement = vi.fn();
    ui.app.rotate = vi.fn();
    const bounds = placementPanelBounds.call(ui.app, width, height);
    ui.draw(() => placementPanel.call(ui.app, bounds));
    const controls = ui.controls.mock.calls.filter(([id]) => id.startsWith('placement-'));
    expect(controls.map(([id]) => id)).toContain('placement-confirm');
    for (const [, r] of controls) {
      expect(r.w).toBeGreaterThanOrEqual(44);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(width);
      expect(r.y + r.h).toBeLessThanOrEqual(height);
    }
    const confirm = controls.find(([id]) => id === 'placement-confirm')![1];
    ui.context.pointerDown(confirm.x + 10, confirm.y + 10);
    ui.context.pointerUp(confirm.x + 10, confirm.y + 10);
    expect(ui.app.confirmTouchPlacement).toHaveBeenCalledOnce();
    ui.app.chosen = [ui.town.folk[0].id];
    ui.app.commandCard = commandCard.bind(ui.app);
    const selected = personPanelBounds.call(ui.app, width, height, true);
    ui.draw(() => personPanel.call(ui.app, selected));
    expect(selected.y + selected.h).toBe(height - 12);
    const actions = ui.controls.mock.calls.filter(([id]) => id.startsWith('unit/card-'));
    expect(actions).toHaveLength(7);
    for (const [, r] of actions) {
      expect(r.w).toBeGreaterThanOrEqual(44);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.y).toBeGreaterThanOrEqual(selected.y + 100);
      expect(r.y + r.h).toBeLessThanOrEqual(selected.y + selected.h);
    }
  } finally {
    ui.dispose();
  }
});
it('shows village supplies in the bottom Camp inspector without requiring hover on touch', () => {
  const ui = fixture(390, 844);
  try {
    const camp = new Building(20, Structure.Camp, point(16, 16), 0, 0);
    camp.progress = 1;
    ui.town.placed = [camp];
    ui.app.selected = camp.id;
    ui.app.touchMode = true;
    const height = inspector.call(ui.app, new Rect(0, 0, 366, 0), false);
    expect(height).toBe(196);
    const panel = new Rect(12, 844 - 12 - height, 366, height);
    ui.draw(() => inspector.call(ui.app, panel));
    const words = ui.labels.mock.calls.map(([, text]) => text);
    expect(words).toEqual(
      expect.arrayContaining(['Village stores', 'Gold', 'Wood', 'Food', 'Water', 'Bones', 'Residents']),
    );
    for (const [r] of ui.labels.mock.calls) {
      expect(r.y).toBeGreaterThanOrEqual(panel.y);
      expect(r.y + r.h).toBeLessThanOrEqual(panel.y + panel.h);
    }
  } finally {
    ui.dispose();
  }
});
it('provides a touch-sized Cancel action while a world order is armed', () => {
  const ui = fixture(390, 844);
  try {
    ui.app.touchMode = true;
    ui.app.pending = Order.Move;
    ui.app.reducedMotion = () => true;
    ui.app.animatingUi = () => false;
    ui.app.buildMenuBounds = buildMenuBounds.bind(ui.app);
    ui.app.renderDockContent = renderDockContent.bind(ui.app);
    ui.draw(() => {
      updateContextDock.call(ui.app, 390, 844);
      taskbar.call(ui.app, 390, 844);
    });
    const cancel = ui.controls.mock.calls.find(([id]) => id === 'command-cancel')![1];
    expect(cancel.w).toBe(44);
    expect(cancel.h).toBe(44);
    expect(ui.context.controlAt(cancel.x + 12, cancel.y + 12)).toBe(true);
    ui.context.pointerDown(cancel.x + 12, cancel.y + 12);
    ui.context.pointerUp(cancel.x + 12, cancel.y + 12);
    expect(ui.app.pending).toBe(Order.None);
  } finally {
    ui.dispose();
  }
});
it('keeps mobile workplace staffing controls inside the inspector', () => {
  const ui = fixture(390, 844);
  try {
    const camp = new Building(0, Structure.Camp, point(16, 16), 0, 0),
      yard = new Building(20, Structure.Lumberyard, point(18, 16), 0, 0);
    camp.progress = yard.progress = 1;
    ui.town.placed = [camp, yard];
    ui.app.touchMode = true;
    ui.app.selected = yard.id;
    const panel = new Rect(12, 500, 366, 332);
    ui.draw(() => inspector.call(ui.app, panel));
    for (const id of ['workers-less', 'workers-more']) {
      const r = ui.controls.mock.calls.find(([key]) => key === id)![1];
      expect(r.w).toBeGreaterThanOrEqual(44);
      expect(r.h).toBeGreaterThanOrEqual(44);
      expect(r.x).toBeGreaterThanOrEqual(panel.x);
      expect(r.x + r.w).toBeLessThanOrEqual(panel.x + panel.w);
    }
  } finally {
    ui.dispose();
  }
});
it.each([
  [Cursor.Default, ''],
  [Cursor.Text, 'tap'],
])('clears touch button focus while retaining text input focus (%s)', (cursor, expected) => {
  const ui = fixture(390, 844);
  try {
    const app = Object.assign(ui.app, {
      pointerMove: (x: number, y: number) => ui.context.pointerMove(x, y),
      pointerUp: (x: number, y: number) => ui.context.pointerUp(x, y),
    });
    ui.draw(() =>
      ui.context.control(
        'tap',
        new Rect(100, 100, 44, 44),
        () => {},
        true,
        true,
        false,
        false,
        cursor as Cursor,
      ),
    );
    ui.context.pointerDown(110, 110);
    app.touchGesture = { start: point(110, 110), last: point(110, 110), mode: 'ui' };
    handleTouchEvent.call(app as any, { ...emptyEvent('PointerUp'), x: 110, y: 110, pointerType: 'touch' });
    expect(ui.context.focused()).toBe(expected);
  } finally {
    ui.dispose();
  }
});
it('keeps mobile quests collapsed and removes their hit shield during placement or commands', () => {
  const ui = fixture(390, 844);
  try {
    ui.app.touchMode = true;
    ui.app.reducedMotion = () => true;
    ui.app.dockBounds = new Rect(12, 650, 366, 182);
    ui.draw(() => objectives.call(ui.app, 390, 844, 64));
    const panel = ui.controls.mock.calls.find(([id]) => id === 'objectives-panel')![1];
    const toggle = ui.controls.mock.calls.find(([id]) => id === 'objectives-toggle')![1];
    expect(panel.h).toBe(44);
    expect(panel.w).toBeLessThan(200);
    expect(toggle.h).toBe(44);
    expect(ui.labels.mock.calls.some(([, text]) => text.startsWith('Quests '))).toBe(true);
    ui.app.tool = Tool.Camp;
    ui.draw(() => objectives.call(ui.app, 390, 844, 64));
    expect(ui.controls.mock.calls.some(([id]) => id === 'objectives-panel')).toBe(false);
    ui.app.tool = Tool.Select;
    ui.app.pending = Order.Move;
    ui.draw(() => objectives.call(ui.app, 390, 844, 64));
    expect(ui.controls.mock.calls.some(([id]) => id === 'objectives-panel')).toBe(false);
  } finally {
    ui.dispose();
  }
});
it('lists actual lodging visitors without fabricated recruitment offers or a Hire action', () => {
  const ui = fixture();
  try {
    const guest = new Person(
      99,
      'A real traveller',
      Role.Guest,
      Calling.Traveller,
      Race.Human,
      5,
      point(10, 10),
    );
    const neutralGuest = new Person(
      100,
      'Neutral visitor',
      Role.Guest,
      Calling.Traveller,
      Race.Human,
      7,
      point(20, 20),
    );
    neutralGuest.faction = 2;
    ui.town.folk.push(guest, neutralGuest);
    ui.app.rosterTab = 'guests';
    ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    const ids = ui.controls.mock.calls.map((call) => call[0]);
    expect(ids.filter((id) => id.startsWith('roster-person-'))).toEqual(['roster-person-guests:99']);
    expect(ids).not.toContain('roster-hire');
    expect(ui.labels.mock.calls.some((call) => call[1] === 'Inspect guest')).toBe(true);
    ui.town.folk.splice(-2);
    ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    expect(ui.controls.mock.calls.some((call) => call[0].startsWith('roster-person-'))).toBe(false);
    expect(ui.labels.mock.calls.some((call) => call[1] === 'No guests are visiting the settlement.')).toBe(
      true,
    );
  } finally {
    ui.dispose();
  }
});

it('keeps Unit management open while equipping its selected resident without selecting the world', () => {
  const ui = fixture();
  try {
    const p = ui.town.folk[0];
    addInventory(p, 'axe');
    ui.app.rosterOpen = true;
    ui.app.rosterSelected = `units:${p.id}`;
    ui.app.chosen = [ui.town.folk[1].id];
    const draw = () => ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    const click = (id: string) => {
      const bounds = ui.controls.mock.calls.find(([key]) => key === id)![1];
      ui.context.pointerDown(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
      ui.context.pointerUp(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    };
    draw();
    expect(ui.controls.mock.calls.filter(([id]) => id.startsWith('inventory-slot-'))).toHaveLength(16);
    click('inventory-slot-1');
    draw();
    click('equipment-slot-tool1');
    expect(p.equipment.tool1).toBe(1);
    expect(ui.app.rosterOpen).toBe(true);
    click(`roster-person-units:${ui.town.folk[1].id}`);
    expect(ui.app.inventorySelected).toBe(-1);
    expect(ui.app.equipmentTab).toBe('equipment');
    expect(ui.app.rosterSelected).toBe(`units:${ui.town.folk[1].id}`);
    expect(p.equipment.tool1).toBe(1);
    expect(ui.app.chosen).toEqual([ui.town.folk[1].id]);
    expect(ui.app.selectPeople).not.toHaveBeenCalled();
    draw();
    click('equipment-tab-craft');
    draw();
    expect(ui.controls.mock.calls.some(([id]) => id.startsWith('craft-item-'))).toBe(true);
    expect(ui.app.rosterOpen).toBe(true);
  } finally {
    ui.dispose();
  }
});

it('draws action tooltips after clipped icons and outside every control', () => {
  const ui = fixture(390, 844),
    anchor = new Rect(100, 100, 30, 30),
    neighbor = new Rect(90, 78, 100, 22);
  try {
    ui.context.pointerMove(110, 110);
    ui.draw(() => {
      ui.context.layer(new Rect(80, 80, 160, 50), () => {
        actionButton(ui.context, 'tooltip-anchor', anchor, 'gear', 'Manage equipment', () => {});
        actionButton(ui.context, 'tooltip-neighbor', neighbor, 'craft', 'Craft equipment', () => {});
        ui.context.text(new Rect(80, 160, 100, 20), 'Last normal icon', ui.app.theme.text, 10);
      });
    });
    const tip = ui.labels.mock.calls.find(([, text]) => text === 'Manage equipment')![0];
    expect(ui.labels.mock.calls.at(-1)![1]).toBe('Manage equipment');
    const clipped = tip.intersect(new Rect(80, 80, 160, 50));
    expect(clipped.w * clipped.h).toBe(0);
    for (const [, bounds] of ui.controls.mock.calls) {
      const overlap = tip.intersect(bounds);
      expect(overlap.w * overlap.h).toBe(0);
    }
    expect(tip.x).toBeGreaterThanOrEqual(0);
    expect(tip.x + tip.w).toBeLessThanOrEqual(390);
    expect(tip.y + tip.h).toBeLessThanOrEqual(844);
    ui.capture('tooltip-390x844');
    ui.draw(() => {});
    expect(ui.labels.mock.calls.some(([, text]) => text === 'Manage equipment')).toBe(false);
  } finally {
    ui.dispose();
  }
});

it.each([
  [390, 844],
  [844, 390],
])(
  'opens pictogram build categories by pointer and keyboard with full labels, and a tooltip-free Back arrow at %sx%s',
  (width, height) => {
    const ui = fixture(width, height);
    try {
      ui.town.placed = Array.from({ length: Structure.Count }, (_, kind) => {
        const building = new Building(kind, kind, point(8, 8), 0, 0);
        building.progress = 1;
        return building;
      });
      while (ui.town.folk.length < 30)
        ui.town.folk.push(
          new Person(
            ui.town.folk.length,
            'Resident',
            Role.Resident,
            Calling.Settler,
            Race.Human,
            5,
            point(8, 8),
          ),
        );
      ui.app.globalCard = 0;
      ui.app.dismissBuildDrawer = dismissBuildDrawer.bind(ui.app);
      const draw = () =>
        ui.draw(() =>
          commandCard.call(ui.app, buildMenuBounds.call(ui.app, width, height, true), 1, true, true),
        );
      draw();
      const groups = buildGroups(ui.town);
      expect(groups.length).toBeGreaterThan(1);
      for (const [i, group] of groups.entries()) {
        const id = `global/card-group-${group.name}`;
        const bounds = ui.controls.mock.calls.find(([key]) => key === id)![1];
        expect(bounds.h).toBeGreaterThanOrEqual(28);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.w).toBeLessThanOrEqual(width);
        expect(ui.labels.mock.calls.some(([, text]) => text === group.name)).toBe(false);
        ui.context.pointerMove(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        draw();
        expect(ui.labels.mock.calls.at(-1)?.[1]).toBe(group.name);
        ui.context.pointerDown(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        ui.context.pointerUp(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        expect(ui.app.globalCard).toBe(i + 1);
        draw();
        ui.context.focus('global/card-back');
        ui.context.pointerMove(-1, -1);
        draw();
        expect(ui.labels.mock.calls.some(([, text]) => text === 'Back')).toBe(false);
        ui.context.key(Key.Enter);
        expect(ui.app.globalCard).toBe(0);
        draw();
        ui.context.focus(id);
        draw();
        expect(ui.labels.mock.calls.at(-1)?.[1]).toBe(group.name);
        ui.context.key(Key.Enter);
        expect(ui.app.globalCard).toBe(i + 1);
        ui.app.globalCard = 0;
        ui.context.focus('');
        draw();
      }
      ui.capture(`build-categories-${width}x${height}`);
    } finally {
      ui.dispose();
    }
  },
);

it.each(['build', 'units', 'selection'] as const)(
  'dismisses the %s panel on an empty-world click without redundant close controls',
  (kind) => {
    const ui = fixture(390, 844);
    try {
      const app = Object.assign(ui.app, {
        pointerMove: input.pointerMove.bind(ui.app as any),
        cancelStroke: input.cancelStroke.bind(ui.app as any),
        sampleRoad: input.sampleRoad.bind(ui.app as any),
        press: input.press.bind(ui.app as any),
        select: input.select.bind(ui.app as any),
        dismissBuildDrawer: dismissBuildDrawer.bind(ui.app),
        renderDockContent: renderDockContent.bind(ui.app),
        commandCard: commandCard.bind(ui.app),
        rosterPanel: rosterPanel.bind(ui.app),
        personPanel: personPanel.bind(ui.app),
      });
      app.renderer.pick = () => null;
      app.viewWidth = 390;
      app.viewHeight = 844;
      app.dockProgress = 1;
      app.dockBounds = app.dockTarget = new Rect(12, 480, 366, 352);
      app.chosen = kind === 'selection' ? [ui.town.folk[0].id] : [];
      app.rosterOpen = kind === 'units';
      app.globalCard = kind === 'build' ? 0 : -1;
      app.dockView = kind === 'build' ? DockView.Build : kind === 'units' ? DockView.Roster : DockView.Unit;
      ui.draw(() => taskbar.call(app, 390, 844));
      expect(ui.controls.mock.calls.map(([id]) => id)).not.toContain('dock-close');
      expect(ui.controls.mock.calls.map(([id]) => id)).not.toContain('roster-close');
      input.pointerDown.call(app as any, 100, 200, PointerButton.Primary);
      input.pointerUp.call(app as any, 100, 200, PointerButton.Primary);
      expect(app.rosterOpen).toBe(false);
      expect(app.card).toBe(-1);
      expect(app.globalCard).toBe(-1);
      expect(app.chosen).toEqual([]);
      expect(app.selected).toBe(-1);
    } finally {
      ui.app.dockContent?.dispose();
      ui.app.dockContent = null;
      ui.dispose();
    }
  },
);

it('shows one viewport-clamped pointer tooltip instead of a competing focused tooltip', () => {
  const ui = fixture(390, 844);
  try {
    ui.context.focus('focused-action');
    ui.context.pointerMove(375, 12);
    ui.draw(() => {
      actionButton(
        ui.context,
        'hovered-action',
        new Rect(360, 4, 28, 28),
        'craft',
        'Hovered crafting action',
        () => {},
      );
      actionButton(
        ui.context,
        'focused-action',
        new Rect(4, 4, 28, 28),
        'gear',
        'Focused equipment action',
        () => {},
      );
    });
    expect(ui.labels.mock.calls.some(([, label]) => label === 'Focused equipment action')).toBe(false);
    const shown = ui.labels.mock.calls.filter(([, label]) => label === 'Hovered crafting action');
    expect(shown).toHaveLength(1);
    const bounds = shown[0][0];
    expect(bounds.x).toBeGreaterThanOrEqual(4);
    expect(bounds.y).toBeGreaterThanOrEqual(4);
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(386);
    expect(bounds.y + bounds.h).toBeLessThanOrEqual(840);
  } finally {
    ui.dispose();
  }
});

it('uses the dungeon label plate, bold font and gold ink for world nameplates', () => {
  const ui = fixture(),
    rectangles = vi.spyOn(ui.context, 'rect');
  try {
    const bounds = worldNameplateBounds(ui.context, 'Ancient hall', 180, 80);
    ui.draw(() => paintWorldNameplate(ui.context, 'Ancient hall', bounds));
    expect(bounds.h).toBe(14);
    expect(bounds.w).toBeCloseTo(ui.context.textWidth('Ancient hall', 8, true) + 12, 4);
    expect(rectangles).toHaveBeenCalledWith(bounds, worldNameplateStyle.plate);
    expect(ui.labels.mock.calls[0].slice(1, 5)).toEqual(['Ancient hall', worldNameplateStyle.ink, 8, true]);
  } finally {
    ui.dispose();
  }
});
it('keeps overwhelmed player residents in Units while excluding defectors and guests', () => {
  const ui = fixture();
  try {
    const [player, neutral] = ui.town.folk;
    player.stressRecovery = true;
    neutral.faction = 8;
    ui.app.rosterTab = 'units';
    ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    expect(
      ui.controls.mock.calls.filter((call) => call[0].startsWith('roster-person-')).map((call) => call[0]),
    ).toEqual([`roster-person-units:${player.id}`]);
    expect(ui.labels.mock.calls.some((call) => String(call[1]).includes('Overwhelmed'))).toBe(true);
    ui.app.chosen = [player.id];
    ui.draw(() => personPanel.call(ui.app, personPanelBounds.call(ui.app, 880, 600, false)));
    expect(ui.controls.mock.calls.some((call) => call[0] === 'unit-auto')).toBe(false);
    expect(ui.app.commandCard).not.toHaveBeenCalled();
    expect(ui.labels.mock.calls.some((call) => String(call[1]).includes('Overwhelmed'))).toBe(true);
  } finally {
    ui.dispose();
  }
});

it('opens resource offerings from the statue without choosing or ordering a resident', () => {
  const ui = fixture();
  try {
    const { altar } = civicTown(ui.town);
    ui.app.viewHeight = 800;
    ui.app.paused = false;
    const before = ui.town.people().map((p) => ({ id: p.id, task: p.task, site: p.taskSite }));
    const order = vi.spyOn(ui.town, 'orderPrayAtAltar');
    ui.draw(() => civicInspector.call(ui.app, altar, new Rect(100, 200, 620, 286), true));
    expect(ui.controls.mock.calls.some((call) => String(call[0]).startsWith('civic-person-'))).toBe(false);
    const action = ui.controls.mock.calls.find((call) => call[0] === 'altar-pray')!;
    expect(action[3]).toBe(true);
    ui.context.pointerDown(action[1].x + 10, action[1].y + 10);
    ui.context.pointerUp(action[1].x + 10, action[1].y + 10);
    expect(ui.app.prayer?.altar).toBe(altar.id);
    expect(ui.app.paused).toBe(true);
    expect(order).not.toHaveBeenCalled();
    expect(ui.town.people().map((p) => ({ id: p.id, task: p.task, site: p.taskSite }))).toEqual(before);
    ui.draw(() => renderPrayer.call(ui.app, 880, 600));
    for (const key of ['water', 'bones', 'gold', 'food', 'stone'])
      expect(ui.controls.mock.calls.some((call) => call[0] === 'offering-' + key)).toBe(true);
    // An edit and click can share a browser frame. Validate the current input,
    // then let the next valid edit clear the rejection without reopening.
    const confirm = ui.controls.mock.calls.find((call) => call[0] === 'prayer-confirm')!;
    ui.app.prayer!.inputs.food.value = '0';
    ui.context.pointerDown(confirm[1].x + 10, confirm[1].y + 10);
    ui.context.pointerUp(confirm[1].x + 10, confirm[1].y + 10);
    expect(ui.app.prayer!.started).toBe(-1);
    ui.draw(() => renderPrayer.call(ui.app, 880, 600));
    expect(ui.controls.mock.calls.find((call) => call[0] === 'prayer-confirm')![3]).toBe(false);
    ui.app.prayer!.inputs.food.value = '4';
    ui.draw(() => renderPrayer.call(ui.app, 880, 600));
    expect(ui.controls.mock.calls.find((call) => call[0] === 'prayer-confirm')![3]).toBe(true);
    closePrayer.call(ui.app);
    expect(ui.app.paused).toBe(false);
    ui.draw(() => {});
    altar.devotionDueDay = 2;
    ui.draw(() => civicInspector.call(ui.app, altar, new Rect(100, 200, 620, 286), true));
    const next = ui.controls.mock.calls.find((call) => call[0] === 'altar-pray')!;
    ui.context.pointerDown(next[1].x + 10, next[1].y + 10);
    ui.context.pointerUp(next[1].x + 10, next[1].y + 10);
    ui.draw(() => renderPrayer.call(ui.app, 880, 600));
    expect(ui.controls.mock.calls.find((call) => call[0] === 'prayer-confirm')![3]).toBe(false);
    closePrayer.call(ui.app);
    ui.draw(() => {});
  } finally {
    const pending = ui.app.prayer;
    ui.dispose();
    pending?.adapter.dispose();
  }
});
it('previews class stats without mutating the resident and disables a second profession', () => {
  const ui = fixture();
  try {
    const { guild } = civicTown(ui.town),
      resident = ui.town.folk[0];
    ui.app.viewHeight = 390;
    ui.app.inspectorPerson = resident.id;
    const train = vi.spyOn(ui.town, 'orderTrainAtGuild').mockReturnValue(true);
    const draw = () => ui.draw(() => civicInspector.call(ui.app, guild, new Rect(12, 100, 366, 204), true));
    draw();
    const ranger = ui.controls.mock.calls.find((call) => call[0] === `guild-class-${Calling.Ranger}`)!;
    ui.context.pointerDown(ranger[1].x + 10, ranger[1].y + 10);
    ui.context.pointerUp(ranger[1].x + 10, ranger[1].y + 10);
    draw();
    expect(ui.app.inspectorCalling).toBe(Calling.Ranger);
    expect(resident.calling).toBe(Calling.Settler);
    // A class preview does not conjure a bow or add weapon damage.
    expect(ui.labels.mock.calls.some((call) => String(call[1]).includes('Reach 0.9'))).toBe(true);
    expect(ui.town.power(resident)).toBe(1);
    const action = ui.controls.mock.calls.find((call) => call[0] === 'guild-train')!;
    expect(action[3]).toBe(true);
    ui.context.pointerDown(action[1].x + 10, action[1].y + 10);
    ui.context.pointerUp(action[1].x + 10, action[1].y + 10);
    expect(train).toHaveBeenCalledWith(resident.id, guild.id, Calling.Ranger);
    resident.task = Activity.Training;
    resident.taskSite = guild.id;
    resident.trainingCalling = Calling.Ranger;
    draw();
    expect(ui.labels.mock.calls.some((call) => call[1] === 'Training in progress')).toBe(true);
    expect(ui.controls.mock.calls.find((call) => call[0] === 'guild-train')![3]).toBe(false);
    resident.task = Activity.Idle;
    resident.trained = true;
    draw();
    expect(ui.controls.mock.calls.find((call) => call[0] === 'guild-train')![3]).toBe(false);
  } finally {
    ui.dispose();
  }
});

function civicTown(town: Town) {
  const camp = new Building(0, Structure.Camp, point(8, 8), 0, 0);
  const altar = new Building(1, Structure.Shrine, point(12, 8), 0, 0);
  const guild = new Building(2, Structure.Guild, point(12, 12), 0, 0);
  town.placed = [camp, altar, guild];
  town.folk.splice(1);
  town.folk[0].home = town.folk[0].village = 0;
  town.migrateSettlements();
  town.stock(0).add(new Resources(100, 100, 100, 100));
  return { camp, altar, guild };
}

it('equips the selected real inventory stack through the centered gear grid without creating items', () => {
  const ui = fixture();
  try {
    const p = ui.town.folk[0];
    ui.app.rosterOpen = true;
    ui.app.rosterSelected = `units:${p.id}`;
    expect(p.inventory.every((item) => item === null)).toBe(true);
    expect(p.equipment.tool1).toBe(-1);
    addInventory(p, 'axe');
    const draw = () => ui.draw(() => rosterPanel.call(ui.app, rosterBounds.call(ui.app, 880, 600)));
    draw();
    expect(ui.controls.mock.calls.some((call) => call[0] === 'unit-auto')).toBe(false);
    expect(ui.controls.mock.calls.filter((call) => call[0].startsWith('inventory-slot-'))).toHaveLength(16);
    const click = (id: string) => {
      const r = ui.controls.mock.calls.find((call) => call[0] === id)![1];
      ui.context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      ui.context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
    };
    click('inventory-slot-1');
    draw();
    click('equipment-slot-tool1');
    expect(p.equipment.tool1).toBe(1);
    expect(p.inventory.filter(Boolean)).toHaveLength(1);
    expect(p.inventory[0]).toEqual({ item: 'axe', quantity: 1 });
    ui.app.inventorySelected = -1;
    draw();
    click('equipment-slot-tool1');
    expect(p.equipment.tool1).toBe(-1);
    expect(p.inventory[0]?.item).toBe('axe');
  } finally {
    ui.dispose();
  }
});

it('morphs a single handle into Build and Unit and centers the unit window from the first frame', () => {
  const ui = fixture();
  try {
    const app = ui.app;
    app.reducedMotion = () => true;
    app.animatingUi = () => false;
    app.buildMenuBounds = () => new Rect(100, 200, 600, 250);
    app.rosterBounds = rosterBounds.bind(app);
    app.personPanelBounds = personPanelBounds.bind(app);
    app.selectTool = vi.fn();
    app.viewHeight = 600;
    app.viewWidth = 880;
    app.mouse = point(-1, -1);
    ui.draw(() => updateContextDock.call(app, 880, 600));
    expect(app.dockView).toBe(DockView.Handle);
    app.mouse = point(440, 579);
    ui.draw(() => {
      updateContextDock.call(app, 880, 600);
      renderDockContent.call(app, app.dockTarget);
    });
    expect(app.dockView).toBe(DockView.Menu);
    expect(ui.controls.mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['build-handle', 'unit-roster']),
    );
    const r = ui.controls.mock.calls.find((call) => call[0] === 'unit-roster')![1];
    ui.context.pointerDown(r.x + 10, r.y + 10);
    ui.context.pointerUp(r.x + 10, r.y + 10);
    ui.draw(() => updateContextDock.call(app, 880, 600));
    expect(app.dockView).toBe(DockView.Roster);
    expect(app.dockTarget.y + app.dockTarget.h / 2).toBe(300);
  } finally {
    ui.dispose();
  }
});

it.each([
  [844, 390],
  [800, 500],
  [390, 844],
  [1280, 800],
])('fits every bag and gear control inside Unit management at %sx%s', (width, height) => {
  const ui = fixture(width, height);
  try {
    ui.app.rosterOpen = true;
    ui.app.rosterSelected = `units:${ui.town.folk[0].id}`;
    const panel = rosterBounds.call(ui.app, width, height);
    ui.draw(() => rosterPanel.call(ui.app, panel));
    ui.capture(`roster-${width}x${height}`);
    const grid = ui.controls.mock.calls.filter(
      (call) => call[0].startsWith('inventory-slot-') || call[0].startsWith('equipment-slot-'),
    );
    expect(grid).toHaveLength(25);
    for (const [id, r] of grid) {
      expect(r.x, id).toBeGreaterThanOrEqual(panel.x);
      expect(r.x + r.w, id).toBeLessThanOrEqual(panel.x + panel.w);
      expect(r.y, id).toBeGreaterThanOrEqual(panel.y);
      expect(r.y + r.h, id).toBeLessThanOrEqual(panel.y + panel.h - 12);
    }
  } finally {
    ui.dispose();
  }
});

it('keeps a fixed-size object panel on screen when only viewport height changes', () => {
  const ui = fixture();
  try {
    const app = ui.app;
    app.reducedMotion = () => true;
    app.animatingUi = () => false;
    app.buildMenuBounds = () => new Rect();
    app.selectedTree = 1;
    ui.draw(() => updateContextDock.call(app, 880, 800));
    expect(app.dockTarget.y).toBe(640);
    ui.draw(() => updateContextDock.call(app, 880, 500));
    expect(app.dockTarget.y).toBe(340);
    expect(app.dockBounds.y).toBe(340);
  } finally {
    ui.dispose();
  }
});

it.each([
  [1, false],
  [1, true],
  [2, false],
  [2, true],
] as const)(
  'keeps touch commands at full height for %s selected residents, sheltered=%s',
  (count, sheltered) => {
    const ui = fixture(390, 844);
    try {
      ui.app.chosen = ui.town.folk.slice(0, count).map((p) => p.id);
      ui.town.folk[0].inside = sheltered;
      ui.app.commandCard = commandCard.bind(ui.app);
      const panel = personPanelBounds.call(ui.app, 390, 844, true);
      ui.draw(() => personPanel.call(ui.app, panel));
      if (count === 1 && !sheltered) ui.capture('selection-bottom-390x844');
      const commands = ui.controls.mock.calls.filter(([id]) => id.startsWith('unit/card-'));
      expect(commands).toHaveLength(sheltered ? 8 : 7);
      for (const [id, bounds] of commands) {
        expect(bounds.h, id).toBeGreaterThanOrEqual(28);
        expect(bounds.y, id).toBeGreaterThanOrEqual(panel.y + panel.h - 42 - 0.001);
        expect(bounds.y + bounds.h, id).toBeLessThanOrEqual(panel.y + panel.h);
        expect(bounds.x, id).toBeGreaterThanOrEqual(panel.x);
        expect(bounds.x + bounds.w, id).toBeLessThanOrEqual(panel.x + panel.w + 0.001);
      }
      const content = ui.controls.mock.calls.filter(
        ([id]) =>
          id.startsWith('pick-person-') ||
          id.startsWith('inventory-slot-') ||
          id.startsWith('equipment-slot-'),
      );
      for (const [id, bounds] of content)
        expect(bounds.y + bounds.h, id).toBeLessThanOrEqual(commands[0][1].y);
    } finally {
      ui.dispose();
    }
  },
);

it.each([
  [Structure.Weaponsmith, 'none'],
  [Structure.Weaponsmith, 'foreign'],
  [Structure.Weaponsmith, 'local'],
  [Structure.Armorer, 'none'],
  [Structure.Armorer, 'foreign'],
  [Structure.Armorer, 'local'],
] as const)('chooses a workshop %s resident from its own camp with %s selection', (kind, selected) => {
  const ui = fixture();
  try {
    const first = new Building(0, Structure.Camp, point(5, 5), 0, 0),
      second = new Building(10, Structure.Camp, point(24, 24), 0, 0),
      smith = new Building(11, kind, point(20, 20), 0, 0),
      [foreign, local] = ui.town.folk,
      preferred = new Person(
        20,
        'Selected craftsperson',
        Role.Resident,
        Calling.Settler,
        Race.Human,
        9,
        point(28, 27),
      );
    first.village = 0;
    second.village = smith.village = 10;
    foreign.home = foreign.village = 0;
    foreign.position = smith.door();
    local.home = local.village = preferred.home = preferred.village = 10;
    local.position = point(24, 24);
    ui.town.placed = [first, second, smith];
    ui.town.folk.push(preferred);
    ui.town.migrateSettlements();
    ui.town.stock(10).add(new Resources(50, 50, 50, 50));
    expect(ui.town.settlementOf(foreign)).toBe(0);
    expect(ui.town.settlementOf(local)).toBe(10);
    expect(ui.town.settlementOf(smith)).toBe(10);
    ui.app.selected = smith.id;
    ui.app.chosen = selected === 'none' ? [] : [selected === 'local' ? preferred.id : foreign.id];
    ui.draw(() => inspector.call(ui.app, new Rect(100, 100, 620, 420), true));
    const action = ui.controls.mock.calls.find(([id]) => id === 'workshop-craft')!;
    expect(action[3]).toBe(true);
    ui.context.pointerDown(action[1].x + 10, action[1].y + 10);
    ui.context.pointerUp(action[1].x + 10, action[1].y + 10);
    const expected = selected === 'local' ? preferred : local;
    expect(ui.app.selectPeople).toHaveBeenCalledWith([expected.id]);
    expect(ui.app.equipmentTab).toBe('craft');
    expect(ui.app.craftWorkshopFilter).toBe(kind);
    expect(ui.town.craftReason(expected.id, smith.id, kind === Structure.Weaponsmith ? 'axe' : 'cap')).toBe(
      '',
    );
    local.faction = preferred.faction = 1;
    ui.draw(() => inspector.call(ui.app, new Rect(100, 100, 620, 420), true));
    expect(ui.controls.mock.calls.find(([id]) => id === 'workshop-craft')![3]).toBe(false);
  } finally {
    ui.dispose();
  }
});
