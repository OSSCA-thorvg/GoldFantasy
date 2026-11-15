import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WorldMap } from '../../packages/engine/src/world-map';

const digest = (map: WorldMap) => createHash('sha256').update(JSON.stringify(map)).digest('hex');
// Complete map snapshots captured before the scheduling and repeated-noise optimizations.
const worlds = [
  [5, 64, 'e6c8148a4d6ef261397017362ab38171cb4befaf7f73cf2b42f0364c04baf726'],
  [11, 96, 'f427aefff18f615ac9b0ee605029ae2271f4ad29a7d23ac61b74e3b0000b1e7c'],
  [5, 176, '5d9f0941a9b818e1d2c42e8174acbf6d0f7bb79173f81f3d78268e0a778db7e9'],
  [4294967295, 64, 'e49e2af1515ff31bc7784dd7c0d4b353e18c74cb9ad702d086d6f45cfb761c55'],
  [0, 32, '9ab6c9dd748258651d63b76130f06619711e6dc80bdf04cff871993a5d73606e'],
] as const;
describe('cooperative world generation', () => {
  it.each(worlds)('preserves every field of seed %s on a %s tile map', (seed, size, expected) => {
    expect(digest(WorldMap.generate(seed, size, size))).toBe(expected);
  });
  it('yields to other work, then gives each caller an independent map', async () => {
    let turns = 0;
    const heartbeat = setInterval(() => ++turns, 0);
    try {
      await WorldMap.prepare(5, 64, 64);
      const map = WorldMap.generate(5, 64, 64);
      expect(turns).toBeGreaterThan(0);
      expect(digest(map)).toBe(worlds[0][2]);
      map.at(0, 0).trees = 123;
      expect(digest(WorldMap.generate(5, 64, 64))).toBe(worlds[0][2]);
    } finally {
      clearInterval(heartbeat);
    }
  });
});
