import { point, project, type Point } from '../../engine/src/geometry';
import { TreeWorkKind, type TreeWorkEvent } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import * as mining from '../../engine/src/mining';
import { SceneNode, ShapeNode, identity, type Matrix } from './paint';
import { treeAt } from './tree-painter';
import { registerDepth } from './world-depth';
import type { WorldRendererState } from './world-renderer-state';

type ResourceKind = 'tree' | 'rock';
interface Resource {
  kind: ResourceKind;
  cell: number;
  index: number;
  foot: Point;
  wind: Matrix;
}
interface Hit {
  event: TreeWorkEvent;
  kind: ResourceKind;
  paint: SceneNode;
  chips: ShapeNode[];
  foot: Point;
  side: number;
  row: number;
  height: number;
  edge: number;
}
interface Reactions {
  town: Town;
  hits: Map<bigint, Hit>;
  touched: Map<SceneNode, Resource>;
}
const resources = new WeakMap<SceneNode, Resource>(),
  reactions = new WeakMap<WorldRendererState, Reactions>();
const duration = (kind: ResourceKind) => (kind === 'tree' ? 0.34 : 0.24);

export function registerResourceHit(
  paint: SceneNode,
  kind: ResourceKind,
  cell: number,
  index: number,
  foot: Point,
): void {
  resources.set(paint, { kind, cell, index, foot: { ...foot }, wind: identity });
}

/** Wind remains the base pose even while the short impact is composed over it. */
export function setResourceWind(paint: SceneNode, matrix: Matrix): void {
  const resource = resources.get(paint);
  if (resource) resource.wind = matrix;
  paint.transform(matrix);
}

export function hasResourceHits(state: WorldRendererState): boolean {
  return (reactions.get(state)?.hits.size ?? 0) > 0;
}

export function resetResourceHits(state: WorldRendererState): void {
  const current = reactions.get(state);
  if (!current) return;
  for (const [paint, resource] of current.touched) paint.transform(resource.wind);
  for (const hit of current.hits.values()) state.rows[hit.row]?.remove(hit.paint);
  reactions.delete(state);
}

function chips(
  event: TreeWorkEvent,
  kind: ResourceKind,
  foot: Point,
  side: number,
  height: number,
  edge: number,
  row: number,
): Hit {
  const paint = new SceneNode(),
    parts: ShapeNode[] = [];
  for (let i = 0; i < 3; i++) {
    const shape = new ShapeNode();
    if (kind === 'tree') shape.moveTo(-0.5, -0.4).lineTo(1.3, -0.8).lineTo(0.7, 0.5).close();
    else shape.moveTo(-0.7, 0.3).lineTo(-0.2, -0.9).lineTo(0.8, -0.2).lineTo(0.4, 0.6).close();
    const color =
      kind === 'tree' ? (i % 2 ? [147, 110, 68] : [194, 153, 95]) : i % 2 ? [111, 108, 119] : [177, 172, 180];
    shape.fill(color[0], color[1], color[2]);
    paint.add(shape);
    parts.push(shape);
  }
  const pivot = project(foot.x, foot.y);
  paint.translate(pivot.x, pivot.y);
  registerDepth(paint, foot, `resource-hit:${event.serial}`);
  return { event, kind, paint, chips: parts, foot, side, row, height, edge };
}

function bend(kind: ResourceKind, age: number): number {
  const t = age / duration(kind);
  if (t < 0 || t >= 1) return 0;
  const strike = Math.sin((Math.min(1, age / 0.025) * Math.PI) / 2),
    settle = (1 - t) * (1 - t);
  return (kind === 'tree' ? 0.065 : 0.05) * strike * settle * Math.cos(t * Math.PI * 2);
}

/** Only real contact events drive the response; the model and harvest cadence are untouched. */
export function updateResourceHits(state: WorldRendererState, town: Town): void {
  let current = reactions.get(state);
  if (!current || current.town !== town) {
    resetResourceHits(state);
    current = { town, hits: new Map(), touched: new Map() };
    reactions.set(state, current);
  }
  for (const [paint, resource] of current.touched) paint.transform(resource.wind);
  current.touched.clear();
  const now = town.clock(),
    map = town.map(),
    events = town.treeEvents(),
    live = new Set<bigint>(),
    poses = new Map<SceneNode, { resource: Resource; event: TreeWorkEvent; side: number }>();
  for (const event of events) {
    if (event.kind !== TreeWorkKind.Chop && event.kind !== TreeWorkKind.Mine) continue;
    const kind = event.kind === TreeWorkKind.Chop ? 'tree' : 'rock',
      age = now - event.at;
    if (age < 0 || age >= duration(kind)) continue;
    const x = event.cell % map.width(),
      y = Math.floor(event.cell / map.width()),
      row = x + y;
    if (!map.inside(x, y) || !state.rows[row]) continue;
    let target: { paint: SceneNode; resource: Resource } | undefined;
    for (const paint of state.rowTrees[row]?.children ?? []) {
      if (!(paint instanceof SceneNode)) continue;
      const resource = resources.get(paint);
      if (resource?.kind === kind && resource.cell === event.cell && resource.index === event.index) {
        target = { paint, resource };
        break;
      }
    }
    const terminal = events.some(
      (end) =>
        end.cell === event.cell &&
        end.at === event.at &&
        end.kind === (kind === 'tree' ? TreeWorkKind.Fall : TreeWorkKind.Shatter),
    );
    if (!target && !terminal) continue;
    const tree = kind === 'tree' ? treeAt(map, x, y, event.index) : null,
      foot = target?.resource.foot ?? tree?.foot ?? mining.position(x, y),
      pivot = project(foot.x, foot.y),
      screen = state.view.toScreen(pivot, state.viewWidth, state.viewHeight);
    if (
      state.currentVisibility.sample(foot) < 119 ||
      screen.x < -64 ||
      screen.x > state.viewWidth + 64 ||
      screen.y < -64 ||
      screen.y > state.viewHeight + 128
    )
      continue;
    live.add(event.serial);
    const side = pivot.x >= project(event.worker.x, event.worker.y).x ? 1 : -1;
    if (target) {
      const previous = poses.get(target.paint);
      if (!previous || previous.event.at <= event.at)
        poses.set(target.paint, { resource: target.resource, event, side });
    }
    let hit = current.hits.get(event.serial);
    if (!hit) {
      if (current.hits.size >= 64) continue;
      const size = tree?.size ?? mining.size(map, x, y);
      hit = chips(event, kind, foot, side, size * (tree ? 1.2 : 0.25), size * (tree ? 2.2 : 0.75), row);
      current.hits.set(event.serial, hit);
      state.rows[row].add(hit.paint);
    }
    const t = age / duration(kind),
      travel = 1 - (1 - t) * (1 - t);
    hit.paint.opacity(Math.round(200 * Math.pow(1 - t, 1.5)));
    hit.chips.forEach((chip, i) =>
      chip.translate(
        -side * (hit.edge + travel * (3 + i * 1.7)),
        -hit.height - Math.sin(Math.PI * t) * (1.2 + i * 0.4) + travel * hit.height * 0.7,
      ),
    );
  }
  for (const [paint, pose] of poses) {
    const k = pose.side * bend(pose.resource.kind, now - pose.event.at),
      base = project(pose.resource.foot.x, pose.resource.foot.y).y,
      wind = pose.resource.wind;
    paint.transform([
      wind[0],
      wind[1] - wind[0] * k,
      wind[2] + wind[0] * k * base,
      wind[3],
      wind[4] - wind[3] * k,
      wind[5] + wind[3] * k * base,
      0,
      0,
      1,
    ]);
    current.touched.set(paint, pose.resource);
  }
  for (const [serial, hit] of current.hits)
    if (!live.has(serial)) {
      state.rows[hit.row]?.remove(hit.paint);
      current.hits.delete(serial);
    }
}
