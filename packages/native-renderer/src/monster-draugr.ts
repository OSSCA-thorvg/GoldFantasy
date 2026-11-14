// The crypt draugr: the restless dead of an old barrow, all bone under rags, still gripping its arms.
import { MonsterRank } from '../../engine/src/combat-events';
import { ShapeNode, type Rgb } from './paint';
import { dusk } from './form-paint';
import { humanoidClips, humanoidFigure } from './humanoid-rig';
import { PoseBank } from './rig-pose-bank';
import { capsules, discs, fills, RigSkin } from './rig-skin';
import { grippedWeapon, type HeldWeapon } from './held-weapon-art';
import { monsterTrait, type MonsterKind } from './monster-look';

const bone: Rgb = [228, 218, 192],
  /** Bone on the side away from the light. */
  farBone: Rgb = dusk(bone, 0.3),
  ink: Rgb = [34, 30, 42];
const ragTones: readonly Rgb[] = [
  [62, 86, 92],
  [88, 72, 96],
  [96, 78, 62],
];
let kind: MonsterKind | undefined;
export function draugrKind(): MonsterKind {
  if (kind) return kind;
  const figure = humanoidFigure({
    hip: 5.2,
    chest: 8,
    neck: 10.6,
    shoulder: 2.6,
    shoulderDrop: 0.8,
    upperArm: 2.8,
    forearm: 3,
    stance: 1.2,
    knee: 3,
    ankle: 0.8,
  });
  /** A long bone with a knob at each joint named in `knobs` and a small foot or fist at its end. */
  const limb = (color: Rgb, x: number, from: number, to: number, knobs: readonly number[], foot = 0) => {
    const shape = capsules(0.85, color, [x, from, x, to]).fill(...color);
    for (const y of knobs) shape.appendCircle(x, y, 0.28, 0.28);
    if (foot) shape.moveTo(x, to + 0.05).lineTo(x + foot, to + 0.05);
    return shape;
  };
  kind = {
    bank: new PoseBank(figure),
    top: 17,
    shadow: [4.6, 1.9],
    idle: humanoidClips.idle,
    walk: humanoidClips.walk,
    run: humanoidClips.run,
    fall: humanoidClips.fall,
    pace: 21,
    dress(id, rank) {
      const skin = new RigSkin(figure.skeleton),
        rags = ragTones[Math.floor(monsterTrait(id, 1) * ragTones.length)],
        // A swarm is drawn with the fewest paints that still read as the walking dead, and claws bare-handed.
        swarm = rank === MonsterRank.Swarmer,
        plain = swarm || rank === MonsterRank.Stalker || rank === MonsterRank.Spitter,
        helmed = !plain && monsterTrait(id, 4) < 0.55,
        shielded = !plain && monsterTrait(id, 5) < 0.4,
        pick = monsterTrait(id, 2),
        weapon: HeldWeapon | null =
          swarm || rank === MonsterRank.Spitter
            ? null
            : rank === MonsterRank.Brute
              ? 'axe'
              : rank === MonsterRank.Stalker
                ? 'spear'
                : pick < 0.45
                  ? 'blade'
                  : pick < 0.75
                    ? 'axe'
                    : 'spear';
      if (shielded) {
        // What is left of a round shield, carried on the far arm.
        const board: Rgb = [128, 100, 72];
        skin.piece(
          'arm.l.1',
          limb(bone, -2.6, -9.8, -4, [-9.8, -7, -4]),
          discs(dusk(board, 0.3), [-3.5, -6.4, 3, 3.2]),
          discs(board, [-3.7, -6.5, 2.5, 2.7]),
          discs([150, 152, 160], [-3.7, -6.5, 0.8, 0.85]),
        );
      } else if (!swarm) skin.piece('arm.l.1', limb(bone, -2.6, -9.8, -4, [-9.8, -7, -4]));
      skin.piece('leg.l.1', limb(bone, -1.2, -5.2, -0.5, [-5.2, -3], 1.3));
      skin.piece('leg.r.1', limb(farBone, 1.2, -5.2, -0.5, [-5.2, -3], 1.3));
      skin.piece(
        'spine',
        // Rags hang from the shoulders; the dark of the ribcage shows the bones against it.
        fills(rags, [
          [-3, -10.1],
          [2.7, -10.1],
          [3.1, -4.2],
          [1.7, -5.1],
          [0.5, -3.6],
          [-0.9, -4.9],
          [-2.2, -3.5],
          [-3.5, -4.9],
        ]),
        fills(ink, [
          [-2, -9.6],
          [2, -9.6],
          [1.7, -6.7],
          [-1.7, -6.7],
        ]),
        capsules(
          0.6,
          bone,
          [0, -10.2, 0, -5.4],
          [-2.5, -9.8, 2.5, -9.8],
          [-1.7, -8.9, 1.7, -8.9],
          [-1.6, -8, 1.6, -8],
          [-1.3, -7.1, 1.3, -7.1],
          [-1.4, -5.4, 1.4, -5.4],
        ),
      );
      const skull = new ShapeNode().fill(...bone).appendCircle(0.3, -13.5, 3.2, 3.1);
      // Jaw.
      skull.moveTo(-1.3, -11.3).lineTo(2.5, -11.3).lineTo(2.2, -9.7).lineTo(-0.9, -9.7).close();
      const face = discs(ink, [0.9, -13.2, 0.85, 1], [2.85, -13.1, 0.75, 0.95]);
      face.moveTo(1.75, -11.9).lineTo(2.25, -11.9).lineTo(2, -12.5).close();
      const head = swarm
        ? [skull, face]
        : [
            discs(farBone, [-0.1, -13.3, 3.3, 3.15]),
            skull,
            face,
            discs([150, 226, 212], [1.05, -13.1, 0.26, 0.3], [2.95, -13, 0.24, 0.28]),
          ];
      if (helmed) {
        const iron: Rgb = [98, 102, 112],
          cap = new ShapeNode().fill(...iron);
        cap.moveTo(-3.1, -14.3).cubicTo(-3, -17.6, 3.5, -17.6, 3.6, -14.3).close();
        // Nasal bar.
        cap.moveTo(1.6, -14.3).lineTo(2.3, -14.3).lineTo(2.1, -12.6).lineTo(1.8, -12.6).close();
        head.push(cap, capsules(0.6, [164, 96, 60], [-3.1, -14.3, 3.6, -14.3]));
      }
      skin.piece('head', ...head);
      skin.piece('arm.r.1', limb(farBone, 2.6, -9.8, -7, [-9.8]));
      if (weapon) skin.piece('hand.r', grippedWeapon(weapon, 2.6, -4));
      skin.piece('arm.r.2', limb(farBone, 2.6, -7, -4, [-7, -4]));
      return {
        skin,
        attack: !weapon
          ? humanoidClips.claw
          : weapon === 'spear'
            ? humanoidClips.thrust
            : weapon === 'axe'
              ? humanoidClips.chop
              : humanoidClips.slash,
      };
    },
  };
  return kind;
}
