// A jointed figure posed by angles: bones turn about their joints and carry whatever art is bound to them.
import { point, type Point } from '../../engine/src/geometry';
import type { Matrix } from './paint';

export interface BoneSpec {
  name: string;
  parent?: string;
  /** Where the joint sits in the rest pose, in the figure's own space (feet at the origin, +x ahead). */
  x: number;
  y: number;
  /** How far the joint may turn from rest, in radians. A clip that asks for more is held at the limit. */
  min?: number;
  max?: number;
}

/**
 * Bones are listed parents first. Art is drawn in the rest pose and bound to one bone, so a bone's
 * matrix is the identity at rest and every turn is a rotation about that bone's rest joint.
 */
export class Skeleton {
  readonly names: readonly string[];
  readonly parents: Int16Array;
  readonly restX: Float32Array;
  readonly restY: Float32Array;
  readonly min: Float32Array;
  readonly max: Float32Array;
  private readonly lookup = new Map<string, number>();
  constructor(bones: readonly BoneSpec[]) {
    const count = bones.length;
    this.names = bones.map((bone) => bone.name);
    this.parents = new Int16Array(count);
    this.restX = new Float32Array(count);
    this.restY = new Float32Array(count);
    this.min = new Float32Array(count).fill(-Infinity);
    this.max = new Float32Array(count).fill(Infinity);
    bones.forEach((bone, index) => {
      if (this.lookup.has(bone.name)) throw new Error(`Bone '${bone.name}' is listed twice`);
      const parent = bone.parent === undefined ? -1 : (this.lookup.get(bone.parent) ?? -2);
      if (parent === -2) throw new Error(`Bone '${bone.name}' comes before its parent '${bone.parent}'`);
      this.lookup.set(bone.name, index);
      this.parents[index] = parent;
      this.restX[index] = bone.x;
      this.restY[index] = bone.y;
      if (bone.min !== undefined) this.min[index] = bone.min;
      if (bone.max !== undefined) this.max[index] = bone.max;
    });
  }
  get count(): number {
    return this.names.length;
  }
  /** Index of a bone, or -1 when this figure has no such bone. */
  find(name: string): number {
    return this.lookup.get(name) ?? -1;
  }
  bone(name: string): number {
    const index = this.find(name);
    if (index < 0) throw new Error(`No bone named '${name}'`);
    return index;
  }
}

/** Joint angles in radians (positive turns clockwise on screen), lengthwise stretch, and joint shifts. */
export class RigPose {
  readonly angle: Float32Array;
  readonly stretch: Float32Array;
  readonly shiftX: Float32Array;
  readonly shiftY: Float32Array;
  constructor(readonly count: number) {
    this.angle = new Float32Array(count);
    this.stretch = new Float32Array(count).fill(1);
    this.shiftX = new Float32Array(count);
    this.shiftY = new Float32Array(count);
  }
  rest(): this {
    this.angle.fill(0);
    this.stretch.fill(1);
    this.shiftX.fill(0);
    this.shiftY.fill(0);
    return this;
  }
  copy(from: RigPose): this {
    this.angle.set(from.angle);
    this.stretch.set(from.stretch);
    this.shiftX.set(from.shiftX);
    this.shiftY.set(from.shiftY);
    return this;
  }
  /** Moves every joint `amount` of the way toward `to`, angle by angle: a joint never takes a shortcut through itself. */
  mix(to: RigPose, amount: number): this {
    for (let i = 0; i < this.count; i++) {
      this.angle[i] += (to.angle[i] - this.angle[i]) * amount;
      this.stretch[i] += (to.stretch[i] - this.stretch[i]) * amount;
      this.shiftX[i] += (to.shiftX[i] - this.shiftX[i]) * amount;
      this.shiftY[i] += (to.shiftY[i] - this.shiftY[i]) * amount;
    }
    return this;
  }
}

/** Solved bones: a row-major 2x3 matrix each (a b tx / c d ty) and where each joint ended up. */
export class RigFrame {
  readonly matrices: Float32Array;
  readonly jointX: Float32Array;
  readonly jointY: Float32Array;
  /** Total turn of each bone from rest, parents included. */
  readonly turn: Float32Array;
  constructor(count: number) {
    this.matrices = new Float32Array(count * 6);
    this.jointX = new Float32Array(count);
    this.jointY = new Float32Array(count);
    this.turn = new Float32Array(count);
  }
  matrix(bone: number): Matrix {
    const m = this.matrices,
      at = bone * 6;
    return [m[at], m[at + 1], m[at + 2], m[at + 3], m[at + 4], m[at + 5], 0, 0, 1];
  }
  joint(bone: number): Point {
    return point(this.jointX[bone], this.jointY[bone]);
  }
  /** Where a rest-pose point bound to `bone` is now. */
  carry(bone: number, x: number, y: number): Point {
    const m = this.matrices,
      at = bone * 6;
    return point(m[at] * x + m[at + 1] * y + m[at + 2], m[at + 3] * x + m[at + 4] * y + m[at + 5]);
  }
}

const clamp = (value: number, low: number, high: number) => (value < low ? low : value > high ? high : value);

/** Forward kinematics: each bone turns about its rest joint inside its parent's frame. */
export function solveRig(skeleton: Skeleton, pose: RigPose, frame: RigFrame): void {
  const m = frame.matrices;
  for (let i = 0; i < skeleton.count; i++) {
    const parent = skeleton.parents[i],
      turn = clamp(pose.angle[i], skeleton.min[i], skeleton.max[i]),
      c = Math.cos(turn),
      s = Math.sin(turn),
      // Bones hang along y at rest, so lengthwise stretch scales that axis before the turn.
      k = pose.stretch[i],
      px = skeleton.restX[i],
      py = skeleton.restY[i],
      a = c,
      b = -s * k,
      d = s,
      e = c * k,
      tx = px + pose.shiftX[i] - a * px - b * py,
      ty = py + pose.shiftY[i] - d * px - e * py,
      at = i * 6;
    if (parent < 0) {
      m[at] = a;
      m[at + 1] = b;
      m[at + 2] = tx;
      m[at + 3] = d;
      m[at + 4] = e;
      m[at + 5] = ty;
      frame.jointX[i] = px + pose.shiftX[i];
      frame.jointY[i] = py + pose.shiftY[i];
      frame.turn[i] = turn;
      continue;
    }
    const p = parent * 6,
      pa = m[p],
      pb = m[p + 1],
      ptx = m[p + 2],
      pd = m[p + 3],
      pe = m[p + 4],
      pty = m[p + 5],
      jx = px + pose.shiftX[i],
      jy = py + pose.shiftY[i];
    m[at] = pa * a + pb * d;
    m[at + 1] = pa * b + pb * e;
    m[at + 2] = pa * tx + pb * ty + ptx;
    m[at + 3] = pd * a + pe * d;
    m[at + 4] = pd * b + pe * e;
    m[at + 5] = pd * tx + pe * ty + pty;
    frame.jointX[i] = pa * jx + pb * jy + ptx;
    frame.jointY[i] = pd * jx + pe * jy + pty;
    frame.turn[i] = frame.turn[parent] + turn;
  }
}

const wrap = (angle: number) => angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
export interface Reach {
  /** Turn of the first bone and of the second relative to it, both from rest. */
  first: number;
  second: number;
}
/**
 * Two-bone reach: the turns that bring the chain's end to `target`. `rest` holds the root, middle and
 * end joints as they lie at rest. `bend` picks the side the middle joint goes to (+1 clockwise of the
 * line from root to target, -1 the other), so a knee or elbow can never fold the wrong way by accident.
 */
export function reachTurns(
  rest: readonly [Point, Point, Point],
  root: Point,
  target: Point,
  bend: number,
  parentTurn = 0,
): Reach {
  const [r0, r1, r2] = rest,
    a = Math.hypot(r1.x - r0.x, r1.y - r0.y),
    b = Math.hypot(r2.x - r1.x, r2.y - r1.y),
    dx = target.x - root.x,
    dy = target.y - root.y,
    span = clamp(Math.hypot(dx, dy), Math.abs(a - b) + 1e-3, a + b - 1e-3),
    toward = Math.atan2(dy, dx),
    // Law of cosines: the angle at the root between the line to the target and the first bone.
    open = Math.acos(clamp((a * a + span * span - b * b) / (2 * a * span), -1, 1)),
    firstWay = toward + (bend >= 0 ? open : -open),
    midX = root.x + Math.cos(firstWay) * a,
    midY = root.y + Math.sin(firstWay) * a,
    endX = root.x + Math.cos(toward) * span,
    endY = root.y + Math.sin(toward) * span,
    secondWay = Math.atan2(endY - midY, endX - midX),
    first = wrap(firstWay - Math.atan2(r1.y - r0.y, r1.x - r0.x) - parentTurn);
  return { first, second: wrap(secondWay - Math.atan2(r2.y - r1.y, r2.x - r1.x) - parentTurn - first) };
}
