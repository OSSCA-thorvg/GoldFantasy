// Neck and shoulders under a portrait head, dressed for the calling, in head units (see likeness-hair).
import { Calling } from '../../engine/src/person';
import { type Likeness } from '../../engine/src/likeness';
import { BodyType } from '../../engine/src/person-appearance';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { dusk, glint, paintForm, type Finish } from './form-paint';
import { capsule, oval, paired, pen, shapeOf, type Form } from './outline-form';
import type { Wardrobe } from './calling-garments';

export interface BustDrawing {
  /** Cloaks and capes that hang behind the hair. */
  back: SceneNode;
  front: SceneNode;
}
const rgb = (c: { r: number; g: number; b: number }): Rgb => [c.r, c.g, c.b];
const linen: Rgb = [226, 214, 190],
  fur: Rgb = [214, 202, 178],
  wolf: Rgb = [156, 132, 110],
  steel: Rgb = [136, 144, 152],
  leather: Rgb = [122, 90, 62],
  bronze: Rgb = [186, 132, 74],
  gold: Rgb = [214, 178, 96],
  amber: Rgb = [222, 150, 70],
  glass: Rgb = [92, 138, 168],
  floor = 2.9;

const torso = (width = 1.24): Form => [
  pen(-0.4, 1.02)
    .curve([-0.86, 1.08], [-width + 0.08, 1.3], [-width, 1.78])
    .line(-width - 0.06, floor)
    .line(width + 0.06, floor)
    .line(width, 1.78)
    .curve([width - 0.08, 1.3], [0.86, 1.08], [0.4, 1.02])
    .close(),
];
/** A rounded neckline of the given half-width and depth. */
const scoop = (half: number, depth: number): Form => [
  pen(-half, 0.96)
    .curve(
      [-half * 0.82, 0.98 + depth * 0.7],
      [0, 0.98 + depth],
      [half * 0.82, 0.98 + depth * 0.7],
      [half, 0.96],
    )
    .close(),
];
/** A pelt lying over both shoulders, its lower edge in soft tufts. */
const mantle = (reach: number, drop: number, tufts = 3): Form => [
  pen(-reach, drop)
    .curve(
      [-reach + 0.14, drop - 0.36],
      [-0.62, 0.95],
      [0, 0.99],
      [0.62, 0.95],
      [reach - 0.14, drop - 0.36],
      [reach, drop],
    )
    .lobes(0, drop + 0.14, tufts, 0.1)
    .lobes(-reach, drop, tufts, 0.1)
    .close(),
];
/** A hood pushed back: the roll of cloth that sits under the chin. */
const cowl: Form = [
  pen(-0.74, 1.02)
    .curve([-0.62, 0.84], [0, 0.78], [0.62, 0.84], [0.74, 1.02])
    .curve([0.64, 1.36], [0, 1.54], [-0.64, 1.36], [-0.74, 1.02])
    .close(),
];
const strap = (ax: number, ay: number, bx: number, by: number, half = 0.09): Form => [
  capsule(ax, ay, bx, by, half),
];
function ring(scene: SceneNode, x: number, y: number, size: number, finish: Finish, tone = gold): void {
  paintForm(scene, [oval(x, y, size)], tone, finish);
  scene.add(shapeOf([oval(x, y, size * 0.46)]).fill(...dusk(tone, 0.6)));
  scene.add(shapeOf([oval(x - size * 0.34, y - size * 0.36, size * 0.2)]).fill(...glint(tone, 0.6)));
}
function beads(scene: SceneNode, ax: number, bx: number, y: number, sag: number, count: number): void {
  const tones = [amber, glass, linen, amber, [176, 78, 70] as Rgb, glass, amber];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1),
      x = ax + (bx - ax) * t,
      drop = y + Math.sin(t * Math.PI) * sag;
    scene.add(shapeOf([oval(x, drop, 0.075)]).fill(...dusk(tones[i % tones.length], 0.5)));
    scene.add(shapeOf([oval(x - 0.012, drop - 0.012, 0.062)]).fill(...tones[i % tones.length]));
  }
}
const dots = (scene: SceneNode, points: [number, number][], size: number, tone: Rgb) => {
  for (const [x, y] of points) scene.add(shapeOf([oval(x, y, size)]).fill(...tone));
};

/** Armour worn over the calling's clothes. */
export type BodyArmour = 'leather-armor' | 'mail-armor' | null;
export function drawBust(
  look: Likeness,
  wardrobe: Wardrobe,
  finish: Finish & { detail: boolean },
  armour: BodyArmour = null,
): BustDrawing {
  const back = new SceneNode(),
    front = new SceneNode(),
    { calling, cloth, trim } = wardrobe,
    skin = rgb(look.skin),
    throat = dusk(skin, 0.24),
    flat: Finish = { ...finish, rim: 0 },
    add = (form: Form, tone: Rgb, style: Finish = finish) => paintForm(front, form, tone, style);
  add([pen(-0.31, 0.6).line(0.31, 0.6).line(0.37, 1.24).line(-0.37, 1.24).close()], throat, flat);
  const neckline = (band: Rgb, half = 0.36, depth = 0.3) => {
    add(scoop(half + 0.11, depth + 0.13), band, flat);
    add(scoop(half, depth), throat, flat);
  };
  switch (calling) {
    case Calling.Traveller:
      add(torso(1.42), cloth);
      add(cowl, dusk(trim, 0.12));
      ring(front, -0.56, 1.46, 0.13, flat);
      break;
    case Calling.Warrior:
      add(torso(), steel);
      if (finish.detail)
        for (let row = 0; row < 4; row++)
          dots(
            front,
            Array.from(
              { length: 7 },
              (_, i) => [-0.9 + i * 0.3 + (row % 2) * 0.15, 1.72 + row * 0.26] as [number, number],
            ),
            0.045,
            glint(steel, 0.3),
          );
      add(strap(-1.02, 1.3, 0.72, floor, 0.1), leather, flat);
      neckline(cloth, 0.34, 0.24);
      add(mantle(1.4, 1.5), wolf);
      break;
    case Calling.Ranger:
      add(torso(), cloth);
      add(strap(0.98, 1.24, -0.6, floor, 0.085), leather, flat);
      add(
        [
          pen(-0.46, 0.98)
            .curve([-1, 1.08], [-1.34, 1.42], [-1.4, 1.86])
            .curve([-0.72, 1.98], [0, 2.4])
            .curve([0.72, 1.98], [1.4, 1.86])
            .curve([1.34, 1.42], [1, 1.08], [0.46, 0.98])
            .close(),
        ],
        dusk(cloth, 0.2),
      );
      add(cowl, cloth);
      ring(front, 0, 1.62, 0.13, flat);
      break;
    case Calling.Mage:
      add(torso(1.4), cloth);
      neckline(dusk(cloth, 0.3), 0.34, 0.24);
      add(mantle(1.06, 1.36, 2), fur);
      beads(front, -0.62, 0.62, 1.6, 0.34, 9);
      break;
    case Calling.Cleric:
      add(torso(), cloth);
      for (const side of [-1, 1]) {
        add(
          [
            pen(side * 0.42, 1.03)
              .line(side * 0.74, 1.08)
              .line(side * 0.82, floor)
              .line(side * 0.46, floor)
              .close(),
          ],
          trim,
          flat,
        );
        if (finish.detail)
          dots(
            front,
            [1.5, 1.86, 2.22].map((y) => [side * 0.62, y] as [number, number]),
            0.05,
            dusk(trim, 0.45),
          );
      }
      neckline(dusk(cloth, 0.16), 0.36, 0.26);
      // A torc: an open neck ring with a knob at each end.
      front.add(
        new ShapeNode()
          .moveTo(-0.3, 1.0)
          .cubicTo(-0.34, 1.34, 0.34, 1.34, 0.3, 1.0)
          .strokeFill(...gold)
          .strokeWidth(0.075)
          .strokeCap('round'),
      );
      dots(
        front,
        [
          [-0.1, 1.27],
          [0.1, 1.27],
        ],
        0.062,
        glint(gold, 0.3),
      );
      break;
    case Calling.Bard:
      add(torso(), cloth);
      neckline(trim, 0.36, 0.3);
      add(
        [
          pen(0.44, 1)
            .curve([0.1, 1.5], [-0.5, 2.2], [-0.9, floor])
            .line(-1.56, floor)
            .curve([-1.5, 2], [-1.36, 1.4], [-1, 1.08], [-0.46, 0.99])
            .curve([0, 0.92], [0.44, 1])
            .close(),
        ],
        dusk(cloth, 0.32),
      );
      ring(front, 0.4, 1.12, 0.16, flat);
      break;
    default:
      if (look.body === BodyType.Female) {
        // The apron dress: straps pinned over a linen shift by a pair of oval brooches.
        add(torso(), linen);
        neckline(dusk(linen, 0.22), 0.34, 0.24);
        add(
          [
            pen(-1.24, 1.84)
              .curve([-0.6, 1.66], [0, 1.62], [0.6, 1.66], [1.24, 1.84])
              .line(1.3, floor)
              .line(-1.3, floor)
              .close(),
            ...paired([capsule(0.6, 1.1, 0.56, 1.72, 0.1)]),
          ],
          cloth,
        );
        for (const side of [-1, 1]) {
          paintForm(front, [oval(side * 0.56, 1.7, 0.13, 0.17)], bronze, flat);
          front.add(shapeOf([oval(side * 0.56 - 0.04, 1.65, 0.04, 0.06)]).fill(...glint(bronze, 0.5)));
        }
        beads(front, -0.5, 0.5, 1.82, 0.2, 7);
      } else {
        add(torso(), cloth);
        neckline(trim);
        add(
          [pen(-0.05, 1.3).line(0.05, 1.3).line(0.04, 1.66).line(-0.04, 1.66).close()],
          dusk(cloth, 0.4),
          flat,
        );
        if (finish.detail)
          dots(
            front,
            [-0.36, -0.2, 0.2, 0.36].map((x) => [x, 1.15 + (0.4 - Math.abs(x)) * 0.62] as [number, number]),
            0.035,
            dusk(trim, 0.5),
          );
      }
  }
  if (armour) {
    // Equipped armour shows as a jerkin over the chest, under the head and its hair.
    const hide = armour === 'mail-armor' ? steel : leather;
    add(
      [
        pen(-0.98, 1.56)
          .curve([-0.5, 1.4], [0, 1.52], [0.5, 1.4], [0.98, 1.56])
          .line(1.04, floor)
          .line(-1.04, floor)
          .close(),
      ],
      hide,
    );
    for (const side of [-1, 1]) add(strap(side * 0.72, 1.12, side * 0.8, 1.6, 0.11), hide, flat);
    if (finish.detail)
      for (let row = 0; row < 3; row++)
        dots(
          front,
          Array.from(
            { length: 5 },
            (_, i) => [-0.6 + i * 0.3 + (row % 2) * 0.15, 1.9 + row * 0.26] as [number, number],
          ),
          0.04,
          armour === 'mail-armor' ? glint(steel, 0.3) : dusk(leather, 0.35),
        );
  }
  if (look.leaf) {
    // Made from an ash and an elm: a leaf carved of that wood on a cord.
    for (const side of [-1, 1])
      front.add(
        new ShapeNode()
          .moveTo(side * 0.33, 1.08)
          .lineTo(0, 1.74)
          .strokeFill(...dusk(leather, 0.3))
          .strokeWidth(0.03),
      );
    paintForm(
      front,
      [pen(0, 1.66).curve([0.14, 1.86], [0, 2.14]).curve([-0.14, 1.86], [0, 1.66]).close()],
      [196, 156, 98],
      flat,
    );
    front.add(
      new ShapeNode()
        .moveTo(0, 1.72)
        .lineTo(0, 2.08)
        .strokeFill(...dusk([196, 156, 98], 0.4))
        .strokeWidth(0.025),
    );
  }
  return { back, front };
}
