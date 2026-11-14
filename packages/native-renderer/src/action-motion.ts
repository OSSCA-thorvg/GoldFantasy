// Blows in a fight and at work: a gathered wind-up, a quick strike on the simulation's contact, a settle.
import { point, type Point } from '../../engine/src/geometry';
import type { AbilityId } from '../../engine/src/combat-events';
import { humanoidClips } from './humanoid-rig';
import { poseArm, reachArm, type ArmRig } from './person-arm';
import { clipShift, clipTurn, type RigClip } from './rig-clip';
import type { Matrix } from './paint';
import { poseBow, type HeldTool } from './person-equipment';
import type { PersonParts } from './world-sprites';

export const strikePhase = 0.52 / 0.7;
export interface ActionPose {
  /** Shoulder turn of the tool arm: 0 hangs, negative swings it forward and up. */
  upper: number;
  elbow: number;
  /** Where the tool points: 0 level ahead, negative up, positive down. */
  direction: number;
  crouch: number;
  lift: number;
  /** Positive leans the body toward the target. */
  lean: number;
  forward: number;
  /** Positive bows the head toward the target. */
  nod: number;
}
type Key = ActionPose & { at: number };
const smooth = (t: number) => t * t * (3 - 2 * t);
const key = (
  at: number,
  upper: number,
  elbow: number,
  direction: number,
  lean = 0,
  forward = 0,
  crouch = 0,
  nod = 0,
  lift = 0,
): Key => ({ at, upper, elbow, direction, lean, forward, crouch, nod, lift });
/** Blends the keys around `phase`; the key at `strike` is reached by accelerating into it. */
function blend(keys: readonly Key[], phase: number, strike: number): ActionPose {
  let next = 1;
  while (next < keys.length - 1 && phase > keys[next].at) ++next;
  const from = keys[next - 1],
    to = keys[next],
    t = Math.max(0, Math.min(1, (phase - from.at) / (to.at - from.at))),
    eased = next === strike ? t * t * t : next === strike + 1 ? 1 - (1 - t) * (1 - t) : smooth(t),
    mix = (name: keyof ActionPose) => from[name] + (to[name] - from[name]) * eased;
  return {
    upper: mix('upper'),
    elbow: mix('elbow'),
    direction: mix('direction'),
    crouch: mix('crouch'),
    lift: mix('lift'),
    lean: mix('lean'),
    forward: mix('forward'),
    nod: mix('nod'),
  };
}
const restAngle = Math.atan2(-8, 6);
const apply = (m: Matrix, p: Point): Point =>
  point(m[0] * p.x + m[1] * p.y + m[2], m[3] * p.x + m[4] * p.y + m[5]);
/** A point up the shaft from the tool hand, in body space, once that arm is posed. */
function shaft(rig: ArmRig, reach: number): Point {
  const grip = point(rig.wrist.x + 0.6 * reach, rig.wrist.y - 0.8 * reach);
  return apply(rig.forearm!.matrix, apply(rig.hand!.matrix, grip));
}
const twoHanded = (tool: HeldTool | null): boolean =>
  tool === 'axe' || tool === 'pickaxe' || tool === 'hoe' || tool === 'shovel' || tool === 'spear';
/** Sets the body over feet that stay where they stand, the leading foot stepping into the blow. */
export function stand(parts: PersonParts, pose: ActionPose, spread: number, step = 0): void {
  const tall = 1 - pose.crouch;
  parts.body?.transform([1, -pose.lean, pose.forward, 0, tall, 0 - pose.lift, 0, 0, 1]);
  parts.feet[0]?.translate(-pose.forward - spread, pose.lift / tall);
  parts.feet[1]?.translate(-pose.forward + spread + step, pose.lift / tall);
  parts.nod = pose.nod;
}
/** Swings the held tool along a pose; the other hand takes the shaft when the tool needs two. */
export function swing(parts: PersonParts, tool: HeldTool, pose: ActionPose, steady: Point | null): void {
  const arm = parts.arms[1],
    other = parts.arms[0];
  poseArm(arm, pose.upper, pose.elbow, pose.direction - restAngle - pose.upper - pose.elbow);
  if (!other.free) poseArm(other);
  else if (twoHanded(tool)) {
    // The second hand keeps the shaft only below the chin; raised past it, it waits at the chest.
    const grip = shaft(arm, 2.6),
      chest = parts.neck.y + 1.4;
    reachArm(other, grip.y < chest ? point(Math.min(grip.x, 2.4), chest) : grip, 1, 0, 0);
  } else if (steady) reachArm(other, steady, 1, 0, 0);
  // A free hand swings back against the blow.
  else poseArm(other, -0.35 + pose.lean * 3 - pose.lift * 0.3, -0.5 - pose.crouch * 2, 0.1);
}

/**
 * Poses a resident from a shared humanoid clip: the same joint angles that move a goblin or a draugr.
 * The body leans and sinks over planted feet, both arms take the clip's shoulder and elbow turns,
 * and the tool points where the clip aims it.
 */
export function poseFromClip(parts: PersonParts, clip: RigClip, frame: number, tool: HeldTool | null): void {
  const turn = (bone: string) => clipTurn(clip, bone, frame),
    hips = clipShift(clip, 'hips', frame),
    stepLeft = clipShift(clip, 'step.l', frame),
    stepRight = clipShift(clip, 'step.r', frame),
    lean = turn('spine') + turn('chest'),
    upper = turn('arm.r.1'),
    elbow = turn('arm.r.2'),
    // The clip aims the tool for a body that turns; a resident's body leans without turning its arms.
    direction = restAngle + lean + upper + elbow + turn('hand.r'),
    pose: ActionPose = {
      upper,
      elbow,
      direction,
      crouch: Math.max(0, hips.y) / Math.max(1, -parts.neck.y),
      lift: Math.max(0, -hips.y),
      lean,
      forward: hips.x,
      nod: turn('head'),
    },
    other = parts.arms[0];
  poseArm(parts.arms[1], upper, elbow, direction - restAngle - upper - elbow);
  if (!other.free) poseArm(other);
  else if (twoHanded(tool)) {
    // The second hand keeps the shaft only below the chin; raised past it, it waits at the chest.
    const grip = shaft(parts.arms[1], 2.6),
      chest = parts.neck.y + 1.4;
    reachArm(other, grip.y < chest ? point(Math.min(grip.x, 2.4), chest) : grip, 1, 0, 0);
  } else poseArm(other, turn('arm.l.1'), turn('arm.l.2'), turn('hand.l'));
  stand(parts, pose, -stepLeft.x, stepRight.x + stepLeft.x);
  const shadow = 1 - pose.lift * 0.045;
  parts.shadow?.transform([shadow, 0, 0, 0, shadow, 0, 0, 0, 1]);
}
/** The shared blow a tool is swung with: heavy two-handed tools chop, bare hands punch, the rest cut. */
const blowOf = (tool: HeldTool | null): RigClip =>
  !tool
    ? humanoidClips.punch
    : tool === 'spear'
      ? humanoidClips.thrust
      : twoHanded(tool)
        ? humanoidClips.chop
        : humanoidClips.slash;

/** Draws and looses the bow along `phase` of a shot; `raise` tips the shot upward, in radians, for a volley. */
function shootBow(parts: PersonParts, phase: number, raise: number): void {
  const draw =
    phase < strikePhase
      ? smooth(Math.min(1, phase / 0.58))
      : 1 - smooth(Math.min(1, (phase - strikePhase) / 0.09));
  const release = phase >= strikePhase ? Math.sin(Math.min(1, (phase - strikePhase) / 0.2) * Math.PI) : 0;
  poseArm(parts.arms[1], -1.3 - raise, -0.12, 1.42, 0);
  poseArm(parts.arms[0], -1.15 + draw * 0.3 - raise, -1.15 - draw * 0.4, 0.3, -0.4);
  poseBow(parts, draw);
  parts.arrow?.opacity(phase < strikePhase ? 255 : 0);
  // The archer settles back into the draw and sights down the arrow.
  stand(
    parts,
    {
      upper: 0,
      elbow: 0,
      direction: 0,
      crouch: 0.03 * draw,
      lift: 0,
      lean: -0.045 * draw + 0.03 * release - raise * 0.12,
      forward: -0.35 * draw - 0.25 * release,
      nod: 0.05 * draw - 0.05 * release - raise * 0.2,
    },
    0.6,
    0.1,
  );
}
/** Each skill's own pose; the two bow skills are shots, and anything not listed raises a shout. */
const casts: Partial<Record<AbilityId, RigClip>> = {
  challenge: humanoidClips.shout,
  whirl: humanoidClips.whirl,
  burst: humanoidClips.raise,
  frost: humanoidClips.raise,
  mend: humanoidClips.offer,
  sanctuary: humanoidClips.kneel,
  rally: humanoidClips.play,
  dirge: humanoidClips.play,
};
/** Poses a resident `progress` (0..1) of the way through casting `skill`. */
export function animateCast(
  parts: PersonParts,
  skill: AbilityId,
  tool: HeldTool | null,
  progress: number,
): void {
  const along = Math.max(0, Math.min(1, progress));
  if (tool === 'bow' && (skill === 'aimed' || skill === 'volley')) {
    // A long draw loosed near the end of the cast; a volley is sent high to fall on its mark.
    shootBow(parts, along * (strikePhase + 0.12), skill === 'volley' ? 0.55 : 0);
    return;
  }
  const clip = casts[skill] ?? humanoidClips.shout;
  poseFromClip(parts, clip, along * clip.frames, tool);
}
/** Holding a position: braced over wide feet, weapon forward, breathing. */
export function animateBrace(parts: PersonParts, tool: HeldTool | null, seconds: number): void {
  poseFromClip(parts, humanoidClips.brace, seconds * 30, tool);
}
/** Impacts remain on the simulation's strike boundary: every blow clip lands at `strikePhase` of its cycle. */
export function animateAction(
  parts: PersonParts,
  tool: HeldTool | null,
  elapsed: number,
  period: number,
): void {
  const phase = (((elapsed % period) + period) % period) / period;
  if (tool === 'bow') {
    shootBow(parts, phase, 0);
    return;
  }
  if (tool === 'staff') {
    // A caster lifts the staff upright, then tips its head toward the target on release.
    const raise =
        phase < strikePhase
          ? smooth(Math.min(1, phase / 0.55))
          : 1 - smooth(Math.min(1, (phase - strikePhase) / 0.22)),
      thrust = phase >= strikePhase ? Math.sin(Math.min(1, (phase - strikePhase) / 0.25) * Math.PI) : 0,
      upper = -0.5 - 0.7 * raise,
      elbow = -0.5 * raise;
    poseArm(parts.arms[1], upper, elbow, -0.25 * raise + 0.6 * thrust - upper - elbow);
    if (parts.arms[0].free) poseArm(parts.arms[0], -0.5 - 0.5 * raise, -0.6 - 0.3 * raise, 0.1);
    stand(
      parts,
      {
        upper,
        elbow,
        direction: 0,
        crouch: 0.03 * thrust,
        lift: 0,
        lean: -0.03 * raise + 0.08 * thrust,
        forward: 0.5 * thrust,
        nod: -0.07 * raise + 0.1 * thrust,
      },
      0.45,
      0.3 * thrust,
    );
    return;
  }
  const clip = blowOf(tool);
  poseFromClip(parts, clip, phase * clip.frames, tool);
}

// Work at a tree, a rock face or a frame: the same blow as a fight, without the lunge.
// Contact is supplied by the same clock as the simulation's impact event. Work never leaves
// the ground, squashes the torso by more than a twentieth or shifts it past 0.4 off its spot.
const chop: readonly Key[] = [
  key(0, -1.0, -0.75, -0.75),
  key(0.42, -1.45, -1.5, -1.95, -0.045, -0.26, 0.015, -0.05),
  key(0.56, -1.52, -1.45, -2.08, -0.05, -0.3, 0.02, -0.06),
  key(0.75, -0.86, -0.1, 0.12, 0.065, 0.36, 0.04, 0.1),
  key(0.85, -0.93, -0.2, -0.1, 0.05, 0.26, 0.03, 0.06),
  key(1, -1.0, -0.75, -0.75),
];
// The pick comes down into the stone at the feet.
const dig: readonly Key[] = [
  key(0, -1.0, -0.75, -0.7),
  key(0.42, -1.45, -1.5, -2.0, -0.045, -0.24, 0.015, -0.05),
  key(0.56, -1.52, -1.45, -2.12, -0.05, -0.28, 0.02, -0.06),
  key(0.75, -0.66, -0.1, 0.6, 0.08, 0.36, 0.046, 0.14),
  key(0.85, -0.74, -0.2, 0.36, 0.06, 0.26, 0.038, 0.09),
  key(1, -1.0, -0.75, -0.7),
];
// A hammer is all wrist and forearm: short, brisk, the body barely moving.
const tap: readonly Key[] = [
  key(0, -1.0, -0.8, -0.55),
  key(0.44, -1.25, -1.4, -1.5, -0.02, -0.1, 0.01, -0.03),
  key(0.58, -1.3, -1.36, -1.58, -0.02, -0.1, 0.01, -0.03),
  key(0.75, -0.9, -0.3, 0.3, 0.035, 0.2, 0.025, 0.08),
  key(0.85, -0.95, -0.42, 0.05, 0.03, 0.14, 0.02, 0.05),
  key(1, -1.0, -0.8, -0.55),
];
const workKeys = (tool: HeldTool | null): readonly Key[] =>
  tool === 'pickaxe' ? dig : tool === 'hammer' ? tap : chop;
/** Key time for a work cycle whose contact falls at `impact` of `period`. */
function workPhase(elapsed: number, period: number, impact: number): number {
  const phase = (((elapsed % period) + period) % period) / period,
    contact = impact / period;
  return phase <= contact ? (phase / contact) * 0.75 : 0.75 + ((phase - contact) / (1 - contact)) * 0.25;
}
export function workPose(
  elapsed: number,
  period: number,
  impact: number,
  tool: HeldTool | null = 'axe',
): ActionPose {
  return blend(workKeys(tool), workPhase(elapsed, period, impact), 3);
}
export function animateWork(
  parts: PersonParts,
  tool: HeldTool | null,
  elapsed: number,
  period: number,
  impact: number,
): void {
  const pose = workPose(elapsed, period, impact, tool);
  if (!tool) {
    // Empty hands draw back, then take hold and pull: they never mime an invisible tool.
    const at = workPhase(elapsed, period, impact),
      reach = at <= 0.75 ? smooth(Math.max(0, (at - 0.4) / 0.35)) : 1 - smooth((at - 0.75) / 0.25),
      shoulder = parts.arms[1].shoulder.y;
    reachArm(parts.arms[1], { x: 3.4 + reach * 3.4, y: shoulder + 2.6 + reach * 2.6 }, 1, 0, 0);
    if (parts.arms[0].free)
      reachArm(parts.arms[0], { x: 1.8 + reach * 3, y: shoulder + 3.2 + reach * 2.4 }, 1, 0, 0);
    stand(
      parts,
      {
        ...pose,
        lean: 0.01 + reach * 0.07,
        forward: reach * 0.38,
        crouch: 0.01 + reach * 0.04,
        nod: reach * 0.12,
        lift: 0,
      },
      0.35,
    );
  } else {
    swing(parts, tool, pose, tool === 'hammer' ? point(3.6, parts.arms[1].shoulder.y + 5.4) : null);
    stand(parts, pose, 0.45);
  }
  parts.shadow?.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}
/** Stooping to take up what was felled or broken loose: `amount` rises to 1 and falls away. */
export function animateGather(parts: PersonParts, amount: number): void {
  const shoulder = parts.arms[1].shoulder.y;
  reachArm(parts.arms[1], { x: 4.6, y: shoulder + 8.4 }, amount, 0, 0);
  if (parts.arms[0].free) reachArm(parts.arms[0], { x: 2.6, y: shoulder + 8.6 }, amount, 0, 0);
  stand(
    parts,
    {
      upper: 0,
      elbow: 0,
      direction: 0,
      crouch: 0.15 * amount,
      lift: 0,
      lean: 0.14 * amount,
      forward: 0.5 * amount,
      nod: 0.22 * amount,
    },
    0.3 * amount,
  );
}

/** Down beside someone who has fallen: bent low over them, both hands pressing in a steady rhythm. */
export function animateTend(parts: PersonParts, seconds: number): void {
  // Two presses a second: down sharply, up slowly.
  const beat = (seconds * 2) % 1,
    press = beat < 0.25 ? smooth(beat / 0.25) : 1 - smooth((beat - 0.25) / 0.75),
    shoulder = parts.arms[1].shoulder.y;
  reachArm(parts.arms[1], { x: 5.2, y: shoulder + 8.2 + press * 1.3 }, 1, 0, 0);
  if (parts.arms[0].free) reachArm(parts.arms[0], { x: 3.6, y: shoulder + 8.4 + press * 1.3 }, 1, 0, 0);
  stand(
    parts,
    {
      upper: 0,
      elbow: 0,
      direction: 0,
      crouch: 0.34 + press * 0.05,
      lift: 0,
      lean: 0.2 + press * 0.04,
      forward: 1.1,
      nod: 0.3 + press * 0.06,
    },
    0.7,
  );
}

/** Eating or drinking in the open: the hand comes up to the mouth and rests again. */
export function animateSip(parts: PersonParts, seconds: number, drinking: boolean): void {
  const cycle = (seconds % 1.9) / 1.9,
    up = smooth(Math.min(1, cycle / 0.3)) * (1 - smooth(Math.max(0, Math.min(1, (cycle - 0.62) / 0.3)))),
    arm = parts.arms[1];
  reachArm(arm, { x: 1.7, y: parts.neck.y - 1.3 }, up, 0, 0);
  stand(
    parts,
    {
      upper: 0,
      elbow: 0,
      direction: 0,
      crouch: 0,
      lift: 0,
      lean: drinking ? -0.02 * up : 0.02 * up,
      forward: 0,
      // A drinker tips the head back; an eater bends to the food.
      nod: (drinking ? -0.14 : 0.07) * up,
    },
    0,
  );
}
/** Brooding: shoulders dropped and the head hung, hardly moving. */
export function animateBrood(parts: PersonParts, seconds: number): void {
  const sigh = Math.sin(seconds * 0.9) * 0.01;
  stand(
    parts,
    { upper: 0, elbow: 0, direction: 0, crouch: 0.04 + sigh, lift: 0, lean: 0.05, forward: 0, nod: 0.26 },
    0,
  );
}
