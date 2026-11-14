// Weapons a monster carries, drawn the way residents' tools are: around the grip, pointing up and
// ahead of a resting hand, so every armed figure can swing them with the same clips.
import { point, type Point } from '../../engine/src/geometry';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { poly, oval, stroke } from './sprite-primitives';
import { dusk } from './form-paint';

export type HeldWeapon = 'club' | 'cleaver' | 'spear' | 'blade' | 'axe' | 'maul';
/** A point `shaft` up the weapon from the grip and `across` it toward the cutting side. */
const along = (shaft: number, across = 0): Point =>
  point(shaft * 0.6 + across * 0.8, shaft * -0.8 + across * 0.6);
const wood: Rgb = [122, 92, 62],
  iron: Rgb = [124, 120, 122],
  edge: Rgb = [190, 184, 174],
  rust: Rgb = [164, 92, 58];

export function heldWeaponArt(kind: HeldWeapon): SceneNode {
  const art = new SceneNode(),
    shade = dusk(wood, 0.3);
  switch (kind) {
    case 'club': {
      // A root-knot club, thickest near its end.
      art.add(
        poly(
          [
            along(-1.4, -0.45),
            along(5.5, -1.1),
            along(9.4, -1.5),
            along(10.2, 0),
            along(9.4, 1.5),
            along(5.5, 1.1),
            along(-1.4, 0.45),
          ],
          wood,
        ),
      );
      art.add(
        poly(
          [
            along(-1.4, 0),
            along(5.5, 0.2),
            along(9.4, 0.3),
            along(10.2, 0),
            along(9.4, 1.5),
            along(5.5, 1.1),
            along(-1.4, 0.45),
          ],
          shade,
        ),
      );
      art.add(oval(along(7.4, -0.5), 0.5, 0.5, shade));
      art.add(oval(along(8.9, 0.6), 0.4, 0.4, dusk(wood, 0.5)));
      break;
    }
    case 'cleaver': {
      art.add(stroke(along(-0.9), along(2), 1.1, wood));
      art.add(poly([along(1.5, -0.7), along(6.8, -1.1), along(7.3, 2.1), along(1.9, 1.7)], iron));
      art.add(poly([along(4.4, 1.9), along(7.3, 2.1), along(6.9, 0.2)], rust));
      art.add(stroke(along(1.9, 1.7), along(7.3, 2.1), 0.45, edge));
      break;
    }
    case 'spear': {
      art.add(stroke(along(-5.5), along(11), 0.8, wood));
      art.add(poly([along(10.4, -1), along(14.4, 0), along(10.4, 1), along(11.1, 0)], iron));
      art.add(poly([along(11.1, 0), along(14.4, 0), along(10.4, 1)], dusk(iron, 0.3)));
      art.add(stroke(along(9.6), along(10.5), 1.3, rust));
      break;
    }
    case 'blade': {
      // A sword gone to rust: notched, its fuller eaten away.
      art.add(stroke(along(-1), along(1.4), 1.1, [84, 62, 46]));
      art.add(stroke(along(1.5, -1.5), along(1.5, 1.5), 0.9, dusk(rust, 0.2)));
      art.add(
        poly(
          [
            along(1.6, -0.75),
            along(10.6, -0.5),
            along(12.2, 0),
            along(10.2, 0.7),
            along(7.4, 0.3),
            along(6.9, 0.8),
            along(1.6, 0.75),
          ],
          iron,
        ),
      );
      art.add(
        poly(
          [
            along(1.6, 0),
            along(12.2, 0),
            along(10.2, 0.7),
            along(7.4, 0.3),
            along(6.9, 0.8),
            along(1.6, 0.75),
          ],
          dusk(iron, 0.3),
        ),
      );
      art.add(poly([along(3.2, -0.7), along(5.2, -0.6), along(4.4, 0.1)], rust));
      break;
    }
    case 'axe': {
      art.add(stroke(along(-1.2), along(9.4), 1.15, wood));
      const blade = new ShapeNode(),
        a = along(7.4, 0.3),
        b = along(9.6, 0.3),
        c = along(10.6, 3.8),
        d = along(6.2, 4.6),
        e0 = along(10, 5),
        e1 = along(8, 5.6);
      blade
        .moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .lineTo(c.x, c.y)
        .cubicTo(e0.x, e0.y, e1.x, e1.y, d.x, d.y)
        .close();
      art.add(blade.fill(...iron));
      art.add(poly([along(8.2, 0.9), along(9.9, 1.2), along(9.2, 2.6)], rust));
      art.add(
        new ShapeNode()
          .moveTo(c.x, c.y)
          .cubicTo(e0.x, e0.y, e1.x, e1.y, d.x, d.y)
          .strokeWidth(0.5)
          .strokeFill(...edge),
      );
      break;
    }
    case 'maul': {
      // A young tree for a handle and a boulder lashed to it.
      const stone: Rgb = [112, 116, 130];
      art.add(stroke(along(-3), along(15), 2.3, wood));
      art.add(stroke(along(-3, 0.5), along(15, 0.5), 0.9, shade));
      art.add(
        poly(
          [
            along(13, -4.2),
            along(17.5, -5),
            along(21.4, -2.6),
            along(21.8, 2.2),
            along(18.2, 4.8),
            along(13.6, 3.8),
            along(12.2, 0),
          ],
          stone,
        ),
      );
      art.add(
        poly(
          [along(17.4, 0.6), along(21.8, 2.2), along(18.2, 4.8), along(13.6, 3.8), along(12.2, 0)],
          dusk(stone, 0.34),
        ),
      );
      art.add(
        poly([along(14.4, -3.2), along(17.3, -4), along(18.6, -1.8), along(15.6, -1)], [150, 154, 164]),
      );
      for (const at of [13.4, 15.2])
        art.add(stroke(along(at, -2.2), along(at + 0.6, 2.4), 0.7, [196, 172, 124]));
      break;
    }
  }
  return art;
}
/** A weapon set in a hand that rests at (`x`, `y`), ready to be carried by the hand's bone. */
export function grippedWeapon(kind: HeldWeapon, x: number, y: number, scale = 1): SceneNode {
  // The bone's matrix replaces the transform of whatever it carries, so the placement sits one level in.
  return new SceneNode().add(heldWeaponArt(kind).transform([scale, 0, x, 0, scale, y, 0, 0, 1]));
}
