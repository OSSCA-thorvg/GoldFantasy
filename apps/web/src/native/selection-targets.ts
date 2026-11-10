import type { GameCommandApp } from './game-commands';
import {
  worldObjectKey,
  type WorldObjectRef,
  type SelectionGeometry,
} from '../../../../packages/native-renderer/src/world-picking-types';
import * as mining from '../../../../packages/engine/src/mining';

export type SelectionTargetApp = GameCommandApp;
export interface SelectionTarget extends WorldObjectRef {
  key: string;
  bounds: SelectionGeometry['bounds'];
  geometry: SelectionGeometry;
}

/** Remove disappeared targets, preserving inspection while a living target is hidden or off-screen. */
export function selectionReferences(app: SelectionTargetApp): WorldObjectRef[] {
  app.chosen = app.chosen.filter((id) => {
    const p = app.town.person(id);
    return !!p && p.health > 0;
  });
  if (app.chosen.length) return app.chosen.map((id) => ({ kind: 'person', id }));
  const map = app.town.map();
  if (app.selected >= 0) {
    if (app.town.building(app.selected)) return [{ kind: 'building', id: app.selected }];
    app.selected = -1;
  }
  if (app.selectedTree >= 0) {
    const cell = app.selectedTree,
      x = cell % map.width(),
      y = Math.floor(cell / map.width()),
      index = app.selectedTreeInstance;
    if (map.inside(x, y) && map.at(x, y).trees > 0 && (index < 0 || index < map.at(x, y).trees))
      return [{ kind: 'tree', id: cell, ...(index >= 0 ? { instanceIndex: index } : {}) }];
    app.selectedTree = app.selectedTreeInstance = -1;
  }
  if (app.selectedRock >= 0) {
    const cell = app.selectedRock,
      x = cell % map.width(),
      y = Math.floor(cell / map.width());
    if (mining.deposit(map, x, y)) return [{ kind: 'rock', id: cell }];
    app.selectedRock = -1;
  }
  if (app.selectedAnimal >= 0) {
    const animal = app.town.creature(app.selectedAnimal);
    if (animal && animal.animal !== null && animal.health > 0) return [{ kind: 'animal', id: animal.id }];
    app.selectedAnimal = -1;
  }
  if (app.selectedDungeon >= 0) {
    if (map.dungeons()[app.selectedDungeon]) return [{ kind: 'dungeon', id: app.selectedDungeon }];
    app.selectedDungeon = -1;
  }
  app.selectedObjects = app.selectedObjects
    .filter((ref) => {
      if (ref.kind === 'monster' || ref.kind === 'animal')
        return (app.town.creature(ref.id)?.health ?? 0) > 0;
      if (ref.kind === 'road') return !!app.town.roads().road(ref.id);
      if (ref.kind === 'field') return !!app.town.field(ref.id);
      if (ref.kind === 'landmark')
        return ref.id === 0 ? !!map.giant() : ref.id === 1 ? !!map.volcano() : true;
      return false;
    })
    .slice(0, 1);
  return [...app.selectedObjects];
}
/** Geometry is the last immutable presented frame, never an app-side bounding approximation. */
export function selectionTargets(app: SelectionTargetApp): SelectionTarget[] {
  return selectionReferences(app).flatMap((ref) => {
    const geometry = app.renderer.selectionGeometry(ref);
    return geometry ? [{ ...ref, key: worldObjectKey(ref), bounds: geometry.bounds, geometry }] : [];
  });
}
