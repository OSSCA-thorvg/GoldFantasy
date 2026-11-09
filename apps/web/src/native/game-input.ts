// Input and placement are translated from game_app.cpp; pixel thresholds are native values.
import { GameAppState, Plan } from './game-app-state';
import { Town } from '../../../../packages/engine/src/town';
import {
  Tool,
  Order,
  PointerButton,
  PreviewKind,
  toolStructure,
} from '../../../../packages/engine/src/game-tools';
import {
  type Point,
  type Outline,
  point,
  add,
  sub,
  scale,
  distance,
  length,
  project,
  unproject,
  rotated,
  area,
  Footprint,
} from '../../../../packages/engine/src/geometry';
import { f32 as f, clamp, lround } from '../../../../packages/engine/src/numeric';
import { type RoadPath, freehandRoad } from '../../../../packages/engine/src/road-network';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import type { Check } from '../../../../packages/engine/src/town-models';
import { buildingUnlock, toolAvailable } from '../../../../packages/engine/src/settlement-progression';
import { Activity } from '../../../../packages/engine/src/person';
import { Cue } from '../../../../packages/native-audio/src/sound-types';
import { Key } from '../../../../packages/native-ui/src';
import type { AppEvent } from './application-contracts';

export interface GameInputApp extends GameAppState {
  cue(sound: Cue): void;
  cueAt(sound: Cue, world: Point): void;
  dismissBuildDrawer(): void;
  queueWork(activity: Activity, target: number): void;
  issueOrder(order: Order): void;
  treeAtScreen(screen: Point): number;
  rockAtScreen(screen: Point): number;
  animalAtScreen(screen: Point): number;
  buildingAtScreen(screen: Point): number;
  selectTool(value: Tool, useSelection?: boolean): void;
  selectPeople(ids: number[]): void;
  selectBuilding(id: number): void;
  toScreen(world: Point): Point;
  nearOnScreen(world: Point, pixels?: number): boolean;
  personAt(screen: Point): number;
  fieldRectangle(from: Point, to: Point): Outline;
  roadPoint(): Point;
  hoveredRoad(): number;
  sampleRoad(): void;
  roadDraft(): RoadPath;
  finishRoad(): void;
  cancelStroke(): void;
  cancelPointer(): void;
  finish(): void;
  select(): void;
  press(): void;
  pointerMove(x: number, y: number): void;
  zoomBy(factor: number, screen: Point): void;
}
export function personAt(this: GameInputApp, screen: Point): number {
  let best = -1,
    bestGap = f(13 * Math.max(this.camera.zoom, f(0.7)));
  for (const person of this.town.people()) {
    if (person.visibility() <= f(0.05)) continue;
    const feet = this.toScreen(person.position),
      gap = distance(screen, point(feet.x, f(feet.y - f(9 * this.camera.zoom))));
    if (gap < bestGap) {
      bestGap = gap;
      best = person.id;
    }
  }
  return best;
}
export function fieldRectangle(this: GameInputApp, from: Point, to: Point): Outline {
  const nearest = this.town.roads().distance(from),
    tangent = nearest.distance > 6 ? point(1, 0) : (nearest.tangent ?? point(1, 0));
  const angle = f(Math.atan2(tangent.y, tangent.x)),
    local = rotated(sub(to, from), -angle);
  return [
    { ...from },
    add(from, rotated(point(local.x, 0), angle)),
    add(from, rotated(local, angle)),
    add(from, rotated(point(0, local.y), angle)),
  ];
}
export function toScreen(this: GameInputApp, world: Point): Point {
  return this.camera.toScreen(project(world.x, world.y), this.viewWidth, this.viewHeight);
}
export function nearOnScreen(this: GameInputApp, world: Point, pixels = 9): boolean {
  return distance(this.toScreen(world), this.mouse) <= pixels;
}
export function roadPoint(this: GameInputApp): Point {
  const nearest = this.town.roads().distance(this.cursor);
  return nearest.distance <= Town.joinReach && nearest.onRoad ? nearest.onRoad : { ...this.cursor };
}
export function hoveredRoad(this: GameInputApp): number {
  const nearest = this.town.roads().distance(this.cursor);
  return nearest.distance <= f(1.5) ? (nearest.id ?? -1) : -1;
}
export function sampleRoad(this: GameInputApp): void {
  if (!this.roadPress || !Number.isFinite(this.cursor.x) || !Number.isFinite(this.cursor.y)) return;
  this.roadMoved ||= distance(this.roadPress, this.mouse) >= 6;
  if (!this.roadMoved || distance(this.toScreen(this.roadStroke[this.roadStroke.length - 1]), this.mouse) < 3)
    return;
  if (this.roadStroke.length >= 4096) {
    this.cancelStroke();
    this.status = 'Stroke is too detailed; draw a shorter road';
    return;
  }
  this.roadStroke.push({ ...this.cursor });
}
export function roadDraft(this: GameInputApp): RoadPath {
  if (!this.roadPress || !this.roadStroke.length) return [];
  let points = this.roadStroke.map((p) => ({ ...p }));
  if (points.length > 1 && distance(this.toScreen(points[points.length - 1]), this.mouse) < 3)
    points[points.length - 1] = { ...this.cursor };
  else if (points[points.length - 1].x !== this.cursor.x || points[points.length - 1].y !== this.cursor.y)
    points.push({ ...this.cursor });
  if (points.length < 2) return [];
  const covered = (p: Point) => this.town.roads().distance(p).distance <= f(0.12);
  if (points.every(covered)) return [];
  const nearSameRoad = (p: Point, road: number) => {
    const nearest = this.town.roads().distance(p);
    return nearest.distance <= Town.joinReach && nearest.id === road;
  };
  const start = this.town.roads().distance(points[0]),
    end = this.roadPoint(),
    endRoad = this.town.roads().distance(end).id ?? -1;
  if (start.distance <= Town.joinReach) {
    while (
      points.length > 2 &&
      nearSameRoad(points[0], start.id ?? -1) &&
      nearSameRoad(points[1], start.id ?? -1)
    )
      points.shift();
    points[0] = this.town.roads().distance(points[0]).onRoad ?? point();
  }
  if (covered(end)) {
    while (
      points.length > 2 &&
      nearSameRoad(points[points.length - 2], endRoad) &&
      nearSameRoad(points[points.length - 1], endRoad)
    )
      points.pop();
    points[points.length - 1] = end;
  }
  const origin = points[0],
    screen = (p: Point) => {
      const delta = sub(p, origin);
      return scale(project(delta.x, delta.y), this.camera.zoom);
    };
  points = points.map(screen);
  const startOffset = sub(screen(covered(origin) ? origin : this.roadStart), points[0]),
    endOffset = sub(screen(this.roadPoint()), points[points.length - 1]);
  let total = 0;
  for (let i = 1; i < points.length; ++i) total = f(total + distance(points[i - 1], points[i]));
  if (total <= 0) return [];
  const blend = Math.min(total, Math.max(24, f(3 * Math.max(length(startOffset), length(endOffset)))));
  const weight = (along: number) => {
    const t = clamp(f(along / blend), 0, 1);
    return f(1 - f(f(t * t) * f(3 - f(2 * t))));
  };
  let walked = 0,
    previous = points[0];
  points = points.map((raw) => {
    walked = f(walked + distance(previous, raw));
    previous = raw;
    return add(add(raw, scale(startOffset, weight(walked))), scale(endOffset, weight(f(total - walked))));
  });
  const path = freehandRoad(points, 5);
  for (const anchor of path)
    for (const key of ['point', 'in', 'out'] as const) {
      const p = anchor[key];
      anchor[key] = add(origin, unproject(f(p.x / this.camera.zoom), f(p.y / this.camera.zoom)));
    }
  return path;
}
export function finishRoad(this: GameInputApp): void {
  if (!this.roadPress) return;
  const path = this.roadDraft(),
    moved = this.roadMoved;
  this.roadPress = null;
  this.roadStroke = [];
  this.roadMoved = false;
  if (!moved || path.length < 2) {
    this.status = 'Hold and draw a road';
    return;
  }
  const check = this.town.canBuildRoad(path);
  if (!this.town.buildRoad(path)) {
    this.status = check.reason;
    return;
  }
  const id = this.town.roads().roads().at(-1)!.id;
  if (this.crew.length) this.town.orderRoadwork(this.crew, id);
  else this.queueWork(Activity.Roadwork, id);
  this.cue(Cue.Place);
  this.selectTool(Tool.Select);
}
export function plan(this: GameInputApp): Plan {
  const result = new Plan(),
    preview = result.preview;
  preview.zoom = this.camera.zoom;
  preview.cursor = { ...this.cursor };
  if (this.hudPointer || this.mouse.x < 0 || this.panFrom || !this.town.map().inside(this.cursor))
    return result;
  const take = (check: Check) => {
    preview.valid = check.ok;
    result.problem = check.ok ? '' : check.reason;
    result.cost = check.cost;
  };
  switch (this.tool) {
    case Tool.Select:
      return result;
    case Tool.Road:
      preview.kind = PreviewKind.Road;
      preview.brush = true;
      preview.cursor = this.roadPoint();
      if (this.roadPress) {
        preview.road = this.roadDraft();
        if (this.roadMoved && preview.road.length >= 2) take(this.town.canBuildRoad(preview.road));
        else preview.valid = true;
      } else preview.valid = true;
      return result;
    case Tool.Pave: {
      const road = this.town.roads().road(this.hoveredRoad());
      if (road) {
        preview.kind = PreviewKind.Road;
        preview.road = road.path;
        take(this.town.canPave(road.id));
      }
      return result;
    }
    case Tool.Field:
      preview.kind = PreviewKind.Field;
      if (this.fieldFrom && distance(this.toScreen(this.fieldFrom), this.mouse) > 8) {
        preview.outline = this.fieldRectangle(this.fieldFrom, this.cursor);
        take(this.town.canPlantField(preview.outline));
        if (!result.problem) result.problem = lround(area(preview.outline)) + ' acres';
        return result;
      }
      preview.outline = this.outline.map((p) => ({ ...p }));
      preview.closed = false;
      if (!this.outline.length) {
        preview.valid = true;
        return result;
      }
      if (this.outline.length >= 3 && this.nearOnScreen(this.outline[0])) {
        preview.active = 0;
        take(this.town.canPlantField(this.outline));
      } else {
        const open = [...this.outline, this.cursor];
        take(this.town.canPlantField(open));
        if (this.outline.length < 2) result.problem = '';
      }
      return result;
    case Tool.Demolish: {
      preview.kind = PreviewKind.Clear;
      take(this.town.canDemolish(this.cursor));
      const id = this.town.buildingAt(this.cursor),
        field = this.town.fieldAt(this.cursor),
        road = this.town.roads().road(this.hoveredRoad());
      if (id >= 0) preview.outline = this.town.building(id)!.footprint().corners();
      else if (field >= 0) preview.outline = this.town.field(field)!.outline;
      else if (road && this.town.roads().distance(this.cursor).distance < f(Town.roadHalfWidth + f(0.15)))
        preview.road = road.path;
      if (!preview.valid && preview.outline.length === 0 && preview.road.length === 0) result.problem = '';
      return result;
    }
  }
  const kind = toolStructure(this.tool);
  if (kind !== undefined) {
    if (!buildingUnlock(this.town, kind).available) return result;
    const spot = this.town.fit(kind, this.cursor, this.freeAngle);
    preview.kind = PreviewKind.Footprint;
    preview.outline = new Footprint(spot.center, f(structureSpec(kind).size / 2), spot.angle).corners();
    take(this.town.canPlace(kind, spot.center, spot.angle));
  }
  return result;
}
export function selectTool(this: GameInputApp, value: Tool, useSelection = false): void {
  if (!toolAvailable(this.town, value)) {
    this.status = 'Complete the earlier settlement quests first';
    return;
  }
  if (this.tool !== value) this.cue(Cue.Click);
  this.tool = value;
  this.dismissBuildDrawer();
  if (value !== Tool.Select) this.selectedTree = this.selectedRock = this.selectedAnimal = -1;
  this.crew = useSelection ? [...this.chosen] : [];
  this.pending = Order.None;
  this.roadStroke = [];
  this.roadPress = null;
  this.roadMoved = false;
  this.outline = [];
  this.fieldFrom = null;
  this.boxFrom = null;
  this.status = '';
}
export function selectPeople(this: GameInputApp, ids: number[]): void {
  this.selectTool(Tool.Select);
  this.chosen = [...ids];
  this.selected = this.selectedDungeon = this.selectedTree = this.selectedRock = this.selectedAnimal = -1;
}
export function selectBuilding(this: GameInputApp, id: number): void {
  this.selectTool(Tool.Select);
  this.selected = id;
  this.residentPage = 0;
  this.selectedDungeon = this.selectedTree = this.selectedRock = this.selectedAnimal = -1;
  this.chosen = [];
}
export function cancel(this: GameInputApp): void {
  if (this.timeExpanded) {
    this.timeExpanded = false;
    return;
  }
  if (this.roadPress) {
    this.cancelStroke();
    return;
  }
  if (this.pending !== Order.None) {
    this.pending = Order.None;
    return;
  }
  if (this.globalCard >= 0) {
    if (this.globalCard > 0) this.globalCard = 0;
    else this.dismissBuildDrawer();
    return;
  }
  if (this.card >= 0) {
    if (this.card > 0) this.card = 0;
    else this.dismissBuildDrawer();
    return;
  }
  if (this.outline.length || this.fieldFrom) {
    this.outline = [];
    this.fieldFrom = null;
  } else if (
    this.selected >= 0 ||
    this.selectedDungeon >= 0 ||
    this.selectedTree >= 0 ||
    this.selectedRock >= 0 ||
    this.selectedAnimal >= 0 ||
    this.chosen.length
  ) {
    this.selected = this.selectedDungeon = this.selectedTree = this.selectedRock = this.selectedAnimal = -1;
    this.chosen = [];
  } else this.tool = Tool.Select;
  this.status = '';
}
export function finish(this: GameInputApp): void {
  this.status = '';
  if (this.tool === Tool.Field && this.outline.length >= 3) {
    const check = this.town.canPlantField(this.outline);
    if (this.town.plantField(this.outline)) {
      this.outline = [];
      this.cue(Cue.Place);
    } else this.status = check.reason;
  }
}
export function undoPoint(this: GameInputApp): void {
  if (this.tool === Tool.Road && this.roadPress) this.cancelStroke();
  else if (this.tool === Tool.Field && this.outline.length) this.outline.pop();
}
export function cancelStroke(this: GameInputApp): void {
  if (this.roadPress) this.status = 'Road stroke cancelled';
  this.roadStroke = [];
  this.roadPress = null;
  this.roadMoved = false;
}
export function cancelPointer(this: GameInputApp): void {
  this.cancelStroke();
  this.fieldFrom = this.boxFrom = this.panFrom = this.pressAt = null;
  this.panMoved = this.hudPointer = this.timeExpanded = false;
  this.timeReveal = 0;
  this.timeUiAt = -1;
  this.skyHovered = false;
  this.questsAnimating = false;
  this.questPulseAt = -1;
  this.context.setPointerPosition(-1, -1);
  this.context.cancelPointer();
}
export function select(this: GameInputApp): void {
  this.selected = this.town.buildingAt(this.cursor);
  this.residentPage = 0;
  this.selectedDungeon = this.selectedTree = this.selectedRock = this.selectedAnimal = -1;
  if (this.selected >= 0) return;
  this.selectedAnimal = this.animalAtScreen(this.mouse);
  if (this.selectedAnimal >= 0) return;
  this.selectedTree = this.treeAtScreen(this.mouse);
  if (this.selectedTree >= 0) return;
  this.selectedRock = this.rockAtScreen(this.mouse);
  if (this.selectedRock >= 0) return;
  this.selected = this.buildingAtScreen(this.mouse);
  if (this.selected >= 0) return;
  const tile = this.town.map().cell(this.cursor);
  if (tile && tile.dungeon >= 0 && this.town.map().dungeons()[tile.dungeon].discovered)
    this.selectedDungeon = tile.dungeon;
}
export function pointerDown(this: GameInputApp, x: number, y: number, button: PointerButton): void {
  x = f(x);
  y = f(y);
  this.pointerMove(x, y);
  if (this.timeExpanded && !this.timeToggleBounds.contains(x, y) && !this.timePanelBounds.contains(x, y))
    this.timeExpanded = false;
  if (button === PointerButton.Secondary) {
    if (this.context.controlAt(x, y)) return;
    if (this.roadPress) {
      this.cancelStroke();
      return;
    }
    this.panFrom = point(x, y);
    this.pressAt = point(x, y);
    this.panMoved = false;
    return;
  }
  this.cancelStroke();
  if (this.context.controlAt(x, y)) {
    this.hudPointer = true;
    this.context.pointerDown(x, y);
    return;
  }
  this.dismissBuildDrawer();
  if (this.pending !== Order.None && this.chosen.length) return;
  this.pending = Order.None;
  this.press();
}
export function press(this: GameInputApp): void {
  this.status = '';
  switch (this.tool) {
    case Tool.Select:
      this.boxFrom = { ...this.mouse };
      return;
    case Tool.Road:
      this.roadStart = this.roadPoint();
      this.roadStroke = [{ ...this.cursor }];
      this.roadPress = { ...this.mouse };
      this.roadMoved = false;
      return;
    case Tool.Pave: {
      const id = this.hoveredRoad(),
        check = this.town.canPave(id);
      if (!this.town.pave(id)) this.status = check.reason;
      else if (this.crew.length) this.town.orderRoadwork(this.crew, id);
      else this.queueWork(Activity.Roadwork, id);
      return;
    }
    case Tool.Field:
      if (!this.outline.length) this.fieldFrom = { ...this.cursor };
      else if (this.outline.length >= 3 && this.nearOnScreen(this.outline[0])) this.finish();
      else this.outline.push({ ...this.cursor });
      return;
    case Tool.Demolish: {
      const check = this.town.canDemolish(this.cursor);
      if (this.town.demolish(this.cursor)) this.cueAt(Cue.Demolish, this.cursor);
      else this.status = check.reason;
      return;
    }
  }
  const kind = toolStructure(this.tool);
  if (kind !== undefined) {
    if (!buildingUnlock(this.town, kind).available) return;
    const spot = this.town.fit(kind, this.cursor, this.freeAngle),
      check = this.town.canPlace(kind, spot.center, spot.angle);
    if (this.town.place(kind, spot.center, spot.angle)) {
      this.selected = this.town.buildings().at(-1)!.id;
      if (this.crew.length) this.town.orderBuild(this.crew, this.selected);
      else this.queueWork(Activity.Building, this.selected);
      this.cueAt(Cue.Place, spot.center);
      this.selectTool(Tool.Select);
      this.card = -1;
    } else this.status = check.reason;
  }
}
export function pointerMove(this: GameInputApp, x: number, y: number): void {
  x = f(x);
  y = f(y);
  if (this.panFrom) {
    if (!this.panMoved && this.pressAt && distance(this.pressAt, point(x, y)) >= 8) this.panMoved = true;
    if (this.panMoved) {
      this.camera.x = f(this.camera.x - f(f(x - this.panFrom.x) / this.camera.zoom));
      this.camera.y = f(this.camera.y - f(f(y - this.panFrom.y) / this.camera.zoom));
      this.panFrom = point(x, y);
    }
  }
  this.mouse = point(x, y);
  const world = this.camera.toWorld(this.mouse, this.viewWidth, this.viewHeight);
  this.cursor = unproject(world.x, world.y);
  this.context.pointerMove(x, y);
  this.sampleRoad();
}
export function pointerUp(this: GameInputApp, x: number, y: number, button: PointerButton): void {
  this.pointerMove(x, y);
  if (button === PointerButton.Secondary) {
    const click = this.pressAt && !this.panMoved;
    this.panFrom = this.pressAt = null;
    this.panMoved = false;
    if (click && this.tool === Tool.Select && this.chosen.length && !this.context.controlAt(x, y)) {
      const tile = this.town.map().cell(this.cursor);
      const dungeonClick =
        (this.pending === Order.None || this.pending === Order.Work) &&
        tile &&
        tile.dungeon >= 0 &&
        tile.dungeon < this.town.map().dungeons().length &&
        this.town.map().dungeons()[tile.dungeon].discovered &&
        this.animalAtScreen(this.mouse) < 0 &&
        this.town.monsterAt(this.cursor, f(1.2)) < 0 &&
        this.treeAtScreen(this.mouse) < 0 &&
        this.rockAtScreen(this.mouse) < 0 &&
        this.buildingAtScreen(this.mouse) < 0;
      if (dungeonClick && this.town.sendExpedition(this.chosen, tile.dungeon)) this.cue(Cue.Order);
      else this.issueOrder(this.pending === Order.None ? Order.Work : this.pending);
      this.pending = Order.None;
    } else if (click && this.tool === Tool.Field) this.finish();
    return;
  }
  if (this.hudPointer) {
    this.context.pointerUp(x, y);
    this.hudPointer = false;
    return;
  }
  if (this.pending === Order.Attack && this.chosen.length && !this.context.controlAt(x, y)) {
    this.issueOrder(this.pending);
    this.pending = Order.None;
    return;
  }
  if (this.boxFrom) {
    const from = this.boxFrom;
    this.boxFrom = null;
    if (distance(from, this.mouse) > 6) {
      const x0 = Math.min(from.x, this.mouse.x),
        x1 = Math.max(from.x, this.mouse.x),
        y0 = Math.min(from.y, this.mouse.y),
        y1 = Math.max(from.y, this.mouse.y);
      this.chosen = [];
      for (const person of this.town.people()) {
        const s = this.toScreen(person.position);
        if (person.visibility() > f(0.05) && s.x >= x0 && s.x <= x1 && f(s.y - 8) >= y0 && f(s.y - 8) <= y1)
          this.chosen.push(person.id);
      }
      if (this.chosen.length)
        this.selected =
          this.selectedDungeon =
          this.selectedTree =
          this.selectedRock =
          this.selectedAnimal =
            -1;
      return;
    }
    const id = this.personAt(this.mouse);
    if (id >= 0) this.selectPeople([id]);
    else {
      this.chosen = [];
      this.select();
    }
    return;
  }
  if (this.fieldFrom) {
    const from = this.fieldFrom;
    this.fieldFrom = null;
    if (distance(this.toScreen(from), this.mouse) > 8) {
      const rectangle = this.fieldRectangle(from, this.cursor),
        check = this.town.canPlantField(rectangle);
      if (!this.town.plantField(rectangle)) this.status = check.reason;
    } else this.outline.push(from);
    return;
  }
  if (this.tool === Tool.Road) this.finishRoad();
}
export function wheel(this: GameInputApp, x: number, y: number, amount: number): void {
  this.zoomBy(f(Math.pow(f(1.12), f(amount))), point(x, y));
}
export function zoomBy(this: GameInputApp, factor: number, screen: Point): void {
  const before = this.camera.toWorld(screen, this.viewWidth, this.viewHeight);
  this.camera.zoom = clamp(f(this.camera.zoom * factor), f(0.1), GameAppState.maxZoom);
  const after = this.camera.toWorld(screen, this.viewWidth, this.viewHeight);
  this.camera.x = f(this.camera.x + f(before.x - after.x));
  this.camera.y = f(this.camera.y + f(before.y - after.y));
  this.pointerMove(screen.x, screen.y);
}
export function sceneEvent(this: GameInputApp, event: AppEvent): boolean {
  const screen = point(event.x, event.y),
    projected = this.camera.toWorld(screen, this.viewWidth, this.viewHeight),
    world = unproject(projected.x, projected.y);
  if (event.type === 'PointerCancel') {
    this.scenePanAt = this.sceneDragAt = this.sceneDragOrigin = null;
    return false;
  }
  if (event.type === 'PointerDown') {
    if (event.button !== 1) {
      this.scenePanAt = screen;
      return false;
    }
    const person = this.personAt(screen);
    if (person >= 0) {
      this.selectPeople([person]);
      this.sceneDragOrigin = { ...this.town.person(person)!.position };
    } else {
      this.selectBuilding(this.town.buildingAt(world));
      const building = this.town.building(this.selected);
      this.sceneDragOrigin = building ? { ...building.center } : null;
    }
    this.sceneDragAt = world;
    return true;
  }
  if (event.type === 'PointerMove') {
    if (this.scenePanAt) {
      this.camera.x = f(this.camera.x - f(f(screen.x - this.scenePanAt.x) / this.camera.zoom));
      this.camera.y = f(this.camera.y - f(f(screen.y - this.scenePanAt.y) / this.camera.zoom));
      this.scenePanAt = screen;
      return true;
    }
    if (this.sceneDragAt && this.sceneDragOrigin) {
      const position = sub(add(this.sceneDragOrigin, world), this.sceneDragAt);
      if (this.chosen.length === 1) {
        const person = this.town.person(this.chosen[0]);
        if (person) return this.town.editPerson(person.id, position, person.health);
      } else {
        const building = this.town.building(this.selected);
        if (building)
          return this.town.editBuilding(
            building.id,
            position,
            building.angle,
            building.progress,
            building.health,
          );
      }
    }
  }
  if (event.type === 'PointerUp') this.scenePanAt = this.sceneDragAt = this.sceneDragOrigin = null;
  if (event.type === 'Wheel') {
    this.camera.zoom = clamp(
      f(this.camera.zoom * f(Math.pow(f(1.12), event.delta))),
      f(0.1),
      GameAppState.maxZoom,
    );
    const after = this.camera.toWorld(screen, this.viewWidth, this.viewHeight);
    this.camera.x = f(this.camera.x + f(projected.x - after.x));
    this.camera.y = f(this.camera.y + f(projected.y - after.y));
    return true;
  }
  if (event.type === 'KeyDown') {
    const step = f(32 / this.camera.zoom);
    if (event.key === Key.Left) this.camera.x = f(this.camera.x - step);
    else if (event.key === Key.Right) this.camera.x = f(this.camera.x + step);
    else if (event.key === Key.Up) this.camera.y = f(this.camera.y - step);
    else if (event.key === Key.Down) this.camera.y = f(this.camera.y + step);
    else return false;
    return true;
  }
  return false;
}
