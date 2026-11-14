import { describe, expect, it } from 'vitest';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { paintSplashes, splashCount, splashPool, type SplashGround } from '../../packages/native-renderer/src/rain-splash';
import { ShapeNode } from '../../packages/native-renderer/src/paint';
import { Weather } from '../../packages/engine/src/climate';
import { Camera, unproject } from '../../packages/engine/src/geometry';
import { Terrain } from '../../packages/engine/src/world-types';

// Left half of the view (in screen x) is lake, right half land with a building on the far right.
const ground: SplashGround = {
  terrainAt: (p) => (p.x - p.y < 0 ? Terrain.Water : Terrain.Grass),
  buildingAt: (p) => (p.x - p.y > 30 ? 1 : -1),
};
function state(weather: Weather, intensity: number, zoom = 1.6): WorldRendererState {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these tests never sync to ThorVG.
  const s = new WorldRendererState({} as never);
  s.reducedMotion = false;
  s.view = new Camera(0, 0, zoom);
  s.viewWidth = 1280;
  s.viewHeight = 800;
  s.falling = weather;
  s.fallingIntensity = intensity;
  s.shownWet = weather === Weather.Clear ? 0 : 1;
  return s;
}
const shapes = (s: WorldRendererState) => s.splashes.children.filter((c): c is ShapeNode => c instanceof ShapeNode);

describe('rain splashes', () => {
  it('appear only while rain falls, more in a storm', () => {
    expect(splashCount(state(Weather.Clear, 0))).toBe(0);
    expect(splashCount(state(Weather.Snow, 1))).toBe(0);
    const rain = splashCount(state(Weather.Rain, 0.5)),
      storm = splashCount(state(Weather.Storm, 1));
    expect(rain).toBeGreaterThan(10);
    expect(storm).toBeGreaterThan(rain);
    expect(storm).toBeLessThanOrEqual(splashPool);
    expect(paintSplashes(state(Weather.Clear, 0), ground, 1)).toBe(0);
    const still = state(Weather.Rain, 1);
    still.reducedMotion = true;
    expect(splashCount(still)).toBe(0);
  });
  it('thin out zoomed out and stop far out; the pool stays bounded', () => {
    expect(splashCount(state(Weather.Storm, 1, 0.5))).toBeLessThan(splashCount(state(Weather.Storm, 1, 1.6)));
    expect(splashCount(state(Weather.Storm, 1, 0.3))).toBe(0);
    const huge = state(Weather.Storm, 1);
    huge.viewWidth = 8000;
    huge.viewHeight = 5000;
    expect(splashCount(huge)).toBe(splashPool);
  });
  it('rings on water, wet marks on land, none on buildings, all inside the view', () => {
    const s = state(Weather.Storm, 1);
    const seen: { x: number; y: number }[] = [];
    const probe: SplashGround = {
      terrainAt: (p) => (seen.push(p), ground.terrainAt(p)),
      buildingAt: ground.buildingAt,
    };
    expect(paintSplashes(s, probe, 3)).toBeGreaterThan(0);
    const [wet, rim] = shapes(s);
    expect(wet.commands.length).toBeGreaterThan(0);
    expect(rim.commands.length).toBeGreaterThan(0);
    const corner = [unproject(-400, -250), unproject(400, 250), unproject(-400, 250), unproject(400, -250)],
      lo = (k: 'x' | 'y') => Math.min(...corner.map((c) => c[k])) - 1e-3,
      hi = (k: 'x' | 'y') => Math.max(...corner.map((c) => c[k])) + 1e-3;
    for (const p of seen) {
      expect(p.x).toBeGreaterThanOrEqual(lo('x'));
      expect(p.x).toBeLessThanOrEqual(hi('x'));
      expect(p.y).toBeGreaterThanOrEqual(lo('y'));
      expect(p.y).toBeLessThanOrEqual(hi('y'));
    }
    // Land only: wet marks and nothing thrown up.
    const field = state(Weather.Rain, 1);
    paintSplashes(field, { terrainAt: () => Terrain.Grass, buildingAt: () => -1 }, 3);
    expect(shapes(field)[0].commands.length).toBeGreaterThan(0);
    expect(shapes(field)[1].commands.length).toBe(0);
    // Water only: rings and no wet spots.
    const lake = state(Weather.Rain, 1);
    paintSplashes(lake, { terrainAt: () => Terrain.Sea, buildingAt: () => -1 }, 3);
    expect(shapes(lake)[0].commands.length).toBe(0);
    expect(shapes(lake)[1].commands.length).toBeGreaterThan(0);
    // Lava, ice and roofs: nothing.
    for (const g of [
      { terrainAt: () => Terrain.Lava, buildingAt: () => -1 },
      { terrainAt: () => Terrain.Ice, buildingAt: () => -1 },
      { terrainAt: () => Terrain.Grass, buildingAt: () => 4 },
    ])
      expect(paintSplashes(state(Weather.Storm, 1), g, 3)).toBe(0);
  });
  it('stay put between updates and clear when the rain stops', () => {
    const s = state(Weather.Rain, 1);
    paintSplashes(s, ground, 3);
    expect(paintSplashes(s, ground, 3.01)).toBe(-1);
    s.shownWet = 0;
    paintSplashes(s, ground, 4);
    for (const shape of shapes(s)) expect(shape.commands.length).toBe(0);
  });
});
