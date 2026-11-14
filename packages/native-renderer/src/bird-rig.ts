// A bird's skeleton and its clips: the body tips over the hips to peck, two thin legs step under it.
import idle from './assets/rig/bird-idle.json';
import walk from './assets/rig/bird-walk.json';
import sleep from './assets/rig/bird-sleep.json';
import { readRigClip } from './rig-clip';
import { RigFigure } from './rig-figure';
import { Skeleton, type BoneSpec } from './rig-skeleton';

/** Rest joints of the mannequin the clips are authored on (scripts/build-rig-clips.mjs), facing +x. */
const mannequin: readonly BoneSpec[] = [
  { name: 'hips', x: -0.2, y: -4.2 },
  { name: 'body', parent: 'hips', x: -0.2, y: -4.2 },
  { name: 'neck', parent: 'body', x: 1.6, y: -5.6 },
  { name: 'head', parent: 'neck', x: 2.4, y: -7.2 },
  { name: 'tail', parent: 'body', x: -2, y: -5.2 },
  { name: 'leg.l.1', parent: 'hips', x: -0.7, y: -3 },
  { name: 'leg.l.2', parent: 'leg.l.1', x: -0.5, y: -1.7 },
  { name: 'foot.l', parent: 'leg.l.2', x: -0.7, y: -0.4 },
  { name: 'leg.r.1', parent: 'hips', x: 0.4, y: -3 },
  { name: 'leg.r.2', parent: 'leg.r.1', x: 0.6, y: -1.7 },
  { name: 'foot.r', parent: 'leg.r.2', x: 0.4, y: -0.4 },
];
export function birdFigure(): RigFigure {
  const skeleton = new Skeleton(mannequin),
    leg = (side: string) => ({
      hip: skeleton.bone(`leg.${side}.1`),
      knee: skeleton.bone(`leg.${side}.2`),
      foot: skeleton.bone(`foot.${side}`),
      step: 'step',
      bend: -1,
    });
  return new RigFigure(skeleton, [leg('l'), leg('r')]);
}
export const birdClips = {
  idle: readRigClip(idle),
  walk: readRigClip(walk),
  sleep: readRigClip(sleep),
};
