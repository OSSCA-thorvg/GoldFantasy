import { point } from '../../../packages/engine/src/geometry';
import {
  worldObjectKey,
  type WorldHit,
  type WorldObjectKind,
} from '../../../packages/native-renderer/src/world-picking-types';

/** App contract fixture; actual native silhouette intersections are covered by renderer tests. */
export function presentedHit(kind: WorldObjectKind, id: number, instanceIndex?: number): WorldHit {
  const ref = { kind, id, ...(instanceIndex === undefined ? {} : { instanceIndex }) };
  return {
    ...ref,
    key: worldObjectKey(ref),
    drawRank: 5,
    frameId: 1,
    geometry: {
      foot: point(50, 50),
      bounds: { x: 45, y: 30, w: 10, h: 20 },
      labelAnchor: point(50, 30),
      opacity: 1,
    },
  };
}
