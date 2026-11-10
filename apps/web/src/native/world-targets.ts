import type { GameCommandApp } from './game-commands';
import { point, type Point } from '../../../../packages/engine/src/geometry';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { animalSpec } from '../../../../packages/engine/src/wildlife';
import * as mining from '../../../../packages/engine/src/mining';
import { treeAt } from '../../../../packages/native-renderer/src/tree-painter';
import type { SelectionBounds } from '../../../../packages/native-renderer/src/selection-marker';

export type WorldObjectKind =
  'person' | 'building' | 'animal' | 'monster' | 'tree' | 'rock' | 'dungeon' | 'road' | 'field';
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
  const map = app.town.map(),
    tile = map.cell(app.cursor);
  if (tile && tile.dungeon >= 0 && map.dungeons()[tile.dungeon]?.discovered)
    return { kind: 'dungeon', id: tile.dungeon };
  const road = app.town.roads().distance(app.cursor);
  if (road.distance <= 0.4 && road.id !== undefined) return { kind: 'road', id: road.id };
  const field = app.town.fieldAt(app.cursor);
  return field >= 0 ? { kind: 'field', id: field } : null;
}
