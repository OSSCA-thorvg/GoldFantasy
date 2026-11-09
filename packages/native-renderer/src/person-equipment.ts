import { Activity, Calling, type Person } from '../../engine/src/person';
import { Structure } from '../../engine/src/building-catalog';
import { add, point } from '../../engine/src/geometry';
import { SceneNode, ShapeNode } from './paint';
import { poly, oval, stroke } from './sprite-primitives';
import type { PersonParts } from './world-sprites';

export const heldTools = ['axe', 'pickaxe', 'hammer', 'sword', 'bow', 'staff', 'mace'] as const;
export type HeldTool = (typeof heldTools)[number];

export function callingEquipment(calling: Calling): HeldTool | null {
  switch (calling) {
    case Calling.Warrior:
      return 'sword';
    case Calling.Ranger:
      return 'bow';
    case Calling.Mage:
    case Calling.Traveller:
      return 'staff';
    case Calling.Cleric:
      return 'mace';
    default:
      return null;
  }
}

/** Keep combat equipment tied to the worker's occupation, including interrupted work. */
export function combatEquipment(person: Person, workplace: Structure | undefined): HeldTool {
  const profession = callingEquipment(person.calling);
  if (profession) return profession;
  if (person.calling === Calling.Bard) return 'staff';
  if (workplace === Structure.Lumberyard || person.task === Activity.Felling) return 'axe';
  if (workplace === Structure.Quarry || person.task === Activity.Mining) return 'pickaxe';
  if (person.task === Activity.Building || person.task === Activity.Roadwork) return 'hammer';
  return 'sword';
}

/** Every tool is authored around its grip and belongs to the hand, never to the world. */
export function createEquipment(parts: PersonParts, calling: Calling): void {
  const wrist = parts.arms[1].wrist,
    p = (x: number, y: number) => add(wrist, point(x, y)),
    wood = [110, 82, 56] as const,
    steel = [150, 154, 166] as const,
    bright = [210, 214, 222] as const;
  const attach = (tool: HeldTool, paint: SceneNode) => {
    paint.opacity(0);
    parts.arms[1].hand!.add(paint);
    parts[tool] = paint;
  };
  const axe = new SceneNode();
  axe.add(stroke(p(-0.7, 1), p(6, -8), 1.4, wood));
  axe.add(poly([p(4.8, -9), p(9.5, -7), p(10, -3.7), p(5.8, -6)], steel));
  axe.add(stroke(p(9.5, -7), p(10, -3.7), 0.5, bright));
  attach('axe', axe);

  const pick = new SceneNode();
  pick.add(stroke(p(-0.7, 1), p(6, -8), 1.4, wood));
  pick.add(poly([p(1, -9), p(5.5, -11), p(10, -8), p(11, -5), p(7, -8), p(5, -9), p(1, -8)], steel));
  pick.add(stroke(p(1, -9), p(5.5, -11), 0.45, bright));
  attach('pickaxe', pick);

  const hammer = new SceneNode();
  hammer.add(stroke(p(-0.7, 1), p(5.3, -7.8), 1.4, wood));
  hammer.add(poly([p(3.1, -10), p(8.5, -6.4), p(10, -8.6), p(4.6, -12.2)], [120, 120, 130]));
  hammer.add(stroke(p(4.6, -12.2), p(10, -8.6), 0.6, bright));
  attach('hammer', hammer);

  const sword = new SceneNode();
  sword.add(stroke(p(-0.7, 1), p(1.3, -2), 1.3, [92, 68, 48]));
  sword.add(poly([p(0.6, -3), p(7.6, -13.4), p(7.8, -10.5), p(2.2, -1.8)], bright));
  sword.add(poly([p(1.5, -2.3), p(7.6, -13.4), p(7.8, -10.5), p(2.2, -1.8)], steel));
  sword.add(stroke(p(-0.5, -3.2), p(3.6, -0.5), 1.2, [174, 142, 83]));
  attach('sword', sword);

  const mace = new SceneNode();
  mace.add(stroke(p(-0.7, 1), p(5.6, -8.2), 1.4, wood));
  mace.add(poly([p(3.6, -9.7), p(5.6, -11.6), p(8.5, -9.7), p(8.2, -7), p(5.6, -6.2)], steel));
  mace.add(stroke(p(5.6, -11.1), p(5.6, -7), 0.7, bright));
  attach('mace', mace);

  const staff = new SceneNode();
  staff.add(stroke(p(-1.4, 4), p(5.5, -15), 1.3, wood));
  if (calling === Calling.Mage) {
    staff.add(oval(p(5.5, -15.8), 2.1, 2.4, [180, 156, 210]));
    staff.add(poly([p(5.5, -18.2), p(7, -15.8), p(5.5, -14), p(4.4, -15.8)], [226, 208, 243]));
  }
  attach('staff', staff);

  const bow = new SceneNode(),
    bowWood = new ShapeNode(),
    string = new ShapeNode();
  bowWood.moveTo(wrist.x - 1, wrist.y - 8);
  bowWood.cubicTo(wrist.x + 6, wrist.y - 5, wrist.x + 6, wrist.y + 5, wrist.x - 1, wrist.y + 8);
  bowWood.strokeWidth(1.3);
  bowWood.strokeFill(92, 68, 48);
  bow.add(bowWood).add(string);
  parts.bowString = string;
  const arrow = new SceneNode();
  arrow.add(stroke(p(-4, 0), p(9, 0), 0.65, [192, 174, 138]));
  arrow.add(poly([p(9, 0), p(6.8, -1), p(7.3, 0), p(6.8, 1)], bright));
  bow.add(arrow);
  parts.arrow = arrow;
  attach('bow', bow);
  poseBow(parts, 0);
  showEquipment(parts, callingEquipment(calling));
}

export function showEquipment(parts: PersonParts, tool: HeldTool | null): void {
  for (const name of heldTools) parts[name]?.opacity(name === tool ? 255 : 0);
}

export function poseBow(parts: PersonParts, draw: number): void {
  const wrist = parts.arms[1].wrist;
  parts.bowString
    ?.reset()
    .moveTo(wrist.x - 1, wrist.y - 8)
    .lineTo(wrist.x - 1 - draw * 3, wrist.y)
    .lineTo(wrist.x - 1, wrist.y + 8)
    .strokeWidth(0.55)
    .strokeFill(210, 200, 180);
  parts.arrow?.translate(-draw * 3, 0);
}
