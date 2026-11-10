import type { Point } from '../../engine/src/geometry';

export type WorldObjectKind =
  'person' | 'building' | 'animal' | 'monster' | 'tree' | 'rock' | 'dungeon' | 'road' | 'field' | 'landmark';
export interface WorldObjectRef {
  kind: WorldObjectKind;
  id: number;
  /** Trees share a resource cell, but each painted tree has its own silhouette. */
  instanceIndex?: number;
}
export interface PickBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SelectionGeometry {
  foot: Point;
  bounds: PickBounds;
  labelAnchor: Point;
  opacity: number;
  groundOutline?: Point[];
  path?: Point[];
  /** Separate visible road spans must never be joined across unexplored ground. */
  paths?: Point[][];
  ellipse?: { rx: number; ry: number };
}
export interface WorldHit extends WorldObjectRef {
  key: string;
  drawRank: number;
  frameId: number;
  geometry: SelectionGeometry;
}
export const worldObjectKey = (ref: WorldObjectRef): string =>
  `${ref.kind}:${ref.id}${ref.instanceIndex === undefined ? '' : `:${ref.instanceIndex}`}`;
