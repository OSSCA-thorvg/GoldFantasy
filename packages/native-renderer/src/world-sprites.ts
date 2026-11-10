// Compact world silhouettes with articulated work and combat equipment.
import { point, add, sub, mul, lerp, project, type Point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { Person, Calling } from '../../engine/src/person';
import { appearanceOf, injuryOf, Injury } from '../../engine/src/person-look';
import { HairStyle, BodyType, type Appearance } from '../../engine/src/person-appearance';
import { safeCharacterHairAsset, baldHairAsset } from '../../engine/src/character-reference';
import { Agent, AgentKind } from '../../engine/src/traffic';
import { DungeonKind, type Dungeon } from '../../engine/src/world-types';
import { SceneNode, ShapeNode, TextNode, PaintNode, type Matrix, type Rgb } from './paint';
import { poly, oval, stroke, opaque, scale, fill, glow } from './sprite-primitives';
import { ArmRig, connectArm, poseArm } from './idle-gesture';
import { stoneGiantSprite } from './stone-giant';
import { createEquipment } from './person-equipment';
import { equippedItem } from '../../engine/src/equipment';
import { wearableBack, wearableBody, wearableHead } from './person-wearables';
import { createWorkProps } from './work-motion';
import { characterFigure } from './character-assets';
import { Mood } from './person-portrait';
export interface TextBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type TextMeasure = (text: string, size: number, font: string) => TextBounds | undefined;
export class PersonParts {
  body: SceneNode | null = null;
  shadow: PaintNode | null = null;
  sword: PaintNode | null = null;
  bow: PaintNode | null = null;
  staff: PaintNode | null = null;
  mace: PaintNode | null = null;
  lute: PaintNode | null = null;
  bowString: ShapeNode | null = null;
  arrow: PaintNode | null = null;
  alert: PaintNode | null = null;
  stressRecovery: PaintNode | null = null;
  affiliation: PaintNode | null = null;
  hoe: PaintNode | null = null;
  wateringCan: PaintNode | null = null;
  saw: PaintNode | null = null;
  chisel: PaintNode | null = null;
  waterDrops: SceneNode | null = null;
  soilDust: SceneNode | null = null;
  sawLog: SceneNode | null = null;
  workStone: SceneNode | null = null;
  hammer: PaintNode | null = null;
  axe: PaintNode | null = null;
  pickaxe: PaintNode | null = null;
  sack: PaintNode | null = null;
  logs: PaintNode | null = null;
  stone: PaintNode | null = null;
  planks: PaintNode | null = null;
  cutStone: PaintNode | null = null;
  arms: [ArmRig, ArmRig] = [new ArmRig(), new ArmRig()];
  feet: (PaintNode | null)[] = [null, null];
}
export interface LanternLight {
  glow: PaintNode;
  halo: PaintNode;
  flame: Point;
}
const bodyProportions = (type: BodyType) =>
  type === BodyType.Female
    ? { shoulders: f32(0.96), waist: f32(0.91), hips: f32(1.02), neck: f32(0.96) }
    : { shoulders: f32(1.035), waist: 1, hips: 1, neck: 1 };
const color = (c: { r: number; g: number; b: number }): Rgb => [c.r, c.g, c.b];
const setTransform = (paint: PaintNode | null, matrix: Matrix) => paint?.transform(matrix);
const skins: Rgb[] = [
  [186, 150, 120],
  [150, 112, 86],
  [112, 82, 62],
];
let wood: Rgb = [110, 82, 56],
  ink: Rgb = [30, 26, 30],
  arcane: Rgb = [130, 240, 220],
  warm: Rgb = [244, 186, 96];
function shadow(sprite: SceneNode, rx: number): void {
  sprite.add(oval([0, 0], rx, f32(rx * f32(0.42)), [0, 0, 0, 110]));
}
function figure(sprite: SceneNode, robe: Rgb, skin: Rgb, height = 11, width = f32(4.2)): void {
  shadow(sprite, f32(width + f32(1.3)));
  sprite.add(
    poly(
      [
        [-width, 0],
        [width, 0],
        [f32(width * f32(0.55)), -height],
        [f32(-width * f32(0.55)), -height],
      ],
      opaque(robe),
    ),
  );
  sprite.add(
    poly(
      [
        [0, 0],
        [width, 0],
        [f32(width * f32(0.55)), -height],
        [0, -height],
      ],
      opaque(scale(robe, f32(0.66))),
    ),
  );
  sprite.add(oval([0, f32(-height - 3)], f32(3.2), f32(3.2), opaque(skin)));
}
// A person's walking figure at its old proportions: boots under the hem, a robe lit on the left,
// sleeves and hands, a belt and collar, then a shaded head with eyes looking the way they walk.
function personFigure(
  sprite: SceneNode,
  a: Appearance,
  robe: Rgb,
  height: number,
  width: number,
  parts: PersonParts,
): void {
  let boot: Rgb = [58, 44, 36],
    belt: Rgb = [84, 60, 42];
  let foot = f32(width * f32(0.55));
  parts.feet[0] = poly(
    [
      [-foot, 0],
      [f32(-foot + f32(1.8)), 0],
      [f32(-foot + f32(1.8)), -f32(1.9)],
      [-foot, -f32(1.9)],
    ],
    opaque(boot),
  );
  parts.feet[1] = poly(
    [
      [f32(foot - f32(1.8)), 0],
      [foot, 0],
      [foot, -f32(1.9)],
      [f32(foot - f32(1.8)), -f32(1.9)],
    ],
    opaque(scale(boot, f32(0.78))),
  );
  sprite.add(parts.feet[0]);
  sprite.add(parts.feet[1]);
  let shoulderJoins = new SceneNode();
  sprite.add(shoulderJoins);
  let body = bodyProportions(a.bodyType);
  let hem = -f32(1.3),
    top = -height,
    shoulder = f32(f32(width * f32(0.55)) * body.shoulders);
  let waist = f32(-height * f32(0.42)),
    hips = f32(width * body.hips);
  let waistWidth = f32(
    f32(hips - f32(f32(f32(hips - shoulder) * f32(waist - hem)) / f32(top - hem))) * body.waist,
  );
  sprite.add(
    poly(
      [
        [-hips, hem],
        [hips, hem],
        [waistWidth, waist],
        [shoulder, top],
        [-shoulder, top],
        [-waistWidth, waist],
      ],
      opaque(robe),
    ),
  );
  sprite.add(
    poly(
      [
        [0, hem],
        [hips, hem],
        [waistWidth, waist],
        [shoulder, top],
        [0, top],
      ],
      opaque(scale(robe, f32(0.66))),
    ),
  );
  // Belt across the waist.
  const halfAt = (y: number) => {
    return y < waist
      ? f32(waistWidth + f32(f32(f32(shoulder - waistWidth) * f32(y - waist)) / f32(top - waist)))
      : f32(waistWidth + f32(f32(f32(hips - waistWidth) * f32(y - waist)) / f32(hem - waist)));
  };
  sprite.add(
    poly(
      [
        [-halfAt(waist), waist],
        [halfAt(waist), waist],
        [halfAt(f32(waist - 1)), f32(waist - 1)],
        [-halfAt(f32(waist - 1)), f32(waist - 1)],
      ],
      opaque(belt),
    ),
  );
  sprite.add(oval([f32(0.7), f32(waist - f32(0.5))], f32(0.45), f32(0.45), [212, 172, 82]));
  // Sleeves and hands, each arm its own part so it can swing.
  for (let i = 0; i < 2; ++i) {
    let side = i ? 1 : -1;
    let sleeve = side < 0 ? scale(robe, f32(0.88)) : scale(robe, f32(0.58));
    let x = f32(side * shoulder),
      hand = f32(side * f32(width * f32(0.82)));
    let arm = parts.arms[Number(i)];
    arm.shoulder = point(f32(x + f32(side * f32(0.5))), f32(top + 1));
    arm.wrist = point(hand, f32(-height * f32(0.36)));
    arm.elbow = lerp(arm.shoulder, arm.wrist, f32(0.47));
    arm.upper = new SceneNode();
    sprite.add(arm.upper);
    arm.forearm = new SceneNode();
    arm.hand = new SceneNode();
    connectArm(arm, shoulderJoins, sleeve, f32(1.45), f32(0.52));
    let skin = opaque(side < 0 ? color(a.skin) : color(a.skinShade));
    arm.hand.add(oval(arm.wrist, f32(0.85), f32(0.95), skin));
    arm.hand.add(
      oval([f32(hand - f32(side * f32(0.6))), f32(arm.wrist.y - f32(0.2))], f32(0.32), f32(0.42), skin),
    );
    arm.forearm!.add(arm.hand);
  }
  sprite.add(
    poly(
      [
        [-f32(1.3), top],
        [f32(1.3), top],
        [0, f32(top + f32(1.7))],
      ],
      opaque(color(a.trim)),
    ),
  );
}
function bandagedWrist(arm: ArmRig): void {
  let axis = sub(arm.elbow, arm.wrist);
  let length = Math.max(f32(0.01), f32(Math.hypot(axis.x, axis.y)));
  axis = mul(axis, f32(1 / length));
  let normal = point(-axis.y, axis.x);
  let from = sub(arm.wrist, mul(axis, f32(0.12))),
    to = add(arm.wrist, mul(axis, f32(1.25)));
  let cloth = stroke(from, to, f32(1.65), [222, 214, 192]);
  arm.forearm!.add(cloth);
  for (const t of [f32(0.32), f32(0.68)]) {
    let at = lerp(from, to, t);
    arm.forearm!.add(
      stroke(
        sub(sub(at, mul(normal, f32(0.73))), mul(axis, f32(0.1))),
        add(add(at, mul(normal, f32(0.73))), mul(axis, f32(0.1))),
        f32(0.06),
        [166, 156, 136],
      ),
    );
  }
}
export interface MonsterParts {
  body: SceneNode;
  shadow: PaintNode;
  last: Point;
  facing: number;
}
const monsterRigs = new WeakMap<SceneNode, MonsterParts>();
export const monsterParts = (sprite: SceneNode): MonsterParts | undefined => monsterRigs.get(sprite);
function monster(root: SceneNode, lair: DungeonKind): void {
  const sprite = lair === DungeonKind.GiantHall ? stoneGiantSprite() : new SceneNode();
  const shadow = lair === DungeonKind.GiantHall ? sprite.children[0] : oval([0, 0], 9, 3.4, [0, 0, 0, 120]);
  if (lair === DungeonKind.GiantHall) sprite.remove(shadow);
  root.add(shadow).add(sprite);
  monsterRigs.set(root, { body: sprite, shadow, last: point(-1, -1), facing: 1 });
  if (lair === DungeonKind.GiantHall) return;
  const dark: Rgb = [23, 25, 29];
  if (lair === DungeonKind.Cave) {
    // A low, bristled wolf: the muzzle, folded hind legs and tail read at world scale.
    const fur: Rgb = [66, 62, 71],
      lit: Rgb = [86, 82, 91],
      shade: Rgb = [43, 42, 50];
    sprite.add(
      poly(
        [
          [-7, -8],
          [-12, -10],
          [-15, -7],
          [-12, -7],
          [-8, -4],
        ],
        shade,
      ),
    );
    sprite.add(
      poly(
        [
          [-6, -6],
          [-3, -5],
          [-4, -2],
          [-3, 0],
          [-6, 0],
          [-7, -3],
        ],
        shade,
      ),
    );
    sprite.add(
      poly(
        [
          [3, -6],
          [5, -6],
          [6, -0.5],
          [3, 0],
        ],
        shade,
      ),
    );
    sprite.add(
      poly(
        [
          [-9, -6],
          [-6, -10],
          [-2, -11],
          [1, -10],
          [3, -12],
          [7, -9],
          [8, -6],
          [4, -3],
          [-5, -4],
        ],
        fur,
      ),
    );
    sprite.add(
      poly(
        [
          [-8, -7],
          [-5, -10],
          [-2, -11],
          [1, -10],
          [4, -11],
          [5, -8],
          [0, -7],
          [-4, -8],
        ],
        lit,
      ),
    );
    sprite.add(
      poly(
        [
          [-7, -5],
          [-4, -5],
          [-5, -2],
          [-4, -0.4],
          [-7, 0],
          [-8, -2],
        ],
        fur,
      ),
    );
    sprite.add(
      poly(
        [
          [5, -7],
          [7, -6],
          [7, -1],
          [9, -0.2],
          [5, 0],
          [4, -3],
        ],
        lit,
      ),
    );
    sprite.add(
      poly(
        [
          [5, -10],
          [8, -12],
          [10, -11],
          [11, -9],
          [14, -8],
          [14, -6.7],
          [10, -5.5],
          [7, -6],
        ],
        fur,
      ),
    );
    sprite.add(
      poly(
        [
          [7, -11],
          [7.5, -15],
          [10, -11.5],
        ],
        shade,
      ),
    );
    sprite.add(
      poly(
        [
          [8.5, -11.5],
          [10.2, -14],
          [11.2, -10],
        ],
        fur,
      ),
    );
    sprite.add(
      poly(
        [
          [8, -8],
          [10, -7.7],
          [13.4, -7.5],
          [12, -6],
          [9, -5.8],
        ],
        [109, 103, 103],
      ),
    );
    sprite.add(
      poly(
        [
          [12.8, -8.4],
          [14.5, -8],
          [14.2, -6.8],
          [12.8, -7],
        ],
        dark,
      ),
    );
    sprite.add(stroke([9.1, -9.6], [10.7, -9.2], 0.65, dark));
    sprite.add(stroke([10.5, -6.3], [12.7, -6.8], 0.35, shade));
    return;
  }
  if (lair === DungeonKind.Crypt) {
    const bone: Rgb = [166, 160, 143],
      pale: Rgb = [196, 190, 170],
      shade: Rgb = [110, 108, 99];
    sprite.add(stroke([-2.5, -5], [-3, -1], 1.5, shade));
    sprite.add(stroke([2, -5], [3.2, -0.7], 1.5, bone));
    sprite.add(stroke([-3.3, -0.5], [-1, -0.5], 1.1, shade));
    sprite.add(stroke([2.5, -0.4], [5, -0.4], 1.2, bone));
    sprite.add(
      poly(
        [
          [-4, -6],
          [-3, -12],
          [0, -14],
          [4, -12],
          [4, -6],
          [1, -7],
          [-1, -4],
        ],
        [62, 60, 62],
      ),
    );
    sprite.add(stroke([0, -12.8], [0, -6], 1.2, bone));
    for (let rib = 0; rib < 3; ++rib) {
      sprite.add(stroke([-2.7, -12 + rib * 1.7], [0, -10.9 + rib * 1.7], 0.9, shade));
      sprite.add(stroke([0, -10.9 + rib * 1.7], [3, -12 + rib * 1.7], 0.9, bone));
    }
    sprite.add(
      poly(
        [
          [-3.6, -12],
          [-5.4, -9],
          [-5.5, -5],
          [-4.2, -4],
          [-4, -8],
          [-2.4, -11],
        ],
        shade,
      ),
    );
    sprite.add(
      poly(
        [
          [3, -12],
          [5.6, -9],
          [7, -5.7],
          [5.7, -4.7],
          [4.2, -8],
          [2, -11],
        ],
        bone,
      ),
    );
    sprite.add(
      poly(
        [
          [-1.5, -18],
          [1, -20],
          [4, -19.6],
          [5.6, -17.6],
          [5, -14.5],
          [3.5, -12.8],
          [0, -13],
          [-1.6, -15],
        ],
        bone,
      ),
    );
    sprite.add(
      poly(
        [
          [-1.5, -18],
          [1, -20],
          [2, -19.5],
          [1.4, -16.5],
          [-1.2, -15.5],
        ],
        pale,
      ),
    );
    sprite.add(oval([0.2, -16.6], 1.05, 1.2, dark));
    sprite.add(oval([3.6, -16.8], 1.1, 1.15, dark));
    sprite.add(
      poly(
        [
          [1.8, -15.8],
          [2.4, -14.6],
          [1.2, -14.6],
        ],
        shade,
      ),
    );
    sprite.add(stroke([0.3, -13.9], [3.9, -14.1], 0.55, shade));
    return;
  }
  const portal = lair === DungeonKind.Portal,
    cloth: Rgb = portal ? [64, 49, 77] : [62, 76, 50],
    lit: Rgb = portal ? [85, 68, 99] : [91, 108, 70],
    shade: Rgb = portal ? [39, 35, 49] : [42, 51, 36];
  sprite.add(
    poly(
      [
        [-3.5, -5],
        [-0.7, -4],
        [-1, -0.5],
        [-4, 0],
        [-4.8, -0.7],
      ],
      shade,
    ),
  );
  sprite.add(
    poly(
      [
        [1.5, -5],
        [4, -5],
        [5, -0.6],
        [2, 0],
        [1.3, -1],
      ],
      cloth,
    ),
  );
  if (portal) {
    sprite.add(
      poly(
        [
          [-3, -14],
          [-9, -18],
          [-8, -11],
          [-11, -7],
          [-7, -8],
          [-7, -3],
          [-3, -5],
        ],
        shade,
      ),
    );
    sprite.add(
      poly(
        [
          [2, -14],
          [7, -17],
          [8, -10],
          [10, -7],
          [6, -8],
          [7, -3],
          [3, -5],
        ],
        shade,
      ),
    );
  }
  sprite.add(
    poly(
      [
        [-5, -5],
        [-5.5, -10],
        [-3, -14],
        [1, -15],
        [5, -12],
        [5.5, -5],
        [2, -3],
        [-1, -5],
      ],
      cloth,
    ),
  );
  sprite.add(
    poly(
      [
        [-5.5, -10],
        [-3, -14],
        [1, -15],
        [1.5, -8],
        [-2, -6],
      ],
      lit,
    ),
  );
  sprite.add(
    poly(
      [
        [-4, -11],
        [-7, -8],
        [-6.5, -4],
        [-4.9, -3.5],
        [-4.8, -7],
        [-2.4, -10],
      ],
      shade,
    ),
  );
  sprite.add(
    poly(
      [
        [4, -11],
        [7, -8],
        [7.8, -3.7],
        [6, -3.4],
        [5, -6.8],
        [2, -10],
      ],
      lit,
    ),
  );
  sprite.add(
    poly(
      [
        [-4, -6.3],
        [4.7, -6.3],
        [4.9, -5.2],
        [-4, -5.2],
      ],
      [79, 61, 46],
    ),
  );
  sprite.add(
    poly(
      [
        [-1.5, -18.7],
        [1, -20],
        [4.8, -19],
        [6, -16.3],
        [4.8, -12.7],
        [1, -12.3],
        [-1.8, -14.4],
      ],
      lit,
    ),
  );
  sprite.add(
    poly(
      [
        [2, -19.5],
        [4.8, -19],
        [6, -16.3],
        [4.8, -12.7],
        [2.6, -13.2],
      ],
      cloth,
    ),
  );
  if (portal) {
    sprite.add(
      poly(
        [
          [-1.5, -17],
          [-3.8, -21.7],
          [-0.2, -19.6],
          [1, -17.4],
        ],
        [115, 107, 116],
      ),
    );
    sprite.add(
      poly(
        [
          [3.8, -18],
          [6.5, -21],
          [5.9, -16.2],
        ],
        [84, 79, 92],
      ),
    );
  } else {
    sprite.add(
      poly(
        [
          [-1.5, -16.7],
          [-5, -18.8],
          [-3.7, -15.6],
          [-1, -14.7],
        ],
        lit,
      ),
    );
    sprite.add(
      poly(
        [
          [4.8, -17],
          [8, -18.1],
          [6.2, -14.9],
          [4.8, -14.7],
        ],
        cloth,
      ),
    );
    sprite.add(
      poly(
        [
          [0.4, -13.7],
          [4.7, -14],
          [4.2, -12.3],
          [1, -11.8],
        ],
        [110, 118, 79],
      ),
    );
  }
  // Recessed eyes remain dark; there is no eye light, colored halo or emissive paint.
  sprite.add(
    poly(
      [
        [-0.3, -17.1],
        [1.5, -16.7],
        [1.3, -15.8],
        [-0.2, -16],
      ],
      dark,
    ),
  );
  sprite.add(
    poly(
      [
        [3, -16.8],
        [4.8, -17.1],
        [4.7, -16],
        [3.2, -15.8],
      ],
      dark,
    ),
  );
  sprite.add(
    poly(
      [
        [2, -16.6],
        [1.6, -14.5],
        [3, -14.2],
      ],
      shade,
    ),
  );
  sprite.add(stroke([1, -13.6], [4.2, -13.8], 0.5, shade));
}
function dungeonCenter(site: Dungeon): Point {
  return project(f32(site.origin.x + 1), f32(site.origin.y + 1));
}
function label(objects: SceneNode, at: Point, text: string, measure: TextMeasure): void {
  const box = measure(text, 8, 'DejaVuSans-Bold');
  if (!box) return;
  const name = new TextNode();
  name.font = 'DejaVuSans-Bold';
  name.size = 8;
  name.text = text;
  name.color = [214, 186, 120, 255];
  objects.add(
    poly(
      [
        [f32(f32(at.x - f32(box.w / 2)) - 6), f32(at.y - 9)],
        [f32(f32(at.x + f32(box.w / 2)) + 6), f32(at.y - 9)],
        [f32(f32(at.x + f32(box.w / 2)) + 6), f32(at.y + 5)],
        [f32(f32(at.x - f32(box.w / 2)) - 6), f32(at.y + 5)],
      ],
      [14, 12, 18, 190],
    ),
  );
  name.translate(f32(f32(at.x - f32(box.w / 2)) - box.x), f32(at.y - 6));
  objects.add(name);
}
export function agentSprite(agent: Agent, lair: DungeonKind): SceneNode {
  let sprite = new SceneNode();
  let skin = skins[Math.trunc(agent.look / 7) % skins.length];
  switch (agent.kind) {
    case AgentKind.Merchant:
      sprite.add(
        poly(
          [
            [-8, -4],
            [-2, -4],
            [-2, -15],
            [-8, -15],
          ],
          [104, 76, 50],
        ),
      ); // Pack.
      figure(sprite, [48, 92, 84], skin, 12);
      sprite.add(stroke([4, -7], [7, -7], 1, opaque(ink)));
      sprite.add(oval([f32(7.5), -5], f32(4.5), f32(4.5), opaque(warm, 60)));
      sprite.add(oval([f32(7.5), -5], f32(1.8), f32(1.8), opaque(warm)));
      break;
    case AgentKind.Monster:
      monster(sprite, lair);
      break;
  }
  return sprite;
}
// How tall a person's figure stands to the shoulders, and how broad at the hem.
function figureHeight(person: Person): number {
  let tall = 11,
    wide = f32(4.2);
  let heightScale = person.customLook ? person.customLook.bodyHeight : 1;
  let widthScale = person.customLook ? person.customLook.bodyWidth : 1;
  return f32(tall * heightScale);
}
function streetHairStyle(a: Appearance): HairStyle {
  const styles = [
    HairStyle.Swept,
    HairStyle.Long,
    HairStyle.Swept,
    HairStyle.Wild,
    HairStyle.Wild,
    HairStyle.Bob,
    HairStyle.Long,
    HairStyle.Wild,
    HairStyle.Bob,
    HairStyle.TwinTails,
    HairStyle.Crop,
    HairStyle.Braids,
    HairStyle.Long,
    HairStyle.Crop,
    HairStyle.Wild,
    HairStyle.TwinTails,
    HairStyle.Bun,
    HairStyle.Crop,
    HairStyle.Bun,
  ];
  let source = safeCharacterHairAsset(a.hairAsset);
  if (source == baldHairAsset) return HairStyle.Bald;
  return source < styles.length ? styles[source] : HairStyle.Long;
}
function streetCrownRise(style: HairStyle): number {
  return style == HairStyle.Wild
    ? f32(5.5)
    : style == HairStyle.Bun
      ? f32(5.2)
      : style == HairStyle.Bald
        ? f32(3.2)
        : f32(4.5);
}
// Small world silhouettes have a fixed head frame. Portrait locks, cut-outs
// and face morphs never enter this rig; even long styles end near the shoulders.
function streetHairBehind(sprite: SceneNode, a: Appearance, style: HairStyle, head: Point): void {
  if (style == HairStyle.Long || style == HairStyle.Bob) {
    let bottom = style == HairStyle.Bob ? 3 : 5;
    let fall = new ShapeNode();
    fall.moveTo(f32(head.x - f32(3.3)), f32(head.y - 1));
    fall.cubicTo(
      f32(head.x - f32(4.1)),
      f32(head.y + 1),
      f32(head.x - 4),
      f32(head.y + bottom),
      f32(head.x - f32(2.8)),
      f32(head.y + bottom),
    );
    fall.lineTo(f32(head.x + f32(2.8)), f32(head.y + bottom));
    fall.cubicTo(
      f32(head.x + 4),
      f32(head.y + bottom),
      f32(head.x + f32(4.1)),
      f32(head.y + 1),
      f32(head.x + f32(3.3)),
      f32(head.y - 1),
    );
    fall.close();
    fill(fall, opaque(color(a.hairShade)));
    sprite.add(fall);
  } else if (style == HairStyle.Braids) {
    for (const side of [-1, 1])
      sprite.add(
        stroke(
          add(head, point(f32(side * 3), f32(0.2))),
          add(head, point(f32(side * f32(3.3)), f32(4.8))),
          f32(1.1),
          opaque(color(a.hair)),
        ),
      );
  } else if (style == HairStyle.TwinTails) {
    for (const side of [-1, 1])
      sprite.add(
        oval(add(head, point(f32(side * f32(3.6)), f32(0.8))), f32(1.1), f32(1.6), opaque(color(a.hair))),
      );
  }
}
function streetHead(sprite: SceneNode, a: Appearance, style: HairStyle, head: Point): void {
  sprite.add(oval(head, f32(3.2), f32(3.2), opaque(color(a.skin))));
  let shade = oval(add(head, point(f32(1.9), 0)), f32(1.7), f32(3.2), opaque(color(a.skinShade), 170));
  shade.clip(oval(head, f32(3.2), f32(3.2), opaque(color(a.skin))));
  sprite.add(shade);
  for (const x of [f32(0.65), f32(1.95)])
    sprite.add(oval(add(head, point(x, f32(0.3))), f32(0.16), f32(0.24), opaque(ink)));
  if (style == HairStyle.Bald) return;
  let fringe = style == HairStyle.Swept ? f32(0.8) : 0;
  let cap = new ShapeNode();
  cap.moveTo(f32(head.x - f32(3.45)), f32(head.y + f32(1.6)));
  if (style == HairStyle.Wild) {
    // One connected silhouette; small tufts must not let above the cap.
    for (const p of [
      point(-f32(3.5), -f32(2.2)),
      point(-f32(3.2), -f32(4.6)),
      point(-f32(1.9), -f32(3.5)),
      point(-1, -f32(5.2)),
      point(0, -f32(3.9)),
      point(f32(1.2), -f32(5.5)),
      point(f32(1.7), -f32(3.5)),
      point(f32(2.8), -f32(4.6)),
      point(f32(3.35), -f32(1.4)),
    ])
      cap.lineTo(f32(head.x + p.x), f32(head.y + p.y));
  } else
    cap.cubicTo(
      f32(head.x - 4),
      f32(head.y - f32(3.6)),
      f32(head.x + f32(1.2)),
      f32(head.y - f32(4.9)),
      f32(head.x + f32(3.35)),
      f32(f32(head.y - f32(1.4)) + fringe),
    );
  cap.cubicTo(
    f32(head.x + f32(2.2)),
    f32(f32(head.y - f32(2.4)) + fringe),
    f32(head.x + f32(0.6)),
    f32(head.y - f32(2.5)),
    f32(head.x - f32(0.8)),
    f32(head.y - f32(1.4)),
  );
  cap.cubicTo(
    f32(head.x - f32(1.8)),
    f32(head.y - f32(0.4)),
    f32(head.x - f32(2.4)),
    f32(head.y + f32(0.8)),
    f32(head.x - f32(3.45)),
    f32(head.y + f32(1.6)),
  );
  cap.close();
  fill(cap, opaque(color(a.hair)));
  sprite.add(cap);
  if (style == HairStyle.Bun)
    sprite.add(oval(add(head, point(-f32(1.6), -f32(3.9))), f32(1.5), f32(1.3), opaque(color(a.hair))));
}
// World walking bodies retain their gameplay rig and their own compact head.
function figureOf(person: Person, parts: PersonParts): SceneNode {
  const root = new SceneNode(),
    sprite = new SceneNode();
  parts.body = sprite;
  let look = appearanceOf(person);
  let broad = f32(f32(4.2) * (person.customLook?.bodyWidth ?? 1)),
    height = figureHeight(person);
  parts.shadow = oval([0, 0], broad + 1.3, (broad + 1.3) * 0.42, [0, 0, 0, 110]);
  root.add(parts.shadow).add(sprite);
  let head = point(0, f32(-height - 3));
  let hair = streetHairStyle(look);
  streetHairBehind(sprite, look, hair, head);
  if (person.calling == Calling.Traveller)
    sprite.add(
      poly(
        [
          [-7, -4],
          [-2, -4],
          [-2, -13],
          [-7, -13],
        ],
        [104, 76, 50],
      ),
    );
  wearableBack(sprite, person, height, broad);
  personFigure(sprite, look, color(look.cloth), height, broad, parts);
  if (injuryOf(person) == Injury.Bandaged) bandagedWrist(parts.arms[person.look % 2]);
  parts.arms[0].free = equippedItem(person, 'offhand')?.id !== 'shield';
  parts.arms[1].free = true;
  switch (person.calling) {
    case Calling.Settler:
      break;
    case Calling.Traveller:
      break;
    case Calling.Warrior:
      sprite.add(
        poly(
          [
            [-f32(1.6), f32(-height + 1)],
            [f32(1.6), f32(-height + 1)],
            [f32(1.9), -2],
            [-f32(1.9), -2],
          ],
          opaque(color(look.cloth)),
        ),
      ); // Tabard.
      break;
    case Calling.Ranger:
    case Calling.Mage:
      break;
    case Calling.Cleric:
      sprite.add(
        poly(
          [
            [-1, -4],
            [1, -4],
            [1, -10],
            [-1, -10],
          ],
          opaque(color(look.trim)),
        ),
      );
      break;
    case Calling.Bard:
      break;
  }
  // Equipment appears only when a real inventory item occupies the slot.
  if (equippedItem(person, 'offhand')?.id === 'shield') {
    sprite.add(
      poly(
        [
          [-f32(6.5), -4],
          [-2, -4],
          [-2, -11],
          [-f32(6.5), -11],
        ],
        opaque(color(look.cloth)),
      ),
    ); // Shield in the house colours.
    sprite.add(stroke([-f32(4.25), -f32(4.6)], [-f32(4.25), -f32(10.4)], f32(0.7), [212, 172, 82]));
  }

  wearableBody(sprite, person, parts, height, broad);
  streetHead(sprite, look, hair, head);
  wearableHead(sprite, person, head);
  for (const arm of parts.arms) sprite.add(arm.forearm!);
  createEquipment(parts, person.calling);
  createWorkProps(root, parts);
  // Loads carried on the back.
  let sack = new SceneNode();
  sack.add(oval([-f32(4.5), -11], f32(3.6), f32(4.2), [176, 150, 96]));
  sack.opacity(0);
  sprite.add(sack);
  parts.sack = sack;
  let logs = new SceneNode();
  for (let i = 0; i < 3; ++i) {
    let end = point(f32(-6 + f32(i * f32(2.4))), f32(-13 + f32((i % 2) * 2)));
    logs.add(stroke(add(end, point(-f32(3.5), -3)), end, f32(3.5), [90, 63, 40]));
    logs.add(oval(end, f32(1.8), f32(1.8), [164, 124, 78]));
  }
  logs.opacity(0);
  sprite.add(logs);
  parts.logs = logs;
  let stones = new SceneNode();
  stones.add(
    poly(
      [
        [-8, -9],
        [-6, -14],
        [-2, -13],
        [-1, -9],
      ],
      [120, 118, 128],
    ),
  );
  stones.opacity(0);
  sprite.add(stones);
  parts.stone = stones;
  const planks = new SceneNode(),
    cutStone = new SceneNode();
  for (let i = 0; i < 3; i++) {
    const x = -9 + i * 2.2,
      y = -14 + (i % 2) * 1.1;
    planks.add(
      poly(
        [
          [x, y],
          [x + 5, y - 2],
          [x + 7, y],
          [x + 2, y + 2],
        ],
        [181, 139, 88],
      ),
    );
    planks.add(
      poly(
        [
          [x, y],
          [x + 2, y + 2],
          [x + 2, y + 3.4],
          [x, y + 1.4],
        ],
        [115, 79, 46],
      ),
    );
    planks.add(
      poly(
        [
          [x + 2, y + 2],
          [x + 7, y],
          [x + 7, y + 1.4],
          [x + 2, y + 3.4],
        ],
        [148, 103, 59],
      ),
    );
  }
  for (let i = 0; i < 2; i++) {
    const x = -8 + i * 3.1,
      y = -12 - i * 1.2;
    cutStone.add(
      poly(
        [
          [x, y],
          [x + 3, y - 1.5],
          [x + 5, y],
          [x + 2, y + 1.5],
        ],
        [166, 163, 158],
      ),
    );
    cutStone.add(
      poly(
        [
          [x, y],
          [x + 2, y + 1.5],
          [x + 2, y + 4],
          [x, y + 2.5],
        ],
        [117, 115, 116],
      ),
    );
    cutStone.add(
      poly(
        [
          [x + 2, y + 1.5],
          [x + 5, y],
          [x + 5, y + 2.5],
          [x + 2, y + 4],
        ],
        [87, 88, 95],
      ),
    );
  }
  planks.add(stroke([-7, -14], [-3, -10], 0.7, [84, 65, 43]));
  planks.opacity(0);
  cutStone.opacity(0);
  sprite.add(planks).add(cutStone);
  parts.planks = planks;
  parts.cutStone = cutStone;
  let mark = oval([0, -22], f32(2.4), f32(2.4), [230, 80, 64, 255]);
  mark.opacity(0);
  sprite.add(mark);
  parts.alert = mark;
  const recovery = new SceneNode();
  recovery.add(
    poly(
      [
        [0, -27],
        [4, -23],
        [0, -19],
        [-4, -23],
      ],
      [224, 172, 84],
    ),
  );
  recovery.add(stroke([-1, -25], [-1, -21], 1, [49, 41, 31]));
  recovery.add(stroke([1, -25], [1, -21], 1, [49, 41, 31]));
  recovery.opacity(0);
  root.add(recovery);
  parts.stressRecovery = recovery;
  const affiliation = new SceneNode();
  affiliation.add(stroke([-7, -19], [-7, -27], 1, [44, 49, 48]));
  affiliation.add(
    poly(
      [
        [-7, -27],
        [-2, -26],
        [-3, -23],
        [-7, -24],
      ],
      [145, 179, 173],
    ),
  );
  affiliation.opacity(0);
  root.add(affiliation);
  parts.affiliation = affiliation;
  return root;
}
export function personSprite(person: Person, parts: PersonParts): SceneNode {
  Object.assign(parts, new PersonParts());
  return figureOf(person, parts);
}
export function personSpeechAnchor(person: Person): Point {
  let a = appearanceOf(person);
  let rise = streetCrownRise(streetHairStyle(a));
  return point(0, f32(f32(f32(-figureHeight(person) - 3) - rise) - f32(1.5)));
}
export function personCloseup(person: Person, _mood: Mood): SceneNode {
  return characterFigure(appearanceOf(person));
}
export function stridePose(parts: PersonParts, stride: number, walking: boolean): void {
  // The figure faces the viewer three-quarters on, toward +x: the arm swinging forward reaches
  // that way and shortens toward the eye, the other trails behind. Feet step and lift in turn.
  let swing = walking ? f32(Math.sin(stride)) : 0;
  for (let i = 0; i < 2; ++i) {
    let phase = f32((i ? -1 : 1) * swing),
      forward = Math.max(0, phase),
      back = Math.max(0, -phase);
    let angle = f32(f32(-f32(0.5) * forward) + f32(f32(0.35) * back)),
      squash = f32(1 - f32(f32(0.25) * forward));
    poseArm(parts.arms[Number(i)], angle, 0, 0, 0, squash);
    let lift = walking ? f32(Math.max(0, f32((i ? -1 : 1) * f32(Math.cos(stride)))) * f32(0.55)) : 0;
    setTransform(parts.feet[i], [1, 0, f32((i ? -f32(0.75) : f32(0.75)) * swing), 0, 1, -lift, 0, 0, 1]);
  }
}
const dungeonBodies = new WeakMap<SceneNode, readonly PaintNode[]>();
export const dungeonBody = (paint: SceneNode): readonly PaintNode[] => dungeonBodies.get(paint) ?? [];
export function dungeonSprite(
  objects: SceneNode,
  lights: SceneNode,
  site: Dungeon,
  measure: TextMeasure,
): PaintNode | null {
  let c = dungeonCenter(site);
  let rock: Rgb = [74, 72, 80],
    rockShade: Rgb = [48, 46, 54],
    dark: Rgb = [8, 8, 12];
  let pulse: PaintNode | null = null;
  switch (site.kind) {
    case DungeonKind.GiantHall: {
      objects.add(
        poly(
          [
            [f32(c.x - 48), f32(c.y + 12)],
            [f32(c.x - 42), f32(c.y - 29)],
            [f32(c.x - 21), f32(c.y - 40)],
            [f32(c.x + 28), f32(c.y - 37)],
            [f32(c.x + 47), f32(c.y - 15)],
            [f32(c.x + 48), f32(c.y + 12)],
          ],
          opaque([58, 61, 70]),
        ),
      );
      objects.add(
        poly(
          [
            [f32(c.x - 48), f32(c.y + 12)],
            [f32(c.x - 42), f32(c.y - 29)],
            [f32(c.x - 21), f32(c.y - 40)],
            [f32(c.x - 4), f32(c.y - 30)],
            [f32(c.x - 12), f32(c.y + 12)],
          ],
          opaque([78, 82, 92]),
        ),
      );
      objects.add(
        poly(
          [
            [f32(c.x - 17), f32(c.y + 13)],
            [f32(c.x - 17), f32(c.y - 13)],
            [f32(c.x - 10), f32(c.y - 22)],
            [f32(c.x + 13), f32(c.y - 22)],
            [f32(c.x + 19), f32(c.y - 13)],
            [f32(c.x + 19), f32(c.y + 13)],
          ],
          opaque([18, 20, 26]),
        ),
      );
      objects.add(
        stroke([f32(c.x - 19), f32(c.y - 25)], [f32(c.x + 20), f32(c.y - 25)], 3, opaque([98, 102, 112])),
      );
      for (const side of [-1, 1]) {
        objects.add(
          stroke(
            [f32(c.x + f32(side * 28)), f32(c.y - 16)],
            [f32(c.x + f32(side * 28)), f32(c.y - 6)],
            f32(1.5),
            opaque([136, 156, 182]),
          ),
        );
        objects.add(
          stroke(
            [f32(c.x + f32(side * 28)), f32(c.y - 11)],
            [f32(c.x + f32(side * 32)), f32(c.y - 14)],
            f32(1.2),
            opaque([136, 156, 182]),
          ),
        );
      }
      break;
    }
    case DungeonKind.Cave:
      lights.add(glow([f32(c.x - 8), f32(c.y + 8)], 60, 30, [90, 220, 200], 70));
      objects.add(
        poly(
          [
            [f32(c.x - 56), f32(c.y + 6)],
            [f32(c.x - 34), f32(c.y - 30)],
            [f32(c.x - 6), f32(c.y - 46)],
            [f32(c.x + 4), f32(c.y - 20)],
            [f32(c.x - 4), f32(c.y + 24)],
            [f32(c.x - 30), f32(c.y + 22)],
          ],
          opaque(rock),
        ),
      );
      objects.add(
        poly(
          [
            [f32(c.x - 6), f32(c.y - 46)],
            [f32(c.x + 26), f32(c.y - 34)],
            [f32(c.x + 56), f32(c.y + 4)],
            [f32(c.x + 22), f32(c.y + 22)],
            [f32(c.x - 4), f32(c.y + 24)],
            [f32(c.x + 4), f32(c.y - 20)],
          ],
          opaque(rockShade),
        ),
      );
      objects.add(
        poly(
          [
            [f32(c.x - 24), f32(c.y + 14)],
            [f32(c.x - 22), f32(c.y - 8)],
            [f32(c.x - 12), f32(c.y - 18)],
            [c.x, f32(c.y - 12)],
            [f32(c.x + 2), f32(c.y + 16)],
          ],
          opaque(dark),
        ),
      );
      for (let i = 0; i < 4; ++i)
        objects.add(
          stroke(
            [f32(f32(c.x - 30) + f32(i * 2)), f32(f32(c.y - 2) - f32(i * 6))],
            [f32(f32(c.x - 27) + f32(i * 2)), f32(f32(c.y - 6) - f32(i * 6))],
            f32(1.4),
            opaque([120, 240, 220]),
          ),
        );
      pulse = glow([f32(c.x - 11), f32(c.y + 2)], 12, 12, [120, 240, 220], 120);
      objects.add(pulse);
      break;
    case DungeonKind.Crypt: {
      lights.add(glow(c, 70, 35, [170, 110, 240], 60));
      let n = project(f32(site.origin.x + f32(0.2)), f32(site.origin.y + f32(0.2))),
        e = project(f32(site.origin.x + f32(1.8)), f32(site.origin.y + f32(0.2)));
      let s = project(f32(site.origin.x + f32(1.8)), f32(site.origin.y + f32(1.8))),
        w = project(f32(site.origin.x + f32(0.2)), f32(site.origin.y + f32(1.8)));
      objects.add(poly([w, s, [s.x, f32(s.y + 7)], [w.x, f32(w.y + 7)]], opaque(rockShade)));
      objects.add(poly([s, e, [e.x, f32(e.y + 7)], [s.x, f32(s.y + 7)]], opaque(scale(rockShade, f32(0.7)))));
      objects.add(poly([n, e, s, w], opaque(rock)));
      objects.add(
        poly(
          [
            [f32(c.x - 14), f32(c.y + 2)],
            [f32(c.x + 2), f32(c.y - 6)],
            [f32(c.x + 16), f32(c.y + 1)],
            [c.x, f32(c.y + 9)],
          ],
          opaque(dark),
        ),
      );
      pulse = glow(c, 16, 8, [190, 130, 255], 140);
      objects.add(pulse);
      for (const [x, y, h] of [
        [f32(0.35), f32(0.35), 34],
        [f32(1.65), f32(0.35), 22],
        [f32(0.35), f32(1.65), 26],
        [f32(1.65), f32(1.65), 40],
      ]) {
        let b = project(f32(site.origin.x + x), f32(site.origin.y + y));
        objects.add(
          poly(
            [
              [f32(b.x - 5), b.y],
              [b.x, f32(b.y + f32(2.5))],
              [b.x, f32(f32(b.y - h) + 3)],
              [f32(b.x - 5), f32(b.y - h)],
            ],
            opaque([96, 94, 104]),
          ),
        );
        objects.add(
          poly(
            [
              [b.x, f32(b.y + f32(2.5))],
              [f32(b.x + 5), b.y],
              [f32(b.x + 5), f32(f32(b.y - h) + 6)],
              [b.x, f32(f32(b.y - h) + 3)],
            ],
            opaque([62, 60, 70]),
          ),
        );
      }
      break;
    }
    case DungeonKind.Portal:
      lights.add(glow(c, 80, 40, [190, 110, 255], 80));
      for (let i = 0; i < 6; ++i) {
        let a = f32(f32(i * f32(1.047)) + f32(0.3));
        let b = point(f32(c.x + f32(f32(Math.cos(a)) * 46)), f32(c.y + f32(f32(Math.sin(a)) * 23)));
        objects.add(
          poly(
            [
              [f32(b.x - 4), b.y],
              [f32(b.x + 4), b.y],
              [f32(b.x + 3), f32(b.y - 14)],
              [f32(b.x - 2), f32(b.y - 16)],
            ],
            opaque(i % 2 ? rock : rockShade),
          ),
        );
      }
      objects.add(
        poly(
          [
            [f32(c.x - 20), f32(c.y + 4)],
            [f32(c.x - 13), f32(c.y + 4)],
            [f32(c.x - 13), f32(c.y - 40)],
            [f32(c.x - 20), f32(c.y - 40)],
          ],
          opaque(rock),
        ),
      );
      objects.add(
        poly(
          [
            [f32(c.x + 13), f32(c.y + 4)],
            [f32(c.x + 20), f32(c.y + 4)],
            [f32(c.x + 20), f32(c.y - 40)],
            [f32(c.x + 13), f32(c.y - 40)],
          ],
          opaque(rockShade),
        ),
      );
      objects.add(
        poly(
          [
            [f32(c.x - 24), f32(c.y - 40)],
            [f32(c.x + 24), f32(c.y - 40)],
            [f32(c.x + 22), f32(c.y - 48)],
            [f32(c.x - 22), f32(c.y - 48)],
          ],
          opaque(rock),
        ),
      );
      {
        let swirl = new SceneNode();
        swirl.add(oval([0, 0], 13, 20, [120, 60, 200]));
        swirl.add(oval([1, 1], 9, 15, [170, 110, 250]));
        swirl.add(oval([2, 2], 4, 8, [236, 200, 255]));
        swirl.translate(c.x, f32(c.y - 18));
        pulse = swirl;
        objects.add(swirl);
      }
      break;
    case DungeonKind.Ruin: {
      lights.add(glow(c, 64, 32, [150, 230, 120], 50));
      let b = project(f32(site.origin.x + 1), f32(site.origin.y + f32(1.2)));
      objects.add(
        poly(
          [
            [f32(b.x - 22), f32(b.y - 6)],
            [b.x, f32(b.y + 5)],
            [b.x, f32(b.y - 46)],
            [f32(b.x - 6), f32(b.y - 52)],
            [f32(b.x - 12), f32(b.y - 44)],
            [f32(b.x - 22), f32(b.y - 58)],
          ],
          opaque(rock),
        ),
      );
      objects.add(
        poly(
          [
            [b.x, f32(b.y + 5)],
            [f32(b.x + 22), f32(b.y - 6)],
            [f32(b.x + 22), f32(b.y - 36)],
            [f32(b.x + 14), f32(b.y - 30)],
            [f32(b.x + 8), f32(b.y - 40)],
            [b.x, f32(b.y - 46)],
          ],
          opaque(rockShade),
        ),
      );
      objects.add(
        poly(
          [
            [f32(b.x - 14), f32(b.y - 22)],
            [f32(b.x - 8), f32(b.y - 19)],
            [f32(b.x - 8), f32(b.y - 30)],
            [f32(b.x - 14), f32(b.y - 33)],
          ],
          opaque(dark),
        ),
      );
      for (let i = 0; i < 5; ++i) {
        let r = point(
          f32(f32(f32(c.x + 18) + f32(i * 7)) - f32((i % 2) * 10)),
          f32(f32(c.y + 8) + f32((i % 3) * 4)),
        );
        objects.add(
          poly(
            [
              [f32(r.x - 4), r.y],
              [r.x, f32(r.y - 4)],
              [f32(r.x + 4), r.y],
              [r.x, f32(r.y + 2)],
            ],
            opaque(i % 2 ? rock : rockShade),
          ),
        );
      }
      pulse = glow([f32(b.x - 11), f32(b.y - 26)], 10, 10, [170, 250, 130], 120);
      objects.add(pulse);
      break;
    }
  }
  dungeonBodies.set(
    objects,
    objects.children.filter((paint) => paint !== pulse),
  );
  label(objects, point(c.x, f32(c.y - 66)), site.name, measure);
  return pulse;
}
export function lantern(
  objects: SceneNode,
  lights: SceneNode,
  base: Point,
  arcaneLight: boolean,
): LanternLight {
  let light = arcaneLight ? arcane : warm;
  let flame = point(f32(base.x + 4), f32(base.y - 14));
  const lamp: LanternLight = {
    glow: glow(base, 20, 10, light, 45),
    halo: oval(flame, 4, 4, opaque(light, 70)),
    flame,
  };
  lights.add(lamp.glow);
  objects.add(stroke(base, [base.x, f32(base.y - 17)], f32(1.6), [36, 30, 28]));
  objects.add(
    stroke([base.x, f32(base.y - 17)], [f32(base.x + 4), f32(base.y - 17)], f32(1.2), [36, 30, 28]),
  );
  objects.add(lamp.halo);
  objects.add(oval(flame, f32(1.8), f32(1.8), opaque(light)));
  return lamp;
}
