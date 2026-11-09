import data from '../assets/character-data.json';
import {
  FaceShape,
  PortraitEyeForm,
  PortraitEyeKind,
  type Appearance,
} from '../../engine/src/person-appearance';
import {
  baldHairAsset,
  faceBaseCount,
  hairAssetCount,
  referenceHeadCount,
  safeCharacterHairAsset,
  safeCharacterOutfitAsset,
} from '../../engine/src/character-reference';
import { add, sub, scale as mul, lerp, distance, point, type Point } from '../../engine/src/geometry';
import { clamp, f32 } from '../../engine/src/numeric';
import { SceneNode, ShapeNode, type Rgb, type Rgba } from './paint';
import { ellipse, line, polygon, mix, opaque, fill } from './vector-paint';
interface RawPath {
  data: string;
  tone: number;
  stroke: number;
  evenodd: boolean;
  outline: boolean;
}
interface FeatureSource {
  eye: Point[];
  brow: Point[];
  pupil: number;
  pupilX: number;
}
interface FaceSource {
  name: string;
  paths: RawPath[];
  coverage: RawPath;
  earLeft: RawPath[];
  earRight: RawPath[];
  contour: Point[];
  earRoots: Point[];
  temple: number;
  crown: number;
  chin: number;
  eyeSpacing: number;
  eyeY: number;
  eyeRadius: number;
  noseY: number;
  mouthWidth: number;
  mouthY: number;
}
interface HairSource {
  name: string;
  full: RawPath[];
  shadow: RawPath[];
  cap: RawPath[];
  fringe: RawPath[];
  back: RawPath[];
  tied: RawPath[];
  nativeFace: number;
  gender: number;
  group: number;
  radius: number;
  crown: number;
  splitY: number;
  tiedTop: number;
  backExtension: number;
  curtain: boolean;
  eye: number;
  rearMode: number;
  ready: boolean;
  fallback: number;
}
interface OutfitSource {
  name: string;
  paths: RawPath[];
  bottom: number;
  coverage: RawPath;
}
const source: {
  heads: FeatureSource[];
  faces: FaceSource[];
  hair: HairSource[];
  outfits: OutfitSource[];
  extraFeature: FeatureSource;
} = data;
const ink: Rgba = [25, 28, 27, 255],
  inkRgb: Rgb = [25, 28, 27];
const rgb = (c: { r: number; g: number; b: number }): Rgb => [c.r, c.g, c.b];
const headIndex = (i: number) => clamp(i, 0, f32(referenceHeadCount - 1)),
  baseIndex = (i: number) => clamp(i, 0, f32(faceBaseCount - 1)),
  hairIndex = (i: number) => clamp(i, 0, f32(hairAssetCount - 1)),
  outfitIndex = safeCharacterOutfitAsset;
const faceSource = (i: number) => source.faces[baseIndex(i)];
function smooth(t: number): number {
  t = clamp(t, 0, 1);
  return f32(f32(t * t) * f32(3 - f32(2 * t)));
}
// libstdc++ std::lerp(float) preserves the native signed-endpoint branch.
function scalarLerp(a: number, b: number, t: number): number {
  if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) return f32(f32(t * b) + f32(f32(1 - t) * a));
  if (t === 1) return b;
  const x = f32(a + f32(t * f32(b - a)));
  return t > 1 === b > a ? Math.max(b, x) : Math.min(b, x);
}
function headWidth(a: Appearance): number {
  return f32(1 + f32(f32(a.faceWidth - f32(0.5)) * f32(0.22)));
}
function profileWidth(face: number, y: number, side: number): number {
  const s = faceSource(face);
  let previous = point(0, -s.crown);
  for (let i = 0; i < 7; i++) {
    const next = i === 6 ? point(0, s.chin) : s.contour[f32(f32(1 + f32(i * 2)) + (side > 0 ? 1 : 0))];
    if (y <= next.y) {
      const t = smooth(f32(f32(y - previous.y) / Math.max(f32(0.001), f32(next.y - previous.y))));
      return Math.max(f32(0.08), Math.abs(lerp(previous, next, t).x));
    }
    previous = next;
  }
  return f32(0.08);
}
function upperWidth(a: Appearance, y: number, side: number): number {
  let width = profileWidth(a.scalpAsset, y, side);
  if (a.scalpTarget !== 255) width = scalarLerp(width, profileWidth(a.scalpTarget, y, side), a.scalpBlend);
  return width;
}
function upperPoint(a: Appearance, p: Point): Point {
  const s = faceSource(a.scalpAsset),
    side = p.x < 0 ? -1 : 1,
    morph = f32(upperWidth(a, p.y, side) / profileWidth(a.scalpAsset, p.y, side)),
    t = smooth(f32(f32(p.y + s.crown) / s.crown));
  return point(
    f32(f32(f32(f32(p.x * morph) * headWidth(a)) * a.scalpWidth) * f32(1 + f32(f32(a.templeWidth - 1) * t))),
    f32(f32(p.y * a.scalpHeight) + f32(f32(f32(a.foreheadShift * 4) * t) * f32(1 - t))),
  );
}
function facePoint(a: Appearance, p: Point): Point {
  const s = faceSource(a.faceAsset);
  if (p.y <= 0) return upperPoint(a, p);
  const side = p.x < 0 ? -1 : 1,
    lower = smooth(f32(p.y / s.chin)),
    root = f32(f32(f32(upperWidth(a, 0, side) * headWidth(a)) * a.scalpWidth) * a.templeWidth);
  let width = f32(root / profileWidth(a.faceAsset, 0, side));
  if (a.jawTarget !== 255) {
    const from = f32(profileWidth(a.faceAsset, p.y, side) / profileWidth(a.faceAsset, 0, side)),
      to = f32(profileWidth(a.jawTarget, p.y, side) / profileWidth(a.jawTarget, 0, side));
    width = f32(width * scalarLerp(1, f32(to / from), a.jawBlend));
  }
  let jaw = f32(1 + f32(f32(a.jawWidth - 1) * lower));
  if (a.faceShape === FaceShape.Round) jaw = f32(jaw + f32(f32(a.faceBlend * lower) * f32(0.12)));
  else if (a.faceShape === FaceShape.Angular) jaw = f32(jaw + f32(f32(a.faceBlend * lower) * f32(0.06)));
  else if (a.faceShape === FaceShape.Oval) jaw = f32(jaw - f32(f32(a.faceBlend * lower) * f32(0.08)));
  const cheek = f32(
    1 +
      f32(
        f32(f32(a.cheekFullness - f32(0.5)) * f32(0.13)) *
          f32(Math.sin(f32(clamp(f32(p.y / s.chin), 0, 1) * f32(3.14159265)))),
      ),
  );
  return point(
    f32(f32(f32(p.x * width) * jaw) * cheek),
    f32(p.y * f32(1 + f32(f32(a.chinLength - 1) * lower))),
  );
}
const chinBottom = (a: Appearance) => f32(faceSource(a.faceAsset).chin * a.chinLength);
const outfitOffset = (a: Appearance) => Math.max(0, f32(chinBottom(a) - f32(3.2)));
function feature(i: number): FeatureSource {
  return i >= referenceHeadCount ? source.extraFeature : source.heads[headIndex(i)];
}
type MapPoint = (p: Point) => Point;
function cubicAt(p: readonly Point[], t: number): Point {
  const u = f32(1 - t);
  return add(
    add(
      add(mul(p[0], f32(f32(u * u) * u)), mul(p[1], f32(f32(f32(3 * u) * u) * t))),
      mul(p[2], f32(f32(f32(3 * u) * t) * t)),
    ),
    mul(p[3], f32(f32(t * t) * t)),
  );
}
/** The native adaptive cubic deformation, including derivative fitting and 0.008 error threshold. */
function path(raw: RawPath, map: MapPoint, deform = false): ShapeNode {
  const shape = new ShapeNode();
  let cursor = 0;
  const text = raw.data;
  const number = () => {
    while (text[cursor] === ' ') cursor++;
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(cursor));
    if (!match) throw new Error('Invalid native character path.');
    cursor = f32(cursor + match[0].length);
    return f32(Number(match[0]));
  };
  const nextPoint = () => point(number(), number());
  const curve = (original: Point[], depth: number) => {
    const q = original.map(map);
    if (deform) {
      const epsilon = f32(0.001);
      q[1] = add(
        q[0],
        mul(sub(map(add(original[0], mul(sub(original[1], original[0]), epsilon))), q[0]), f32(1 / epsilon)),
      );
      q[2] = add(
        q[3],
        mul(sub(map(add(original[3], mul(sub(original[2], original[3]), epsilon))), q[3]), f32(1 / epsilon)),
      );
      let error = 0;
      for (const t of [f32(0.25), f32(0.5), f32(0.75)])
        error = Math.max(error, distance(map(cubicAt(original, t)), cubicAt(q, t)));
      if (error > f32(0.008) && depth < 8) {
        const a = lerp(original[0], original[1], f32(0.5)),
          b = lerp(original[1], original[2], f32(0.5)),
          c = lerp(original[2], original[3], f32(0.5)),
          d = lerp(a, b, f32(0.5)),
          e = lerp(b, c, f32(0.5)),
          middle = lerp(d, e, f32(0.5));
        curve([original[0], a, d, middle], f32(depth + 1));
        curve([middle, e, c, original[3]], f32(depth + 1));
        return;
      }
    }
    shape.cubicTo(q[1].x, q[1].y, q[2].x, q[2].y, q[3].x, q[3].y);
  };
  let current = point(),
    start = point();
  while (cursor < text.length) {
    const command = text[cursor++];
    if (command === 'M' || command === 'L') {
      const a = nextPoint(),
        mapped = map(a);
      if (command === 'M') {
        shape.moveTo(mapped.x, mapped.y);
        start = a;
      } else if (deform) curve([current, lerp(current, a, f32(1 / 3)), lerp(current, a, f32(2 / 3)), a], 0);
      else shape.lineTo(mapped.x, mapped.y);
      current = a;
    } else if (command === 'C') {
      const a = nextPoint(),
        b = nextPoint(),
        c = nextPoint();
      curve([current, a, b, c], 0);
      current = c;
    } else if (command === 'Z') {
      if (deform && distance(current, start) > f32(0.0001))
        curve([current, lerp(current, start, f32(1 / 3)), lerp(current, start, f32(2 / 3)), start], 0);
      shape.close();
      current = start;
    }
  }
  if (raw.evenodd) shape.fillRule('evenOdd');
  return shape;
}
function style(shape: ShapeNode, raw: RawPath, color: Rgb): void {
  if (raw.stroke > 0) {
    shape
      .fill(0, 0, 0, 0)
      .strokeFill(...opaque(color))
      .strokeWidth(raw.stroke)
      .strokeCap('round')
      .strokeJoin('round');
  } else {
    fill(shape, opaque(color));
    if (raw.outline)
      shape
        .strokeFill(...ink)
        .strokeWidth(f32(0.075))
        .strokeCap('round')
        .strokeJoin('round');
  }
}
function appendEye(shape: ShapeNode, points: readonly Point[], begin = 0, end = 4): void {
  const p = points[f32(begin * 3)];
  shape.moveTo(p.x, p.y);
  for (let i = begin; i < end; i++) {
    const a = points[f32(f32(i * 3) + 1)],
      b = points[f32(f32(i * 3) + 2)],
      c = points[f32(f32(i * 3) + 3)];
    shape.cubicTo(a.x, a.y, b.x, b.y, c.x, c.y);
  }
  if (begin === 0 && end === 4) shape.close();
}
function featureScale(a: Appearance, reference: number): number {
  const native = reference >= referenceHeadCount ? 29 : reference;
  return f32(characterCranium(a).rightTemple.x / profileWidth(native, 0, 1));
}
function featureCenter(a: Appearance, side: number, reference: number): Point {
  const native = faceSource(reference >= referenceHeadCount ? 29 : reference),
    ratio = featureScale(a, reference);
  return point(f32(f32(side * native.eyeSpacing) * ratio), f32(native.eyeY * a.scalpHeight));
}
function eyeCenter(a: Appearance, side: number): Point {
  const p = featureCenter(a, side, a.eyeReference);
  return point(f32(f32(p.x * a.eyeGap) / f32(8.4)), f32(p.y + a.eyeLevel));
}
function faceBoundary(a: Appearance, top: boolean): Point[] {
  const s = faceSource(top ? a.scalpAsset : a.faceAsset),
    shape = path(s.coverage, (p) => (top ? upperPoint(a, p) : facePoint(a, p)), true),
    boundary: Point[] = [];
  let current = point(),
    start = point();
  for (const c of shape.commands) {
    switch (c[0]) {
      case 'M':
        current = start = point(c[1], c[2]);
        boundary.push(current);
        break;
      case 'L':
        current = point(c[1], c[2]);
        boundary.push(current);
        break;
      case 'C': {
        const c1 = point(c[1], c[2]),
          c2 = point(c[3], c[4]),
          end = point(c[5], c[6]);
        for (let step = 1; step <= 16; step++) boundary.push(cubicAt([current, c1, c2, end], f32(step / 16)));
        current = end;
        break;
      }
      case 'Z':
        boundary.push(start);
        current = start;
        break;
    }
  }
  return boundary;
}
class FaceInterior {
  top: number;
  bottom: number;
  widths = new Float32Array(257);
  constructor(a: Appearance) {
    this.top = f32(-faceSource(a.scalpAsset).crown * a.scalpHeight);
    this.bottom = chinBottom(a);
    const upper = faceBoundary(a, true),
      lower = faceBoundary(a, false);
    for (let i = 0; i < this.widths.length; i++) {
      const y = scalarLerp(this.top, this.bottom, f32(i / f32(this.widths.length - 1))),
        boundary = y <= 0 ? upper : lower;
      for (let j = 1; j < boundary.length; j++) {
        const p = boundary[f32(j - 1)],
          q = boundary[j];
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y))
          this.widths[i] = Math.max(
            this.widths[i],
            Math.abs(scalarLerp(p.x, q.x, f32(f32(y - p.y) / f32(q.y - p.y)))),
          );
      }
    }
  }
  width(y: number): number {
    if (y <= this.top || y >= this.bottom) return 0;
    const sample = f32(f32(f32(y - this.top) / f32(this.bottom - this.top)) * f32(this.widths.length - 1)),
      i = Math.min(f32(this.widths.length - 2), Math.trunc(sample));
    return Math.min(this.widths[i], this.widths[f32(i + 1)]);
  }
}
interface EyeFit {
  center: Point;
  scale: number;
}
function fitEyes(a: Appearance, model: Point[], rx: number, ry: number): EyeFit {
  const face = new FaceInterior(a),
    center = eyeCenter(a, 1),
    stroke = Math.max(
      a.eyeOutline ? f32(f32(0.03) * a.eyeStroke) : 0,
      a.portraitEyeKind === PortraitEyeKind.Open && a.upperLid ? f32(f32(0.045) * a.eyeStroke) : 0,
    ),
    gap = f32(0.12),
    padding = f32(f32(0.05) + stroke);
  center.y = clamp(center.y, f32(face.top + f32(padding * 2)), f32(face.bottom - f32(padding * 2)));
  for (let i = 0; i < 16 && face.width(center.y) < f32(f32(gap + f32(padding * 2)) + f32(0.05)); i++)
    center.y = f32(center.y * f32(0.75));
  const co = f32(Math.cos(a.eyeTilt)),
    si = f32(Math.sin(a.eyeTilt)),
    offsets: Point[] = [],
    rotated = (p: Point) => {
      p = point(f32(p.x * -rx), f32(p.y * ry));
      return point(f32(f32(co * p.x) - f32(si * p.y)), f32(f32(si * p.x) + f32(co * p.y)));
    };
  offsets.push(rotated(model[0]));
  for (let curve = 0; curve < 4; curve++)
    for (let step = 1; step <= 16; step++) {
      const j = f32(curve * 3);
      offsets.push(rotated(cubicAt(model.slice(j, f32(j + 4)), f32(step / 16))));
    }
  const interval = (scale: number) => {
    const range = point(0, 100);
    for (const offset of offsets) {
      const p = mul(offset, scale),
        y = f32(center.y + p.y),
        width = Math.min(face.width(f32(y - padding)), face.width(f32(y + padding)));
      range.x = Math.max(range.x, f32(f32(gap + padding) - p.x));
      range.y = Math.min(range.y, f32(f32(width - padding) - p.x));
    }
    return range;
  };
  let scale = 1,
    range = interval(scale);
  if (range.x > range.y) {
    let low = 0,
      high = 1;
    for (let i = 0; i < 18; i++) {
      const middle = f32(f32(low + high) * f32(0.5)),
        r = interval(middle);
      if (r.x <= r.y) low = middle;
      else high = middle;
    }
    scale = low;
    range = interval(scale);
  }
  center.x = clamp(center.x, range.x, Math.max(range.x, range.y));
  return { center, scale };
}
function eyes(scene: SceneNode, a: Appearance): void {
  if (a.eyeSize <= 0) return;
  const f = feature(a.eyeReference),
    model = characterEyePath(a);
  let base =
    a.portraitEyeKind === PortraitEyeKind.Dots
      ? f32(0.14)
      : faceSource(a.eyeReference >= referenceHeadCount ? 29 : a.eyeReference).eyeRadius;
  if (a.portraitEyeKind === PortraitEyeKind.Open)
    base = f32(base * Math.min(1, featureScale(a, a.eyeReference)));
  let rx = f32(f32(base * a.eyeSize) * a.eyeWidth),
    ry = f32(
      f32(f32(base * a.eyeSize) * a.eyeHeight) * (a.portraitEyeKind === PortraitEyeKind.Dots ? f32(1.35) : 1),
    );
  const fit = fitEyes(a, model, rx, ry);
  rx = f32(rx * fit.scale);
  ry = f32(ry * fit.scale);
  for (const side of [-1, 1]) {
    const center = point(f32(fit.center.x * side), fit.center.y),
      angle = f32(a.eyeTilt * side),
      co = f32(Math.cos(angle)),
      si = f32(Math.sin(angle)),
      at = (p: Point) => {
        p = point(f32(f32(p.x * rx) * -side), f32(p.y * ry));
        return add(center, point(f32(f32(co * p.x) - f32(si * p.y)), f32(f32(si * p.x) + f32(co * p.y))));
      },
      mapped = model.map(at),
      aperture = new ShapeNode();
    appendEye(aperture, mapped);
    if (a.portraitEyeKind === PortraitEyeKind.Dots) aperture.fill(...ink);
    else aperture.fill(253, 252, 248);
    if (a.eyeOutline) aperture.strokeFill(...ink).strokeWidth(f32(f32(0.06) * a.eyeStroke));
    scene.add(aperture);
    if (a.portraitEyeKind === PortraitEyeKind.Open) {
      const pupils = new SceneNode(),
        pc = at(point(f.pupilX, a.pupilY)),
        irisX = f32(f32(rx * f.pupil) * a.irisSize),
        irisY = f32(f32(f32(ry * f.pupil) * a.irisSize) * a.pupilHeight),
        coloured = f32(f32(a.eyes.r + a.eyes.g) + a.eyes.b) > 150;
      pupils.add(ellipse(pc, irisX, irisY, coloured ? opaque(rgb(a.eyes)) : ink));
      if (coloured) {
        pupils.add(ellipse(pc, f32(irisX * f32(0.48)), f32(irisY * f32(0.68)), ink));
        pupils.add(
          ellipse(
            add(pc, point(f32(-irisX * f32(0.25)), f32(-irisY * f32(0.32)))),
            f32(irisX * f32(0.13)),
            f32(irisX * f32(0.13)),
            [253, 252, 248, 255],
          ),
        );
      }
      const clip = new ShapeNode();
      appendEye(clip, mapped);
      pupils.clip(clip);
      scene.add(pupils);
      if (a.upperLid) {
        const lid = new ShapeNode();
        appendEye(lid, mapped, 0, 2);
        lid
          .strokeFill(...ink)
          .strokeWidth(f32(f32(0.09) * a.eyeStroke))
          .strokeCap('round');
        scene.add(lid);
      }
    }
  }
}
function brows(scene: SceneNode, a: Appearance): void {
  if (!a.browVisible) return;
  const f = feature(a.browReference);
  for (const side of [-1, 1]) {
    const center = featureCenter(a, side, a.browReference);
    center.x = f32(center.x * a.browSpacing);
    center.y = f32(center.y + a.browHeight);
    const b = f.brow.map((p) => ({ ...p })),
      middle = f32(f32(b[0].x + b[3].x) * f32(0.5)),
      middleY = f32(f32(b[0].y + b[3].y) * f32(0.5));
    center.y = f32(center.y + f32(middleY * f32(0.75)));
    const angle = f32(a.browTilt * side),
      co = f32(Math.cos(angle)),
      si = f32(Math.sin(angle));
    for (let i = 0; i < b.length; i++) {
      const p = point(
        f32(f32(f32(f32(b[i].x - middle) * f32(0.75)) * a.browWidth) * -side),
        f32(f32(b[i].y - middleY) * f32(0.75)),
      );
      if (i === 1 || i === 2) p.y = f32(p.y + f32(a.browCurve * f32(0.35)));
      b[i] = add(center, point(f32(f32(co * p.x) - f32(si * p.y)), f32(f32(si * p.x) + f32(co * p.y))));
    }
    scene.add(
      new ShapeNode()
        .moveTo(b[0].x, b[0].y)
        .cubicTo(b[1].x, b[1].y, b[2].x, b[2].y, b[3].x, b[3].y)
        .strokeFill(...ink)
        .strokeWidth(f32((a.browReference === 19 ? f32(0.24) : f32(0.065)) * a.browWeight))
        .strokeCap('round'),
    );
  }
}
export interface CraniumFrame {
  crown: Point;
  forehead: Point;
  leftTemple: Point;
  rightTemple: Point;
}
export function characterCranium(a: Appearance): CraniumFrame {
  const s = faceSource(a.scalpAsset),
    radius = f32(f32(upperWidth(a, 0, 1) * headWidth(a)) * a.scalpWidth),
    h = f32(s.crown * a.scalpHeight);
  return {
    crown: point(0, -h),
    forehead: point(0, f32(f32(-h * f32(0.43)) + a.foreheadShift)),
    leftTemple: point(-radius, 0),
    rightTemple: point(radius, 0),
  };
}
export interface CharacterPlacement {
  scale: number;
  origin: Point;
}
export const outfitBottom = (i: number) => source.outfits[outfitIndex(i)].bottom;
export function characterPortraitPlacement(a: Appearance, width: number, height: number): CharacterPlacement;
export function characterPortraitPlacement(width: number, height: number): CharacterPlacement;
export function characterPortraitPlacement(
  first: Appearance | number,
  second: number,
  third?: number,
): CharacterPlacement {
  if (typeof first === 'number') {
    const width = first,
      height = second,
      scale = Math.min(f32(f32(width * f32(0.92)) / 16), f32(f32(height * f32(0.75)) / f32(12.3)));
    return {
      scale,
      origin: point(f32(width * f32(0.5)), f32(f32(height * f32(0.06)) + f32(f32(8.8) * scale))),
    };
  }
  const a = first,
    width = second,
    height = third!,
    skull = characterCranium(a),
    top = f32(skull.crown.y - f32(0.45)),
    bottom = f32(chinBottom(a) + f32(0.35)),
    scale = Math.min(
      f32(f32(width * f32(0.94)) / f32(f32(skull.rightTemple.x * 2) + 1)),
      f32(f32(height * f32(0.9)) / f32(bottom - top)),
    );
  return {
    scale,
    origin: point(
      f32(width * f32(0.5)),
      f32(f32(f32(height - f32(f32(bottom - top) * scale)) * f32(0.5)) - f32(top * scale)),
    ),
  };
}
export function characterFigurePlacement(
  a: Appearance | number,
  width: number,
  height: number,
): CharacterPlacement {
  const bottom =
      typeof a === 'number'
        ? outfitBottom(a)
        : f32(
            f32(f32(4.8) + f32(f32(outfitBottom(a.outfitAsset) - f32(4.8)) * a.bodyHeight)) + outfitOffset(a),
          ),
    scale = Math.min(f32(f32(width - 24) / 18), f32(f32(height - 24) / f32(bottom + f32(9.5))));
  return { scale, origin: point(f32(width * f32(0.5)), f32(f32(height - 12) - f32(bottom * scale))) };
}
export class HairFit {
  private unchanged = true;
  private profileRatios = new Float32Array(8);
  private radius = f32(3.2);
  private crown = f32(3.2);
  private ratio = 1;
  private height = 1;
  private forehead = 0;
  private temples = 1;
  private length = 1;
  private gap = 0;
  constructor(a: Appearance, hair = -1) {
    const s = source.hair[hairIndex(hair < 0 ? a.hairAsset : hair)];
    this.radius = s.radius;
    this.crown = s.crown;
    const frame = characterCranium(a);
    this.ratio = f32(frame.rightTemple.x / this.radius);
    this.height = f32(-frame.crown.y / this.crown);
    let shaped = false;
    for (let i = 0; i < this.profileRatios.length; i++) {
      const t = f32(i / f32(this.profileRatios.length - 1)),
        y = f32(f32(-f32(0.875) + f32(f32(0.875) * t)) * faceSource(s.nativeFace).crown),
        targetY = f32(f32(y * faceSource(a.scalpAsset).crown) / faceSource(s.nativeFace).crown),
        native = profileWidth(s.nativeFace, y, 1);
      let value = f32(f32(f32(upperWidth(a, targetY, 1) * headWidth(a)) * a.scalpWidth) / native);
      if (s.group === 1) value = this.ratio;
      this.profileRatios[i] = clamp(value, f32(0.35), 3);
      shaped = shaped || Math.abs(f32(this.profileRatios[i] - 1)) > f32(0.00001);
    }
    this.forehead = a.foreheadShift;
    this.temples = a.templeWidth;
    this.length = a.hairLength;
    this.gap = a.sideLockGap;
    this.unchanged =
      !shaped &&
      Math.abs(f32(this.ratio - 1)) < f32(0.00001) &&
      Math.abs(f32(this.height - 1)) < f32(0.00001) &&
      this.forehead === 0 &&
      this.temples === 1 &&
      this.length === 1 &&
      this.gap === 0;
  }
  identity(): boolean {
    return this.unchanged;
  }
  map(p: Point): Point {
    if (this.unchanged) return p;
    const t = smooth(f32(f32(p.y + this.crown) / this.crown)),
      sample = f32(
        clamp(f32(f32(f32(p.y / this.crown) + f32(0.875)) / f32(0.875)), 0, 1) *
          f32(this.profileRatios.length - 1),
      ),
      index = Math.min(f32(this.profileRatios.length - 2), Math.trunc(sample)),
      capRatio = scalarLerp(
        this.profileRatios[index],
        this.profileRatios[f32(index + 1)],
        smooth(f32(sample - index)),
      ),
      w = f32(capRatio * f32(1 + f32(f32(this.temples - 1) * t))),
      root = f32(1 - smooth(f32(p.y / f32(2.4)))),
      side = clamp(f32(p.x / this.radius), -1, 1),
      x = f32(
        f32(p.x + f32(f32(w - 1) * f32(f32(root * p.x) + f32(f32(f32(1 - root) * this.radius) * side)))) +
          f32(f32(this.gap * side) * f32(1 - root)),
      );
    let y = p.y;
    if (p.y < -this.crown) y = f32(y - f32(this.crown * f32(this.height - 1)));
    else if (p.y < 0) y = f32(f32(p.y * this.height) + f32(f32(f32(this.forehead * 4) * t) * f32(1 - t)));
    const shaft = clamp(p.y, 0, 5);
    y = f32(y + f32(f32(this.length - 1) * shaft));
    return point(x, y);
  }
  fringe(p: Point): Point {
    const side = p.x < 0 ? -1 : 1,
      from = point(f32(side * this.radius), f32(this.crown + f32(0.2))),
      to = point(
        f32(f32(f32(side * this.radius) * this.ratio) * this.temples),
        f32(f32(this.crown + f32(0.2)) * this.height),
      ),
      den = f32(f32(from.x * from.x) + f32(from.y * from.y)),
      co = f32(f32(f32(from.x * to.x) + f32(from.y * to.y)) / den),
      si = f32(f32(f32(from.x * to.y) - f32(from.y * to.x)) / den),
      v = sub(p, point(0, f32(-this.crown - f32(0.2))));
    return point(
      f32(f32(co * v.x) - f32(si * v.y)),
      f32(
        f32(f32(f32(-f32(this.crown + f32(0.2)) * this.height) + f32(si * v.x)) + f32(co * v.y)) +
          f32(this.forehead * f32(0.4)),
      ),
    );
  }
  rigid(p: Point, root?: Point): Point {
    root ??= point(
      p.y < -this.crown ? 0 : p.x < 0 ? -this.radius : this.radius,
      p.y < -this.crown ? -this.crown : 0,
    );
    return sub(add(p, this.map(root)), root);
  }
}
export interface FitAnchor {
  source: Point;
  target: Point;
}
export function hairFitAnchors(a: Appearance): FitAnchor[] {
  const s = source.hair[hairIndex(a.hairAsset)],
    fit = new HairFit(a),
    result: FitAnchor[] = [];
  for (const y of [-s.crown, 0, f32(3.2)])
    for (const x of [-2, -1, 0, 1, 2]) {
      const p = point(f32(x * s.radius), y);
      result.push({ source: p, target: fit.map(p) });
    }
  return result;
}
export function characterEyePath(a: Appearance): Point[] {
  const k = f32(0.55228475),
    round = [
      point(-1, 0),
      point(-1, -k),
      point(-k, -1),
      point(0, -1),
      point(k, -1),
      point(1, -k),
      point(1, 0),
      point(1, k),
      point(k, 1),
      point(0, 1),
      point(-k, 1),
      point(-1, k),
      point(-1, 0),
    ];
  let p = feature(a.eyeReference).eye;
  if (a.portraitEyeForm === PortraitEyeForm.Round) p = round;
  else if (a.portraitEyeForm === PortraitEyeForm.Almond) p = source.heads[3].eye;
  else if (a.portraitEyeForm === PortraitEyeForm.HalfLid) p = source.extraFeature.eye;
  return p.map((value, i) => {
    const at = lerp(value, round[i], a.eyeRoundness);
    at.y = f32(at.y * a.eyeOpenness);
    if (at.y < 0) at.y = f32(at.y * f32(1 - f32(clamp(a.lidDrop, 0, 1) * f32(0.7))));
    return at;
  });
}
export function characterSkull(a: Appearance): ShapeNode {
  const s = faceSource(a.faceAsset);
  return path(
    s.coverage,
    (p) => {
      if (p.y <= 0) {
        const side = p.x < 0 ? -1 : 1,
          y = f32(f32(p.y * faceSource(a.scalpAsset).crown) / s.crown);
        return upperPoint(
          a,
          point(
            f32(f32(p.x * profileWidth(a.scalpAsset, y, side)) / profileWidth(a.faceAsset, p.y, side)),
            y,
          ),
        );
      }
      return facePoint(a, p);
    },
    true,
  );
}
export enum HairPart {
  Cap,
  Fringe,
  Back,
  Tied,
}
export function characterHairPart(a: Appearance, part: HairPart): SceneNode {
  let scene = new SceneNode();
  const selected = safeCharacterHairAsset(a.hairAsset);
  if (selected === baldHairAsset || selected >= hairAssetCount) return scene;
  const h = source.hair[hairIndex(selected)],
    fit = new HairFit(a, selected),
    outline = mix(rgb(a.hair), [15, 17, 16], f32(0.8));
  const draw = (parts: RawPath[], shadow = false, linesOnly = false) => {
    const solid = !parts.some((p) => p.stroke === 0 && p.tone >= 90);
    for (const raw of parts) {
      if (linesOnly && raw.stroke === 0) continue;
      const shape = path(
        raw,
        (point) => {
          let p = { ...point };
          if (part === HairPart.Tied) return fit.rigid(p, { x: 0, y: -h.crown });
          if (part === HairPart.Back)
            p.y = f32(p.y + f32(h.backExtension * smooth(f32(f32(p.y + f32(1.8)) / f32(1.5)))));
          return part === HairPart.Fringe && h.curtain ? fit.fringe(p) : fit.map(p);
        },
        part !== HairPart.Tied && (!fit.identity() || h.backExtension !== 0),
      );
      style(shape, raw, shadow ? rgb(a.hairShade) : solid || raw.tone >= 90 ? rgb(a.hair) : outline);
      if (shadow && part === HairPart.Back) {
        const top = fit.map(point(0, f32(h.splitY - f32(0.02)))).y;
        shape.clip(new ShapeNode().appendRect(-100, top, 200, f32(100 - top)));
      }
      scene.add(shape);
    }
  };
  if (h.full.length) {
    if (part === HairPart.Back && h.rearMode === 2) return scene;
    if (part === HairPart.Tied && h.tiedTop < -99) return scene;
    if (part === HairPart.Back && h.rearMode === 4) {
      draw(h.shadow);
      if (h.group === 0) draw(h.full, false, true);
      return scene;
    }
    if (part === HairPart.Back) draw(h.shadow, true);
    if (part === HairPart.Back && h.rearMode === 1) return scene;
    const outer = scene;
    scene = new SceneNode();
    draw(h.full);
    const inkScene = scene;
    scene = outer;
    const overlap = f32(0.02),
      top =
        part === HairPart.Cap
          ? f32(h.tiedTop - overlap)
          : part === HairPart.Fringe
            ? f32(h.splitY - overlap)
            : part === HairPart.Back
              ? f32(f32(3.5) - overlap)
              : -100,
      fringeBottom = h.rearMode === 4 ? 0 : h.rearMode === 2 ? f32(1.2) : f32(3.5),
      bottom =
        part === HairPart.Cap
          ? f32(h.splitY + overlap)
          : part === HairPart.Fringe
            ? f32(fringeBottom + overlap)
            : part === HairPart.Back
              ? 100
              : f32(h.tiedTop + overlap),
      clip = new ShapeNode(),
      mapped = (p: Point) => (part === HairPart.Tied ? fit.rigid(p, point(0, -h.crown)) : fit.map(p));
    let p = mapped(point(-100, top));
    clip.moveTo(p.x, p.y);
    for (const q of [point(100, top), point(100, bottom), point(-100, bottom)]) {
      p = mapped(q);
      clip.lineTo(p.x, p.y);
    }
    clip.close();
    if ((h.rearMode === 1 || h.rearMode === 3) && (part === HairPart.Fringe || part === HairPart.Back)) {
      const innerTop = Math.max(top, f32(1.2)),
        edge = f32(h.radius * f32(0.8));
      p = mapped(point(-edge, innerTop));
      clip.moveTo(p.x, p.y);
      for (const q of [point(edge, innerTop), point(edge, bottom), point(-edge, bottom)]) {
        p = mapped(q);
        clip.lineTo(p.x, p.y);
      }
      clip.close().fillRule('evenOdd');
    }
    inkScene.clip(clip);
    scene.add(inkScene);
  } else
    draw(
      part === HairPart.Cap
        ? h.cap
        : part === HairPart.Fringe
          ? h.fringe
          : part === HairPart.Back
            ? h.back
            : h.tied,
      part === HairPart.Back,
    );
  return scene;
}
export function characterHair(a: Appearance, front: boolean): SceneNode {
  const scene = new SceneNode();
  if (front)
    scene
      .add(characterHairPart(a, HairPart.Tied))
      .add(characterHairPart(a, HairPart.Cap))
      .add(characterHairPart(a, HairPart.Fringe));
  else {
    if (
      a.hairAsset !== baldHairAsset &&
      source.hair[hairIndex(safeCharacterHairAsset(a.hairAsset))].rearMode !== 4
    ) {
      const base = { ...a };
      base.faceAsset = base.scalpAsset;
      base.jawWidth = base.chinLength = 1;
      base.jawTarget = 255;
      base.jawBlend = base.faceBlend = 0;
      base.cheekFullness = f32(0.5);
      const plate = characterSkull(base).fill(a.hairShade.r, a.hairShade.g, a.hairShade.b),
        upper = new ShapeNode().appendRect(-100, -100, 200, f32(101.2));
      plate.clip(upper);
      scene.add(plate);
    }
    scene.add(characterHairPart(a, HairPart.Back));
  }
  return scene;
}
export function characterEarRoots(a: Appearance): Point[] {
  return faceSource(a.scalpAsset).earRoots.map((p) => {
    const side = p.x < 0 ? -1 : 1,
      width = f32(f32(f32(upperWidth(a, p.y, side) * headWidth(a)) * a.scalpWidth) * a.templeWidth);
    return point(p.x < 0 || Object.is(p.x, -0) ? -Math.abs(width) : Math.abs(width), f32(p.y + a.earHeight));
  });
}
export function characterEars(a: Appearance): SceneNode {
  const scene = new SceneNode(),
    roots = characterEarRoots(a),
    s = faceSource(a.earAsset);
  let i = 0;
  for (const paths of [s.earLeft, s.earRight]) {
    const root = roots[i++];
    for (const raw of paths) {
      const shape = path(raw, (p) => {
        const angle = f32((i === 1 ? -1 : 1) * a.earTilt),
          co = f32(Math.cos(angle)),
          si = f32(Math.sin(angle));
        return add(
          root,
          mul(point(f32(f32(co * p.x) - f32(si * p.y)), f32(f32(si * p.x) + f32(co * p.y))), a.earScale),
        );
      });
      style(shape, raw, raw.tone > 230 ? rgb(a.skin) : inkRgb);
      scene.add(shape);
    }
  }
  const skull = characterSkull(a),
    clip = new ShapeNode().appendRect(-100, -100, 200, 200);
  for (const command of skull.commands) {
    switch (command[0]) {
      case 'M':
        clip.moveTo(command[1], command[2]);
        break;
      case 'L':
        clip.lineTo(command[1], command[2]);
        break;
      case 'C':
        clip.cubicTo(command[1], command[2], command[3], command[4], command[5], command[6]);
        break;
      case 'Z':
        clip.close();
        break;
    }
  }
  clip.fillRule('evenOdd');
  scene.clip(clip);
  return new SceneNode().add(scene);
}
export function characterEyes(a: Appearance): SceneNode {
  const scene = new SceneNode();
  eyes(scene, a);
  return scene;
}
export function characterBrows(a: Appearance): SceneNode {
  const scene = new SceneNode();
  brows(scene, a);
  return scene;
}
export function characterFace(a: Appearance): SceneNode {
  const scene = new SceneNode();
  for (const top of [true, false]) {
    const s = faceSource(top ? a.scalpAsset : a.faceAsset),
      half = new SceneNode();
    for (const raw of s.paths) {
      const shape = path(raw, (p) => (top ? upperPoint(a, p) : facePoint(a, p)), true);
      style(shape, raw, raw.tone > 230 ? rgb(a.skin) : inkRgb);
      half.add(shape);
    }
    half.clip(new ShapeNode().appendRect(-100, top ? -100 : 0, 200, 100));
    scene.add(half);
  }
  scene.add(characterEyes(a)).add(characterBrows(a));
  const s = faceSource(a.faceAsset);
  if (a.freckles)
    for (const side of [-1, 1])
      for (const p of [point(f32(1.1), f32(0.85)), point(f32(1.35), f32(0.98)), point(f32(1.6), f32(0.88))]) {
        p.x = f32(p.x * side);
        scene.add(
          ellipse(facePoint(a, p), f32(0.035), f32(0.035), opaque(mix(rgb(a.skin), rgb(a.hair), f32(0.65)))),
        );
      }
  const nose = facePoint(a, point(0, s.noseY));
  scene.add(line(nose, add(nose, point(0, f32(f32(0.1) * a.noseScale))), f32(0.065), ink));
  const width = f32(f32(clamp(s.mouthWidth, f32(0.18), f32(0.45)) * a.mouthWidth) / 6),
    center = facePoint(a, point(0, s.mouthY)),
    mouth = new ShapeNode().moveTo(f32(center.x - f32(width * f32(0.5))), center.y);
  mouth
    .cubicTo(
      f32(center.x - f32(width * f32(0.2))),
      f32(center.y + f32(a.mouthCurve * f32(0.16))),
      f32(center.x + f32(width * f32(0.2))),
      f32(center.y + f32(a.mouthCurve * f32(0.16))),
      f32(center.x + f32(width * f32(0.5))),
      center.y,
    )
    .strokeFill(...ink)
    .strokeWidth(f32(f32(0.065) * a.lipFullness))
    .strokeCap('round');
  scene.add(mouth);
  return scene;
}
export function characterHead(a: Appearance): SceneNode {
  return new SceneNode()
    .add(characterHair(a, false))
    .add(characterFace(a))
    .add(characterHair(a, true))
    .add(characterEars(a));
}
export function characterOutfit(a: Appearance): SceneNode {
  const scene = new SceneNode();
  for (const raw of source.outfits[outfitIndex(a.outfitAsset)].paths) {
    const shape = path(raw, (p) => p),
      color: Rgb = [raw.tone & 255, raw.tone & 255, raw.tone & 255];
    style(shape, raw, color);
    scene.add(shape);
  }
  scene.clip(path(source.outfits[outfitIndex(a.outfitAsset)].coverage, (p) => p));
  return new SceneNode().add(scene);
}
export function characterFigure(a: Appearance): SceneNode {
  const scene = new SceneNode().add(characterHair(a, false)),
    offset = outfitOffset(a);
  scene.add(
    polygon(
      [
        point(-f32(0.36), f32(chinBottom(a) - f32(0.6))),
        point(f32(0.36), f32(chinBottom(a) - f32(0.6))),
        point(f32(0.42), f32(f32(4.8) + offset)),
        point(-f32(0.42), f32(f32(4.8) + offset)),
      ],
      opaque(rgb(a.skin)),
    ),
  );
  const body = characterOutfit(a);
  body.transform([
    a.bodyWidth,
    0,
    0,
    0,
    a.bodyHeight,
    f32(offset + f32(f32(4.8) * f32(1 - a.bodyHeight))),
    0,
    0,
    1,
  ]);
  return scene.add(body).add(characterFace(a)).add(characterHair(a, true)).add(characterEars(a));
}
export interface CharacterBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function characterHeadBounds(a: Appearance): CharacterBounds {
  const frame = characterCranium(a);
  return {
    left: -Math.max(5, f32(frame.rightTemple.x + 1)),
    top: Math.min(-6, f32(frame.crown.y - 2)),
    right: Math.max(5, f32(frame.rightTemple.x + 1)),
    bottom: Math.max(f32(3.5), chinBottom(a)),
  };
}
