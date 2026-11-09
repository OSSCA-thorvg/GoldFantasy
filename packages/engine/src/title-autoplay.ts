import { nativeSort } from './native-sort';
import { nativeRandomRadial } from './native-random-order';
// Translated from src/game/title_autoplay.cpp; invoked only on disposable title worlds.
import { TownState } from './town-state';
import { titleAutoplayRate } from './work-timing';
import { Building, type Check, type Forecast, type Placement } from './town-models';
import { Resources, Product, Structure, structureSpec, isLodging } from './building-catalog';
import { Activity, Role, Calling, type Person } from './person';
import { Sky, Weather } from './climate';
import {
  Footprint,
  closestOnSegment,
  add,
  distance,
  normalized,
  point,
  rotated,
  scale,
  sub,
  type Point,
  type Outline,
} from './geometry';
import { hash01, f32 as f } from './numeric';
import { sharpAnchor, type RoadPath } from './road-network';
import { treePosition } from './world-map';
import * as mining from './mining';
import type { HireOffer } from './town-hiring';
export interface TitleTown extends TownState {
  prepareTitlePreview(): void;
  site(id: number): Building | null;
  recount(): void;
  staff(): void;
  settle(id: number): boolean;
  recruitmentOffers(): HireOffer[];
  hireGuest(key: string): boolean;
  walkTo(p: Person, to: Point): boolean;
  roadAccess(footprint: Footprint): boolean;
  maintainTitleBuilder(): void;
  seekTitleMaterials(p: Person, product: Product): boolean;
  advance(seconds: number): void;
  stock(): Resources;
  camp(): Building | null;
  population(): number;
  guests(): number;
  housing(): number;
  assignJob(ids: number[], building: number): boolean;
  orderBuild(ids: number[], building: number): boolean;
  orderRoadwork(ids: number[], road: number): boolean;
  canBuildRoad(path: RoadPath): Check;
  buildRoad(path: RoadPath): boolean;
  canPlace(kind: Structure, center: Point, angle: number): Check;
  place(kind: Structure, center: Point, angle: number): boolean;
  orderMove(ids: number[], point: Point): void;
  fieldAcres(): number;
  canPlantField(outline: Outline): Check;
  plantField(outline: Outline): boolean;
  forecast(): Forecast;
  canPave(id: number): Check;
  pave(id: number): boolean;
  orderChop(ids: number[], cell: number): boolean;
  orderMine(ids: number[], cell: number): boolean;
  fit(kind: Structure, point: Point, angle: number): Placement;
}
export function seekTitleMaterials(this: TitleTown, p: Person, product: Product): boolean {
  if (product !== Product.Wood && product !== Product.Stone) return false;
  const deposits: Point[] = [];
  for (let y = 0; y < this.world.height(); ++y)
    for (let x = 0; x < this.world.width(); ++x) {
      const stone = product === Product.Stone;
      if (stone ? !mining.deposit(this.world, x, y) : !this.world.at(x, y).trees) continue;
      const foot = stone
        ? mining.position(x, y)
        : treePosition(this.world, x, y, this.world.at(x, y).trees - 1);
      if (!this.world.revealed(foot)) deposits.push(foot);
    }
  nativeSort(deposits, (a, b) => distance(p.position, a) < distance(p.position, b));
  for (const foot of deposits) {
    const approach = this.grid.nearestWalkable(add(foot, point(-0.18, 0.18)));
    if (distance(approach, foot) > f(0.8) || !this.walkTo(p, approach)) continue;
    p.activity = Activity.Moving;
    p.target = -1;
    p.until = this.time;
    return true;
  }
  return false;
}
export function maintainTitleBuilder(this: TitleTown): void {
  const current = this.person(this.titleBuilder);
  if (!current || current.health <= 0 || current.activity === Activity.Leaving) {
    this.titleBuilder = -1;
    for (const p of this.folk)
      if (p.role === Role.Resident && p.health > 0 && p.activity !== Activity.Leaving) {
        this.titleBuilder = p.id;
        this.titlePlanTimer = 0;
        this.titleFoodUntil = -1;
        break;
      }
  }
  for (const p of this.folk)
    if (p.id === this.titleBuilder) {
      const farm = this.site(p.job),
        helping = !!farm && farm.kind === Structure.Farm;
      const alone = this.population() === 1 && this.placed.some((b) => isLodging(b.kind) && b.built());
      if (helping && (this.time < this.titleFoodUntil || alone)) break;
      if (p.job >= 0) {
        p.job = -1;
        this.recount();
        if (helping && this.titleFoodUntil >= 0)
          this.titleFoodUntil = this.time + TownState.secondsPerDay * 2;
      }
      if (
        (alone ||
          (this.time >= this.titleFoodUntil &&
            p.health < f(0.7) &&
            this.stock().food < this.population() * 2)) &&
        !p.carrying
      )
        for (const b of this.placed)
          if (b.kind === Structure.Farm && b.built() && b.workers < structureSpec(b.kind).jobs) {
            if (this.assignJob([p.id], b.id)) {
              this.titleFoodUntil = this.time + TownState.secondsPerDay;
              p.ordered = false;
            }
            break;
          }
      break;
    }
}
export function startTitleAutoplay(this: TitleTown, seed: number): void {
  seed >>>= 0;
  this.prepareTitlePreview();
  this.titleAutoplay = true;
  this.dice = (this.dice ^ (seed || 0x9e3779b9)) >>> 0;
  const climate = this.sky.now();
  this.sky = new Sky(seed);
  this.sky.force(climate.weather, climate.intensity);
  this.titlePlanTimer = 0;
  this.titleWeatherTimer = f(60 + f(this.roll() * 100));
  for (const p of this.folk) {
    p.autoMode = true;
    p.until = this.time;
    if (p.health > 0) p.activity = Activity.Idle;
  }
  this.titleBuilder = -1;
  this.titleFoodUntil = -1;
  this.maintainTitleBuilder();
}
export function advanceTitleAutoplay(this: TitleTown, seconds: number): void {
  if (!this.titleAutoplay || !Number.isFinite(seconds) || seconds <= 0) return;
  this.maintainTitleBuilder();
  seconds = Math.min(seconds, 0.25) * titleAutoplayRate;
  this.titlePlanTimer -= seconds;
  this.titleWeatherTimer -= seconds;
  if (this.titleWeatherTimer <= 0) {
    const choices = [Weather.Clear, Weather.Cloudy, Weather.Rain, Weather.Storm];
    let weather = choices[Math.min(3, Math.trunc(f(this.roll() * 4)))];
    if (weather === this.sky.now().weather)
      weather = weather === Weather.Clear ? Weather.Rain : Weather.Clear;
    this.sky.force(weather, weather === Weather.Clear ? 0 : f(f(0.35) + f(this.roll() * f(0.55))));
    this.titleWeatherTimer = f(90 + f(this.roll() * 150));
  }
  if (this.titlePlanTimer <= 0) {
    planTitleWork.call(this);
    this.titlePlanTimer = f(6 + f(this.roll() * 6));
    for (const p of this.folk)
      if (p.role === Role.Resident && p.task !== Activity.Moving && p.task !== Activity.Fighting)
        p.ordered = false;
  }
  this.advance(seconds);
}
export function planTitleWork(this: TitleTown): void {
  let workforceNeeded = 1;
  for (const building of this.placed)
    if (building.built() || this.grid.walkable(building.door()))
      workforceNeeded += structureSpec(building.kind).jobs;
  workforceNeeded = Math.max(workforceNeeded, 4);
  const completed = (kind: Structure): boolean => this.placed.some((b) => b.kind === kind && b.built());
  const basicsReady = completed(Structure.Farm) && completed(Structure.Well);
  if (basicsReady && this.population() < workforceNeeded && this.population() < this.housing()) {
    const offer = this.recruitmentOffers().find(
      (item) => item.person.calling === Calling.Settler || item.person.calling === Calling.Traveller,
    );
    if (offer && this.hireGuest(offer.key)) this.staff();
  }
  const treasury = this.stock();
  const essential = (p: Person): boolean => {
    if (p.id === this.titleBuilder) {
      const job = this.building(p.job);
      return !!job && job.kind === Structure.Farm;
    }
    const job = this.building(p.job);
    if (!job || !job.built()) return false;
    const product = structureSpec(job.kind).product;
    return (
      (product === Product.Food && treasury.food < this.population() * 8) ||
      (product === Product.Water && treasury.water < this.population() * 5) ||
      (product === Product.Goods && treasury.gold < 80) ||
      (product === Product.Planks && treasury.planks < 16) ||
      (product === Product.CutStone && treasury.cutStone < 16)
    );
  };
  let pendingWork =
    this.placed.some((b) => !b.built()) || this.network.roads().some((r) => r.built < 1 || r.paving >= 0);
  for (const kind of [Structure.Farm, Structure.Well])
    pendingWork ||= !this.placed.some((b) => b.kind === kind && b.built());
  for (const product of [Product.Food, Product.Water, Product.Goods, Product.Planks, Product.CutStone]) {
    if (
      (product === Product.Food && treasury.food >= this.population() * 8) ||
      (product === Product.Water && treasury.water >= this.population() * 5) ||
      (product === Product.Goods && treasury.gold >= 80) ||
      (product === Product.Planks && treasury.planks >= 16) ||
      (product === Product.CutStone && treasury.cutStone >= 16)
    )
      continue;
    for (const b of this.placed) {
      if (!b.built() || structureSpec(b.kind).product !== product) continue;
      let desired = product === Product.Food ? Math.max(1, Math.trunc((this.population() * 3 + 3) / 4)) : 1;
      desired = Math.min(desired, structureSpec(b.kind).jobs);
      while (b.workers < desired) {
        const reserved = this.folk.filter((p) => p.role === Role.Resident && essential(p)).length;
        if (this.population() - reserved <= (pendingWork ? 1 : 0)) break;
        const donor = this.folk.find(
          (p) =>
            p.id !== this.titleBuilder &&
            p.role === Role.Resident &&
            p.health > 0 &&
            !essential(p) &&
            p.activity !== Activity.Expedition &&
            p.activity !== Activity.Leaving &&
            p.task !== Activity.Building &&
            p.task !== Activity.Roadwork,
        );
        if (!donor || !this.assignJob([donor.id], b.id)) break;
      }
    }
  }
  const available: number[] = [];
  for (const p of this.folk)
    if (
      p.role === Role.Resident &&
      p.health > 0 &&
      !essential(p) &&
      p.task === Activity.Idle &&
      p.activity !== Activity.Expedition &&
      p.activity !== Activity.Leaving &&
      p.activity !== Activity.Sleeping &&
      p.activity !== Activity.Eating
    )
      available.push(p.id);
  if (!available.length)
    for (const p of this.folk)
      if (
        p.role === Role.Resident &&
        p.health > 0 &&
        !essential(p) &&
        (p.task === Activity.Working || p.task === Activity.Felling || p.task === Activity.Mining) &&
        p.activity !== Activity.Sleeping &&
        p.activity !== Activity.Eating
      )
        available.push(p.id);
  if (!available.length) return;
  const worker = available.includes(this.titleBuilder) ? this.titleBuilder : available[0];
  const origin = this.camp()?.center ?? this.person(worker)!.position;
  for (const road of this.network.roads())
    if (road.built < 1 || road.paving >= 0 || road.wear > 0) {
      if (this.folk.some((p) => p.task === Activity.Roadwork && p.taskSite === road.id)) return;
      for (const builder of available) if (this.orderRoadwork([builder], road.id)) return;
    }
  for (const b of this.placed)
    if (!b.built()) {
      if (this.folk.some((p) => p.task === Activity.Building && p.taskSite === b.id)) return;
      for (const builder of available) if (this.orderBuild([builder], b.id)) return;
    }
  const reachableSite = (kind: Structure, center: Point, angle: number): boolean => {
    const draft = new Building(
      0,
      kind,
      center,
      angle,
      Math.trunc(
        f(hash01(this.world.seed(), Math.trunc(f(center.x * 8)), Math.trunc(f(center.y * 8)), 41) * f(1e6)),
      ) >>> 0,
    );
    if (kind === Structure.Chapel) draft.variant = (draft.variant & ~3) >>> 0;
    if (!this.grid.walkable(draft.door())) return false;
    for (const builder of available) {
      const p = this.person(builder)!;
      const from = p.inside || p.crossingDoorway() ? p.entrance : p.position;
      if (this.grid.path(from, draft.door()).length) return true;
    }
    return false;
  };
  const roadToResource = (resource: Point, builder: number): boolean => {
    const closest = this.network.distance(resource),
      gap = closest.distance;
    let join = closest.onRoad ?? point();
    if (!this.network.empty() && gap <= f(1.2)) return false;
    if (this.network.empty()) join = add(origin, scale(normalized(sub(resource, origin)), f(1.3)));
    let end = this.grid.nearestWalkable(add(resource, point(-0.3, 0.3)));
    const length = distance(join, end);
    if (length < 1) return false;
    if (length > f(TownState.maxRoadLength * f(0.8)))
      end = add(join, scale(normalized(sub(end, join)), f(TownState.maxRoadLength * f(0.8))));
    const path = [sharpAnchor(join), sharpAnchor(end)],
      check = this.canBuildRoad(path),
      budget = check.cost.clone();
    if (treasury.food < this.population() * 6 || treasury.water < this.population() * 3) return false;
    if (!check.ok || !treasury.covers(budget)) return false;
    if (!this.buildRoad(path)) return false;
    this.orderRoadwork([builder], this.network.roads().at(-1)!.id);
    return true;
  };
  if (this.camp()?.built())
    for (const p of this.folk) {
      if ((p.task !== Activity.Felling && p.task !== Activity.Mining) || p.tree < 0) continue;
      const x = p.tree % this.world.width(),
        y = Math.trunc(p.tree / this.world.width());
      const resource =
        p.activity === Activity.Mining
          ? mining.position(x, y)
          : treePosition(this.world, x, y, Math.max(0, this.world.at(x, y).trees - 1));
      if (roadToResource(resource, p.id)) return;
    }
  if (!this.camp()) {
    for (let attempt = 0; attempt < 90; ++attempt) {
      const at = add(
        origin,
        nativeRandomRadial(() => this.roll(), 0, 10, 6.283185),
      );
      if (
        this.canPlace(Structure.Camp, at, 0).ok &&
        reachableSite(Structure.Camp, at, 0) &&
        this.place(Structure.Camp, at, 0)
      ) {
        this.orderBuild([worker], this.placed.at(-1)!.id);
        return;
      }
    }
    let explore = add(
      origin,
      nativeRandomRadial(() => this.roll(), 6, 7, 6.283185),
    );
    for (const dungeon of this.world.dungeons())
      if (dungeon.discovered) {
        explore = point(f(dungeon.origin.x + 1), f(dungeon.origin.y + 3));
        break;
      }
    this.orderMove([worker], explore);
    return;
  }
  if (this.network.empty())
    for (let attempt = 0; attempt < 24; ++attempt) {
      const angle = f(this.roll() * f(6.283185));
      const road = [
        sharpAnchor(add(origin, rotated(point(1.3, 0), angle))),
        sharpAnchor(add(origin, rotated(point(5, 0), angle))),
      ];
      if (this.canBuildRoad(road).ok && this.buildRoad(road)) {
        this.orderRoadwork([worker], this.network.roads().at(-1)!.id);
        return;
      }
    }
  if (this.fieldAcres() < this.population() * 2)
    for (const farm of this.placed)
      if (farm.kind === Structure.Farm && farm.built())
        for (let attempt = 0; attempt < 24; ++attempt) {
          const at = add(
            farm.center,
            nativeRandomRadial(() => this.roll(), 3, 3, 6.283185),
          );
          const field = [
            point(f(at.x - 1), f(at.y - 1)),
            point(f(at.x + 1), f(at.y - 1)),
            point(f(at.x + 1), f(at.y + 1)),
            point(f(at.x - 1), f(at.y + 1)),
          ];
          if (this.canPlantField(field).ok && this.plantField(field)) return;
        }
  const count = (kind: Structure): number =>
    this.placed.filter((b) => {
      if (!b.built() && !this.grid.walkable(b.door())) return false;
      for (let stage = kind; stage !== Structure.Count; stage = structureSpec(stage).next)
        if (b.kind === stage) return true;
      return false;
    }).length;
  const needsPeople = this.population() < workforceNeeded,
    supportedPopulation = Math.min(workforceNeeded, this.population() + 2),
    economy = this.forecast();
  let waterCapacity = 0,
    foodCapacity = 0;
  for (const b of this.placed)
    if (b.built()) {
      const spec = structureSpec(b.kind);
      if (spec.product === Product.Water) waterCapacity += spec.jobs * spec.perWorker;
      if (spec.product === Product.Food) foodCapacity += spec.jobs * 2;
    }
  const mouths = this.population() + this.guests();
  let wanted = Structure.Tent;
  if (treasury.food < this.population() * 8 && (!count(Structure.Farm) || foodCapacity < mouths))
    wanted = Structure.Farm;
  else if (treasury.water < this.population() * 5 && (!count(Structure.Well) || waterCapacity < mouths))
    wanted = Structure.Well;
  else if (
    treasury.gold < 60 &&
    this.population() >= structureSpec(Structure.MarketStalls).requiredPopulation &&
    (!count(Structure.MarketStalls) || economy.net() < 0)
  )
    wanted = Structure.MarketStalls;
  else if (needsPeople && this.housing() < supportedPopulation) wanted = Structure.Tent;
  else if (needsPeople && !count(Structure.Hostel) && !count(Structure.Inn) && !count(Structure.GrandInn))
    wanted = Structure.Hostel;
  else if (!count(Structure.Lumberyard)) wanted = Structure.Lumberyard;
  else if (!count(Structure.Quarry)) wanted = Structure.Quarry;
  else if (!count(Structure.Well)) wanted = Structure.Well;
  else if (!count(Structure.Farm)) wanted = Structure.Farm;
  else if (!count(Structure.Tent)) wanted = Structure.Tent;
  else if (!count(Structure.Storehouse)) wanted = Structure.Storehouse;
  else if (!count(Structure.Sawmill)) wanted = Structure.Sawmill;
  else if (!count(Structure.Stoneworks)) wanted = Structure.Stoneworks;
  else {
    if (needsPeople || treasury.food < this.population() * 8 || treasury.water < this.population() * 5)
      return;
    for (const road of this.network.roads()) {
      if (road.built < 1 || road.paved || road.paving >= 0 || road.wear > 0) continue;
      const check = this.canPave(road.id),
        budget = check.cost.clone();
      budget.gold += 30;
      budget.wood += 20;
      budget.stone += 30;
      if (check.ok && treasury.covers(budget) && this.pave(road.id)) {
        this.orderRoadwork([worker], road.id);
        return;
      }
    }
    const missing: Structure[] = [];
    for (let i = 0; i < Structure.Count; ++i) {
      const kind = i,
        spec = structureSpec(kind);
      if (!spec.buildable || this.population() < spec.requiredPopulation) continue;
      const exists = count(kind) > 0,
        budget = spec.cost.clone();
      budget.gold += 20;
      budget.wood += 20;
      budget.stone += 10;
      if (!exists && treasury.covers(budget)) missing.push(kind);
    }
    if (!missing.length) return;
    wanted = missing[Math.trunc(f(this.roll() * missing.length)) % missing.length];
  }
  for (let attempt = 0; attempt < 70; ++attempt) {
    const spot = this.fit(
      wanted,
      add(
        origin,
        nativeRandomRadial(() => this.roll(), 4, 9, 6.283185),
      ),
      0,
    );
    const footprint = new Footprint(spot.center, f(structureSpec(wanted).size / 2), spot.angle);
    if (distance(spot.center, origin) > TownState.campReach || !this.roadAccess(footprint)) continue;
    if (
      this.canPlace(wanted, spot.center, spot.angle).ok &&
      reachableSite(wanted, spot.center, spot.angle) &&
      this.place(wanted, spot.center, spot.angle)
    ) {
      this.orderBuild([worker], this.placed.at(-1)!.id);
      return;
    }
  }
  const workshop = wanted === Structure.Lumberyard || wanted === Structure.Quarry,
    reach = workshop ? TownState.campReach * 2 : TownState.campReach;
  const plots: Point[] = [];
  for (
    let y = Math.max(0, Math.trunc(f(origin.y - reach)));
    y <= Math.min(this.world.height() - 1, Math.trunc(f(origin.y + reach)));
    ++y
  )
    for (
      let x = Math.max(0, Math.trunc(f(origin.x - reach)));
      x <= Math.min(this.world.width() - 1, Math.trunc(f(origin.x + reach)));
      ++x
    ) {
      const at = point(f(x + f(0.5)), f(y + f(0.5)));
      if (distance(at, origin) <= reach && this.canPlace(wanted, at, 0).ok) plots.push(at);
    }
  nativeSort(plots, (a, b) => distance(a, origin) < distance(b, origin));
  const segments = this.network.builtSegments();
  for (const at of plots) {
    let join = origin,
      gap = f(1e9);
    for (const segment of segments) {
      const p = closestOnSegment(at, segment.a, segment.b);
      if (distance(at, p) < gap) {
        gap = distance(at, p);
        join = p;
      }
    }
    const angle = f(Math.atan2(f(at.x - join.x), f(join.y - at.y))),
      footprint = new Footprint(at, f(structureSpec(wanted).size / 2), angle);
    if (!this.canPlace(wanted, at, angle).ok || !reachableSite(wanted, at, angle)) continue;
    if (this.roadAccess(footprint) && this.place(wanted, at, angle)) {
      this.orderBuild([worker], this.placed.at(-1)!.id);
      return;
    }
    if (!segments.length) continue;
    const end = add(
      at,
      scale(normalized(sub(join, at)), f(f(footprint.half + TownState.roadHalfWidth) + f(0.12))),
    );
    const road = [sharpAnchor(join), sharpAnchor(end)];
    if (this.canBuildRoad(road).ok && this.buildRoad(road)) {
      this.orderRoadwork([worker], this.network.roads().at(-1)!.id);
      return;
    }
  }
  if (workshop)
    for (const p of this.folk)
      if (p.id === worker) {
        if (
          this.seekTitleMaterials(p, wanted === Structure.Quarry ? Product.Stone : Product.Wood) &&
          p.path.length
        )
          this.orderMove([worker], p.path[p.path.length - 1]);
        break;
      }
}

export interface PreviewTown extends TownState {
  walk(person: Person, seconds: number): void;
  walkTo(person: Person, goal: Point): boolean;
}
export function prepareTitlePreview(this: TownState): void {
  this.beasts = [];
  this.animals = [];
  this.animalCalls = [];
  this.blows = [];
  this.timberEvents = [];
  this.titleAnchors = [];
  const walls = this.placed.filter((b) => b.built() && b.kind !== Structure.Torch).map((b) => b.footprint());
  this.grid.rebuild(this.world, this.network, walls);
  for (const p of this.folk) {
    if (p.inside || p.crossingDoorway()) p.position = { ...p.entrance };
    p.inside = false;
    p.doorway = 0;
    p.path = [];
    p.task = Activity.Idle;
    p.activity = Activity.Idle;
    p.ordered = false;
    p.foe = p.tree = p.target = -1;
    p.approachingOrder = false;
    p.until = 0;
    this.titleAnchors.push({ ...p.position });
  }
}
export function advanceTitlePreview(this: PreviewTown, seconds: number): void {
  for (let i = 0; i < this.folk.length && i < this.titleAnchors.length; ++i) {
    const p = this.folk[i];
    if (p.health <= 0) continue;
    if (p.moving()) {
      this.walk(p, seconds);
      if (!p.moving()) {
        p.activity = Activity.Idle;
        p.until = 1.5 + f(this.roll() * 3);
      }
    } else {
      p.until -= seconds;
      if (p.until > 0) continue;
      const goal = this.grid.nearestWalkable(
        add(this.titleAnchors[i], point(f(f(this.roll() - f(0.5)) * 3), f(f(this.roll() - f(0.5)) * 3))),
      );
      if (this.walkTo(p, goal)) p.activity = Activity.Moving;
      else p.until = 2;
    }
  }
}
