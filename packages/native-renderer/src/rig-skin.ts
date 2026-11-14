// Art for a rig: pieces drawn in the rest pose, each carried by one bone, and outlines that bend
// with several. Posing sets transforms and swaps in outlines solved once per pose, so a crowd of
// figures never changes a child list and never works a path out twice.
import { SceneNode, ShapeNode, type Matrix, type PaintNode, type Rgb, type Rgba } from './paint';
import type { SkinnedPath } from './rig-skinned-path';
import type { Skeleton } from './rig-skeleton';

/** Round-ended strokes in one colour, as one paint: limb segments, joints (a dot is a zero-length stroke). */
export function capsules(
  width: number,
  color: Rgb | Rgba,
  ...lines: readonly (readonly [x0: number, y0: number, x1: number, y1: number])[]
): ShapeNode {
  const shape = new ShapeNode()
    .strokeWidth(width)
    .strokeFill(color[0], color[1], color[2], color[3] ?? 255)
    .strokeCap('round')
    .strokeJoin('round');
  for (const [x0, y0, x1, y1] of lines)
    shape.moveTo(x0, y0).lineTo(x1 === x0 && y1 === y0 ? x1 + 0.01 : x1, y1);
  return shape;
}
/** Filled outlines in one colour, as one paint. */
export function fills(
  color: Rgb | Rgba,
  ...outlines: readonly (readonly (readonly [number, number])[])[]
): ShapeNode {
  const shape = new ShapeNode().fill(color[0], color[1], color[2], color[3] ?? 255);
  for (const outline of outlines) {
    outline.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.close();
  }
  return shape;
}
/** Filled ellipses in one colour, as one paint. */
export function discs(
  color: Rgb | Rgba,
  ...ovals: readonly (readonly [x: number, y: number, rx: number, ry?: number])[]
): ShapeNode {
  const shape = new ShapeNode().fill(color[0], color[1], color[2], color[3] ?? 255);
  for (const [x, y, rx, ry] of ovals) shape.appendCircle(x, y, rx, ry ?? rx);
  return shape;
}

export class RigSkin {
  readonly node = new SceneNode();
  private readonly bound: [paint: PaintNode, bone: number][] = [];
  private readonly outlines: [shape: ShapeNode, path: SkinnedPath][] = [];
  constructor(readonly skeleton: Skeleton) {}
  /** Adds art drawn in the rest pose and lets `bone` carry it. One paint is bound as it is; several share a group. */
  piece(bone: string, ...paints: PaintNode[]): PaintNode {
    let carried = paints[0];
    if (paints.length !== 1) {
      const group = new SceneNode();
      for (const paint of paints) group.add(paint);
      carried = group;
    }
    this.bound.push([carried, this.skeleton.bone(bone)]);
    this.node.add(carried);
    return carried;
  }
  /** Adds a filled outline that bends with the bones: one curve through points that each ride their own bone. */
  outline(color: Rgb | Rgba, path: SkinnedPath): ShapeNode {
    const shape = new ShapeNode().fill(color[0], color[1], color[2], color[3] ?? 255);
    this.outlines.push([shape, path]);
    this.node.add(shape);
    return shape;
  }
  /** Poses every piece from one matrix per bone, and redraws each outline through its moved points. */
  pose(matrices: readonly Matrix[]): void {
    for (const [paint, bone] of this.bound) paint.transform(matrices[bone]);
    for (const [shape, path] of this.outlines) {
      // Figures in the same pose share one list of commands; none of them edits it.
      shape.commands = path.commands(matrices);
      shape.pathVersion++;
      shape.version++;
    }
  }
}
