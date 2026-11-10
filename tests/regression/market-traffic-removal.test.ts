import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { point, project } from '../../packages/engine/src/geometry';
import { AnimalKind, Calling, Monster, Person, Race, Role } from '../../packages/engine/src/person';
import { Agent, AgentKind, Traffic } from '../../packages/engine/src/traffic';
import { DungeonKind } from '../../packages/engine/src/world-types';
import type { Town } from '../../packages/engine/src/town';
import { SceneNode } from '../../packages/native-renderer/src/paint';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';

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
      putImageData: (image: Pixels) => (this.pixels = image.data.slice()),
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

it('ignores legacy decorative merchants while painting residents, paying guests, monsters and wildlife', () => {
  const width = 800,
    height = 240,
    zoom = 1.2,
    surface = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(surface as unknown as OffscreenCanvas, {
      width,
      height,
      enableDevicePixelRatio: false,
    }),
    state = new WorldRendererState(tvg),
    traffic = new Traffic(5),
    resident = new Person(1, 'Resident', Role.Resident, Calling.Settler, Race.Human, 499096, point(6, 14)),
    guest = new Person(2, 'Lodging guest', Role.Guest, Calling.Traveller, Race.Human, 899504, point(8, 12)),
    merchant = new Agent(3, AgentKind.Merchant, 93843, [point(10, 10), point(10.5, 9.5)]),
    monster = new Monster(4, 0, point(12, 8)),
    animal = new Monster(5, 0, point(14, 6));
  animal.animal = AnimalKind.Cow;
  const town = {
    people: () => [resident, guest],
    buildings: () => [],
    building: () => null,
    monsters: () => [monster],
    wildlife: () => [animal],
    hits: () => [],
    devotionEvents: () => [],
    clock: () => 1,
    map: () => ({
      giant: () => null,
      volcano: () => null,
      revealed: () => true,
      dungeons: () => [{ kind: DungeonKind.Cave }],
    }),
  } as unknown as Town;
  state.rows = Array.from({ length: 40 }, () => new SceneNode());
  for (const row of state.rows) state.objects.add(row);
  state.currentVisibility.sample = () => 255;
  state.world.transform([zoom, 0, width / 2, 0, zoom, 190 - project(10, 10).y * zoom, 0, 0, 1]);
  canvas.add(state.scene());
  const draw = () => {
    moveAgents(state, town, traffic, 1, []);
    state.scene();
    state.adapter.collect([state.root]);
    canvas.update().render();
    return createHash('sha256').update(surface.pixels).digest('hex');
  };
  const paintedPixels = (position: { x: number; y: number }) => {
    const x = Math.round(width / 2 + project(position.x, position.y).x * zoom);
    let painted = 0;
    for (let y = 100; y < 215; y++)
      for (let column = x - 55; column < x + 55; column++)
        if (surface.pixels[(y * width + column) * 4 + 3] > 32) painted++;
    return painted;
  };
  try {
    const actualUnits = draw(),
      retained = state.adapter.retainedPaintCount;
    for (const actor of [resident, guest, monster, animal])
      expect(paintedPixels(actor.position), `real actor ${actor.id} must remain visible`).toBeGreaterThan(20);
    expect(paintedPixels(merchant.position())).toBe(0);

    // A copied legacy preview can still contain traffic even when no new trips are generated.
    traffic.list.push(merchant);
    for (const travelled of [0, 0.2, 0.4]) {
      merchant.travelled = travelled;
      expect(draw(), 'decorative traffic must not change the rendered frame').toBe(actualUnits);
      expect(paintedPixels(merchant.position())).toBe(0);
      expect(state.adapter.retainedPaintCount).toBe(retained);
    }
  } finally {
    canvas.remove();
    state.dispose();
    canvas.destroy();
  }
});
