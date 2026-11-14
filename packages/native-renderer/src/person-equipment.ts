import { Calling, type Person } from '../../engine/src/person';
import { Structure } from '../../engine/src/building-catalog';
import { combatItem, equippedItem, type ItemSpec } from '../../engine/src/equipment';
import { add, point } from '../../engine/src/geometry';
import { SceneNode, ShapeNode } from './paint';
import { poly, oval, stroke } from './sprite-primitives';
import type { PersonParts } from './world-sprites';

export const heldTools = [
  'axe',
  'pickaxe',
  'hammer',
  'sword',
  'bow',
  'staff',
  'mace',
  'hoe',
  'wateringCan',
  'saw',
  'shovel',
  'sickle',
  'knife',
  'spear',
] as const;
export type HeldTool = (typeof heldTools)[number];
/** What a tool's head or blade is made of; the haft is always wood. */
export type ToolMaterial = 'wood' | 'stone' | 'iron';
const materials: readonly ToolMaterial[] = ['wood', 'stone', 'iron'];
const isMaterial = (value: unknown): value is ToolMaterial => materials.some((m) => m === value);

/** An item's material: its own `material` once the catalogue states one, otherwise read from its id. */
export function materialOf(item: ItemSpec | null): ToolMaterial {
  if (!item) return 'iron';
  if ('material' in item && isMaterial(item.material)) return item.material;
  if (item.id.startsWith('wooden-') || item.workshop === Structure.Camp) return 'wood';
  if (item.id.startsWith('stone-')) return 'stone';
  return item.visual === 'bow' || item.visual === 'staff' ? 'wood' : 'iron';
}
/** The material of whichever equipped item is drawn as `tool`. */
export function heldMaterial(person: Person, tool: HeldTool | null): ToolMaterial {
  if (!tool) return 'iron';
  for (const slot of ['weapon', 'tool1', 'tool2'] as const) {
    const item = equippedItem(person, slot);
    if (item?.visual === tool) return materialOf(item);
  }
  return 'iron';
}

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

/** Work and combat display the item actually equipped in the resident's inventory. */
export function combatEquipment(person: Person, _workplace?: Structure): HeldTool | null {
  return combatItem(person)?.visual ?? null;
}

/**
 * Every tool is authored around its grip and belongs to the hand, never to the world. A tool
 * whose head can be wood, stone or iron carries one head per material; showEquipment picks.
 */
export function createEquipment(parts: PersonParts, calling: Calling): void {
  const wrist = parts.arms[1].wrist,
    p = (x: number, y: number) => add(wrist, point(x, y)),
    wood = [110, 82, 56] as const,
    steel = [150, 154, 166] as const,
    bright = [210, 214, 222] as const,
    // Carved wood is pale and warm with a darker grain; knapped stone is a flat grey lashed on with cord.
    carved = [188, 150, 102] as const,
    grain = [136, 102, 66] as const,
    flint = [136, 136, 132] as const,
    flintDark = [98, 98, 100] as const,
    cord = [206, 182, 132] as const;
  const attach = (tool: HeldTool, paint: SceneNode) => {
    paint.opacity(0);
    parts.arms[1].hand!.add(paint);
    parts[tool] = paint;
  };
  /** Adds one head per material to `tool`, each drawn by `head`. */
  const heads = (
    tool: HeldTool,
    paint: SceneNode,
    head: (
      material: ToolMaterial,
      fill: readonly [number, number, number],
      shade: readonly [number, number, number],
      edge: readonly [number, number, number],
    ) => SceneNode,
  ) => {
    const made = {
      wood: head('wood', carved, grain, grain),
      stone: head('stone', flint, flintDark, flintDark),
      iron: head('iron', steel, [91, 96, 106], bright),
    };
    for (const material of materials) paint.add(made[material].opacity(material === 'iron' ? 255 : 0));
    parts.toolHeads[tool] = made;
    attach(tool, paint);
  };
  const along = (shaft: number, across: number) => p(shaft * 0.6 + across * 0.8, shaft * -0.8 + across * 0.6);
  /** Two turns of cord where a stone head is bound to its haft. */
  const lashing = (scene: SceneNode, at: number) => {
    scene.add(stroke(along(at, -1.1), along(at + 0.5, 1.1), 0.6, cord));
    scene.add(stroke(along(at + 0.9, -1.1), along(at + 1.4, 1.1), 0.6, cord));
  };

  const axe = new SceneNode();
  axe.add(stroke(along(-1, 0), along(9.5, 0), 1.35, wood));
  // The blade flares across the shaft, with a lower beard and a curved cutting
  // edge. Its neck remains visibly fitted around the wooden handle.
  heads('axe', axe, (material, fill, shade, edgeColor) => {
    const scene = new SceneNode(),
      blade = new ShapeNode(),
      edge = new ShapeNode(),
      // A stone axe is a short wedge; wood and iron share the bearded blade.
      reach = material === 'stone' ? 0.7 : 1;
    const a = along(8, -0.65),
      b = along(9.8, -0.65),
      c = along(10.4, 3.5 * reach),
      d = along(7, 5.2 * reach);
    blade.moveTo(a.x, a.y).lineTo(b.x, b.y).lineTo(c.x, c.y);
    const e0 = along(10, 4.4 * reach),
      e1 = along(8.8, 5.1 * reach);
    blade.cubicTo(e0.x, e0.y, e1.x, e1.y, d.x, d.y);
    for (const q of [along(6.1, 2.8 * reach), along(7.6, 2.65 * reach), along(8.2, 0.6)])
      blade.lineTo(q.x, q.y);
    blade.close().fill(...fill);
    edge
      .moveTo(c.x, c.y)
      .cubicTo(e0.x, e0.y, e1.x, e1.y, d.x, d.y)
      .strokeWidth(0.55)
      .strokeFill(...edgeColor);
    scene.add(blade).add(edge);
    if (material === 'iron') scene.add(stroke(along(8.1, -0.5), along(9.4, -0.5), 0.7, shade));
    else if (material === 'wood') scene.add(stroke(along(8.6, 0.6), along(8.3, 3.6), 0.45, shade));
    else lashing(scene, 7.6);
    return scene;
  });

  const pick = new SceneNode();
  pick.add(stroke(p(-0.7, 1), p(6, -8), 1.4, wood));
  heads('pickaxe', pick, (material, fill, shade, edgeColor) => {
    const scene = new SceneNode();
    scene.add(poly([p(1, -9), p(5.5, -11), p(10, -8), p(11, -5), p(7, -8), p(5, -9), p(1, -8)], fill));
    scene.add(stroke(p(1, -9), p(5.5, -11), 0.45, edgeColor));
    if (material === 'stone') {
      scene.add(stroke(p(4.6, -10.4), p(6.2, -8.2), 0.6, cord));
      scene.add(stroke(p(5.6, -10.8), p(7.2, -8.6), 0.6, cord));
    } else if (material === 'wood') scene.add(stroke(p(6, -9.6), p(9.6, -7.2), 0.4, shade));
    return scene;
  });

  const hammer = new SceneNode();
  hammer.add(stroke(along(-0.8, 0), along(6.2, 0), 1.4, wood));
  heads('hammer', hammer, (material, fill, shade, edgeColor) => {
    const scene = new SceneNode(),
      // A wooden mallet has a fat head; stone and iron are narrower and heavier-looking.
      half = material === 'wood' ? 3.4 : 2.7,
      top = material === 'wood' ? 8.6 : 8;
    scene.add(
      poly(
        [along(5.8, -half), along(5.8, half), along(top, half), along(top, -half)],
        material === 'iron' ? [120, 120, 130] : fill,
      ),
    );
    scene.add(
      poly([along(5.8, half - 0.8), along(5.8, half), along(top, half), along(top, half - 0.8)], shade),
    );
    if (material === 'wood') {
      scene.add(oval(along((5.8 + top) / 2, -half), 0.5, 1.2, shade));
      scene.add(stroke(along(6.6, -half + 0.6), along(6.6, half - 1), 0.35, shade));
    } else if (material === 'stone') lashing(scene, 6.2);
    else scene.add(stroke(along(top, -half), along(top, half), 0.55, edgeColor));
    return scene;
  });

  const sword = new SceneNode();
  sword.add(stroke(p(-0.7, 1), p(1.3, -2), 1.3, [92, 68, 48]));
  heads('sword', sword, (material, fill, shade) => {
    const scene = new SceneNode();
    if (material === 'iron') {
      scene.add(poly([p(0.6, -3), p(7.6, -13.4), p(7.8, -10.5), p(2.2, -1.8)], bright));
      scene.add(poly([p(1.5, -2.3), p(7.6, -13.4), p(7.8, -10.5), p(2.2, -1.8)], steel));
      scene.add(stroke(p(-0.5, -3.2), p(3.6, -0.5), 1.2, [174, 142, 83]));
    } else {
      // A practice blade: one thick lath with a rounded point and a plain cross-piece.
      scene.add(poly([p(0.5, -3), p(6.6, -12.4), p(7.6, -12.9), p(7.9, -11.6), p(2.3, -1.9)], fill));
      scene.add(stroke(p(1.8, -3.2), p(7, -11.6), 0.4, shade));
      scene.add(stroke(p(-0.4, -3.1), p(3.5, -0.6), 1.1, material === 'wood' ? shade : cord));
    }
    return scene;
  });

  const mace = new SceneNode();
  heads('mace', mace, (material, fill, shade, edgeColor) => {
    const scene = new SceneNode();
    if (material === 'wood') {
      // A club: one piece of wood swelling to a knotted end.
      scene.add(
        poly([p(-1.2, 0.6), p(-0.2, 1.4), p(7.6, -7.4), p(8.4, -10), p(6.4, -11.4), p(3.8, -9.8)], fill),
      );
      scene.add(oval(p(6.4, -9.2), 0.7, 0.9, shade));
      scene.add(oval(p(4.6, -7), 0.5, 0.7, shade));
      return scene;
    }
    scene.add(stroke(p(-0.7, 1), p(5.6, -8.2), 1.4, wood));
    scene.add(poly([p(3.6, -9.7), p(5.6, -11.6), p(8.5, -9.7), p(8.2, -7), p(5.6, -6.2)], fill));
    if (material === 'stone') {
      scene.add(stroke(p(3.9, -7.6), p(6.4, -6.2), 0.6, cord));
      scene.add(stroke(p(3.6, -8.6), p(6.9, -6.6), 0.6, cord));
    } else scene.add(stroke(p(5.6, -11.1), p(5.6, -7), 0.7, edgeColor));
    return scene;
  });

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
  const hoe = new SceneNode();
  hoe.add(stroke(p(-1, 1), p(6, -9), 1.2, wood));
  heads('hoe', hoe, (material, fill, shade) => {
    const scene = new SceneNode();
    scene.add(poly([p(5, -10), p(9, -8), p(9, -5.8), p(5, -7.5)], fill));
    if (material === 'stone') scene.add(stroke(p(4.6, -9.6), p(5.8, -7.4), 0.6, cord));
    else if (material === 'wood') scene.add(stroke(p(6, -9), p(8.6, -6.6), 0.4, shade));
    return scene;
  });
  const shovel = new SceneNode();
  shovel.add(stroke(along(-1.4, 0), along(8.4, 0), 1.2, wood));
  shovel.add(stroke(along(-1.4, -1.1), along(-1.4, 1.1), 1, wood));
  heads('shovel', shovel, (material, fill, shade, edgeColor) => {
    const scene = new SceneNode(),
      blade = new ShapeNode(),
      a = along(8, -1.9),
      b = along(8, 1.9),
      c = along(12.6, 0),
      l = along(11.4, 2.2),
      r = along(11.4, -2.2);
    blade
      .moveTo(a.x, a.y)
      .lineTo(b.x, b.y)
      .cubicTo(l.x, l.y, c.x, c.y, c.x, c.y)
      .cubicTo(c.x, c.y, r.x, r.y, a.x, a.y);
    scene.add(blade.close().fill(...fill));
    scene.add(stroke(along(8.4, 0), along(11.6, 0), 0.4, material === 'iron' ? edgeColor : shade));
    if (material === 'stone') lashing(scene, 7);
    return scene;
  });
  const sickle = new SceneNode();
  sickle.add(stroke(along(-0.8, 0), along(3.4, 0), 1.3, wood));
  heads('sickle', sickle, (material, fill, shade, edgeColor) => {
    const scene = new SceneNode(),
      hook = new ShapeNode(),
      a = along(3.2, 0),
      c1 = along(8.6, -1.4),
      c2 = along(10.4, 3.4),
      tip = along(6, 6.2);
    hook.moveTo(a.x, a.y).cubicTo(c1.x, c1.y, c2.x, c2.y, tip.x, tip.y);
    scene.add(
      hook
        .strokeWidth(1.5)
        .strokeCap('round')
        .strokeFill(...fill),
    );
    if (material === 'iron') {
      const edge = new ShapeNode(),
        e1 = along(8, -0.6),
        e2 = along(9.4, 3.2);
      edge.moveTo(a.x, a.y).cubicTo(e1.x, e1.y, e2.x, e2.y, tip.x, tip.y);
      scene.add(edge.strokeWidth(0.4).strokeFill(...edgeColor));
    } else if (material === 'stone') lashing(scene, 2.6);
    else scene.add(stroke(along(5.4, 0.4), along(7.6, 2.4), 0.35, shade));
    return scene;
  });
  const knife = new SceneNode();
  knife.add(stroke(p(-0.9, 1.2), p(1, -1.4), 1.3, [92, 68, 48]));
  heads('knife', knife, (material, fill, shade, edgeColor) => {
    const scene = new SceneNode();
    scene.add(poly([p(0.5, -1.9), p(3.9, -7.4), p(4.6, -6.3), p(2, -0.9)], fill));
    scene.add(stroke(p(1.2, -1.8), p(4, -7), 0.35, material === 'iron' ? edgeColor : shade));
    if (material === 'stone') scene.add(stroke(p(0.2, -1.7), p(2.2, -0.5), 0.6, cord));
    return scene;
  });
  const spear = new SceneNode();
  spear.add(stroke(along(-6, 0), along(13, 0), 1.15, wood));
  heads('spear', spear, (material, fill, shade, edgeColor) => {
    const scene = new SceneNode();
    if (material === 'wood') {
      // A fire-hardened point: the shaft itself whittled sharp and darkened.
      scene.add(poly([along(12.4, -0.6), along(12.4, 0.6), along(16.2, 0)], shade));
      return scene;
    }
    scene.add(poly([along(12.6, 0), along(14, 1.3), along(17.4, 0), along(14, -1.3)], fill));
    scene.add(stroke(along(13.2, 0), along(17, 0), 0.35, edgeColor));
    if (material === 'stone') lashing(scene, 11.4);
    return scene;
  });
  const can = new SceneNode();
  can.add(poly([p(0, -1), p(5, -1.3), p(6, 3.4), p(0.5, 3.8)], [101, 140, 143]));
  can.add(poly([p(3, -1.2), p(5, -1.3), p(6, 3.4), p(3, 3.6)], [71, 111, 117]));
  can.add(stroke(p(4, 1), p(9, -1.5), 1.6, [126, 163, 161]));
  can.add(oval(p(9, -1.5), 1.3, 0.8, [161, 181, 165]));
  const handle = new ShapeNode()
    .moveTo(wrist.x + 0.7, wrist.y)
    .cubicTo(wrist.x - 3, wrist.y - 5, wrist.x + 5, wrist.y - 5, wrist.x + 4.5, wrist.y);
  handle.strokeWidth(0.85).strokeFill(155, 175, 159);
  can.add(handle);
  attach('wateringCan', can);
  const saw = new SceneNode();
  saw.add(
    poly(
      [
        p(1, -1),
        p(12, -2.5),
        p(11, 0),
        p(10, 1),
        p(9, 0.3),
        p(8, 1.5),
        p(7, 0.8),
        p(6, 2),
        p(5, 1.3),
        p(4, 2.5),
        p(2, 2.7),
      ],
      steel,
    ),
  );
  saw.add(oval(p(0, 0), 2, 2.5, [119, 78, 46]));
  saw.add(oval(p(0, 0), 0.85, 1.25, [47, 40, 31]));
  attach('saw', saw);
  const chisel = new SceneNode(),
    left = parts.arms[0].wrist;
  chisel.add(stroke(left, add(left, point(5, 3)), 0.9, steel));
  chisel.add(stroke(add(left, point(-1, -0.6)), add(left, point(1, 0.6)), 1.6, wood));
  chisel.opacity(0);
  parts.arms[0].hand!.add(chisel);
  parts.chisel = chisel;
  poseBow(parts, 0);
  showEquipment(parts, null);
}

export function showEquipment(
  parts: PersonParts,
  tool: HeldTool | null,
  material: ToolMaterial = 'iron',
): void {
  for (const name of heldTools) parts[name]?.opacity(name === tool ? 255 : 0);
  const made = tool ? parts.toolHeads[tool] : undefined;
  if (made) for (const name of materials) made[name].opacity(name === material ? 255 : 0);
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
