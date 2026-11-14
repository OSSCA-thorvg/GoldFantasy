// A resident's arm: posed by joint angles, drawn as one sleeve curving through several joints.
import { point, type Point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { SceneNode, ShapeNode, type Matrix, type Rgb } from './paint';
import { appendPolygon, fill, opaque } from './vector-paint';
import { limbJoints, threadCurve } from './rig-limb-path';

export class ArmRig {
  /** Sleeve from the shoulder to the elbow; it sits under the head. */
  upper: SceneNode | null = null;
  /** Everything from the elbow down, over the head: the rest of the sleeve, then `forearm`. */
  lower: SceneNode | null = null;
  /** The forearm's own frame: bindings, cuffs and the hand ride in it, drawn in the rest pose. */
  forearm: SceneNode | null = null;
  hand: SceneNode | null = null;
  /** Joints at rest, in the body's space. */
  shoulder = point();
  elbow = point();
  wrist = point();
  free = true;
  shoulderLink: ShapeNode | null = null;
  shoulderRadius = 0;
  shoulderLift = 0;
  /** Sleeve strokes, each an edge under a cloth stroke when the arm is outlined; redrawn on every pose. */
  sleeves: { shape: ShapeNode; lower: boolean }[] = [];
  /** Where the sleeve ends on the forearm, at rest. */
  cuff = point();
  /** The pose last set: turns in radians from the hanging rest (negative swings ahead and up). */
  turn = { upper: 0, elbow: 0, wrist: 0 };
}
const pi = Math.PI;
const wrap = (angle: number) => angle - 2 * pi * Math.round(angle / (2 * pi));
const direction = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);

function shoulderJoin(arm: ArmRig, lift: number): void {
  const radius = arm.shoulderRadius,
    side = arm.shoulder.x < 0 || Object.is(arm.shoulder.x, -0) ? -1 : 1,
    anchor = point(f32(arm.shoulder.x - side * radius * 1.25), arm.shoulder.y),
    moved = point(arm.shoulder.x, f32(arm.shoulder.y + lift)),
    dx = moved.x - anchor.x,
    dy = moved.y - anchor.y,
    length = Math.max(0.0001, Math.hypot(dx, dy)),
    normal = point(f32((-dy * radius) / length), f32((dx * radius) / length));
  arm
    .shoulderLink!.reset()
    .appendCircle(anchor.x, anchor.y, radius, radius)
    .appendCircle(moved.x, moved.y, radius, radius);
  appendPolygon(arm.shoulderLink!, [
    point(anchor.x + normal.x, anchor.y + normal.y),
    point(anchor.x - normal.x, anchor.y - normal.y),
    point(moved.x - normal.x, moved.y - normal.y),
    point(moved.x + normal.x, moved.y + normal.y),
  ]);
}
/**
 * Gives an arm its sleeve. `arm.upper`, `arm.forearm` and `arm.hand` are the caller's; this adds the
 * shoulder join to `root`, builds `arm.lower` round the forearm and draws the sleeve at rest.
 */
export function connectArm(
  arm: ArmRig,
  root: SceneNode,
  cloth: Rgb,
  width: number,
  cuffInset: number,
  edge: Rgb = [0, 0, 0],
  edgeWidth = 0,
): void {
  arm.shoulderRadius = f32(width * 0.5);
  arm.shoulderLift = 0;
  arm.shoulderLink = new ShapeNode();
  fill(arm.shoulderLink, opaque(cloth));
  shoulderJoin(arm, 0);
  root.add(arm.shoulderLink);
  const reach = Math.max(0.0001, Math.hypot(arm.wrist.x - arm.elbow.x, arm.wrist.y - arm.elbow.y)),
    back = cuffInset / reach;
  arm.cuff = point(
    arm.wrist.x - (arm.wrist.x - arm.elbow.x) * back,
    arm.wrist.y - (arm.wrist.y - arm.elbow.y) * back,
  );
  arm.lower = new SceneNode();
  arm.sleeves = [];
  const stroke = (color: Rgb, weight: number) => {
    for (const lower of [false, true]) {
      const shape = new ShapeNode()
        .strokeFill(...color)
        .strokeWidth(weight)
        .strokeCap('round')
        .strokeJoin('round');
      (lower ? arm.lower! : arm.upper!).add(shape);
      arm.sleeves.push({ shape, lower });
    }
  };
  if (edgeWidth > 0) stroke(edge, f32(width + edgeWidth * 2));
  stroke(cloth, width);
  arm.lower.add(arm.forearm!);
  placeArm(arm, 0, 0, 0, 0, 1, 1);
}
const joints: number[] = [];
/**
 * Poses the arm from joint angles. `squash` shortens the whole arm toward the eye; `upperReach` and
 * `foreReach` shorten one bone along its own length, as when it points at the viewer.
 */
function placeArm(
  rig: ArmRig,
  upper: number,
  elbow: number,
  wrist: number,
  lift: number,
  squash: number,
  upperReach: number,
  foreReach = 1,
): void {
  if (!rig.upper || !rig.forearm || !rig.hand) return;
  if (rig.shoulderLink && rig.shoulderLift !== lift) {
    shoulderJoin(rig, lift);
    rig.shoulderLift = lift;
  }
  rig.turn = { upper, elbow, wrist };
  const c = Math.cos(upper),
    s = Math.sin(upper),
    // The arm hangs along y at rest, so shortening scales that axis before the shoulder turns.
    ux = (rig.elbow.x - rig.shoulder.x) * upperReach,
    uy = (rig.elbow.y - rig.shoulder.y) * squash * upperReach,
    elbowX = rig.shoulder.x + c * ux - s * uy,
    elbowY = rig.shoulder.y + lift + s * ux + c * uy,
    co = Math.cos(elbow),
    si = Math.sin(elbow),
    // The forearm shortens along its own rest axis, so the hand still lands where the turns point it.
    fx = rig.wrist.x - rig.elbow.x,
    fy = rig.wrist.y - rig.elbow.y,
    fore = Math.max(0.0001, Math.hypot(fx, fy)),
    k = foreReach - 1,
    m00 = 1 + (k * fx * fx) / (fore * fore),
    m01 = (k * fx * fy) / (fore * fore),
    m11 = 1 + (k * fy * fy) / (fore * fore),
    a0 = c * co - s * squash * si,
    b0 = -c * si - s * squash * co,
    d0 = s * co + c * squash * si,
    e0 = -s * si + c * squash * co,
    a = a0 * m00 + b0 * m01,
    b = a0 * m01 + b0 * m11,
    d = d0 * m00 + e0 * m01,
    e = d0 * m01 + e0 * m11,
    frame: Matrix = [
      f32(a),
      f32(b),
      f32(elbowX - a * rig.elbow.x - b * rig.elbow.y),
      f32(d),
      f32(e),
      f32(elbowY - d * rig.elbow.x - e * rig.elbow.y),
      0,
      0,
      1,
    ];
  rig.forearm.transform(frame);
  // One curve from shoulder to cuff: the elbow is a bend in the cloth, not a hinge between two sticks.
  limbJoints(
    rig.shoulder.x,
    rig.shoulder.y + lift,
    elbowX,
    elbowY,
    frame[0] * rig.cuff.x + frame[1] * rig.cuff.y + frame[2],
    frame[3] * rig.cuff.x + frame[4] * rig.cuff.y + frame[5],
    0.6,
    joints,
  );
  for (const sleeve of rig.sleeves)
    threadCurve(sleeve.shape.reset(), joints, sleeve.lower ? 2 : 0, sleeve.lower ? 4 : 2);
  const cw = Math.cos(wrist),
    sw = Math.sin(wrist);
  rig.hand.transform([
    f32(cw),
    f32(-sw),
    f32(rig.wrist.x - cw * rig.wrist.x + sw * rig.wrist.y),
    f32(sw),
    f32(cw),
    f32(rig.wrist.y - sw * rig.wrist.x - cw * rig.wrist.y),
    0,
    0,
    1,
  ]);
}
/** Poses the arm by its joint angles: shoulder, elbow and wrist turns from the hanging rest. */
export function poseArm(rig: ArmRig, upper = 0, elbow = 0, wrist = 0, lift = 0, squash = 1): void {
  placeArm(rig, upper, elbow, wrist, lift, squash, 1);
}
/** Where the wrist is now, in the body's space. */
export function handOf(rig: ArmRig): Point {
  const m = rig.forearm!.matrix;
  return point(
    m[0] * rig.wrist.x + m[1] * rig.wrist.y + m[2],
    m[3] * rig.wrist.x + m[4] * rig.wrist.y + m[5],
  );
}
/**
 * Brings the hand to `hand` (body space) by `weight` of the way from the hanging rest. The elbow is
 * never left to chance: it goes where a hanging elbow would, down and a little outward, and when the
 * hand is close to the shoulder the arm shortens toward the eye instead of folding back on itself.
 * The pose is then reached by turning the joints, so the arm cannot pass through a reversed bend.
 */
export function reachArm(rig: ArmRig, hand: Point, weight: number, wrist: number, lift: number): void {
  const upperLength = Math.hypot(rig.elbow.x - rig.shoulder.x, rig.elbow.y - rig.shoulder.y),
    foreLength = Math.hypot(rig.wrist.x - rig.elbow.x, rig.wrist.y - rig.elbow.y),
    side = rig.shoulder.x < 0 || Object.is(rig.shoulder.x, -0) ? -1 : 1,
    shoulder = point(rig.shoulder.x, rig.shoulder.y + lift * weight),
    dx = hand.x - shoulder.x,
    dy = hand.y - shoulder.y,
    span = Math.hypot(dx, dy),
    // Where a relaxed elbow hangs.
    poleX = shoulder.x + side * 0.2 * upperLength,
    poleY = shoulder.y + 0.72 * upperLength;
  let elbow: Point,
    end: Point,
    foreReach = 1;
  if (span >= upperLength + foreLength - 0.02) {
    // Out of reach: a straight arm toward it.
    const k = 1 / Math.max(0.0001, span);
    elbow = point(shoulder.x + dx * k * upperLength, shoulder.y + dy * k * upperLength);
    end = point(elbow.x + dx * k * foreLength, elbow.y + dy * k * foreLength);
  } else {
    end = hand;
    const px = poleX - hand.x,
      py = poleY - hand.y,
      pole = Math.max(0.0001, Math.hypot(px, py));
    // The forearm keeps its length and points from the hanging elbow's side toward the hand.
    elbow = point(hand.x + (px / pole) * foreLength, hand.y + (py / pole) * foreLength);
    if (Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y) > upperLength) {
      // Too far for a shortened upper arm: both bones at full length, the elbow on the hanging side.
      const along = (upperLength * upperLength - foreLength * foreLength + span * span) / (2 * span),
        height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along)),
        ax = dx / span,
        ay = dy / span,
        one = point(shoulder.x + ax * along - ay * height, shoulder.y + ay * along + ax * height),
        other = point(shoulder.x + ax * along + ay * height, shoulder.y + ay * along - ax * height);
      elbow =
        Math.hypot(one.x - poleX, one.y - poleY) <= Math.hypot(other.x - poleX, other.y - poleY)
          ? one
          : other;
      // A hand held right by the shoulder would throw that elbow up beside the head: instead both
      // bones shorten and the elbow stays where it hangs, the arm folded toward the eye.
      if (elbow.y < shoulder.y && pole <= foreLength) {
        elbow = point(poleX, poleY);
        foreReach = pole / foreLength;
      }
    }
  }
  const restUpper = direction(rig.shoulder, rig.elbow),
    restFore = direction(rig.elbow, rig.wrist),
    upperTurn = wrap(direction(shoulder, elbow) - restUpper),
    elbowTurn = wrap(direction(elbow, end) - restFore - upperTurn),
    reach = Math.min(1, Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y) / upperLength);
  placeArm(
    rig,
    upperTurn * weight,
    elbowTurn * weight,
    wrist * weight,
    lift * weight,
    1,
    1 + (reach - 1) * weight,
    1 + (foreReach - 1) * weight,
  );
}
