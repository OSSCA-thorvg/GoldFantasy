import type { Point } from '../../engine/src/geometry';
import type { PaintNode } from './paint';
import type { WorldObjectRef } from './world-picking-types';

export interface PickSource {
  /** A non-selectable solid silhouette can still occlude an object behind it. */
  ref: WorldObjectRef | null;
  body: readonly PaintNode[];
  foot: Point;
  groundOutline?: readonly Point[];
  ellipse?: { rx: number; ry: number };
}
const sources = new WeakMap<PaintNode, PickSource>();
/** The existing retained paint owns picking metadata; no duplicated scene or native reference is created. */
export function registerPick(paint: PaintNode, source: PickSource): void {
  sources.set(paint, source);
}
export const pickSource = (paint: PaintNode): PickSource | undefined => sources.get(paint);
