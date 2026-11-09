import { add, lerp, project, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { Layer, Terrain } from '../../engine/src/world-types';
import type { WorldMap } from '../../engine/src/world-map';
import { ShapeNode } from './paint';
import { appendPolygon, fill, opaque, verticalShade } from './vector-paint';
import type { Climate } from './render-types';
const f = Math.fround;
export interface Peak {
  foot: Point;
  rise: number;
  volcanic: boolean;
  lean: number;
}
export const volcanicPeak = (map: WorldMap, foot: Point): boolean => map.value(Layer.Heat, foot) > f(0.62);
export function peakAt(map: WorldMap, x: number, y: number): Peak | undefined {
  const middle = { x: f(x + f(0.5)), y: f(y + f(0.5)) };
  if (map.at(x, y).terrain !== Terrain.Mountain || hash01(map.seed(), x, y, 62) >= f(0.55)) return;
  if (map.giant()?.covers(middle) || map.volcano()?.covers(middle)) return;
  const foot = {
    x: f(f(x + f(0.3)) + f(hash01(map.seed(), x, y, 63) * f(0.4))),
    y: f(f(y + f(0.3)) + f(hash01(map.seed(), x, y, 64) * f(0.4))),
  };
  return {
    foot,
    rise: Math.max(0, Math.min(1, f(map.value(Layer.Ridge, foot) * 7))),
    volcanic: volcanicPeak(map, foot),
    lean: f(f(hash01(map.seed(), x, y, 65) - f(0.5)) * f(0.4)),
  };
}
const Lit = 0,
  Shade = 1,
  CapLit = 2,
  CapShade = 3,
  BasaltLit = 4,
  BasaltShade = 5;
export class PeakBatch {
  private parts = Array.from({ length: 6 }, () => new ShapeNode());
  private snowy: boolean;
  constructor(climate: Climate) {
    this.snowy = climate.snow > f(0.3);
  }
  add(peak: Peak): void {
    const b = project(peak.foot.x, peak.foot.y),
      w = f(20 + f(20 * peak.rise)),
      top = f(30 + f(80 * peak.rise));
    const left = { x: f(b.x - w), y: b.y },
      right = { x: f(b.x + w), y: b.y },
      front = { x: f(b.x + f(w * f(0.1))), y: f(b.y + f(w * f(0.26))) },
      apex = { x: f(b.x + f(peak.lean * w)), y: f(b.y - top) };
    if (peak.volcanic) {
      const shoulder = add(lerp(apex, right, f(0.38)), { x: f(-w * f(0.04)), y: f(-top * f(0.06)) });
      appendPolygon(this.parts[BasaltLit], [left, apex, front]);
      appendPolygon(this.parts[BasaltShade], [front, apex, shoulder, right]);
      return;
    }
    appendPolygon(this.parts[Lit], [left, apex, front]);
    appendPolygon(this.parts[Shade], [front, apex, right]);
    if (peak.rise <= f(0.35) && !this.snowy) return;
    const k = this.snowy ? f(0.42) : f(0.3),
      along = (to: Point, t: number) => ({
        x: f(apex.x + f(f(to.x - apex.x) * t)),
        y: f(apex.y + f(f(to.y - apex.y) * t)),
      });
    const jag = lerp(along(left, k), along(front, k), f(0.5));
    jag.y = f(jag.y - f(top * f(0.05)));
    appendPolygon(this.parts[CapLit], [apex, along(left, k), jag, along(front, f(k * f(1.1)))]);
    const jag2 = lerp(along(front, f(k * f(1.1))), along(right, k), f(0.5));
    jag2.y = f(jag2.y - f(top * f(0.06)));
    appendPolygon(this.parts[CapShade], [apex, along(front, f(k * f(1.1))), jag2, along(right, k)]);
  }
  finish(base: number): ShapeNode[] {
    verticalShade(this.parts[Lit], [90, 88, 100], f(base - 130), f(base + 10), f(1.3), f(0.7));
    verticalShade(this.parts[Shade], [56, 54, 68], f(base - 130), f(base + 10), f(1.3), f(0.7));
    fill(this.parts[CapLit], opaque([208, 214, 226]));
    fill(this.parts[CapShade], opaque([146, 154, 174]));
    verticalShade(this.parts[BasaltLit], [82, 68, 64], f(base - 130), f(base + 10), f(1.25), f(0.75));
    verticalShade(this.parts[BasaltShade], [48, 40, 42], f(base - 130), f(base + 10), f(1.25), f(0.75));
    const drawn = this.parts.filter((part) => part.commands.length > 0);
    this.parts = [];
    return drawn;
  }
}
