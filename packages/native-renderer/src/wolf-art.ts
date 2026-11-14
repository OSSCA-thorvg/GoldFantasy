// A wolf's art over the four-legged skeleton, shared by the wild wolf and the cave warg.
import { ShapeNode, type Rgb } from './paint';
import { capsules, discs, fills, type RigSkin } from './rig-skin';

export interface WolfCoat {
  fur: Rgb;
  /** Along the back and the ruff. */
  lit: Rgb;
  /** Far legs, tail, the far ear and the jaw. */
  shade: Rgb;
  eye: Rgb;
}
/** A whole leg as one stroke: upper joint, hock or wrist, paw. */
export const stridingLeg = (color: Rgb, x: number, bend: number, width = 1.5): ShapeNode =>
  new ShapeNode()
    .moveTo(x, -5.6)
    .lineTo(x + bend, -2.8)
    .lineTo(x, -0.75)
    .lineTo(x + 1.1, -0.75)
    .strokeWidth(width)
    .strokeFill(...color)
    .strokeCap('round')
    .strokeJoin('round');
/** Dresses `skin` as a wolf. `lean` drops the far legs and fine marks, for a pack drawn by the dozen. */
export function dressWolf(skin: RigSkin, coat: WolfCoat, lean = false): void {
  const { fur, lit, shade, eye } = coat,
    ink: Rgb = [26, 24, 32];
  skin.piece(
    'tail',
    fills(shade, [
      [-6.2, -8.3],
      [-10.6, -9.8],
      [-12.8, -7.4],
      [-10.2, -6.1],
      [-6.4, -6.3],
    ]),
  );
  // Legs on the far side sit in the body's own shade.
  if (!lean) {
    skin.piece('leg.hl.1', stridingLeg(shade, -5.6, -1));
    skin.piece('leg.fl.1', stridingLeg(shade, 1.8, 0.2));
  }
  const rump = [
    fills(fur, [
      [-8.2, -8.6],
      [-4, -10.1],
      [1.2, -9.7],
      [1.8, -4.4],
      [-3, -3.5],
      [-7.6, -4.6],
    ]),
  ];
  // The pale stripe along the back.
  if (!lean)
    rump.push(
      fills(lit, [
        [-8, -8.7],
        [-4, -10.1],
        [1.2, -9.7],
        [0.8, -8.5],
        [-4, -8.7],
      ]),
    );
  skin.piece('hips', ...rump);
  skin.piece('leg.hr.1', stridingLeg(fur, -4.6, -1));
  skin.piece(
    'chest',
    fills(fur, [
      [-1.4, -9.9],
      [3.6, -10.6],
      [6.2, -8.6],
      [5.4, -4.9],
      [2, -3.5],
      [-1.2, -4.2],
    ]),
  );
  skin.piece('leg.fr.1', stridingLeg(fur, 2.8, 0.2));
  // The ruff bristles along the neck.
  skin.piece(
    'neck',
    fills(lit, [
      [2.6, -10.4],
      [4.2, -11.6],
      [5, -10.6],
      [6.2, -11.8],
      [7.4, -10.6],
      [8, -8.4],
      [5.4, -6.4],
      [3, -7.4],
    ]),
  );
  skin.piece(
    'jaw',
    fills(shade, [
      [7.6, -8.8],
      [12, -8.5],
      [11.3, -7.6],
      [8, -7.5],
    ]),
    fills(
      [234, 226, 206],
      [
        [9.5, -8.6],
        [9.9, -9.3],
        [10.3, -8.6],
      ],
      [
        [10.7, -8.55],
        [11.1, -9.2],
        [11.5, -8.5],
      ],
    ),
  );
  skin.piece(
    'head',
    fills(shade, [
      [6.1, -11.2],
      [6.5, -13.8],
      [7.9, -11.4],
    ]),
    fills(
      fur,
      [
        [5.6, -11.5],
        [8.8, -11.7],
        [12.5, -9.5],
        [12.8, -8.5],
        [9.2, -8.1],
        [6.2, -8.3],
      ],
      [
        [7.4, -11.5],
        [8.5, -14],
        [9.3, -11.3],
      ],
    ),
    discs(eye, [9.5, -10.3, 0.62, 0.42]),
    capsules(0.4, ink, [8.7, -10.95, 10.3, -10.6])
      .appendCircle(12.5, -9.1, 0.3, 0.3)
      .fill(...ink),
  );
}
