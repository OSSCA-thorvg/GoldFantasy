export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];
export type Matrix = readonly [number, number, number, number, number, number, number, number, number];
export type Command =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z']
  | ['R', number, number, number, number, number, number]
  | ['E', number, number, number, number];
export interface Gradient {
  type: 'linear' | 'radial';
  coordinates: number[];
  stops: { offset: number; color: Rgba }[];
}
export type Blend = 'normal' | 'softLight' | 'add' | 'multiply' | 'screen';
export const identity: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const f = Math.fround;
export abstract class PaintNode {
  abstract readonly type: 'shape' | 'scene' | 'text' | 'picture' | 'animation' | 'svg';
  version = 0;
  matrix: Matrix = identity;
  alpha = 255;
  blending: Blend = 'normal';
  clipper?: PaintNode;
  masking?: { paint: PaintNode; method: 'alpha' | 'inverseAlpha' };
  transform(matrix: Matrix): this {
    this.matrix = [
      f(matrix[0]),
      f(matrix[1]),
      f(matrix[2]),
      f(matrix[3]),
      f(matrix[4]),
      f(matrix[5]),
      f(matrix[6]),
      f(matrix[7]),
      f(matrix[8]),
    ];
    this.version++;
    return this;
  }
  translate(x: number, y: number): this {
    const m = this.matrix;
    return this.transform([m[0], m[1], f(x), m[3], m[4], f(y), m[6], m[7], m[8]]);
  }
  opacity(value: number): this {
    this.alpha = Math.trunc(value) & 255;
    this.version++;
    return this;
  }
  blend(value: Blend): this {
    this.blending = value;
    this.version++;
    return this;
  }
  clip(paint: PaintNode): this {
    this.clipper = paint;
    this.version++;
    return this;
  }
  mask(paint: PaintNode, method: 'alpha' | 'inverseAlpha'): this {
    this.masking = { paint, method };
    this.version++;
    return this;
  }
}
export class ShapeNode extends PaintNode {
  readonly type = 'shape' as const;
  commands: Command[] = [];
  pathVersion = 0;
  color?: Rgba;
  gradient?: Gradient;
  strokeColor?: Rgba;
  width?: number;
  cap?: 'butt' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  dash?: number[];
  rule?: 'winding' | 'evenOdd';
  moveTo(x: number, y: number): this {
    this.commands.push(['M', f(x), f(y)]);
    this.pathVersion++;
    this.version++;
    return this;
  }
  lineTo(x: number, y: number): this {
    this.commands.push(['L', f(x), f(y)]);
    this.pathVersion++;
    this.version++;
    return this;
  }
  cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.commands.push(['C', f(x1), f(y1), f(x2), f(y2), f(x), f(y)]);
    this.pathVersion++;
    this.version++;
    return this;
  }
  close(): this {
    this.commands.push(['Z']);
    this.pathVersion++;
    this.version++;
    return this;
  }
  appendRect(x: number, y: number, w: number, h: number, rx = 0, ry = 0): this {
    this.commands.push(['R', f(x), f(y), f(w), f(h), f(rx), f(ry)]);
    this.pathVersion++;
    this.version++;
    return this;
  }
  appendCircle(x: number, y: number, rx: number, ry = rx): this {
    this.commands.push(['E', f(x), f(y), f(rx), f(ry)]);
    this.pathVersion++;
    this.version++;
    return this;
  }
  fill(r: number, g: number, b: number, a = 255): this {
    this.color = [r & 255, g & 255, b & 255, a & 255];
    this.gradient = undefined;
    this.version++;
    return this;
  }
  fillGradient(gradient: Gradient): this {
    this.gradient = gradient;
    this.color = undefined;
    this.version++;
    return this;
  }
  strokeFill(r: number, g: number, b: number, a = 255): this {
    this.strokeColor = [r & 255, g & 255, b & 255, a & 255];
    this.version++;
    return this;
  }
  strokeWidth(value: number): this {
    this.width = f(value);
    this.version++;
    return this;
  }
  strokeCap(value: 'butt' | 'round' | 'square'): this {
    this.cap = value;
    this.version++;
    return this;
  }
  strokeJoin(value: 'miter' | 'round' | 'bevel'): this {
    this.join = value;
    this.version++;
    return this;
  }
  strokeDash(value: number[]): this {
    this.dash = value.map(f);
    this.version++;
    return this;
  }
  fillRule(value: 'winding' | 'evenOdd'): this {
    this.rule = value;
    this.version++;
    return this;
  }
  reset(): this {
    this.commands = [];
    this.pathVersion++;
    this.version++;
    return this;
  }
}
export class SceneNode extends PaintNode {
  readonly type = 'scene' as const;
  children: PaintNode[] = [];
  add(paint: PaintNode): this {
    this.children.push(paint);
    this.version++;
    return this;
  }
  remove(paint?: PaintNode): this {
    this.children = paint ? this.children.filter((child) => child !== paint) : [];
    this.version++;
    return this;
  }
}
export class TextNode extends PaintNode {
  readonly type = 'text' as const;
  text = '';
  font = 'DejaVuSans';
  size = 14;
  color: Rgba = [255, 255, 255, 255];
  stroke?: { width: number; color: Rgb };
  outline(width: number, r: number, g: number, b: number): this {
    this.stroke = { width: f(width), color: [r, g, b] };
    this.version++;
    return this;
  }
}
export class PictureNode extends PaintNode {
  readonly type = 'picture' as const;
  dataVersion = 0;
  source?: PictureNode;
  displayWidth?: number;
  displayHeight?: number;
  constructor(
    public data: Uint8Array,
    public width: number,
    public height: number,
    public colorSpace: 'ABGR8888' | 'ARGB8888' | 'ABGR8888S' | 'ARGB8888S' = 'ABGR8888',
  ) {
    super();
  }
  load(data: Uint8Array, width = this.width, height = this.height): this {
    this.data = data;
    this.width = width;
    this.height = height;
    this.dataVersion++;
    this.version++;
    return this;
  }
  size(width: number, height: number): this {
    this.displayWidth = f(width);
    this.displayHeight = f(height);
    this.version++;
    return this;
  }
  duplicate(): PictureNode {
    const copy = new PictureNode(this.data, this.width, this.height, this.colorSpace);
    copy.source = this;
    copy.displayWidth = this.displayWidth;
    copy.displayHeight = this.displayHeight;
    copy.matrix = this.matrix;
    copy.alpha = this.alpha;
    copy.blending = this.blending;
    return copy;
  }
}
export class SvgPictureNode extends PaintNode {
  readonly type = 'svg' as const;
  displayWidth?: number;
  displayHeight?: number;
  constructor(readonly svg: string) {
    super();
  }
  size(width: number, height: number): this {
    this.displayWidth = f(width);
    this.displayHeight = f(height);
    this.version++;
    return this;
  }
}
export class AnimationNode extends PaintNode {
  readonly type = 'animation' as const;
  currentFrame = 0;
  constructor(readonly json: string) {
    super();
  }
  frame(value: number): this {
    this.currentFrame = f(value);
    this.version++;
    return this;
  }
}
export function serializePaint(node: PaintNode): unknown {
  const base = {
    type: node.type,
    matrix: node.matrix,
    alpha: node.alpha,
    blend: node.blending,
    ...(node.clipper ? { clip: serializePaint(node.clipper) } : {}),
    ...(node.masking
      ? { mask: { method: node.masking.method, paint: serializePaint(node.masking.paint) } }
      : {}),
  };
  if (node instanceof ShapeNode)
    return {
      ...base,
      commands: node.commands,
      ...(node.color ? { color: node.color } : {}),
      ...(node.gradient ? { gradient: node.gradient } : {}),
      ...(node.strokeColor ? { strokeColor: node.strokeColor } : {}),
      ...(node.width !== undefined ? { width: node.width } : {}),
      ...(node.cap ? { cap: node.cap } : {}),
      ...(node.join ? { join: node.join } : {}),
      ...(node.dash ? { dash: node.dash } : {}),
      ...(node.rule ? { rule: node.rule } : {}),
    };
  if (node instanceof SceneNode) return { ...base, children: node.children.map(serializePaint) };
  if (node instanceof TextNode)
    return {
      ...base,
      text: node.text,
      font: node.font,
      size: node.size,
      color: node.color,
      ...(node.stroke ? { outline: node.stroke } : {}),
    };
  if (node instanceof PictureNode)
    return {
      ...base,
      width: node.width,
      height: node.height,
      colorSpace: node.colorSpace,
      pixels: Array.from(node.data),
    };
  if (node instanceof SvgPictureNode)
    return { ...base, svg: node.svg, width: node.displayWidth, height: node.displayHeight };
  if (node instanceof AnimationNode) return { ...base, json: node.json, frame: node.currentFrame };
  throw new Error('Unsupported native paint node.');
}
