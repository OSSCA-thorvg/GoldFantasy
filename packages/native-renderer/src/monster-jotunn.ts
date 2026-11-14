// The jotunn of the giants' hall: a walking crag, rimed at the shoulders, with a beard of icicles.
import { MonsterRank } from '../../engine/src/combat-events';
import type { Rgb } from './paint';
import { dusk } from './form-paint';
import { humanoidClips, humanoidFigure, hunch } from './humanoid-rig';
import { PoseBank } from './rig-pose-bank';
import { capsules, discs, fills, RigSkin } from './rig-skin';
import { grippedWeapon } from './held-weapon-art';
import { monsterTrait, type MonsterKind } from './monster-look';

const stones: readonly Rgb[] = [
  [120, 126, 142],
  [128, 124, 132],
  [108, 124, 134],
];
const rime: Rgb = [210, 224, 236],
  fur: Rgb = [120, 94, 70],
  dark: Rgb = [46, 44, 70],
  degrees = Math.PI / 180;
let kind: MonsterKind | undefined;
export function jotunnKind(): MonsterKind {
  if (kind) return kind;
  const figure = humanoidFigure({
      hip: 12.5,
      chest: 22,
      neck: 30,
      shoulder: 10,
      shoulderDrop: 2.5,
      upperArm: 10,
      forearm: 10,
      stance: 4.6,
      knee: 6.4,
      ankle: 1.8,
    }),
    head = figure.skeleton.bone('head');
  // Its own weight bows it: the shoulders roll forward and the head sits low between them.
  const bank = new PoseBank(figure, (pose) => {
    hunch(figure, pose, 4 * degrees, 6 * degrees);
    pose.angle[head] += 7 * degrees;
  });
  kind = {
    bank,
    top: 41,
    shadow: [13, 5],
    idle: humanoidClips.idle,
    walk: humanoidClips.walk,
    fall: humanoidClips.fall,
    pace: 11,
    dress(id, rank) {
      const skin = new RigSkin(figure.skeleton),
        stone = stones[Math.floor(monsterTrait(id, 1) * stones.length)],
        shade = dusk(stone, 0.42),
        armed = rank === MonsterRank.Brute || rank === MonsterRank.Guardian || monsterTrait(id, 2) < 0.3,
        arm = (x: number, color: Rgb) => {
          skin.piece(x < 0 ? 'arm.l.1' : 'arm.r.1', capsules(5.6, color, [x, -27, x, -18]));
          return capsules(5, color, [x, -17.5, x, -9])
            .appendCircle(x, -7.5, 0.9, 0.9)
            .fill(...color);
        },
        leg = (side: 'l' | 'r', x: number, color: Rgb) => {
          skin.piece(`leg.${side}.1`, capsules(6.2, color, [x, -12.5, x, -7]));
          skin.piece(
            `leg.${side}.2`,
            capsules(5.6, color, [x, -6.4, x, -3]),
            fills(color, [
              [x - 2.4, 0],
              [x + 3.8, 0],
              [x + 4.2, -1.6],
              [x + 2.2, -3.4],
              [x - 2.4, -3.4],
            ]),
          );
        };
      skin.piece('arm.l.2', arm(-10, stone));
      leg('l', -4.6, stone);
      leg('r', 4.6, shade);
      skin.piece(
        'spine',
        discs(dusk(stone, 0.18), [0, -17, 7.8, 5.6]),
        fills(fur, [
          [-7.6, -13.8],
          [7.6, -13.8],
          [8.2, -8.2],
          [5.4, -9.6],
          [3, -7.4],
          [0.4, -9.2],
          [-2.4, -7.2],
          [-5, -9],
          [-8.4, -7.8],
        ]),
        fills(dusk(fur, 0.34), [
          [1, -13.8],
          [7.6, -13.8],
          [8.2, -8.2],
          [5.4, -9.6],
          [3, -7.4],
          [1.4, -8.6],
        ]),
      );
      skin.piece(
        'chest',
        discs(stone, [0, -25, 11.2, 5.7]),
        fills(shade, [
          [3, -30.4],
          [8.6, -29.5],
          [11.1, -25],
          [9.4, -20.4],
          [4, -19.5],
          [5.8, -24.8],
        ]),
        // Rime lies where no hand ever brushes it off.
        fills(
          rime,
          [
            [-11, -26.2],
            [-8, -29.9],
            [-3.4, -30.7],
            [-5.2, -28.2],
            [-8.6, -26.6],
          ],
          [
            [4.4, -30.7],
            [8.6, -29.7],
            [10.9, -26.4],
            [8.4, -27.5],
            [6, -28.7],
          ],
        ),
        // Thurs, the giants' own rune, cut into the breast.
        capsules(0.9, dark, [-1.8, -27.6, -1.8, -21.2], [-1.8, -26.2, 1.3, -24.5], [1.3, -24.5, -1.8, -22.8]),
      );
      skin.piece(
        'head',
        // The shaded back of the skull, and two crags standing from it like horns.
        fills(
          shade,
          [
            [-2.6, -37],
            [-3.8, -40.4],
            [-0.6, -38.2],
          ],
          [
            [2.6, -38.3],
            [4.6, -41],
            [5.2, -37.4],
          ],
        ).appendCircle(1.6, -33.7, 5.2, 4.7),
        discs(stone, [1, -34, 4.9, 4.5]),
        fills(dark, [
          [-2.6, -35.6],
          [5.8, -35.3],
          [5.6, -33.9],
          [-2.4, -34.2],
        ]),
        discs([204, 238, 246], [0.5, -33.5, 0.8, 0.7], [3.7, -33.4, 0.72, 0.66]),
        fills(rime, [
          [-2.8, -32],
          [5.6, -32],
          [5, -28.6],
          [3.8, -30.4],
          [2.8, -26.4],
          [1.6, -30.2],
          [0.6, -27.4],
          [-0.6, -30.4],
          [-1.8, -28.8],
        ]),
      );
      const forearm = arm(10, shade);
      if (armed) skin.piece('hand.r', grippedWeapon('maul', 10, -7.5, 1.2));
      skin.piece('arm.r.2', forearm);
      return { skin, attack: armed ? humanoidClips.chop : humanoidClips.slam };
    },
  };
  return kind;
}
