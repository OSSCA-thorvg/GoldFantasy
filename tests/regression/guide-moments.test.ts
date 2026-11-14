import { afterEach, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Person, Race, Role, TreeWorkKind } from '../../packages/engine/src/person';
import { CombatCue } from '../../packages/engine/src/combat-events';
import { Camera, point, project, type Point } from '../../packages/engine/src/geometry';
import { Order, Tool } from '../../packages/engine/src/game-tools';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { Cue, Sound } from '../../packages/native-audio/src/sound-types';
import { hasHangul, setLocale, translate } from '../../packages/localization/src/index';
import { guidePhrases } from '../../packages/localization/src/korean/guide';
import { CombatHudState } from '../../apps/web/src/native/game-combat-hud';
import { ArmyState } from '../../apps/web/src/native/army-state';
import { GuideState, guideFrame, guideRules, guideUnread, dismissGuideCard, type GuideApp } from '../../apps/web/src/native/game-guide';
import { fill, guideMoments } from '../../apps/web/src/native/guide-moments';
import { guidePreferences, reloadGuidePreferences, setGuidePreference } from '../../apps/web/src/native/guide-preferences';

/** A small settled shore: a camp, a discovered cave and two founders, as a new game would have them. */
function settlement(): { town: Town; people: Person[] } {
  const map = new WorldMap();
  map.columns = map.rows = 48;
  map.mapSeed = 5;
  map.origin = { x: 12, y: 12 };
  map.tiles = Array.from({ length: 48 * 48 }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array(97 * 97).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [{ name: 'Cave', kind: DungeonKind.Cave, origin: { x: 38, y: 38 }, discovered: true }];
  map.reveal(24, 24, 100);
  const town = new Town(map, 48, false);
  town.placed.push(new Building(0, Structure.Camp, point(12, 12), 0, 0));
  town.nextId = 1;
  town.migrateSettlements();
  town.folk = [];
  town.nextPerson = 0;
  const people = [point(14, 12), point(15, 13)].map((at, i) => {
    const p = new Person(town.nextPerson++, ['Askr', 'Embla'][i], Role.Resident, Calling.Warrior, Race.Human, 0, at);
    p.home = p.village = 0;
    town.folk.push(p);
    return p;
  });
  town.tick(0);
  return { town, people };
}
/** The guide on its own, with a stand-in for the rest of the game around it. */
function harness(town: Town) {
  let now = 0;
  const app = {
    town,
    camera: new Camera(0, 0, 1),
    viewWidth: 1280,
    viewHeight: 800,
    renderer: { visible: () => true, invalidatePresentation: () => {} },
    context: { time: () => now },
    tool: Tool.Select,
    pending: Order.None,
    panFrom: null,
    boxFrom: null,
    fieldFrom: null,
    roadPress: null,
    roadStroke: [],
    touchGesture: null,
    sceneDragAt: null,
    pan: point(),
    cues: [],
    combatHud: new CombatHudState(),
    army: new ArmyState(),
    prayer: null,
    hoveredWorldTarget: null,
    guide: new GuideState(),
  };
  const game = app as unknown as GuideApp;
  return {
    app,
    game,
    step(seconds = 0.05) {
      now += seconds;
      guideFrame(game);
      game.guide.drawnAt = now;
    },
    run(seconds: number) {
      for (let t = 0; t < seconds; t += 0.05) this.step();
    },
    keys: () => game.guide.log.map((e) => e.key),
  };
}
/** A new game: the first frame is taken while the founders wait, then the wait ends. */
function newGame() {
  const world = settlement(),
    h = harness(world.town);
  world.town.awaiting = true;
  h.step();
  return { ...world, h };
}
const count = (town: Town, key: string) => town.told.filter((k) => k === key).length;
const fell = (town: Town, p: Person, kind = TreeWorkKind.Fall, at: Point = point(30, 20)) =>
  town.timberEvents.push({ serial: town.nextTreeEvent++, kind, person: p.id, cell: 0, index: 0, worker: at, at: town.clock() });

afterEach(() => {
  setLocale('ENG');
  setGuidePreference('cards', true);
  setGuidePreference('focus', true);
});

describe('first-time moments', () => {
  it('open a new game with the wait for the first order, without moving the camera', () => {
    const { town, h } = newGame();
    expect(h.game.guide.card?.entry.key).toBe('opening');
    expect([h.game.camera.x, h.game.camera.y]).toEqual([0, 0]);
    // The gate the map starts with is out of view: it is no news yet.
    expect(h.keys().slice(0, 2)).toEqual(['opening', 'built:Camp']);
    town.awaiting = false;
    h.step();
    expect(h.game.guide.card?.entry.key).toBe('built:Camp');
  });
  it('tells of a gate only when it first stands in view, and leaves the camera where the player put it', () => {
    const { town, h } = newGame(),
      front = project(39, 40.3);
    town.awaiting = false;
    h.run(1);
    expect(count(town, 'gate')).toBe(0);
    // In view but still under fog does not count either.
    h.game.camera.x = front.x;
    h.game.camera.y = front.y;
    h.app.renderer.visible = () => false;
    h.run(1);
    expect(count(town, 'gate')).toBe(0);
    h.app.renderer.visible = () => true;
    h.run(1);
    expect(count(town, 'gate')).toBe(1);
    expect([h.game.camera.x, h.game.camera.y]).toEqual([front.x, front.y]);
  });
  const triggers: [string, (town: Town, p: Person) => void][] = [
    ['wood', (town, p) => fell(town, p)],
    ['stone', (town, p) => fell(town, p, TreeWorkKind.Shatter)],
    ['kill', (town, p) => town.emit(CombatCue.Kill, point(20, 20), { person: p.id, creature: 900 })],
    ['level', (town, p) => town.emit(CombatCue.LevelUp, p.position, { person: p.id, amount: 2 })],
    ['skill', (town, p) => town.emit(CombatCue.Ability, p.position, { person: p.id, text: 'Challenge', skill: 'challenge' })],
    ['downed', (town, p) => town.emit(CombatCue.Downed, p.position, { person: p.id })],
    ['wave', (town) => town.emit(CombatCue.Wave, point(40, 40), { amount: 12 })],
    ['den-destroyed', (town) => town.emit(CombatCue.DenDestroyed, point(40, 40), { creature: 901 })],
    ['craft', (town, p) => town.notify(`${p.name} crafted Wooden axe`)],
    ['night', (town) => town.editHour(23)],
    ['built:Farm', (town) => town.placed.push(new Building(town.nextId++, Structure.Farm, point(20, 14), 0, 0))],
  ];
  it.each(triggers)('tells %s once and only once', (key, trigger) => {
    const { town, people, h } = newGame();
    expect(count(town, key)).toBe(0);
    trigger(town, people[0]);
    h.step();
    expect(count(town, key)).toBe(1);
    const logged = h.keys().length;
    for (let i = 0; i < 3; ++i) {
      trigger(town, people[i % 2]);
      h.run(0.2);
    }
    expect(count(town, key)).toBe(1);
    expect(h.keys().filter((k) => k === key)).toHaveLength(1);
    expect(h.keys().length).toBe(logged);
  });
  it('folds the first crafting notices into the guide and leaves later ones as notices', () => {
    const { town, people, h } = newGame();
    town.notices.length = 0;
    town.notify('Askr crafted Wooden axe');
    town.notify('Wooden axe in hand · Fells trees faster');
    h.step();
    expect(town.notices).toEqual([]);
    const craft = h.game.guide.log.find((e) => e.key === 'craft');
    expect(craft?.detail).toEqual(['Askr crafted Wooden axe']);
    expect(craft?.at).toEqual(people[0].position);
    expect(h.game.guide.log.find((e) => e.key === 'equip')?.detail).toEqual(['Wooden axe in hand · Fells trees faster']);
    town.notify('Embla crafted Wooden pick');
    h.step();
    expect(town.notices).toEqual(['Embla crafted Wooden pick']);
  });
  it('keeps what was told across a save, and a loaded game repeats none of it', () => {
    const { town, people, h } = newGame();
    fell(town, people[0]);
    h.step();
    const save = encodeTown(town),
      loaded = decodeTown(save, (map) => new Town(map, 48, false, true));
    expect(loaded.told).toEqual(town.told);
    const again = harness(loaded);
    again.step();
    expect(loaded.told).toEqual(town.told);
    expect(again.keys()).toEqual(town.told);
    expect(again.game.guide.log.every((e) => e.day === null)).toBe(true);
    expect(again.game.guide.card).toBeNull();
    fell(loaded, loaded.people()[0]);
    again.step();
    expect(count(loaded, 'wood')).toBe(1);
  });
  it('marks what an older save has plainly met, silently', () => {
    const { town, people } = settlement();
    town.placed.push(new Building(town.nextId++, Structure.Farm, point(20, 14), 0, 0));
    town.chronicle.monstersSlain = 3;
    town.days = 3;
    people[0].level = 3;
    const save = encodeTown(town);
    expect(Number.parseInt(save.slice(17, 19), 16)).toBeLessThan(17);
    const old = decodeTown(save, (map) => new Town(map, 48, false, true)),
      h = harness(old);
    h.step();
    for (const key of ['opening', 'gate', 'built:Camp', 'built:Farm', 'kill', 'level', 'monster', 'wood', 'night'])
      expect(old.told, key).toContain(key);
    for (const key of ['death', 'built:Guild', 'sealed', 'craft']) expect(old.told, key).not.toContain(key);
    expect(h.game.guide.card).toBeNull();
    expect(h.game.guide.queue).toEqual([]);
    expect(guideUnread(h.game.guide)).toBe(0);
    old.emit(CombatCue.Kill, point(20, 20), { person: old.people()[0].id, creature: 900 });
    h.step();
    expect(count(old, 'kill')).toBe(1);
    expect(h.game.guide.card).toBeNull();
  });
});

describe('the camera', () => {
  const target = point(30, 20),
    aim = project(target.x, target.y);
  /** A new game past its opening, with the tree felled far from the view. */
  function felled(busy: (h: ReturnType<typeof harness>, people: Person[]) => void) {
    const { town, people, h } = newGame();
    town.awaiting = false;
    h.game.guide.queue = [];
    h.game.guide.card = null;
    busy(h, people);
    fell(town, people[0], TreeWorkKind.Fall, target);
    h.step();
    return { town, h };
  }
  it('eases to the place over about 0.6 s when the player is not busy', () => {
    const { h } = felled(() => {});
    expect(h.game.guide.card?.entry.key).toBe('wood');
    expect(h.game.guide.card?.looked).toBe(true);
    h.run(0.3);
    expect(h.game.camera.x).not.toBe(aim.x);
    expect(Math.abs(h.game.camera.x)).toBeGreaterThan(0);
    h.run(0.5);
    expect([h.game.camera.x, h.game.camera.y]).toEqual([aim.x, aim.y]);
  });
  it.each<[string, (h: ReturnType<typeof harness>, people: Person[]) => void]>([
    ['dragging the view', (h) => (h.game.panFrom = point(10, 10))],
    ['placing a building', (h) => (h.game.tool = Tool.Farm)],
    ['drawing a road', (h) => (h.game.tool = Tool.Road)],
    ['choosing an order target', (h) => (h.game.pending = Order.Attack)],
    ['having just given an order', (h) => h.game.cues.push(new Sound(Cue.Order))],
    ['having just moved the camera', (h) => (h.step(), (h.game.camera.x = 50), h.step())],
    [
      'fighting on screen',
      (h, people) => {
        people[0].activity = Activity.Fighting;
        const at = project(people[0].position.x, people[0].position.y);
        h.game.camera.x = at.x;
        h.game.camera.y = at.y;
        h.game.guide.camera = { x: at.x, y: at.y, zoom: 1 };
      },
    ],
  ])('stays with the player while %s and offers Look instead', (_, busy) => {
    const { h } = felled(busy);
    const before = { x: h.game.camera.x, y: h.game.camera.y };
    expect(h.game.guide.card?.entry.key).toBe('wood');
    expect(h.game.guide.card?.looked).toBe(false);
    expect(h.game.guide.card?.entry.at).toEqual(target);
    h.game.cues.length = 0;
    h.run(1);
    expect({ x: h.game.camera.x, y: h.game.camera.y }).toEqual(before);
  });
  it('does not move with camera focus turned off', () => {
    const { h } = felled(() => setGuidePreference('focus', false));
    expect(h.game.guide.card?.looked).toBe(false);
    h.run(1);
    expect([h.game.camera.x, h.game.camera.y]).toEqual([0, 0]);
  });
});

describe('cards and the log', () => {
  it('shows one card at a time; of a burst the first shows and the newest three wait, and the log keeps all', () => {
    const { town, people, h } = newGame();
    town.awaiting = false;
    h.step();
    h.game.guide.queue = [];
    dismissGuideCard(h.game);
    const before = h.keys().length;
    const [p] = people;
    fell(town, p);
    fell(town, p, TreeWorkKind.Shatter);
    town.emit(CombatCue.Kill, point(20, 20), { person: p.id, creature: 900 });
    town.emit(CombatCue.LevelUp, p.position, { person: p.id, amount: 2 });
    town.notify('Askr crafted Wooden axe');
    town.placed.push(new Building(town.nextId++, Structure.Farm, point(20, 14), 0, 0));
    h.step();
    const fired = h.keys().slice(before);
    expect(fired).toEqual(['wood', 'stone', 'craft', 'monster', 'kill', 'level', 'built:Farm']);
    expect(h.game.guide.card?.entry.key).toBe('wood');
    expect(h.game.guide.queue.map((e) => e.key)).toEqual(['kill', 'level', 'built:Farm']);
    expect(h.game.guide.log.at(-1)?.day).toBe(town.days + 1);
    dismissGuideCard(h.game);
    h.step();
    expect(h.game.guide.card?.entry.key).toBe('kill');
  });
  it('lets a card go after its time, and holds the next while the downed banner speaks', () => {
    const { town, people, h } = newGame();
    town.awaiting = false;
    h.step();
    h.game.guide.queue = [];
    dismissGuideCard(h.game);
    h.game.combatHud.autoPause = { title: 'Askr is down', detail: '', at: people[0].position, person: 0, creature: -1 };
    town.emit(CombatCue.Downed, people[0].position, { person: people[0].id });
    h.run(1);
    expect(h.keys()).toContain('downed');
    expect(h.game.guide.card).toBeNull();
    h.game.combatHud.autoPause = null;
    h.step();
    expect(h.game.guide.card?.entry.key).toBe('downed');
    h.run(guideRules.cardSeconds + 0.5);
    expect(h.game.guide.card).toBeNull();
  });
  it('fills only the log with cards turned off', () => {
    setGuidePreference('cards', false);
    const { town, people, h } = newGame();
    expect(h.game.guide.card).toBeNull();
    fell(town, people[0]);
    h.step();
    expect(h.keys()).toContain('wood');
    expect(h.game.guide.card).toBeNull();
    expect(guideUnread(h.game.guide)).toBe(h.keys().length);
  });
  it('remembers the two settings in the browser', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
      stored = new Map<string, string>(),
      storage = { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => void stored.set(k, v) };
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    try {
      reloadGuidePreferences();
      expect(guidePreferences()).toEqual({ focus: true, cards: true });
      setGuidePreference('cards', false);
      reloadGuidePreferences();
      expect(guidePreferences()).toEqual({ focus: true, cards: false });
      setGuidePreference('focus', false);
      reloadGuidePreferences();
      expect(guidePreferences()).toEqual({ focus: false, cards: false });
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      reloadGuidePreferences();
    }
  });
});

describe('words', () => {
  it('has Korean for every title and line of every moment', () => {
    const { town } = settlement(),
      lines = new Set<string>();
    for (const moment of guideMoments) {
      lines.add(fill(moment.title));
      for (const text of moment.text(town)) lines.add(fill(text));
    }
    setLocale('KR');
    for (const text of lines) {
      const korean = translate(text);
      expect(hasHangul(korean), text).toBe(true);
      // Only keys and units stay in Latin letters.
      expect(korean.match(/[A-Za-z]{2,}/g)?.filter((w) => !['kg', 'Space'].includes(w)) ?? [], text).toEqual([]);
    }
    expect(guideMoments.map((m) => m.key)).toContain('built:Workbench');
    for (const text of [
      'Guide',
      'Guide (F1)',
      'Every first-time explanation, to read again.',
      'Every first-time explanation, newest first.',
      'Got it',
      'Look',
      'Day 3',
      '2 more waiting',
      'Camera focus: On',
      'Camera focus: Off',
      'Cards: On',
      'Cards: Off',
      'Newer',
      'Older',
      '1–4 of 12',
      'Earlier',
      'Nothing yet. An explanation is written here the first time something happens.',
      'Askr joins the settlement',
      'Askr used Challenge',
      'Askr learned Whirl',
    ])
      expect(hasHangul(translate(text)), text).toBe(true);
  });
  it('writes Korean only in syllables the subset font carries', () => {
    const decoder = new TextDecoder('euc-kr'),
      carried = new Set<string>();
    for (let lead = 0xb0; lead < 0xc9; ++lead)
      for (let trail = 0xa1; trail < 0xff; ++trail) carried.add(decoder.decode(new Uint8Array([lead, trail])));
    const used = new Set([...Object.values(guidePhrases).join('')].filter((c) => /[가-힣]/.test(c)));
    expect([...used].filter((c) => !carried.has(c))).toEqual([]);
  });
});
