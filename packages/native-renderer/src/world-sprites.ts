// Compact world silhouettes with articulated work and combat equipment.
import { point, add, sub, mul, lerp, project, type Point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { Person, Calling } from '../../engine/src/person';
import { injuryOf, Injury, Mood } from '../../engine/src/person-look';
import { BodyType } from '../../engine/src/person-appearance';
import { likenessOf } from '../../engine/src/character-cast';
import { HairCut, type Likeness } from '../../engine/src/likeness';
import { Agent, AgentKind } from '../../engine/src/traffic';
import { DungeonKind, type Dungeon } from '../../engine/src/world-types';
import { SceneNode, ShapeNode, TextNode, PaintNode, type Matrix, type Rgb } from './paint';
import { poly, oval, stroke, opaque, scale, glow } from './sprite-primitives';
import { ArmRig, connectArm, poseArm } from './person-arm';
import { monsterBody } from './monster-figures';
import { humanoidClips } from './humanoid-rig';
import { clipStretch, clipTurn } from './rig-clip';
import { MonsterRank } from '../../engine/src/combat-events';
import { createEquipment, type HeldTool, type ToolMaterial } from './person-equipment';
import { equippedItem } from '../../engine/src/equipment';
import { wearableBack, wearableBody } from './person-wearables';
import { createWorkProps } from './work-motion';
import {
  garmentBack,
  garmentFront,
  garmentOf,
  heldLyre,
  wardrobeOf,
  type Wardrobe,
} from './calling-garments';
import { dusk } from './form-paint';
import { drawHead, expressionOf, streetFinish, type FaceRig } from './likeness-head';
import { oval as ring, pen, shapeOf } from './outline-form';
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
  /** The bard's lyre held in front to play; hidden while it hangs on the back. */
  luteHeld: PaintNode | null = null;
  /** Cloak hanging from the shoulders at `capeTop`; it trails the walk. */
  /** Eyes and brows, re-posed as the mood changes and the eyes blink. */
  face: FaceRig | null = null;
  look: Likeness | null = null;
  /** Hair behind the body and the head in front of it, seated on `neck` (see seatHead). */
  head: PaintNode[] = [];
  neck = point();
  /** How far the head bows toward the way the figure faces, in radians; set by each motion. */
  nod = 0;
  cape: PaintNode | null = null;
  capeTop = 0;
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
  shovel: PaintNode | null = null;
  sickle: PaintNode | null = null;
  knife: PaintNode | null = null;
  spear: PaintNode | null = null;
  /** The wood, stone and iron heads of each tool that comes in more than one material. */
  toolHeads: Partial<Record<HeldTool, Record<ToolMaterial, SceneNode>>> = {};
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
// The head is drawn two units wide and set on the shoulders at this size: a storybook proportion.
const headSize = f32(4.3),
  headLift = f32(4);
/**
 * Keeps the head one rigid shape on the neck however the body leans, crouches or flinches:
 * the body may shear and squash, a face may not.
 */
export function seatHead(parts: PersonParts): void {
  const b = parts.body?.matrix;
  if (!b || !parts.head.length) return;
  const n = parts.neck,
    nx = b[0] * n.x + b[1] * n.y + b[2],
    ny = b[3] * n.x + b[4] * n.y + b[5],
    // The head follows most of a lean and all of a fall, and adds its own nod.
    lean = Math.atan2(-b[1], b[4]),
    turn = lean * (Math.abs(lean) > 0.5 ? 1 : 0.7) + parts.nod,
    c = Math.cos(turn),
    s = Math.sin(turn),
    w = [headSize * c, -headSize * s, nx + s * headLift, headSize * s, headSize * c, ny - c * headLift],
    det = b[0] * b[4] - b[1] * b[3] || 1,
    ia = b[4] / det,
    ib = -b[1] / det,
    ic = -b[3] / det,
    id = b[0] / det,
    tx = w[2] - b[2],
    ty = w[5] - b[5],
    seat: Matrix = [
      f32(ia * w[0] + ib * w[3]),
      f32(ia * w[1] + ib * w[4]),
      f32(ia * tx + ib * ty),
      f32(ic * w[0] + id * w[3]),
      f32(ic * w[1] + id * w[4]),
      f32(ic * tx + id * ty),
      0,
      0,
      1,
    ];
  for (const part of parts.head) part.transform(seat);
}
/** Lays the figure on its back (1) or leaves it standing (0), turning about the feet. */
export function layDown(parts: PersonParts, amount: number): void {
  const turn = -1.5 * amount,
    c = f32(Math.cos(turn)),
    s = f32(Math.sin(turn));
  parts.body?.transform([c, -s, 0, s, c, f32(-2.8 * amount), 0, 0, 1]);
  // Arms fall open beside the body.
  poseArm(parts.arms[0], f32(-0.5 * amount), 0, 0);
  poseArm(parts.arms[1], f32(0.6 * amount), 0, 0);
  for (const foot of parts.feet) foot?.translate(0, 0);
  parts.shadow?.transform([f32(1 + 1.1 * amount), 0, f32(-7.5 * amount), 0, 1, 0, 0, 0, 1]);
  parts.nod = 0;
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
// A person's walking figure: stepping legs or a sweeping hem, a torso lit on the left,
// sleeves and hands, then the calling's belt, collar and trimmings.
function personFigure(
  sprite: SceneNode,
  look: Likeness,
  wardrobe: Wardrobe,
  height: number,
  width: number,
  parts: PersonParts,
): void {
  const garment = garmentOf(look.body, wardrobe),
    skinTone = color(look.skin),
    calling = wardrobe.calling,
    robe = garment.body,
    boot: Rgb = [58, 44, 36];
  let foot = f32(width * f32(0.55));
  for (let i = 0; i < 2; ++i) {
    const left = i ? f32(foot - f32(1.8)) : -foot,
      right = f32(left + f32(1.8)),
      shade = i ? f32(0.78) : 1,
      leg = new SceneNode();
    if (garment.legs)
      leg.add(
        poly(
          [
            [f32(left + f32(0.15)), -f32(1.5)],
            [f32(right - f32(0.15)), -f32(1.5)],
            [f32(right - f32(0.15)), f32(-garment.hem - 1)],
            [f32(left + f32(0.15)), f32(-garment.hem - 1)],
          ],
          opaque(i ? dusk(garment.legs, f32(0.3)) : garment.legs),
        ),
      );
    // Cloth strips wound up the shin.
    if (garment.legs && calling != Calling.Warrior && calling != Calling.Bard)
      for (const y of [-f32(2.5), -f32(3.4)])
        leg.add(
          stroke(
            [f32(left + f32(0.2)), y],
            [f32(right - f32(0.2)), f32(y - f32(0.5))],
            f32(0.32),
            [186, 170, 138],
          ),
        );
    leg.add(
      poly(
        [
          [left, 0],
          [f32(right + f32(0.35)), 0],
          [f32(right + f32(0.35)), -f32(1)],
          [right, -f32(1.9)],
          [left, -f32(1.9)],
        ],
        opaque(scale(boot, shade)),
      ),
    );
    parts.feet[i] = leg;
    sprite.add(leg);
  }
  let shoulderJoins = new SceneNode();
  sprite.add(shoulderJoins);
  let body = bodyProportions(look.body);
  let hem = f32(-garment.hem),
    top = -height,
    shoulder = f32(f32(width * f32(0.55)) * body.shoulders);
  let waist = f32(-height * f32(0.42)),
    hips = f32(f32(width * body.hips) * garment.hips);
  let waistWidth = f32(
    f32(hips - f32(f32(f32(hips - shoulder) * f32(waist - hem)) / f32(top - hem))) * body.waist,
  );
  // One soft silhouette: rounded shoulders and a hem that swells like hanging cloth.
  const round = f32(0.9),
    swell = f32(0.75),
    torso = (from: number) => {
      const shape = new ShapeNode();
      shape.moveTo(from, f32(hem + (from < 0 ? 0 : swell * f32(0.75))));
      if (from < 0)
        shape.cubicTo(
          f32(-hips * f32(0.5)),
          f32(hem + swell),
          f32(hips * f32(0.5)),
          f32(hem + swell),
          hips,
          hem,
        );
      else
        shape.cubicTo(
          f32(hips * f32(0.3)),
          f32(hem + swell * f32(0.75)),
          f32(hips * f32(0.7)),
          f32(hem + swell * f32(0.4)),
          hips,
          hem,
        );
      shape
        .lineTo(waistWidth, waist)
        .lineTo(shoulder, f32(top + round))
        .cubicTo(shoulder, f32(top + f32(0.2)), f32(shoulder - f32(0.3)), top, f32(shoulder - round), top);
      if (from < 0)
        shape
          .lineTo(f32(-shoulder + round), top)
          .cubicTo(
            f32(-shoulder + f32(0.3)),
            top,
            -shoulder,
            f32(top + f32(0.2)),
            -shoulder,
            f32(top + round),
          )
          .lineTo(-waistWidth, waist);
      else shape.lineTo(0, top);
      return shape.close();
    };
  // Only the edge away from the light falls into dusk, as on the head.
  // The lit face is the torso itself drawn a little narrower from its left side: no clip needed.
  const lit = torso(-hips).fill(...opaque(robe)),
    hold = -Math.min(shoulder, waistWidth);
  lit.transform([f32(0.86), 0, f32(hold * f32(0.14)), 0, f32(0.96), f32(top * f32(0.04)), 0, 0, 1]);
  sprite.add(torso(-hips).fill(...opaque(dusk(robe))));
  sprite.add(lit);
  garmentFront(sprite, look.body, wardrobe, height, width, hem);
  const halfAt = (y: number) => {
    return y < waist
      ? f32(waistWidth + f32(f32(f32(shoulder - waistWidth) * f32(y - waist)) / f32(top - waist)))
      : f32(waistWidth + f32(f32(f32(hips - waistWidth) * f32(y - waist)) / f32(hem - waist)));
  };
  if (garment.belt) {
    sprite.add(
      poly(
        [
          [-halfAt(waist), waist],
          [halfAt(waist), waist],
          [halfAt(f32(waist - 1)), f32(waist - 1)],
          [-halfAt(f32(waist - 1)), f32(waist - 1)],
        ],
        opaque(garment.belt),
      ),
    );
    // A square buckle, and for those who work or wander, a pouch on the hip.
    sprite.add(
      poly(
        [
          [f32(0.1), f32(waist + f32(0.2))],
          [f32(1.4), f32(waist + f32(0.2))],
          [f32(1.4), f32(waist - f32(1.2))],
          [f32(0.1), f32(waist - f32(1.2))],
        ],
        [214, 178, 96],
      ),
    );
    sprite.add(
      poly(
        [
          [f32(0.45), f32(waist - f32(0.15))],
          [f32(1.05), f32(waist - f32(0.15))],
          [f32(1.05), f32(waist - f32(0.85))],
          [f32(0.45), f32(waist - f32(0.85))],
        ],
        opaque(garment.belt),
      ),
    );
    if (calling == Calling.Settler || calling == Calling.Traveller || calling == Calling.Ranger) {
      const x = -halfAt(waist);
      sprite.add(
        poly(
          [
            [f32(x + f32(0.3)), f32(waist - f32(0.2))],
            [f32(x + f32(2.1)), f32(waist - f32(0.2))],
            [f32(x + f32(2)), f32(waist + f32(1.7))],
            [f32(x + f32(0.5)), f32(waist + f32(1.7))],
          ],
          [128, 94, 62],
        ),
      );
      sprite.add(
        poly(
          [
            [f32(x + f32(0.3)), f32(waist - f32(0.2))],
            [f32(x + f32(2.1)), f32(waist - f32(0.2))],
            [f32(x + f32(2.05)), f32(waist + f32(0.6))],
            [f32(x + f32(0.4)), f32(waist + f32(0.6))],
          ],
          [158, 120, 78],
        ),
      );
    }
  }
  // Sleeves and hands, each arm its own part so it can swing.
  for (let i = 0; i < 2; ++i) {
    let side = i ? 1 : -1;
    let sleeve = side < 0 ? scale(garment.sleeve, f32(0.92)) : dusk(garment.sleeve, f32(0.42));
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
    connectArm(arm, shoulderJoins, sleeve, f32(1.75), f32(0.52));
    let skin = opaque(side < 0 ? skinTone : dusk(skinTone, f32(0.22)));
    arm.hand.add(oval(arm.wrist, f32(1.05), f32(1.1), skin));
    arm.hand.add(
      oval([f32(hand - f32(side * f32(0.6))), f32(arm.wrist.y - f32(0.2))], f32(0.32), f32(0.42), skin),
    );
    arm.forearm!.add(arm.hand);
  }
  if (calling !== Calling.Traveller && calling !== Calling.Ranger)
    sprite.add(
      poly(
        [
          [-f32(1.3), top],
          [f32(1.3), top],
          [0, f32(top + f32(1.7))],
        ],
        opaque(calling === Calling.Warrior ? dusk(robe, f32(0.4)) : wardrobe.trim),
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
function monster(root: SceneNode, lair: DungeonKind, id: number, rank: MonsterRank): void {
  const body = new SceneNode(),
    // The figure is a rig posed by shared clips (monster-figures.ts); `body` stays free for recoil and the like.
    shadow = monsterBody(body, lair, id, rank);
  root.add(shadow).add(body);
  monsterRigs.set(root, { body, shadow, last: point(-1, -1), facing: 1 });
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
export function agentSprite(agent: Agent, lair: DungeonKind, rank = MonsterRank.Grunt): SceneNode {
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
      monster(sprite, lair, agent.id, rank);
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
// World walking bodies retain their gameplay rig and their own compact head.
function figureOf(person: Person, parts: PersonParts): SceneNode {
  const root = new SceneNode(),
    sprite = new SceneNode();
  parts.body = sprite;
  let look = likenessOf(person);
  let broad = f32(f32(4.2) * (person.customLook?.bodyWidth ?? 1)),
    height = figureHeight(person);
  parts.shadow = oval([0, 0], broad + 1.3, (broad + 1.3) * 0.42, [0, 0, 0, 110]);
  root.add(parts.shadow).add(sprite);
  // The portrait's own head, seated on the neck: it never moves apart from the body.
  const gear = equippedItem(person, 'head')?.id,
    head = drawHead(
      look,
      streetFinish,
      expressionOf(look, Mood.Content),
      gear === 'cap' || gear === 'helmet' ? gear : null,
    ),
    loads = new SceneNode();
  if (person.woundDays > 0) {
    // A lasting wound keeps its linen binding round the brow.
    head.front.add(
      shapeOf([
        pen(-1.04, -0.56)
          .curve([0, -0.4], [1.02, -0.12])
          .line(1.03, 0.08)
          .curve([0, -0.18], [-1.05, -0.36])
          .close(),
        ring(0.92, -0.02, 0.14, 0.11),
      ]).fill(228, 218, 196),
    );
  }
  parts.head = [head.back, head.front];
  parts.neck = point(0, -height);
  parts.face = head.rig;
  parts.look = look;
  seatHead(parts);
  const wardrobe = wardrobeOf(person);
  const worn = garmentBack(sprite, wardrobe, height, broad);
  parts.lute = worn.lute;
  parts.cape = worn.cape;
  parts.capeTop = -height;
  sprite.add(head.back);
  // Loads ride on the back: behind the torso and the head, never across the face.
  sprite.add(loads.translate(-f32(0.9), f32(3.2)));
  wearableBack(sprite, person, height, broad);
  personFigure(sprite, look, wardrobe, height, broad, parts);
  if (injuryOf(person) == Injury.Bandaged) bandagedWrist(parts.arms[person.look % 2]);
  parts.arms[0].free = equippedItem(person, 'offhand')?.id !== 'shield';
  parts.arms[1].free = true;
  // Equipment appears only when a real inventory item occupies the slot.
  if (equippedItem(person, 'offhand')?.id === 'shield') {
    // A round northern shield in the calling's colours, quartered around an iron boss.
    const centre = point(-f32(4.4), -f32(7.2));
    sprite.add(oval(centre, f32(3.5), f32(3.9), opaque([92, 70, 52])));
    sprite.add(oval(centre, f32(3), f32(3.4), opaque(wardrobe.cloth)));
    const quarter = oval(centre, f32(3), f32(3.4), opaque(dusk(wardrobe.trim, f32(0.2))));
    quarter.clip(
      poly(
        [
          [centre.x, centre.y],
          [f32(centre.x + 4), centre.y],
          [f32(centre.x + 4), f32(centre.y - 5)],
          [centre.x, f32(centre.y - 5)],
        ],
        [0, 0, 0],
      ),
    );
    sprite.add(quarter);
    sprite.add(oval(centre, f32(0.95), f32(1.05), opaque([176, 182, 188])));
  }

  wearableBody(sprite, person, parts, height, broad);
  if (parts.lute) sprite.add((parts.luteHeld = heldLyre(height)));
  sprite.add(head.front);
  for (const arm of parts.arms) sprite.add(arm.lower!);
  createEquipment(parts, person.calling);
  createWorkProps(root, parts);
  // Loads carried on the back.
  let sack = new SceneNode();
  sack.add(oval([-f32(4.5), -11], f32(3.6), f32(4.2), [176, 150, 96]));
  sack.opacity(0);
  loads.add(sack);
  parts.sack = sack;
  let logs = new SceneNode();
  for (let i = 0; i < 3; ++i) {
    let end = point(f32(-6 + f32(i * f32(2.4))), f32(-13 + f32((i % 2) * 2)));
    logs.add(stroke(add(end, point(-f32(3.5), -3)), end, f32(3.5), [90, 63, 40]));
    logs.add(oval(end, f32(1.8), f32(1.8), [164, 124, 78]));
  }
  logs.opacity(0);
  loads.add(logs);
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
  loads.add(stones);
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
  loads.add(planks).add(cutStone);
  parts.planks = planks;
  parts.cutStone = cutStone;
  let mark = oval([0, -27], f32(2.4), f32(2.4), [230, 80, 64, 255]);
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
  recovery.translate(0, -5);
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
  affiliation.translate(0, -5);
  root.add(affiliation);
  parts.affiliation = affiliation;
  return root;
}
export function personSprite(person: Person, parts: PersonParts): SceneNode {
  Object.assign(parts, new PersonParts());
  return figureOf(person, parts);
}
/** How far above the head's centre a cut rises, in head units. */
const crownRise = (cut: HairCut): number =>
  cut === HairCut.HighBun || cut === HairCut.Topknot
    ? f32(1.75)
    : cut === HairCut.SpikyCrop || cut === HairCut.WildTuft || cut === HairCut.TwinBuns
      ? f32(1.5)
      : cut === HairCut.Bald
        ? 1
        : f32(1.25);
export function personSpeechAnchor(person: Person): Point {
  const rise = crownRise(likenessOf(person).cut);
  return point(0, f32(f32(f32(-figureHeight(person) - headLift) - f32(rise * headSize)) - f32(1.5)));
}
// Residents' legs are short stubs under the hem: the walk clip's leg angles only say where each foot goes.
const thigh = f32(2.2),
  shin = f32(2.2);
export function stridePose(parts: PersonParts, stride: number, walking: boolean): void {
  parts.nod = 0;
  if (!walking) {
    for (const arm of parts.arms) poseArm(arm);
    for (const foot of parts.feet) setTransform(foot, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    return;
  }
  // The shared walk: each arm swings against the leg on its side, shortening toward the eye as it
  // reaches; a carried tool keeps its angle. `stride` runs a full cycle every two pi.
  // A stride of zero finds the far foot in mid-air, a quarter of the clip in.
  const clip = humanoidClips.walk,
    frame = (stride / (2 * Math.PI) + 0.25) * clip.frames,
    turn = (bone: string) => clipTurn(clip, bone, frame),
    lean = turn('spine') + turn('chest'),
    reach: number[] = [],
    rise: number[] = [];
  (['l', 'r'] as const).forEach((side, i) => {
    const upper = turn(`arm.${side}.1`),
      elbow = turn(`arm.${side}.2`),
      wrist = turn(`hand.${side}`);
    poseArm(
      parts.arms[i],
      upper,
      elbow,
      // The clip aims the tool hand for a body that turns; a resident's body leans without turning its arms.
      side === 'r' ? wrist + lean : wrist,
      0,
      clipStretch(clip, `arm.${side}.1`, frame),
    );
    const hip = turn(`leg.${side}.1`),
      knee = hip + turn(`leg.${side}.2`);
    reach[i] = -(thigh * Math.sin(hip) + shin * Math.sin(knee));
    rise[i] = thigh * (Math.cos(hip) - 1) + shin * (Math.cos(knee) - 1);
  });
  // The lower foot is the one on the ground.
  const ground = Math.max(rise[0], rise[1]);
  parts.feet.forEach((foot, i) =>
    setTransform(foot, [1, 0, f32(reach[i] * 0.75), 0, 1, f32(rise[i] - ground), 0, 0, 1]),
  );
}
/** Walking rise: lowest as a foot lands, smooth through the passing step. */
export const strideBob = (stride: number): number =>
  f32(-f32(0.22) * f32(1 - f32(Math.cos(f32(2 * stride)))));
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
  // The way home borrows the rift portal's look.
  switch (site.kind === DungeonKind.Return ? DungeonKind.Portal : site.kind) {
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
