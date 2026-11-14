// Shared drawing kit for the opening saga: flat storybook panels on a fixed 1600 x 900 board.
import { SceneNode, ShapeNode, type PictureNode, type Rgb } from './paint';
import { capsule, pen, shapeOf, type Contour, type Form } from './outline-form';
import type { Finish } from './form-paint';

export const sagaWidth = 1600;
export const sagaHeight = 900;

/** Pictures a panel may show, loaded by whoever plays the saga. */
export interface SagaArt {
  /** The game's world seen from above; 1 x 1 until it has loaded. */
  world: PictureNode;
}
export interface SagaPanel {
  readonly scene: SceneNode;
  /** One-shot sounds under `assets/audio`, each fired as the panel passes `at` (0..1). */
  readonly cues?: readonly { at: number; sound: string; volume: number }[];
  /** `beat` runs 0..1 across the panel; `seconds` keeps looping motion at one pace. */
  pose(beat: number, seconds: number): void;
}

export const sagaFinish: Finish = { ink: 0, rim: 12 };
export const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
export const ease = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
/** 0 before `from`, 1 after `to`, eased between. */
export const span = (v: number, from: number, to: number): number => ease((v - from) / (to - from));
export const alphaOf = (v: number): number => Math.round(clamp01(v) * 255);

/** A backdrop larger than the board, so a drifting camera never shows its edge. */
export function backdrop(top: Rgb, bottom: Rgb, from = 0, to = sagaHeight): ShapeNode {
  return new ShapeNode().appendRect(-200, -200, sagaWidth + 400, sagaHeight + 400).fillGradient({
    type: 'linear',
    coordinates: [0, from, 0, to],
    stops: [
      { offset: 0, color: [...top, 255] },
      { offset: 1, color: [...bottom, 255] },
    ],
  });
}
export const flat = (form: Form, color: Rgb, alpha = 255): ShapeNode => shapeOf(form).fill(...color, alpha);
/** A rounded stroke through points: ribs, roots, spears. */
export function stroke(points: [number, number][], width: number, color: Rgb, alpha = 255): ShapeNode {
  const shape = new ShapeNode().moveTo(points[0][0], points[0][1]);
  if (points.length === 4)
    shape.cubicTo(points[1][0], points[1][1], points[2][0], points[2][1], points[3][0], points[3][1]);
  else for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  return shape
    .strokeWidth(width)
    .strokeCap('round')
    .strokeJoin('round')
    .strokeFill(...color, alpha);
}
/** Scale and shift about a point: slow camera pushes and breathing. */
export function about(node: SceneNode | ShapeNode, x: number, y: number, k: number, dx = 0, dy = 0): void {
  node.transform([k, 0, x * (1 - k) + dx, 0, k, y * (1 - k) + dy, 0, 0, 1]);
}
export function turn(node: SceneNode, x: number, y: number, radians: number, dx = 0, dy = 0): void {
  const c = Math.cos(radians),
    s = Math.sin(radians);
  node.transform([c, -s, x - x * c + y * s + dx, s, c, y - x * s - y * c + dy, 0, 0, 1]);
}
/** Deterministic scatter in 0..1 for stars, embers and waves. */
export const scatter = (i: number, salt = 0): number => {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
/** A long low bank with a gently lobed top: mist, cloud, far hills. */
export function bank(x: number, y: number, w: number, h: number, lobes: number, depth = h): Form {
  return [
    pen(x, y)
      .lobes(x + w, y, lobes, h * 0.42)
      .line(x + w, y + depth)
      .line(x, y + depth)
      .close(),
  ];
}
/** A cloud: a lobed crown over a soft, curved belly. */
export function cloud(x: number, y: number, w: number, h: number, lobes = 4): Form {
  return [
    pen(x, y)
      .lobes(x + w, y, lobes, h * 0.5)
      .curve([x + w * 1.04, y + h * 0.3], [x + w * 0.8, y + h * 0.5])
      .curve([x + w * 0.5, y + h * 0.62], [x + w * 0.2, y + h * 0.5])
      .curve([x - w * 0.04, y + h * 0.3], [x, y])
      .close(),
  ];
}
/** A fir of three drooping tiers, its foot at (x, y). */
export function fir(x: number, y: number, h: number): Form {
  const form: Form = [];
  for (let tier = 0; tier < 3; tier++) {
    const w = h * (0.34 - tier * 0.07),
      base = y - h * 0.3 * tier,
      top = base - h * (0.5 - tier * 0.05);
    form.push(
      pen(x - w, base)
        .curve([x - w * 0.5, base - (base - top) * 0.3], [x - w * 0.14, base - (base - top) * 0.7], [x, top])
        .curve(
          [x + w * 0.14, base - (base - top) * 0.7],
          [x + w * 0.5, base - (base - top) * 0.3],
          [x + w, base],
        )
        .curve(
          [x + w * 0.5, base + h * 0.05],
          [x, base + h * 0.02],
          [x - w * 0.5, base + h * 0.05],
          [x - w, base],
        )
        .close(),
    );
  }
  return form;
}
export function waves(count: number, top: number, bottom: number, color: Rgb, alpha: number): SceneNode {
  const scene = new SceneNode();
  for (let i = 0; i < count; i++) {
    const y = top + (bottom - top) * scatter(i, 1),
      x = -100 + (sagaWidth + 200) * scatter(i, 2),
      w = 60 + 150 * scatter(i, 3);
    scene.add(flat([capsule(x, y, x + w, y, 2.5 + ((y - top) / (bottom - top)) * 3)], color, alpha));
  }
  return scene;
}

/** The giant's ice: a cold blue body, pale rime, a deep blue for what lies behind, a near-white glint. */
export const frost: Rgb = [140, 164, 206];
export const rime: Rgb = [216, 230, 246];
export const iceGlint: Rgb = [240, 250, 255];
export const darkEye: Rgb = [30, 28, 44];
/** A pointed, hooked lock from a root to a tip, all curves: icicles, hair, fingers. */
export function lock(ax: number, ay: number, tx: number, ty: number, width: number, bend = 0.16): Contour {
  const dx = tx - ax,
    dy = ty - ay,
    length = Math.hypot(dx, dy) || 1,
    nx = (-dy / length) * (width / 2),
    ny = (dx / length) * (width / 2),
    bx = (-dy / length) * length * bend,
    by = (dx / length) * length * bend;
  return pen(ax - nx, ay - ny)
    .cubic(ax - nx + dx * 0.4 + bx, ay - ny + dy * 0.4 + by, tx - dx * 0.25 + bx, ty - dy * 0.25 + by, tx, ty)
    .cubic(
      tx - dx * 0.3 + bx * 0.5,
      ty - dy * 0.3 + by * 0.5,
      ax + nx + dx * 0.35 + bx * 0.5,
      ay + ny + dy * 0.35 + by * 0.5,
      ax + nx,
      ay + ny,
    )
    .curve([ax - dx * 0.06, ay - dy * 0.06], [ax - nx, ay - ny])
    .close();
}
/** A raven in flight, about 60 across, centred on the origin. */
export function raven(color: Rgb = [24, 22, 38]): SceneNode {
  return new SceneNode().add(
    flat(
      [
        pen(-30, -8)
          .curve([-14, -14], [0, 0])
          .curve([14, -14], [30, -8])
          .curve([14, -2], [4, 8])
          .line(0, 14)
          .line(-4, 8)
          .curve([-14, -2])
          .close(),
      ],
      color,
    ),
  );
}
