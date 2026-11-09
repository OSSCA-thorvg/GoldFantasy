// Native town.cpp placement, construction, staffing and land rules. No tutorial policy is added here.
import { TownState } from './town-state';
import { Building, Field, Check, Placement } from './town-models';
import {
  Resources,
  Structure,
  Product,
  Faith,
  structureSpec,
  isSeat,
  faithName,
  describe,
} from './building-catalog';
import { Activity, Person, Role, TreeWorkKind } from './person';
import { CampEconomy } from './camp-economy';
import { Tile, Terrain, DungeonKind, isWater, isStone } from './world-types';
import {
  Point,
  Outline,
  Footprint,
  point,
  add,
  sub,
  scale,
  rotated,
  distance,
  lerp,
  closestOnSegment,
  segmentDistance,
  area,
  centroid,
  selfIntersects,
  contains,
  overlaps,
  outlineDistance,
} from './geometry';
import { Road, RoadPath, flatten, pathLength } from './road-network';
import { f32, hash01, clamp } from './numeric';
import { worldName } from './world-map';
import { ConstructionMaterials, constructionProducts, resourceBundle } from './construction-materials';
export interface ConstructionTown extends TownState {
  camp(id?: number): Building | null;
  settlementAt(p: Point): number;
  settlementOf(p: Person | Building): number;
  stock(camp?: number): Resources;
  reserves(camp: number): Resources;
  capacity(camp?: number): Resources;
  economy(camp: number): CampEconomy;
  credit(gain: Resources, camp: number): void;
  foundSettlement(camp: number): void;
  population(camp?: number): number;
  groundProblem(samples: Point[]): string;
  roadAccess(f: Footprint): boolean;
  nearbyTiles(p: Point, r: number, match: (t: Tile) => boolean): number;
  near(p: Point, r: number, match: (s: Structure) => boolean): boolean;
  canPlace(k: Structure, p: Point, angle: number): Check;
  clearTrees(points: Point[]): number;
  reveal(x: number, y: number, radius: number): void;
  assignHomes(): void;
  staff(): void;
  recount(): void;
  borrowWorker(b: Building): void;
  buildingAt(p: Point): number;
  fieldAt(p: Point): number;
  touchesSettlement(p: Point): boolean;
  roadSettlement(path: RoadPath, ignore?: number): number;
  connectRoad(road: Road): boolean;
  roadReady(id: number): boolean;
  roadWorkTarget(id: number): number;
  checkRoad(path: RoadPath, ignore: number): Check;
  reserveConstructionMaterials(work: Activity, id: number): void;
  canBuildRoad(path: RoadPath): Check;
  canPave(id: number): Check;
  canReshapeRoad(id: number, path: RoadPath): Check;
  canPlantField(o: Outline): Check;
  canDemolish(p: Point): Check;
  raze(id: number): void;
}
export function refuse(check: Check, reason: string): Check {
  check.reason = reason;
  return check;
}
export function samples(shape: Footprint | Outline): Point[] {
  const out: Point[] = [],
    sampleStep = f32(0.25);
  if (shape instanceof Footprint) {
    const steps = Math.max(1, Math.ceil(f32(f32(shape.half * 2) / sampleStep)));
    for (let j = 0; j <= steps; ++j)
      for (let i = 0; i <= steps; ++i) {
        const local = point(
          f32(-shape.half + f32(f32(f32(shape.half * 2) * i) / steps)),
          f32(-shape.half + f32(f32(f32(shape.half * 2) * j) / steps)),
        );
        out.push(add(shape.center, rotated(scale(local, f32(0.98)), shape.angle)));
      }
    return out;
  }
  out.push(...shape);
  if (!shape.length) return out;
  let low = { ...shape[0] },
    high = { ...shape[0] };
  for (const p of shape) {
    low = point(Math.min(low.x, p.x), Math.min(low.y, p.y));
    high = point(Math.max(high.x, p.x), Math.max(high.y, p.y));
  }
  for (let y = f32(low.y + f32(sampleStep / 2)); y < high.y; y = f32(y + sampleStep))
    for (let x = f32(low.x + f32(sampleStep / 2)); x < high.x; x = f32(x + sampleStep))
      if (contains(shape, point(x, y))) out.push(point(x, y));
  return out;
}
export function touches(footprint: Footprint, a: Point, b: Point, margin: number): boolean {
  return (
    footprint.contains(a, margin) ||
    footprint.contains(b, margin) ||
    footprint.contains(lerp(a, b, f32(0.5)), margin)
  );
}
export function placementVariant(world: TownState['world'], kind: Structure, center: Point): number {
  const variant =
    Math.trunc(f32(hash01(world.seed(), Math.trunc(center.x * 8), Math.trunc(center.y * 8), 41) * 1e6)) >>> 0;
  return kind === Structure.Chapel ? (variant & ~3) >>> 0 : variant;
}
export function editPerson(this: ConstructionTown, id: number, position: Point, health: number): boolean {
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !this.world.inside(position) ||
    !Number.isFinite(health) ||
    health < 0 ||
    health > 1
  )
    return false;
  for (const person of this.folk)
    if (person.id === id) {
      if (person.position.x !== position.x || person.position.y !== position.y) {
        person.position = { ...position };
        person.path = [];
        person.activity = Activity.Idle;
        person.inside = false;
        person.ordered = false;
        person.goal = { ...position };
        person.doorway = 0;
        person.entrance = { ...position };
        person.threshold = { ...position };
        this.reveal(position.x, position.y, f32(7.5));
      }
      person.health = health;
      return true;
    }
  return false;
}
export function editBuilding(
  this: ConstructionTown,
  id: number,
  center: Point,
  angle: number,
  progress: number,
  health: number,
): boolean {
  if (
    ![center.x, center.y, angle, progress, health].every(Number.isFinite) ||
    progress < 0 ||
    progress > 1 ||
    health < 0 ||
    health > 1
  )
    return false;
  for (const building of this.placed)
    if (building.id === id) {
      const draft = Object.assign(
        new Building(building.id, building.kind, center, angle, building.variant),
        building,
        { center, angle, progress, health },
      );
      for (const p of draft.footprint().corners()) if (!this.world.inside(p)) return false;
      Object.assign(building, draft);
      building.version = f32(building.version + 1) >>> 0;
      ++this.changes;
      this.walkRevision = 0n;
      return true;
    }
  return false;
}
export function roomToGrow(this: ConstructionTown, item: Building, next: Structure): boolean {
  const half = f32(structureSpec(next).size / 2);
  if (half <= f32(structureSpec(item.kind).size / 2)) return true;
  const grown = new Footprint(item.center, half, item.angle);
  if (this.groundProblem(samples(grown))) return false;
  for (const other of this.placed)
    if (other.id !== item.id && grown.overlaps(other.footprint())) return false;
  for (const segment of this.network.segments()) if (grown.contains(segment.a, -f32(0.1))) return false;
  return true;
}
export function staffed(this: ConstructionTown, kind: Structure): boolean {
  return this.placed.some((b) => b.kind === kind && b.built() && b.workers > 0);
}
export function charge(
  this: ConstructionTown,
  person: Person,
  place: Building | null,
  gold: number,
): boolean {
  if (person.purse < gold) return false;
  person.purse = f32(person.purse - gold);
  const village = this.settlementOf(place ?? person);
  this.credit(new Resources(gold), village);
  this.economy(village).today.guests = f32(
    this.economy(village).today.guests + (person.role === Role.Guest ? gold : 0),
  );
  if (place) place.earned = f32(place.earned + gold);
  return true;
}
export function setFaith(this: ConstructionTown, id: number, faith: Faith): boolean {
  for (const item of this.placed)
    if (item.id === id && item.kind === Structure.Chapel && item.faith !== faith) {
      item.replaced = [{ kind: item.kind, variant: item.variant, dx: 0, dy: 0 }];
      item.faith = faith;
      item.variant = ((item.variant & ~3) | faith) >>> 0;
      item.version = f32(item.version + 1) >>> 0;
      this.notify('The chapel now follows the ' + faithName(faith));
      ++this.changes;
      return true;
    }
  return false;
}
export function field(this: ConstructionTown, id: number): Field | null {
  return this.farmland.find((f) => f.id === id) ?? null;
}
export function buildingAt(this: ConstructionTown, p: Point): number {
  for (let i = f32(this.placed.length - 1); i >= 0; --i)
    if (this.placed[i].footprint().contains(p)) return this.placed[i].id;
  return -1;
}
export function fieldAt(this: ConstructionTown, p: Point): number {
  for (const item of this.farmland) if (contains(item.outline, p)) return item.id;
  return -1;
}
export function groundProblem(this: ConstructionTown, points: Point[]): string {
  for (const p of points) {
    const tile = this.world.cell(p);
    if (!tile || !this.world.revealed(p)) return 'Unexplored land';
    if (this.world.giant()?.covers(p)) return "Ymir's stone";
    const terrain = this.world.terrainAt(p);
    if (isWater(terrain)) return 'Water';
    if (terrain === Terrain.Mountain) return 'Mountains';
    if (terrain === Terrain.Ice) return 'Ice';
    if (terrain === Terrain.Lava) return 'Lava';
    if (terrain === Terrain.Rock) return 'Rocky ground';
    if (tile.dungeon >= 0) return 'A dungeon entrance';
  }
  return '';
}
export function fit(this: ConstructionTown, kind: Structure, cursor: Point, freeAngle: number): Placement {
  if (kind === Structure.Torch) {
    let nearest = cursor,
      best = 1e9;
    for (const segment of this.network.builtSegments()) {
      const p = closestOnSegment(cursor, segment.a, segment.b);
      if (distance(p, cursor) < best) {
        best = distance(p, cursor);
        nearest = p;
      }
    }
    return new Placement(nearest, 0, best < 1e9);
  }
  const half = f32(structureSpec(kind).size / 2),
    match = this.network.distance(cursor),
    gap = match.distance;
  if (gap > f32(half + f32(1.6))) return new Placement(cursor, freeAngle, false);
  const on = match.onRoad!,
    tangent = match.tangent!;
  let best = new Placement(),
    bestError = Infinity;
  const alignDoor = (anchor: Point, direction: Point): void => {
    for (let attempt = 0; attempt < 8; ++attempt) {
      let normal = point(-direction.y, direction.x);
      const side = sub(cursor, anchor);
      if (f32(f32(normal.x * side.x) + f32(normal.y * side.y)) < 0) normal = scale(normal, -1);
      const spot = new Placement(
          add(anchor, scale(normal, f32(f32(TownState.roadHalfWidth + f32(0.1)) + half))),
          f32(Math.atan2(normal.x, -normal.y)),
          true,
        ),
        probe = new Building(
          0,
          kind,
          spot.center,
          spot.angle,
          placementVariant(this.world, kind, spot.center),
        ),
        atDoor = this.network.distance(probe.threshold()).tangent!;
      const error = Math.abs(f32(f32(normal.x * atDoor.x) + f32(normal.y * atDoor.y)));
      if (error < bestError) {
        best = spot;
        bestError = error;
      }
      if (error < f32(1e-4)) return;
      direction = atDoor;
    }
  };
  alignDoor(on, tangent);
  if (bestError >= f32(1e-4)) {
    const along = rotated(point(1, 0), best.angle);
    for (const shift of [f32(0.05), -f32(0.05), f32(0.1), -f32(0.1), f32(0.2), -f32(0.2)]) {
      alignDoor(add(on, scale(along, shift)), tangent);
      if (bestError < f32(1e-4)) break;
    }
  }
  return best;
}
export function canPlace(this: ConstructionTown, kind: Structure, center: Point, angle: number): Check {
  const spec = structureSpec(kind),
    check = new Check(false, '', spec.cost.clone()),
    village = this.settlementAt(center);
  if (!spec.buildable) return refuse(check, 'Grows from an earlier stage');
  if (this.population(village) < spec.requiredPopulation)
    return refuse(check, 'Needs ' + spec.requiredPopulation + ' people in this village');
  const founding = kind === Structure.Camp;
  if (!founding && !this.camp()) return refuse(check, 'Found the camp first');
  if (founding)
    for (const other of this.placed)
      if (isSeat(other.kind) && distance(center, other.center) < 50)
        return refuse(check, 'Camps must be at least 50 tiles apart');
  const nearDungeon = (reach: number): boolean =>
    this.world
      .dungeons()
      .some(
        (site) =>
          site.discovered &&
          (kind !== Structure.Guild || site.kind !== DungeonKind.GiantHall) &&
          distance(center, point(f32(site.origin.x + 1), f32(site.origin.y + 1))) <= reach,
      );
  if (founding && !nearDungeon(TownState.campReach))
    return refuse(check, 'Must be within 12 paces of a dungeon');
  if (kind === Structure.Guild && !nearDungeon(10))
    return refuse(check, 'Must be within 10 paces of a dungeon');
  if (kind === Structure.Torch) {
    let onRoad = false;
    for (const segment of this.network.builtSegments())
      if (segmentDistance(center, segment.a, segment.b) <= TownState.roadHalfWidth) onRoad = true;
    if (!onRoad) return refuse(check, 'Torches need a completed road');
    for (const b of this.placed)
      if (b.footprint().contains(center, f32(0.15))) return refuse(check, 'Occupied');
    check.ok = true;
    return check;
  }
  const footprint = new Footprint(center, f32(spec.size / 2), angle),
    problem = this.groundProblem(samples(footprint));
  if (problem) return refuse(check, problem);
  for (const other of this.placed)
    if (footprint.overlaps(other.footprint())) return refuse(check, 'Occupied');
  for (const segment of this.network.segments())
    if (touches(footprint, segment.a, segment.b, TownState.roadHalfWidth))
      return refuse(check, 'On the road');
  for (const item of this.farmland)
    if (overlaps(footprint.corners(), item.outline)) return refuse(check, 'Fields in the way');
  if (kind === Structure.Lumberyard && !this.nearbyTiles(center, f32(4.5), (t) => t.trees > 0))
    return refuse(check, 'Needs forest within 4 paces');
  if (kind === Structure.Quarry && !this.nearbyTiles(center, f32(3.5), (t) => isStone(t.terrain)))
    return refuse(check, 'Needs rocky ground within 3 paces');
  check.ok = true;
  return check;
}
export function place(this: ConstructionTown, kind: Structure, center: Point, angle: number): boolean {
  if (!this.canPlace(kind, center, angle).ok) return false;
  const spec = structureSpec(kind),
    village = this.settlementAt(center);
  const variant = placementVariant(this.world, kind, center),
    item = new Building(this.nextId++, kind, { ...center }, angle, variant);
  item.progress = 0;
  item.village = kind === Structure.Camp ? item.id : village;
  item.materials.required = spec.cost.clone();
  this.placed.push(item);
  if (kind === Structure.Camp) this.foundSettlement(item.id);
  this.reserveConstructionMaterials(Activity.Building, item.id);
  this.reveal(center.x, center.y, f32(7 + spec.size));
  ++this.changes;
  return true;
}
export function completeConstruction(this: ConstructionTown): void {
  for (const item of this.placed) {
    for (const product of constructionProducts)
      item.materials.delivered.add(resourceBundle(product, item.materials.missing(product)));
    item.progress = 1;
  }
  for (const road of this.network.list) {
    for (const product of constructionProducts)
      road.materials.delivered.add(resourceBundle(product, road.materials.missing(product)));
    road.built = 1;
    if (road.paving >= 0) {
      road.paved = true;
      road.paving = -1;
    }
  }
  for (const item of this.placed)
    if (item.kind === Structure.Guild)
      for (let d = 0; d < this.world.dungeons().length; ++d) {
        const site = this.world.dungeons()[d];
        if (
          site.kind !== DungeonKind.GiantHall &&
          site.discovered &&
          distance(item.center, point(f32(site.origin.x + 1), f32(site.origin.y + 1))) <= 10
        )
          this.open[d] = 1;
      }
  for (const item of this.placed)
    this.credit(new Resources(0, this.clearTrees(samples(item.footprint()))), this.settlementOf(item));
  for (const road of this.network.roads())
    this.credit(new Resources(0, this.clearTrees(flatten(road.path, f32(0.2)))), road.village);
  this.assignHomes();
  this.staff();
  ++this.roadChanges;
  ++this.changes;
}
export function checkRoad(this: ConstructionTown, path: RoadPath, ignore: number): Check {
  const check = new Check();
  if (!this.camp()) return refuse(check, 'Found the camp first');
  if (path.length < 2) return refuse(check, 'Hold and draw a road');
  const total = pathLength(path);
  if (total < f32(0.5)) return refuse(check, 'Too short');
  if (total > TownState.maxRoadLength) return refuse(check, 'Too long');
  const line = flatten(path, f32(0.2));
  let connected = this.touchesSettlement(line[0]) || this.touchesSettlement(line[f32(line.length - 1)]),
    span = 0,
    bridged = 0;
  for (let i = 0; i < line.length; ++i) {
    const p = line[i],
      end = i === 0 || f32(i + 1) === line.length,
      tile = this.world.cell(p);
    if (!tile || !this.world.revealed(p)) return refuse(check, 'Unexplored land');
    const terrain = this.world.terrainAt(p);
    if (terrain === Terrain.Sea) return refuse(check, 'Cannot bridge the sea');
    if (terrain === Terrain.Water) {
      if (end) return refuse(check, 'A bridge needs dry banks');
      const step = distance(p, line[f32(i - 1)]);
      span = f32(span + step);
      bridged = f32(bridged + step);
      if (span > TownState.maxBridgeSpan) return refuse(check, 'Bridge too long (7 paces at most)');
    } else span = 0;
    if (terrain === Terrain.Mountain) return refuse(check, 'Mountains');
    if (terrain === Terrain.Ice) return refuse(check, 'Ice');
    if (terrain === Terrain.Lava) return refuse(check, 'Lava');
    if (terrain === Terrain.Rock) return refuse(check, 'Rocky ground');
    if (tile.dungeon >= 0) return refuse(check, 'A dungeon entrance');
    for (const item of this.placed)
      if (
        item.kind !== Structure.Torch &&
        item.footprint().contains(p, end ? -f32(0.05) : f32(TownState.roadHalfWidth - f32(0.1)))
      )
        return refuse(check, 'Building in the way');
    if (this.fieldAt(p) >= 0) return refuse(check, 'Fields in the way');
    connected = connected || this.network.distance(p, ignore).distance < TownState.roadHalfWidth;
  }
  if (ignore >= 0) {
    connected = false;
    for (const end of [line[0], line[f32(line.length - 1)]])
      connected =
        connected ||
        this.network.distance(end, ignore).distance <= TownState.joinReach ||
        this.buildingAt(end) >= 0 ||
        this.placed.some((b) => isSeat(b.kind) && distance(end, b.center) <= f32(1.3));
    for (const p of line)
      connected = connected || this.network.distance(p, ignore).distance < TownState.roadHalfWidth;
  }
  if (!connected) return refuse(check, 'Must connect to the settlement');
  if (bridged > 0) {
    check.cost.wood = Math.ceil(f32(bridged * 3));
    check.cost.stone = Math.ceil(bridged);
  }
  const old = this.network.road(ignore);
  if (old) {
    check.cost.wood = Math.max(0, check.cost.wood - old.materials.required.wood);
    check.cost.stone = Math.max(0, check.cost.stone - old.materials.required.stone);
  }
  const village = this.roadSettlement(path, ignore);
  if (village < 0) return refuse(check, 'Must connect to a camp or its roads');
  const duplicate = flatten(path, f32(0.2));
  if (duplicate.length && duplicate.every((p) => this.network.distance(p, ignore).distance <= f32(0.12)))
    return refuse(check, 'Road already exists');
  check.ok = true;
  return check;
}
export function canBuildRoad(this: ConstructionTown, path: RoadPath): Check {
  return this.checkRoad(path, -1);
}
export function buildRoad(this: ConstructionTown, path: RoadPath): boolean {
  const check = this.canBuildRoad(path);
  if (!check.ok) return false;
  const village = this.roadSettlement(path);
  const id = this.network.add(path),
    road = this.network.road(id)!;
  road.village = village;
  road.materials.required = check.cost;
  if (!this.connectRoad(road)) {
    this.network.remove(id);
    return false;
  }
  this.reserveConstructionMaterials(Activity.Roadwork, id);
  this.reveal(path[0].point.x, path[0].point.y, 4);
  this.reveal(path[f32(path.length - 1)].point.x, path[f32(path.length - 1)].point.y, 4);
  this.roadChanged(false);
  return true;
}
export function canPave(this: ConstructionTown, id: number): Check {
  const check = new Check(),
    road = this.network.road(id);
  if (!road) return refuse(check, 'No road there');
  if (road.paved || road.paving >= 0) return refuse(check, 'Already paved');
  if (road.built < 1) return refuse(check, 'Lay the road first');
  const length = road.length();
  check.cost = new Resources(0, 0, Math.ceil(f32(length * f32(0.8))));
  check.ok = true;
  return check;
}
export function pave(this: ConstructionTown, id: number): boolean {
  const check = this.canPave(id);
  if (!check.ok) return false;
  const road = this.network.road(id)!;
  road.materials = new ConstructionMaterials(check.cost);
  road.paving = 0;
  this.reserveConstructionMaterials(Activity.Roadwork, id);
  this.roadChanged();
  return true;
}
export function canReshapeRoad(this: ConstructionTown, id: number, path: RoadPath): Check {
  const road = this.network.road(id);
  return road ? this.checkRoad(path, id) : refuse(new Check(), 'No such road');
}
export function reshapeRoad(this: ConstructionTown, id: number, path: RoadPath): boolean {
  const check = this.canReshapeRoad(id, path);
  if (!check.ok) return false;
  this.network.road(id)!.materials.required.add(check.cost);
  this.network.reshape(id, path);
  this.connectRoad(this.network.road(id)!);
  this.reserveConstructionMaterials(Activity.Roadwork, id);
  for (const anchor of path) this.reveal(anchor.point.x, anchor.point.y, 4);
  this.roadChanged(false);
  return true;
}
export function canPlantField(this: ConstructionTown, outline: Outline): Check {
  const check = new Check();
  if (outline.length < 3) return refuse(check, 'Click to outline a field');
  if (selfIntersects(outline)) return refuse(check, 'The outline crosses itself');
  const acres = area(outline);
  if (acres < 1) return refuse(check, 'Too small');
  if (acres > TownState.maxFieldAcres)
    return refuse(check, 'At most ' + TownState.maxFieldAcres + ' acres per field');
  const problem = this.groundProblem(samples(outline));
  if (problem) return refuse(check, problem === 'Unexplored land' ? problem : 'Not arable');
  for (const p of samples(outline)) {
    const terrain = this.world.terrainAt(p);
    if (terrain === Terrain.Ash) return refuse(check, 'Too dry for crops');
    if (terrain === Terrain.Frost) return refuse(check, 'Too cold for crops');
  }
  for (const item of this.placed)
    if (overlaps(item.footprint().corners(), outline)) return refuse(check, 'Occupied');
  for (const item of this.farmland) if (overlaps(item.outline, outline)) return refuse(check, 'Occupied');
  for (const road of this.network.roads())
    for (const p of road.line)
      if (outlineDistance(outline, p) < TownState.roadHalfWidth) return refuse(check, 'Road in the way');
  if (
    !this.near(
      centroid(outline),
      f32(TownState.farmReach + f32(f32(Math.sqrt(acres)) / 2)),
      (s) => s === Structure.Farm,
    )
  )
    return refuse(check, 'Needs a farmhouse within 6 paces');
  check.ok = true;
  return check;
}
export function plantField(this: ConstructionTown, outline: Outline): boolean {
  if (!this.canPlantField(outline).ok) return false;
  const village = this.settlementAt(centroid(outline));
  this.farmland.push(new Field(this.nextId++, structuredClone(outline), village));
  this.credit(new Resources(0, this.clearTrees(samples(outline))), village);
  ++this.changes;
  return true;
}
export function canDemolish(this: ConstructionTown, p: Point): Check {
  const check = new Check(),
    id = this.buildingAt(p);
  if (id >= 0) {
    if (isSeat(this.building(id)!.kind)) return refuse(check, 'The seat of the settlement stays');
    check.ok = true;
  } else if (
    this.fieldAt(p) >= 0 ||
    this.network.distance(p).distance < f32(TownState.roadHalfWidth + f32(0.15))
  )
    check.ok = true;
  else check.reason = 'Nothing to clear';
  return check;
}
export function raze(this: ConstructionTown, id: number): void {
  const lostCamp = !!this.camp(id);
  this.placed = this.placed.filter((b) => b.id !== id);
  if (lostCamp) {
    this.villages = this.villages.filter((v) => v.camp !== id);
    for (const b of this.placed) if (b.village === id) b.village = this.settlementAt(b.center);
    for (const r of this.network.list)
      if (r.village === id) r.village = this.settlementAt(r.along(r.constructionStart));
    for (const field of this.farmland)
      if (field.village === id) field.village = this.settlementAt(centroid(field.outline));
  }
  for (const person of this.folk) {
    if (lostCamp && person.village === id) person.village = this.settlementAt(person.position);
    if (person.home === id) person.home = -1;
    if (person.job === id) person.job = -1;
    if (person.bed === id) person.bed = -1;
    if (person.task === Activity.Building && person.taskSite === id) person.task = Activity.Idle;
    if (person.target === id && person.activity !== Activity.Exploring) {
      person.activity = Activity.Idle;
      person.inside = false;
      person.path = [];
    }
  }
  this.recount();
  this.assignHomes();
  ++this.changes;
}
export function demolish(this: ConstructionTown, p: Point): boolean {
  if (!this.canDemolish(p).ok) return false;
  const id = this.buildingAt(p),
    field = this.fieldAt(p);
  if (id >= 0) this.raze(id);
  else if (field >= 0) this.farmland = this.farmland.filter((f) => f.id !== field);
  else {
    const road = this.network.distance(p).id ?? -1;
    this.network.remove(road);
    ++this.roadChanges;
    for (const person of this.folk)
      if (person.activity === Activity.Roadwork && person.target === road) person.activity = Activity.Idle;
  }
  ++this.changes;
  return true;
}
export function regrow(this: ConstructionTown): void {
  const taken = new Uint8Array(f32(this.world.width() * this.world.height())),
    mark = (p: Point): void => {
      const x = Math.floor(p.x),
        y = Math.floor(p.y);
      if (this.world.inside(x, y)) taken[f32(f32(y * this.world.width()) + x)] = 1;
    };
  for (const road of this.network.roads())
    for (let s = 0; s <= 1; s = f32(s + f32(f32(0.3) / Math.max(1, road.length())))) mark(road.along(s));
  for (const item of this.placed) for (const p of samples(item.footprint())) mark(p);
  for (const item of this.farmland) for (const p of samples(item.outline)) mark(p);
  for (let y = 0; y < this.world.height(); ++y)
    for (let x = 0; x < this.world.width(); ++x) {
      const tile = this.world.at(x, y);
      if (
        tile.trees < tile.wild &&
        !taken[f32(f32(y * this.world.width()) + x)] &&
        hash01(this.world.seed(), x, y, this.days >>> 0) < f32(0.2)
      ) {
        ++tile.trees;
        const at = point(x + 0.5, y + 0.5);
        if (this.world.revealed(at) && this.timberEvents.length < 512)
          this.timberEvents.push({ serial: this.nextTreeEvent++, kind: TreeWorkKind.Regrow,
            person: -1, cell: y * this.world.width() + x, index: tile.trees - 1, worker: at, at: this.time });
      }
    }
}
export function setWorkers(this: ConstructionTown, id: number, workers: number): boolean {
  for (const item of this.placed) {
    if (item.id !== id) continue;
    const jobs = structureSpec(item.kind).jobs,
      before = item.workers;
    item.wanted = clamp(workers, 0, jobs);
    for (let i = f32(this.folk.length - 1); i >= 0 && item.workers > item.wanted; --i)
      if (this.folk[i].job === id) {
        this.folk[i].job = -1;
        --item.workers;
      }
    this.staff();
    if (item.workers < item.wanted) this.borrowWorker(item);
    if (item.workers === before) return false;
    ++this.changes;
    return true;
  }
  return false;
}
export function borrowWorker(this: ConstructionTown, to: Building): void {
  const fullness = (b: Building): number => {
    const room = this.capacity(this.settlementOf(b)),
      treasury = this.stock(this.settlementOf(b));
    switch (structureSpec(b.kind).product) {
      case Product.Food:
        return f32(treasury.food / Math.max(1, room.food));
      case Product.Wood:
        return f32(treasury.wood / Math.max(1, room.wood));
      case Product.Stone:
        return f32(treasury.stone / Math.max(1, room.stone));
      case Product.Water:
        return f32(treasury.water / Math.max(1, room.water));
      default:
        return 0;
    }
  };
  let donor: Building | null = null,
    best = 0;
  for (const item of this.placed) {
    if (item.id === to.id || item.workers === 0 || this.settlementOf(item) !== this.settlementOf(to))
      continue;
    const score = f32(item.workers + f32(2 * fullness(item)));
    if (!donor || score > best) {
      donor = item;
      best = score;
    }
  }
  if (!donor) return;
  for (let i = f32(this.folk.length - 1); i >= 0; --i) {
    const p = this.folk[i];
    if (
      p.job === donor.id &&
      p.role === Role.Resident &&
      p.autoMode &&
      !p.ordered &&
      p.activity !== Activity.Expedition
    ) {
      p.job = to.id;
      p.activity = Activity.Idle;
      p.until = this.time;
      if (donor.wanted > f32(donor.workers - 1)) donor.wanted = f32(donor.workers - 1);
      this.notify(
        p.name +
          ' moves from the ' +
          structureSpec(donor.kind).name +
          ' to the ' +
          structureSpec(to.kind).name,
      );
      this.recount();
      return;
    }
  }
}
export function recount(this: ConstructionTown): void {
  for (const item of this.placed) item.workers = 0;
  for (const person of this.folk)
    if (person.job >= 0) for (const item of this.placed) if (item.id === person.job) ++item.workers;
}
export function employed(this: ConstructionTown): number {
  let total = 0;
  for (const item of this.placed) total = f32(total + item.workers);
  return total;
}
export function staff(this: ConstructionTown): void {
  this.recount();
  for (const farms of [true, false])
    for (const item of this.placed) {
      if ((item.kind === Structure.Farm) !== farms || !item.built()) continue;
      let cap = item.wanted < 0 ? structureSpec(item.kind).jobs : item.wanted;
      if (this.titleAutoplay && structureSpec(item.kind).product === Product.Food)
        cap = Math.min(cap, Math.max(1, Math.trunc((this.population() + 3) / 4)));
      for (const person of this.folk) {
        if (item.workers >= cap) break;
        if (
          person.role !== Role.Resident ||
          person.job >= 0 ||
          !person.autoMode ||
          person.ordered ||
          this.settlementOf(person) !== this.settlementOf(item)
        )
          continue;
        if (this.titleAutoplay && person.id === this.titleBuilder) continue;
        person.job = item.id;
        ++item.workers;
      }
    }
}
export function roadAccess(this: ConstructionTown, footprint: Footprint): boolean {
  return this.network
    .segments()
    .some((segment) => touches(footprint, segment.a, segment.b, f32(TownState.roadHalfWidth + f32(0.7))));
}
export function constructionRoad(this: ConstructionTown, id: number): number {
  const place = this.building(id);
  if (!place || place.built() || place.progress > 0) return -1;
  const footprint = place.footprint(),
    margin = f32(TownState.roadHalfWidth + f32(0.7));
  let best = Infinity,
    found = -1;
  for (const road of this.network.roads()) {
    let beside = false;
    for (let i = 1; i < road.line.length && !beside; ++i)
      beside = touches(footprint, road.line[f32(i - 1)], road.line[i], margin);
    if (!beside) continue;
    if (this.roadReady(road.id)) {
      const laid = road.laidLine();
      for (let i = 1; i < laid.length; ++i)
        if (touches(footprint, laid[f32(i - 1)], laid[i], margin)) return -1;
    }
    const work = this.network.road(this.roadWorkTarget(road.id));
    if (work && (work.built < 1 || work.wear >= 1)) {
      const gap = distance(work.workPoint(), place.center);
      if (gap < best) {
        best = gap;
        found = work.id;
      }
    }
  }
  return found;
}
export function touchesSettlement(this: ConstructionTown, end: Point): boolean {
  return (
    this.network.distance(end).distance <= TownState.joinReach ||
    this.placed.some((b) => b.footprint().contains(end, TownState.joinReach))
  );
}
export function near(
  this: ConstructionTown,
  center: Point,
  radius: number,
  match: (kind: Structure) => boolean,
): boolean {
  return this.placed.some((b) => match(b.kind) && distance(b.center, center) <= radius);
}
export function nearbyTiles(
  this: ConstructionTown,
  center: Point,
  radius: number,
  match: (tile: Tile) => boolean,
): number {
  let count = 0;
  for (
    let y = f32(Math.trunc(f32(center.y - radius)) - 1);
    y <= f32(Math.trunc(f32(center.y + radius)) + 1);
    ++y
  )
    for (
      let x = f32(Math.trunc(f32(center.x - radius)) - 1);
      x <= f32(Math.trunc(f32(center.x + radius)) + 1);
      ++x
    )
      if (
        this.world.inside(x, y) &&
        distance(point(f32(x + f32(0.5)), f32(y + f32(0.5))), center) <= radius &&
        match(this.world.at(x, y))
      )
        ++count;
  return count;
}
export function clearTrees(this: ConstructionTown, points: Point[]): number {
  let wood = 0;
  for (const p of points) {
    const x = Math.floor(p.x),
      y = Math.floor(p.y);
    if (!this.world.inside(x, y)) continue;
    const cell = this.world.at(x, y);
    wood = f32(wood + f32(cell.trees * 2));
    cell.trees = 0;
  }
  return wood;
}
export function reveal(this: ConstructionTown, x: number, y: number, radius: number): void {
  this.world.reveal(x, y, radius);
  const discovered = this.world.discover();
  if (discovered.length) ++this.changes;
  for (const site of discovered) {
    const found = this.world.dungeons()[site];
    this.notify(
      'Discovered ' +
        found.name +
        (found.kind === DungeonKind.GiantHall
          ? ', home to neutral coastal giants'
          : ', a way to ' + worldName(this.world.destination(found))),
    );
  }
}
export function takeNotice(this: ConstructionTown): string {
  if (!this.notices.length) return '';
  const text = this.notices.shift()!;
  let repeats = 1;
  while (this.notices.length && this.notices[0] === text) {
    this.notices.shift();
    ++repeats;
  }
  return repeats > 1 ? text + ' (x' + repeats + ')' : text;
}
