// Direct native Town::tick translation. The caller uses the original 0.1 second simulation step.
import { PeopleTown } from './town-people';
import { TownState } from './town-state';
import { Person, Activity, Role, TreeWorkKind } from './person';
import {
  Structure,
  Product,
  Resources,
  structureSpec,
  buildWork,
  isMarket,
  isSeat,
} from './building-catalog';
import { Point, point, distance, lerp } from './geometry';
import { Weather } from './climate';
import { DungeonKind } from './world-types';
import { f32 as f, clamp } from './numeric';
import * as mining from './mining';
import { animalSpec } from './wildlife';
export interface TickTown extends PeopleTown {
  prepareConstruction(p: Person, work: Activity, id: number): boolean;
  admitGuests(dt: number): void;
  stir(dt: number): void;
  staffed(kind: Structure): boolean;
  settlementAt(p: Point): number;
  stock(id?: number): Resources;
  enforceGuestLodging(p: Person): void;
  refreshShelter(p: Person): void;
  parched(id?: number): boolean;
  walkingSpeed(p: Person): number;
  fight(p: Person, dt: number): void;
  reveal(x: number, y: number, radius: number): void;
  walk(p: Person, dt: number): void;
  arrive(p: Person): void;
  constructionTree(p: Person, activity: Activity, target: number): number;
  fellTree(p: Person, cell: number): boolean;
  assignHomes(): void;
  staff(): void;
  roadWorkTarget(id: number): number;
  constructionRoad(id: number): number;
  storageFoundation(p: Person): boolean;
  startFelling(p: Person, around: Point, reach: number): boolean;
  startMining(p: Person, around: Point, reach: number): boolean;
  raiding(): boolean;
  credit(gain: Resources, village: number): void;
  think(p: Person): void;
  recount(): void;
}
export function dangerNear(town: TickTown, p: Person): boolean {
  const notice = p.ordered ? 6 : p.role === Role.Guest ? 8 : town.raiding() ? 10 : 5;
  return [...town.monsters(), ...town.wildlife()].some((threat) => {
    const gap = distance(threat.position, p.position);
    if (threat.animal !== null && (!threat.angry || !animalSpec(threat.animal).defends)) return false;
    return (
      threat.health > 0 &&
      !threat.insideLair &&
      (!threat.giant() || threat.angry) &&
      town.map().revealed(threat.position) &&
      gap <= notice &&
      (threat.raider || threat.angry || gap < f(2.5))
    );
  });
}
export function tick(this: TickTown, dt: number): void {
  this.timberEvents = this.timberEvents.filter((event) => this.time - event.at <= 2);
  if (this.walkRevision !== this.changes) {
    this.walkRevision = this.changes;
    const walls = this.placed
      .filter((item) => item.built() && item.kind !== Structure.Torch)
      .map((item) => item.footprint());
    this.grid.rebuild(this.world, this.network, walls);
  }
  this.admitGuests(dt);
  if (!this.titleAutoplay) this.stir(dt);
  const sky = this.climate(),
    days = f(dt / TownState.secondsPerDay),
    raining = sky.weather === Weather.Rain || sky.weather === Weather.Storm || sky.weather === Weather.Snow,
    healers = this.staffed(Structure.Apothecary);
  for (let i = 0; i < this.folk.length; ++i) {
    const p = this.folk[i];
    if (p.activity === Activity.Exploring) {
      p.path = [];
      if (p.inside || p.crossingDoorway()) this.walkTo(p, p.entrance);
      p.activity = p.task = Activity.Idle;
      p.target = p.taskSite = -1;
      p.ordered = false;
      p.until = this.time;
    }
    const storageCamp = this.settlementAt(p.position),
      treasury = this.stock(storageCamp);
    this.enforceGuestLodging(p);
    this.refreshShelter(p);
    const asleep = p.activity === Activity.Sleeping && !p.moving() && !p.crossingDoorway(),
      sheltered = p.inside;
    p.food = Math.max(0, f(p.food - f(f(0.9) * days)));
    p.rest = clamp(f(p.rest + f((asleep ? (sheltered ? f(2.4) : f(1.4)) : f(-0.75)) * days)), 0, 1);
    let strain = f(-0.1);
    if (p.food < f(0.2)) strain = f(strain + f(0.5));
    if (p.rest < f(0.15)) strain = f(strain + f(0.3));
    if (raining && !sheltered)
      strain = f(strain + f((sky.weather === Weather.Storm ? f(0.35) : f(0.15)) * sky.intensity));
    const chill = !sheltered ? f(Math.max(0, f(2 - sky.temperature)) * f(0.03)) : 0;
    strain = f(strain + Math.min(chill, f(0.35)));
    const working =
      !p.crossingDoorway() &&
      [
        Activity.Working,
        Activity.Building,
        Activity.Roadwork,
        Activity.Felling,
        Activity.Mining,
        Activity.Collecting,
      ].includes(p.activity);
    if (working) strain = f(strain + f(0.12));
    if (
      !p.crossingDoorway() &&
      (working ||
        p.activity === Activity.Hauling ||
        p.activity === Activity.FetchingMaterials ||
        p.activity === Activity.DeliveringMaterials ||
        p.activity === Activity.Guarding ||
        p.activity === Activity.Fighting)
    )
      p.worked = f(p.worked + f(dt));
    if (p.unpaid) strain = f(strain + f(0.1));
    if (asleep && sheltered) strain = f(strain - f(0.25));
    if (p.role === Role.Resident && p.home < 0) strain = f(strain + f(0.1));
    p.stress = clamp(f(p.stress + f(strain * days)), 0, 1);
    p.breaking = p.stress >= f(0.95) ? f(p.breaking + days) : 0;
    if (this.parched(this.settlementOf(p))) {
      p.stress = Math.min(1, f(p.stress + f(f(0.3) * days)));
      p.health = f(p.health - f(f(0.1) * days));
    }
    if (p.food < f(0.05)) p.health = f(p.health - f(f(0.5) * days));
    else if (!sheltered && sky.temperature < -3) p.health = f(p.health - f(f(0.15) * days));
    else if (p.food > f(0.4) && p.rest > f(0.3))
      p.health = Math.min(1, f(p.health + f((healers ? f(0.3) : f(0.15)) * days)));
    if (p.health <= 0 && p.activity !== Activity.Leaving) {
      this.notify(p.name + (p.food < f(0.05) ? ' starved to death' : ' died of the cold'));
      p.activity = Activity.Leaving;
      p.health = -1;
    }
    if (p.health < f(-0.5)) continue;
    if (
      p.role === Role.Resident &&
      !p.autoMode &&
      p.task === Activity.Idle &&
      !p.ordered &&
      p.activity !== Activity.Leaving &&
      p.activity !== Activity.Expedition
    ) {
      p.path = [];
      p.foe = -1;
      p.activity = Activity.Holding;
      continue;
    }
    if (p.crossingDoorway()) {
      const length = distance(p.entrance, p.threshold),
        step = f(f(this.walkingSpeed(p) * f(dt)) / Math.max(f(0.001), length));
      p.doorway = clamp(f(p.doorway + (p.inside ? step : -step)), 0, 1);
      p.position = lerp(p.entrance, p.threshold, p.doorway);
      continue;
    }
    if (p.role === Role.Resident && p.autoMode && this.time >= p.scheduleAt) {
      p.scheduleAt = this.time + 0.5;
      this.scheduleAutomatic(p);
    }
    this.fight(p, dt);
    if (p.activity === Activity.Fighting || p.crossingDoorway()) continue;
    if (
      !p.moving() &&
      [Activity.Building, Activity.Roadwork, Activity.Working, Activity.Felling, Activity.Mining].includes(
        p.activity,
      ) &&
      this.takeBreak(p)
    )
      continue;
    if (!p.inside && !this.world.revealedWithin(p.position, f(3.5)))
      this.reveal(p.position.x, p.position.y, f(7.5));
    if (p.moving()) {
      if (
        !this.titleAutoplay &&
        p.role === Role.Resident &&
        p.autoMode &&
        p.job < 0 &&
        !p.ordered &&
        p.task === Activity.Idle &&
        p.activity === Activity.Idle &&
        this.time >= p.until
      ) {
        p.until = this.time + 0.8;
        if (this.startHarvest(p, p.position, 5)) continue;
      }
      this.walk(p, dt);
      if (!p.moving()) this.arrive(p);
      continue;
    }
    const place = this.site(p.target);
    switch (Number(p.activity)) {
      case Activity.Building: {
        if (!place || (place.built() && place.health >= 1)) {
          p.activity = Activity.Idle;
          p.ordered = false;
          break;
        }
        if (distance(p.position, place.door()) > f(0.02)) {
          if (!this.walkTo(p, place.door())) {
            p.activity = Activity.Idle;
            p.until = this.time + 3;
          }
          break;
        }
        const tree = this.constructionTree(p, p.activity, p.target);
        if (tree >= 0) {
          if (p.task === Activity.Idle) {
            p.task = Activity.Building;
            p.taskSite = place.id;
          }
          if (!this.fellTree(p, tree)) {
            p.activity = Activity.Holding;
            p.until = this.time + 1;
          }
          break;
        }
        if (!place.built() && this.prepareConstruction(p, Activity.Building, place.id)) break;
        if (place.built()) {
          place.health = Math.min(1, f(place.health + f(f(2 * f(dt)) / buildWork(place.kind))));
          if (place.health >= 1) this.notify(structureSpec(place.kind).name + ' is repaired');
        } else
          place.progress = Math.min(
            place.materials.limit(),
            f(place.progress + f(f(dt) / buildWork(place.kind))),
          );
        if (place.built()) {
          this.notify(structureSpec(place.kind).name + ' is finished');
          if (place.kind === Structure.Guild)
            for (let d = 0; d < this.world.dungeons().length; ++d) {
              const dungeon = this.world.dungeons()[d];
              if (
                !this.open[d] &&
                dungeon.kind !== DungeonKind.GiantHall &&
                dungeon.discovered &&
                distance(place.center, point(f(dungeon.origin.x + 1), f(dungeon.origin.y + 1))) <= 10
              ) {
                this.open[d] = 1;
                this.notify(dungeon.name + ' is open to adventurers');
              }
            }
          this.assignHomes();
          this.staff();
          ++this.changes;
        }
        break;
      }
      case Activity.Roadwork: {
        if (p.task === Activity.Roadwork) {
          const next = this.roadWorkTarget(p.taskSite);
          if (next < 0) {
            p.path = [];
            p.activity = Activity.Idle;
            p.until = this.time + 1;
            break;
          }
          if (next !== p.target) {
            p.target = next;
            if (!this.walkTo(p, this.network.road(next)!.workPoint())) p.activity = Activity.Idle;
            break;
          }
        }
        const road = this.network.road(p.target);
        if (road && !this.roadReady(road.id)) {
          p.activity = Activity.Idle;
          p.until = this.time + 1;
          break;
        }
        const paving = !!road && road.built >= 1;
        if (!road || (paving && road.paving < 0 && road.wear <= 0)) {
          p.activity = Activity.Idle;
          if (p.task !== Activity.Building) p.ordered = false;
          break;
        }
        if (distance(p.position, road.workPoint()) > f(0.0001)) {
          if (this.walkTo(p, road.workPoint())) this.walk(p, dt);
          else {
            p.activity = Activity.Idle;
            p.until = this.time + 3;
          }
          break;
        }
        const tree = this.constructionTree(p, p.activity, p.target);
        if (tree >= 0) {
          if (p.task === Activity.Idle) {
            p.task = Activity.Roadwork;
            p.taskSite = road.id;
          }
          if (!this.fellTree(p, tree)) {
            p.activity = Activity.Holding;
            p.until = this.time + 1;
          }
          break;
        }
        if (paving && road.paving < 0 && road.wear > 0) {
          const ruined = road.wear >= 1;
          road.wear = Math.max(0, f(road.wear - f(f(f(dt) * f(0.5)) / Math.max(1, road.length()))));
          if (ruined && road.wear < 1) this.roadChanged();
          if (road.wear <= 0) this.notify('A road is mended');
          break;
        }
        if (this.prepareConstruction(p, Activity.Roadwork, road.id)) break;
        const shareKey = paving ? 'paving' : 'built',
          before = road[shareKey];
        road[shareKey] = Math.min(
          road.materials.limit(),
          f(road[shareKey] + f(f(f(dt) * (paving ? f(0.2) : f(0.32))) / Math.max(1, road.length()))),
        );
        const turn = f(1 - road.constructionStart);
        if (!paving && before < turn && road[shareKey] >= turn && turn < 1) {
          road[shareKey] = turn;
          p.position = road.along(1);
          this.walkTo(p, road.workPoint());
        } else p.position = paving ? road.along(road[shareKey]) : road.constructionPoint(road[shareKey]);
        if (road[shareKey] >= 1) {
          if (paving) {
            road.paved = true;
            road.paving = -1;
            this.notify('A road is paved with stone');
          } else this.notify('A road is laid');
          this.roadChanged();
        } else if (Math.trunc(f(road[shareKey] * 20)) !== Math.trunc(f(before * 20))) {
          this.roadChanged();
          if (p.task === Activity.Building && this.constructionRoad(p.taskSite) !== p.target) {
            p.activity = Activity.Idle;
            p.until = this.time;
          }
        }
        break;
      }
      case Activity.Felling:
      case Activity.Mining: {
        const stone = p.activity === Activity.Mining,
          x = p.tree % this.world.width(),
          y = Math.trunc(p.tree / this.world.width()),
          job = this.building(p.job),
          exists =
            p.tree >= 0 &&
            this.world.inside(x, y) &&
            (stone ? mining.deposit(this.world, x, y) : this.world.at(x, y).trees > 0),
          clearing = !stone && (p.task === Activity.Building || p.task === Activity.Roadwork),
          construction = p.task === Activity.Building || p.task === Activity.Roadwork,
          full =
            storageCamp >= 0 &&
            !construction &&
            (stone
              ? treasury.stone >= this.capacity(storageCamp).stone
              : treasury.wood >= this.capacity(storageCamp).wood);
        if (
          !exists ||
          (!clearing &&
            p.task === Activity.Working &&
            !p.ordered &&
            job &&
            job.kind !== (stone ? Structure.Quarry : Structure.Lumberyard)) ||
          full
        ) {
          p.tree = -1;
          p.activity = Activity.Idle;
          p.until = this.time;
          break;
        }
        if (place) place.workedSeconds = f(place.workedSeconds + f(dt));
        const started = p.until - 6,
          stroke = (at: number): number => Math.floor((at - started - 0.52) / 0.7);
        if (stroke(this.time) > stroke(this.time - dt))
          this.timberEvents.push({
            serial: this.nextTreeEvent++,
            kind: stone ? TreeWorkKind.Mine : TreeWorkKind.Chop,
            person: p.id,
            cell: p.tree,
            index: stone ? 0 : this.world.at(x, y).trees - 1,
            worker: { ...p.position },
            at: started + 0.52 + stroke(this.time) * 0.7,
          });
        if (this.time < p.until) break;
        if (stone) this.world.at(x, y).quarried = true;
        else --this.world.at(x, y).trees;
        this.timberEvents.push({
          serial: this.nextTreeEvent++,
          kind: stone ? TreeWorkKind.Shatter : TreeWorkKind.Fall,
          person: p.id,
          cell: p.tree,
          index: this.world.at(x, y).trees,
          worker: { ...p.position },
          at: this.time,
        });
        p.carriedProduct = stone ? Product.Stone : Product.Wood;
        p.carrying += 3;
        p.tree = -1;
        p.activity = Activity.Collecting;
        p.until = this.time + (stone ? 0.65 : 0.8);
        ++this.changes;
        break;
      }
      case Activity.Collecting:
        if (this.time >= p.until) {
          p.activity = Activity.Idle;
          p.until = this.time;
          if (p.task === Activity.Building || p.task === Activity.Roadwork) this.resumeOrder(p);
          else if (!this.haulCargo(p)) p.until = this.time + 2;
        }
        break;
      case Activity.FetchingMaterials:
      case Activity.DeliveringMaterials:
        this.arrive(p);
        break;
      case Activity.WaitingMaterials:
        if (this.time >= p.until) this.resumeOrder(p);
        break;
      case Activity.Hauling:
        if (this.time >= p.until) this.arrive(p);
        break;
      case Activity.Working:
        if (place && distance(p.position, place.door()) > f(0.02)) {
          if (!this.walkTo(p, place.door())) {
            p.activity = Activity.Idle;
            p.until = this.time + 3;
          }
          break;
        }
        if (place) place.workedSeconds = f(place.workedSeconds + f(dt));
        if (place && place.kind === Structure.Lumberyard && this.startFelling(p, place.center, f(4.6))) break;
        if (place && place.kind === Structure.Quarry && this.startMining(p, place.center, f(4.6))) break;
        if (place && (place.kind === Structure.Farm || place.kind === Structure.MageTower)) {
          p.load = f(p.load + f(dt));
          const store = this.nearest(
            place.center,
            (b) => b.built() && (b.kind === Structure.Storehouse || isMarket(b.kind) || isSeat(b.kind)),
          );
          if (p.load > 25 && store && distance(store.center, place.center) > 3) {
            if (this.walkTo(p, store.door())) {
              p.activity = Activity.Hauling;
              p.target = store.id;
            }
            break;
          }
        }
        if (!place || p.job !== p.target) p.activity = Activity.Idle;
        break;
      case Activity.Treating:
        if (!place || !place.built() || place.kind !== Structure.Apothecary || place.workers <= 0) {
          if (p.task === Activity.Treating) {
            p.task = Activity.Idle;
            p.taskSite = -1;
          }
          p.inside = false;
          p.activity = Activity.Idle;
          p.until = this.time;
          break;
        }
        p.health = Math.min(1, f(p.health + f(f(dt) * f(0.05))));
        if (p.health >= 1) {
          if (p.task === Activity.Treating) {
            p.task = Activity.Idle;
            p.taskSite = -1;
          }
          p.activity = Activity.Idle;
          p.until = this.time;
        }
        break;
      case Activity.Sleeping:
        if (p.task === Activity.Sleeping && !p.ordered && p.autoMode && p.food < f(0.25) && this.eat(p))
          break;
        if (
          p.rest >= f(0.95) &&
          p.task !== Activity.Sleeping &&
          (!p.autoMode || this.climate().night <= f(0.5))
        ) {
          if (dangerNear(this, p)) break;
          p.activity = Activity.Idle;
          p.inside = false;
          p.until = this.time;
        }
        break;
      case Activity.Eating:
      case Activity.Relaxing:
      case Activity.Praying:
      case Activity.Shopping:
        if (this.time < p.until) break;
        if (p.activity === Activity.Praying) {
          const faithful = !!place && place.faith === p.faith;
          p.stress = Math.max(0, f(p.stress - (faithful ? f(0.4) : f(0.2))));
          p.prayedAt = this.time;
        } else if (p.activity === Activity.Shopping) {
          if (this.charge(p, place, 12)) ++p.gear;
          p.loot = 0;
        } else if (p.activity === Activity.Relaxing) {
          p.stress = Math.max(0, f(p.stress - f(0.35)));
          p.relaxedAt = this.time;
          this.charge(p, place, p.role === Role.Guest ? 3 : 1);
        }
        if (p.task === Activity.Idle) p.ordered = false;
        p.activity = Activity.Idle;
        p.inside = false;
        p.until = this.time;
        break;
      case Activity.Holding:
        if (this.time >= p.until) {
          if (p.task === Activity.Idle) p.ordered = false;
          this.think(p);
        }
        break;
      case Activity.Idle:
      case Activity.Brooding:
        if (this.time >= p.until) {
          p.stress = Math.max(0, f(p.stress - f(0.2)));
          p.activity = Activity.Idle;
          this.think(p);
        }
        break;
      case Activity.Guarding:
        if (this.time >= p.until) this.think(p);
        break;
      case Activity.Expedition:
      case Activity.Fighting:
        break;
      default:
        p.activity = Activity.Idle;
        break;
    }
  }
  if (this.timberEvents.length > 512) this.timberEvents.splice(0, this.timberEvents.length - 512);
  const before = this.folk.length;
  this.folk = this.folk.filter((p) => p.health >= f(-0.5));
  if (this.folk.length !== before) {
    for (const item of this.placed) if (item.owner >= 0 && !this.person(item.owner)) item.owner = -1;
    this.recount();
    this.assignHomes();
    ++this.changes;
  }
}
