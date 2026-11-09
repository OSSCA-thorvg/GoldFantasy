import type { GameCommandApp } from './game-commands';
import type { Camera, Point } from '../../../../packages/engine/src/geometry';
import { point } from '../../../../packages/engine/src/geometry';
import type { Town } from '../../../../packages/engine/src/town';
import { DungeonKind } from '../../../../packages/engine/src/world-types';
import { animalKindCount, animalSpec } from '../../../../packages/engine/src/wildlife';
import * as mining from '../../../../packages/engine/src/mining';
import { treeAt } from '../../../../packages/native-renderer/src/tree-painter';
import {
  selectionFrame,
  type SelectionBounds,
} from '../../../../packages/native-renderer/src/selection-marker';

export interface SelectionTarget {
  key: string;
  /** Unpadded bounds in logical screen pixels; selectionFrame supplies visual clearance. */
  bounds: SelectionBounds;
}
export interface SelectionTargetApp {
  town: Pick<Town, 'map' | 'building' | 'creature'>;
  renderer: Pick<GameCommandApp['renderer'], 'visible' | 'buildingRoof'>;
  camera: Pick<Camera, 'zoom' | 'toScreen'>;
  viewWidth: number;
  viewHeight: number;
  selected: number;
  selectedTree: number;
  selectedRock: number;
  selectedAnimal: number;
  selectedDungeon: number;
  toScreen(world: Point): Point;
}

// Solid silhouettes in dungeonSprite, relative to project(origin + (1, 1)).
// Separate ground glows and the name plate are not part of the selected object.
const dungeonBounds: Record<DungeonKind, SelectionBounds> = {
  [DungeonKind.Cave]: { x: -56, y: -46, w: 112, h: 70 },
  [DungeonKind.Crypt]: { x: -52, y: -55, w: 104, h: 88 },
  [DungeonKind.Portal]: { x: -50, y: -48, w: 100, h: 71 },
  [DungeonKind.Ruin]: { x: -29, y: -55, w: 79, h: 73 },
  [DungeonKind.GiantHall]: { x: -48, y: -40, w: 96, h: 53 },
};

/** Prepare existing selection feedback. Only disappeared targets clear their saved UI selection. */
export function selectionTargets(app: SelectionTargetApp): readonly SelectionTarget[] {
  const targets: SelectionTarget[] = [],
    map = app.town.map(),
    zoom = app.camera.zoom;
  const append = (key: string, bounds: SelectionBounds) => {
    if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) || bounds.w < 0 || bounds.h < 0)
      return;
    const frame = selectionFrame(bounds);
    if (frame.x + frame.w < 0 || frame.y + frame.h < 0 || frame.x > app.viewWidth || frame.y > app.viewHeight)
      return;
    targets.push({ key, bounds });
  };
  const local = (key: string, feet: Point, bounds: SelectionBounds) =>
    append(key, {
      x: feet.x + bounds.x * zoom,
      y: feet.y + bounds.y * zoom,
      w: bounds.w * zoom,
      h: bounds.h * zoom,
    });

  if (app.selected >= 0) {
    const building = app.town.building(app.selected);
    if (!building) app.selected = -1;
    else if (map.revealed(building.center)) {
      const corners = building
          .footprint()
          .corners()
          .map((p) => app.toScreen(p)),
        roof = app.renderer.buildingRoof(building);
      if (roof) corners.push(app.camera.toScreen(roof, app.viewWidth, app.viewHeight));
      const left = Math.min(...corners.map((p) => p.x)),
        top = Math.min(...corners.map((p) => p.y)),
        right = Math.max(...corners.map((p) => p.x)),
        bottom = Math.max(...corners.map((p) => p.y));
      append(`building:${building.id}`, { x: left, y: top, w: right - left, h: bottom - top });
    }
  }
  if (app.selectedTree >= 0) {
    const cell = app.selectedTree,
      x = cell % map.width(),
      y = Math.trunc(cell / map.width());
    if (!Number.isInteger(cell) || !map.inside(x, y) || !map.at(x, y).trees) app.selectedTree = -1;
    else {
      // Selection and harvesting identify a cell; the current target is its last standing tree.
      const tree = treeAt(map, x, y, map.at(x, y).trees - 1);
      if (map.revealed(tree.foot))
        local(`tree:${cell}`, app.toScreen(tree.foot), {
          x: -11 * tree.size,
          y: -(5 + 38 * tree.slender) * tree.size,
          w: 22 * tree.size,
          h: (5 + 38 * tree.slender) * tree.size,
        });
    }
  }
  if (app.selectedRock >= 0) {
    const cell = app.selectedRock,
      x = cell % map.width(),
      y = Math.trunc(cell / map.width());
    if (!Number.isInteger(cell) || !mining.deposit(map, x, y)) app.selectedRock = -1;
    else {
      const foot = mining.position(x, y),
        size = mining.size(map, x, y);
      if (map.revealed(foot))
        local(`rock:${cell}`, app.toScreen(foot), { x: -size, y: -1.1 * size, w: 2 * size, h: 1.3 * size });
    }
  }
  if (app.selectedAnimal >= 0) {
    const animal = app.town.creature(app.selectedAnimal);
    if (
      !animal ||
      animal.animal === null ||
      !Number.isInteger(animal.animal) ||
      animal.animal < 0 ||
      animal.animal >= animalKindCount ||
      animal.health <= 0
    )
      app.selectedAnimal = -1;
    else if (!animal.insideLair && map.revealed(animal.position) && app.renderer.visible(animal.position)) {
      const spec = animalSpec(animal.animal);
      local(`animal:${animal.id}`, app.toScreen(animal.position), {
        x: -spec.width / 2,
        y: (-spec.height * 88) / 96,
        w: spec.width,
        h: spec.height,
      });
    }
  }
  if (app.selectedDungeon >= 0) {
    const index = app.selectedDungeon,
      site = Number.isInteger(index) ? map.dungeons()[index] : undefined;
    if (!site || !map.inside(site.origin.x, site.origin.y)) app.selectedDungeon = -1;
    else if (site.discovered) {
      const bounds = dungeonBounds[site.kind];
      if (bounds)
        local(`dungeon:${index}`, app.toScreen(point(site.origin.x + 1, site.origin.y + 1)), bounds);
    }
  }
  return targets;
}
