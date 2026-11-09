import { f32, hash01, lround, clamp, u32 } from '../../engine/src/numeric';
import { SceneNode, PictureNode } from './paint';
class WrappedNoise {
  values: Float32Array;
  constructor(
    readonly period: number,
    seed: number,
  ) {
    this.values = new Float32Array(f32(period * period));
    for (let y = 0; y < period; y++)
      for (let x = 0; x < period; x++) this.values[f32(f32(y * period) + x)] = hash01(seed, x, y);
  }
  at(u: number, v: number): number {
    const x = f32(u * this.period),
      y = f32(v * this.period),
      x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = f32(x - x0),
      fy = f32(y - y0),
      value = (cx: number, cy: number) =>
        this.values[f32(f32((cy % this.period) * this.period) + (cx % this.period))],
      sx = f32(f32(fx * fx) * f32(3 - f32(2 * fx))),
      sy = f32(f32(fy * fy) * f32(3 - f32(2 * fy))),
      top = f32(value(x0, y0) + f32(f32(value(f32(x0 + 1), y0) - value(x0, y0)) * sx)),
      bottom = f32(
        value(x0, f32(y0 + 1)) + f32(f32(value(f32(x0 + 1), f32(y0 + 1)) - value(x0, f32(y0 + 1))) * sx),
      );
    return f32(top + f32(f32(bottom - top) * sy));
  }
}
export function cloudBlotches(width: number, height: number, seed: number): Uint32Array {
  const octaves: WrappedNoise[] = [];
  for (let octave = 0, period = 6; octave < 4; octave++, period = f32(period * 2))
    octaves.push(new WrappedNoise(period, u32(seed + octave) >>> 0));
  const pixels = new Uint32Array(f32(width * height));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = f32(x / f32(width - 1)),
        v = f32(y / f32(height - 1));
      let n = 0,
        weight = 0,
        amplitude = 1;
      for (const octave of octaves) {
        n = f32(n + f32(octave.at(u, v) * amplitude));
        weight = f32(weight + amplitude);
        amplitude = f32(amplitude * f32(0.5));
      }
      n = f32(n / weight);
      const t = clamp(f32(f32(n - f32(0.5)) / f32(0.18)), 0, 1),
        alpha = lround(f32(f32(f32(255 * t) * t) * f32(3 - f32(2 * t))));
      pixels[f32(f32(y * width) + x)] = ((alpha << 24) | (8 << 16) | (14 << 8) | 24) >>> 0;
    }
  return pixels;
}
let field: Uint8Array | undefined;
export class CloudMottle {
  static readonly tileWidth = 2048;
  static readonly tileHeight = 1024;
  private scene = new SceneNode();
  private tiles: PictureNode[] = [];
  constructor() {
    field ??= new Uint8Array(cloudBlotches(1024, 512, 53).buffer);
    const first = new PictureNode(field, 1024, 512, 'ARGB8888S').size(2048, 1024);
    this.tiles.push(first);
    while (this.tiles.length < 45) this.tiles.push(first.duplicate());
    for (const tile of this.tiles) this.scene.add(tile);
  }
  layer(): SceneNode {
    return this.scene;
  }
  update(strength: number, left: number, top: number, driftX: number, driftY: number): void {
    this.scene.opacity(Math.trunc(f32(120 * clamp(strength, 0, 1))));
    if (strength <= 0) return;
    const x0 = f32(f32(Math.floor(f32(f32(left - driftX) / 2048)) * 2048) + driftX),
      y0 = f32(f32(Math.floor(f32(f32(top - driftY) / 1024)) * 1024) + driftY);
    for (let row = 0; row < 9; row++)
      for (let col = 0; col < 5; col++)
        this.tiles[f32(f32(row * 5) + col)].transform([
          1,
          0,
          f32(x0 + f32(col * 2048)),
          0,
          1,
          f32(y0 + f32(row * 1024)),
          0,
          0,
          1,
        ]);
  }
}
