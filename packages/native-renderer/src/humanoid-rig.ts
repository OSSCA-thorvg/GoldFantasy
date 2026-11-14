// The two-legged skeleton shared by residents' motions and the humanoid monsters, and its clips.
import idle from './assets/rig/humanoid-idle.json';
import walk from './assets/rig/humanoid-walk.json';
import slash from './assets/rig/humanoid-slash.json';
import chop from './assets/rig/humanoid-chop.json';
import thrust from './assets/rig/humanoid-thrust.json';
import claw from './assets/rig/humanoid-claw.json';
import punch from './assets/rig/humanoid-punch.json';
import run from './assets/rig/humanoid-run.json';
import fall from './assets/rig/humanoid-fall.json';
import shout from './assets/rig/humanoid-shout.json';
import whirl from './assets/rig/humanoid-whirl.json';
import raise from './assets/rig/humanoid-raise.json';
import offer from './assets/rig/humanoid-offer.json';
import kneel from './assets/rig/humanoid-kneel.json';
import play from './assets/rig/humanoid-play.json';
import brace from './assets/rig/humanoid-brace.json';
import slam from './assets/rig/humanoid-slam.json';
import { readRigClip } from './rig-clip';
import { RigFigure } from './rig-figure';
import { Skeleton, type BoneSpec, type RigPose } from './rig-skeleton';

/** A figure's measurements in its own units, feet at the ground. `.r` is the side toward +x: the tool hand. */
export interface HumanoidBuild {
  /** Heights above the ground. */
  hip: number;
  chest: number;
  neck: number;
  /** Shoulder joints: half the distance between them, and how far below the neck they sit. */
  shoulder: number;
  shoulderDrop: number;
  upperArm: number;
  forearm: number;
  /** Half the distance between the hip joints. */
  stance: number;
  /** Knee height above the ground; the ankle sits at `ankle`. */
  knee: number;
  ankle: number;
  /** Bones of this creature alone, such as a tail or wings. Clips leave them at rest. */
  extra?: readonly BoneSpec[];
}
/** Hip height of the mannequin the clips are authored on (scripts/build-rig-clips.mjs). */
const mannequinHip = 5.4;
const degrees = Math.PI / 180;

export function humanoidSkeleton(build: HumanoidBuild): Skeleton {
  const arm = (side: 'l' | 'r'): BoneSpec[] => {
    const x = (side === 'r' ? 1 : -1) * build.shoulder,
      top = -build.neck + build.shoulderDrop;
    return [
      { name: `arm.${side}.1`, parent: 'chest', x, y: top },
      // An elbow folds the forearm ahead and up, never back on itself.
      {
        name: `arm.${side}.2`,
        parent: `arm.${side}.1`,
        x,
        y: top + build.upperArm,
        min: -165 * degrees,
        max: 12 * degrees,
      },
      { name: `hand.${side}`, parent: `arm.${side}.2`, x, y: top + build.upperArm + build.forearm },
    ];
  };
  const leg = (side: 'l' | 'r'): BoneSpec[] => {
    const x = (side === 'r' ? 1 : -1) * build.stance;
    return [
      { name: `leg.${side}.1`, parent: 'hips', x, y: -build.hip },
      {
        name: `leg.${side}.2`,
        parent: `leg.${side}.1`,
        x,
        y: -build.knee,
        min: -4 * degrees,
        max: 150 * degrees,
      },
      { name: `foot.${side}`, parent: `leg.${side}.2`, x, y: -build.ankle },
    ];
  };
  return new Skeleton([
    { name: 'hips', x: 0, y: -build.hip },
    { name: 'spine', parent: 'hips', x: 0, y: -build.hip },
    { name: 'chest', parent: 'spine', x: 0, y: -build.chest },
    { name: 'head', parent: 'chest', x: 0, y: -build.neck },
    ...arm('l'),
    ...arm('r'),
    ...leg('l'),
    ...leg('r'),
    ...(build.extra ?? []),
  ]);
}
export function humanoidFigure(build: HumanoidBuild): RigFigure {
  const skeleton = humanoidSkeleton(build),
    leg = (side: 'l' | 'r') => ({
      hip: skeleton.bone(`leg.${side}.1`),
      knee: skeleton.bone(`leg.${side}.2`),
      foot: skeleton.bone(`foot.${side}`),
      step: `step.${side}`,
      bend: -1,
    });
  return new RigFigure(skeleton, [leg('l'), leg('r')], build.hip / mannequinHip);
}

export const humanoidClips = {
  idle: readRigClip(idle),
  walk: readRigClip(walk),
  slash: readRigClip(slash),
  chop: readRigClip(chop),
  thrust: readRigClip(thrust),
  claw: readRigClip(claw),
  punch: readRigClip(punch),
  run: readRigClip(run),
  fall: readRigClip(fall),
  shout: readRigClip(shout),
  whirl: readRigClip(whirl),
  raise: readRigClip(raise),
  offer: readRigClip(offer),
  kneel: readRigClip(kneel),
  play: readRigClip(play),
  brace: readRigClip(brace),
  slam: readRigClip(slam),
};
/** Leans a figure's trunk for good and keeps its arms and head where the clip put them. */
export function hunch(figure: RigFigure, pose: RigPose, spine: number, chest: number): void {
  const { skeleton } = figure,
    lean = spine + chest;
  pose.angle[skeleton.bone('spine')] += spine;
  pose.angle[skeleton.bone('chest')] += chest;
  for (const bone of ['head', 'arm.l.1', 'arm.r.1']) pose.angle[skeleton.bone(bone)] -= lean;
}
