import type { Paint, Shape, Scene, Text, Picture, Animation, ThorVGNamespace } from '@thorvg/webcanvas';
import {
  PaintNode,
  ShapeNode,
  SceneNode,
  TextNode,
  PictureNode,
  AnimationNode,
  SvgPictureNode,
  type Blend,
  type Matrix,
  type Gradient,
  identity,
} from './paint';
interface Entry {
  paint: Paint;
  version: number;
  animation?: Animation;
  dataVersion?: number;
  childPaints?: Paint[];
  pathVersion?: number;
  gradient?: Gradient;
  matrix?: Matrix;
  opacity?: number;
  blending?: Blend;
  children?: PaintNode[];
  clipper?: PaintNode;
  masking?: PaintNode;
  maskMethod?: 'alpha' | 'inverseAlpha';
}
function matrix(value: Matrix) {
  return {
    e11: value[0],
    e12: value[1],
    e13: value[2],
    e21: value[3],
    e22: value[4],
    e23: value[5],
    e31: value[6],
    e32: value[7],
    e33: value[8],
  };
}
let rasterGeneration = 0;
/** A restored WebGL context cannot reuse textures uploaded by the lost context. */
export function invalidateWebCanvasRasterResources(): void {
  rasterGeneration++;
}
/** Mechanical native-paint API adaptation; it does not invent rendering geometry or style. */
export class WebCanvasAdapter {
  private entries = new Map<PaintNode, Entry>();
  private parents = new WeakMap<Paint, Entry>();
  private rasterGeneration = rasterGeneration;
  constructor(readonly tvg: ThorVGNamespace) {}
  sync(node: PaintNode): Paint {
    if (this.rasterGeneration !== rasterGeneration) {
      this.rasterGeneration = rasterGeneration;
      for (const [paint, entry] of this.entries)
        if (paint instanceof PictureNode) entry.dataVersion = undefined;
    }
    let entry = this.entries.get(node);
    if (!entry) {
      let animation: Animation | undefined;
      let paint: Paint;
      if (node instanceof AnimationNode) {
        animation = new this.tvg.Animation().load(node.json);
        if (!animation.picture) {
          animation.dispose();
          throw new Error('Cannot load native building animation.');
        }
        paint = animation.picture;
      } else if (node instanceof SvgPictureNode)
        paint = new this.tvg.Picture().load(node.svg, { type: 'svg' });
      else if (node instanceof PictureNode) paint = this.rawPicture(node);
      else
        paint =
          node instanceof ShapeNode
            ? new this.tvg.Shape()
            : node instanceof SceneNode
              ? new this.tvg.Scene()
              : new this.tvg.Text();
      entry = {
        paint,
        animation,
        version: -1,
        dataVersion: node instanceof PictureNode ? node.dataVersion : undefined,
      };
      this.entries.set(node, entry);
    }
    if (node instanceof PictureNode && entry.dataVersion !== node.dataVersion) {
      // WebCanvas's public raw loader copies its pixels. Detach the old picture
      // before replacing it, so its clip/mask targets can be rebound safely.
      const replacement = this.rawPicture(node);
      const parent = this.parents.get(entry.paint);
      if (parent) {
        (parent.paint as Scene).remove(entry.paint);
        parent.children = undefined;
        this.parents.delete(entry.paint);
      }
      entry.paint.dispose();
      entry.paint = replacement;
      entry.dataVersion = node.dataVersion;
      entry.version = -1;
      entry.matrix = undefined;
      entry.opacity = undefined;
      entry.blending = undefined;
      entry.clipper = undefined;
      entry.masking = undefined;
      entry.maskMethod = undefined;
    }
    if (node instanceof SceneNode) {
      const children = node.children.map((child) => this.sync(child));
      if (
        (!entry.children ||
          entry.children.length !== node.children.length ||
          entry.children.some((child, i) => child !== node.children[i]) ||
          entry.childPaints?.some((paint, i) => paint !== children[i])) &&
        entry.paint instanceof this.tvg.Scene
      ) {
        for (const previous of entry.childPaints ?? [])
          if (this.parents.get(previous) === entry) this.parents.delete(previous);
        entry.paint.clear();
        for (const child of children) {
          // Native detach happens immediately; the retained TS tree reconciles at
          // frame end. Detach a reused figure from its previous native row first.
          const previous = this.parents.get(child);
          if (previous && previous !== entry) {
            (previous.paint as Scene).remove(child);
            previous.children = undefined;
          }
          entry.paint.add(child);
          this.parents.set(child, entry);
        }
        entry.children = [...node.children];
        entry.childPaints = children;
      }
    }
    if (node.clipper) this.sync(node.clipper);
    if (node.masking) this.sync(node.masking.paint);
    if (entry.version === node.version) return entry.paint;
    if (node instanceof AnimationNode) entry.animation!.frame(node.currentFrame);
    if (
      (node instanceof PictureNode || node instanceof SvgPictureNode) &&
      node.displayWidth !== undefined &&
      node.displayHeight !== undefined
    )
      (entry.paint as Picture).size(node.displayWidth, node.displayHeight);
    if (node instanceof ShapeNode && entry.paint instanceof this.tvg.Shape)
      this.shape(entry.paint, node, entry.pathVersion !== node.pathVersion, entry);
    if (node instanceof ShapeNode) entry.pathVersion = node.pathVersion;
    if (node instanceof TextNode && entry.paint instanceof this.tvg.Text) this.text(entry.paint, node);
    const previousMatrix = entry.matrix ?? identity;
    if (node.matrix.some((value, i) => value !== previousMatrix[i]))
      entry.paint.transform(matrix(node.matrix));
    entry.matrix = node.matrix;
    const alpha = node instanceof TextNode ? Math.trunc((node.alpha * node.color[3]) / 255) : node.alpha;
    if (alpha !== (entry.opacity ?? 255)) entry.paint.opacity(alpha);
    entry.opacity = alpha;
    if (node.blending !== (entry.blending ?? 'normal')) entry.paint.blend(this.blend(node.blending));
    entry.blending = node.blending;
    if (node.clipper && entry.clipper !== node.clipper) {
      entry.paint.clip(this.sync(node.clipper));
      entry.clipper = node.clipper;
    }
    if (node.masking && (entry.masking !== node.masking.paint || entry.maskMethod !== node.masking.method)) {
      entry.paint.mask(
        this.sync(node.masking.paint),
        node.masking.method === 'alpha' ? this.tvg.MaskMethod.Alpha : this.tvg.MaskMethod.InvAlpha,
      );
      entry.masking = node.masking.paint;
      entry.maskMethod = node.masking.method;
    }
    entry.version = node.version;
    return entry.paint;
  }
  get retainedPaintCount(): number {
    return this.entries.size;
  }
  /** Call after syncing every live root to release paints detached by a rebuild. */
  collect(roots: readonly PaintNode[]): void {
    const live = new Set<PaintNode>();
    const visit = (node: PaintNode) => {
      if (live.has(node)) return;
      live.add(node);
      if (node instanceof SceneNode) node.children.forEach(visit);
      if (node instanceof PictureNode && node.source) visit(node.source);
      if (node.clipper) visit(node.clipper);
      if (node.masking) visit(node.masking.paint);
    };
    roots.forEach(visit);
    for (const [node, entry] of this.entries)
      if (!live.has(node)) {
        this.release(entry);
        this.entries.delete(node);
      }
  }
  dispose(): void {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }
  private release(entry: Entry): void {
    for (const child of entry.childPaints ?? [])
      if (this.parents.get(child) === entry) this.parents.delete(child);
    if (entry.animation) entry.animation.dispose();
    else entry.paint.dispose();
  }
  private rawPicture(node: PictureNode): Paint {
    if (node.source) return this.sync(node.source).duplicate();
    return new this.tvg.Picture().load(node.data, {
      type: 'raw',
      width: node.width,
      height: node.height,
      colorSpace: this.tvg.ColorSpace[node.colorSpace],
    });
  }
  private blend(method: Blend) {
    return method === 'softLight'
      ? this.tvg.BlendMethod.SoftLight
      : method === 'add'
        ? this.tvg.BlendMethod.Add
        : method === 'multiply'
          ? this.tvg.BlendMethod.Multiply
          : method === 'screen'
            ? this.tvg.BlendMethod.Screen
            : this.tvg.BlendMethod.Normal;
  }
  private shape(paint: Shape, node: ShapeNode, rebuildPath: boolean, entry: Entry): void {
    if (rebuildPath) {
      paint.reset();
      for (const command of node.commands) {
        switch (command[0]) {
          case 'M':
            paint.moveTo(command[1], command[2]);
            break;
          case 'L':
            paint.lineTo(command[1], command[2]);
            break;
          case 'C':
            paint.cubicTo(command[1], command[2], command[3], command[4], command[5], command[6]);
            break;
          case 'Z':
            paint.close();
            break;
          case 'R':
            paint.appendRect(command[1], command[2], command[3], command[4], {
              rx: command[5],
              ry: command[6],
            });
            break;
          case 'E':
            paint.appendCircle(command[1], command[2], command[3], command[4]);
            break;
        }
      }
    }
    if (node.color) paint.fill(...node.color);
    if (node.gradient && node.gradient !== entry.gradient) {
      const g = node.gradient,
        c = g.coordinates;
      const gradient =
        g.type === 'linear'
          ? new this.tvg.LinearGradient(c[0], c[1], c[2], c[3])
          : new this.tvg.RadialGradient(c[0], c[1], c[2], c[3], c[4], c[5]);
      for (const stop of g.stops) gradient.addStop(stop.offset, [...stop.color]);
      paint.fill(gradient);
      gradient.dispose();
    }
    entry.gradient = node.gradient;
    if (node.width !== undefined) paint.stroke(node.width);
    if (node.strokeColor) paint.stroke({ color: [...node.strokeColor] });
    if (node.cap)
      paint.stroke({
        cap:
          node.cap === 'round'
            ? this.tvg.StrokeCap.Round
            : node.cap === 'square'
              ? this.tvg.StrokeCap.Square
              : this.tvg.StrokeCap.Butt,
      });
    if (node.join)
      paint.stroke({
        join:
          node.join === 'round'
            ? this.tvg.StrokeJoin.Round
            : node.join === 'bevel'
              ? this.tvg.StrokeJoin.Bevel
              : this.tvg.StrokeJoin.Miter,
      });
    if (node.dash) paint.stroke({ dash: node.dash });
    if (node.rule)
      paint.fillRule(node.rule === 'evenOdd' ? this.tvg.FillRule.EvenOdd : this.tvg.FillRule.Winding);
  }
  private text(paint: Text, node: TextNode): void {
    paint
      .font(node.font)
      .fontSize(node.size)
      .text(node.text)
      .fill(node.color[0], node.color[1], node.color[2]);
    if (node.stroke) paint.outline(node.stroke.width, ...node.stroke.color);
  }
}
