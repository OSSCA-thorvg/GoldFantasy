// Literal authored silhouettes and rigs from game/world_sprites.cpp.
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
  ring: PaintNode | null = null;
  alert: PaintNode | null = null;
  hammer: PaintNode | null = null;
  axe: PaintNode | null = null;
  pickaxe: PaintNode | null = null;
  sack: PaintNode | null = null;
  logs: PaintNode | null = null;
  stone: PaintNode | null = null;
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
  shadow(sprite, f32(width + f32(1.3)));
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
function monster(sprite: SceneNode, lair: DungeonKind): void {
  if (lair == DungeonKind.GiantHall) {
    sprite.add(stoneGiantSprite());
    return;
  }
  let body: Rgb = [58, 48, 66],
    eyes: Rgb = [255, 84, 64];
  switch (lair) {
    case DungeonKind.Crypt:
      body = [150, 146, 132];
      eyes = [120, 200, 255];
      break;
    case DungeonKind.Portal:
      body = [72, 42, 96];
      eyes = [240, 150, 255];
      break;
    case DungeonKind.Ruin:
      body = [62, 82, 52];
      eyes = [250, 220, 90];
      break;
    case DungeonKind.Cave:
      break;
  }
  sprite.add(oval([0, 0], 9, f32(3.4), [0, 0, 0, 120]));
  sprite.add(oval([0, -6], 15, 8, opaque(eyes, 30)));
  if (lair == DungeonKind.Cave) {
    // Shadow wolf on four legs.
    for (const x of [-6, -3, 3, 6]) sprite.add(stroke([x, 0], [x, -5], f32(1.6), opaque(body)));
    sprite.add(
      poly(
        [
          [-9, -6],
          [-4, -10],
          [5, -10],
          [8, -6],
          [4, -4],
          [-7, -4],
        ],
        opaque(body),
      ),
    );
    sprite.add(
      poly(
        [
          [6, -9],
          [12, -11],
          [13, -7],
          [8, -6],
        ],
        opaque(body),
      ),
    );
    sprite.add(
      poly(
        [
          [8, -10],
          [9, -14],
          [11, -f32(10.5)],
        ],
        opaque(body),
      ),
    );
    sprite.add(oval([11, -9], 3, 3, opaque(eyes, 90)));
    sprite.add(oval([11, -9], f32(1.2), f32(1.2), opaque(eyes)));
  } else {
    // Hunched biped.
    sprite.add(stroke([-2, 0], [-2, -5], f32(1.8), opaque(body)));
    sprite.add(stroke([2, 0], [2, -5], f32(1.8), opaque(body)));
    sprite.add(
      poly(
        [
          [-5, -5],
          [5, -5],
          [4, -13],
          [-3, -14],
        ],
        opaque(body),
      ),
    );
    sprite.add(oval([2, -16], f32(3.6), f32(3.2), opaque(body)));
    if (lair == DungeonKind.Portal) {
      sprite.add(
        poly(
          [
            [-3, -12],
            [-11, -18],
            [-8, -10],
          ],
          opaque(scale(body, f32(0.7))),
        ),
      );
    }
    sprite.add(oval([f32(2.3), -f32(16.5)], 4, 3, opaque(eyes, 80)));
    sprite.add(oval([1, -f32(16.5)], f32(1.1), f32(1.1), opaque(eyes)));
    sprite.add(oval([f32(3.6), -f32(16.5)], f32(1.1), f32(1.1), opaque(eyes)));
  }
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
  let sprite = new SceneNode();
  let selection = oval([0, 0], 9, 4, [0, 0, 0, 0]);
  selection.strokeWidth(f32(1.6));
  selection.strokeFill(240, 210, 120, 230);
  selection.opacity(0);
  sprite.add(selection);
  parts.ring = selection;
  let look = appearanceOf(person);
  let broad = f32(f32(4.2) * (person.customLook?.bodyWidth ?? 1)),
    height = figureHeight(person);
  let steel: Rgb = [150, 154, 166],
    leather: Rgb = [92, 68, 48];
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
  personFigure(sprite, look, color(look.cloth), height, broad, parts);
  if (injuryOf(person) == Injury.Bandaged) bandagedWrist(parts.arms[person.look % 2]);
  parts.arms[0].free = person.calling != Calling.Warrior && person.calling != Calling.Cleric;
  parts.arms[1].free = person.calling == Calling.Settler || person.calling == Calling.Cleric;
  switch (person.calling) {
    case Calling.Settler:
      break;
    case Calling.Traveller:
      sprite.add(stroke([5, 0], [5, -18], f32(1.2), opaque(wood)));
      break; // Walking stick.
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
      sprite.add(stroke([f32(4.5), -4], [7, -19], f32(1.6), [210, 214, 222])); // Sword.
      sprite.add(stroke([3, -8], [f32(6.5), -9], f32(1.4), opaque(leather)));
      break;
    case Calling.Ranger: {
      let bow = new ShapeNode();
      bow.moveTo(5, -2);
      bow.cubicTo(10, -8, 10, -14, 5, -20);
      bow.strokeWidth(f32(1.3));
      bow.strokeFill(...leather);
      sprite.add(bow);
      sprite.add(stroke([5, -2], [5, -20], f32(0.6), [210, 200, 180]));
      break;
    }
    case Calling.Mage:
      sprite.add(stroke([5, 0], [5, -21], f32(1.2), opaque(wood)));
      sprite.add(oval([5, -22], f32(3.6), f32(3.6), opaque([196, 146, 250], 90)));
      sprite.add(oval([5, -22], f32(1.6), f32(1.6), opaque([230, 200, 255])));
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
      sprite.add(stroke([-6, -6], [-6, -15], f32(1.4), opaque(wood))); // Mace.
      sprite.add(oval([-6, -16], f32(2.4), f32(2.4), opaque(steel)));
      break;
    case Calling.Bard: {
      // A lute held by its pear-shaped bowl, the pegbox bent back at the top of the neck.
      let spruce: Rgb = [186, 124, 66],
        walnut: Rgb = [104, 68, 40];
      sprite.add(stroke([f32(5.7), -f32(6.6)], [6, -f32(14.2)], f32(1.1), opaque(walnut)));
      sprite.add(stroke([6, -f32(14.2)], [f32(7.4), -f32(15.4)], f32(1.2), opaque(scale(walnut, f32(0.8)))));
      sprite.add(oval([f32(5.8), -f32(3.4)], f32(2.5), f32(2.6), opaque(spruce)));
      sprite.add(oval([f32(5.7), -f32(5.5)], f32(1.7), f32(1.6), opaque(spruce)));
      sprite.add(oval([f32(6.6), -f32(3.3)], f32(1.5), f32(2.2), opaque(scale(spruce, f32(0.8)))));
      sprite.add(oval([f32(5.5), -f32(4.5)], f32(0.7), f32(0.7), opaque(scale(walnut, f32(0.6)))));
      sprite.add(
        stroke([f32(5.75), -f32(2.4)], [f32(5.98), -f32(13.9)], f32(0.25), opaque([232, 220, 188], 200)),
      );
      break;
    }
  }
  streetHead(sprite, look, hair, head);
  for (const arm of parts.arms) sprite.add(arm.forearm!);
  let hammer = new SceneNode();
  hammer.add(stroke([3, -7], [8, -15], f32(1.3), opaque(wood)));
  hammer.add(
    poly(
      [
        [6, -17],
        [10, -14],
        [11, -f32(15.5)],
        [7, -f32(18.5)],
      ],
      [120, 120, 130],
    ),
  );
  hammer.opacity(0);
  sprite.add(hammer);
  parts.hammer = hammer;
  let axe = new SceneNode();
  let wrist = parts.arms[1].wrist;
  axe.add(stroke(wrist, add(wrist, point(6, -8)), f32(1.4), opaque(wood)));
  axe.add(
    poly(
      [
        add(wrist, point(f32(4.8), -9)),
        add(wrist, point(f32(9.5), -7)),
        add(wrist, point(10, -f32(3.7))),
        add(wrist, point(f32(5.8), -6)),
      ],
      opaque(steel),
    ),
  );
  axe.opacity(0);
  parts.arms[1].forearm!.add(axe);
  parts.axe = axe;
  let pickaxe = new SceneNode();
  pickaxe.add(stroke(wrist, add(wrist, point(6, -8)), f32(1.4), opaque(wood)));
  pickaxe.add(
    poly(
      [
        add(wrist, point(1, -9)),
        add(wrist, point(f32(5.5), -11)),
        add(wrist, point(10, -8)),
        add(wrist, point(11, -5)),
        add(wrist, point(7, -8)),
        add(wrist, point(5, -9)),
        add(wrist, point(1, -8)),
      ],
      opaque(steel),
    ),
  );
  pickaxe.opacity(0);
  parts.arms[1].forearm!.add(pickaxe);
  parts.pickaxe = pickaxe;
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
  let mark = oval([0, -22], f32(2.4), f32(2.4), [230, 80, 64, 255]);
  mark.opacity(0);
  sprite.add(mark);
  parts.alert = mark;
  return sprite;
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
