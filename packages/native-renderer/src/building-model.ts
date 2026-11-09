import { point, type Point } from '../../engine/src/geometry';
import { f32, lround, remainder } from '../../engine/src/numeric';
import type { Rgb } from './paint';
export enum RoofShape {
  Flat,
  GableX,
  GableY,
  Pyramid,
}
export enum Trim {
  None,
  Timber,
  Crenels,
  Stakes,
}
export enum Ornament {
  None,
  Banner,
  Crystal,
}
export interface Block {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  wall: number;
  roof: number;
  shape: RoofShape;
  wallLit: Rgb;
  wallShade: Rgb;
  roofLit: Rgb;
  roofShade: Rgb;
  base: number;
  delay: number;
  windows: number;
  door: boolean;
  trim: Trim;
  glass: Rgb;
  ornament: Ornament;
  accent: Rgb;
  doorFacing: number;
}
export interface Patch {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: Rgb;
  furrows: number;
  furrow: Rgb;
  delay: number;
}
export interface Model {
  patches: Patch[];
  blocks: Block[];
}
export function sortModel(model: Model): void {
  const depth = (b: Block) => f32(f32(f32(b.x0 + b.x1) + b.y0) + b.y1),
    key = (block: Block) => {
      if (block.base <= 0) return depth(block);
      const cx = f32(f32(block.x0 + block.x1) / 2),
        cy = f32(f32(block.y0 + block.y1) / 2);
      let support = depth(block);
      for (const other of model.blocks)
        if (other.base < block.base && cx >= other.x0 && cx <= other.x1 && cy >= other.y0 && cy <= other.y1)
          support = depth(other);
      return f32(support + f32(f32(0.001) * block.base));
    };
  const ordered = model.blocks.map((block) => ({ key: key(block), block }));
  ordered.sort((a, b) => f32(a.key - b.key));
  model.blocks = ordered.map((row) => row.block);
}
function quarterTurn(
  rect: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  },
  c: number,
): void {
  const nx0 = f32(f32(2 * c) - rect.y1),
    nx1 = f32(f32(2 * c) - rect.y0),
    ny0 = rect.x0,
    ny1 = rect.x1;
  rect.x0 = nx0;
  rect.x1 = nx1;
  rect.y0 = ny0;
  rect.y1 = ny1;
}
export function orientModel(model: Model, quarterTurns: number, size: number): void {
  const turns = f32((quarterTurns % 4) + 4) % 4,
    c = f32(size / 2);
  for (let t = 0; t < turns; t++) {
    for (const block of model.blocks) {
      quarterTurn(block, c);
      block.doorFacing = f32(block.doorFacing + 1) % 4;
      if (block.shape === RoofShape.GableX) block.shape = RoofShape.GableY;
      else if (block.shape === RoofShape.GableY) block.shape = RoofShape.GableX;
    }
    for (const patch of model.patches) quarterTurn(patch, c);
  }
  sortModel(model);
}
export function splitAngle(angle: number): {
  quarterTurns: number;
  remainder: number;
} {
  const quarter = f32(1.5707963);
  angle = f32(angle);
  if (!Number.isFinite(angle)) throw new Error('building angle must be finite');
  if (Math.abs(angle) > 1e6) angle = remainder(angle, f32(quarter * 4));
  const turns = lround(f32(angle / quarter));
  return { remainder: f32(angle - f32(turns * quarter)), quarterTurns: f32((turns % 4) + 4) % 4 };
}
export class BuildingProjection {
  constructor(
    public halfWidth = 32,
    public halfHeight = 16,
  ) {}
  project(x: number, y: number, z = 0): Point {
    return point(f32(f32(x - y) * this.halfWidth), f32(f32(f32(x + y) * this.halfHeight) - z));
  }
}
