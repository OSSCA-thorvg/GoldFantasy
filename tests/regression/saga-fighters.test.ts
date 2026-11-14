import { describe, expect, it } from 'vitest';
import {
  identity,
  SceneNode,
  ShapeNode,
  type Matrix,
  type PaintNode,
} from '../../packages/native-renderer/src/paint';
import {
  allfatherStriking,
  brotherOnGuard,
  type Stance,
  type StrikeBeat,
} from '../../packages/native-renderer/src/saga-fighters';

const times = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[3],
  a[0] * b[1] + a[1] * b[4],
  a[0] * b[2] + a[1] * b[5] + a[2],
  a[3] * b[0] + a[4] * b[3],
  a[3] * b[1] + a[4] * b[4],
  a[3] * b[2] + a[4] * b[5] + a[5],
  0,
  0,
  1,
];
/** Every point the visible shapes under a node are drawn through, in the node's own space. */
function points(
  node: PaintNode,
  within: Matrix = identity,
  into: [number, number][] = [],
): [number, number][] {
  if (node.alpha === 0) return into;
  const m = times(within, node.matrix);
  if (node instanceof SceneNode) for (const child of node.children) points(child, m, into);
  else if (node instanceof ShapeNode)
    for (const command of node.commands)
      for (let i = 1; i + 1 < command.length; i += 2) {
        const x = Number(command[i]),
          y = Number(command[i + 1]);
        into.push([m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]);
      }
  return into;
}
const still: StrikeBeat = { stance: 'coiled', lean: 0, crouch: 0, spear: 0, gleam: 0, gust: 0 };
/** How far the points near the ground, and the points above it, moved between two drawings. */
function shift(before: [number, number][], after: [number, number][]): { feet: number; rest: number } {
  expect(after).toHaveLength(before.length);
  let feet = 0,
    rest = 0;
  before.forEach(([x, y], i) => {
    const moved = Math.hypot(after[i][0] - x, after[i][1] - y);
    if (y > -25) feet = Math.max(feet, moved);
    else rest = Math.max(rest, moved);
  });
  return { feet, rest };
}

describe('the saga fighters', () => {
  it.each<Stance>(['coiled', 'thrust', 'held'])(
    'keeps Odin planted in the %s pose while wind moves his cape and hair',
    (stance) => {
      const odin = allfatherStriking();
      odin.act({ ...still, stance }, 0);
      const calm = points(odin.scene);
      odin.act({ ...still, stance, gust: 3 }, 1.3);
      const { feet, rest } = shift(calm, points(odin.scene));
      expect(feet).toBe(0);
      expect(rest).toBeGreaterThan(8);
    },
  );
  it('levels the spear into the blow', () => {
    const odin = allfatherStriking(),
      reach = (stance: Stance): number => {
        odin.act({ ...still, stance }, 0);
        return Math.max(...points(odin.scene).map(([x]) => x));
      };
    // Cocked overhead the point is well short of where the thrust puts it.
    expect(reach('thrust') - reach('coiled')).toBeGreaterThan(250);
    expect(reach('thrust')).toBeGreaterThan(reach('held'));
  });
  it.each(['slate', 'ochre'] as const)('lets only the cloak of the %s brother blow', (kind) => {
    const brother = brotherOnGuard(kind),
      calm = points(brother.scene);
    brother.flutter(2.1, 3);
    const { feet, rest } = shift(calm, points(brother.scene));
    expect(feet).toBe(0);
    expect(rest).toBeGreaterThan(8);
  });
});
