// Where each combat shape is drawn. Ground shapes lie on the earth under every unit; standing and body shapes
// are sorted with figures, trees and buildings by a ground point; overhead shapes sit above the world.
import type { Point } from '../../engine/src/geometry';
import { Rect } from '../../native-ui/src/types';
import { SceneNode } from './paint';
import { registerDepth, rowOf } from './world-depth';
import type { WorldRendererState } from './world-renderer-state';

export enum Tier {
  /** Flat on the earth, under every unit, building and tree, lit with the land. */
  Ground,
  /** Has height and stands at its own ground point, sorted with the world. */
  Standing,
  /** Lands on a figure: sorted just in front of the figure it struck. */
  Body,
  /** Interface over heads: above everything in the world. */
  Overhead,
}
/** How far in front of (or behind) a figure's ground point a body shape sorts, in tiles. */
export const nudge = 0.03;
export const inFront = (at: Point, by = nudge): Point => ({ x: at.x + by, y: at.y + by });

/** One node sorted with the world. Rows are rebuilt when the map resets or a save loads, so the node
 * re-enters the current rows whenever they change rather than dangling from the old ones. */
export class DepthSlot {
  readonly node = new SceneNode();
  private row: SceneNode | undefined;
  private rows: SceneNode[] | undefined;
  constructor(readonly key: string) {}
  place(s: WorldRendererState, at: Point, bounds: Rect): void {
    if (this.rows !== s.rows || !this.row) {
      this.row?.remove(this.node);
      this.row = undefined;
      this.rows = s.rows;
      if (!s.rows.length) return;
      this.row = s.rows[rowOf(at, s.rows.length)];
      this.row.add(this.node);
    }
    registerDepth(this.node, at, this.key, bounds);
  }
  /** The row it lives in, for tests. */
  get attached(): SceneNode | undefined {
    return this.row;
  }
  detach(): void {
    this.row?.remove(this.node);
    this.row = undefined;
    this.rows = undefined;
  }
}

/** A box round local extents, placed at a screen point. */
export const boxAt = (x: number, y: number, e: Extent): Rect => new Rect(x + e.x0, y + e.y0, e.x1 - e.x0, e.y1 - e.y0);
export interface Extent {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
