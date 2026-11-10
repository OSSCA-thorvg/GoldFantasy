import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { civicInspector } from '../../apps/web/src/native/game-civic-panel';
import { Structure, Resources } from '../../packages/engine/src/building-catalog';
import { Building } from '../../packages/engine/src/town-models';
import { Town } from '../../packages/engine/src/town';
import { Activity, Calling, Role, Person, Race } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { GameAppState, DockView } from '../../apps/web/src/native/game-app-state';
import { addInventory } from '../../packages/engine/src/equipment';
import { updateContextDock, renderDockContent } from '../../apps/web/src/native/game-context-dock';
import { rosterPanel, rosterBounds } from '../../apps/web/src/native/game-roster';
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
});
afterAll(() => {
  tvg.term();
  vi.unstubAllGlobals();
});
function fixture() {
  const canvas = new tvg.Canvas(new MemoryCanvas(880, 600) as any, {
    width: 880,
    height: 600,
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
    draw(fn: () => void) {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, 880, 600), 1);
      fn();
      context.end();
      canvas.update().render();
    },
    dispose() {
      canvas.remove();
      context.dispose();
      for (const entry of app.dockPortraits.values()) entry.paint.dispose();
      canvas.destroy();
    },
  };
}
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
    expect(ui.labels.mock.calls.some((call) => call[1] === 'Inspect unit')).toBe(true);
    ui.app.chosen = [player.id];
    ui.draw(() => personPanel.call(ui.app, personPanelBounds.call(ui.app, 880, 600, false)));
    expect(ui.controls.mock.calls.some((call) => call[0] === 'unit-auto')).toBe(false);
    expect(ui.app.commandCard).not.toHaveBeenCalled();
    expect(ui.labels.mock.calls.some((call) => String(call[1]).includes('Overwhelmed'))).toBe(true);
  } finally {
    ui.dispose();
  }
});

it('uses real altar eligibility and pending arrival state, and sends the selected resident through the Pray control', () => {
  const ui = fixture();
  try {
    const { altar } = civicTown(ui.town);
    ui.app.viewHeight = 800;
    ui.app.inspectorPerson = ui.town.folk[0].id;
    const order = vi.spyOn(ui.town, 'orderPrayAtAltar').mockReturnValue(true);
    const draw = () => ui.draw(() => civicInspector.call(ui.app, altar, new Rect(100, 200, 620, 286), true));
    draw();
    const action = ui.controls.mock.calls.find((call) => call[0] === 'altar-pray')!;
    expect(action[3]).toBe(true);
    ui.context.pointerDown(action[1].x + 10, action[1].y + 10);
    ui.context.pointerUp(action[1].x + 10, action[1].y + 10);
    expect(order).toHaveBeenCalledWith([ui.town.folk[0].id], altar.id);
    ui.town.folk[0].task = Activity.Praying;
    ui.town.folk[0].taskSite = altar.id;
    draw();
    expect(ui.labels.mock.calls.some((call) => call[1] === 'Prayer in progress')).toBe(true);
    expect(ui.controls.mock.calls.find((call) => call[0] === 'altar-pray')![3]).toBe(false);
    ui.town.folk[0].task = Activity.Idle;
    altar.devotionDueDay = 2;
    draw();
    expect(ui.labels.mock.calls.some((call) => call[1] === 'Awaiting a safe arrival at the gate')).toBe(true);
    expect(ui.controls.mock.calls.find((call) => call[0] === 'altar-pray')![3]).toBe(false);
  } finally {
    ui.dispose();
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
    ui.app.chosen = [p.id];
    expect(p.inventory.every((item) => item === null)).toBe(true);
    expect(p.equipment.tool1).toBe(-1);
    addInventory(p, 'axe');
    const draw = () =>
      ui.draw(() => personPanel.call(ui.app, personPanelBounds.call(ui.app, 880, 600, true)));
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
])('fits every bag and gear control inside the unit panel at %sx%s', (width, height) => {
  const ui = fixture();
  try {
    ui.app.chosen = [ui.town.folk[0].id];
    const panel = personPanelBounds.call(ui.app, width, height, true);
    ui.draw(() => personPanel.call(ui.app, panel));
    const grid = ui.controls.mock.calls.filter(
      (call) => call[0].startsWith('inventory-slot-') || call[0].startsWith('equipment-slot-'),
    );
    expect(grid).toHaveLength(25);
    for (const [id, r] of grid) {
      expect(r.x, id).toBeGreaterThanOrEqual(panel.x);
      expect(r.x + r.w, id).toBeLessThanOrEqual(panel.x + panel.w);
      expect(r.y, id).toBeGreaterThanOrEqual(panel.y);
      expect(r.y + r.h, id).toBeLessThanOrEqual(panel.y + panel.h - 36);
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
