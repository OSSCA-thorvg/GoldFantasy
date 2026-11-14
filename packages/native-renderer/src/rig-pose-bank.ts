// Solved poses shared by every figure of one kind: a clip frame is worked out once and a whole pack
// reads it back, so a hundred monsters in step cost one skeleton, not a hundred.
import type { Matrix } from './paint';
import { clipFrame, type RigClip } from './rig-clip';
import type { RigFigure } from './rig-figure';
import type { RigPose } from './rig-skeleton';

export class PoseBank {
  private readonly solved = new Map<RigClip, (readonly Matrix[] | undefined)[]>();
  /** `habit` is the creature's standing manner (a hunch, say), laid over every clip pose. */
  constructor(
    private readonly figure: RigFigure,
    private readonly habit?: (pose: RigPose, clip: RigClip, frame: number) => void,
  ) {}
  /**
   * Bone matrices of `clip` at `frame`, held to steps of `step` frames. Returns the same array for
   * the same step, so a caller can tell at a glance that nothing changed since it last asked.
   */
  pose(clip: RigClip, frame: number, step = 1): readonly Matrix[] {
    const at = clipFrame(clip, frame),
      slot = Math.min(Math.round(clip.frames / step), Math.round(at / step)),
      index = clip.loop && slot * step >= clip.frames ? 0 : slot;
    let frames = this.solved.get(clip);
    if (!frames) this.solved.set(clip, (frames = []));
    let matrices = frames[index];
    if (!matrices) {
      const { figure, habit } = this,
        time = index * step;
      figure.play(clip, time, 0, 0, habit ? (pose) => habit(pose, clip, time) : undefined);
      matrices = Array.from({ length: figure.skeleton.count }, (_, bone) => figure.frame.matrix(bone));
      frames[index] = matrices;
    }
    return matrices;
  }
}
