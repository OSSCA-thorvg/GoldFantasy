import { point, type Point } from '../../engine/src/geometry';
import { f32, hash01, clamp } from '../../engine/src/numeric';
import { Person, Activity } from '../../engine/src/person';
import { poseArm, reachArm, type ArmRig } from './person-arm';
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
const pi = f32(3.14159265);
const roll = (seed: number, salt: number) => hash01(seed, salt | 0, 0, 0xa4f5);
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
    use = [false, false];
  let lift = 0,
    primary = pose.mirrored ? 0 : 1;
  if (!arms[primary].free) primary = f32(1 - primary);
  // Only the hand's place is chosen here; reachArm puts the elbow where a relaxed one hangs.
  const one = (at: Point) => {
    const side = primary ? 1 : -1;
    target[primary] = point(f32(at.x * side), at.y);
    use[primary] = true;
  };
  const both = (left: Point, right: Point) => {
    target[0] = left;
    target[1] = right;
    use[0] = use[1] = true;
  };
  switch (pose.kind) {
    case IdleGesture.Wave:
      one(point(f32(f32(4.7) + f32(f32(0.18) * beat)), f32(0.8)));
      wrist[primary] = f32(f32(0.3) * beat);
      break;
    case IdleGesture.HairTuck:
      one(point(f32(f32(3.1) - f32(f32(0.4) * smoothstep(active))), f32(-f32(0.2) - f32(f32(0.4) * slow))));
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
      both(point(-f32(4.4), f32(3.5)), point(f32(4.4), f32(3.5)));
      wrist[0] = f32(0.5);
      wrist[1] = -f32(0.5);
      lift = -f32(0.18);
      break;
    case IdleGesture.SideStretch:
      one(point(f32(4.6), f32(-1 - f32(f32(0.1) * slow))));
      wrist[primary] = -f32(0.3);
      break;
    case IdleGesture.Stretch:
      both(
        point(-f32(4.7), f32(-f32(0.4) - f32(f32(0.12) * slow))),
        point(f32(4.7), f32(-f32(0.4) - f32(f32(0.12) * slow))),
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
      reachArm(arms[i], point(f32(target[i].x * span), f32(head + target[i].y)), amount, wrist[i], lift);
    else poseArm(arms[i]);
  }
}
