import { point, project, type Point } from '../../engine/src/geometry';
import { f32, clamp } from '../../engine/src/numeric';
import { WorldMap } from '../../engine/src/world-map';
import { Town } from '../../engine/src/town';
import { TreeWorkKind } from '../../engine/src/person';
import { treeFallTiming } from '../../engine/src/work-timing';
import * as mining from '../../engine/src/mining';
import type { Climate } from '../../engine/src/climate';
import { Rect } from '../../native-ui/src/types';
import { SceneNode, ShapeNode } from './paint';
import { fill, opaque } from './vector-paint';
import { appendStone, stoneLit, stoneShade } from './mining-stone';
import { TreeBatch, treeAt } from './tree-painter';
import { PeakBatch, peakAt } from './mountain-peaks';
import { WorldRendererState } from './world-renderer-state';
import { registerDepth } from './world-depth';
import { registerPick } from './world-pick-registry';
import type { WorldObjectRef } from './world-picking-types';
const canopyBases = new WeakMap<SceneNode, number>();
export const sprouting = (s: WorldRendererState, cell: number, index: number): boolean =>
  s.growingTrees.some((tree) => tree.cell === cell && tree.index === index);
function shapesBounds(shapes: readonly ShapeNode[]): Rect {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const include = (x: number, y: number) => {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };
  for (const shape of shapes)
    for (const command of shape.commands) {
      if (command[0] === 'M' || command[0] === 'L') include(command[1], command[2]);
      else if (command[0] === 'C') {
        include(command[1], command[2]);
        include(command[3], command[4]);
        include(command[5], command[6]);
      } else if (command[0] === 'E') {
        include(command[1] - command[3], command[2] - command[4]);
        include(command[1] + command[3], command[2] + command[4]);
      } else if (command[0] === 'R') {
        include(command[1], command[2]);
        include(command[1] + command[3], command[2] + command[4]);
      }
    }
  return Number.isFinite(left)
    ? new Rect(left - 10, top, right - left + 20, Math.max(1, bottom - top))
    : new Rect();
}
export function buildTreeRow(
  s: WorldRendererState,
  map: WorldMap,
  climate: Readonly<Climate>,
  row: number,
): void {
  const trees = s.rowTrees[row];
  trees.remove();
  s.rowCanopies[row] = [];
  const bounds: Rect[] = [];
  const append = (
    at: Point,
    key: string,
    shapes: ShapeNode[],
    canopy = false,
    ref: WorldObjectRef | null = null,
  ) => {
    const scene = new SceneNode(),
      box = shapesBounds(shapes);
    for (const shape of shapes) if (shape.commands.length) scene.add(shape);
    if (!scene.children.length) return;
    trees.add(scene);
    bounds.push(box);
    registerDepth(scene, at, key, box);
    registerPick(scene, {
      ref,
      body: [scene],
      foot: { ...at },
      ellipse: { rx: canopy ? 7 : 9, ry: canopy ? 3 : 4 },
    });
    if (canopy) {
      s.rowCanopies[row].push(scene);
      canopyBases.set(scene, project(at.x, at.y).y);
    }
  };
  for (let x = Math.max(0, row - map.height() + 1); x <= Math.min(row, map.width() - 1); x++) {
    const y = row - x,
      tile = map.at(x, y);
    for (let i = 0; i < tile.trees; i++) {
      if (sprouting(s, y * map.width() + x, i)) continue;
      const tree = treeAt(map, x, y, i),
        batch = new TreeBatch(climate);
      batch.add(tree);
      append(tree.foot, `tree:${x}:${y}:${i}`, batch.finish(project(tree.foot.x, tree.foot.y).y), true, {
        kind: 'tree',
        id: y * map.width() + x,
        instanceIndex: i,
      });
    }
    const peak = peakAt(map, x, y);
    if (peak) {
      const batch = new PeakBatch(climate);
      batch.add(peak);
      append(peak.foot, `peak:${x}:${y}`, batch.finish(project(peak.foot.x, peak.foot.y).y));
    }
    if (mining.deposit(map, x, y)) {
      const foot = mining.position(x, y),
        lit = new ShapeNode(),
        shade = new ShapeNode();
      appendStone(lit, shade, project(foot.x, foot.y), mining.size(map, x, y));
      fill(lit, opaque(stoneLit));
      fill(shade, opaque(stoneShade));
      append(foot, `stone:${x}:${y}`, [lit, shade], false, { kind: 'rock', id: y * map.width() + x });
    }
  }
  if (!bounds.length) {
    s.treeBounds[row] = new Rect();
    return;
  }
  const left = Math.min(...bounds.map((b) => b.x)),
    top = Math.min(...bounds.map((b) => b.y));
  s.treeBounds[row] = new Rect(
    left,
    top,
    Math.max(...bounds.map((b) => b.x + b.w)) - left,
    Math.max(...bounds.map((b) => b.y + b.h)) - top,
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
    if (s.swaying)
      for (const canopies of s.rowCanopies)
        for (const canopy of canopies) canopy.transform([1, 0, 0, 0, 1, 0, 0, 0, 1]);
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
    const canopies = s.rowCanopies[i];
    if (!canopies.length || s.rowTrees[i].alpha === 0) continue;
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
      );
    for (const canopy of canopies) {
      const base = canopyBases.get(canopy)!;
      canopy.transform([1, -k, f32(k * base), 0, 1, 0, 0, 0, 1]);
    }
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
  registerDepth(paint, tree.foot, `sprout:${x}:${y}:${index}`);
  registerPick(paint, {
    ref: { kind: 'tree', id: y * map.width() + x, instanceIndex: index },
    body: [body],
    foot: { ...tree.foot },
    ellipse: { rx: 7 * tree.size, ry: 3 * tree.size },
  });
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
    if (now - tree.at < treeFallTiming.duration) return true;
    s.rows[tree.row].remove(tree.paint);
    return false;
  });
  const map = town.map();
  for (const event of town.treeEvents()) {
    if (event.serial < s.seenTreeEvent) continue;
    s.seenTreeEvent = event.serial + 1n;
    if (
      event.kind !== TreeWorkKind.Fall ||
      now - event.at >= treeFallTiming.duration ||
      s.fallingTrees.length >= 64
    )
      continue;
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
    registerDepth(paint, tree.foot, `fall:${event.serial}`);
    s.rows[row].add(paint);
    const worker = project(event.worker.x, event.worker.y);
    s.fallingTrees.push({ paint, body, dust, pivot, row, at: event.at, side: pivot.x < worker.x ? -1 : 1 });
  }
  for (const tree of s.fallingTrees) {
    const t = f32(clamp((now - tree.at) / treeFallTiming.duration, 0, 1)),
      contact = f32(clamp((now - tree.at) / treeFallTiming.impact, 0, 1)),
      angle = f32(f32(f32(tree.side * f32(1.46)) * contact) * contact),
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
