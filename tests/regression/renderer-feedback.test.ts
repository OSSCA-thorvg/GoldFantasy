import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Person, Calling, Role, Race, Activity, type Hit } from '../../packages/engine/src/person';
import { point } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import type { Town } from '../../packages/engine/src/town';
import { SceneNode, ShapeNode, TextNode, AnimationNode } from '../../packages/native-renderer/src/paint';
import { ceremonySeconds, type DevotionEvent } from '../../packages/engine/src/town-devotion';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { riseAnimation } from '../../packages/native-renderer/src/building-assets';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { PersonParts, personSprite } from '../../packages/native-renderer/src/world-sprites';
import { moveAgents, sparkle } from '../../packages/native-renderer/src/world-people';
import { WebCanvasAdapter } from '../../packages/native-renderer/src/webcanvas-adapter';
import { showEquipment } from '../../packages/native-renderer/src/person-equipment';
import { animateWork } from '../../packages/native-renderer/src/action-motion';

class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      putImageData: (p: Pixels) => {
        this.pixels = p.data.slice();
      },
      clearRect: () => this.pixels.fill(0),
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
function surface(width: number, height: number) {
  const target = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(target as any, { width, height, enableDevicePixelRatio: false });
  const adapter = new WebCanvasAdapter(tvg),
    root = new SceneNode();
  root.add(new ShapeNode().appendRect(0, 0, width, height).fill(84, 101, 86));
  return {
    root,
    adapter,
    target,
    draw(name: string) {
      canvas.remove();
      canvas.add(adapter.sync(root));
      adapter.collect([root]);
      canvas.update().render();
      if (process.env.CAPTURE_FEEDBACK) {
        mkdirSync('artifacts/renderer-feedback', { recursive: true });
        writeFileSync(
          `artifacts/renderer-feedback/${process.env.CAPTURE_FEEDBACK}-${name}-${width}x${height}.rgba`,
          target.pixels,
        );
      }
    },
    dispose() {
      canvas.remove();
      adapter.dispose();
      canvas.destroy();
    },
  };
}
function actor() {
  return new Person(0, 'Resident', Role.Resident, Calling.Warrior, Race.Human, 499096, point(6, 6));
}
function scene(person: Person, hits: Hit[] = []) {
  const s = new WorldRendererState(tvg);
  s.rows = Array.from({ length: 32 }, () => new SceneNode());
  s.currentVisibility.sample = () => 255;
  let time = 0.2;
  const foe = { position: point(5.6, 6), health: 1 };
  const town = {
    people: () => [person],
    person: () => null,
    buildings: () => [],
    building: () => null,
    monsters: () => [],
    wildlife: () => [],
    hits: () => hits,
    treeEvents: () => [],
    devotionEvents: () => [],
    creatureTarget: () => foe,
    clock: () => time,
    map: () => ({ giant: () => null, volcano: () => null }),
  } as unknown as Town;
  return {
    s,
    town,
    setTime: (value: number) => {
      time = value;
    },
  };
}
it('does not switch an in-range strike to walking or reverse facing for small combat spacing corrections', () => {
  const view = surface(640, 180),
    p = actor(),
    { s, town, setTime } = scene(p);
  p.activity = Activity.Fighting;
  p.foe = 5;
  p.ready = 1;
  try {
    for (let i = 0; i < 4; ++i) {
      p.position = point(6 + (i % 2 ? 0.001 : 0), 6);
      setTime(0.2 + i * 0.02);
      moveAgents(s, town, new Traffic(5), 0.2 + i * 0.02, []);
      const figure = s.figures.get(p.id)!;
      expect(figure.facing).toBe(-1);
      expect(figure.striding).toBe(false);
      expect(figure.parts.body!.matrix[4]).not.toBe(1);
    }
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('renders compact hammer and readable axe work poses through the actual WebCanvas renderer', () => {
  const view = surface(720, 360);
  try {
    for (const [row, tool] of (['hammer', 'axe'] as const).entries())
      for (const [col, phase] of [0, 0.45, 0.6, 0.78].entries()) {
        const p = actor(),
          parts = new PersonParts(),
          sprite = personSprite(p, parts);
        showEquipment(parts, tool);
        animateWork(parts, tool, phase, 0.9, 0.6);
        sprite.transform([5, 0, col * 180 + 70, 0, 5, row * 180 + 155, 0, 0, 1]);
        view.root.add(sprite);
      }
    view.draw('tools');
  } finally {
    view.dispose();
  }
});
it('keeps hit numbers filled without an outline', () => {
  const view = surface(100, 100),
    p = actor();
  const hit: Hit = {
    serial: 0n,
    from: point(6, 6),
    to: point(6.5, 6),
    damage: 17,
    onPerson: false,
    ranged: false,
    at: 0,
    person: p.id,
  };
  const { s, town } = scene(p, [hit]);
  try {
    sparkle(s, town, 0);
    expect(s.sparks).toHaveLength(1);
    expect((s.sparks[0].number as TextNode).stroke).toBeUndefined();
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('renders the altar through its actual build asset in every quarter turn', () => {
  const view = surface(800, 280);
  try {
    for (let i = 0; i < 4; ++i) {
      const layout = riseAnimation(Structure.Shrine, 5, [], (i * Math.PI) / 2),
        picture = new AnimationNode(layout.json).frame(layout.frames - 1),
        group = new SceneNode().transform([2.4, 0, i * 200 + 100, 0, 2.4, 205, 0, 0, 1]);
      picture.translate(-layout.originX, -layout.originY);
      group.add(picture);
      view.root.add(group);
      expect(layout.frames).toBeGreaterThan(0);
    }
    view.draw('altar');
  } finally {
    view.dispose();
  }
});

it('shows only actually equipped tools and keeps a real chase walking', () => {
  const view = surface(100, 100),
    p = actor(),
    { s, town } = scene(p);
  p.activity = Activity.Fighting;
  p.foe = 5;
  p.ready = 1;
  try {
    moveAgents(s, town, new Traffic(5), 0.2, []);
    const parts = s.figures.get(p.id)!.parts;
    for (const tool of ['sword', 'axe', 'pickaxe', 'hammer'] as const) expect(parts[tool]!.alpha).toBe(0);
    p.inventory[0] = { item: 'axe', quantity: 1 };
    p.equipment.tool1 = 1;
    moveAgents(s, town, new Traffic(5), 0.2, []);
    expect(parts.axe!.alpha).toBe(255);
    expect(parts.sword!.alpha).toBe(0);
    p.path = [point(7, 6)];
    moveAgents(s, town, new Traffic(5), 0.2, []);
    expect(s.figures.get(p.id)!.striding).toBe(true);
    expect(s.figures.get(p.id)!.facing).toBe(1);
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('uses the resident attacker on a person hit, without animating the victim as the striker', () => {
  const view = surface(100, 100),
    p = actor();
  const hit: Hit = {
    serial: 0n,
    from: point(6, 6),
    to: point(5.6, 6),
    damage: 1,
    onPerson: true,
    ranged: false,
    at: 0.15,
    person: 99,
    attacker: p.id,
  };
  const { s, town } = scene(p, [hit]);
  p.ready = 1.15;
  try {
    moveAgents(s, town, new Traffic(5), 0.2, []);
    expect(s.figures.get(p.id)!.parts.body!.matrix[4]).toBeLessThan(1);
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('bows outdoors with joined hands and grounded feet for the real altar ceremony', () => {
  const view = surface(800, 180),
    states: WorldRendererState[] = [];
  try {
    for (const [i, time] of [0, 0.5, 2.5, 4.6, 5].entries()) {
      const p = actor(),
        fixture = scene(p),
        { s, town } = fixture;
      states.push(s);
      const altar = new Building(12, Structure.Shrine, point(5.6, 6), 0, 5);
      town.building = () => altar;
      p.activity = Activity.Praying;
      p.target = altar.id;
      p.until = ceremonySeconds;
      fixture.setTime(time);
      moveAgents(s, town, new Traffic(5), time, []);
      const figure = s.figures.get(p.id)!;
      expect(figure.facing).toBe(-1);
      expect(figure.parts.body!.matrix[5]).toBe(0);
      for (const foot of figure.parts.feet) expect(foot!.matrix[5]).toBe(0);
      expect(figure.parts.body!.matrix[4]).toBeGreaterThan(0.85);
      if (time === 2.5) expect(figure.parts.body!.matrix[4]).toBeLessThan(0.9);
      for (const tool of ['sword', 'axe', 'hammer'] as const) expect(figure.parts[tool]!.alpha).toBe(0);
      figure.paint.transform([4, 0, i * 160 + 72, 0, 4, 150, 0, 0, 1]);
      view.root.add(figure.paint);
    }
    view.draw('prayer');
  } finally {
    for (const s of states) s.adapter.dispose();
    view.dispose();
  }
});
it('reveals only a real visible arrival and releases its native paints after the short effect', () => {
  const view = surface(240, 220),
    p = actor(),
    { s, town, setTime } = scene(p);
  const events: DevotionEvent[] = [];
  town.devotionEvents = () => events;
  const group = new SceneNode().transform([3, 0, 120, 0, 3, -390, 0, 0, 1]);
  for (const row of s.rows) group.add(row);
  group.add(s.combat);
  view.root.add(group);
  const render = (time: number) => {
    setTime(time);
    moveAgents(s, town, new Traffic(5), time, []);
    view.draw(`arrival-${time.toFixed(2)}`);
  };
  try {
    render(0);
    expect(s.combat.children).toHaveLength(0);
    const count = view.adapter.retainedPaintCount;
    events.push({ serial: 0n, altar: 12, person: p.id, at: 1, position: { ...p.position } });
    render(1);
    expect(s.combat.children).toHaveLength(1);
    expect(s.figures.get(p.id)!.paint.alpha).toBe(0);
    expect(view.adapter.retainedPaintCount).toBeGreaterThan(count);
    render(1.35);
    expect(s.figures.get(p.id)!.paint.alpha).toBeGreaterThan(0);
    expect(s.figures.get(p.id)!.paint.alpha).toBeLessThan(255);
    render(1.8);
    expect(s.figures.get(p.id)!.paint.alpha).toBe(255);
    render(2.6);
    expect(s.combat.children).toHaveLength(0);
    expect(view.adapter.retainedPaintCount).toBe(count);
    // Event history cannot replay an already consumed birth.
    render(2.7);
    expect(s.combat.children).toHaveLength(0);
    s.currentVisibility.sample = () => 0;
    events.push({ serial: 1n, altar: 12, person: p.id, at: 3, position: { ...p.position } });
    render(3.1);
    expect(s.combat.children).toHaveLength(0);
    expect(s.figures.get(p.id)!.paint.alpha).toBe(0);
    s.currentVisibility.sample = () => 255;
    render(3.2);
    expect(s.combat.children).toHaveLength(0);
    expect(s.figures.get(p.id)!.paint.alpha).toBe(255);
  } finally {
    s.adapter.dispose();
    view.dispose();
  }
});
it('renders real wearable accents only while equipped and restores the untouched clothing preset on removal', () => {
  const cases = [
    ['head', 'cap'],
    ['head', 'helmet'],
    ['body', 'leather-armor'],
    ['body', 'mail-armor'],
    ['body', 'robe'],
    ['accessory', 'cloak'],
    ['feet', 'boots'],
    ['hands', 'gloves'],
    ['offhand', 'shield'],
  ] as const;
  const view = surface(120, 160),
    montage = surface(1080, 160);
  try {
    for (const [i, [slot, item]] of cases.entries()) {
      const p = actor();
      p.level = 5;
      p.inventory[0] = { item, quantity: 1 };
      const holder = new SceneNode();
      view.root.add(holder);
      const render = () => {
        holder.remove();
        const parts = new PersonParts(),
          sprite = personSprite(p, parts);
        sprite.transform([5, 0, 60, 0, 5, 135, 0, 0, 1]);
        holder.add(sprite);
        view.draw('wearable-check');
        return view.target.pixels.slice();
      };
      const without = render();
      p.equipment[slot] = 1;
      const withItem = render();
      expect(withItem).not.toEqual(without);
      const parts = new PersonParts(),
        sprite = personSprite(p, parts);
      sprite.transform([5, 0, i * 120 + 60, 0, 5, 135, 0, 0, 1]);
      montage.root.add(sprite);
      p.equipment[slot] = -1;
      expect(render()).toEqual(without);
      view.root.remove(holder);
    }
    montage.draw('wearables');
  } finally {
    view.dispose();
    montage.dispose();
  }
});
it('renders barehanded and equipped combat poses without treating spacing corrections as walking', () => {
  const view = surface(960, 320),
    states: WorldRendererState[] = [];
  try {
    for (const [row, equipped] of [false, true].entries()) {
      for (const [col, phase] of [0, 0.2, 0.4, 0.55, 0.7, 0.9].entries()) {
        const p = actor(),
          { s, town, setTime } = scene(p);
        states.push(s);
        p.activity = Activity.Fighting;
        p.foe = 5;
        p.ready = 1.62;
        if (equipped) {
          p.inventory[0] = { item: 'axe', quantity: 1 };
          p.equipment.tool1 = 1;
        }
        moveAgents(s, town, new Traffic(5), 0, []);
        p.position.x += 0.001;
        setTime(phase);
        moveAgents(s, town, new Traffic(5), phase, []);
        const figure = s.figures.get(p.id)!;
        expect(figure.striding).toBe(false);
        expect(figure.facing).toBe(-1);
        figure.paint.transform([-4.5, 0, col * 160 + 92, 0, 4.5, row * 160 + 135, 0, 0, 1]);
        view.root.add(figure.paint);
      }
    }
    view.draw('combat');
  } finally {
    for (const s of states) s.adapter.dispose();
    view.dispose();
  }
});
