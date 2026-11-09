// Direct translation of native game_commands.cpp.
import type { GameInputApp } from './game-input';
import { Tool, Order } from '../../../../packages/engine/src/game-tools';
import { type Point, point, distance, unproject } from '../../../../packages/engine/src/geometry';
import { f32 as f } from '../../../../packages/engine/src/numeric';
import { animalSpec } from '../../../../packages/engine/src/wildlife';
import { Activity } from '../../../../packages/engine/src/person';
import { isHome, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { treePosition } from '../../../../packages/engine/src/world-map';
import * as mining from '../../../../packages/engine/src/mining';
import { treeAt } from '../../../../packages/native-renderer/src/tree-painter';
import {
  canControl,
  isPlayerBuilding,
  buildingControlReason,
  belongsToFaction,
} from '../../../../packages/engine/src/faction';
import { controllableIds, selectionControlReason } from './game-control';
import { Cue } from '../../../../packages/native-audio/src/sound-types';
import { Rect } from '../../../../packages/native-ui/src';
export interface GameCommandApp extends GameInputApp {
  editor?: unknown;
  atlas?: unknown;
  buildings?: unknown;
  dispatchWork(force?: boolean): void;
  targetingCursor(): boolean;
}
function interruptible(activity: Activity): boolean {
  return [
    Activity.Idle,
    Activity.Moving,
    Activity.Holding,
    Activity.Building,
    Activity.Roadwork,
    Activity.Working,
    Activity.Hauling,
    Activity.Felling,
    Activity.Mining,
    Activity.Collecting,
  ].includes(activity);
}
export function treeAtScreen(this: GameCommandApp, screen: Point): number {
  const ground = this.camera.toWorld(screen, this.viewWidth, this.viewHeight),
    tile = unproject(ground.x, ground.y),
    map = this.town.map();
  let found = -1,
    best = Infinity;
  for (
    let y = Math.max(0, Math.trunc(tile.y) - 4);
    y <= Math.min(map.height() - 1, Math.trunc(tile.y) + 4);
    ++y
  )
    for (
      let x = Math.max(0, Math.trunc(tile.x) - 4);
      x <= Math.min(map.width() - 1, Math.trunc(tile.x) + 4);
      ++x
    )
      for (let index = 0; index < map.at(x, y).trees; ++index) {
        const tree = treeAt(map, x, y, index);
        if (!map.revealed(tree.foot)) continue;
        const feet = this.toScreen(tree.foot),
          height = f(f(f(5 + f(38 * tree.slender)) * tree.size) * this.camera.zoom),
          width = f(f(f(11 * tree.size) * this.camera.zoom) + 3);
        if (
          screen.y < f(feet.y - height) ||
          screen.y > f(feet.y + 3) ||
          Math.abs(f(screen.x - feet.x)) > width
        )
          continue;
        const gap = distance(screen, feet);
        if (gap < best) {
          best = gap;
          found = y * map.width() + x;
        }
      }
  return found;
}
export function rockAtScreen(this: GameCommandApp, screen: Point): number {
  const ground = this.camera.toWorld(screen, this.viewWidth, this.viewHeight),
    tile = unproject(ground.x, ground.y),
    map = this.town.map();
  let found = -1,
    best = Infinity;
  for (
    let y = Math.max(0, Math.trunc(tile.y) - 2);
    y <= Math.min(map.height() - 1, Math.trunc(tile.y) + 2);
    ++y
  )
    for (
      let x = Math.max(0, Math.trunc(tile.x) - 2);
      x <= Math.min(map.width() - 1, Math.trunc(tile.x) + 2);
      ++x
    ) {
      const foot = mining.position(x, y);
      if (!mining.deposit(map, x, y) || !map.revealed(foot)) continue;
      const at = this.toScreen(foot),
        size = f(mining.size(map, x, y) * this.camera.zoom);
      if (
        screen.x < f(f(at.x - size) - 3) ||
        screen.x > f(f(at.x + size) + 3) ||
        screen.y < f(f(at.y - f(size * f(1.1))) - 3) ||
        screen.y > f(at.y + 5)
      )
        continue;
      const gap = distance(screen, at);
      if (gap < best) {
        best = gap;
        found = y * map.width() + x;
      }
    }
  return found;
}
export function buildingAtScreen(this: GameCommandApp, screen: Point): number {
  const at = this.camera.toWorld(screen, this.viewWidth, this.viewHeight),
    id = this.renderer.buildingDrawnAt(this.town, at);
  const found = id >= 0 ? id : this.town.buildingAt(unproject(at.x, at.y));
  const building = this.town.building(found);
  return building && building.faction > 0 && !this.town.map().revealed(building.center) ? -1 : found;
}
export function animalAtScreen(this: GameCommandApp, screen: Point): number {
  let found = -1,
    best = Infinity;
  for (const animal of this.town.wildlife()) {
    if (animal.animal === null || animal.health <= 0 || !this.town.map().revealed(animal.position)) continue;
    const spec = animalSpec(animal.animal),
      feet = this.toScreen(animal.position),
      w = f(spec.width * this.camera.zoom),
      h = f(spec.height * this.camera.zoom);
    if (
      Math.abs(f(screen.x - feet.x)) > f(f(w * f(0.5)) + 3) ||
      screen.y < f(f(feet.y - f(h * f(88 / 96))) - 3) ||
      screen.y > f(feet.y + 4)
    )
      continue;
    const gap = distance(screen, point(feet.x, f(feet.y - f(h * f(0.45)))));
    if (gap < best) {
      best = gap;
      found = animal.id;
    }
  }
  return found;
}
export function prepare(this: GameCommandApp, order: Order): void {
  if (!this.chosen.length) {
    if (this.selectedAnimal >= 0 && order === Order.Attack) {
      const animal = this.town.creature(this.selectedAnimal),
        candidates: { busy: boolean; distance: number; id: number }[] = [];
      if (animal && animal.animal !== null && animal.health > 0)
        for (const p of this.town.people()) {
          if (!canControl(p) || p.inside || p.ordered || !interruptible(p.activity)) continue;
          const idle = !p.moving() && (p.activity === Activity.Idle || p.activity === Activity.Holding);
          candidates.push({ busy: !idle, distance: distance(p.position, animal.position), id: p.id });
        }
      candidates.sort((a, b) => Number(a.busy) - Number(b.busy) || a.distance - b.distance || a.id - b.id);
      if (candidates.length && this.town.orderAttack([candidates[0].id], this.selectedAnimal))
        this.cue(Cue.Order);
      else this.status = 'Select a resident, then use Attack';
    }
    if (this.selectedTree >= 0 && (order === Order.Attack || order === Order.Work)) {
      this.queueWork(Activity.Felling, this.selectedTree);
      this.cue(Cue.Order);
    }
    if (this.selectedRock >= 0 && (order === Order.Attack || order === Order.Work)) {
      this.queueWork(Activity.Mining, this.selectedRock);
      this.cue(Cue.Order);
    }
    return;
  }
  if (!controllableIds(this.town, this.chosen).length) {
    this.status = selectionControlReason(this.town, this.chosen);
    return;
  }
  this.selectTool(Tool.Select);
  this.card = this.globalCard = -1;
  this.pending = order;
}
export function targetingCursor(this: GameCommandApp): boolean {
  if (this.editor || this.atlas || this.buildings) return false;
  return (
    this.pending !== Order.None &&
    this.mouse.x >= 0 &&
    this.mouse.y >= 0 &&
    this.mouse.x < this.viewWidth &&
    this.mouse.y < this.viewHeight &&
    !this.panFrom &&
    !this.context.controlAt(this.mouse.x, this.mouse.y)
  );
}
export function openUnitBuild(this: GameCommandApp): void {
  if (!controllableIds(this.town, this.chosen).length) return;
  this.selectTool(Tool.Select);
  this.card = 0;
  this.globalCard = -1;
  this.drawerPinned = true;
  this.drawerSuppressed = false;
}
export function toggleAuto(this: GameCommandApp): void {
  const ids = controllableIds(this.town, this.chosen);
  const enabled = ids.some((id) => {
    const person = this.town.person(id);
    return person && !person.autoMode;
  });
  for (const id of ids) {
    if (enabled) this.stoppedWork.delete(id);
    this.town.setAuto(id, enabled);
  }
}
export function stopSelected(this: GameCommandApp): void {
  const ids = controllableIds(this.town, this.chosen);
  this.town.orderStop(ids);
  for (const id of ids) this.stoppedWork.set(id, this.workSerial);
  this.selectTool(Tool.Select);
  this.card = this.globalCard = -1;
  this.pending = Order.None;
  this.cancelPointer();
}
export function leaveSelected(this: GameCommandApp): void {
  const ids = controllableIds(this.town, this.chosen);
  if (!this.town.orderLeave(ids)) return;
  for (const id of ids) this.stoppedWork.set(id, this.workSerial);
  this.selectTool(Tool.Select);
  this.card = this.globalCard = -1;
  this.pending = Order.None;
  this.cancelPointer();
  this.cue(Cue.Order);
}
export function command(this: GameCommandApp): void {
  this.issueOrder(Order.Work);
}
export function issueOrder(this: GameCommandApp, order: Order): void {
  const ids = controllableIds(this.town, this.chosen);
  if (!ids.length) {
    this.status = selectionControlReason(this.town, this.chosen);
    return;
  }
  this.status = '';
  const personTarget = order === Order.Attack ? this.personAt(this.mouse) : -1;
  const animal = this.animalAtScreen(this.mouse);
  const monster = animal >= 0 ? animal : this.town.monsterAt(this.cursor, f(1.2)),
    tree = this.treeAtScreen(this.mouse),
    rock = this.rockAtScreen(this.mouse),
    id = this.buildingAtScreen(this.mouse),
    place = this.town.building(id),
    moving: number[] = [];
  if (order === Order.Move) this.town.orderMove(ids, this.cursor);
  else if (order === Order.Attack && personTarget >= 0) this.town.orderAttackPerson(ids, personTarget);
  else if (order === Order.Attack && monster < 0 && tree < 0 && rock < 0)
    this.town.orderAttackMove(ids, this.cursor);
  else
    for (const person of ids) {
      const unit = [person];
      let accepted = false;
      if (monster >= 0) accepted = this.town.orderAttack(unit, monster);
      else if (tree >= 0) accepted = this.town.orderChop(unit, tree);
      else if (rock >= 0) accepted = this.town.orderMine(unit, rock);
      else if (place && !isPlayerBuilding(place)) this.status = buildingControlReason(place);
      else if (place && (!place.built() || place.health < 1)) accepted = this.town.orderBuild(unit, id);
      else if (place && isHome(place.kind)) accepted = this.town.orderRest(unit, id);
      else if (place && structureSpec(place.kind).jobs > 0) accepted = this.town.assignJob(unit, id);
      else {
        const road = this.town.roads().road(this.hoveredRoad());
        if (road && (road.built < 1 || road.paving >= 0 || road.wear > 0))
          accepted = this.town.orderRoadwork(unit, road.id);
      }
      if (accepted) {
        const target = this.town.creature(monster);
        if (!target || target.animal === null) this.town.approachOrder(unit, this.cursor);
      } else moving.push(person);
    }
  if (moving.length) this.town.orderMove(moving, place ? place.door() : this.cursor);
  this.cue(Cue.Order);
}
export function queueWork(this: GameCommandApp, activity: Activity, target: number): void {
  const existing = this.workQueue.find((work) => work.activity === activity && work.target === target);
  if (!existing) this.workQueue.push({ activity, target, serial: ++this.workSerial });
  else existing.serial = ++this.workSerial;
  this.dispatchWork(true);
}
export function dispatchWork(this: GameCommandApp, force = false): void {
  if (!force && this.town.clock() >= this.lastDispatch && this.town.clock() - this.lastDispatch < 0.2) return;
  this.lastDispatch = this.town.clock();
  for (let index = 0; index < this.workQueue.length;) {
    const work = this.workQueue[index];
    let where: Point | null = null,
      done = false;
    if (work.activity === Activity.Building) {
      const place = this.town.building(work.target);
      done = !place || !isPlayerBuilding(place) || (place.built() && place.health >= 1);
      if (place) where = place.door();
    } else if (work.activity === Activity.Roadwork) {
      const road = this.town.roads().road(work.target);
      done = !road || !belongsToFaction(road) || (road.built >= 1 && road.paving < 0 && road.wear <= 0);
      where = this.town.roadWorkPosition(work.target);
    } else {
      const map = this.town.map(),
        x = work.target % map.width(),
        y = Math.trunc(work.target / map.width()),
        stone = work.activity === Activity.Mining;
      done =
        work.target < 0 || !map.inside(x, y) || (stone ? !mining.deposit(map, x, y) : !map.at(x, y).trees);
      if (!done) where = stone ? mining.position(x, y) : treePosition(map, x, y, map.at(x, y).trees - 1);
    }
    if (done) {
      this.workQueue.splice(index, 1);
      continue;
    }
    const assigned = this.town
        .people()
        .some(
          (p) =>
            canControl(p) &&
            p.activity !== Activity.Leaving &&
            p.task === work.activity &&
            p.taskSite === work.target,
        ),
      clicked = force && work.serial === this.workSerial,
      candidates: { busy: boolean; gap: number; worker: number }[] = [];
    if (where && !assigned)
      for (const p of this.town.people()) {
        const stopped = this.stoppedWork.get(p.id);
        if (!canControl(p) || p.ordered || (stopped !== undefined && stopped >= work.serial)) continue;
        // A newly queued site must not abandon an unfinished construction job.
        // Explicit commands to selected residents still replace their orders.
        const building = p.task === Activity.Building ? this.town.building(p.taskSite) : null;
        const road = p.task === Activity.Roadwork ? this.town.roads().road(p.taskSite) : null;
        if (
          (building && (!building.built() || building.health < 1)) ||
          (road && (road.built < 1 || road.paving >= 0 || road.wear > 0))
        )
          continue;
        // Finish care and an active delivery before accepting another request.
        // Blocked cargo can accompany construction: prepareConstruction deposits
        // it in the site's material inventory, preserving it even with full storage.
        if (
          p.recoveringRest ||
          p.recoveringHealth ||
          p.activity === Activity.Collecting ||
          p.activity === Activity.Hauling ||
          (p.carrying > 0 &&
            ((work.activity !== Activity.Building && work.activity !== Activity.Roadwork) ||
              this.town.cargoStorage(p.position, p.carriedProduct)))
        )
          continue;
        const idle = !p.moving() && (p.activity === Activity.Idle || p.activity === Activity.Holding);
        // A pending player request outranks routine automatic work, including
        // after a meal or delivery. Admission makes an ordered assignment, so
        // later dispatches cannot repeatedly replace the chosen target.
        if (idle || ((clicked || p.autoMode) && interruptible(p.activity)))
          candidates.push({ busy: !idle, gap: distance(p.position, where), worker: p.id });
      }
    candidates.sort((a, b) => Number(a.busy) - Number(b.busy) || a.gap - b.gap || a.worker - b.worker);
    for (const { worker } of candidates) {
      const started =
        work.activity === Activity.Building
          ? this.town.orderBuild([worker], work.target)
          : work.activity === Activity.Roadwork
            ? this.town.orderRoadwork([worker], work.target)
            : work.activity === Activity.Mining
              ? this.town.orderMine([worker], work.target)
              : this.town.orderChop([worker], work.target);
      if (started) break;
    }
    ++index;
  }
}
export function commandOverlay(this: GameCommandApp): void {
  if (!this.targetingCursor()) return;
  const p = this.mouse,
    color =
      this.pending === Order.Attack
        ? this.theme.danger
        : this.pending === Order.Work
          ? this.theme.success
          : this.theme.accent;
  if (this.pending === Order.Attack) {
    this.context.line(f(p.x - 7), f(p.y - 7), f(p.x + 7), f(p.y + 7), color, f(1.5));
    this.context.line(f(p.x + 7), f(p.y - 7), f(p.x - 7), f(p.y + 7), color, f(1.5));
  } else if (this.pending === Order.Work) {
    this.context.line(f(p.x - 5), f(p.y + 7), f(p.x + 4), f(p.y - 7), color, 2);
    this.context.line(f(p.x + 1), f(p.y - 8), f(p.x + 9), f(p.y - 3), color, 4);
  } else {
    this.context.line(f(p.x - 8), p.y, f(p.x + 8), p.y, color, f(1.5));
    this.context.line(p.x, f(p.y - 8), p.x, f(p.y + 8), color, f(1.5));
  }
  const label = this.pending === Order.Attack ? 'Attack' : this.pending === Order.Work ? 'Work' : 'Move';
  this.context.text(new Rect(f(p.x + 13), f(p.y + 8), 90, 20), label, color, 12, true);
}
