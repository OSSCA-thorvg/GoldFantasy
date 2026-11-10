import { poseArm, reachArm } from './idle-gesture';
import { poseBow, type HeldTool } from './person-equipment';
import type { PersonParts, MonsterParts } from './world-sprites';

export const strikePhase = 0.52 / 0.7;
type ActionPose = {
  upper: number;
  elbow: number;
  direction: number;
  crouch: number;
  lift: number;
  lean: number;
  forward: number;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const keys: (ActionPose & { at: number })[] = [
  { at: 0, upper: -0.75, elbow: -0.25, direction: -0.65, crouch: 0.02, lift: 0, lean: 0, forward: 0 },
  { at: 0.24, upper: -1.5, elbow: -0.6, direction: -1.8, crouch: 0.18, lift: 0, lean: -0.06, forward: -0.6 },
  {
    at: 0.5,
    upper: -2.65,
    elbow: -0.35,
    direction: -2.1,
    crouch: -0.045,
    lift: 2.5,
    lean: -0.04,
    forward: 0,
  },
  {
    at: 0.63,
    upper: -2.25,
    elbow: -0.1,
    direction: -1.65,
    crouch: -0.02,
    lift: 1.8,
    lean: 0.02,
    forward: 0.3,
  },
  {
    at: strikePhase,
    upper: -0.9,
    elbow: 0.05,
    direction: 0.05,
    crouch: 0.16,
    lift: 0,
    lean: 0.15,
    forward: 1.5,
  },
  { at: 0.84, upper: -0.6, elbow: 0.25, direction: 0.5, crouch: 0.19, lift: 0, lean: 0.18, forward: 1.7 },
  { at: 1, upper: -0.75, elbow: -0.25, direction: -0.65, crouch: 0.02, lift: 0, lean: 0, forward: 0 },
];

/** Impacts remain on the simulation's strike boundary; only the visible preparation changes. */
export function actionPose(elapsed: number, period: number): ActionPose {
  const phase = (((elapsed % period) + period) % period) / period;
  let next = 1;
  while (next < keys.length - 1 && phase > keys[next].at) ++next;
  const from = keys[next - 1],
    to = keys[next],
    t = (phase - from.at) / (to.at - from.at);
  // Accelerate into contact, then let the body absorb the impact instead of snapping back.
  const eased = next === 4 ? t * t : smooth(t);
  const blend = (key: keyof ActionPose) => from[key] + (to[key] - from[key]) * eased;
  return {
    upper: blend('upper'),
    elbow: blend('elbow'),
    direction: blend('direction'),
    crouch: blend('crouch'),
    lift: blend('lift'),
    lean: blend('lean'),
    forward: blend('forward'),
  };
}

export function animateAction(
  parts: PersonParts,
  tool: HeldTool | null,
  elapsed: number,
  period: number,
): void {
  const phase = (((elapsed % period) + period) % period) / period;
  if (!tool) {
    const punch = Math.max(0, 1 - Math.abs(phase - strikePhase) / 0.16);
    reachArm(
      parts.arms[1],
      { x: 3.6 + punch * 3.5, y: parts.arms[1].shoulder.y + 1.3 - punch * 0.5 },
      1,
      1,
      0,
      0,
    );
    reachArm(parts.arms[0], { x: -1.2, y: parts.arms[0].shoulder.y + 2.2 }, -1, 1, 0, 0);
    parts.body?.transform([1, -0.055 * punch, 0.65 * punch, 0, 0.98 - 0.035 * punch, 0, 0, 0, 1]);
    parts.feet[0]?.translate(-0.35, 0);
    parts.feet[1]?.translate(0.35, 0);
    return;
  }
  if (tool === 'bow') {
    const draw =
      phase < strikePhase
        ? smooth(Math.min(1, phase / 0.58))
        : 1 - smooth(Math.min(1, (phase - strikePhase) / 0.09));
    const release = phase >= strikePhase ? Math.sin(Math.min(1, (phase - strikePhase) / 0.2) * Math.PI) : 0;
    poseArm(parts.arms[1], -1.3, -0.12, 1.42, 0);
    poseArm(parts.arms[0], -1.15 + draw * 0.3, -1.15 - draw * 0.4, 0.3, -0.4);
    poseBow(parts, draw);
    parts.arrow?.opacity(phase < strikePhase ? 255 : 0);
    parts.body?.transform([1, -0.025 * draw, -0.4 * release, 0, 1 - 0.045 * draw, 0, 0, 0, 1]);
    parts.feet[0]?.translate(-0.5, 0);
    parts.feet[1]?.translate(0.7, 0);
    return;
  }
  const pose = actionPose(elapsed, period);
  // The pick finishes lower, into the deposit; an axe or blade finishes at torso height.
  const downward = tool === 'pickaxe' ? 0.35 : tool === 'hammer' ? 0.18 : 0;
  const contact = phase > 0.63 && phase < 0.94 ? Math.sin(((phase - 0.63) / 0.31) * Math.PI) : 0;
  const direction = pose.direction + downward * contact;
  const toolRestAngle = tool === 'staff' ? Math.atan2(-19, 6.9) : Math.atan2(-8, 6);
  poseArm(parts.arms[1], pose.upper, pose.elbow, direction - toolRestAngle - pose.upper - pose.elbow);
  // The free arm counters the overhead lift, then braces across the body on landing.
  poseArm(parts.arms[0], -0.45 - pose.lift * 0.12, -0.4 - pose.crouch * 2, 0.1);
  const strength = tool === 'staff' ? 0.65 : tool === 'hammer' ? 0.75 : 1;
  parts.body?.transform([
    1,
    -pose.lean * strength,
    pose.forward * strength,
    0,
    1 - pose.crouch * strength,
    -pose.lift * strength,
    0,
    0,
    1,
  ]);
  parts.feet[0]?.translate(-0.65 - pose.crouch * 2, 0);
  parts.feet[1]?.translate(0.65 + pose.crouch * 2, -pose.lift * 0.14);
  const shadow = 1 - pose.lift * 0.045 * strength;
  parts.shadow?.transform([shadow, 0, 0, 0, shadow, 0, 0, 0, 1]);
}

// Work uses a restrained hand-led motion. Contact is supplied by the same clock
// as the simulation's impact event; combat retains its separate dynamic poses.
const workKeys: (ActionPose & { at: number })[] = [
  { at: 0, upper: -0.88, elbow: -0.25, direction: -0.35, crouch: 0.01, lift: 0, lean: 0.01, forward: 0 },
  {
    at: 0.28,
    upper: -1.05,
    elbow: -0.3,
    direction: -0.6,
    crouch: 0.02,
    lift: 0,
    lean: -0.01,
    forward: -0.12,
  },
  {
    at: 0.52,
    upper: -1.4,
    elbow: -0.25,
    direction: -1.05,
    crouch: 0.015,
    lift: 0,
    lean: -0.015,
    forward: -0.15,
  },
  { at: 0.63, upper: -1.3, elbow: -0.18, direction: -0.8, crouch: 0.02, lift: 0, lean: 0, forward: 0 },
  { at: 0.75, upper: -0.95, elbow: -0.08, direction: 0.08, crouch: 0.035, lift: 0, lean: 0.03, forward: 0.3 },
  {
    at: 0.86,
    upper: -0.9,
    elbow: -0.12,
    direction: -0.02,
    crouch: 0.025,
    lift: 0,
    lean: 0.02,
    forward: 0.18,
  },
  { at: 1, upper: -0.88, elbow: -0.25, direction: -0.35, crouch: 0.01, lift: 0, lean: 0.01, forward: 0 },
];
export function workPose(elapsed: number, period: number, impact: number): ActionPose {
  const phase = (((elapsed % period) + period) % period) / period,
    contact = impact / period;
  const at = phase <= contact ? (phase / contact) * 0.75 : 0.75 + ((phase - contact) / (1 - contact)) * 0.25;
  let next = 1;
  while (next < workKeys.length - 1 && at > workKeys[next].at) ++next;
  const from = workKeys[next - 1],
    to = workKeys[next],
    t = (at - from.at) / (to.at - from.at),
    eased = next === 4 ? t * t : smooth(t),
    blend = (key: keyof ActionPose) => from[key] + (to[key] - from[key]) * eased;
  return {
    upper: blend('upper'),
    elbow: blend('elbow'),
    direction: blend('direction'),
    crouch: blend('crouch'),
    lift: 0,
    lean: blend('lean'),
    forward: blend('forward'),
  };
}
export function animateWork(
  parts: PersonParts,
  tool: HeldTool | null,
  elapsed: number,
  period: number,
  impact: number,
): void {
  const pose = workPose(elapsed, period, impact),
    phase = (((elapsed % period) + period) % period) / period,
    contact = impact / period,
    nearing = smooth(Math.max(0, 1 - Math.abs(phase - contact) / 0.16)),
    direction =
      -0.35 +
      (pose.direction + 0.35) * (tool === 'hammer' ? 0.7 : 1) +
      (tool === 'pickaxe' ? 0.3 : tool === 'hammer' ? 0.12 : 0) * nearing,
    restAngle = Math.atan2(-8, 6);
  if (!tool) {
    // Empty hands pull, press or clear material close to the body. They never
    // mimic holding an invisible full-length tool.
    reachArm(parts.arms[1], { x: 4 + nearing * 2, y: -4.5 + nearing * 1.8 }, 1, 1, 0, 0);
    reachArm(parts.arms[0], { x: 2.2 + nearing * 1.5, y: -4 + nearing * 1.8 }, -1, 1, 0, 0);
  } else poseArm(parts.arms[1], pose.upper, pose.elbow, direction - restAngle - pose.upper - pose.elbow);
  if (tool) poseArm(parts.arms[0], -0.45, -0.4 - pose.crouch * 0.5, 0.1);
  parts.body?.transform([1, -pose.lean, pose.forward, 0, 1 - pose.crouch, 0, 0, 0, 1]);
  // Neither foot nor shadow follows the striking arm: repeated work stays planted.
  parts.feet[0]?.translate(0, 0);
  parts.feet[1]?.translate(0, 0);
  parts.shadow?.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

const monsterPoses = [
  [0, 2.6, 0.22, 0.08, 0.35],
  [0.12, 1.1, 0.12, 0.16, 0],
  [0.3, 0, 0, 0, 0],
  [0.62, 0, 0, 0, 0],
  [0.85, -1.1, -0.07, 0.14, 0],
  [1, 2.6, 0.22, 0.08, 0.35],
];
/** A short, grounded recoil and anticipation, with contact at the monster's actual hit time. */
export function animateMonsterAttack(parts: MonsterParts, elapsed: number, period: number): void {
  const phase = Math.max(0, Math.min(1, elapsed / period)),
    poses = monsterPoses;
  let next = 1;
  while (next < poses.length - 1 && phase > poses[next][0]) ++next;
  const from = poses[next - 1],
    to = poses[next];
  const t = (phase - from[0]) / (to[0] - from[0]),
    blend = next === 5 ? t * t : smooth(t);
  const value = (index: number) => from[index] + (to[index] - from[index]) * blend;
  parts.body.transform([1, -value(2), value(1), 0, 1 - value(3), -value(4), 0, 0, 1]);
}
