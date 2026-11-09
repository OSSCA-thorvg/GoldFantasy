import {
  PaintNode,
  ShapeNode,
  SceneNode,
  type Matrix,
  type Command,
  type Gradient,
  type Rgba,
  type Blend,
} from './paint';
export interface PaintData {
  type: 'shape' | 'scene';
  matrix: Matrix;
  alpha: number;
  blend: Blend;
  clip?: PaintData;
  mask?: { method: 'alpha' | 'inverseAlpha'; paint: PaintData };
  commands?: Command[];
  color?: Rgba;
  gradient?: Gradient;
  strokeColor?: Rgba;
  width?: number;
  cap?: 'round' | 'square' | 'butt';
  join?: 'round' | 'miter' | 'bevel';
  dash?: number[];
  rule?: 'winding' | 'evenOdd';
  children?: PaintData[];
}
/** Replays generated native vector data without rasterizing it or changing its geometry. */
export function paintFromData(data: PaintData): PaintNode {
  const node = data.type === 'shape' ? new ShapeNode() : new SceneNode();
  node.transform(data.matrix).opacity(data.alpha).blend(data.blend);
  if (node instanceof ShapeNode) {
    for (const command of data.commands ?? []) {
      switch (command[0]) {
        case 'M':
          node.moveTo(command[1], command[2]);
          break;
        case 'L':
          node.lineTo(command[1], command[2]);
          break;
        case 'C':
          node.cubicTo(command[1], command[2], command[3], command[4], command[5], command[6]);
          break;
        case 'Z':
          node.close();
          break;
        case 'R':
          node.appendRect(command[1], command[2], command[3], command[4], command[5], command[6]);
          break;
        case 'E':
          node.appendCircle(command[1], command[2], command[3], command[4]);
          break;
      }
    }
    if (data.color) node.fill(...data.color);
    if (data.gradient) node.fillGradient(data.gradient);
    if (data.strokeColor) node.strokeFill(...data.strokeColor);
    if (data.width !== undefined) node.strokeWidth(data.width);
    if (data.cap) node.strokeCap(data.cap);
    if (data.join) node.strokeJoin(data.join);
    if (data.dash) node.strokeDash(data.dash);
    if (data.rule) node.fillRule(data.rule);
  } else for (const child of data.children ?? []) node.add(paintFromData(child));
  if (data.clip) node.clip(paintFromData(data.clip));
  if (data.mask) node.mask(paintFromData(data.mask.paint), data.mask.method);
  return node;
}
