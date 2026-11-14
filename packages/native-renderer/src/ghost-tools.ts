// Plain outlines of what a hidden unit holds, one per shape class, drawn around the grip the way the
// real tools are (person-equipment.ts, held-weapon-art.ts): wrist at the origin, pointing up and ahead.
import type { HeldTool } from './person-equipment';
import { Trace } from './ghost-trace';

/** A point `shaft` up the haft from the grip and `across` it toward the cutting side. */
const along = (shaft: number, across = 0): [number, number] => [
  shaft * 0.6 + across * 0.8,
  shaft * -0.8 + across * 0.6,
];
const run = (...points: [number, number][]): number[] => points.flat();

function toolOutline(tool: HeldTool): Trace {
  const t = new Trace();
  switch (tool) {
    case 'axe':
      return t
        .polyline(...run(along(-1), along(9.6)))
        .polygon(...run(along(8.2, 0.6), along(10.4, 3.5), along(9.4, 4.9), along(7, 5.2), along(6.6, 2.6)));
    case 'pickaxe':
      return t
        .polyline(-0.7, 1, 5.6, -8.6)
        .polygon(1, -9, 5.5, -11, 10, -8, 11, -5, 7, -8.2, 5, -8.8);
    case 'hammer':
      return t
        .polyline(...run(along(-0.8), along(5.8)))
        .polygon(...run(along(5.8, -2.8), along(5.8, 2.8), along(8.2, 2.8), along(8.2, -2.8)));
    case 'sword':
      return t
        .polyline(-0.7, 1, 1, -1.6)
        .polyline(-0.5, -3.2, 3.6, -0.5)
        .polygon(0.9, -2.7, 7.6, -13.4, 7.8, -10.5, 2.4, -1.6);
    case 'mace':
      return t.polyline(-0.7, 1, 4.4, -6.8).polygon(3.6, -9.7, 5.6, -11.6, 8.5, -9.7, 8.2, -7, 5.6, -6.2);
    case 'staff':
      return t.polyline(-1.4, 4, 5, -13.6).oval(5.5, -15.2, 1.5);
    case 'bow':
      return t.moveTo(-1, -8).cubicTo(6, -5, 6, 5, -1, 8).close();
    case 'hoe':
      return t.polyline(-1, 1, 5.4, -8.2).polygon(5, -10, 9, -8, 9, -5.8, 5, -7.5);
    case 'shovel':
      return t
        .polyline(...run(along(-1.4), along(8)))
        .polygon(...run(along(8, -1.9), along(8, 1.9), along(11.4, 2), along(12.6), along(11.4, -2)));
    case 'sickle': {
      const [ax, ay] = along(3.2),
        [bx, by] = along(8.6, -1.4),
        [cx, cy] = along(10.4, 3.4),
        [dx, dy] = along(6, 6.2);
      return t.polyline(...run(along(-0.8), along(3.2))).moveTo(ax, ay).cubicTo(bx, by, cx, cy, dx, dy);
    }
    case 'knife':
      return t.polyline(-0.9, 1.2, 0.6, -1).polygon(0.5, -1.9, 3.9, -7.4, 4.6, -6.3, 2, -0.9);
    case 'spear':
      return t
        .polyline(...run(along(-6), along(12.6)))
        .polygon(...run(along(12.6), along(14, 1.3), along(17.4), along(14, -1.3)));
    case 'saw':
      return t.oval(0, 0, 1.6, 2).polygon(1.4, -1, 12, -2.5, 11, 0.6, 2, 2.6);
    case 'wateringCan':
      return t.polygon(0, -1, 5, -1.3, 6, 3.4, 0.5, 3.8).polyline(5.2, 0.4, 9, -1.5);
  }
}
const tools = new Map<HeldTool, Trace>();
/** The outline of a resident's tool around the grip. */
export function toolTrace(tool: HeldTool): Trace {
  let trace = tools.get(tool);
  if (!trace) tools.set(tool, (trace = toolOutline(tool)));
  return trace;
}

/** What a monster's blow says it carries: a heavy head, a blade or a long point. */
export type WeaponClass = 'club' | 'blade' | 'spear';
const weapons: Record<WeaponClass, Trace> = {
  club: new Trace()
    .polyline(...run(along(-1.4), along(5.6)))
    .polygon(...run(along(5.6, -1.2), along(9.6, -1.6), along(10.4), along(9.6, 1.6), along(5.6, 1.2))),
  blade: new Trace()
    .polyline(...run(along(-1.2), along(1.2)))
    .polyline(...run(along(1.2, -1.6), along(1.2, 1.6)))
    .polygon(...run(along(1.2, -0.6), along(9.4, -0.5), along(10.6), along(9.4, 1.2), along(1.2, 0.9))),
  spear: new Trace()
    .polyline(...run(along(-6), along(12.4)))
    .polygon(...run(along(12.4), along(13.8, 1.2), along(16.8), along(13.8, -1.2))),
};
export const weaponTrace = (weapon: WeaponClass): Trace => weapons[weapon];

/** A face's outline in head units: two wide, crown at -0.94 and chin at 0.9 (likeness-head.ts). */
export const faceTrace = new Trace().oval(0, -0.02, 1, 0.92);
