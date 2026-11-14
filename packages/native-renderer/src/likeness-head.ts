// One head design for the portrait and the street figure, in head units (see likeness-hair).
import { BrowCut, EyeCut, JawCut, type Likeness } from '../../engine/src/likeness';
import { Whiskers } from '../../engine/src/person-appearance';
import { Mood } from '../../engine/src/person-look';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { dusk, glint, paintForm, type Finish } from './form-paint';
import { mix } from './vector-paint';
import { hairForms } from './likeness-hair';
import { capsule, moved, oval, paired, pen, shapeOf, type Form } from './outline-form';

export interface HeadFinish extends Finish {
  /** Portrait-only refinements: cast shadows, shine, freckles, strands. */
  detail: boolean;
  /** How far the features sit toward +x, turning the face a little that way. */
  turn: number;
}
/** A leather cap or an iron helm worn over the hair. */
export type Headgear = 'cap' | 'helmet' | null;
export const portraitFinish: HeadFinish = { ink: 0, rim: 0.075, detail: true, turn: 0 };
export const streetFinish: HeadFinish = { ink: 0, rim: 0.1, detail: false, turn: 0.15 };

export interface Expression {
  /** 1 open, 0 shut. */
  lids: number;
  /** Positive draws the inner brow down (stern), negative lifts it (worried). */
  brow: number;
  /** Whether brows show even on a face that has none at rest. */
  browShown: boolean;
}
export interface FaceRig {
  eyes: SceneNode;
  brows: ShapeNode[];
  /** Last pose drawn, so an unchanged face re-uploads nothing. */
  posed: string;
  turn: number;
  browTone: Rgb;
  cut: BrowCut;
}
export interface HeadDrawing {
  back: SceneNode;
  front: SceneNode;
  rig: FaceRig;
}
const rgb = (c: { r: number; g: number; b: number }): Rgb => [c.r, c.g, c.b];
const eyeInk: Rgb = [30, 27, 32],
  gold: Rgb = [214, 178, 96],
  woad: Rgb = [78, 108, 150],
  eyeY = 0.14,
  eyeX = 0.4;

export const chinOf = (jaw: JawCut): number => [0.9, 0.88, 0.92, 0.94][jaw] ?? 0.9;
/** The skull: a soft bean, widest just below the eyes. */
export function headForm(jaw: JawCut): Form {
  const cheek = [0.52, 0.58, 0.46, 0.5][jaw] ?? 0.52,
    corner = [0.66, 0.7, 0.76, 0.56][jaw] ?? 0.66,
    chin = chinOf(jaw);
  return [
    pen(0, -0.94)
      .cubic(0.56, -0.94, 1, -0.56, 1, 0.02)
      .cubic(1, cheek, corner, chin, 0, chin)
      .cubic(-corner, chin, -1, cheek, -1, 0.02)
      .cubic(-1, -0.56, -0.56, -0.94, 0, -0.94)
      .close(),
  ];
}

/** The face a mood puts on a resident, starting from the look they were cast with. */
export function expressionOf(look: Likeness, mood: Mood): Expression {
  // Faces have no mouth or nose: a mood shows in the eyes and brows alone.
  const stern = look.brows === BrowCut.Stern ? 0.5 : look.brows === BrowCut.Heavy ? 0.2 : 0,
    plain: Expression = { lids: 1, brow: stern, browShown: false };
  switch (mood) {
    case Mood.Cheerful:
      return plain;
    case Mood.Tired:
      return { ...plain, lids: 0.62 };
    case Mood.Exhausted:
      return { lids: 0.4, brow: -0.5, browShown: true };
    case Mood.Hungry:
      return { lids: 1, brow: -0.6, browShown: true };
    case Mood.Stressed:
      return { lids: 1, brow: -0.8, browShown: true };
    case Mood.Hurt:
      return { lids: 0.3, brow: -0.9, browShown: true };
    case Mood.Asleep:
      return { lids: 0, brow: 0, browShown: false };
    case Mood.Fierce:
      return { lids: 0.85, brow: 1, browShown: true };
    default:
      return plain;
  }
}
/** One eye, solid dark with no white in it, drawn round its own centre; `side` is -1 for the left, so lashes flick outward. */
function drawEye(eyes: SceneNode, look: Likeness, side: number, x: number): void {
  const y = eyeY,
    ink = (form: Form) => eyes.add(shapeOf(form).fill(...eyeInk)),
    line = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number, width: number) =>
      eyes.add(
        new ShapeNode()
          .moveTo(x + ax, y + ay)
          .cubicTo(x + cx, y + cy, x + cx, y + cy, x + bx, y + by)
          .strokeFill(...eyeInk)
          .strokeWidth(width)
          .strokeCap('round'),
      );
  switch (look.eyes) {
    case EyeCut.Round:
      ink([oval(x, y, 0.112, 0.112)]);
      break;
    case EyeCut.Low:
      ink([
        pen(x - 0.125, y - 0.035)
          .line(x + 0.125, y - 0.035)
          .curve([x + 0.1, y + 0.07], [x, y + 0.105], [x - 0.1, y + 0.07], [x - 0.125, y - 0.035])
          .close(),
      ]);
      break;
    case EyeCut.Wide:
      ink([oval(x, y, 0.118, 0.122)]);
      line(side * 0.09, -0.08, side * 0.14, -0.12, side * 0.17, -0.15, 0.03);
      break;
    case EyeCut.Almond:
      ink([
        pen(x - side * 0.13, y + 0.02)
          .curve([x - side * 0.03, y - 0.075], [x + side * 0.15, y - 0.03])
          .curve([x + side * 0.03, y + 0.07], [x - side * 0.13, y + 0.02])
          .close(),
      ]);
      line(side * 0.13, -0.03, side * 0.18, -0.06, side * 0.2, -0.1, 0.032);
      break;
    case EyeCut.Smile:
      line(-0.11, 0.035, 0, -0.1, 0.11, 0.035, 0.05);
      break;
    case EyeCut.Slit:
      ink([capsule(x - 0.1, y, x + 0.1, y - side * 0.012, 0.036)]);
      break;
    default:
      ink([oval(x, y, 0.078, 0.122)]);
  }
}
/** Redraws the brows for an expression and sets how far the eyes are open. */
export function poseFace(rig: FaceRig, expression: Expression, blink = 1, glance = 0): void {
  const lids = Math.max(0.1, expression.lids * blink);
  // Closing lids squash the eyes onto their own line; a glance slides them aside.
  rig.eyes.transform([1, 0, glance, 0, lids, eyeY * (1 - lids), 0, 0, 1]);
  const key = `${expression.brow}|${expression.browShown}`;
  if (rig.posed === key) return;
  rig.posed = key;
  const shown = expression.browShown || rig.cut !== BrowCut.None,
    heavy =
      rig.cut === BrowCut.Heavy ? 0.062 : rig.cut === BrowCut.Soft || rig.cut === BrowCut.None ? 0.04 : 0.05,
    arch = rig.cut === BrowCut.Arched ? -0.07 : -0.025;
  rig.brows.forEach((brow, i) => {
    const side = i ? 1 : -1,
      x = side * eyeX + rig.turn,
      tilt = expression.brow * 0.085,
      lift =
        -0.115 - Math.abs(expression.brow) * 0.015 + (expression.brow < 0 ? -0.02 : 0.02 * expression.brow);
    brow.reset();
    if (!shown) return;
    brow
      .moveTo(x - side * 0.15, eyeY + lift * 2 + tilt)
      .cubicTo(
        x - side * 0.05,
        eyeY + lift * 2 + arch + tilt * 0.4,
        x + side * 0.06,
        eyeY + lift * 2 + arch - tilt * 0.4,
        x + side * 0.16,
        eyeY + lift * 2 - tilt + 0.02,
      )
      .strokeFill(...rig.browTone)
      .strokeWidth(heavy)
      .strokeCap('round');
  });
}
function whiskers(scene: SceneNode, look: Likeness, finish: HeadFinish, tone: Rgb): void {
  // A beard grows a shade deeper than the hair, so the two never merge into one mass.
  const hair = mix(tone, [62, 46, 42], 0.16),
    kind = look.whiskers,
    x = finish.turn,
    chin = chinOf(look.jaw);
  if (kind === Whiskers.None) return;
  if (kind === Whiskers.Stubble) {
    const jaw = shapeOf([
      pen(-1.02, 0.1)
        .curve([-0.6, 0.44], [x, 0.38], [0.6, 0.44], [1.02, 0.1])
        .curve([1.04, 0.7], [0.5, 1.02], [0, 1.02], [-0.5, 1.02], [-1.04, 0.7], [-1.02, 0.1])
        .close(),
    ]).fill(...dusk(hair, 0.1), 62);
    jaw.clip(shapeOf(headForm(look.jaw)));
    scene.add(jaw);
    return;
  }
  if (kind !== Whiskers.Moustache) {
    const long = kind === Whiskers.LongBeard,
      beard: Form = [
        long
          ? pen(-1.0, 0.04)
              .curve([-0.99, 0.5], [-0.82, 0.96], [-0.52, 1.34], [-0.17, chin + 0.86])
              .curve([0, chin + 0.95], [0.17, chin + 0.86])
              .curve([0.52, 1.34], [0.82, 0.96], [0.99, 0.5], [1.0, 0.04])
              .curve(
                [0.88, 0.3],
                [0.64, 0.52],
                [0.34 + x, 0.63],
                [x, 0.66],
                [-0.34 + x, 0.63],
                [-0.64, 0.52],
                [-0.88, 0.3],
              )
              .curve([-1.0, 0.04])
              .close()
          : pen(-1.0, 0.04)
              .curve([-0.99, 0.5], [-0.78, 0.9], [-0.45, chin + 0.17])
              .lobes(0.45, chin + 0.17, 3, -0.09)
              .curve([0.78, 0.9], [0.99, 0.5], [1.0, 0.04])
              .curve(
                [0.88, 0.3],
                [0.64, 0.52],
                [0.34 + x, 0.63],
                [x, 0.66],
                [-0.34 + x, 0.63],
                [-0.64, 0.52],
                [-0.88, 0.3],
              )
              .curve([-1.0, 0.04])
              .close(),
      ];
    paintForm(scene, beard, hair, finish);
    if (long) {
      paintForm(scene, [oval(0, chin + 0.62, 0.17, 0.085)], gold, { ...finish, rim: 0 });
      if (finish.detail)
        for (const side of [-1, 1])
          scene.add(
            new ShapeNode()
              .moveTo(side * 0.3, 0.86)
              .cubicTo(side * 0.3, 1.1, side * 0.2, 1.3, side * 0.1, chin + 0.5)
              .strokeFill(...dusk(hair, 0.3))
              .strokeWidth(0.035)
              .strokeCap('round'),
          );
    }
  }
  const lip = (side: number) =>
    pen(x, 0.375)
      .curve([x + side * 0.2, 0.35], [x + side * 0.42, 0.47])
      .curve([x + side * 0.2, 0.485], [x, 0.455])
      .close();
  paintForm(scene, [lip(1), lip(-1)], hair, { ...finish, rim: 0 });
}
/** The whole head, split where the body passes between: hair behind, everything else in front. */
export function drawHead(
  look: Likeness,
  finish: HeadFinish,
  expression: Expression,
  gear: Headgear = null,
): HeadDrawing {
  const back = new SceneNode(),
    front = new SceneNode(),
    skin = rgb(look.skin),
    skinShade = dusk(skin, 0.22),
    hair = rgb(look.hair),
    hairShade = dusk(hair, 0.36),
    flat: Finish = { ...finish, rim: 0 },
    forms = hairForms(look.cut),
    head = headForm(look.jaw),
    turn = finish.turn;
  const covered = !!look.kerchief || !!gear;
  if (covered) {
    // Nothing piled on the crown shows under a covering.
    const under = new SceneNode();
    paintForm(under, forms.back, hair, finish, hairShade);
    under.clip(new ShapeNode().appendRect(-3, -0.4, 6, 6));
    back.add(under);
  } else paintForm(back, forms.back, hair, finish, hairShade);
  if (forms.ears || covered) {
    paintForm(front, paired([oval(0.99, 0.15, 0.15, 0.19)]), skin, flat);
    if (finish.detail)
      for (const side of [-1, 1])
        front.add(shapeOf([oval(side * 1.02, 0.16, 0.06, 0.09)]).fill(...skinShade));
  }
  // The skull has no hollows, so a small figure can shade it without a clip.
  paintForm(front, head, skin, finish.detail ? finish : { ...finish, inset: true }, skinShade);
  if (forms.shaved.length) {
    const scalp = shapeOf(forms.shaved).fill(...hair, 70);
    scalp.clip(shapeOf(head));
    front.add(scalp);
  }
  if (finish.detail && forms.front.length && !covered) {
    // Hair throws a soft shadow onto the brow.
    const cast = shapeOf(moved(forms.front, 0.02, 0.075)).fill(...skinShade);
    cast.clip(shapeOf(head));
    front.add(cast);
  }
  for (const side of [-1, 1])
    front.add(shapeOf([oval(side * 0.6 + turn, 0.4, 0.17, 0.1)]).fill(228, 124, 110, side > 0 ? 62 : 78));
  if (look.freckles && finish.detail)
    for (const side of [-1, 1])
      for (const [x, y] of [
        [0.5, 0.31],
        [0.6, 0.28],
        [0.69, 0.33],
      ])
        front.add(shapeOf([oval(side * x + turn, y, 0.022)]).fill(...dusk(skin, 0.4)));
  if (look.paint)
    for (const side of [-1, 1])
      for (const drop of [0, 0.1])
        front.add(
          new ShapeNode()
            .moveTo(side * 0.5 + turn, 0.31 + drop)
            .lineTo(side * 0.76 + turn, 0.27 + drop)
            .strokeFill(...woad)
            .strokeWidth(0.05)
            .strokeCap('round'),
        );
  if (look.scar)
    front.add(
      new ShapeNode()
        .moveTo(0.52 + turn, -0.06)
        .lineTo(0.63 + turn, 0.36)
        .strokeFill(...dusk([226, 132, 120], 0.12))
        .strokeWidth(0.04)
        .strokeCap('round'),
    );
  if (look.elder && finish.detail)
    for (const side of [-1, 1])
      for (const rise of [-0.03, 0.04])
        front.add(
          new ShapeNode()
            .moveTo(side * 0.56 + turn, eyeY + rise)
            .lineTo(side * 0.64 + turn, eyeY + rise * 2.2)
            .strokeFill(...dusk(skin, 0.45))
            .strokeWidth(0.022)
            .strokeCap('round'),
        );
  const eyes = new SceneNode();
  for (const side of [-1, 1]) drawEye(eyes, look, side, side * eyeX + turn);
  front.add(eyes);
  const brows = [new ShapeNode(), new ShapeNode()];
  front.add(brows[0]).add(brows[1]);
  whiskers(front, look, finish, hair);
  if (covered) {
    // Only what falls below the covering still shows.
    const below = new SceneNode();
    paintForm(below, forms.front, hair, finish, hairShade);
    below.clip(new ShapeNode().appendRect(-3, -0.36, 6, 6));
    front.add(below);
  } else {
    paintForm(front, forms.front, hair, finish, hairShade);
    // A portrait shades every link of a plait; a small figure draws the plait as one shape.
    if (finish.detail) for (const piece of forms.over) paintForm(front, piece, hair, finish, hairShade);
    else paintForm(front, forms.over.flat(), hair, flat);
    if (finish.detail && forms.front.length) {
      const shine = new ShapeNode()
        .moveTo(-0.72, -0.62)
        .cubicTo(-0.6, -0.84, -0.36, -0.97, -0.1, -1)
        .strokeFill(...glint(hair, 0.34))
        .strokeWidth(0.075)
        .strokeCap('round');
      shine.clip(shapeOf(forms.front));
      front.add(shine);
    }
  }
  const dome: Form = [
      pen(-1.1, -0.2)
        .curve([-1.1, -0.72], [-0.6, -1.14], [0, -1.2], [0.6, -1.14], [1.1, -0.72], [1.1, -0.2])
        .curve([0.7, -0.44], [0, -0.5], [-0.7, -0.44], [-1.1, -0.2])
        .close(),
    ],
    brim: Form = [
      pen(-1.12, -0.22)
        .curve([-0.7, -0.46], [0, -0.52], [0.7, -0.46], [1.12, -0.22])
        .line(1.12, -0.07)
        .curve([0.7, -0.3], [0, -0.36], [-0.7, -0.3], [-1.12, -0.07])
        .close(),
    ];
  if (gear === 'helmet') {
    const steel: Rgb = [146, 154, 160];
    paintForm(front, moved(dome, 0, -0.05), steel, finish);
    paintForm(
      front,
      [pen(-0.08, -1.25).line(0.08, -1.25).line(0.08, -0.5).line(-0.08, -0.5).close()],
      glint(steel, 0.3),
      flat,
    );
    paintForm(front, brim, dusk(steel, 0.22), flat);
    // The nasal bar comes down between the eyes.
    paintForm(
      front,
      [
        pen(turn - 0.075, -0.3)
          .line(turn + 0.075, -0.3)
          .line(turn + 0.06, 0.24)
          .curve([turn, 0.3], [turn - 0.06, 0.24])
          .close(),
      ],
      dusk(steel, 0.22),
      flat,
    );
    if (finish.detail)
      for (const x of [-0.84, -0.42, 0.42, 0.84])
        front.add(shapeOf([oval(x, -0.2 - (1 - Math.abs(x)) * 0.16, 0.04)]).fill(...glint(steel, 0.5)));
  } else if (gear === 'cap') {
    const hide: Rgb = [140, 100, 66];
    paintForm(front, dome, hide, finish);
    paintForm(front, brim, dusk(hide, 0.26), flat);
    front.add(shapeOf([oval(0, -1.2, 0.08, 0.06)]).fill(...dusk(hide, 0.3)));
  } else if (look.kerchief) {
    const cloth = rgb(look.kerchief);
    paintForm(front, dome, cloth, finish);
    paintForm(
      back,
      [pen(0.9, -0.3).curve([1.3, 0.1], [1.36, 0.62]).curve([1.08, 0.36], [0.86, 0.1]).close()],
      cloth,
      flat,
    );
  }
  if (finish.detail) for (const piece of forms.hang) paintForm(front, piece, hair, finish, hairShade);
  else paintForm(front, forms.hang.flat(), dusk(hair, 0.12), flat);
  paintForm(front, forms.ties, gold, flat);
  if (look.band && !gear) {
    paintForm(
      front,
      [
        pen(-1.08, -0.4)
          .curve([-0.6, -0.56], [0, -0.61], [0.6, -0.56], [1.08, -0.4])
          .line(1.08, -0.27)
          .curve([0.6, -0.43], [0, -0.48], [-0.6, -0.43], [-1.08, -0.27])
          .close(),
      ],
      gold,
      flat,
    );
    front.add(shapeOf([oval(turn * 0.6, -0.54, 0.07, 0.085)]).fill(...woad));
  }
  const rig: FaceRig = {
    eyes,
    brows,
    posed: '',
    turn,
    browTone: look.brows === BrowCut.None ? eyeInk : dusk(hair, 0.55),
    cut: look.brows,
  };
  poseFace(rig, expression);
  return { back, front, rig };
}
