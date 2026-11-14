import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { parseFontMetrics } from '../../packages/native-ui/src/fonts';
import { Context, Rect } from '../../packages/native-ui/src';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Person, Race, Role } from '../../packages/engine/src/person';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { korean } from '../../packages/localization/src/korean';
import { GameAppState } from '../../apps/web/src/native/game-app-state';
import { inspector } from '../../apps/web/src/native/game-hud';
import { HomeState, homeState } from '../../apps/web/src/native/home-profiles-hud';
import type { GameHudApp } from '../../apps/web/src/native/game-hud-contract';

function world(): Town {
  const map = new WorldMap();
  map.columns = map.rows = 40;
  map.mapSeed = 5;
  map.origin = point(20, 20);
  map.tiles = Array.from({ length: 1600 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(81 * 81).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.stream.path = [point(26, 0), point(26, 40)];
  map.stream.width = [2, 2];
  for (let y = 0; y < 40; y++) for (let x = 25; x <= 26; x++) map.at(x, y).terrain = Terrain.Water;
  map.sites = [{ name: 'Test cave', kind: DungeonKind.Cave, origin: point(16, 16), discovered: true }];
  map.reveal(20, 20, 100);
  const town = new Town(map, 40, false);
  expect(town.place(Structure.Camp, point(20, 20), 0), town.canPlace(Structure.Camp, point(20, 20), 0).reason).toBe(true);
  town.completeConstruction();
  town.stock().add(new Resources(500, 500, 500, 100));
  town.folk = [];
  town.animals = [];
  town.beasts = [];
  return town;
}
function resident(town: Town, id: number, at = point(22, 23), auto = false): Person {
  const p = new Person(id, 'Res' + id, Role.Resident, Calling.Settler, Race.Human, 5 + id, at);
  p.home = p.village = town.camp()!.id;
  p.food = p.hydration = p.rest = p.health = 1;
  p.autoMode = auto;
  town.folk.push(p);
  town.nextPerson = Math.max(town.nextPerson, id + 1);
  return p;
}
function tent(town: Town, at = point(22.5, 16.5), built = true) {
  expect(town.place(Structure.Tent, at, 0), town.canPlace(Structure.Tent, at, 0).reason).toBe(true);
  const b = town.buildings().at(-1)!;
  if (built) b.progress = 1;
  return b;
}
let tvg: ThorVGNamespace;
class Pixels {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}
class MemoryCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return { putImageData() {}, clearRect() {} };
  }
}
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
type TestApp = GameHudApp & GameAppState;
function hud(width = 1024, height = 768) {
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
    town = world();
  const renderer = { visible: () => true, invalidatePresentation: vi.fn(), pick: () => null },
    app = new GameAppState(town, renderer as never, context) as TestApp;
  app.viewWidth = width;
  app.viewHeight = height;
  const focus = project(20, 20);
  app.camera = new Camera(focus.x, focus.y, 1.6);
  app.reducedMotion = () => true;
  app.selectPeople = (ids) => {
    app.chosen = [...ids];
    app.selected = -1;
  };
  const controls = vi.spyOn(context, 'control'),
    labels = vi.spyOn(context, 'text');
  canvas.add(context.scene());
  const panel = new Rect(16, 60, Math.min(420, width - 32), height - 120);
  return {
    app,
    town,
    controls,
    text: () => labels.mock.calls.map((call) => String(call[1])),
    control: (id: string) => controls.mock.calls.find((call) => call[0] === id),
    draw(fn: () => void) {
      controls.mockClear();
      labels.mockClear();
      context.begin(app.theme, new Rect(0, 0, width, height), 1);
      fn();
      context.end();
      canvas.update().render();
    },
    building: () => inspector.call(app, panel),
    objects: () => worldObjectPanel.call(app, panel),
    click(id: string) {
      const found = controls.mock.calls.find((call) => call[0] === id);
      if (!found) throw new Error(`Missing control ${id}`);
      const r = found[1];
      context.pointerMove(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerDown(r.x + r.w / 2, r.y + r.h / 2);
      context.pointerUp(r.x + r.w / 2, r.y + r.h / 2);
    },
    dispose() {
      canvas.remove();
      context.dispose();
      app.campResources.dispose();
      canvas.destroy();
    },
  };
}


const profiles = (ui: ReturnType<typeof hud>) =>
  ui.controls.mock.calls.filter((call) => String(call[0]).startsWith('home-profile-'));

describe('who lives here, in the inspector', () => {
  it('a camp shows its residents as profiles and its free beds', () => {
    const ui = hud();
    try {
      const { app, town } = ui,
        a = resident(town, 0),
        b = resident(town, 1);
      b.calling = Calling.Warrior;
      b.level = 3;
      app.selected = town.camp()!.id;
      ui.draw(ui.building);
      expect(profiles(ui).map((call) => call[0])).toEqual(['home-profile-0', 'home-profile-1']);
      expect(ui.text()).toContain('Residents 2 of 5  ·  3 beds free');
      expect(ui.text().filter((t) => t === 'Free bed')).toHaveLength(3);
      expect(ui.text()).toContain('Lv 3 · Warrior');
      expect(ui.text().some((t) => t.includes('Clear it'))).toBe(true);
      // The clear button stays below the profiles.
      expect(ui.control('clear-target')![1].y).toBeGreaterThan(ui.control('home-profile-1')![1].y);
      const before = { x: app.camera.x, y: app.camera.y };
      ui.click('home-profile-0');
      expect(app.chosen).toEqual([a.id]);
      expect({ x: app.camera.x, y: app.camera.y }).not.toEqual(before);
    } finally {
      ui.dispose();
    }
  });
  it('a tent lists only the residents whose home it is', () => {
    const ui = hud();
    try {
      const { app, town } = ui,
        b = tent(town);
      resident(town, 0);
      const c = resident(town, 1);
      c.home = b.id;
      app.selected = b.id;
      ui.draw(ui.building);
      expect(profiles(ui).map((call) => call[0])).toEqual(['home-profile-1']);
      expect(ui.text()).toContain('Residents 1 of 2  ·  1 bed free');
      c.home = -1;
      const d = resident(town, 2);
      d.home = b.id;
      const e = resident(town, 3);
      e.home = b.id;
      ui.draw(ui.building);
      expect(ui.text()).toContain('Residents 2 of 2  ·  No beds free');
      expect(ui.text()).not.toContain('Free bed');
      e.home = d.home;
      resident(town, 4).home = b.id;
      ui.draw(ui.building);
      expect(ui.text()).toContain('Residents 3  ·  No beds free');
    } finally {
      ui.dispose();
    }
  });
  it('marks asleep inside, at work, away beyond a gate, downed and wounded', () => {
    const ui = hud();
    try {
      const { town } = ui,
        camp = town.camp()!.id,
        p = resident(town, 0);
      p.activity = Activity.Felling;
      expect(homeState(town, p, camp)).toBe(HomeState.Work);
      p.activity = Activity.Expedition;
      expect(homeState(town, p, camp)).toBe(HomeState.Beyond);
      p.activity = Activity.Idle;
      p.downedAt = 1;
      expect(homeState(town, p, camp)).toBe(HomeState.Downed);
      p.downedAt = -1;
      town.shelterOf = () => camp;
      p.activity = Activity.Sleeping;
      expect(homeState(town, p, camp)).toBe(HomeState.Asleep);
      p.woundDays = 2;
      ui.app.selected = camp;
      ui.draw(ui.building);
      expect(ui.text()).toContain('z');
    } finally {
      ui.dispose();
    }
  });
  it('pages when more live there than fit', () => {
    const ui = hud();
    try {
      const { app, town } = ui;
      for (let i = 0; i < 12; i++) resident(town, i);
      app.selected = town.camp()!.id;
      ui.draw(ui.building);
      const first = profiles(ui).length;
      expect(first).toBeLessThan(12);
      expect(ui.control('residents-next')).toBeDefined();
      ui.click('residents-next');
      ui.draw(ui.building);
      expect(profiles(ui).length).toBe(12 - first);
      expect(profiles(ui)[0][0]).toBe(`home-profile-${first}`);
    } finally {
      ui.dispose();
    }
  });
  it('touch: the camp shows profiles at 390 wide with 44 px targets inside the screen', () => {
    const ui = hud(390, 844);
    try {
      const { app, town } = ui;
      for (let i = 0; i < 7; i++) resident(town, i);
      app.touchMode = true;
      app.selected = town.camp()!.id;
      ui.draw(ui.building);
      const shown = profiles(ui);
      expect(shown.length).toBeGreaterThan(0);
      for (const id of [...shown.map((call) => String(call[0])), 'residents-next', 'residents-prev']) {
        const r = ui.control(id)![1];
        expect(r.h).toBeGreaterThanOrEqual(44);
        expect(r.w).toBeGreaterThanOrEqual(44);
        expect(r.x + r.w).toBeLessThanOrEqual(390);
      }
      const b = tent(town);
      app.selected = b.id;
      ui.draw(ui.building);
      expect(ui.text()).toContain('Residents 0 of 2  ·  2 beds free');
    } finally {
      ui.dispose();
    }
  });
  it('every new line has Korean', () => {
    for (const line of [
      'Residents 2 of 5  ·  3 beds free',
      'Residents 1 of 2  ·  1 bed free',
      'Residents 2 of 2  ·  No beds free',
      'Residents 3  ·  No beds free',
      'Guests 1 of 3  ·  2 beds free',
      'Free bed',
      'At home',
      'Asleep inside',
      'At work',
      'Out and about',
      'Away beyond a gate',
      'Downed',
      'Wounded',
      'Click to select and look',
      'Lv 3 · Warrior',
      'Bo, Warrior, level 3',
    ])
      expect(korean.translate(line), line).not.toBe(line);
  });
});
