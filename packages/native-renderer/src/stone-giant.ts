import { SceneNode, type Rgb } from './paint';
import { poly, oval, stroke, opaque } from './sprite-primitives';
import { f32 } from '../../engine/src/numeric';
const glint: Rgb = [98, 102, 112],
  lit: Rgb = [78, 82, 92],
  stone: Rgb = [58, 61, 70],
  shade: Rgb = [42, 44, 54],
  deep: Rgb = [30, 32, 40];
const rime: Rgb = [136, 156, 182],
  crack: Rgb = [23, 26, 33];
export function stoneGiantHead(): SceneNode {
  const head = new SceneNode();
  head.add(
    poly(
      [
        [-7, -4],
        [-5, -10],
        [0, -11],
        [5, -10],
        [7, -4],
        [6, 5],
        [3, 9],
        [-3, 9],
        [-6, 5],
      ],
      opaque(stone),
    ),
  );
  head.add(
    poly(
      [
        [-7, -4],
        [-5, -10],
        [0, -11],
        [0, 6],
        [-4, 7],
        [-6, 3],
      ],
      opaque(lit),
    ),
  );
  head.add(
    poly(
      [
        [0, -11],
        [5, -10],
        [7, -4],
        [5, -5],
        [2, -7],
        [-3, -6],
        [-6, -3],
        [-7, -4],
      ],
      opaque(shade),
    ),
  );
  head.add(
    poly(
      [
        [-5, -9],
        [-1, -10],
        [-3, -8],
        [-5, -5],
        [-6, -4],
      ],
      opaque(glint),
    ),
  );
  head.add(
    poly(
      [
        [4, -9],
        [5, -8],
        [6, -5],
        [5, -5],
      ],
      opaque(rime),
    ),
  );
  for (const side of [-1, 1]) {
    head.add(
      poly(
        [
          [f32(side * f32(1.1)), -f32(3.1)],
          [f32(side * f32(5.1)), -f32(3.5)],
          [f32(side * f32(4.8)), -f32(1.7)],
          [f32(side * f32(1.3)), -f32(1.6)],
        ],
        opaque(deep),
      ),
    );
    head.add(stroke([f32(side * f32(1.8)), -f32(2.3)], [f32(side * 4), -f32(2.5)], f32(0.35), opaque(rime)));
  }
  head.add(
    poly(
      [
        [0, -3],
        [-f32(1.4), f32(1.8)],
        [f32(1.6), f32(2.2)],
        [1, -f32(0.6)],
      ],
      opaque(glint),
    ),
  );
  head.add(
    poly(
      [
        [-f32(5.7), f32(1.6)],
        [-2, f32(3.5)],
        [0, f32(2.7)],
        [2, f32(3.5)],
        [f32(5.7), f32(1.6)],
        [f32(4.9), 7],
        [0, 12],
        [-f32(4.9), 7],
      ],
      opaque(shade),
    ),
  );
  head.add(
    poly(
      [
        [-5, f32(2.6)],
        [-2, 4],
        [0, f32(4.5)],
        [0, 11],
        [-f32(3.6), 7],
      ],
      opaque(stone),
    ),
  );
  head.add(stroke([-2, f32(4.8)], [2, f32(4.8)], f32(0.45), opaque(deep)));
  head.add(stroke([-f32(4.1), -6], [-f32(2.8), -f32(4.5)], f32(0.3), opaque(crack)));
  head.add(stroke([f32(3.2), f32(5.9)], [f32(1.2), 9], f32(0.35), opaque(deep)));
  return head;
}
export function stoneGiantSprite(): SceneNode {
  const body = new SceneNode();
  body.add(oval([0, f32(0.2)], 12, 4, [0, 0, 0, 100]));
  for (const side of [-1, 1]) {
    const color = side < 0 ? stone : shade;
    body.add(
      poly(
        [
          [f32(side * 2), -18],
          [f32(side * f32(7.5)), -17],
          [f32(side * 7), -4],
          [f32(side * 9), -f32(0.5)],
          [f32(side * 8), 1],
          [f32(side * 2), f32(0.4)],
          [f32(side * f32(1.5)), -8],
        ],
        opaque(color),
      ),
    );
    body.add(
      poly(
        [
          [f32(side * f32(4.3)), -16],
          [f32(side * f32(6.8)), -15],
          [f32(side * f32(6.3)), -5],
          [f32(side * f32(4.4)), -4],
        ],
        opaque(side < 0 ? lit : stone),
      ),
    );
    body.add(
      poly(
        [
          [f32(side * 6), -31],
          [f32(side * 11), -30],
          [f32(side * 14), -24],
          [f32(side * f32(13.6)), -14],
          [f32(side * 11), -12],
          [f32(side * f32(8.5)), -14],
          [f32(side * f32(8.8)), -23],
        ],
        opaque(color),
      ),
    );
    body.add(
      poly(
        [
          [f32(side * 7), -30],
          [f32(side * f32(10.5)), -29],
          [f32(side * f32(12.2)), -24],
          [f32(side * f32(9.6)), -22],
        ],
        opaque(side < 0 ? lit : stone),
      ),
    );
    body.add(stroke([f32(side * 10), -18], [f32(side * 12), -17], f32(0.4), opaque(deep)));
  }
  body.add(
    poly(
      [
        [-8, -30],
        [-4, -33],
        [4, -33],
        [8, -30],
        [8, -23],
        [5, -16],
        [-5, -16],
        [-8, -23],
      ],
      opaque(stone),
    ),
  );
  body.add(
    poly(
      [
        [-8, -30],
        [-4, -33],
        [0, -32],
        [0, -17],
        [-5, -16],
        [-7, -23],
      ],
      opaque(lit),
    ),
  );
  body.add(
    poly(
      [
        [0, -29],
        [f32(6.5), -30],
        [7, -25],
        [2, -23],
        [0, -24],
      ],
      opaque(shade),
    ),
  );
  body.add(
    poly(
      [
        [-f32(6.5), -30],
        [-1, -30],
        [-1, -25],
        [-f32(5.5), -24],
      ],
      opaque(glint),
    ),
  );
  body.add(
    poly(
      [
        [-6, -19],
        [0, -20],
        [6, -19],
        [5, -16],
        [-5, -16],
      ],
      opaque(shade),
    ),
  );
  body.add(stroke([-f32(5.8), -28], [-3, -26], f32(0.35), opaque(deep)));
  body.add(stroke([-3, -26], [-f32(3.5), -23], f32(0.35), opaque(deep)));
  body.add(
    poly(
      [
        [f32(9.6), -28],
        [f32(10.7), -27],
        [12, -24],
        [f32(11.2), -24],
      ],
      opaque(rime),
    ),
  );
  const head = stoneGiantHead();
  head.translate(0, -36);
  body.add(head);
  return body;
}
