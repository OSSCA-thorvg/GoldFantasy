import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, makeTile } from '../../packages/engine/src/world-types';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import {
  Camera,
  distance,
  point,
  project,
  segmentDistance,
  sub,
  unproject,
  type Point,
} from '../../packages/engine/src/geometry';
import { flatten, sharpAnchor, type RoadPath } from '../../packages/engine/src/road-network';
import {
  roadDraft,
  roadPoint,
  sampleRoad,
  toScreen,
  type GameInputApp,
} from '../../apps/web/src/native/game-input';

function settlement(): Town {
  const size = 64,
    map = new WorldMap();
  map.columns = map.rows = size;
  map.mapSeed = 5;
  map.origin = { x: 30, y: 30 };
  map.tiles = Array.from({ length: size * size }, () => ({ ...makeTile(), terrain: Terrain.Grass, revealed: true }));
  map.layers = Array.from({ length: Layer.Count }, () => new Float32Array((size * 2 + 1) ** 2).fill(0.4));
  map.layer(Layer.Land).fill(1);
  map.layer(Layer.Ridge).fill(-1);
  map.sites = [];
  map.reveal(size / 2, size / 2, size * 2);
  const town = new Town(map, size, false);
  town.placed.push(new Building(0, Structure.Camp, point(30, 30), 0, 0));
  town.nextId = 1;
  town.migrateSettlements();
  return town;
}
/** Tiles measured from the camp, as every stroke below is described. */
const at = (x: number, y: number): Point => point(30 + x, 30 + y);
/** The two roads the strokes meet: along y = 0 from the camp, and along y = 5. */
function withRoads(town: Town): Town {
  for (const y of [0, 5]) {
    const id = town.roads().add([sharpAnchor(at(1.2, y)), sharpAnchor(at(8, y))], 1);
    town.roads().road(id)!.village = town.camp()!.id;
  }
  return town;
}
// Only the pointer events are staged; sampling and drafting are the real input handlers.
function controls(town: Town, zoom = 1): GameInputApp {
  const focus = project(34, 32.5),
    app = {
      town,
      camera: new Camera(focus.x, focus.y, zoom),
      viewWidth: 1280,
      viewHeight: 800,
      mouse: point(),
      cursor: point(),
      roadPress: null,
      roadStroke: [],
      roadMoved: false,
      status: '',
    } as unknown as GameInputApp;
  app.toScreen = toScreen.bind(app);
  app.roadPoint = roadPoint.bind(app);
  app.sampleRoad = sampleRoad.bind(app);
  app.roadDraft = roadDraft.bind(app);
  return app;
}
function draw(app: GameInputApp, pointer: readonly Point[], each?: (path: RoadPath) => void): RoadPath {
  pointer.forEach((screen, i) => {
    const ground = app.camera.toWorld(screen, app.viewWidth, app.viewHeight);
    app.mouse = { ...screen };
    app.cursor = unproject(ground.x, ground.y);
    if (i) app.sampleRoad();
    else {
      app.roadStroke = [{ ...app.cursor }];
      app.roadPress = { ...screen };
      app.roadMoved = false;
    }
    each?.(app.roadDraft());
  });
  return app.roadDraft();
}
/** Pointer events along straight edges between world vertices, `moves` of them inside each edge. */
function edges(app: GameInputApp, vertices: readonly Point[], moves: number): Point[] {
  const screen = vertices.map((p) => app.toScreen(p)),
    events = [screen[0]];
  for (let edge = 1; edge < screen.length; ++edge) {
    const a = screen[edge - 1],
      b = screen[edge];
    for (let i = 1; i <= moves; ++i) {
      const share = i / (moves + 1);
      events.push(point(a.x + (b.x - a.x) * share, a.y + (b.y - a.y) * share));
    }
    events.push(b);
  }
  return events;
}
/** A hand following world vertices: an event every few pixels, wavering by `sway` pixels. */
function hand(app: GameInputApp, vertices: readonly Point[], sway = 1): Point[] {
  const screen = vertices.map((p) => app.toScreen(p)),
    events: Point[] = [];
  let step = 0;
  for (let edge = 1; edge < screen.length; ++edge) {
    const a = screen[edge - 1],
      b = screen[edge],
      count = Math.max(1, Math.round(distance(a, b) / 4));
    for (let i = edge === 1 ? 0 : 1; i <= count; ++i, ++step) {
      const drift = sway * (0.7 * Math.sin(step * 0.31) + 0.3 * Math.sin(step * 1.9 + 1));
      events.push(point(a.x + ((b.x - a.x) * i) / count + drift * 0.45, a.y + ((b.y - a.y) * i) / count + drift));
    }
  }
  return events;
}
const drawn = (app: GameInputApp, path: RoadPath): Point[] => flatten(path, 0.05).map((p) => app.toScreen(p));
/** Furthest any pointer event lies from the drawn road, in screen pixels. */
function strays(app: GameInputApp, pointer: readonly Point[], path: RoadPath): number {
  const line = drawn(app, path);
  let worst = 0;
  for (const event of pointer) {
    let gap = Infinity;
    for (let i = 1; i < line.length; ++i) gap = Math.min(gap, segmentDistance(event, line[i - 1], line[i]));
    worst = Math.max(worst, gap);
  }
  return worst;
}
/** Sharpest change of direction along the drawn road, in degrees. */
function sharpestBend(app: GameInputApp, path: RoadPath): number {
  const line = flatten(path, 0.25).map((p) => app.toScreen(p));
  let worst = 0;
  for (let i = 2; i < line.length; ++i) {
    const before = sub(line[i - 1], line[i - 2]),
      after = sub(line[i], line[i - 1]),
      size = Math.hypot(before.x, before.y) * Math.hypot(after.x, after.y);
    if (size < 1e-6) continue;
    const cosine = Math.min(1, Math.max(-1, (before.x * after.x + before.y * after.y) / size));
    worst = Math.max(worst, (Math.acos(cosine) * 180) / Math.PI);
  }
  return worst;
}
const onRoad = (town: Town, p: Point): number => town.roads().distance(p).distance;
function expectAt(actual: Point, expected: Point, digits = 3): void {
  expect(actual.x, JSON.stringify(actual)).toBeCloseTo(expected.x, digits);
  expect(actual.y, JSON.stringify(actual)).toBeCloseTo(expected.y, digits);
}

describe('drawing a road between existing roads', () => {
  it.each([0, 1, 12])('connects two roads with %i pointer events on the way', (moves) => {
    const app = controls(withRoads(settlement())),
      events = edges(app, [at(4, 0), at(4, 5)], moves),
      path = draw(app, events);
    expect(path.length).toBe(2);
    expectAt(path[0].point, at(4, 0));
    expectAt(path[1].point, at(4, 5));
    expect(app.town.buildRoad(path), app.town.canBuildRoad(path).reason).toBe(true);
    // Drawing over the road just built adds nothing, however sparse the events.
    expect(draw(app, events)).toEqual([]);
  });
  it.each([0, 12])('keeps the corners of an L and a triangle with %i pointer events per edge', (moves) => {
    const app = controls(withRoads(settlement()));
    const cases: { name: string; stroke: [number, number][]; end: Point; corner?: Point }[] = [
      { name: 'L on new ground', stroke: [[3, 0], [3, 3], [7, 3]], end: at(7, 3), corner: at(3, 3) },
      { name: 'L that ends by following a road', stroke: [[3, 0], [3, 5], [7, 5]], end: at(3, 5) },
      { name: 'L drawn just beside that road', stroke: [[3, 0], [3, 5.2], [7, 5.2]], end: at(3, 5) },
      { name: 'L whose tail drifts back onto the road', stroke: [[3, 0], [3, 5.2], [7, 5]], end: at(3, 5) },
      { name: 'triangle closed along a road', stroke: [[3, 0], [7, 5], [7, 0], [3, 0]], end: at(7, 0), corner: at(7, 5) },
      { name: 'triangle closed beside a road', stroke: [[3, 0], [7, 5], [7, 0.2], [3, 0.2]], end: at(7, 0), corner: at(7, 5) },
    ];
    for (const { name, stroke, end, corner } of cases) {
      const path = draw(app, edges(app, stroke.map(([x, y]) => at(x, y)), moves));
      expect(app.town.canBuildRoad(path).reason, name).toBe('');
      expectAt(path[0].point, at(3, 0));
      expectAt(path.at(-1)!.point, end);
      if (corner)
        expect(path.some((anchor) => distance(anchor.point, corner) < 0.001), `${name}: ${JSON.stringify(path)}`).toBe(
          true,
        );
    }
  });
  it.each([0, 12])('draws an L and a closed triangle from the camp with %i pointer events per edge', (moves) => {
    const app = controls(settlement());
    for (const stroke of [
      [at(1.2, 0), at(6, 0), at(6, 4)],
      [at(1.2, 0), at(6, 0), at(6, 4), at(1.2, 0)],
    ]) {
      const path = draw(app, edges(app, stroke, moves));
      expect(app.town.canBuildRoad(path).reason).toBe('');
      expect(path.length).toBe(stroke.length);
      stroke.forEach((vertex, i) => expectAt(path[i].point, vertex));
    }
  });
  it('ends an L beside a building where it arrives instead of cutting through the building', () => {
    const app = controls(withRoads(settlement()));
    app.town.placed.push(new Building(app.town.nextId++, Structure.Tent, at(5, 2.5), 0, 0));
    expect(app.town.canBuildRoad([sharpAnchor(at(3, 0)), sharpAnchor(at(7, 5))]).reason).toBe('Building in the way');
    const path = draw(app, edges(app, [at(3, 0), at(3, 5.2), at(7, 5.2)], 0));
    expect(app.town.canBuildRoad(path).reason).toBe('');
    expect(path.every((anchor) => Math.abs(anchor.point.x - at(3, 0).x) < 0.001)).toBe(true);
  });
});

describe('how a hand-drawn stroke becomes a road', () => {
  it.each([
    ['straight across', at(4, 0.5), at(4, 4)],
    ['at a slant', at(3, 0.5), at(6.5, 4)],
  ])('keeps a straight stroke pressed beside a road straight: %s', (_, from, to) => {
    const app = controls(withRoads(settlement()), 1.4),
      events = hand(app, [from, to]),
      path = draw(app, events);
    expect(app.town.canBuildRoad(path).reason).toBe('');
    expect(path.length).toBe(2);
    expect(onRoad(app.town, path[0].point)).toBeLessThan(0.01);
    expectAt(path[1].point, to, 1);
    expect(strays(app, events, path)).toBeLessThan(4);
  });
  it('lets a stroke that leaves alongside a road branch off where it was pressed, without a dog-leg', () => {
    const app = controls(withRoads(settlement()), 1.4),
      events = hand(app, [at(2, 0.5), at(7.5, 1.6)]),
      path = draw(app, events);
    expect(app.town.canBuildRoad(path).reason).toBe('');
    expect(onRoad(app.town, path[0].point)).toBeLessThan(0.01);
    // The part drawn beside the road is kept: the road begins by the press, not where the stroke got clear.
    expect(distance(path[0].point, at(2, 0))).toBeLessThan(0.4);
    expect(sharpestBend(app, path)).toBeLessThan(20);
    expect(strays(app, events.slice(Math.floor(events.length * 0.4)), path)).toBeLessThan(4);
  });
  it('carries a stroke that stops short of a road straight on to it', () => {
    const app = controls(withRoads(settlement()), 1.4),
      events = hand(app, [at(2, 1), at(5.4, 4.4)]),
      path = draw(app, events);
    expect(app.town.canBuildRoad(path).reason).toBe('');
    expect(path.length).toBe(2);
    expect(onRoad(app.town, path[1].point)).toBeLessThan(0.01);
    expectAt(path[1].point, at(6, 5), 0);
    expect(strays(app, events, path)).toBeLessThan(4);
  });
  it('eases a stroke that comes in alongside a road onto it where the two meet', () => {
    const app = controls(withRoads(settlement()), 1.4),
      events = hand(app, [at(2, 2.5), at(7.5, 4.95)]),
      path = draw(app, events);
    expect(app.town.canBuildRoad(path).reason).toBe('');
    expect(onRoad(app.town, path.at(-1)!.point)).toBeLessThan(0.01);
    expect(sharpestBend(app, path)).toBeLessThan(20);
  });
  it('starts the new road where a stroke that first follows a road leaves it', () => {
    const app = controls(withRoads(settlement()), 1.4),
      events = hand(app, [at(2, 0.1), at(5, -0.1), at(5.3, 4)]),
      path = draw(app, events);
    expect(app.town.canBuildRoad(path).reason).toBe('');
    expect(path.length).toBe(2);
    expect(distance(path[0].point, at(5, 0))).toBeLessThan(0.35);
    expectAt(path[1].point, at(5.3, 4), 1);
  });
  it('starts at the edge of a building the stroke began on, and ends at the edge of one it ended on', () => {
    const fromCamp = controls(settlement(), 1.4),
      camp = fromCamp.town.camp()!,
      out = draw(fromCamp, hand(fromCamp, [at(0.1, -0.1), at(4, 1)]));
    expect(fromCamp.town.canBuildRoad(out).reason).toBe('');
    expect(camp.footprint().contains(out[0].point, 0.2)).toBe(false);
    expect(camp.footprint().contains(out[0].point, 0.3)).toBe(true);

    const toHouse = controls(withRoads(settlement()), 1.4),
      house = new Building(toHouse.town.nextId++, Structure.Cottage, at(4, -3), 0, 0);
    toHouse.town.placed.push(house);
    const into = draw(toHouse, hand(toHouse, [at(4, 0), at(4.1, -2.9)]));
    expect(toHouse.town.canBuildRoad(into).reason).toBe('');
    expect(house.footprint().contains(into.at(-1)!.point, 0.2)).toBe(false);
    expect(house.footprint().contains(into.at(-1)!.point, 0.3)).toBe(true);
  });
  it('does not turn a wavering hand or the settling at press and release into road shape', () => {
    const app = controls(settlement(), 1.4),
      wavering = draw(app, hand(app, [at(1.2, 0), at(8, 1.5)], 3.2));
    expect(wavering.length).toBe(2);
    // A few pixels the wrong way at the press, and a small overshoot pulled back at the release.
    const hooked = draw(app, hand(app, [at(1.2, 0), at(1.32, -0.1), at(1.2, 0.05), at(6, 3), at(6.14, 3.1), at(6.03, 3)]));
    expect(hooked.length).toBe(2);
    expectAt(hooked[0].point, at(1.2, 0), 1);
    expectAt(hooked[1].point, at(6.03, 3), 1);
  });
  it('still follows the curves that were drawn', () => {
    const app = controls(settlement(), 1.4),
      bend: Point[] = [];
    for (let i = 0; i <= 24; ++i) {
      const angle = (i / 24) * Math.PI * 0.5;
      bend.push(at(1.2 + 4 * Math.sin(angle), 4 - 4 * Math.cos(angle)));
    }
    const events = hand(app, bend),
      path = draw(app, events);
    expect(app.town.canBuildRoad(path).reason).toBe('');
    expect(strays(app, events, path)).toBeLessThan(5);
    expect(sharpestBend(app, path)).toBeLessThan(20);
  });
  it('keeps the part already drawn in place while the stroke grows', () => {
    const app = controls(settlement(), 1.4),
      wave: Point[] = [];
    for (let i = 0; i <= 40; ++i) wave.push(at(1.2 + i * 0.16, 1.2 * Math.sin(i * 0.2)));
    let before: Point[] = [],
      jump = 0;
    draw(app, hand(app, wave), (path) => {
      const now = drawn(app, path);
      // Leave out the newest stretch, which is still following the pointer.
      let left = 0;
      while (before.length > 1 && left < 40) {
        left += distance(before[before.length - 1], before[before.length - 2]);
        before.pop();
      }
      if (now.length > 1)
        for (const p of before) {
          let gap = Infinity;
          for (let i = 1; i < now.length; ++i) gap = Math.min(gap, segmentDistance(p, now[i - 1], now[i]));
          jump = Math.max(jump, gap);
        }
      before = now;
    });
    expect(jump).toBeLessThan(8);
  });
});
