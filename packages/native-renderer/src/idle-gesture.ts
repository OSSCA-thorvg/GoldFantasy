import { point, add, sub, mul, type Point } from '../../engine/src/geometry';
import { f32, hash01, remainder, clamp } from '../../engine/src/numeric';
import { Person, Activity } from '../../engine/src/person';
import { SceneNode, ShapeNode, type Rgb, type Matrix } from './paint';
import { appendPolygon, ellipse, opaque, fill } from './vector-paint';
import { Mood } from './person-portrait';
export enum IdleGesture {
  None = -1,
  Wave,
  HairTuck,
  ChinRest,
  Collar,
  Cuff,
  WristRoll,
  PalmRub,
  Shrug,
  SideStretch,
  Stretch,
  Count,
}
export interface GesturePose {
  kind: IdleGesture;
  phase: number;
  mirrored: boolean;
}
export class ArmRig {
  upper: SceneNode | null = null;
  forearm: SceneNode | null = null;
  hand: SceneNode | null = null;
  shoulder = point();
  elbow = point();
  wrist = point();
  free = true;
  shoulderLink: ShapeNode | null = null;
  shoulderRadius = 0;
  shoulderLift = 0;
}
const pi = f32(3.14159265);
const roll = (seed: number, salt: number) => hash01(seed, salt | 0, 0, 0xa4f5);
const angle = (v: Point) => f32(Math.atan2(v.y, v.x));
const shortAngle = (value: number) => remainder(value, f32(2 * pi));
function rotate(p: Point, radians: number): Point {
  const c = f32(Math.cos(radians)),
    s = f32(Math.sin(radians));
  return point(f32(f32(c * p.x) - f32(s * p.y)), f32(f32(s * p.x) + f32(c * p.y)));
}
function shoulderJoin(arm: ArmRig, lift: number): void {
  const radius = arm.shoulderRadius,
    anchor = add(
      arm.shoulder,
      point(
        f32(f32(-(arm.shoulder.x < 0 || Object.is(arm.shoulder.x, -0) ? -1 : 1) * radius) * f32(1.25)),
        0,
      ),
    ),
    moved = add(arm.shoulder, point(0, lift)),
    delta = sub(moved, anchor),
    length = Math.max(f32(0.0001), f32(Math.hypot(delta.x, delta.y))),
    normal = point(f32(f32(-delta.y * radius) / length), f32(f32(delta.x * radius) / length));
  arm
    .shoulderLink!.reset()
    .appendCircle(anchor.x, anchor.y, radius, radius)
    .appendCircle(moved.x, moved.y, radius, radius);
  appendPolygon(arm.shoulderLink!, [
    add(anchor, normal),
    sub(anchor, normal),
    sub(moved, normal),
    add(moved, normal),
  ]);
}
function reach(rig: ArmRig, hand: Point, bend: number, weight: number, wrist: number, lift: number): void {
  const upper = sub(rig.elbow, rig.shoulder),
    lower = sub(rig.wrist, rig.elbow),
    a = f32(Math.hypot(upper.x, upper.y)),
    b = f32(Math.hypot(lower.x, lower.y)),
    delta = sub(hand, rig.shoulder),
    d = clamp(
      f32(Math.hypot(delta.x, delta.y)),
      f32(Math.abs(f32(a - b)) + f32(0.02)),
      f32(f32(a + b) - f32(0.02)),
    ),
    direction = angle(delta),
    along = f32(f32(f32(f32(a * a) - f32(b * b)) + f32(d * d)) / f32(2 * d)),
    height = f32(Math.sqrt(Math.max(0, f32(f32(a * a) - f32(along * along)))));
  const elbow = point(
      f32(f32(f32(Math.cos(direction)) * along) - f32(f32(f32(Math.sin(direction)) * height) * bend)),
      f32(f32(f32(Math.sin(direction)) * along) + f32(f32(f32(Math.cos(direction)) * height) * bend)),
    ),
    target = point(f32(f32(Math.cos(direction)) * d), f32(f32(Math.sin(direction)) * d)),
    shoulderTurn = shortAngle(f32(angle(elbow) - angle(upper))),
    elbowTurn = shortAngle(f32(f32(angle(sub(target, elbow)) - angle(lower)) - shoulderTurn));
  poseArm(rig, f32(shoulderTurn * weight), f32(elbowTurn * weight), f32(wrist * weight), f32(lift * weight));
}
// Shared two-link inverse kinematics for authored, grounded hand poses.
export { reach as reachArm };
export const gestureName = (kind: IdleGesture): string =>
  [
    'Wave',
    'Hair tuck',
    'Thinking',
    'Collar',
    'Cuff',
    'Wrist roll',
    'Palm rub',
    'Shrug',
    'Side stretch',
    'Stretch',
  ][kind] ?? 'Auto';
export function idleGesture(seed: number, mood: Mood, seconds: number): GesturePose {
  const none: GesturePose = { kind: IdleGesture.None, phase: 0, mirrored: false };
  if (!Number.isFinite(seconds) || [Mood.Asleep, Mood.Fierce, Mood.Hurt, Mood.Exhausted].includes(mood))
    return none;
  const shifted = seconds - (3.5 + f32(roll(seed, 1) * 12));
  if (shifted < 0) return none;
  const cycle = Math.floor(shifted / 12) >>> 0,
    within = shifted % 12,
    begin = 0.8 + roll(seed, (cycle + 20) >>> 0) * 2.6,
    duration = 2.4 + roll(seed, (cycle + 40) >>> 0) * 0.8;
  if (within < begin || within >= begin + duration) return none;
  const first = Math.min(9, Math.trunc(f32(roll(seed, 2) * 10)));
  return {
    kind: ((first + Math.imul(cycle, seed % 2 ? 3 : 7)) >>> 0) % 10,
    phase: f32((within - begin) / duration),
    mirrored: roll(seed, (cycle + 60) >>> 0) > 0.5,
  };
}

export function canIdleGesture(p: Person): boolean {
  return (
    !p.moving() &&
    !p.crossingDoorway() &&
    !p.inside &&
    [Activity.Idle, Activity.Holding, Activity.Relaxing, Activity.Brooding, Activity.Guarding].includes(
      p.activity,
    )
  );
}
export function connectArm(
  arm: ArmRig,
  root: SceneNode,
  cloth: Rgb,
  width: number,
  cuffInset: number,
  edge: Rgb = [0, 0, 0],
  edgeWidth = 0,
): void {
  arm.shoulderRadius = f32(width * f32(0.5));
  arm.shoulderLift = 0;
  arm.shoulderLink = new ShapeNode();
  fill(arm.shoulderLink, opaque(cloth));
  shoulderJoin(arm, 0);
  root.add(arm.shoulderLink);
  const axis = sub(arm.wrist, arm.elbow),
    length = Math.max(f32(0.0001), f32(Math.hypot(axis.x, axis.y))),
    cuff = sub(arm.wrist, mul(axis, f32(cuffInset / length)));
  const stroke = (layer: SceneNode, from: Point, to: Point, color: Rgb, weight: number) => {
    layer.add(
      new ShapeNode()
        .moveTo(from.x, from.y)
        .lineTo(to.x, to.y)
        .strokeFill(...color)
        .strokeWidth(weight)
        .strokeCap('butt'),
    );
  };
  const radius = f32(width * f32(0.5));
  if (edgeWidth > 0) {
    arm.upper!.add(ellipse(arm.elbow, f32(radius + edgeWidth), f32(radius + edgeWidth), opaque(edge)));
    stroke(arm.upper!, arm.shoulder, arm.elbow, edge, f32(width + f32(edgeWidth * 2)));
    stroke(arm.forearm!, arm.elbow, cuff, edge, f32(width + f32(edgeWidth * 2)));
  }
  stroke(arm.upper!, arm.shoulder, arm.elbow, cloth, width);
  arm.forearm!.add(ellipse(arm.elbow, radius, radius, opaque(cloth)));
  stroke(arm.forearm!, arm.elbow, cuff, cloth, width);
}
export function poseArm(rig: ArmRig, upper = 0, elbow = 0, wrist = 0, lift = 0, squash = 1): void {
  if (!rig.upper || !rig.forearm || !rig.hand) return;
  if (rig.shoulderLink && rig.shoulderLift !== lift) {
    shoulderJoin(rig, lift);
    rig.shoulderLift = lift;
  }
  let c = f32(Math.cos(upper)),
    s = f32(Math.sin(upper));
  const at: Matrix = [
    c,
    f32(-s * squash),
    f32(f32(rig.shoulder.x - f32(c * rig.shoulder.x)) + f32(f32(s * squash) * rig.shoulder.y)),
    s,
    f32(c * squash),
    f32(f32(f32(rig.shoulder.y - f32(s * rig.shoulder.x)) - f32(f32(c * squash) * rig.shoulder.y)) + lift),
    0,
    0,
    1,
  ];
  rig.upper.transform(at);
  const moved = point(
      f32(f32(f32(at[0] * rig.elbow.x) + f32(at[1] * rig.elbow.y)) + at[2]),
      f32(f32(f32(at[3] * rig.elbow.x) + f32(at[4] * rig.elbow.y)) + at[5]),
    ),
    co = f32(Math.cos(elbow)),
    si = f32(Math.sin(elbow)),
    a = f32(f32(at[0] * co) + f32(at[1] * si)),
    b = f32(f32(-at[0] * si) + f32(at[1] * co)),
    d = f32(f32(at[3] * co) + f32(at[4] * si)),
    e = f32(f32(-at[3] * si) + f32(at[4] * co));
  rig.forearm.transform([
    a,
    b,
    f32(f32(moved.x - f32(a * rig.elbow.x)) - f32(b * rig.elbow.y)),
    d,
    e,
    f32(f32(moved.y - f32(d * rig.elbow.x)) - f32(e * rig.elbow.y)),
    0,
    0,
    1,
  ]);
  const p = sub(rig.wrist, rotate(rig.wrist, wrist));
  c = f32(Math.cos(wrist));
  s = f32(Math.sin(wrist));
  rig.hand.transform([c, -s, p.x, s, c, p.y, 0, 0, 1]);
}
function smoothstep(t: number): number {
  t = clamp(t, 0, 1);
  return f32(f32(t * t) * f32(3 - f32(2 * t)));
}
export function animateGesture(arms: readonly [ArmRig, ArmRig], pose: GesturePose): void {
  if (pose.kind === IdleGesture.None || pose.kind === IdleGesture.Count || !Number.isFinite(pose.phase)) {
    for (const arm of arms) poseArm(arm);
    return;
  }
  const phase = clamp(pose.phase, 0, 1),
    amount = f32(
      smoothstep(f32(phase / f32(0.22))) * f32(1 - smoothstep(f32(f32(phase - f32(0.72)) / f32(0.28)))),
    ),
    active = clamp(f32(f32(phase - f32(0.22)) / f32(0.5)), 0, 1),
    beat = f32(Math.sin(f32(f32(active * 4) * pi))),
    slow = f32(Math.sin(f32(active * pi))),
    head = f32(f32(f32(arms[0].shoulder.y + arms[1].shoulder.y) * f32(0.5)) - 4),
    span = f32(f32(arms[1].shoulder.x - arms[0].shoulder.x) / f32(5.62));
  const target = [point(), point()],
    wrist = [0, 0],
    bend = [1, -1],
    use = [false, false];
  let lift = 0,
    primary = pose.mirrored ? 0 : 1;
  if (!arms[primary].free) primary = f32(1 - primary);
  const one = (at: Point, outward = false) => {
    const side = primary ? 1 : -1;
    target[primary] = point(f32(at.x * side), at.y);
    use[primary] = true;
    bend[primary] = outward ? side : -side;
  };
  const both = (left: Point, right: Point, outward = false) => {
    target[0] = left;
    target[1] = right;
    use[0] = use[1] = true;
    bend[0] = outward ? -1 : 1;
    bend[1] = -bend[0];
  };
  switch (pose.kind) {
    case IdleGesture.Wave:
      one(point(f32(f32(4.7) + f32(f32(0.18) * beat)), f32(0.8)), true);
      wrist[primary] = f32(f32(0.3) * beat);
      break;
    case IdleGesture.HairTuck:
      one(
        point(f32(f32(3.1) - f32(f32(0.4) * smoothstep(active))), f32(-f32(0.2) - f32(f32(0.4) * slow))),
        true,
      );
      wrist[primary] = f32(-f32(0.3) * slow);
      break;
    case IdleGesture.ChinRest:
      one(point(f32(1.15), f32(f32(3.55) - f32(f32(0.1) * slow))));
      wrist[primary] = -f32(0.25);
      break;
    case IdleGesture.Collar:
      both(
        point(-f32(0.95), f32(f32(4.3) + f32(f32(0.1) * beat))),
        point(f32(0.95), f32(f32(4.2) - f32(f32(0.1) * beat))),
      );
      wrist[0] = f32(0.2);
      wrist[1] = -f32(0.2);
      break;
    case IdleGesture.Cuff:
      both(point(-f32(0.3), f32(5.65)), point(f32(f32(0.65) + f32(f32(0.16) * beat)), f32(5.15)));
      wrist[0] = -f32(0.35);
      wrist[1] = f32(f32(0.2) * beat);
      break;
    case IdleGesture.WristRoll:
      both(point(-f32(1.65), f32(5.35)), point(f32(1.65), f32(5.35)));
      wrist[0] = f32(f32(0.65) * beat);
      wrist[1] = f32(-f32(0.65) * beat);
      break;
    case IdleGesture.PalmRub:
      both(
        point(f32(-f32(0.8) + f32(f32(0.12) * beat)), f32(4.8)),
        point(f32(f32(0.8) + f32(f32(0.12) * beat)), f32(4.65)),
      );
      wrist[0] = f32(0.2);
      wrist[1] = -f32(0.2);
      break;
    case IdleGesture.Shrug:
      both(point(-f32(4.4), f32(3.5)), point(f32(4.4), f32(3.5)), true);
      wrist[0] = f32(0.5);
      wrist[1] = -f32(0.5);
      lift = -f32(0.18);
      break;
    case IdleGesture.SideStretch:
      one(point(f32(4.6), f32(-1 - f32(f32(0.1) * slow))), true);
      wrist[primary] = -f32(0.3);
      break;
    case IdleGesture.Stretch:
      both(
        point(-f32(4.7), f32(-f32(0.4) - f32(f32(0.12) * slow))),
        point(f32(4.7), f32(-f32(0.4) - f32(f32(0.12) * slow))),
        true,
      );
      wrist[0] = -f32(0.35);
      wrist[1] = f32(0.35);
      lift = -f32(0.12);
      break;
  }
  if (use[0] && !use[1]) wrist[0] = f32(wrist[0] * -1);
  if (pose.mirrored && use[0] && use[1]) {
    [target[0], target[1]] = [target[1], target[0]];
    target[0].x = f32(target[0].x * -1);
    target[1].x = f32(target[1].x * -1);
    [wrist[0], wrist[1]] = [wrist[1], wrist[0]];
    wrist[0] = f32(wrist[0] * -1);
    wrist[1] = f32(wrist[1] * -1);
  }
  for (let i = 0; i < arms.length; i++) {
    if (use[i] && arms[i].free && amount > 0)
      reach(
        arms[i],
        point(f32(target[i].x * span), f32(head + target[i].y)),
        bend[i],
        amount,
        wrist[i],
        lift,
      );
    else poseArm(arms[i]);
  }
}
