// The cave warg: a dark wolf that hunts in packs, low at the shoulder and all jaw.
import { MonsterRank } from '../../engine/src/combat-events';
import type { Rgb } from './paint';
import { dusk } from './form-paint';
import { PoseBank } from './rig-pose-bank';
import { quadrupedClips, quadrupedFigure } from './quadruped-rig';
import { RigSkin } from './rig-skin';
import { monsterTrait, type MonsterKind } from './monster-look';
import { dressWolf } from './wolf-art';

const furs: readonly Rgb[] = [
  [84, 78, 94],
  [96, 86, 84],
  [72, 80, 96],
];
let kind: MonsterKind | undefined;
export function wargKind(): MonsterKind {
  if (kind) return kind;
  const figure = quadrupedFigure();
  kind = {
    bank: new PoseBank(figure),
    top: 14,
    shadow: [9.5, 3.2],
    idle: quadrupedClips.idle,
    walk: quadrupedClips.run,
    fall: quadrupedClips.fall,
    pace: 13,
    dress(id, rank) {
      const skin = new RigSkin(figure.skeleton),
        fur = furs[Math.floor(monsterTrait(id, 1) * furs.length)];
      // A swarm drops the far legs and fine marks: a pack reads by its backs and jaws.
      dressWolf(
        skin,
        { fur, lit: [fur[0] + 26, fur[1] + 26, fur[2] + 24], shade: dusk(fur, 0.5), eye: [242, 198, 96] },
        rank === MonsterRank.Swarmer,
      );
      return { skin, attack: quadrupedClips.bite };
    },
  };
  return kind;
}
