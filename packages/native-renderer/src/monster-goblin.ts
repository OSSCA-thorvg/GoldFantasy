// The ruin goblin: a small hunched raider with long arms, big ears and whatever it could carry off.
import { MonsterRank } from '../../engine/src/combat-events';
import { ShapeNode, type Rgb } from './paint';
import { dusk } from './form-paint';
import { humanoidClips, humanoidFigure, hunch } from './humanoid-rig';
import { PoseBank } from './rig-pose-bank';
import { capsules, discs, fills, RigSkin } from './rig-skin';
import { grippedWeapon, type HeldWeapon } from './held-weapon-art';
import { monsterTrait, type MonsterKind } from './monster-look';

const hides: readonly Rgb[] = [
  [100, 136, 70],
  [86, 126, 88],
  [124, 138, 62],
];
const degrees = Math.PI / 180;
let kind: MonsterKind | undefined;
export function goblinKind(): MonsterKind {
  if (kind) return kind;
  const figure = humanoidFigure({
      hip: 3.4,
      chest: 5.6,
      neck: 7.6,
      shoulder: 2.5,
      shoulderDrop: 0.7,
      upperArm: 2.2,
      forearm: 2.4,
      stance: 1.3,
      knee: 1.8,
      ankle: 0.6,
    }),
    head = figure.skeleton.bone('head');
  // Goblins never stand straight: the back rounds forward and the head cranes up to see.
  const bank = new PoseBank(figure, (pose) => {
    hunch(figure, pose, 9 * degrees, 11 * degrees);
    pose.angle[head] += 5 * degrees;
  });
  /** A leg as one piece: at this size the knee is not missed, and a pack of them stays cheap. */
  const leg = (x: number, color: Rgb) =>
    new ShapeNode()
      .moveTo(x, -3.4)
      .lineTo(x, -0.9)
      .moveTo(x - 0.2, -0.75)
      .lineTo(x + 1.3, -0.75)
      .strokeWidth(1.5)
      .strokeFill(...color)
      .strokeCap('round');
  const arm = (x: number, from: number, to: number, color: Rgb, fist: boolean) => {
    const shape = capsules(1.4, color, [x, from, x, to]);
    if (fist) shape.appendCircle(x, to, 0.45, 0.45).fill(...color);
    return shape;
  };
  kind = {
    bank,
    top: 13.5,
    shadow: [5, 2.1],
    idle: humanoidClips.idle,
    walk: humanoidClips.walk,
    run: humanoidClips.run,
    fall: humanoidClips.fall,
    pace: 26,
    dress(id, rank) {
      const skin = new RigSkin(figure.skeleton),
        hide = hides[Math.floor(monsterTrait(id, 1) * hides.length)],
        far = dusk(hide, 0.45),
        near = dusk(hide, 0.26),
        cloth: Rgb = [146, 94, 60],
        ink: Rgb = [38, 34, 44],
        ear = monsterTrait(id, 3) * 1.6,
        // A swarm is drawn with the fewest paints that still read as a goblin, and fights bare-handed.
        swarm = rank === MonsterRank.Swarmer,
        pick = monsterTrait(id, 2),
        weapon: HeldWeapon | null =
          swarm || rank === MonsterRank.Spitter
            ? null
            : rank === MonsterRank.Brute || (rank !== MonsterRank.Stalker && pick < 0.5)
              ? 'club'
              : 'cleaver';
      // Far side first: it shows behind the body. Light falls from the left, as on residents.
      if (!swarm) skin.piece('arm.l.1', arm(-2.5, -6.9, -2.3, hide, true));
      skin.piece('leg.l.1', leg(-1.3, hide));
      skin.piece('leg.r.1', leg(1.3, near));
      skin.piece(
        'spine',
        discs(hide, [0, -5.3, 2.75, 2.5]),
        fills(cloth, [
          [-2.6, -4.4],
          [2.6, -4.4],
          [2.9, -1.9],
          [1.8, -2.7],
          [0.8, -1.7],
          [-0.2, -2.6],
          [-1.2, -1.6],
          [-2.8, -2.4],
        ]),
      );
      // Head: wide skull, long ears swept back, pale eyes under a heavy brow.
      const face = [
        fills(far, [
          [-2.2, -11],
          [-6.2 - ear, -12.4 - ear * 0.6],
          [-2.9, -9.2],
        ]).appendCircle(0.25, -10.1, 3.6, 3.05),
        fills(hide, [
          [2.4, -11],
          [6.6 + ear, -12.6 - ear * 0.6],
          [3.1, -9.2],
        ]).appendCircle(-0.15, -10.3, 3.2, 2.75),
        discs([246, 224, 150], [1.2, -10.2, 0.66, 0.76], [3.05, -10.15, 0.58, 0.72]),
      ];
      if (!swarm)
        face.push(
          capsules(0.42, ink, [0.3, -11.25, 1.9, -10.8], [2.5, -10.8, 3.9, -11.2])
            .appendCircle(1.4, -10.1, 0.12, 0.2)
            .appendCircle(3.2, -10.05, 0.1, 0.18)
            .fill(...ink),
        );
      skin.piece('head', ...face);
      skin.piece('arm.r.1', arm(2.5, -6.9, -4.7, near, false));
      if (weapon) skin.piece('hand.r', grippedWeapon(weapon, 2.5, -2.3, 0.8));
      skin.piece('arm.r.2', arm(2.5, -4.7, -2.3, near, true));
      return {
        skin,
        attack: !weapon ? humanoidClips.claw : weapon === 'club' ? humanoidClips.chop : humanoidClips.slash,
      };
    },
  };
  return kind;
}
