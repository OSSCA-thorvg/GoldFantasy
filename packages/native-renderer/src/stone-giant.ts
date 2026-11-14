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
