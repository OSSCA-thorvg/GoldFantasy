import { DungeonKind } from '../../../../packages/engine/src/world-types';
// Direct translation of native game_commands.cpp.
import type { GameInputApp } from './game-input';
import { Tool, Order } from '../../../../packages/engine/src/game-tools';
import { type Point, point, distance, centroid } from '../../../../packages/engine/src/geometry';
import { f32 as f } from '../../../../packages/engine/src/numeric';
import { Activity, type Person } from '../../../../packages/engine/src/person';
import { isHome, structureSpec, Structure } from '../../../../packages/engine/src/building-catalog';
import type { Building } from '../../../../packages/engine/src/town-models';
import { TownState } from '../../../../packages/engine/src/town-state';
import { treePosition } from '../../../../packages/engine/src/world-map';
import * as mining from '../../../../packages/engine/src/mining';
import { cachedWorldHit } from './world-targets';
import { isCraftStation } from '../../../../packages/engine/src/equipment';
import { openStation } from './craft-station-hud';
import {
  canControl,
  isPlayerBuilding,
  buildingControlReason,
  belongsToFaction,
  isPlayerResident,
} from '../../../../packages/engine/src/faction';
import { controllableIds, selectionControlReason } from './game-control';
import { Cue } from '../../../../packages/native-audio/src/sound-types';
import { Rect } from '../../../../packages/native-ui/src';
import {
  automaticConstructionAllowed,
  registerAutomaticConstruction,
} from '../../../../packages/engine/src/automatic-work';
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
// These compatibility helpers inspect the same frontmost presented hit. They
// must never search behind a different object or revive a rejected broad hit.
export function treeAtScreen(this: GameCommandApp, screen: Point): number {
  const hit = cachedWorldHit(this, screen);
  return hit?.kind === 'tree' ? hit.id : -1;
}
export function rockAtScreen(this: GameCommandApp, screen: Point): number {
  const hit = cachedWorldHit(this, screen);
  return hit?.kind === 'rock' ? hit.id : -1;
}
export function buildingAtScreen(this: GameCommandApp, screen: Point): number {
  const hit = cachedWorldHit(this, screen);
  return hit?.kind === 'building' ? hit.id : -1;
}
export function animalAtScreen(this: GameCommandApp, screen: Point): number {
  const hit = cachedWorldHit(this, screen);
  return hit?.kind === 'animal' ? hit.id : -1;
}
/** The downed resident of the player lying under the cursor, if any. */
export function downedUnderCursor(app: GameCommandApp): Person | null {
  if (app.mouse.x < 0 || app.context.controlAt(app.mouse.x, app.mouse.y)) return null;
  let best: Person | null = null,
    gap = Infinity;
  for (const p of app.town.downedResidents()) {
    const at = app.toScreen(p.position),
      tile = distance(at, app.toScreen(point(f(p.position.x + 1), p.position.y))),
      d = distance(at, app.mouse);
    if (d <= Math.max(18, f(tile * 0.8)) && d < gap) {
      best = p;
      gap = d;
    }
  }
  return best;
}
function tendRefusal(app: GameCommandApp, ids: readonly number[], hurt: Person): string {
  const side = app.town.inRealm(hurt.position),
    near = ids.filter((id) => {
      const p = app.town.person(id);
      return p && p.id !== hurt.id && app.town.inRealm(p.position) === side;
    });
  if (!near.length) return `${hurt.name} lies on the other side of the gate`;
  return `No path to ${hurt.name}`;
}
function farmOfField(app: GameCommandApp, id: number): Building | null {
  const field = app.town.field(id);
  if (!field) return null;
  const middle = centroid(field.outline);
  return (
    app.town
      .buildings()
      .filter(
        (b) =>
          b.kind === Structure.Farm &&
          b.built() &&
          isPlayerBuilding(b) &&
          distance(b.center, middle) <= TownState.farmReach,
      )
      .sort((a, b) => distance(a.center, middle) - distance(b.center, middle) || a.id - b.id)[0] ?? null
  );
}
export function prepare(this: GameCommandApp, order: Order): void {
  if (!this.chosen.length) {
    if (this.selectedAnimal >= 0 && order === Order.Attack) {
      // Attack on a selected animal sends whoever is nearest and free; with nobody free it does nothing.
      const animal = this.town.creature(this.selectedAnimal),
        candidates: { busy: boolean; distance: number; id: number }[] = [];
      if (animal && animal.animal !== null && animal.health > 0)
        for (const p of this.town.people()) {
          if (!canControl(p) || p.inside || p.ordered || !interruptible(p.activity)) continue;
          const idle = !p.moving() && (p.activity === Activity.Idle || p.activity === Activity.Holding);
          candidates.push({ busy: !idle, distance: distance(p.position, animal.position), id: p.id });
        }
      candidates.sort((a, b) => Number(a.busy) - Number(b.busy) || a.distance - b.distance || a.id - b.id);
      if (candidates.some((candidate) => this.town.orderAttack([candidate.id], this.selectedAnimal)))
        this.cue(Cue.Order);
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
  // Resolve once. Selection, hover and every command see the same top drawn object.
  const hit = cachedWorldHit(this),
    personTarget = hit?.kind === 'person' ? this.town.person(hit.id) : null,
    creature =
      hit?.kind === 'animal' || hit?.kind === 'monster' ? this.town.creature(hit.id) : null,
    place = hit?.kind === 'building' ? this.town.building(hit.id) : null,
    // A downed body is not pickable, so it is found by distance on screen.
    fallen = order === Order.Work && !personTarget && !creature ? downedUnderCursor(this) : null,
    moving: number[] = [];
  if (order === Order.Move) this.town.orderMove(ids, this.cursor);
  else if (fallen) {
    // Re-ordering an ally already kneeling there would restart their tending without end.
    const kneeling = (id: number) => {
        const p = this.town.person(id);
        return p?.activity === Activity.Tending && p.taskSite === fallen.id;
      },
      sent = ids.filter((id) => !kneeling(id));
    if ((!sent.length || !this.town.orderTend(sent, fallen.id)) && sent.length === ids.length) {
      this.status = tendRefusal(this, ids, fallen);
      return;
    }
  } else if (order === Order.Work && hit?.kind === 'field') {
    const farm = farmOfField(this, hit.id);
    if (!farm) {
      this.status = 'No farm stands close enough to work this field';
      this.town.orderMove(ids, this.cursor);
    } else if (this.town.assignJob(ids, farm.id)) {
      this.town.approachOrder(ids, this.cursor);
      const left = ids.filter((id) => this.town.person(id)?.job !== farm.id);
      if (left.length) this.town.orderMove(left, this.cursor);
    } else {
      this.status = 'The farm by this field has no room for more workers';
      this.town.orderMove(ids, this.cursor);
    }
  } else if (personTarget) {
    // Companions are never attacked: an Attack click on one is an attack-move to where they stand.
    if (order === Order.Attack && isPlayerResident(personTarget)) this.town.orderAttackMove(ids, this.cursor);
    else if (order === Order.Attack) this.town.orderAttackPerson(ids, personTarget.id);
    else this.town.orderMove(ids, personTarget.position);
  } else if (order === Order.Work && hit?.kind === 'dungeon') {
    if (this.town.map().dungeons()[hit.id]?.kind === DungeonKind.Return) {
      // Walking up to the way home gathers the party; leaving is the explicit Go home.
      const plan = this.town.realmPlan();
      if (plan) this.town.orderMove(ids, plan.entry);
      return;
    }
    const floor = Math.min(this.gateFloor.get(hit.id) ?? Infinity, this.town.deepestOpenFloor(hit.id));
    if (!this.town.sendExpedition(ids, hit.id, floor)) {
      const problem = this.town.expeditionProblem(hit.id, floor);
      if (problem) this.status = problem;
      this.town.orderMove(ids, this.cursor);
    }
  } else if (order === Order.Work && place && isPlayerBuilding(place) && place.built() && isCraftStation(place.kind)) {
    // A crafting station opens its recipes with the first selected resident as crafter; nothing starts by itself.
    openStation(this, place, ids[0]);
    return;
  } else if (order === Order.Attack && !creature && hit?.kind !== 'tree' && hit?.kind !== 'rock') {
    this.town.orderAttackMove(ids, this.cursor);
  } else {
    for (const id of ids) {
      const unit = [id];
      let accepted = false;
      if (creature && (creature.animal === null || order === Order.Attack || creature.angry))
        accepted = this.town.orderAttack(unit, creature.id);
      else if (hit?.kind === 'tree') accepted = this.town.orderChop(unit, hit.id);
      else if (hit?.kind === 'rock') accepted = this.town.orderMine(unit, hit.id);
      else if (place && !isPlayerBuilding(place)) this.status = buildingControlReason(place);
      else if (place && (!place.built() || place.health < 1))
        accepted = this.town.orderBuild(unit, place.id);
      else if (place && isHome(place.kind)) accepted = this.town.orderRest(unit, place.id);
      else if (place && structureSpec(place.kind).jobs > 0) accepted = this.town.assignJob(unit, place.id);
      else if (hit?.kind === 'road') {
        const road = this.town.roads().road(hit.id);
        if (road && (road.built < 1 || road.paving >= 0 || road.wear > 0))
          accepted = this.town.orderRoadwork(unit, hit.id);
      }
      if (accepted) {
        if (!creature || creature.animal === null) this.town.approachOrder(unit, this.cursor);
      } else moving.push(id);
    }
    if (moving.length) this.town.orderMove(moving, place ? place.door() : this.cursor);
  }
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
        if (
          (work.activity === Activity.Building || work.activity === Activity.Roadwork) &&
          !automaticConstructionAllowed(this.town, p, work.activity, work.target)
        )
          continue;
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
      if (started) {
        const p = this.town.person(worker);
        if (p && (work.activity === Activity.Building || work.activity === Activity.Roadwork))
          registerAutomaticConstruction(this.town, p, work.activity, work.target);
        break;
      }
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
