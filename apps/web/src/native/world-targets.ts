import type { GameCommandApp } from './game-commands';
import { point, project, type Point } from '../../../../packages/engine/src/geometry';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { animalSpec } from '../../../../packages/engine/src/wildlife';
import * as mining from '../../../../packages/engine/src/mining';
import { treeAt } from '../../../../packages/native-renderer/src/tree-painter';
import { isWater, Layer } from '../../../../packages/engine/src/world-types';
import type { WorldMap } from '../../../../packages/engine/src/world-map';
import { paintYmir } from '../../../../packages/native-renderer/src/ymir-statue';
import { paintVolcano } from '../../../../packages/native-renderer/src/volcano-painter';
import { paintHvergelmir } from '../../../../packages/native-renderer/src/hvergelmir-painter';
import {
  SceneNode,
  ShapeNode,
  identity,
  type Matrix,
  type PaintNode,
} from '../../../../packages/native-renderer/src/paint';
import type { WorldRendererState } from '../../../../packages/native-renderer/src/world-renderer-state';
import type { Climate } from '../../../../packages/native-renderer/src/render-types';
import type { SelectionBounds } from '../../../../packages/native-renderer/src/selection-marker';

export type WorldObjectKind =
  'person' | 'building' | 'animal' | 'monster' | 'tree' | 'rock' | 'dungeon' | 'road' | 'field' | 'landmark';
export interface WorldObjectRef {
  kind: WorldObjectKind;
  id: number;
}
export interface WorldTarget extends WorldObjectRef {
  key: string;
  name: string;
  bounds: SelectionBounds;
}
export const targetKey = (ref: WorldObjectRef) => `${ref.kind}:${ref.id}`;
const enclosure = (p: readonly Point[]): SelectionBounds => {
  const x = Math.min(...p.map((p) => p.x)),
    y = Math.min(...p.map((p) => p.y));
  return { x, y, w: Math.max(...p.map((p) => p.x)) - x, h: Math.max(...p.map((p) => p.y)) - y };
};
// Landmark selection follows the authored vectors, including the tall body,
// smoke and clipped spring rim, instead of their much smaller walking footprints.
const artBounds = new WeakMap<PaintNode, { version: number; bounds: SelectionBounds | null }>();
function vectorBounds(root: PaintNode): SelectionBounds | null {
  const cached = artBounds.get(root);
  if (cached?.version === root.version) return cached.bounds;
  const merge = (a: SelectionBounds | null, b: SelectionBounds | null): SelectionBounds | null => {
    if (!a) return b;
    if (!b) return a;
    const x = Math.min(a.x, b.x),
      y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  const walk = (node: PaintNode, parent: Matrix): SelectionBounds | null => {
    if (!node.alpha) return null;
    const n = node.matrix,
      m: Matrix = [
        parent[0] * n[0] + parent[1] * n[3],
        parent[0] * n[1] + parent[1] * n[4],
        parent[0] * n[2] + parent[1] * n[5] + parent[2],
        parent[3] * n[0] + parent[4] * n[3],
        parent[3] * n[1] + parent[4] * n[4],
        parent[3] * n[2] + parent[4] * n[5] + parent[5],
        0,
        0,
        1,
      ];
    let box: SelectionBounds | null = null;
    const include = (x: number, y: number) => {
      box = merge(box, { x: m[0] * x + m[1] * y + m[2], y: m[3] * x + m[4] * y + m[5], w: 0, h: 0 });
    };
    if (node instanceof SceneNode) for (const child of node.children) box = merge(box, walk(child, m));
    else if (node instanceof ShapeNode) {
      // Cubic control hulls conservatively include the complete curved silhouette.
      for (const c of node.commands) {
        if (c[0] === 'M' || c[0] === 'L') include(c[1], c[2]);
        else if (c[0] === 'C') {
          include(c[1], c[2]);
          include(c[3], c[4]);
          include(c[5], c[6]);
        } else if (c[0] === 'R') {
          include(c[1], c[2]);
          include(c[1] + c[3], c[2]);
          include(c[1] + c[3], c[2] + c[4]);
          include(c[1], c[2] + c[4]);
        } else if (c[0] === 'E') {
          include(c[1] - c[3], c[2] - c[4]);
          include(c[1] + c[3], c[2] + c[4]);
        }
      }
      if (box && node.width) {
        const pad = node.width * 0.5 * Math.max(Math.hypot(m[0], m[3]), Math.hypot(m[1], m[4]));
        const b = box as SelectionBounds;
        box = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
      }
    }
    if (box && node.clipper) {
      const clip = walk(node.clipper, m);
      if (!clip) return null;
      const b = box as SelectionBounds,
        x = Math.max(b.x, clip.x),
        y = Math.max(b.y, clip.y),
        right = Math.min(b.x + b.w, clip.x + clip.w),
        bottom = Math.min(b.y + b.h, clip.y + clip.h);
      box = right >= x && bottom >= y ? { x, y, w: right - x, h: bottom - y } : null;
    }
    return box;
  };
  const bounds = walk(root, identity);
  artBounds.set(root, { version: root.version, bounds });
  return bounds;
}
interface LandmarkCache {
  key: string;
  paint: SceneNode;
}
const landmarkCache = new WeakMap<WorldMap, Map<number, LandmarkCache>>();
function landmarkPaint(app: GameCommandApp, id: number): SceneNode | null {
  const map = app.town.map(),
    renderer = app.renderer as unknown as Partial<WorldRendererState>;
  const giant = map.giant?.(),
    volcano = map.volcano?.(),
    spring = map.hvergelmir?.();
  if ((id === 0 && !giant) || (id === 1 && (!volcano || !map.revealed(volcano.center())))) return null;
  if (
    id === 2 &&
    (!spring ||
      !map.revealed(spring) ||
      !map.inside(Math.floor(spring.x), Math.floor(spring.y)) ||
      !map.at(Math.floor(spring.x), Math.floor(spring.y)).revealed ||
      map.value(Layer.Land, spring) <= 0.12 ||
      map.value(Layer.Elevation, spring) >= 0.3)
  )
    return null;
  if (id < 0 || id > 2) return null;
  const live = id === 0 ? renderer.ymirPaint?.paint : id === 1 ? renderer.volcanoPaint?.paint : undefined;
  if (live) return live;
  const anchor = id === 0 ? giant!.center() : id === 1 ? volcano!.center() : spring!,
    snow = app.town.climate?.().snow ?? 0,
    key = JSON.stringify([
      map.width(),
      map.height(),
      map.seed(),
      anchor,
      snow > 0.3,
      renderer.ornaments?.version,
      id === 2 ? map.value(Layer.Land, anchor) : 0,
      id === 2 ? map.value(Layer.Elevation, anchor) : 0,
    ]);
  let entries = landmarkCache.get(map);
  if (!entries) {
    entries = new Map();
    landmarkCache.set(map, entries);
  }
  const previous = entries.get(id);
  if (previous?.key === key) return previous.paint;
  const paint = new SceneNode(),
    base = project(anchor.x, anchor.y);
  if (id === 0)
    paintYmir(
      paint,
      base,
      { snow } as Climate,
      isWater(map.terrainAt(point(anchor.x + 4.6, anchor.y + 4.6))),
    );
  else if (id === 1) paintVolcano(paint, base, map.seed());
  else paintHvergelmir(paint, map);
  entries.set(id, { key, paint });
  return paint;
}
export const landmarkDescription = (id: number): string =>
  [
    'Ymir, the primordial giant. An ancient stone landmark beside the founding shore.',
    'Fire Mountain. A volcanic landmark with lava flows and a smoking crater.',
    'Hvergelmir. The deep northern spring from which the rivers flow.',
  ][id] ?? '';

export function worldTarget(app: GameCommandApp, ref: WorldObjectRef): WorldTarget | null {
  const town = app.town,
    map = town.map?.(),
    z = app.camera.zoom;
  const local = (name: string, p: Point, x: number, y: number, w: number, h: number): WorldTarget => {
    const at = app.toScreen(p);
    return {
      ...ref,
      key: targetKey(ref),
      name,
      bounds: { x: at.x + x * z, y: at.y + y * z, w: w * z, h: h * z },
    };
  };
  if (ref.kind === 'person') {
    const p = town.person(ref.id);
    if (!p || p.health <= 0 || p.visibility() <= 0.05 || (p.faction > 0 && !app.renderer.visible(p.position)))
      return null;
    return local(p.name, p.position, -8, -28, 16, 30);
  }
  if (!map) return null;
  if (ref.kind === 'landmark') {
    const paint = landmarkPaint(app, ref.id),
      bounds = paint ? vectorBounds(paint) : null;
    if (!bounds) return null;
    const at = app.camera.toScreen(point(bounds.x, bounds.y), app.viewWidth, app.viewHeight);
    return {
      ...ref,
      key: targetKey(ref),
      name: ['Ymir', 'Fire Mountain', 'Hvergelmir'][ref.id],
      bounds: { x: at.x, y: at.y, w: bounds.w * z, h: bounds.h * z },
    };
  }
  if (ref.kind === 'building') {
    const b = town.building(ref.id);
    if (!b || !map.revealed(b.center)) return null;
    const corners = b
        .footprint()
        .corners()
        .map((p) => app.toScreen(p)),
      roof = app.renderer.buildingRoof(b);
    if (roof) corners.push(app.camera.toScreen(roof, app.viewWidth, app.viewHeight));
    return { ...ref, key: targetKey(ref), name: structureSpec(b.kind).name, bounds: enclosure(corners) };
  }
  if (ref.kind === 'animal' || ref.kind === 'monster') {
    const p = town.creature(ref.id);
    if (!p || p.health <= 0 || p.insideLair || !map.revealed(p.position) || !app.renderer.visible(p.position))
      return null;
    if (p.animal !== null) {
      const s = animalSpec(p.animal);
      return local(s.name, p.position, -s.width / 2, (-s.height * 88) / 96, s.width, s.height);
    }
    return local(
      p.giant() ? 'Giant' : p.raider ? 'Raider' : 'Monster',
      p.position,
      -15,
      p.giant() ? -64 : -34,
      30,
      p.giant() ? 66 : 36,
    );
  }
  if (ref.kind === 'tree' || ref.kind === 'rock') {
    const x = ref.id % map.width(),
      y = Math.floor(ref.id / map.width());
    if (!map.inside(x, y)) return null;
    if (ref.kind === 'rock') {
      if (!mining.deposit(map, x, y)) return null;
      const p = mining.position(x, y),
        s = mining.size(map, x, y);
      return map.revealed(p) ? local('Stone', p, -s, -s * 1.1, s * 2, s * 1.3) : null;
    }
    if (!map.at(x, y).trees) return null;
    const t = treeAt(map, x, y, map.at(x, y).trees - 1),
      h = (5 + 38 * t.slender) * t.size,
      w = 11 * t.size;
    return map.revealed(t.foot) ? local('Tree', t.foot, -w, -h, w * 2, h) : null;
  }
  if (ref.kind === 'dungeon') {
    const s = map.dungeons()[ref.id];
    return s?.discovered ? local(s.name, point(s.origin.x + 1, s.origin.y + 1), -52, -55, 104, 80) : null;
  }
  if (ref.kind === 'road') {
    const r = town.roads().road(ref.id);
    if (!r) return null;
    const points = r.line.filter((p) => map.revealed(p)).map((p) => app.toScreen(p));
    return points.length
      ? {
          ...ref,
          key: targetKey(ref),
          name: r.paving >= 0 ? 'Paving' : r.built < 1 ? 'Road construction' : 'Road',
          bounds: enclosure(points),
        }
      : null;
  }
  const field = town.field(ref.id);
  if (!field || !field.outline.some((p) => map.revealed(p))) return null;
  return {
    ...ref,
    key: targetKey(ref),
    name: 'Field',
    bounds: enclosure(field.outline.map((p) => app.toScreen(p))),
  };
}

/** Inspect every visible object; issuing commands still checks ownership separately. */
export function targetsInBox(app: GameCommandApp, box: SelectionBounds): WorldObjectRef[] {
  const refs: WorldObjectRef[] = app.town.people().map((p) => ({ kind: 'person', id: p.id })),
    map = app.town.map?.();
  if (map) {
    refs.push(
      ...[0, 1, 2].map((id) => ({ kind: 'landmark' as const, id })),
      ...(app.town.buildings?.() ?? []).map((b) => ({ kind: 'building' as const, id: b.id })),
      ...(app.town.monsters?.() ?? []).map((b) => ({ kind: 'monster' as const, id: b.id })),
      ...(app.town.wildlife?.() ?? []).map((b) => ({ kind: 'animal' as const, id: b.id })),
      ...map.dungeons().map((_, id) => ({ kind: 'dungeon' as const, id })),
      ...(app.town.roads?.().roads() ?? []).map((b) => ({ kind: 'road' as const, id: b.id })),
      ...(app.town.fields?.() ?? []).map((b) => ({ kind: 'field' as const, id: b.id })),
    );
    for (let y = 0; y < map.height(); y++)
      for (let x = 0; x < map.width(); x++) {
        const id = y * map.width() + x;
        if (map.at(x, y).trees) refs.push({ kind: 'tree', id });
        if (mining.deposit(map, x, y)) refs.push({ kind: 'rock', id });
      }
  }
  return refs.filter((ref) => {
    const target = worldTarget(app, ref);
    if (!target) return false;
    const b = target.bounds;
    return b.x <= box.x + box.w && b.x + b.w >= box.x && b.y <= box.y + box.h && b.y + b.h >= box.y;
  });
}
export function hoveredTarget(app: GameCommandApp): WorldObjectRef | null {
  if (app.mouse.x < 0 || app.mouse.y < 0 || app.context.controlAt(app.mouse.x, app.mouse.y)) return null;
  const person = app.personAt(app.mouse);
  if (person >= 0) return { kind: 'person', id: person };
  const animal = app.animalAtScreen(app.mouse);
  if (animal >= 0) return { kind: 'animal', id: animal };
  const monster = app.town.monsterAt(app.cursor, 1.2);
  if (monster >= 0) return { kind: 'monster', id: monster };
  const building = app.buildingAtScreen(app.mouse);
  if (building >= 0) return { kind: 'building', id: building };
  const tree = app.treeAtScreen(app.mouse);
  if (tree >= 0) return { kind: 'tree', id: tree };
  const rock = app.rockAtScreen(app.mouse);
  if (rock >= 0) return { kind: 'rock', id: rock };
  for (const id of [0, 1, 2]) {
    const target = worldTarget(app, { kind: 'landmark', id });
    if (!target) continue;
    const b = target.bounds;
    if (app.mouse.x >= b.x && app.mouse.x <= b.x + b.w && app.mouse.y >= b.y && app.mouse.y <= b.y + b.h)
      return { kind: 'landmark', id };
  }
  const map = app.town.map(),
    tile = map.cell(app.cursor);
  if (tile && tile.dungeon >= 0 && map.dungeons()[tile.dungeon]?.discovered)
    return { kind: 'dungeon', id: tile.dungeon };
  const road = app.town.roads().distance(app.cursor);
  if (road.distance <= 0.4 && road.id !== undefined) return { kind: 'road', id: road.id };
  const field = app.town.fieldAt(app.cursor);
  return field >= 0 ? { kind: 'field', id: field } : null;
}
