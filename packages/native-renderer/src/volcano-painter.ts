import { type Point, tileHalfWidth } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { lavaBearing } from '../../engine/src/world-map';
import { volcanoFoot } from '../../engine/src/world-types';
import { ShapeNode, SceneNode, type Rgb } from './paint';
import { appendPolygon, appendStrip, fill, opaque, mix, polygon, ellipse, glow } from './vector-paint';
const f = Math.fround;
const basaltLit: Rgb = [46, 38, 38],
  basalt: Rgb = [28, 23, 25],
  scoria: Rgb = [14, 11, 13],
  crust: Rgb = [112, 34, 20],
  lava: Rgb = [214, 76, 30],
  molten: Rgb = [255, 172, 70],
  smoke: Rgb = [70, 66, 70],
  smokeLit: Rgb = [116, 110, 112];
export const volcanoHeight = 560,
  volcanoSmoke = 260;
export interface VolcanoLight {
  crater: Point;
  flows: Point[];
}
export function lightVolcano(lights: SceneNode, light: VolcanoLight): void {
  lights.add(glow(light.crater, 200, 110, [255, 120, 40], 80));
}
export function paintSteam(objects: SceneNode, at: Point, salt: number): void {
  for (let i = 0; i < 4; i++) {
    const t = f(i / 3),
      r = f(f(12 + f(15 * t)) + f(5 * hash01(salt, i, 1, 850))),
      c = {
        x: f(f(at.x + f(f(16 * t) * t)) + f(f(hash01(salt, i, 2, 850) - f(0.5)) * 8)),
        y: f(f(at.y - 4) - f(44 * t)),
      },
      alpha = Math.trunc(f(150 - f(90 * t)));
    objects.add(
      ellipse(
        { x: f(c.x + f(r * f(0.12))), y: f(c.y + f(r * f(0.14))) },
        r,
        f(r * f(0.62)),
        opaque([138, 144, 150], alpha),
      ),
    );
    objects.add(
      ellipse(
        { x: f(c.x - f(r * f(0.2))), y: f(c.y - f(r * f(0.14))) },
        f(r * f(0.64)),
        f(r * f(0.4)),
        opaque([228, 230, 230], Math.trunc(f(alpha * f(0.8)))),
      ),
    );
  }
}
interface Vec {
  x: number;
  y: number;
  z: number;
}
const sub = (a: Vec, b: Vec): Vec => ({ x: f(a.x - b.x), y: f(a.y - b.y), z: f(a.z - b.z) });
const cross = (a: Vec, b: Vec): Vec => ({
  x: f(f(a.y * b.z) - f(a.z * b.y)),
  y: f(f(a.z * b.x) - f(a.x * b.z)),
  z: f(f(a.x * b.y) - f(a.y * b.x)),
});
const dot = (a: Vec, b: Vec) => f(f(f(a.x * b.x) + f(a.y * b.y)) + f(a.z * b.z));
function unit(a: Vec): Vec {
  const n = f(Math.sqrt(dot(a, a)));
  return n > 0 ? { x: f(a.x / n), y: f(a.y / n), z: f(a.z / n) } : a;
}
const footRadius = f(f(volcanoFoot * tileHalfWidth) * f(1.4142)),
  lipRadius = 98,
  heights = [0, f(0.16), f(0.36), f(0.58), f(0.8), 1],
  around = 16;
export function paintVolcano(objects: SceneNode, b: Point, seed: number): VolcanoLight {
  const light: VolcanoLight = { crater: { x: 0, y: 0 }, flows: [] },
    screen = (v: Vec): Point => ({ x: f(b.x + v.x), y: f(f(b.y - v.y) + f(v.z * f(0.5))) });
  const radius = (t: number) => f(lipRadius + f(f(footRadius - lipRadius) * f(Math.pow(f(1 - t), f(1.7))))),
    rings = heights.length,
    mesh: Vec[][] = Array.from({ length: rings }, () => []);
  for (let k = 0; k < rings; k++)
    for (let j = 0; j < around; j++) {
      const angle = f(f(f(j + f((k % 2) * f(0.5))) / around) * f(6.2832)),
        t = heights[k],
        rough = k === rings - 1 ? f(0.08) : f(0.16),
        r = f(radius(t) * f(1 + f(f(hash01(seed, k, j, 840) - f(0.5)) * rough))),
        lift = k === 0 || k === rings - 1 ? 0 : f(f(hash01(seed, k, j, 841) - f(0.5)) * 30);
      mesh[k][j] = {
        x: f(f(Math.cos(angle)) * r),
        y: f(
          f(f(t * volcanoHeight) + lift) +
            (k === rings - 1 ? f(f(hash01(seed, k, j, 842) - f(0.5)) * 14) : 0),
        ),
        z: f(f(Math.sin(angle)) * r),
      };
    }
  const light3 = unit({ x: f(-0.95), y: f(0.42), z: f(0.22) }),
    view = unit({ x: 0, y: f(0.5), z: f(0.87) });
  const shadeOf = (a: Vec, c: Vec, d: Vec, warmth: number, grain: number): Rgb => {
    const n = unit(cross(sub(d, a), sub(c, a))),
      lit = Math.max(0, Math.min(1, f(dot(n, light3) + grain)));
    return mix(
      mix(basalt, scoria, f(0.5)),
      mix(basaltLit, [120, 70, 52], warmth),
      f(f(0.04) + f(f(0.96) * lit)),
    );
  };
  const floor = { x: 0, y: volcanoHeight - 46, z: 0 },
    lip = mesh[rings - 1];
  for (let j = 0; j < around; j++) {
    const a = lip[j],
      c = lip[(j + 1) % around],
      low = { x: f(a.x * f(0.55)), y: floor.y, z: f(a.z * f(0.55)) },
      low2 = { x: f(c.x * f(0.55)), y: floor.y, z: f(c.z * f(0.55)) };
    if (f(a.z + c.z) > 0) continue;
    objects.add(
      polygon(
        [screen(a), screen(c), screen(low2), screen(low)],
        opaque(mix(scoria, crust, f(f(0.35) + f(f(0.3) * hash01(seed, j, 9, 843))))),
      ),
    );
  }
  const lake = screen(floor);
  objects.add(
    ellipse({ x: lake.x, y: f(lake.y + 2) }, f(lipRadius * f(0.5)), f(lipRadius * f(0.2)), opaque(lava)),
  );
  objects.add(
    ellipse(
      { x: f(lake.x + 4), y: f(lake.y + 2) },
      f(lipRadius * f(0.26)),
      f(lipRadius * f(0.09)),
      opaque(molten),
    ),
  );
  light.crater = lake;
  const faces: { corners: Point[]; depth: number; color: Rgb }[] = [];
  for (let k = 0; k + 1 < rings; k++)
    for (let j = 0; j < around; j++) {
      const a = mesh[k][j],
        c = mesh[k][(j + 1) % around],
        d = mesh[k + 1][j],
        e = mesh[k + 1][(j + 1) % around],
        warmth = f(f(0.25) * heights[k + 1]);
      for (const [p, q, r] of [
        [a, c, d],
        [c, e, d],
      ]) {
        const n = unit(cross(sub(r, p), sub(q, p)));
        if (dot(n, view) <= 0) continue;
        const grain = f(f(hash01(seed, k * around + j, faces.length % 2, 846) - f(0.5)) * f(0.14));
        faces.push({
          corners: [screen(p), screen(q), screen(r)],
          depth: f(f(f(p.z + q.z) + r.z) / 3),
          color: shadeOf(p, q, r, warmth, grain),
        });
      }
    }
  faces.sort((a, b) => a.depth - b.depth);
  for (const face of faces) {
    const shape = new ShapeNode();
    appendPolygon(shape, face.corners);
    fill(shape, opaque(face.color));
    shape.strokeWidth(f(0.8)).strokeFill(...face.color, 255);
    objects.add(shape);
  }
  const crusts = new ShapeNode(),
    streams = new ShapeNode(),
    cores = new ShapeNode(),
    widths = [f(0.85), 1, f(0.75)],
    steps = 18,
    onCone = steps - 2;
  for (let k = 0; k < 3; k++) {
    const foot = f(lavaBearing(seed, k) + f(0.7854)),
      curl = f(f(f(1.5708) - foot) * f(0.3)),
      phase = f(hash01(seed, k, 5, 845) * f(6.2832)),
      path: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const down = f(i / onCone),
        slope = Math.min(down, 1),
        t = f(1 - slope),
        angle = f(
          f(foot + f(curl * f(1 - slope))) +
            f(f(f(f(Math.sin(f(f(down * 4) + phase))) * f(0.3)) * slope) * f(1 - slope)),
        );
      const r =
        i <= onCone
          ? f(radius(t) * (t > f(0.97) ? f(0.98) : f(1.01)))
          : f(footRadius * f(f(1.01) + f(f(down - 1) * f(0.8))));
      path.push(
        screen({ x: f(f(Math.cos(angle)) * r), y: f(t * volcanoHeight), z: f(f(Math.sin(angle)) * r) }),
      );
    }
    const w = widths[k];
    appendStrip(crusts, path, f(9 * w), f(72 * w));
    appendStrip(streams, path, f(6 * w), f(52 * w));
    appendStrip(cores, path, f(f(2.5) * w), f(18 * w));
    light.flows[k] = path[10];
  }
  fill(crusts, opaque(crust));
  fill(streams, opaque(lava));
  fill(cores, opaque(molten));
  objects.add(crusts).add(streams).add(cores);
  for (let i = 0; i < 6; i++) {
    const t = f(i / 5),
      r = f(36 + f(50 * t)),
      at = { x: f(f(lake.x + 12) + f(f(170 * t) * t)), y: f(f(lake.y - 70) - f(220 * t)) },
      alpha = Math.trunc(f(170 - f(110 * t)));
    objects.add(
      ellipse(
        { x: f(at.x + f(r * f(0.14))), y: f(at.y + f(r * f(0.16))) },
        r,
        f(r * f(0.6)),
        opaque(smoke, alpha),
      ),
    );
    objects.add(
      ellipse(
        { x: f(at.x - f(r * f(0.2))), y: f(at.y - f(r * f(0.12))) },
        f(r * f(0.62)),
        f(r * f(0.36)),
        opaque(smokeLit, Math.trunc(f(alpha * f(0.7)))),
      ),
    );
  }
  return light;
}
