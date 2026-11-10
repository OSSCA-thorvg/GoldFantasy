import type { Person } from '../../engine/src/person';
import { equippedItem } from '../../engine/src/equipment';
import type { Point } from '../../engine/src/geometry';
import { SceneNode, ShapeNode } from './paint';
import { poly, oval, stroke } from './sprite-primitives';
import type { PersonParts } from './world-sprites';

/** Clothing presets remain the base; these small overlays represent real equipped items. */
export function wearableBack(sprite: SceneNode, person: Person, height: number, width: number): void {
  if (equippedItem(person, 'accessory')?.id !== 'cloak') return;
  sprite.add(
    poly(
      [
        [-width * 0.6, -height],
        [width * 0.6, -height],
        [width * 1.2, -0.8],
        [-width * 1.2, -0.8],
      ],
      [69, 91, 82],
    ),
  );
  sprite.add(
    poly(
      [
        [0, -height],
        [width * 0.6, -height],
        [width * 1.2, -0.8],
        [width * 0.1, -1.8],
      ],
      [45, 67, 62],
    ),
  );
}
export function wearableBody(
  sprite: SceneNode,
  person: Person,
  parts: PersonParts,
  height: number,
  width: number,
): void {
  const item = equippedItem(person, 'body')?.id;
  if (item) {
    const armor = new SceneNode(),
      shoulder = Math.abs(parts.arms[1].shoulder.x) - 0.1,
      top = -height + 0.3,
      bottom = item === 'robe' ? -1.4 : -height * 0.33,
      base = item === 'mail-armor' ? [127, 136, 141] : item === 'robe' ? [77, 104, 123] : [121, 86, 57],
      shade = item === 'mail-armor' ? [83, 96, 104] : item === 'robe' ? [51, 73, 93] : [83, 56, 39],
      hem = item === 'robe' ? width * 0.92 : width * 0.64;
    armor.add(
      poly(
        [
          [-shoulder, top],
          [-1, top + 1.1],
          [1, top + 1.1],
          [shoulder, top],
          [hem, bottom],
          [-hem, bottom],
        ],
        base as [number, number, number],
      ),
    );
    armor.add(
      poly(
        [
          [0, top + 1.1],
          [1, top + 1.1],
          [shoulder, top],
          [hem, bottom],
          [0, bottom],
        ],
        shade as [number, number, number],
      ),
    );
    if (item === 'mail-armor') {
      for (let y = top + 2.2; y < bottom - 0.3; y += 1.4)
        for (const x of [-1.5, -0.1, 1.3]) armor.add(oval([x, y], 0.4, 0.25, [168, 177, 178]));
    } else if (item === 'leather-armor') {
      armor.add(stroke([-shoulder + 0.3, top + 1], [hem - 0.5, bottom - 0.8], 0.8, [166, 126, 79]));
      armor.add(stroke([-hem, bottom - 0.6], [hem, bottom - 0.6], 0.7, [64, 43, 32]));
    } else {
      armor.add(stroke([0, top + 1.4], [0, bottom], 0.75, [188, 170, 106]));
      armor.add(
        poly(
          [
            [-1, top + 1.1],
            [1, top + 1.1],
            [0, top + 2.7],
          ],
          [181, 170, 113],
        ),
      );
    }
    sprite.add(armor);
  }
  if (equippedItem(person, 'feet')?.id === 'boots') {
    parts.feet.forEach((foot, i) => {
      if (!foot) return;
      const sign = i ? 1 : -1,
        x = sign * width * 0.55,
        left = i ? x - 1.8 : x,
        right = i ? x : x + 1.8,
        group = new SceneNode().add(foot);
      group.add(
        poly(
          [
            [left, -0.3],
            [right, -0.3],
            [right, -2.9],
            [left, -2.9],
          ],
          i ? [82, 57, 36] : [123, 88, 52],
        ),
      );
      group.add(stroke([left + 0.15, -2.5], [right - 0.15, -2.5], 0.45, [177, 140, 85]));
      sprite.remove(foot);
      sprite.add(group);
      parts.feet[i] = group;
    });
  }
  if (equippedItem(person, 'hands')?.id === 'gloves') {
    parts.arms.forEach((arm, i) => {
      arm.hand?.add(oval(arm.wrist, 0.9, 1, i ? [85, 61, 41] : [132, 95, 59]));
      arm.hand?.add(
        stroke(
          [arm.wrist.x - 0.6, arm.wrist.y - 0.5],
          [arm.wrist.x + 0.6, arm.wrist.y - 0.5],
          0.45,
          [171, 132, 83],
        ),
      );
    });
  }
}
export function wearableHead(sprite: SceneNode, person: Person, head: Point): void {
  const item = equippedItem(person, 'head')?.id;
  if (item !== 'cap' && item !== 'helmet') return;
  const metal = item === 'helmet',
    cap = new ShapeNode();
  cap
    .moveTo(head.x - 3.55, head.y - 0.25)
    .cubicTo(head.x - 3.8, head.y - 5.1, head.x + 3.3, head.y - 5.3, head.x + 3.5, head.y - 0.35)
    .lineTo(head.x + 1.2, head.y - 1)
    .lineTo(head.x - 1.4, head.y - 0.7)
    .close()
    .fill(...((metal ? [134, 145, 149] : [124, 85, 54]) as [number, number, number]));
  sprite.add(cap);
  sprite.add(
    stroke(
      [head.x - 3.4, head.y - 0.3],
      [head.x + 3.45, head.y - 0.35],
      0.7,
      metal ? [69, 82, 91] : [79, 52, 35],
    ),
  );
  if (metal) {
    sprite.add(stroke([head.x, head.y - 3.9], [head.x + 0.3, head.y - 0.55], 0.7, [201, 207, 201]));
    sprite.add(
      poly(
        [
          [head.x + 1.3, head.y - 0.8],
          [head.x + 2, head.y - 0.8],
          [head.x + 2, head.y + 1.4],
          [head.x + 1.5, head.y + 1.5],
        ],
        [104, 116, 123],
      ),
    );
  } else sprite.add(stroke([head.x - 1.5, head.y - 3.4], [head.x - 0.9, head.y - 0.7], 0.5, [179, 136, 86]));
}
