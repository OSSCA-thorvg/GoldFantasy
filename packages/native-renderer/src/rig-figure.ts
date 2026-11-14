// One posed figure: a skeleton, the pose it is in and where that leaves every bone.
import { point } from '../../engine/src/geometry';
import { clipFrame, clipShift, sampleClip, type RigClip } from './rig-clip';
import { reachTurns, RigFrame, RigPose, solveRig, type Skeleton } from './rig-skeleton';

export interface RigLeg {
  hip: number;
  knee: number;
  foot: number;
  /** Controller layer that moves this foot's spot in planted clips, such as `step.r`. */
  step: string;
  /** Side the knee folds to: -1 ahead (+x), +1 behind. */
  bend: number;
}
const smooth = (t: number) => t * t * (3 - 2 * t);

export class RigFigure {
  readonly pose: RigPose;
  readonly frame: RigFrame;
  private readonly target: RigPose;
  private readonly from: RigPose;
  private readonly trunk: RigFrame;
  private clip: RigClip | null = null;
  private fade = 1;
  /** Height a flier keeps above the ground. */
  hover = 0;
  /**
   * `unit` is this figure's size against the mannequin clips are authored on, so shifts and steps
   * keep their proportion on a giant or an imp.
   */
  constructor(
    readonly skeleton: Skeleton,
    readonly legs: readonly RigLeg[],
    readonly unit = 1,
  ) {
    this.pose = new RigPose(skeleton.count);
    this.target = new RigPose(skeleton.count);
    this.from = new RigPose(skeleton.count);
    this.frame = new RigFrame(skeleton.count);
    this.trunk = new RigFrame(skeleton.count);
    solveRig(skeleton, this.pose, this.frame);
  }
  /**
   * Poses the figure from `clip` at `frame`. A change of clip is eased in over `blend` seconds of
   * `elapsed` time, joint angle by joint angle, so one motion flows into the next without a pop.
   */
  play(clip: RigClip, frame: number, elapsed = 0, blend = 0.14, adjust?: (pose: RigPose) => void): void {
    if (clip !== this.clip) {
      this.from.copy(this.pose);
      this.fade = this.clip ? 0 : 1;
      this.clip = clip;
    }
    sampleClip(clip, frame, this.skeleton, this.target, this.unit);
    if (clip.planted) this.plant(clip, frame);
    this.fade = Math.min(1, this.fade + (blend > 0 ? elapsed / blend : 1));
    this.pose.copy(this.target);
    if (this.fade < 1) this.pose.copy(this.from).mix(this.target, smooth(this.fade));
    // A creature's own habits (a hunch, beating wings) ride on top of whatever the clip asks.
    adjust?.(this.pose);
    this.settle();
  }
  /** Solves the bones and rests the lowest foot on the ground (or `hover` above it). Call after changing `pose` by hand. */
  settle(): void {
    const { skeleton, frame } = this;
    solveRig(skeleton, this.pose, frame);
    let sunk = -Infinity;
    for (const leg of this.legs) sunk = Math.max(sunk, frame.jointY[leg.foot] - skeleton.restY[leg.foot]);
    const rise = (this.legs.length ? sunk : 0) + this.hover;
    if (Math.abs(rise) < 1e-6) return;
    for (let i = 0; i < skeleton.count; i++) {
      frame.matrices[i * 6 + 5] -= rise;
      frame.jointY[i] -= rise;
    }
  }
  /** Solves each leg so its foot stays on its spot while the trunk moves over it. */
  private plant(clip: RigClip, frame: number): void {
    const { skeleton, target, trunk } = this,
      at = clipFrame(clip, frame);
    solveRig(skeleton, target, trunk);
    for (const leg of this.legs) {
      const step = clipShift(clip, leg.step, at),
        parent = skeleton.parents[leg.hip],
        parentTurn = parent < 0 ? 0 : trunk.turn[parent],
        rest = [leg.hip, leg.knee, leg.foot].map((bone) => point(skeleton.restX[bone], skeleton.restY[bone])),
        turns = reachTurns(
          [rest[0], rest[1], rest[2]],
          trunk.joint(leg.hip),
          point(rest[2].x + step.x * this.unit, rest[2].y + step.y * this.unit),
          leg.bend,
          parentTurn,
        );
      target.angle[leg.hip] = turns.first;
      target.angle[leg.knee] = turns.second;
      // The sole stays flat whatever the leg does.
      target.angle[leg.foot] = -(parentTurn + turns.first + turns.second);
    }
  }
}
