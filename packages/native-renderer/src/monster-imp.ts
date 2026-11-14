// The rift imp: a small winged thing from beyond a portal that never quite touches the ground.
import type { Rgb } from './paint';
import { ShapeNode } from './paint';
import { dusk } from './form-paint';
import { humanoidClips, humanoidFigure } from './humanoid-rig';
import { PoseBank } from './rig-pose-bank';
import { capsules, discs, fills, RigSkin } from './rig-skin';
import { monsterTrait, type MonsterKind } from './monster-look';
import { MonsterRank } from '../../engine/src/combat-events';

const hides: readonly Rgb[] = [
  [122, 86, 128],
  [140, 84, 104],
  [104, 90, 142],
];
const degrees = Math.PI / 180,
  turn = Math.PI * 2;
let kind: MonsterKind | undefined;
export function impKind(): MonsterKind {
  if (kind) return kind;
  const figure = humanoidFigure({
      hip: 2.6,
      chest: 4.6,
      neck: 6.4,
      shoulder: 1.9,
      shoulderDrop: 0.6,
      upperArm: 2,
      forearm: 2.2,
      stance: 0.9,
      knee: 1.4,
      ankle: 0.5,
      extra: [
        { name: 'wing.l', parent: 'chest', x: -1.1, y: -5.5 },
        { name: 'wing.r', parent: 'chest', x: 0.1, y: -5.7 },
        { name: 'tail', parent: 'hips', x: -0.8, y: -2.9 },
      ],
    }),
    { skeleton } = figure,
    wings = [skeleton.bone('wing.l'), skeleton.bone('wing.r')],
    tail = skeleton.bone('tail'),
    legs = ['leg.l.1', 'leg.r.1'].map((name) => skeleton.bone(name)),
    spine = skeleton.bone('spine');
  figure.hover = 3.4;
  const bank = new PoseBank(figure, (pose, clip, frame) => {
    // Wings beat a whole number of times per clip so every loop closes; the body rides each beat.
    const beats = clip === humanoidClips.idle ? 9 : clip === humanoidClips.walk ? 2 : 3,
      beat = Math.sin((turn * beats * frame) / clip.frames);
    pose.angle[wings[0]] = (14 + 26 * beat) * degrees;
    pose.angle[wings[1]] = (8 + 30 * beat) * degrees;
    pose.angle[tail] = (10 * Math.sin((turn * frame) / clip.frames) - 6 * beat) * degrees;
    pose.shiftY[skeleton.bone('hips')] += 0.35 * beat;
    // Legs trail under a flier instead of stepping.
    pose.angle[legs[0]] = (18 - 6 * beat) * degrees;
    pose.angle[legs[1]] = (8 - 6 * beat) * degrees;
    pose.angle[spine] += 8 * degrees;
  });
  const wing = (color: Rgb, x: number, y: number, reach: number) =>
    fills(color, [
      [x, y],
      [x - 2.2 * reach, y - 4.6 * reach],
      [x - 6.4 * reach, y - 5.2 * reach],
      [x - 5.6 * reach, y - 2.2 * reach],
      [x - 6.2 * reach, y + 0.6 * reach],
      [x - 4.2 * reach, y - 0.4 * reach],
      [x - 3.6 * reach, y + 1.8 * reach],
      [x - 2, y + 0.4 * reach],
      [x - 0.9, y + 1.6],
    ]);
  const limb = (color: Rgb, x: number, from: number, to: number, claw: boolean) => {
    const shape = capsules(1.05, color, [x, from, x, to]);
    if (claw) shape.appendCircle(x, to, 0.4, 0.4).fill(...color);
    return shape;
  };
  kind = {
    bank,
    top: 17,
    shadow: [3.6, 1.5],
    idle: humanoidClips.idle,
    walk: humanoidClips.walk,
    fall: humanoidClips.fall,
    pace: 24,
    idleHold: 1,
    dress(id, rank) {
      const skin = new RigSkin(skeleton),
        hide = hides[Math.floor(monsterTrait(id, 1) * hides.length)],
        far = dusk(hide, 0.5),
        near = dusk(hide, 0.28),
        horn: Rgb = [226, 206, 164],
        long = 1 + monsterTrait(id, 3) * 0.5,
        // A swarm keeps wings, horns and eyes and drops what a crowd would never show.
        swarm = rank === MonsterRank.Swarmer;
      skin.piece('wing.l', wing(dusk(hide, 0.62), -1.1, -5.5, 0.92));
      skin.piece('wing.r', wing(far, 0.1, -5.7, 1));
      // A thin tail ending in a spade.
      const tailTip = new ShapeNode()
        .fill(...far)
        .strokeFill(...far)
        .strokeWidth(0.5)
        .strokeCap('round');
      tailTip.moveTo(-0.8, -2.9).cubicTo(-3.2, -2.2, -3.6, -0.6, -5.2, -1.2);
      const spade = fills(far, [
        [-5, -1.9],
        [-6.6, -1.3],
        [-5.2, -0.4],
      ]);
      if (!swarm) skin.piece('tail', tailTip, spade);
      if (!swarm) skin.piece('arm.l.1', limb(hide, -1.9, -5.8, -1.7, true));
      if (!swarm) skin.piece('leg.l.1', limb(hide, -0.9, -2.6, -0.4, true));
      skin.piece('leg.r.1', limb(near, 0.9, -2.6, -0.4, true));
      skin.piece('spine', discs(hide, [0, -4.1, 2.05, 2.3]));
      skin.piece(
        'head',
        // Horns first, so the skull overlaps their roots.
        fills(
          horn,
          [
            [1.7, -10.6],
            [3.6, -13.2 - long],
            [3.3, -10.2],
          ],
          [
            [-1.3, -10.7],
            [-2.7, -13.4 - long],
            [-2.6, -10.3],
          ],
        ),
        fills(far, [
          [-2.2, -9.2],
          [-4.6, -10.2],
          [-2.6, -8],
        ]).appendCircle(0.3, -8.5, 3, 2.75),
        fills(hide, [
          [2.6, -9.2],
          [5, -10.4],
          [3, -8],
        ]).appendCircle(-0.05, -8.7, 2.7, 2.5),
        discs([250, 210, 120], [1.1, -8.6, 0.6, 0.5], [2.75, -8.55, 0.52, 0.46]),
        capsules(0.36, [38, 30, 44], [0.4, -9.4, 1.7, -9.05], [2.3, -9.05, 3.4, -9.35]),
      );
      skin.piece('arm.r.1', limb(near, 1.9, -5.8, -3.8, false));
      skin.piece('arm.r.2', limb(near, 1.9, -3.8, -1.6, true));
      return { skin, attack: humanoidClips.claw };
    },
  };
  return kind;
}
