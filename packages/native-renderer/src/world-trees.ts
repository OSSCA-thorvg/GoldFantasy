import { point, project, tileHalfHeight, type Point } from '../../engine/src/geometry';
import { f32, clamp } from '../../engine/src/numeric';
import { WorldMap } from '../../engine/src/world-map';
import { Town } from '../../engine/src/town';
import { TreeWorkKind } from '../../engine/src/person';
import * as mining from '../../engine/src/mining';
import type { Climate } from '../../engine/src/climate';
import { Rect } from '../../native-ui/src/types';
import { SceneNode, ShapeNode } from './paint';
import { fill, opaque } from './vector-paint';
import { appendStone, stoneLit, stoneShade } from './mining-stone';
import { TreeBatch, treeAt } from './tree-painter';
import { PeakBatch, peakAt } from './mountain-peaks';
import { WorldRendererState } from './world-renderer-state';
export const sprouting = (s: WorldRendererState, cell: number, index: number): boolean =>
  s.growingTrees.some((tree) => tree.cell === cell && tree.index === index);
export function buildTreeRow(
  s: WorldRendererState,
  map: WorldMap,
  climate: Readonly<Climate>,
  row: number,
): void {
  const trees = s.rowTrees[row];
  trees.remove();
  s.rowCanopies[row] = null;
  const woods = new TreeBatch(climate),
    peaks = new PeakBatch(climate),
    rockLit = new ShapeNode(),
    rockShade = new ShapeNode();
  for (let x = Math.max(0, f32(f32(row - map.height()) + 1)); x <= Math.min(row, f32(map.width() - 1)); x++) {
    const y = f32(row - x),
      tile = map.at(x, y);
    for (let i = 0; i < tile.trees; i++)
      if (!sprouting(s, f32(f32(y * map.width()) + x), i)) woods.add(treeAt(map, x, y, i));
    const peak = peakAt(map, x, y);
    if (peak) peaks.add(peak);
    if (mining.deposit(map, x, y)) {
      const foot = mining.position(x, y),
        b = project(foot.x, foot.y),
        size = mining.size(map, x, y);
      appendStone(rockLit, rockShade, b, size);
    }
  }
  const base = f32(f32(row * tileHalfHeight) + tileHalfHeight);
  fill(rockLit, opaque(stoneLit));
  fill(rockShade, opaque(stoneShade));
  const wood = woods.finish(base),
    drawn = [rockLit, rockShade, ...peaks.finish(base)],
    low = point(1e9, 1e9),
    high = point(-1e9, -1e9);
  const include = (x: number, y: number) => {
    low.x = Math.min(low.x, x);
    low.y = Math.min(low.y, y);
    high.x = Math.max(high.x, x);
    high.y = Math.max(high.y, y);
  };
  const hull = (shape: ShapeNode) => {
    for (const c of shape.commands) {
      if (c[0] === 'M' || c[0] === 'L') include(c[1], c[2]);
      else if (c[0] === 'C') {
        include(c[1], c[2]);
        include(c[3], c[4]);
        include(c[5], c[6]);
      } else if (c[0] === 'E') {
        include(f32(c[1] - c[3]), f32(c[2] - c[4]));
        include(f32(c[1] + c[3]), f32(c[2] + c[4]));
      } else if (c[0] === 'R') {
        include(c[1], c[2]);
        include(f32(c[1] + c[3]), f32(c[2] + c[4]));
      }
    }
  };
  if (wood.length) {
    const canopy = new SceneNode();
    for (const shape of wood) {
      hull(shape);
      canopy.add(shape);
    }
    trees.add(canopy);
    s.rowCanopies[row] = canopy;
  }
  for (const shape of drawn) {
    hull(shape);
    trees.add(shape);
  }
  s.treeBounds[row] = new Rect(
    f32(low.x - 10),
    low.y,
    f32(Math.max(0, f32(high.x - low.x)) + 20),
    Math.max(0, f32(high.y - low.y)),
  );
}
export function cullTrees(s: WorldRendererState): void {
  const padding = f32(2 / s.view.zoom),
    visible = new Rect(
      f32(f32(s.view.x - f32(f32(s.viewWidth / 2) / s.view.zoom)) - padding),
      f32(f32(s.view.y - f32(f32(s.viewHeight / 2) / s.view.zoom)) - padding),
      f32(f32(s.viewWidth + 4) / s.view.zoom),
      f32(f32(s.viewHeight + 4) / s.view.zoom),
    );
  for (let i = 0; i < s.rowTrees.length; i++) {
    const overlap = s.treeBounds[i].intersect(visible);
    s.rowTrees[i].opacity(overlap.w > 0 && overlap.h > 0 ? 255 : 0);
  }
}
export function swayTrees(s: WorldRendererState, wind: number, seconds: number): void {
  const active = wind > f32(0.2) && s.view.zoom >= f32(0.45);
  if (!active) {
    if (s.swaying) for (const canopy of s.rowCanopies) canopy?.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    s.swaying = false;
    return;
  }
  if (s.swaying && seconds >= s.swayAt && seconds - s.swayAt < 1 / 24) return;
  s.swayAt = seconds;
  s.swaying = true;
  const tau = f32(6.2831853),
    amplitude = f32(f32(0.012) + f32(f32(f32(0.07) * wind) * wind)),
    lean = f32(f32(f32(0.45) * amplitude) * wind),
    pace = f32(f32(0.35) + f32(f32(0.3) * wind)),
    t = f32(seconds);
  for (let i = 0; i < s.rowCanopies.length; i++) {
    const canopy = s.rowCanopies[i];
    if (!canopy || s.rowTrees[i].alpha === 0) continue;
    const phase = f32(i * f32(0.45)),
      k = f32(
        lean +
          f32(
            amplitude *
              f32(
                f32(f32(0.65) * f32(Math.sin(f32(f32(f32(tau * pace) * t) - phase)))) +
                  f32(
                    f32(0.35) *
                      f32(Math.sin(f32(f32(f32(f32(tau * pace) * f32(2.3)) * t) - f32(f32(1.7) * phase)))),
                  ),
              ),
          ),
      ),
      base = f32(f32(i + 1) * tileHalfHeight);
    canopy.transform([1, -k, f32(k * base), 0, 1, 0, 0, 0, 1]);
  }
}
export function sprout(
  s: WorldRendererState,
  map: WorldMap,
  climate: Readonly<Climate>,
  x: number,
  y: number,
  index: number,
  row: number,
): void {
  if (s.growingTrees.length >= 64) return;
  const tree = treeAt(map, x, y, index),
    foot = project(tree.foot.x, tree.foot.y),
    screen = point(
      f32(f32(f32(foot.x - s.view.x) * s.view.zoom) + f32(s.viewWidth / 2)),
      f32(f32(f32(foot.y - s.view.y) * s.view.zoom) + f32(s.viewHeight / 2)),
    );
  if (
    s.currentVisibility.sample(tree.foot) < 119 ||
    screen.x < -128 ||
    screen.x > f32(s.viewWidth + 128) ||
    screen.y < -128 ||
    screen.y > f32(s.viewHeight + 128)
  )
    return;
  const paint = new SceneNode(),
    body = new SceneNode(),
    batch = new TreeBatch(climate);
  batch.add(tree);
  for (const shape of batch.finish(foot.y)) body.add(shape);
  const leaves = new ShapeNode();
  for (let i = 0; i < 6; i++) {
    const a = f32(-f32(2.9) + f32(i * f32(0.52)));
    leaves.appendCircle(
      f32(foot.x + f32(f32(f32(Math.cos(a)) * 10) * tree.size)),
      f32(f32(foot.y - f32(3 * tree.size)) + f32(f32(f32(Math.sin(a)) * 5) * tree.size)),
      f32(1.4),
      1,
    );
  }
  leaves.fill(126, 156, 98).opacity(0);
  paint.add(leaves).add(body);
  s.rows[row].add(paint);
  s.growingTrees.push({
    paint,
    body,
    leaves,
    foot,
    row,
    cell: f32(f32(y * map.width()) + x),
    index,
    at: s.renderedAt,
  });
}
export function updateGrowth(s: WorldRendererState, town: Town, seconds: number): void {
  const map = town.map(),
    settled: number[] = [];
  s.growingTrees = s.growingTrees.filter((tree) => {
    const x = tree.cell % map.width(),
      y = Math.trunc(f32(tree.cell / map.width())),
      gone = !map.inside(x, y) || tree.index >= map.at(x, y).trees;
    if (!gone && seconds >= tree.at && seconds - tree.at < 1.3) return true;
    s.rows[tree.row].remove(tree.paint);
    settled.push(tree.row);
    return false;
  });
  for (const row of [...new Set(settled)].sort((a, b) => f32(a - b)))
    buildTreeRow(s, map, town.climate(), row);
  const back = (u: number) => {
    u = f32(clamp(u, 0, 1) - 1);
    return f32(f32(1 + f32(f32(f32(f32(2.7) * u) * u) * u)) + f32(f32(f32(1.7) * u) * u));
  };
  for (const tree of s.growingTrees) {
    const t = f32((seconds - tree.at) / 1.3),
      up = back(f32(t * f32(1.15))),
      out = f32(f32(0.15) + f32(f32(0.85) * back(f32(f32(t * f32(1.3)) - f32(0.1))))),
      p = tree.foot;
    tree.body.transform([out, 0, f32(p.x * f32(1 - out)), 0, up, f32(p.y * f32(1 - up)), 0, 0, 1]);
    const burst = clamp(f32(t * f32(1.5)), 0, 1),
      spread = f32(f32(0.3) + f32(f32(1.4) * burst));
    tree.leaves.transform([
      spread,
      0,
      f32(p.x * f32(1 - spread)),
      0,
      spread,
      f32(f32(p.y * f32(1 - spread)) - f32(6 * burst)),
      0,
      0,
      1,
    ]);
    tree.leaves.opacity(Math.trunc(f32(200 * f32(Math.sin(f32(burst * f32(3.14159265)))))));
  }
}
export function updateFelling(s: WorldRendererState, town: Town): void {
  const now = town.clock();
  s.fallingTrees = s.fallingTrees.filter((tree) => {
    if (now - tree.at < 0.8) return true;
    s.rows[tree.row].remove(tree.paint);
    return false;
  });
  const map = town.map();
  for (const event of town.treeEvents()) {
    if (event.serial < s.seenTreeEvent) continue;
    s.seenTreeEvent = event.serial + 1n;
    if (event.kind !== TreeWorkKind.Fall || now - event.at >= 0.8 || s.fallingTrees.length >= 64) continue;
    const x = event.cell % map.width(),
      y = Math.trunc(f32(event.cell / map.width())),
      tree = treeAt(map, x, y, event.index),
      pivot = project(tree.foot.x, tree.foot.y),
      screen = point(
        f32(f32(f32(pivot.x - s.view.x) * s.view.zoom) + f32(s.viewWidth / 2)),
        f32(f32(f32(pivot.y - s.view.y) * s.view.zoom) + f32(s.viewHeight / 2)),
      );
    if (
      s.currentVisibility.sample(tree.foot) < 119 ||
      screen.x < -128 ||
      screen.x > f32(s.viewWidth + 128) ||
      screen.y < -128 ||
      screen.y > f32(s.viewHeight + 128)
    )
      continue;
    const paint = new SceneNode(),
      body = new SceneNode(),
      batch = new TreeBatch(town.climate());
    batch.add(tree);
    for (const shape of batch.finish(pivot.y)) body.add(shape);
    const dust = new ShapeNode();
    for (let i = 0; i < 6; i++)
      dust.appendCircle(
        f32(pivot.x + f32(f32(i - f32(2.5)) * 2)),
        f32(f32(pivot.y - 1) - (i % 3)),
        f32(1.2),
        f32(0.65),
      );
    dust.fill(160, 132, 88).opacity(0);
    paint.add(body).add(dust);
    const row = clamp(f32(x + y), 0, f32(s.rows.length - 1));
    s.rows[row].add(paint);
    const worker = project(event.worker.x, event.worker.y);
    s.fallingTrees.push({ paint, body, dust, pivot, row, at: event.at, side: pivot.x < worker.x ? -1 : 1 });
  }
  for (const tree of s.fallingTrees) {
    const t = f32(clamp((now - tree.at) / 0.8, 0, 1)),
      angle = f32(f32(f32(tree.side * f32(1.46)) * t) * t),
      c = f32(Math.cos(angle)),
      sin = f32(Math.sin(angle)),
      flat = f32(1 - f32(f32(0.65) * t)),
      p = tree.pivot;
    tree.body.transform([
      c,
      -sin,
      f32(f32(p.x - f32(c * p.x)) + f32(sin * p.y)),
      f32(sin * flat),
      f32(c * flat),
      f32(f32(p.y - f32(f32(sin * flat) * p.x)) - f32(f32(c * flat) * p.y)),
      0,
      0,
      1,
    ]);
    tree.paint.opacity(Math.trunc(f32(255 * clamp(f32(f32(1 - t) / f32(0.18)), 0, 1))));
    const puff = clamp(f32(f32(t - f32(0.45)) / f32(0.55)), 0, 1),
      scale = f32(f32(0.4) + f32(f32(1.1) * puff));
    tree.dust.transform([scale, 0, f32(p.x * f32(1 - scale)), 0, scale, f32(p.y * f32(1 - scale)), 0, 0, 1]);
    tree.dust.opacity(Math.trunc(f32(140 * f32(Math.sin(f32(puff * f32(3.14159265)))))));
  }
}
