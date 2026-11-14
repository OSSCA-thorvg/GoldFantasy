// Hair silhouettes in head units: the skull is two units wide, crown at -0.94, chin at 0.9, y down.
import { HairCut } from '../../engine/src/likeness';
import { capsule, oval, paired, pen, pierced, type Contour, type Form, type Pen } from './outline-form';

export interface HairForms {
  /** Behind the head and the shoulders. */
  back: Form;
  /** Over the brow and beside the face. */
  front: Form;
  /** Plaits, loops and locks in front of the shoulders, each piece shaded on its own. */
  hang: Form[];
  /** Pieces laid over the cap, such as a braid wound round the head. */
  over: Form[];
  /** Thread, beads and rings binding the hair. */
  ties: Form;
  /** Cropped stubble tinting the scalp. */
  shaved: Form;
  /** Whether the ears show. */
  ears: boolean;
}
type Run = [number, number][];
const left: [number, number] = [-1.05, 0.12],
  right: [number, number] = [1.05, 0.12],
  crown: Run = [
    [-1.09, -0.42],
    [-0.74, -0.97],
    [0, -1.13],
    [0.74, -0.97],
    [1.09, -0.42],
  ],
  full: Run = [
    [-1.16, -0.4],
    [-0.82, -1.03],
    [0, -1.21],
    [0.82, -1.03],
    [1.16, -0.4],
  ];
/** A cap from temple to temple over the crown, closed by a fringe drawn right to left. */
const cap = (outer: Run, fringe: (p: Pen) => Pen): Contour =>
  fringe(pen(...left).curve(...outer, right)).close();

const fringes = {
  sidePart: (p: Pen) =>
    p
      .curve([0.99, -0.14], [0.76, -0.4], [0.36, -0.49], [-0.08, -0.56], [-0.4, -0.76])
      .curve([-0.58, -0.52], [-0.86, -0.34], [-1, -0.1], left),
  centrePart: (p: Pen) =>
    p
      .curve([1, -0.16], [0.8, -0.44], [0.42, -0.56], [0.14, -0.66], [0, -0.86])
      .curve([-0.14, -0.66], [-0.42, -0.56], [-0.8, -0.44], [-1, -0.16], left),
  bangs: (p: Pen) =>
    p.curve([1.02, -0.04], [0.92, -0.22]).lobes(-0.92, -0.22, 4, 0.08).curve([-1.02, -0.04], left),
  swept: (p: Pen) =>
    p
      .curve([1, -0.04], [0.92, -0.14])
      .curve([0.56, -0.27], [0.12, -0.31], [-0.34, -0.45], [-0.7, -0.64])
      .curve([-0.88, -0.36], [-1, -0.1], left),
  jagged: (p: Pen) =>
    p
      .curve([1, -0.1], [0.84, -0.38])
      .line(0.62, -0.2)
      .line(0.4, -0.5)
      .line(0.14, -0.27)
      .line(-0.12, -0.54)
      .line(-0.4, -0.33)
      .line(-0.62, -0.56)
      .curve([-0.9, -0.34], [-1, -0.1], left),
  curly: (p: Pen) =>
    p.curve([1.02, -0.1], [0.92, -0.34]).lobes(-0.92, -0.34, 5, 0.13).curve([-1.02, -0.1], left),
  drawnBack: (p: Pen) =>
    p.curve(
      [1.02, -0.14],
      [0.86, -0.45],
      [0.5, -0.61],
      [0, -0.57],
      [-0.5, -0.61],
      [-0.86, -0.45],
      [-1.02, -0.14],
      left,
    ),
};
/** Hair that falls beside the face to `reach`, parted in the middle. */
function curtains(reach: number, part = 0): Contour {
  const side = (sign: number): Run => [
    [sign * 0.87, reach - 0.04],
    [sign * 0.94, 0.5],
    [sign * 1.0, 0.02],
    [sign * 0.88, -0.42],
    [sign * 0.46 + part * 0.4, -0.63],
    [sign * 0.14 + part * 0.7, -0.74],
  ];
  return pen(-1.09, reach)
    .curve(
      [-1.15, 0.4],
      [-1.14, -0.4],
      [-0.8, -1.01],
      [0, -1.18],
      [0.8, -1.01],
      [1.14, -0.4],
      [1.15, 0.4],
      [1.09, reach],
    )
    .curve([0.98, reach + 0.07], side(1)[0])
    .curve(...side(1).slice(1), [part, -0.92])
    .curve(...side(-1).reverse())
    .curve([-0.98, reach + 0.07], [-1.09, reach])
    .close();
}
/** A mass behind the head falling to `reach`; `wave` scallops its edges. */
function fall(reach: number, wave = 0, width = 1.24): Contour {
  const p = pen(-1.16, -0.3);
  if (wave) p.lobes(-width, reach * 0.55, 2, -wave).lobes(-width + 0.2, reach, 2, -wave);
  else p.curve([-width, reach * 0.4], [-width + 0.04, reach * 0.8], [-width + 0.22, reach]);
  if (wave) p.lobes(width - 0.2, reach, 4, -wave * 0.8);
  else p.curve([-0.5, reach + 0.08], [0, reach + 0.04], [0.5, reach + 0.08], [width - 0.22, reach]);
  if (wave) p.lobes(width, reach * 0.55, 2, -wave).lobes(1.16, -0.3, 2, -wave);
  else p.curve([width - 0.04, reach * 0.8], [width, reach * 0.4], [1.16, -0.3]);
  return p.curve([0.8, -1], [0, -1.16], [-0.8, -1], [-1.16, -0.3]).close();
}
/** A plait as overlapping links from one point to another, tapering, with a tufted end. */
function plait(ax: number, ay: number, bx: number, by: number, links: number, size: number): Form {
  const form: Form = [];
  for (let i = 0; i < links; i++) {
    const t = i / (links - 1),
      r = size * (1 - t * 0.28),
      sway = (i % 2 ? 1 : -1) * size * 0.22;
    form.push(oval(ax + (bx - ax) * t + sway, ay + (by - ay) * t, r, r * 0.86));
  }
  form.push(
    pen(bx - size * 0.5, by + size * 0.5)
      .curve([bx - size * 0.62, by + size * 1.5], [bx, by + size * 2.1])
      .curve([bx + size * 0.62, by + size * 1.5], [bx + size * 0.5, by + size * 0.5])
      .close(),
  );
  return form;
}
const none: HairForms = { back: [], front: [], hang: [], over: [], ties: [], shaved: [], ears: true };
/** Each contour as its own piece, so every link of a plait keeps its own shading. */
const pieces = (form: Form): Form[] => form.map((contour) => [contour]);

export function hairForms(cut: HairCut): HairForms {
  switch (cut) {
    case HairCut.SidePart:
      return { ...none, front: [cap(crown, fringes.sidePart)] };
    case HairCut.ShortCentrePart:
      return { ...none, front: [cap(crown, fringes.centrePart)] };
    case HairCut.SideFringe:
      return { ...none, front: [cap(full, fringes.swept)] };
    case HairCut.LightCrop:
      return {
        ...none,
        front: [
          pen(-1.01, 0.02)
            .curve([-1.03, -0.42], [-0.7, -0.9], [0, -1.03], [0.7, -0.9], [1.03, -0.42], [1.01, 0.02])
            .curve(
              [0.98, -0.2],
              [0.84, -0.47],
              [0.5, -0.61],
              [0, -0.65],
              [-0.5, -0.61],
              [-0.84, -0.47],
              [-0.98, -0.2],
              [-1.01, 0.02],
            )
            .close(),
        ],
      };
    case HairCut.WindSwept:
      return {
        ...none,
        front: [
          pen(...left)
            .curve([-1.08, -0.42], [-0.74, -0.98], [-0.06, -1.17], [0.56, -1.13])
            .curve([0.96, -1.16], [1.32, -0.96])
            .curve([1.1, -0.82], [1.05, -0.62])
            .curve([1.24, -0.56], [1.42, -0.34])
            .curve([1.15, -0.26], [1.08, -0.04], right)
            .curve([0.94, -0.2], [0.6, -0.38], [0.1, -0.46], [-0.4, -0.52], [-0.74, -0.62])
            .curve([-0.9, -0.36], [-1, -0.1], left)
            .close(),
        ],
      };
    case HairCut.SpikyCrop:
      return {
        ...none,
        front: [
          fringes
            .jagged(
              pen(...left)
                .curve([-1.08, -0.36])
                .line(-1.2, -0.84)
                .line(-0.8, -0.86)
                .line(-0.74, -1.32)
                .line(-0.34, -1.04)
                .line(-0.06, -1.46)
                .line(0.22, -1.06)
                .line(0.56, -1.36)
                .line(0.72, -0.92)
                .line(1.16, -0.98)
                .line(1.08, -0.4)
                .curve(right),
            )
            .close(),
        ],
      };
    case HairCut.WildTuft:
      return {
        ...none,
        front: [
          cap(full, fringes.jagged),
          pen(-0.2, -1.1).curve([-0.08, -1.42], [0.3, -1.56]).curve([0.2, -1.32], [0.26, -1.08]).close(),
          pen(-0.62, -1.02).curve([-0.74, -1.26], [-0.5, -1.42]).curve([-0.44, -1.22], [-0.3, -1.06]).close(),
        ],
      };
    case HairCut.CurlyCrown: {
      const front: Form = [cap(full, fringes.curly)],
        back: Form = [];
      for (let i = 0; i < 9; i++) {
        const angle = ((188 + (164 * i) / 8) * Math.PI) / 180;
        front.push(oval(1.06 * Math.cos(angle), -0.1 + 1.02 * Math.sin(angle), 0.28));
      }
      for (const side of [-1, 1]) back.push(oval(side * 1.1, 0.28, 0.27), oval(side * 1.0, 0.56, 0.22));
      return { ...none, front, back, ears: false };
    }
    case HairCut.Shag:
      return {
        ...none,
        ears: false,
        front: [cap(full, fringes.jagged)],
        back: [
          pen(-1.16, -0.3)
            .curve([-1.26, 0.3], [-1.3, 0.78])
            .line(-1.06, 0.66)
            .line(-0.98, 1.02)
            .line(-0.7, 0.8)
            .curve([0, 0.92], [0.7, 0.8])
            .line(0.98, 1.02)
            .line(1.06, 0.66)
            .line(1.3, 0.78)
            .curve([1.26, 0.3], [1.16, -0.3])
            .curve([0.8, -1], [0, -1.16], [-0.8, -1], [-1.16, -0.3])
            .close(),
        ],
      };
    case HairCut.FlippedBob:
      return {
        ...none,
        ears: false,
        front: [curtains(0.5, -0.3)],
        back: [
          pen(-1.12, -0.3)
            .curve([-1.2, 0.3], [-1.22, 0.62], [-1.48, 0.86])
            .curve([-1.1, 1], [-0.8, 0.93])
            .curve([0, 1.02], [0.8, 0.93])
            .curve([1.1, 1], [1.48, 0.86])
            .curve([1.22, 0.62], [1.2, 0.3], [1.12, -0.3])
            .curve([0.8, -1], [0, -1.16], [-0.8, -1], [-1.12, -0.3])
            .close(),
        ],
      };
    case HairCut.SoftBob:
      return {
        ...none,
        ears: false,
        front: [cap(full, fringes.bangs), ...paired([capsule(1.04, 0, 1.0, 0.62, 0.2, 0.17)])],
        back: [fall(0.98, 0, 1.26)],
      };
    case HairCut.LongCentrePart:
      return { ...none, ears: false, front: [curtains(1.15)], back: [fall(2.05)] };
    case HairCut.LongWaves:
      return { ...none, ears: false, front: [curtains(1.05, 0.25)], back: [fall(2, 0.13, 1.3)] };
    case HairCut.Mane:
      return {
        ...none,
        ears: false,
        front: [curtains(0.78)],
        back: [
          pen(-1.16, -0.3)
            .curve([-1.26, 0.5], [-1.3, 1.2])
            .line(-1.02, 1.06)
            .line(-0.84, 1.36)
            .curve([0, 1.3], [0.84, 1.36])
            .line(1.02, 1.06)
            .line(1.3, 1.2)
            .curve([1.26, 0.5], [1.16, -0.3])
            .curve([0.8, -1], [0, -1.16], [-0.8, -1], [-1.16, -0.3])
            .close(),
        ],
      };
    case HairCut.LongLocks: {
      const back: Form = [];
      for (let i = 0; i < 6; i++) {
        const x = -1.1 + i * 0.44;
        back.push(capsule(x * 0.9, -0.2, x * 1.08, 1.9 - Math.abs(x) * 0.12, 0.2, 0.17));
      }
      return {
        ...none,
        ears: false,
        back,
        front: [cap(full, fringes.centrePart)],
        hang: pieces(paired([capsule(1.04, -0.1, 1.08, 1.2, 0.19, 0.16)])),
      };
    }
    case HairCut.Braids:
      return {
        ...none,
        front: [cap(full, fringes.centrePart)],
        hang: pieces(paired(plait(1.08, 0.36, 1.0, 1.62, 6, 0.21))),
        ties: paired([oval(1.0, 1.7, 0.17, 0.09)]),
      };
    case HairCut.SideBraid:
      return {
        ...none,
        ears: false,
        front: [curtains(0.55, 0.2)],
        back: [fall(0.9, 0, 1.2)],
        hang: pieces(plait(-0.98, 0.5, -0.74, 1.9, 7, 0.24)),
        ties: [oval(-0.74, 1.99, 0.2, 0.1)],
      };
    case HairCut.TwinLoops:
      return {
        ...none,
        front: [cap(full, fringes.centrePart)],
        hang: [-1, 1].map((side) => [
          oval(side * 1.16, 0.6, 0.28, 0.42),
          pierced(oval(side * 1.16, 0.62, 0.1, 0.22)),
        ]),
        ties: paired([oval(1.07, 0.2, 0.12, 0.09)]),
      };
    case HairCut.ShortTwinTails: {
      const tail = pen(0.94, 0.06)
        .curve([1.34, 0.2], [1.6, 0.6], [1.54, 1.02])
        .curve([1.24, 0.84], [1.02, 0.54], [0.94, 0.06])
        .close();
      return {
        ...none,
        front: [cap(full, fringes.bangs)],
        back: paired([tail]),
        ties: paired([oval(1.07, 0.2, 0.12, 0.15)]),
      };
    }
    case HairCut.HighBun:
      return {
        ...none,
        front: [cap(crown, fringes.drawnBack)],
        back: [oval(0, -1.36, 0.42, 0.38)],
        ties: [oval(0, -1.06, 0.3, 0.07)],
      };
    case HairCut.TwinBuns:
      return {
        ...none,
        front: [cap(crown, fringes.bangs)],
        back: paired([oval(0.72, -1.04, 0.36, 0.34)]),
      };
    case HairCut.CrownBraid: {
      const braid: Form = [];
      for (let i = 0; i < 9; i++) {
        const angle = ((200 + (140 * i) / 8) * Math.PI) / 180;
        braid.push(oval(1.0 * Math.cos(angle), -0.02 + 0.98 * Math.sin(angle), 0.2, 0.17));
      }
      return {
        ...none,
        front: [cap(crown, fringes.centrePart)],
        over: pieces(braid),
        back: [oval(0, 0.5, 1.12, 0.62)],
      };
    }
    case HairCut.Topknot:
      return {
        ...none,
        shaved: [cap(crown, fringes.drawnBack)],
        back: [oval(0, -1.28, 0.3, 0.36)],
        front: [
          pen(-0.36, -0.9)
            .curve([-0.2, -1.08], [0, -1.12], [0.2, -1.08], [0.36, -0.9])
            .curve([0, -0.8], [-0.36, -0.9])
            .close(),
        ],
        ties: [oval(0, -1.04, 0.24, 0.07)],
      };
    case HairCut.WarBraid:
      return {
        ...none,
        shaved: [cap(crown, fringes.drawnBack)],
        front: [
          pen(-0.44, -0.6)
            .curve([-0.52, -0.94], [0, -1.16], [0.52, -0.94], [0.44, -0.6])
            .curve([0.2, -0.5], [0, -0.56], [-0.2, -0.5], [-0.44, -0.6])
            .close(),
        ],
        hang: pieces(plait(0.96, 0.3, 0.8, 1.7, 6, 0.2)),
        ties: [oval(0.8, 1.78, 0.17, 0.09)],
      };
    default:
      return none;
  }
}
