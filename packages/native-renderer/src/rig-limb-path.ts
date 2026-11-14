// Limbs drawn as one flowing curve through several joints, rather than two sticks hinged at a corner.
import type { ShapeNode } from './paint';

/**
 * Lays a smooth curve through `points` (x0, y0, x1, y1, ...) into the shape as cubics. `from` and `to`
 * pick the joints to run between, so one curve can be shared by two shapes that meet at a joint.
 */
export function threadCurve(
  shape: ShapeNode,
  points: readonly number[],
  from = 0,
  to = points.length / 2 - 1,
): ShapeNode {
  const last = points.length / 2 - 1,
    x = (i: number) => points[2 * Math.max(0, Math.min(last, i))],
    y = (i: number) => points[2 * Math.max(0, Math.min(last, i)) + 1];
  shape.moveTo(x(from), y(from));
  for (let i = from; i < to; i++)
    // Each joint's tangent runs parallel to the line between its neighbours.
    shape.cubicTo(
      x(i) + (x(i + 1) - x(i - 1)) / 6,
      y(i) + (y(i + 1) - y(i - 1)) / 6,
      x(i + 1) - (x(i + 2) - x(i)) / 6,
      y(i + 1) - (y(i + 2) - y(i)) / 6,
      x(i + 1),
      y(i + 1),
    );
  return shape;
}

/**
 * The five joints of a two-bone limb, written to `out`: root, a joint part-way down the first bone,
 * the middle joint drawn into its bend by `soft` (0 keeps the corner, 1 cuts it straight across),
 * a joint part-way down the second bone, and the end.
 */
export function limbJoints(
  rootX: number,
  rootY: number,
  midX: number,
  midY: number,
  endX: number,
  endY: number,
  soft: number,
  out: number[] = [],
): number[] {
  const ax = rootX + (midX - rootX) * 0.6,
    ay = rootY + (midY - rootY) * 0.6,
    bx = midX + (endX - midX) * 0.4,
    by = midY + (endY - midY) * 0.4;
  out[0] = rootX;
  out[1] = rootY;
  out[2] = ax;
  out[3] = ay;
  out[4] = midX + ((ax + bx) / 2 - midX) * soft;
  out[5] = midY + ((ay + by) / 2 - midY) * soft;
  out[6] = bx;
  out[7] = by;
  out[8] = endX;
  out[9] = endY;
  out.length = 10;
  return out;
}
