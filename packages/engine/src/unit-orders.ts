// Direct translation of native unit_orders.cpp. Absolute order timers remain double precision.
import { TownState } from './town-state';
import { Building } from './town-models';
import { Activity, Person, Role, Monster } from './person';
import { Product, Resources, Structure, structureSpec, isHome } from './building-catalog';
import { Point, point, add, rotated, distance, segmentDistance } from './geometry';
import { f32 as f } from './numeric';
import { treePosition } from './world-map';
import * as mining from './mining';
export interface OrderTown extends TownState {
  recount(): void;
  staff(): void;
  walkTo(p: Person, to: Point): boolean;
  setOrder(p: Person, task: Activity, site?: number): void;
  arrive(p: Person): void;
  creature(id: number): Monster | null;
  orderHarvest(ids: number[], cell: number, kind: Product): boolean;
  settlementAt(p: Point): number;
  capacity(id?: number): Resources;
  stock(id?: number): Resources;
  cargoStorage(p: Point, product?: Product): Building | null;
  resumeOrder(p: Person): boolean;
  constructionRoad(id: number): number;
  site(id: number): Building | null;
  roadWorkTarget(id: number): number;
  orderBuild(ids: number[], id: number): boolean;
  orderRoadwork(ids: number[], id: number): boolean;
  orderChop(ids: number[], cell: number): boolean;
  orderMine(ids: number[], cell: number): boolean;
  moveOrder(ids: number[], to: Point, attack: boolean): void;
  prepareConstruction(p: Person, work: Activity, id: number): boolean;
  collectConstructionSurplus(p: Person, work: Activity, id: number): boolean;
  storageFoundation(p: Person): boolean;
  haulCargo(p: Person): boolean;
  harvest(p: Person, cell: number, kind: Product): boolean;
  startHarvest(p: Person, around: Point, reach: number, kind?: Product): boolean;
  resourceNearby(around: Point, reach: number, kind: Product): boolean;
  layRoadFirst(p: Person, id: number): boolean;
  constructionTree(p: Person, activity: Activity, target: number): number;
  fellTree(p: Person, cell: number): boolean;
}
export function setOrder(this: OrderTown, p: Person, task: Activity, site = -1): void {
  p.approachingOrder = false;
  p.recoveringRest = false;
  p.supplyTarget = -1;
  p.supplyRoad = false;
  p.task = task;
  p.taskSite = site;
  p.ordered = true;
  p.until = 0;
  p.foe = -1;
  p.tree = -1;
  p.aggressive = true;
  p.target = site;
}
export function orderStop(this: OrderTown, ids: number[]): void {
  for (const p of this.folk) {
    if (p.role !== Role.Resident || p.activity === Activity.Expedition || !ids.includes(p.id)) continue;
    p.approachingOrder = false;
    p.recoveringRest = false;
    p.autoMode = false;
    p.ordered = false;
    p.task = Activity.Idle;
    p.taskSite = -1;
    p.supplyTarget = -1;
    p.supplyRoad = false;
    p.job = -1;
    p.path = [];
    p.tree = p.foe = p.target = -1;
    p.aggressive = false;
    p.activity = Activity.Holding;
    p.until = Infinity;
  }
  this.recount();
  ++this.changes;
}
export function setAuto(this: OrderTown, id: number, enabled: boolean): void {
  for (const p of this.folk) {
    if (p.id !== id || p.role !== Role.Resident || p.activity === Activity.Expedition) continue;
    p.autoMode = enabled;
    p.recoveringRest = false;
    if (enabled || !p.ordered) {
      if (!enabled) p.job = -1;
      p.path = [];
      p.tree = p.foe = p.target = -1;
      p.aggressive = false;
      p.approachingOrder = false;
      p.ordered = false;
      p.task = Activity.Idle;
      p.taskSite = -1;
      p.supplyTarget = -1;
      p.supplyRoad = false;
      p.activity = enabled ? Activity.Idle : Activity.Holding;
      p.until = enabled ? this.time : Infinity;
    }
  }
  this.recount();
  this.staff();
  ++this.changes;
}
export function moveOrder(this: OrderTown, ids: number[], to: Point, attack: boolean): void {
  let k = 0;
  for (const p of this.folk) {
    if (p.role !== Role.Resident || p.activity === Activity.Expedition || !ids.includes(p.id)) continue;
    const spot = k
      ? add(to, rotated(point(f(f(0.6) + f(f(0.25) * Math.trunc(k / 6))), 0), f(k * f(1.047))))
      : to;
    ++k;
    if (!this.walkTo(p, this.grid.nearestWalkable(spot))) continue;
    this.setOrder(p, Activity.Moving);
    p.aggressive = attack;
    p.goal = { ...(p.path.length ? p.path[p.path.length - 1] : p.position) };
    p.activity = Activity.Moving;
    if (!p.moving()) this.arrive(p);
  }
}
export function approachOrder(this: OrderTown, ids: number[], to: Point): void {
  for (const p of this.folk) {
    if (!p.ordered || p.task === Activity.Idle || p.task === Activity.Moving || !ids.includes(p.id)) continue;
    if (!this.walkTo(p, this.grid.nearestWalkable(to))) continue;
    p.approachingOrder = true;
    p.activity = Activity.Moving;
    p.foe = -1;
    if (!p.moving()) this.arrive(p);
  }
}
export function orderMove(this: OrderTown, ids: number[], to: Point): void {
  this.moveOrder(ids, to, false);
}
export function orderAttackMove(this: OrderTown, ids: number[], to: Point): void {
  this.moveOrder(ids, to, true);
}
export function orderAttack(this: OrderTown, ids: number[], monster: number): boolean {
  const target = this.creature(monster);
  if (!target || target.health <= 0 || target.insideLair) return false;
  let any = false;
  for (const p of this.folk) {
    if (p.activity === Activity.Expedition || !ids.includes(p.id)) continue;
    this.setOrder(p, Activity.Fighting, monster);
    p.foe = monster;
    p.activity = Activity.Fighting;
    p.path = [];
    any = true;
  }
  return any;
}
export function orderChop(this: OrderTown, ids: number[], cell: number): boolean {
  return this.orderHarvest(ids, cell, Product.Wood);
}
export function orderMine(this: OrderTown, ids: number[], cell: number): boolean {
  return this.orderHarvest(ids, cell, Product.Stone);
}
export function orderHarvest(this: OrderTown, ids: number[], cell: number, kind: Product): boolean {
  if (cell < 0 || cell >= this.world.width() * this.world.height()) return false;
  const x = cell % this.world.width(),
    y = Math.trunc(cell / this.world.width()),
    stone = kind === Product.Stone;
  if (stone ? !mining.deposit(this.world, x, y) : !this.world.at(x, y).trees) return false;
  const village = this.settlementAt(point(f(x + f(0.5)), f(y + f(0.5)))),
    room = this.capacity(village),
    treasury = this.stock(village);
  if (village >= 0 && (stone ? treasury.stone >= room.stone : treasury.wood >= room.wood)) return false;
  const foot = stone ? mining.position(x, y) : treePosition(this.world, x, y, this.world.at(x, y).trees - 1);
  if (!this.world.revealed(foot)) return false;
  let any = false;
  for (const p of this.folk) {
    if (p.role !== Role.Resident || p.activity === Activity.Expedition || !ids.includes(p.id)) continue;
    if (
      this.folk.some(
        (other) =>
          other.id !== p.id &&
          other.tree === cell &&
          (other.activity === Activity.Felling || other.activity === Activity.Mining),
      )
    )
      continue;
    if (!this.walkTo(p, this.grid.nearestWalkable(add(foot, point(-0.18, 0.18))))) continue;
    this.setOrder(p, stone ? Activity.Mining : Activity.Felling, cell);
    p.goal = foot;
    p.path = [];
    this.resumeOrder(p);
    any = true;
  }
  return any;
}
export function orderBuild(this: OrderTown, ids: number[], id: number): boolean {
  const place = this.building(id);
  if (!place || (place.built() && place.health >= 1)) return false;
  let any = false;
  for (const p of this.folk) {
    if (p.role !== Role.Resident || p.activity === Activity.Expedition || !ids.includes(p.id)) continue;
    if (!this.walkTo(p, place.door())) continue;
    this.setOrder(p, Activity.Building, id);
    any = true;
    p.path = [];
    this.resumeOrder(p);
  }
  return any;
}
export function assignJob(this: OrderTown, ids: number[], id: number): boolean {
  const place = this.site(id);
  if (!place || !place.built() || structureSpec(place.kind).jobs === 0) return false;
  let any = false;
  for (const p of this.folk) {
    if (
      p.role !== Role.Resident ||
      p.activity === Activity.Expedition ||
      p.health <= 0 ||
      !ids.includes(p.id)
    )
      continue;
    this.recount();
    if (p.job !== id && place.workers >= structureSpec(place.kind).jobs) break;
    p.job = id;
    this.setOrder(p, Activity.Working, id);
    p.path = [];
    p.activity = Activity.Idle;
    p.until = this.time;
    any = true;
  }
  this.recount();
  if (any) ++this.changes;
  return any;
}
export function orderRoadwork(this: OrderTown, ids: number[], id: number): boolean {
  const wanted = this.network.road(id),
    road = this.network.road(this.roadWorkTarget(id));
  if (!wanted || !road || (wanted.built >= 1 && wanted.paving < 0 && wanted.wear <= 0)) return false;
  let any = false;
  for (const p of this.folk) {
    if (p.role !== Role.Resident || p.activity === Activity.Expedition || !ids.includes(p.id)) continue;
    if (!this.walkTo(p, road.workPoint())) continue;
    this.setOrder(p, Activity.Roadwork, id);
    p.activity = Activity.Roadwork;
    p.target = road.id;
    any = true;
  }
  return any;
}
export function orderWorkNear(this: OrderTown, ids: number[], at: Point): boolean {
  const reach = 4;
  let site: Building | null = null;
  for (const item of this.placed)
    if (
      (!item.built() || item.health < 1) &&
      item.footprint().contains(at, reach) &&
      (!site || distance(item.center, at) < distance(site.center, at))
    )
      site = item;
  if (site && this.orderBuild(ids, site.id)) return true;
  let lane: ReturnType<TownState['network']['road']> = null,
    laneGap = reach;
  for (const road of this.network.roads()) {
    if (road.built >= 1 && road.paving < 0 && road.wear <= 0) continue;
    for (let i = 1; i < road.line.length; ++i) {
      const gap = segmentDistance(at, road.line[i - 1], road.line[i]);
      if (gap < laneGap) {
        laneGap = gap;
        lane = road;
      }
    }
  }
  if (lane && this.orderRoadwork(ids, lane.id)) return true;
  let cell = -1,
    stone = false,
    nearest = reach;
  for (
    let y = Math.max(0, Math.trunc(f(at.y - reach)));
    y <= Math.min(this.world.height() - 1, Math.trunc(f(at.y + reach)));
    ++y
  )
    for (
      let x = Math.max(0, Math.trunc(f(at.x - reach)));
      x <= Math.min(this.world.width() - 1, Math.trunc(f(at.x + reach)));
      ++x
    ) {
      if (this.world.at(x, y).trees) {
        const foot = treePosition(this.world, x, y, this.world.at(x, y).trees - 1),
          gap = distance(foot, at);
        if (gap < nearest && this.world.revealed(foot)) {
          nearest = gap;
          cell = y * this.world.width() + x;
          stone = false;
        }
      }
      if (mining.deposit(this.world, x, y)) {
        const foot = mining.position(x, y),
          gap = distance(foot, at);
        if (gap < nearest && this.world.revealed(foot)) {
          nearest = gap;
          cell = y * this.world.width() + x;
          stone = true;
        }
      }
    }
  return cell >= 0 && (stone ? this.orderMine(ids, cell) : this.orderChop(ids, cell));
}
export function orderRelax(this: OrderTown, ids: number[], id: number): boolean {
  const place = this.building(id);
  if (!place || !place.built() || place.kind !== Structure.Tavern) return false;
  let any = false;
  for (const p of this.folk) {
    if (p.role !== Role.Resident || !ids.includes(p.id)) continue;
    if (!this.walkTo(p, place.door())) continue;
    this.setOrder(p, Activity.Idle, id);
    p.activity = Activity.Relaxing;
    any = true;
  }
  return any;
}
export function resumeOrder(this: OrderTown, p: Person): boolean {
  if (p.task === Activity.Idle) return false;
  const wait = (): void => {
    p.activity = Activity.Holding;
    p.path = [];
    p.until = this.time + 1;
  };
  if (p.task === Activity.Moving || p.task === Activity.Holding) {
    if (distance(p.position, p.goal) > f(0.2)) {
      if (!this.walkTo(p, p.goal)) wait();
      else {
        p.activity = Activity.Moving;
        p.target = -1;
        if (!p.moving()) this.arrive(p);
      }
    } else {
      p.task = Activity.Idle;
      p.taskSite = -1;
      p.ordered = false;
      p.aggressive = false;
      wait();
      p.until = this.time + 2;
    }
    return true;
  }
  const foe = this.creature(p.taskSite);
  if (p.task === Activity.Fighting && foe && foe.health > 0 && !foe.insideLair) {
    p.foe = p.taskSite;
    p.activity = Activity.Fighting;
    return true;
  }
  const construction = p.task === Activity.Building || p.task === Activity.Roadwork;
  if (p.carrying > 0 && !construction) {
    if (!this.haulCargo(p)) {
      wait();
      p.until = this.time + 3;
    }
    return true;
  }
  const start = (activity: Activity, target: number, at: Point): void => {
    if (!this.walkTo(p, at)) {
      wait();
      return;
    }
    p.activity = activity;
    p.target = target;
    if (!p.moving()) this.arrive(p);
  };
  switch (p.task) {
    case Activity.Sleeping: {
      const home = this.building(p.taskSite);
      if (home && home.built() && isHome(home.kind) && p.home === home.id) {
        start(Activity.Sleeping, home.id, home.door());
        return true;
      }
      break;
    }
    case Activity.Felling:
    case Activity.Mining: {
      const stone = p.task === Activity.Mining,
        product = stone ? Product.Stone : Product.Wood,
        x = p.taskSite % this.world.width(),
        y = Math.trunc(p.taskSite / this.world.width()),
        exists =
          p.taskSite >= 0 &&
          this.world.inside(x, y) &&
          (stone ? mining.deposit(this.world, x, y) : this.world.at(x, y).trees > 0);
      if (exists && this.harvest(p, p.taskSite, product)) return true;
      if (p.ordered || !p.autoMode) {
        if (exists) {
          wait();
          return true;
        }
        break;
      }
      if (this.startHarvest(p, p.goal, f(3.5), product)) return true;
      if (this.resourceNearby(p.goal, f(3.5), product)) {
        wait();
        return true;
      }
      break;
    }
    case Activity.Building: {
      const place = this.site(p.taskSite);
      if (place && (!place.built() || place.health < 1)) {
        if (p.carrying && this.prepareConstruction(p, Activity.Building, place.id)) return true;
        const tree = this.constructionTree(p, Activity.Building, place.id);
        if (tree >= 0) {
          if (!this.fellTree(p, tree)) wait();
          return true;
        }
        if (!place.built() && this.prepareConstruction(p, Activity.Building, place.id)) return true;
        start(Activity.Building, place.id, place.door());
        return true;
      }
      if (p.carrying && this.haulCargo(p)) return true;
      if (!p.carrying && this.collectConstructionSurplus(p, Activity.Building, p.taskSite)) return true;
      break;
    }
    case Activity.Roadwork: {
      const wanted = this.network.road(p.taskSite);
      if (wanted && (wanted.built < 1 || wanted.paving >= 0 || wanted.wear > 0)) {
        const road = this.network.road(this.roadWorkTarget(p.taskSite));
        if (road) {
          if (p.carrying && this.prepareConstruction(p, Activity.Roadwork, road.id)) return true;
          const tree = this.constructionTree(p, Activity.Roadwork, road.id);
          if (tree >= 0) {
            if (!this.fellTree(p, tree)) wait();
          } else if (!this.prepareConstruction(p, Activity.Roadwork, road.id))
            start(Activity.Roadwork, road.id, road.workPoint());
        } else wait();
        return true;
      }
      if (p.carrying && this.haulCargo(p)) return true;
      if (!p.carrying && this.collectConstructionSurplus(p, Activity.Roadwork, p.taskSite)) return true;
      break;
    }
    case Activity.Working: {
      const place = this.site(p.taskSite);
      if (place && place.built() && p.job === place.id) {
        start(Activity.Working, place.id, place.door());
        return true;
      }
      break;
    }
    case Activity.Fighting: {
      const target = this.creature(p.taskSite);
      if (target && target.health > 0 && !target.insideLair) {
        p.foe = p.taskSite;
        p.activity = Activity.Fighting;
        return true;
      }
      break;
    }
    default:
      break;
  }
  p.task = Activity.Idle;
  p.taskSite = -1;
  p.ordered = false;
  p.aggressive = false;
  wait();
  return true;
}
