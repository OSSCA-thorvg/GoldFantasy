import { describe, expect, it } from 'vitest';
import { Climate, Weather, Sky } from '../../packages/engine/src/climate';
import { Camera } from '../../packages/engine/src/geometry';
import { ShapeNode } from '../../packages/native-renderer/src/paint';
import type { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { weather } from '../../packages/native-renderer/src/world-weather';

function fixture(kind: Weather, intensity = 1, wind = 0.5, zoom = 1) {
  const climate = Object.assign(new Climate(), { weather: kind, intensity, wind });
  const state = {
    view: new Camera(0, 0, zoom),
    viewWidth: 1280,
    viewHeight: 800,
    weatherAt: -1,
    shownGrey: 0,
    shownSun: 1,
    shownShade: 1,
    shownCloudy: 0,
    shownWet: 0,
    falling: Weather.Clear,
    fallingIntensity: 0,
    overcast: new ShapeNode(),
    precipitation: new ShapeNode(),
  } as unknown as WorldRendererState;
  const draw = (seconds: number) => {
    weather(state, climate, seconds);
    return state.precipitation.commands.map((command) => [...command]);
  };
  return { climate, state, draw };
}
const wrappedDelta = (after: number, before: number, period = 320) =>
  ((((after - before + period / 2) % period) + period) % period) - period / 2;
function rainDrop(commands: ReturnType<ReturnType<typeof fixture>['draw']>, i = 0) {
  const head = commands[2 * i],
    tail = commands[2 * i + 1];
  expect(head[0]).toBe('M');
  expect(tail[0]).toBe('L');
  return {
    x: Number(head[1]),
    y: Number(head[2]),
    dx: Number(head[1]) - Number(tail[1]),
    dy: Number(head[2]) - Number(tail[2]),
  };
}
describe('precipitation motion follows the current wind', () => {
  it.each([Weather.Rain, Weather.Storm])('does not reverse kind %s when a rightward gust weakens', (kind) => {
    const { draw, climate } = fixture(kind, 1, 1);
    const before = rainDrop(draw(100));
    climate.wind = 0.999;
    const after = rainDrop(draw(100.01));
    expect(wrappedDelta(after.x, before.x)).toBeGreaterThan(0);
    expect(wrappedDelta(after.x, before.x)).toBeCloseTo((50 + 230 * climate.wind) * 0.01, 2);
  });
  it.each([
    [Weather.Rain, 0.25, 0.2, 0.65],
    [Weather.Rain, 1, 0.9, 1],
    [Weather.Storm, 0.8, 0.7, 2],
  ])(
    'aligns kind %s streaks with their own measured velocity at intensity %s wind %s zoom %s',
    (kind, intensity, wind, zoom) => {
      const { draw } = fixture(kind, intensity, wind, zoom);
      const before = draw(0),
        after = draw(0.01);
      for (let i = 0; i < 6; i++) {
        const a = rainDrop(before, i),
          b = rainDrop(after, i);
        const dx = wrappedDelta(b.x, a.x),
          dy = wrappedDelta(b.y, a.y);
        expect(dx).toBeGreaterThan(0);
        expect(dy).toBeGreaterThan(0);
        expect(b.dx / b.dy).toBeCloseTo(dx / dy, 3);
      }
    },
  );
  it('keeps falling snow downwind through the same weakening gust', () => {
    const { draw, climate } = fixture(Weather.Snow, 1, 1);
    const before = draw(100)[0];
    climate.wind = 0.999;
    const after = draw(100.01)[0];
    expect(before[0]).toBe('E');
    expect(after[0]).toBe('E');
    expect(wrappedDelta(Number(after[1]), Number(before[1]), 1280)).toBeGreaterThan(0);
  });
  it('stays downwind through actual changing Sky gusts after a long-running presentation clock', () => {
    const { draw, climate } = fixture(Weather.Storm, 1, 1),
      sky = new Sky(7);
    sky.force(Weather.Storm, 1);
    Object.assign(climate, sky.now());
    let previous = rainDrop(draw(400)),
      decreasing = 0,
      previousWind = climate.wind;
    for (let i = 1; i <= 1000; i++) {
      sky.advance(0.1, 300, 0.4, 0.6);
      Object.assign(climate, sky.now());
      const next = rainDrop(draw(400 + i * 0.1));
      if (climate.wind < previousWind) decreasing++;
      expect(wrappedDelta(next.x, previous.x)).toBeGreaterThan(0);
      previous = next;
      previousWind = climate.wind;
    }
    expect(decreasing).toBeGreaterThan(100);
  });
  it('keeps constant-wind phase independent of frame subdivision and resets cleanly on a clock rewind', () => {
    const coarse = fixture(Weather.Rain, 1, 0.6),
      fine = fixture(Weather.Rain, 1, 0.6);
    coarse.draw(10);
    fine.draw(10);
    const expected = rainDrop(coarse.draw(10.5));
    for (let i = 1; i < 50; i++) fine.draw(10 + i * 0.01);
    const actual = rainDrop(fine.draw(10.5));
    expect(actual.x).toBeCloseTo(expected.x, 3);
    expect(actual.y).toBeCloseTo(expected.y, 3);
    const fresh = fixture(Weather.Rain, 1, 0.6);
    expect(rainDrop(coarse.draw(1))).toEqual(rainDrop(fresh.draw(1)));
  });
  it('does not jump existing particles when wind changes at the same presentation time', () => {
    const { draw, climate } = fixture(Weather.Rain, 1, 0.2);
    const before = rainDrop(draw(120));
    climate.wind = 0.9;
    const after = rainDrop(draw(120));
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.dx).toBeGreaterThan(before.dx);
  });
});
