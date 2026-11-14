// An outline that bends with a skeleton: every point rides one bone, and a single smooth curve is
// drawn through them all, so a body reads as one shape instead of parts laid side by side.
import type { Command, Matrix } from './paint';
import type { Skeleton } from './rig-skeleton';

/** A point of the outline in the rest pose, the bone that carries it, and whether the curve turns sharply there. */
export type OutlinePoint = readonly [x: number, y: number, bone: string, corner?: boolean];
interface Loop {
  x: Float32Array;
  y: Float32Array;
  bone: Int16Array;
  corner: Uint8Array;
}
export class SkinnedPath {
  private readonly loops: Loop[];
  private readonly solved = new WeakMap<readonly Matrix[], Command[]>();
  /** Each loop is one closed outline, listed in order round its edge. */
  constructor(skeleton: Skeleton, loops: readonly (readonly OutlinePoint[])[]) {
    this.loops = loops.map((points) => ({
      x: Float32Array.from(points, (p) => p[0]),
      y: Float32Array.from(points, (p) => p[1]),
      bone: Int16Array.from(points, (p) => skeleton.bone(p[2])),
      corner: Uint8Array.from(points, (p) => (p[3] ? 1 : 0)),
    }));
  }
  /** The outline for one pose. Worked out once per pose and shared by every figure standing in it. */
  commands(matrices: readonly Matrix[]): Command[] {
    let commands = this.solved.get(matrices);
    if (commands) return commands;
    commands = [];
    for (const loop of this.loops) {
      const count = loop.x.length,
        px = new Float32Array(count),
        py = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const m = matrices[loop.bone[i]];
        px[i] = m[0] * loop.x[i] + m[1] * loop.y[i] + m[2];
        py[i] = m[3] * loop.x[i] + m[4] * loop.y[i] + m[5];
      }
      commands.push(['M', px[0], py[0]]);
      for (let i = 0; i < count; i++) {
        const before = (i + count - 1) % count,
          next = (i + 1) % count,
          after = (i + 2) % count,
          // A corner keeps its tangent at zero, so the curve comes to a point there.
          outX = loop.corner[i] ? px[i] : px[i] + (px[next] - px[before]) / 6,
          outY = loop.corner[i] ? py[i] : py[i] + (py[next] - py[before]) / 6,
          inX = loop.corner[next] ? px[next] : px[next] - (px[after] - px[i]) / 6,
          inY = loop.corner[next] ? py[next] : py[next] - (py[after] - py[i]) / 6;
        commands.push(['C', outX, outY, inX, inY, px[next], py[next]]);
      }
      commands.push(['Z']);
    }
    this.solved.set(matrices, commands);
    return commands;
  }
}
