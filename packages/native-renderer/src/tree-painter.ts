import { project, add, lerp, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { Layer, Terrain } from '../../engine/src/world-types';
import { treePosition, type WorldMap } from '../../engine/src/world-map';
import { ShapeNode, type Rgb } from './paint';
import { appendPolygon, fill, mix, opaque, verticalShade } from './vector-paint';
import type { Climate } from './render-types';
const f = Math.fround;
export enum TreeKind {
  Fir,
  SnowySpruce,
  Snag,
}
export interface Tree {
  kind: TreeKind;
  foot: Point;
  size: number;
  slender: number;
  lean: number;
  variant: number;
}
function ease(from: number, to: number, x: number): number {
  const t = Math.max(0, Math.min(1, f(f(x - from) / f(to - from))));
  return f(f(t * t) * f(3 - f(2 * t)));
}
export function treeAt(map: WorldMap, x: number, y: number, index: number): Tree {
  const seed = map.seed(),
    tree: Tree = {
      kind: TreeKind.Fir,
      foot: treePosition(map, x, y, index),
      size: f(f(0.5) + f(f(Math.pow(hash01(seed, x, y, 50 + index), f(1.3))) * f(1.05))),
      slender: f(f(0.85) + f(hash01(seed, x, y, 51 + index) * f(0.4))),
      lean: f(f(hash01(seed, x, y, 52 + index) - f(0.5)) * 3),
      variant: hash01(seed, x, y, 55 + index),
    };
  const heat = map.value(Layer.Heat, tree.foot),
    pick = hash01(seed, x, y, 53 + index),
    terrain = map.at(x, y).terrain;
  if (terrain === Terrain.Frost) tree.kind = TreeKind.SnowySpruce;
  else if (terrain === Terrain.Ash || pick < ease(f(0.55), f(0.66), heat)) tree.kind = TreeKind.Snag;
  else if (pick < ease(f(0.33), f(0.25), heat)) tree.kind = TreeKind.SnowySpruce;
  if (tree.kind === TreeKind.SnowySpruce) tree.slender = f(tree.slender + f(0.15));
  return tree;
}
const canopyLit: Rgb = [38, 70, 52],
  canopyShade: Rgb = [24, 46, 37],
  stem: Rgb = [44, 32, 26],
  deadwood: Rgb = [96, 88, 84],
  snowLit: Rgb = [214, 222, 232],
  snowShade: Rgb = [180, 190, 206];
const Dead = 0,
  Stems = 1,
  Lit = 2,
  Shade = 3,
  SnowShade = 4,
  SnowLit = 5;
export class TreeBatch {
  private parts = Array.from({ length: 6 }, () => new ShapeNode());
  private readonly snowy: boolean;
  constructor(private climate: Climate) {
    this.snowy = climate.snow > f(0.3);
  }
  add(tree: Tree): void {
    const base = project(tree.foot.x, tree.foot.y);
    if (tree.kind === TreeKind.Fir) this.fir(base, tree);
    else if (tree.kind === TreeKind.SnowySpruce) this.spruce(base, tree);
    else this.snag(base, tree);
  }
  finish(base: number): ShapeNode[] {
    const canopy = (c: Rgb) =>
      mix(
        mix(c, [78, 70, 40], f(f(0.22) * this.climate.autumn)),
        [70, 78, 86],
        f(f(0.3) * this.climate.snow),
      );
    verticalShade(this.parts[Dead], deadwood, f(base - 80), base, f(1.3), f(0.75));
    fill(this.parts[Stems], opaque(stem));
    verticalShade(this.parts[Lit], canopy(canopyLit), f(base - 50), base, f(1.35), f(0.8));
    verticalShade(this.parts[Shade], canopy(canopyShade), f(base - 50), base, f(1.3), f(0.75));
    fill(this.parts[SnowShade], opaque(snowShade));
    fill(this.parts[SnowLit], opaque(snowLit));
    const drawn = this.parts.filter((part) => part.commands.length > 0);
    this.parts = [];
    return drawn;
  }
  private fir(b: Point, tree: Tree): void {
    const s = tree.size,
      w = f(9 * s),
      top = f(f(30 * s) * tree.slender),
      foot = f(b.y - f(5 * s));
    this.parts[Stems].appendRect(f(b.x - f(f(1.6) * s)), f(b.y - f(6 * s)), f(f(3.2) * s), f(6 * s));
    appendPolygon(this.parts[Lit], [
      { x: f(b.x - w), y: foot },
      { x: b.x, y: f(foot - f(top * f(0.62))) },
      { x: b.x, y: f(b.y - f(3 * s)) },
    ]);
    appendPolygon(this.parts[Shade], [
      { x: f(b.x + w), y: foot },
      { x: b.x, y: f(foot - f(top * f(0.62))) },
      { x: b.x, y: f(b.y - f(3 * s)) },
    ]);
    appendPolygon(this.parts[Lit], [
      { x: f(b.x - f(w * f(0.74))), y: f(foot - f(top * f(0.36))) },
      { x: b.x, y: f(foot - top) },
      { x: b.x, y: f(f(b.y - f(4 * s)) - f(top * f(0.36))) },
    ]);
    appendPolygon(this.parts[Shade], [
      { x: f(b.x + f(w * f(0.74))), y: f(foot - f(top * f(0.36))) },
      { x: b.x, y: f(foot - top) },
      { x: b.x, y: f(f(b.y - f(4 * s)) - f(top * f(0.36))) },
    ]);
    if (this.snowy)
      appendPolygon(this.parts[SnowLit], [
        { x: f(b.x - f(w * f(0.34))), y: f(foot - f(top * f(0.7))) },
        { x: b.x, y: f(foot - top) },
        { x: f(b.x + f(w * f(0.34))), y: f(foot - f(top * f(0.7))) },
      ]);
  }
  private spruce(b: Point, tree: Tree): void {
    const s = tree.size,
      height = f(f(36 * s) * tree.slender),
      width = f(f(7.2) * s);
    this.parts[Stems].appendRect(f(b.x - f(f(1.3) * s)), f(b.y - f(4 * s)), f(f(2.6) * s), f(4 * s));
    const tiers = s < f(0.8) ? 3 : 4,
      bottom = f(b.y - f(3 * s)),
      step = f(f(height - f(3 * s)) / f(tiers + f(1.2))),
      droop = f(f(1.6) * s);
    for (let t = 0; t < tiers; t++) {
      const foot = f(bottom - f(t * step)),
        half = f(width * f(1 - f(t / f(tiers + f(0.6))))),
        lean = f(f(f(tree.lean * s) * f(t + f(2.2))) / f(tiers + f(1.2)));
      const apex = { x: f(b.x + lean), y: f(foot - f(step * f(2.2))) },
        left = { x: f(b.x - half), y: f(foot + droop) },
        right = { x: f(b.x + half), y: f(foot + droop) },
        middle = { x: f(b.x + f(lean * f(0.3))), y: foot };
      appendPolygon(this.parts[Lit], [left, apex, middle]);
      appendPolygon(this.parts[Shade], [middle, apex, right]);
      const l = lerp(apex, left, f(0.64)),
        r = lerp(apex, right, f(0.59)),
        m = lerp(apex, middle, f(0.51));
      appendPolygon(this.parts[SnowLit], [apex, l, add(lerp(l, m, f(0.5)), { x: 0, y: f(f(-0.9) * s) }), m]);
      appendPolygon(this.parts[SnowShade], [apex, m, add(lerp(m, r, f(0.5)), { x: 0, y: f(f(0.8) * s) }), r]);
    }
  }
  private snag(b: Point, tree: Tree): void {
    const s = f(tree.size * f(1.15)),
      lean = f(tree.lean * s),
      snapped = tree.variant < f(0.3);
    let height = f(f(30 * s) * tree.slender);
    if (snapped) height = f(height * f(0.62));
    appendPolygon(this.parts[Dead], [
      { x: f(b.x - f(f(2.2) * s)), y: b.y },
      { x: f(f(b.x - f(f(0.6) * s)) + lean), y: f(b.y - height) },
      { x: f(f(b.x + f(f(0.6) * s)) + lean), y: f(b.y - height) },
      { x: f(b.x + f(f(2.2) * s)), y: b.y },
    ]);
    const boughs = snapped ? 2 : 4;
    for (let k = 0; k < boughs; k++) {
      const fraction = f(f(0.42) + f(k * f(0.14))),
        side = (k + Math.trunc(tree.variant * 7)) % 2 ? 1 : -1,
        reach = f(f(11 - f(5 * fraction)) * s);
      const from = { x: f(b.x + f(lean * fraction)), y: f(b.y - f(height * fraction)) },
        tip = { x: f(from.x + f(f(side * reach) * f(0.8))), y: f(from.y - f(reach * f(0.75))) };
      appendPolygon(this.parts[Dead], [
        { x: from.x, y: f(from.y - f(f(1.5) * s)) },
        tip,
        { x: from.x, y: f(from.y + f(f(0.7) * s)) },
      ]);
      const fork = lerp(from, tip, f(0.55));
      appendPolygon(this.parts[Dead], [
        { x: fork.x, y: f(fork.y - f(f(0.7) * s)) },
        { x: f(fork.x + f(f(side * f(1.6)) * s)), y: f(fork.y - f(f(4.5) * s)) },
        { x: f(fork.x + f(f(side * f(0.3)) * s)), y: f(fork.y + f(f(0.4) * s)) },
      ]);
    }
  }
}
