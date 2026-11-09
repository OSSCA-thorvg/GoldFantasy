import { add, sub, scale, lerp, project, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { Layer } from '../../engine/src/world-types';
import type { WorldMap } from '../../engine/src/world-map';
import { ShapeNode, SceneNode, type Rgb, type Rgba } from './paint';
import { appendPolygon, fill, opaque, glow } from './vector-paint';
const f = Math.fround;
function filled(points: Point[], color: Rgba): ShapeNode {
  const shape = new ShapeNode();
  appendPolygon(shape, points);
  fill(shape, color);
  return shape;
}
const ledges: Rgb[] = [
    [150, 186, 212],
    [44, 74, 108],
    [8, 18, 36],
    [3, 7, 18],
    [1, 4, 12],
  ],
  walls: Rgb[] = [
    [96, 136, 174],
    [16, 32, 58],
    [3, 9, 22],
    [1, 5, 14],
    [0, 2, 8],
  ];
const frost: Rgb = [214, 226, 238],
  cornice: Rgb = [236, 244, 250],
  icicle: Rgb = [206, 228, 242],
  mist: Rgb = [226, 236, 244];
export function paintHvergelmir(ornaments: SceneNode, map: WorldMap): void {
  const spring = map.hvergelmir(),
    lake = (p: Point) =>
      Math.min(f(map.value(Layer.Land, p) - f(0.12)), f(f(0.3) - map.value(Layer.Elevation, p)));
  if (lake(spring) <= 0) return;
  const around = 72,
    lip: Point[] = [],
    drift: Point[] = [];
  for (let k = 0; k < around; k++) {
    const bearing = f(f(k * f(6.2832)) / around),
      along = { x: f(Math.cos(bearing)), y: f(Math.sin(bearing)) };
    let reach = 0;
    while (reach < 16 && lake(add(spring, scale(along, f(reach + f(0.1))))) > 0) reach = f(reach + f(0.1));
    const edge = add(spring, scale(along, reach)),
      rim = add(spring, scale(along, f(f(reach + f(0.45)) + f(f(0.55) * hash01(map.seed(), k, 0, 1300)))));
    lip.push(project(edge.x, edge.y));
    drift.push(project(rim.x, rim.y));
  }
  const middle = project(spring.x, spring.y);
  let top = middle.y,
    bottom = middle.y,
    left = middle.x,
    right = middle.x;
  for (const p of lip) {
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
  }
  const tall = f(bottom - top),
    wide = f(right - left);
  ornaments.add(filled(drift, opaque(frost)));
  const shaft = new SceneNode();
  const ring = (share: number, sink: number) =>
    lip.map((p) => add(add(middle, scale(sub(p, middle), share)), { x: 0, y: sink }));
  for (let step = 0; step < ledges.length; step++) {
    const share = f(1 - f(f(0.05) * step)),
      sink = f(f(tall * f(0.3)) * step);
    shaft.add(filled(ring(share, sink), opaque(ledges[step])));
    shaft.add(filled(ring(f(share - f(0.02)), f(sink + f(tall * f(0.06)))), opaque(walls[step])));
  }
  shaft.add(
    glow(add(middle, { x: 0, y: f(tall * f(0.5)) }), f(wide * f(0.2)), f(tall * f(0.18)), [70, 190, 220], 60),
  );
  const overhang = new ShapeNode(),
    icicles = new ShapeNode();
  for (let k = 0; k < around; k++) {
    const a = lip[k],
      b = lip[(k + 1) % around],
      far = f(f(middle.y - f(f(a.y + b.y) / 2)) / f(tall / 2));
    if (far < f(0.15)) continue;
    const inward = scale(sub(middle, lerp(a, b, f(0.5))), f(f(0.04) * far));
    appendPolygon(overhang, [a, b, add(b, inward), add(a, inward)]);
    for (let i = 0; i < 2; i++) {
      const from = lerp(a, b, f(i * f(0.5))),
        to = lerp(a, b, f(f(i * f(0.5)) + f(0.5))),
        tip = lerp(from, to, f(f(0.35) + f(f(0.3) * hash01(map.seed(), k, i + 1, 1300))));
      tip.y = f(tip.y + f(f(tall * far) * f(f(0.05) + f(f(0.11) * hash01(map.seed(), k, i + 3, 1300)))));
      appendPolygon(icicles, [from, to, tip]);
    }
  }
  fill(icicles, opaque(icicle));
  fill(overhang, opaque(cornice));
  shaft
    .add(icicles)
    .add(overhang)
    .clip(filled(lip, opaque([255, 255, 255])));
  ornaments.add(shaft);
  for (let i = 0; i < 3; i++) {
    const across = f(
        f(f(f(i - 1) + f(f(hash01(map.seed(), i, 5, 1300) - f(0.5)) * f(0.6))) * wide) * f(0.26),
      ),
      rise = f(tall * f(f(0.36) + f(f(0.1) * hash01(map.seed(), i, 6, 1300)))),
      r = f(wide * f(f(0.12) + f(f(0.06) * hash01(map.seed(), i, 7, 1300))));
    ornaments.add(
      glow(
        add(middle, { x: across, y: rise }),
        r,
        f(r * f(0.38)),
        mist,
        Math.trunc(f(40 + f(24 * hash01(map.seed(), i, 8, 1300)))),
      ),
    );
  }
}
