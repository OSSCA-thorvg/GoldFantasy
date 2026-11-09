import { Tool, toolStructure } from '../../engine/src/game-tools';
import { SceneNode, ShapeNode } from './paint';
import { poly, stroke, oval } from './sprite-primitives';
import { structureIcon } from './building-icon';

/** Terrain tools use the same compact isometric artwork as the building cards. */
export function constructionIcon(tool: Tool, width: number, height: number): SceneNode {
  const kind = toolStructure(tool);
  if (kind !== undefined) return structureIcon(kind, width, height);
  const icon = new SceneNode();
  const tile = [
    [48, 2],
    [94, 25],
    [48, 48],
    [2, 25],
  ] as const;
  icon.add(poly([...tile], tool === Tool.Field ? [89, 66, 43] : [89, 112, 71]));
  icon.add(
    poly(
      [
        [2, 25],
        [48, 48],
        [94, 25],
        [94, 31],
        [48, 54],
        [2, 31],
      ],
      [62, 72, 46],
    ),
  );
  if (tool === Tool.Road || tool === Tool.Pave) {
    const path = () =>
      new ShapeNode().moveTo(15, 37).cubicTo(35, 31, 29, 16, 51, 22).cubicTo(67, 27, 73, 16, 81, 12);
    icon.add(path().strokeWidth(17).strokeCap('round').strokeFill(65, 55, 40));
    icon.add(
      path()
        .strokeWidth(13)
        .strokeCap('round')
        .strokeFill(...((tool === Tool.Pave ? [144, 144, 137] : [164, 129, 80]) as [number, number, number])),
    );
    if (tool === Tool.Pave) {
      for (const [x, y, angle] of [
        [17, 36, -0.3],
        [25, 32, -0.6],
        [31, 25, -0.9],
        [37, 21, -0.25],
        [46, 22, 0.25],
        [56, 24, 0.05],
        [66, 22, -0.4],
        [75, 16, -0.6],
      ]) {
        const stone = poly(
          [
            [-3, -3],
            [3, -3],
            [4, 2],
            [-3, 3],
          ],
          [181, 177, 159],
        );
        const c = Math.cos(angle),
          s = Math.sin(angle);
        stone.transform([c, -s, x, s, c, y, 0, 0, 1]);
        icon.add(stone);
      }
    } else {
      icon.add(stroke([18, 39], [28, 33], 0.7, [205, 170, 112]));
      icon.add(stroke([54, 26], [64, 25], 0.7, [205, 170, 112]));
    }
  } else if (tool === Tool.Field) {
    for (let row = 0; row < 5; row++) {
      const x = 16 + row * 10,
        y = 25 - row * 5;
      icon.add(stroke([x, y], [x + 29, y + 14], 3, [52, 39, 27]));
      for (let crop = 0; crop < 4; crop++) {
        const px = x + crop * 8,
          py = y + crop * 4;
        icon.add(stroke([px, py], [px, py - 5], 1.1, [139, 164, 75]));
        icon.add(oval([px - 1.8, py - 3.3], 2, 1, [101, 139, 63]));
        icon.add(oval([px + 1.8, py - 4.5], 2, 1, [164, 183, 86]));
      }
    }
  }
  const scale = Math.min(width / 96, height / 56);
  icon.transform([scale, 0, (width - 96 * scale) / 2, 0, scale, (height - 56 * scale) / 2, 0, 0, 1]);
  return icon;
}
