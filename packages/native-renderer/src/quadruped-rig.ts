// The four-legged skeleton and its clips: wolves and whatever else runs on all fours.
import idle from './assets/rig/quadruped-idle.json';
import run from './assets/rig/quadruped-run.json';
import bite from './assets/rig/quadruped-bite.json';
import fall from './assets/rig/quadruped-fall.json';
import walk from './assets/rig/quadruped-walk.json';
import graze from './assets/rig/quadruped-graze.json';
import sleep from './assets/rig/quadruped-sleep.json';
import { readRigClip } from './rig-clip';
import { RigFigure } from './rig-figure';
import { Skeleton, type BoneSpec } from './rig-skeleton';

/** Rest joints of the mannequin the clips are authored on (scripts/build-rig-clips.mjs), facing +x. */
const mannequin: readonly BoneSpec[] = [
  { name: 'hips', x: -5, y: -6.5 },
  { name: 'chest', parent: 'hips', x: 0, y: -6.8 },
  { name: 'neck', parent: 'chest', x: 4.5, y: -7.6 },
  { name: 'head', parent: 'neck', x: 6.6, y: -9.4 },
  { name: 'jaw', parent: 'head', x: 7.6, y: -8.6 },
  { name: 'tail', parent: 'hips', x: -6.6, y: -7.2 },
  { name: 'leg.hl.1', parent: 'hips', x: -5.6, y: -5.6 },
  { name: 'leg.hl.2', parent: 'leg.hl.1', x: -6.6, y: -2.8 },
  { name: 'foot.hl', parent: 'leg.hl.2', x: -5.6, y: -0.5 },
  { name: 'leg.hr.1', parent: 'hips', x: -4.6, y: -5.6 },
  { name: 'leg.hr.2', parent: 'leg.hr.1', x: -5.6, y: -2.8 },
  { name: 'foot.hr', parent: 'leg.hr.2', x: -4.6, y: -0.5 },
  { name: 'leg.fl.1', parent: 'chest', x: 1.8, y: -5.4 },
  { name: 'leg.fl.2', parent: 'leg.fl.1', x: 2, y: -2.8 },
  { name: 'foot.fl', parent: 'leg.fl.2', x: 2.2, y: -0.5 },
  { name: 'leg.fr.1', parent: 'chest', x: 2.8, y: -5.4 },
  { name: 'leg.fr.2', parent: 'leg.fr.1', x: 3, y: -2.8 },
  { name: 'foot.fr', parent: 'leg.fr.2', x: 3.2, y: -0.5 },
];
/** A four-legged figure `scale` times the mannequin's size. */
export function quadrupedFigure(scale = 1): RigFigure {
  const skeleton = new Skeleton(mannequin.map((bone) => ({ ...bone, x: bone.x * scale, y: bone.y * scale }))),
    // Hind legs fold at the hock, which points back; fore legs at the wrist, which points ahead.
    leg = (name: string, bend: number) => ({
      hip: skeleton.bone(`leg.${name}.1`),
      knee: skeleton.bone(`leg.${name}.2`),
      foot: skeleton.bone(`foot.${name}`),
      step: `step.${name}`,
      bend,
    });
  return new RigFigure(skeleton, [leg('hl', 1), leg('hr', 1), leg('fl', -1), leg('fr', -1)], scale);
}
export const quadrupedClips = {
  idle: readRigClip(idle),
  run: readRigClip(run),
  bite: readRigClip(bite),
  fall: readRigClip(fall),
  walk: readRigClip(walk),
  graze: readRigClip(graze),
  sleep: readRigClip(sleep),
};
