import { point, type Point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import {
  BuildingProjection,
  RoofShape,
  Trim,
  Ornament,
  type Block,
  type Patch,
  type Model,
} from './building-model';
import type { Rgb } from './paint';
export interface Vertex {
  x: number;
  y: number;
  depth: number;
}
export type Polygon = Vertex[];
export type OpacityKeys = [number, number][];
export enum FaceStyle {
  Filled,
  Outlined,
  Line,
}
export interface Face {
  shape(frame: number): Polygon;
  color: Rgb;
  style: FaceStyle;
  width: number;
  opacity: OpacityKeys;
}
// The native crystal uses ten fixed authored angles (i * .628f). These float32
// directions preserve native cosf/sinf rounding before radius animation and BSP.
const crystalRingDirections: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.80920416116714478, 0.58752751350402832],
  [0.30962276458740234, 0.95085948705673218],
  [-0.30810809135437012, 0.9513513445854187],
  [-0.80826747417449951, 0.58881551027297974],
  [-0.99999874830245972, 0.0015925479819998145],
  [-0.81013882160186768, -0.58623808622360229],
  [-0.31113690137863159, -0.95036512613296509],
  [0.30659264326095581, -0.95184081792831421],
  [0.80732887983322144, -0.59010177850723267],
];
const timberLine: Rgb = [40, 30, 24],
  doorWood: Rgb = [44, 30, 24],
  pole: Rgb = [36, 30, 28];
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
function outBack(t: number): number {
  const c1 = f32(1.70158),
    c3 = f32(c1 + 1);
  t = f32(clamp01(t) - 1);
  return f32(f32(1 + f32(f32(f32(c3 * t) * t) * t)) + f32(f32(c1 * t) * t));
}
function inCubic(t: number): number {
  t = clamp01(t);
  return f32(f32(t * t) * t);
}
function outCubic(t: number): number {
  t = f32(1 - clamp01(t));
  return f32(1 - f32(f32(t * t) * t));
}
const scaled = (c: Rgb, k: number): Rgb => [
  Math.trunc(f32(c[0] * k)) & 255,
  Math.trunc(f32(c[1] * k)) & 255,
  Math.trunc(f32(c[2] * k)) & 255,
];
function face(
  shape: (frame: number) => Polygon,
  color: Rgb,
  style: FaceStyle,
  width: number,
  opacity: OpacityKeys,
): Face {
  return { shape: (frame) => shape(f32(frame)), color, style, width: f32(width), opacity };
}
export class Motion {
  start = 0;
  sinking = false;
  offset = point();
  turn = 0;
  pivot = point();
  projection = new BuildingProjection();
  place(x: number, y: number, z = 0): Vertex {
    const lx = f32(f32(x + this.offset.x) - this.pivot.x),
      ly = f32(f32(y + this.offset.y) - this.pivot.y),
      c = f32(Math.cos(this.turn)),
      s = f32(Math.sin(this.turn)),
      worldX = f32(f32(this.pivot.x + f32(lx * c)) - f32(ly * s)),
      worldY = f32(f32(this.pivot.y + f32(lx * s)) + f32(ly * c)),
      screen = this.projection.project(worldX, worldY, z);
    return { x: screen.x, y: screen.y, depth: f32(worldX + worldY) };
  }
  wall(b: Block, frame: number): number {
    const t = f32(f32(frame - this.start) - b.delay);
    return f32(b.wall * (this.sinking ? f32(1 - inCubic(f32(t / 12))) : outBack(f32(f32(t - 6) / 14))));
  }
  roof(b: Block, frame: number): number {
    const t = f32(f32(frame - this.start) - b.delay);
    return f32(b.roof * (this.sinking ? f32(1 - inCubic(f32(t / 8))) : outBack(f32(f32(t - 16) / 12))));
  }
  detail(b: Block, frame: number): number {
    const t = f32(f32(frame - this.start) - b.delay);
    return this.sinking ? f32(1 - clamp01(f32(t / 6))) : outBack(f32(f32(t - 26) / 10));
  }
  body(delay: number): OpacityKeys {
    const at = f32(this.start + delay);
    return this.sinking
      ? [
          [f32(at + 9), 100],
          [f32(at + 13), 0],
        ]
      : [
          [f32(at + 4), 0],
          [f32(at + 7), 100],
        ];
  }
  late(delay: number, riseAt: number): OpacityKeys {
    const at = f32(this.start + delay);
    return this.sinking
      ? [
          [f32(at + 1), 100],
          [f32(at + 5), 0],
        ]
      : [
          [f32(at + riseAt), 0],
          [f32(f32(at + riseAt) + 6), 100],
        ];
  }
}
class Shell {
  constructor(
    readonly b: Block,
    readonly motion: Motion,
  ) {}
  xm(): number {
    return f32(f32(this.b.x0 + this.b.x1) / 2);
  }
  ym(): number {
    return f32(f32(this.b.y0 + this.b.y1) / 2);
  }
  at(x: number, y: number, z: number): Vertex {
    return this.motion.place(x, y, z);
  }
  top(frame: number): number {
    return f32(this.b.base + this.motion.wall(this.b, frame));
  }
  peak(frame: number): number {
    return f32(this.top(frame) + this.motion.roof(this.b, frame));
  }
  summit(frame: number): Vertex {
    return this.at(this.xm(), this.ym(), this.peak(frame));
  }
  wall(frontLeft: boolean, t: number, z: number): Vertex {
    return frontLeft
      ? this.at(f32(this.b.x0 + f32(f32(this.b.x1 - this.b.x0) * t)), this.b.y1, z)
      : this.at(this.b.x1, f32(this.b.y0 + f32(f32(this.b.y1 - this.b.y0) * t)), z);
  }
}
function roofFaces(back: Face[], front: Face[], s: Shell): void {
  const body = s.motion.body(s.b.delay),
    corner = (x: number, y: number) => (frame: number) => s.at(x, y, s.top(frame)),
    A = corner(s.b.x0, s.b.y0),
    B = corner(s.b.x1, s.b.y0),
    C = corner(s.b.x1, s.b.y1),
    D = corner(s.b.x0, s.b.y1),
    b = s.b;
  const add = (into: Face[], shape: (frame: number) => Polygon, color: Rgb) =>
    into.push(face(shape, color, FaceStyle.Outlined, f32(1.2), body));
  switch (b.shape) {
    case RoofShape.Flat:
      add(front, (f) => [A(f), B(f), C(f), D(f)], b.roofLit);
      break;
    case RoofShape.GableX:
      add(
        back,
        (f) => [A(f), B(f), s.at(b.x1, s.ym(), s.peak(f)), s.at(b.x0, s.ym(), s.peak(f))],
        b.roofShade,
      );
      add(
        front,
        (f) => [D(f), C(f), s.at(b.x1, s.ym(), s.peak(f)), s.at(b.x0, s.ym(), s.peak(f))],
        b.roofLit,
      );
      break;
    case RoofShape.GableY:
      add(back, (f) => [A(f), D(f), s.at(s.xm(), b.y1, s.peak(f)), s.at(s.xm(), b.y0, s.peak(f))], b.roofLit);
      add(
        front,
        (f) => [B(f), C(f), s.at(s.xm(), b.y1, s.peak(f)), s.at(s.xm(), b.y0, s.peak(f))],
        b.roofShade,
      );
      break;
    case RoofShape.Pyramid:
      add(back, (f) => [A(f), B(f), s.at(s.xm(), s.ym(), s.peak(f))], b.roofShade);
      add(back, (f) => [A(f), D(f), s.at(s.xm(), s.ym(), s.peak(f))], b.roofLit);
      add(front, (f) => [D(f), C(f), s.at(s.xm(), s.ym(), s.peak(f))], b.roofLit);
      add(front, (f) => [C(f), B(f), s.at(s.xm(), s.ym(), s.peak(f))], b.roofShade);
      break;
  }
}
function wallFaces(faces: Face[], s: Shell): void {
  const b = s.b,
    body = s.motion.body(b.delay);
  for (const frontLeft of [true, false]) {
    const gableEnd = frontLeft ? b.shape === RoofShape.GableY : b.shape === RoofShape.GableX;
    faces.push(
      face(
        (f) => {
          const h = s.top(f),
            apex = gableEnd ? s.peak(f) : h;
          return [
            s.wall(frontLeft, 0, b.base),
            s.wall(frontLeft, 1, b.base),
            s.wall(frontLeft, 1, h),
            s.wall(frontLeft, f32(0.5), apex),
            s.wall(frontLeft, 0, h),
          ];
        },
        frontLeft ? b.wallLit : b.wallShade,
        FaceStyle.Outlined,
        f32(1.2),
        body,
      ),
    );
  }
  if (b.trim === Trim.Timber)
    for (const frontLeft of [true, false]) {
      for (const t of [f32(0.04), f32(0.96)])
        faces.push(
          face(
            (f) => [s.wall(frontLeft, t, b.base), s.wall(frontLeft, t, s.top(f))],
            timberLine,
            FaceStyle.Line,
            f32(1.6),
            body,
          ),
        );
      faces.push(
        face(
          (f) => {
            const z = f32(b.base + f32(s.motion.wall(b, f) * f32(0.52)));
            return [s.wall(frontLeft, f32(0.04), z), s.wall(frontLeft, f32(0.96), z)];
          },
          timberLine,
          FaceStyle.Line,
          f32(1.6),
          body,
        ),
      );
      const brace = frontLeft ? f32(0.72) : f32(0.3);
      faces.push(
        face(
          (f) => [
            s.wall(frontLeft, f32(brace - f32(0.18)), f32(b.base + f32(s.motion.wall(b, f) * f32(0.52)))),
            s.wall(frontLeft, f32(brace + f32(0.14)), s.top(f)),
          ],
          timberLine,
          FaceStyle.Line,
          f32(1.3),
          body,
        ),
      );
    }
  const opening = (
    frontLeft: boolean,
    along: number,
    halfWidth: number,
    z0: number,
    z1: number,
    color: Rgb,
    keys: OpacityKeys,
  ) =>
    faces.push(
      face(
        (f) => {
          const h = s.motion.wall(b, f);
          return [
            s.wall(frontLeft, f32(along - halfWidth), f32(b.base + f32(h * z0))),
            s.wall(frontLeft, f32(along + halfWidth), f32(b.base + f32(h * z0))),
            s.wall(frontLeft, f32(along + halfWidth), f32(b.base + f32(h * z1))),
            s.wall(frontLeft, f32(along - halfWidth), f32(b.base + f32(h * z1))),
          ];
        },
        color,
        FaceStyle.Filled,
        f32(1.2),
        keys,
      ),
    );
  for (const frontLeft of [true, false]) {
    const span = frontLeft ? f32(b.x1 - b.x0) : f32(b.y1 - b.y0),
      half = Math.min(f32(f32(0.07) / span), f32(0.18)),
      doorway = b.door && b.doorFacing === (frontLeft ? 0 : 3);
    for (let i = 0; i < b.windows; i++) {
      const fraction = f32(f32(i + 1) / f32(b.windows + 1)),
        along = doorway ? f32((frontLeft ? f32(0.55) : f32(0.13)) + f32(f32(0.32) * fraction)) : fraction;
      opening(
        frontLeft,
        along,
        half,
        f32(0.4),
        f32(0.74),
        b.glass,
        s.motion.late(b.delay, f32(28 + f32(i * 2))),
      );
    }
  }
  if (b.door && (b.doorFacing === 0 || b.doorFacing === 3)) {
    const frontLeft = b.doorFacing === 0,
      span = frontLeft ? f32(b.x1 - b.x0) : f32(b.y1 - b.y0);
    opening(
      frontLeft,
      frontLeft ? f32(0.28) : f32(0.72),
      Math.min(f32(f32(0.09) / span), f32(0.2)),
      0,
      b.wall > 8 ? f32(0.58) : f32(0.9),
      doorWood,
      body,
    );
  }
}
function battlements(faces: Face[], s: Shell): void {
  const b = s.b,
    body = s.motion.body(b.delay),
    stakes = b.trim === Trim.Stakes,
    rise = stakes ? 7 : 5;
  const edges: {
    from: Point;
    to: Point;
    color: Rgb;
  }[] = [
    { from: point(b.x0, b.y0), to: point(b.x1, b.y0), color: b.roofShade },
    { from: point(b.x0, b.y0), to: point(b.x0, b.y1), color: b.roofShade },
    { from: point(b.x0, b.y1), to: point(b.x1, b.y1), color: b.wallLit },
    { from: point(b.x1, b.y0), to: point(b.x1, b.y1), color: b.wallShade },
  ];
  for (const edge of edges) {
    const length = f32(Math.hypot(f32(edge.to.x - edge.from.x), f32(edge.to.y - edge.from.y))),
      count = Math.max(2, Math.trunc(f32(length / (stakes ? f32(0.12) : f32(0.2)))));
    for (let i = 0; i < count; i++) {
      const t0 = f32(i / count),
        t1 = f32(t0 + f32((stakes ? 1 : f32(0.55)) / count)),
        p = (t: number, z: number) =>
          s.at(
            f32(edge.from.x + f32(f32(edge.to.x - edge.from.x) * t)),
            f32(edge.from.y + f32(f32(edge.to.y - edge.from.y) * t)),
            z,
          );
      if (stakes)
        faces.push(
          face(
            (f) => {
              const h = s.top(f),
                r = f32(f32(rise * s.motion.wall(b, f)) / Math.max(1, b.wall));
              return [p(t0, h), p(t1, h), p(f32(f32(t0 + t1) / 2), f32(h + r))];
            },
            edge.color,
            FaceStyle.Outlined,
            f32(1.2),
            body,
          ),
        );
      else
        faces.push(
          face(
            (f) => {
              const h = s.top(f),
                r = f32(f32(rise * s.motion.wall(b, f)) / Math.max(1, b.wall));
              return [p(t0, h), p(t1, h), p(t1, f32(h + r)), p(t0, f32(h + r))];
            },
            edge.color,
            FaceStyle.Outlined,
            f32(1.2),
            body,
          ),
        );
    }
  }
}
function ornaments(faces: Face[], s: Shell): void {
  const b = s.b,
    keys = s.motion.late(b.delay, 30);
  if (b.ornament === Ornament.Banner) {
    faces.push(
      face(
        (f) => {
          const a = s.summit(f),
            k = s.motion.detail(b, f);
          return [a, { x: a.x, y: f32(a.y - f32(20 * k)), depth: a.depth }];
        },
        pole,
        FaceStyle.Line,
        f32(1.4),
        keys,
      ),
    );
    faces.push(
      face(
        (f) => {
          const a = s.summit(f),
            k = s.motion.detail(b, f);
          return [
            { x: a.x, y: f32(a.y - f32(20 * k)), depth: a.depth },
            { x: f32(a.x + f32(12 * k)), y: f32(a.y - f32(17 * k)), depth: a.depth },
            { x: f32(a.x + f32(9 * k)), y: f32(a.y - f32(f32(14.5) * k)), depth: a.depth },
            { x: f32(a.x + f32(12 * k)), y: f32(a.y - f32(12 * k)), depth: a.depth },
            { x: a.x, y: f32(a.y - f32(11 * k)), depth: a.depth },
          ];
        },
        b.accent,
        FaceStyle.Outlined,
        f32(1.2),
        keys,
      ),
    );
  } else if (b.ornament === Ornament.Crystal) {
    const centre = (f: number): Vertex => {
      const a = s.summit(f);
      return { x: a.x, y: f32(a.y - f32(16 * s.motion.detail(b, f))), depth: a.depth };
    };
    faces.push(
      face(
        (f) => {
          const c = centre(f),
            r = f32(13 * s.motion.detail(b, f)),
            ring: Polygon = [];
          for (let i = 0; i < 10; i++)
            ring.push({
              x: f32(c.x + f32(r * crystalRingDirections[i][0])),
              y: f32(c.y + f32(f32(r * f32(0.8)) * crystalRingDirections[i][1])),
              depth: c.depth,
            });
          return ring;
        },
        b.accent,
        FaceStyle.Filled,
        f32(1.2),
        s.motion.sinking
          ? keys
          : [
              [f32(f32(s.motion.start + b.delay) + 30), 0],
              [f32(f32(s.motion.start + b.delay) + 36), 22],
            ],
      ),
    );
    for (const left of [true, false])
      faces.push(
        face(
          (f) => {
            const c = centre(f),
              k = s.motion.detail(b, f),
              side = left ? f32(-f32(5.5) * k) : f32(f32(5.5) * k);
            return [
              { x: c.x, y: f32(c.y - f32(10 * k)), depth: c.depth },
              { x: f32(c.x + side), y: c.y, depth: c.depth },
              { x: c.x, y: f32(c.y + f32(8 * k)), depth: c.depth },
            ];
          },
          left ? b.accent : scaled(b.accent, f32(0.58)),
          FaceStyle.Outlined,
          f32(1.2),
          keys,
        ),
      );
  }
}
function patchFaces(faces: Face[], patch: Patch, motion: Motion): void {
  const keys = motion.body(patch.delay),
    grow = (f: number) => (motion.sinking ? 1 : outCubic(f32(f32(f32(f - motion.start) - patch.delay) / 10))),
    cx = f32(f32(patch.x0 + patch.x1) / 2),
    cy = f32(f32(patch.y0 + patch.y1) / 2),
    at = (x: number, y: number, k: number) =>
      motion.place(f32(cx + f32(f32(x - cx) * k)), f32(cy + f32(f32(y - cy) * k)));
  faces.push(
    face(
      (f) => {
        const k = grow(f);
        return [
          at(patch.x0, patch.y0, k),
          at(patch.x1, patch.y0, k),
          at(patch.x1, patch.y1, k),
          at(patch.x0, patch.y1, k),
        ];
      },
      patch.color,
      FaceStyle.Filled,
      f32(1.2),
      keys,
    ),
  );
  for (let i = 0; i < patch.furrows; i++) {
    const y = f32(patch.y0 + f32(f32(f32(patch.y1 - patch.y0) * f32(i + f32(0.5))) / patch.furrows));
    faces.push(
      face(
        (f) => {
          const k = grow(f);
          return [at(f32(patch.x0 + f32(0.05)), y, k), at(f32(patch.x1 - f32(0.05)), y, k)];
        },
        patch.furrow,
        FaceStyle.Line,
        f32(1.4),
        keys,
      ),
    );
  }
}
export function buildingFaces(model: Model, motion: Motion, faces: Face[] = []): Face[] {
  const snapshot = Object.assign(new Motion(), motion, {
    offset: { ...motion.offset },
    pivot: { ...motion.pivot },
    projection: new BuildingProjection(motion.projection.halfWidth, motion.projection.halfHeight),
  });
  for (const patch of model.patches) patchFaces(faces, structuredClone(patch), snapshot);
  for (const block of model.blocks) {
    const shell = new Shell(structuredClone(block), snapshot),
      back: Face[] = [],
      walls: Face[] = [],
      front: Face[] = [];
    roofFaces(back, front, shell);
    wallFaces(walls, shell);
    if (block.shape === RoofShape.Flat && block.trim !== Trim.None && block.trim !== Trim.Timber)
      battlements(front, shell);
    ornaments(front, shell);
    faces.push(...back, ...walls, ...front);
  }
  return faces;
}
