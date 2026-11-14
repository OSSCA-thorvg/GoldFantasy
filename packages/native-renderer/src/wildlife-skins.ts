// The settlement's animals. Each is one flowing outline over a shared skeleton (four-legged ones on
// the wolf's, the hen on the bird's) with a few marks laid on it, not a set of parts side by side.
import { AnimalKind } from '../../engine/src/person';
import { ShapeNode, type Rgb } from './paint';
import { capsules, discs, fills, type RigSkin } from './rig-skin';
import { SkinnedPath, type OutlinePoint } from './rig-skinned-path';

const ink: Rgb = [40, 34, 38];
const curl = (color: Rgb, width: number, path: (shape: ShapeNode) => ShapeNode): ShapeNode =>
  path(
    new ShapeNode()
      .strokeFill(...color)
      .strokeWidth(width)
      .strokeCap('round'),
  );
/** Down the front of a fore leg, round the paw and up its back; `x` is the shoulder joint. */
const foreLeg = (leg: 'fr' | 'fl', upper: number, lower: number): OutlinePoint[] => {
  const x = leg === 'fr' ? 2.8 : 1.8,
    thigh = `leg.${leg}.1`,
    shin = `leg.${leg}.2`;
  return [
    [x + upper + 0.2, -4.6, thigh],
    [x + 0.2 + lower, -2.8, shin],
    [x + 0.3 + lower, -1.2, shin],
    [x + 1.2 + lower, -0.3, shin, true],
    [x + 0.3 - lower, -0.3, shin, true],
    [x + 0.2 - lower, -2.7, shin],
    [x - upper, -4.4, thigh],
  ];
};
/** Down the front of a hind leg, round the paw, back over the hock and up the thigh; `x` is the hip joint. */
const hindLeg = (leg: 'hr' | 'hl', upper: number, lower: number): OutlinePoint[] => {
  const x = leg === 'hr' ? -4.6 : -5.6,
    thigh = `leg.${leg}.1`,
    shin = `leg.${leg}.2`;
  return [
    [x + upper + 0.3, -4.8, thigh],
    [x - 0.7 + lower, -2.9, shin],
    [x + lower, -1.3, shin],
    [x + 0.9 + lower, -0.3, shin, true],
    [x - 0.2 - lower, -0.3, shin, true],
    [x - 0.5 - lower, -1.5, shin],
    [x - 1.2 - lower, -3, shin],
    [x - 0.9 - upper, -4.9, thigh],
  ];
};
interface Beast {
  hide: Rgb;
  /** The legs on the far side, in the body's shade. */
  shade: Rgb;
  /** Half-widths of the legs at the top and at the shin: fore, then hind. */
  legs: readonly [number, number, number, number];
  back: readonly OutlinePoint[];
  head: readonly OutlinePoint[];
  throat: readonly OutlinePoint[];
  belly: readonly OutlinePoint[];
  rump: readonly OutlinePoint[];
  /** A tail thick enough to be part of the outline. */
  tail?: readonly OutlinePoint[];
}
const paths = new Map<Beast | 'hen', { far?: SkinnedPath; body: SkinnedPath }>();
/** One outline for trunk, neck, head, tail and the near legs; the far legs are a second one behind it. */
function dressBeast(skin: RigSkin, beast: Beast): void {
  let path = paths.get(beast);
  if (!path) {
    const [fore, foreShin, hind, hindShin] = beast.legs;
    path = {
      far: new SkinnedPath(skin.skeleton, [
        [...foreLeg('fl', fore, foreShin), [1.8 - fore, -6, 'leg.fl.1'], [2 + fore, -6, 'leg.fl.1']],
        [...hindLeg('hl', hind, hindShin), [-6.5 - hind, -6.4, 'leg.hl.1'], [-5.3 + hind, -6.4, 'leg.hl.1']],
      ]),
      body: new SkinnedPath(skin.skeleton, [
        [
          ...beast.back,
          ...beast.head,
          ...beast.throat,
          ...foreLeg('fr', fore, foreShin),
          ...beast.belly,
          ...hindLeg('hr', hind, hindShin),
          ...beast.rump,
          ...(beast.tail ?? []),
        ],
      ]),
    };
    paths.set(beast, path);
  }
  skin.outline(beast.shade, path.far!);
  skin.outline(beast.hide, path.body);
}

const wolf: Beast = {
  hide: [146, 154, 152],
  shade: [102, 110, 114],
  legs: [0.75, 0.55, 1, 0.55],
  back: [
    [-7.8, -9.2, 'hips'],
    [-4, -10.1, 'hips'],
    [0.5, -9.8, 'chest'],
    [3.4, -10.6, 'chest'],
    [5, -11.2, 'neck'],
  ],
  head: [
    [6, -11.6, 'head'],
    [6.5, -13.9, 'head', true],
    [7.5, -11.8, 'head'],
    [8.5, -14, 'head', true],
    [9.3, -11.5, 'head'],
    [10.3, -10.7, 'head'],
    [12.3, -9.7, 'head'],
    [12.9, -9, 'head', true],
    [12.3, -8.2, 'head'],
    [9.6, -7.7, 'head'],
  ],
  throat: [
    [7.2, -7, 'neck'],
    [5.9, -5.6, 'chest'],
  ],
  belly: [
    [0.6, -4.2, 'chest'],
    [-2.6, -3.9, 'hips'],
  ],
  rump: [[-8, -6.4, 'hips']],
  // A full brush carried low.
  tail: [
    [-8.6, -6.6, 'tail'],
    [-11.4, -6, 'tail'],
    [-13, -7.4, 'tail', true],
    [-11.2, -9.4, 'tail'],
    [-8.6, -9.1, 'tail'],
  ],
};
const dog: Beast = {
  hide: [198, 154, 104],
  shade: [150, 112, 76],
  legs: [0.7, 0.5, 0.95, 0.5],
  back: [
    [-7.4, -8.9, 'hips'],
    [-4, -9.9, 'hips'],
    [0.5, -9.6, 'chest'],
    [3.2, -10.1, 'chest'],
    [4.8, -10.8, 'neck'],
  ],
  head: [
    [5.8, -11.3, 'head'],
    [7.4, -11.9, 'head'],
    [9, -11.5, 'head'],
    [10.1, -10.5, 'head'],
    [11.7, -10, 'head'],
    [12.3, -9.3, 'head', true],
    [11.8, -8.3, 'head'],
    [9.2, -7.7, 'head'],
  ],
  throat: [
    [7, -7, 'neck'],
    [5.7, -5.6, 'chest'],
  ],
  belly: [
    [0.6, -4.4, 'chest'],
    [-2.6, -4.2, 'hips'],
  ],
  rump: [[-7.6, -6.2, 'hips']],
  // Carried up in a curve.
  tail: [
    [-7.9, -7.4, 'tail'],
    [-9.7, -9.2, 'tail'],
    [-9.3, -11.9, 'tail', true],
    [-8.4, -9.8, 'tail'],
    [-7.4, -8.7, 'tail'],
  ],
};
const cat: Beast = {
  hide: [186, 164, 132],
  shade: [140, 126, 106],
  legs: [0.55, 0.42, 0.8, 0.42],
  back: [
    [-7.2, -8.7, 'hips'],
    [-4, -9.7, 'hips'],
    [0.5, -9.4, 'chest'],
    [3.2, -9.8, 'chest'],
    [4.6, -10.6, 'neck'],
  ],
  head: [
    [5.2, -11.6, 'head'],
    [5.6, -14.4, 'head', true],
    [7.2, -12.5, 'head'],
    [8, -12.6, 'head'],
    [9.4, -14.6, 'head', true],
    [10, -11.9, 'head'],
    [10.9, -10, 'head'],
    [10.5, -8.1, 'head'],
    [9.2, -7.2, 'head'],
  ],
  throat: [
    [6.6, -6.9, 'neck'],
    [5.5, -5.6, 'chest'],
  ],
  belly: [
    [0.6, -4.5, 'chest'],
    [-2.6, -4.3, 'hips'],
  ],
  rump: [[-7.4, -6.2, 'hips']],
  // Held straight up, the tip curled over.
  tail: [
    [-7.7, -7.3, 'tail'],
    [-9.9, -8.8, 'tail'],
    [-9.9, -12.3, 'tail'],
    [-8.9, -12.9, 'tail', true],
    [-8.6, -9.6, 'tail'],
    [-7.2, -8.5, 'tail'],
  ],
};
const cow: Beast = {
  hide: [228, 217, 190],
  shade: [186, 172, 148],
  legs: [0.95, 0.7, 1.2, 0.7],
  back: [
    [-8.4, -9.2, 'hips'],
    [-6, -10.1, 'hips'],
    [-2, -10.4, 'hips'],
    [2, -10.3, 'chest'],
    [4.2, -10.6, 'chest'],
    [5.4, -11.2, 'neck'],
  ],
  head: [
    [6.2, -11.7, 'head'],
    [5.6, -13.8, 'head', true],
    [7.2, -12.1, 'head'],
    [8.6, -12, 'head'],
    [9.3, -13.9, 'head', true],
    [9.9, -11.7, 'head'],
    [11.3, -10.4, 'head'],
    [12, -8.9, 'head'],
    [11.6, -7.2, 'head'],
    [10.2, -6.7, 'head'],
    [8.4, -7, 'head'],
  ],
  throat: [
    [6.8, -6.8, 'neck'],
    [6, -5.2, 'chest'],
  ],
  belly: [
    [0.6, -3.6, 'chest'],
    [-2.6, -3.4, 'hips'],
  ],
  rump: [[-8.6, -6.2, 'hips']],
};
const pig: Beast = {
  hide: [216, 158, 138],
  shade: [176, 118, 106],
  legs: [0.9, 0.65, 1.1, 0.65],
  back: [
    [-8.4, -7.8, 'hips'],
    [-6, -10, 'hips'],
    [-2, -10.8, 'hips'],
    [2, -10.6, 'chest'],
    [4.6, -10, 'chest'],
    [5.6, -10.2, 'neck'],
  ],
  head: [
    [6, -10.6, 'head'],
    [6.6, -12.6, 'head', true],
    [7.8, -10.8, 'head'],
    [8.8, -10.3, 'head'],
    [9.8, -9.6, 'head'],
    [11.2, -8.6, 'head'],
    [11.5, -7.4, 'head'],
    [11.2, -6.3, 'head'],
    [10.2, -5.9, 'head'],
    [8.4, -5.4, 'head'],
  ],
  throat: [
    [6.6, -5, 'neck'],
    [5.6, -4.2, 'chest'],
  ],
  belly: [
    [0.6, -3.2, 'chest'],
    [-2.6, -3, 'hips'],
  ],
  rump: [[-8.6, -5.6, 'hips']],
};

function dressHen(skin: RigSkin): void {
  const down: Rgb = [234, 220, 182],
    red: Rgb = [170, 82, 58],
    leg = (x: number) =>
      curl([190, 138, 70], 0.5, (shape) =>
        shape
          .moveTo(x, -3)
          .lineTo(x + 0.2, -1.7)
          .lineTo(x, -0.35)
          .lineTo(x + 0.9, -0.35)
          .moveTo(x, -0.35)
          .lineTo(x - 0.5, -0.35),
      ).strokeJoin('round');
  let path = paths.get('hen');
  if (!path) {
    path = {
      body: new SkinnedPath(skin.skeleton, [
        [
          // Back, nape, crown, face, throat, breast, belly: one line from tail to tail.
          [-2.9, -6.4, 'body'],
          [-1.2, -7.5, 'body'],
          [0.7, -7.6, 'body'],
          [1.7, -8.1, 'neck'],
          [2, -9.3, 'head'],
          [3, -9.6, 'head'],
          [4.1, -8.8, 'head'],
          [4.2, -7.6, 'head'],
          [3.6, -7, 'head'],
          [3.5, -6.1, 'neck'],
          [3.6, -4.8, 'body'],
          [2.6, -3, 'body'],
          [0.2, -2.4, 'body'],
          [-2.2, -2.9, 'body'],
          [-3.5, -4.3, 'body'],
        ],
      ]),
    };
    paths.set('hen', path);
  }
  skin.piece(
    'tail',
    fills(
      [92, 82, 72],
      [
        [-2.2, -6.3],
        [-5.4, -9.4],
        [-4.4, -6.7],
        [-5.8, -6.3],
        [-2.8, -4.7],
      ],
    ),
  );
  skin.piece('leg.l.1', leg(-0.7));
  skin.piece('leg.r.1', leg(0.4));
  skin.outline(down, path.body);
  skin.piece('body', discs([196, 170, 126], [-0.5, -4.9, 2.1, 1.45]));
  skin.piece(
    'head',
    // Comb and wattle.
    fills(red, [
      [1.8, -9.1],
      [2.2, -10.2],
      [2.8, -9.5],
      [3.4, -10.3],
      [3.9, -9.1],
    ]).appendCircle(3.6, -6.8, 0.45, 0.75),
    fills(
      [198, 148, 68],
      [
        [4.1, -8.4],
        [5.6, -7.8],
        [4.1, -7.4],
      ],
    ),
    discs(ink, [3.2, -8.2, 0.26, 0.28]),
  );
}
/** Dresses `skin` as the animal; a hen needs the bird's skeleton, every other the four-legged one. */
export function dressAnimal(kind: AnimalKind, skin: RigSkin): void {
  switch (kind) {
    case AnimalKind.Cow: {
      const patch: Rgb = [92, 82, 74];
      skin.piece(
        'tail',
        capsules(0.7, patch, [-8.3, -8.8, -9.2, -4.2])
          .appendCircle(-9.2, -3.8, 0.3, 0.3)
          .fill(...patch),
      );
      dressBeast(skin, cow);
      skin.piece(
        'hips',
        fills(patch, [
          [-7.4, -9],
          [-4.2, -9.8],
          [-3.4, -7.3],
          [-5.6, -6.1],
          [-7.6, -6.9],
        ]),
      );
      skin.piece(
        'chest',
        fills(patch, [
          [1.2, -10],
          [3.9, -10.2],
          [4.5, -8.1],
          [2.4, -7.3],
          [0.8, -8.5],
        ]),
      );
      skin.piece(
        'head',
        // Horns over the outline's own, an ear and the dark patch over the eye, the muzzle.
        fills(
          [233, 218, 170],
          [
            [6.3, -11.7],
            [5.6, -13.8],
            [7.2, -12.1],
          ],
          [
            [8.7, -12],
            [9.3, -13.9],
            [9.9, -11.8],
          ],
        ),
        fills(
          patch,
          [
            [6, -10.9],
            [4.2, -11.1],
            [5.7, -9.7],
          ],
          [
            [7.6, -11.8],
            [9.5, -11.8],
            [10.2, -10.4],
            [8.2, -9.8],
          ],
        ),
        discs([196, 160, 146], [10.6, -8, 1.75, 1.35]),
        discs(ink, [8.9, -10.5, 0.34, 0.4], [10.9, -8.1, 0.22, 0.2]),
      );
      return;
    }
    case AnimalKind.Pig:
      // A curl of a tail, and the far ear behind the head.
      skin.piece(
        'tail',
        curl(pig.shade, 0.6, (shape) => shape.appendCircle(-8.9, -8.2, 0.9, 0.9)),
      );
      skin.piece(
        'head',
        fills(pig.shade, [
          [5.3, -10],
          [5.7, -12.2],
          [7.1, -10.4],
        ]),
      );
      dressBeast(skin, pig);
      skin.piece(
        'head',
        discs([233, 182, 162], [10.5, -7.4, 1.3, 1.2]),
        discs(ink, [8.7, -8.8, 0.3, 0.36], [10.2, -7.4, 0.18, 0.28], [10.9, -7.4, 0.18, 0.28]),
      );
      return;
    case AnimalKind.Chicken:
      return dressHen(skin);
    case AnimalKind.Dog:
      dressBeast(skin, dog);
      skin.piece(
        'head',
        fills(
          [226, 200, 160],
          [
            [8.9, -9.5],
            [11.7, -9.9],
            [12.2, -9.3],
            [11.8, -8.3],
            [9.2, -7.7],
          ],
        ),
        // A soft ear that hangs.
        discs([116, 84, 62], [6.6, -9.9, 1, 1.9]),
        discs(ink, [8.7, -10.3, 0.32, 0.38], [12, -9.3, 0.34, 0.3]),
      );
      return;
    case AnimalKind.Cat:
      dressBeast(skin, cat);
      skin.piece(
        'head',
        discs([228, 212, 176], [9.4, -8.9, 1.4, 1.05]),
        fills(ink, [
          [9.3, -9.4],
          [9.9, -9.4],
          [9.6, -9],
        ])
          .appendCircle(7.5, -10.3, 0.34, 0.44)
          .appendCircle(9.6, -10.3, 0.32, 0.44),
      );
      return;
    default:
      dressBeast(skin, wolf);
      skin.piece(
        'head',
        // The pale underside of the muzzle, a narrow eye under its brow, the nose.
        fills(
          [198, 198, 186],
          [
            [9.4, -9],
            [12.4, -9.3],
            [12.9, -9],
            [12.3, -8.2],
            [9.6, -7.7],
          ],
        ),
        discs([214, 186, 114], [9.6, -10.4, 0.6, 0.4]),
        capsules(0.4, ink, [8.8, -11, 10.4, -10.7])
          .appendCircle(12.6, -9.1, 0.26, 0.26)
          .fill(...ink),
      );
  }
}
