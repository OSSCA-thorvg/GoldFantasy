// Where the title player puts things: building plots along the roads (or around the camp before there are any),
// the road that joins a new door to the network, and a field beside the farmhouse. Every answer is checked with
// the same rules the placement preview shows the player.
import type { Town } from '../../../../packages/engine/src/town';
import { TownState } from '../../../../packages/engine/src/town-state';
import { Building, type Placement } from '../../../../packages/engine/src/town-models';
import { Structure, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { Footprint, add, distance, normalized, point, scale, sub, type Outline, type Point } from '../../../../packages/engine/src/geometry';
import { freehandRoad, sharpAnchor, type RoadPath } from '../../../../packages/engine/src/road-network';
import { hash01 } from '../../../../packages/engine/src/numeric';
import { isPlayerBuilding } from '../../../../packages/engine/src/faction';
import { placementVariant } from '../../../../packages/engine/src/town-construction';

/** Candidate plots tried per search; each is one `fit` and one `canPlace`. */
const plotBudget = 160;
const ringAngles = 16;

const ownBuildings = (town: Town): Building[] => town.buildings().filter(isPlayerBuilding);

/** Where a kind is best placed: crafts and homes by the fire, yards by their forest or rock, the farm in the open. */
function anchorOf(town: Town, kind: Structure, camp: Point): Point {
  if (kind === Structure.Farm || kind === Structure.Shrine) {
    // Away from the busy centre, toward the side with the fewest buildings.
    let x = 0,
      y = 0;
    for (const b of ownBuildings(town)) {
      x += b.center.x - camp.x;
      y += b.center.y - camp.y;
    }
    const away = Math.hypot(x, y) > 0.5 ? normalized(point(-x, -y)) : point(1, 0.4);
    return add(camp, scale(away, kind === Structure.Farm ? 5 : 3));
  }
  return camp;
}
/** The ray the main street will take out of the camp door, kept clear before it is laid. */
function streetCorridor(town: Town): { from: Point; dir: Point } | null {
  const seat = town.camp();
  if (!seat || !town.roads().empty()) return null;
  const from = seat.door();
  return { from, dir: normalized(sub(from, seat.center)) };
}
const offStreet = (corridor: { from: Point; dir: Point } | null, at: Point, clear: number): boolean => {
  if (!corridor) return true;
  const rel = sub(at, corridor.from),
    along = rel.x * corridor.dir.x + rel.y * corridor.dir.y,
    across = Math.abs(rel.x * corridor.dir.y - rel.y * corridor.dir.x);
  return along < -clear || along > 10 + clear || across > clear;
};
/** Plots beside the roads first, so doors face a road; then rings around the anchor. */
function candidates(town: Town, kind: Structure, anchor: Point, seed: number, salt: number): Point[] {
  const out: { p: Point; s: number }[] = [],
    half = structureSpec(kind).size / 2,
    reach = TownState.campReach,
    jitter = (p: Point) => hash01(seed, Math.round(p.x * 4), Math.round(p.y * 4), salt) * 1.5;
  for (const road of town.roads().roads())
    for (let i = 1; i < road.line.length; ++i) {
      const a = road.line[i - 1],
        b = road.line[i],
        along = distance(a, b),
        dir = along > 1e-3 ? scale(sub(b, a), 1 / along) : point(1, 0),
        normal = point(-dir.y, dir.x);
      for (let s = 0.4; s < along; s += 1.1)
        for (const side of [1, -1]) {
          const at = add(add(a, scale(dir, s)), scale(normal, side * (half + 0.9)));
          if (distance(at, anchor) <= reach) out.push({ p: at, s: distance(at, anchor) + jitter(at) });
        }
    }
  // Off the streets a plot ranks behind every plot beside one.
  const corridor = streetCorridor(town),
    penalty = out.length ? 6 : 0,
    turn = hash01(seed, kind, salt, 71) * Math.PI * 2;
  for (let r = 2 + half; r <= reach; r += 0.9)
    for (let i = 0; i < ringAngles; ++i) {
      const angle = turn + (i * Math.PI * 2) / ringAngles,
        at = point(anchor.x + r * Math.cos(angle), anchor.y + r * Math.sin(angle));
      if (offStreet(corridor, at, half + 1.1)) out.push({ p: at, s: distance(at, anchor) + jitter(at) + penalty });
    }
  return out.sort((a, b) => a.s - b.s).map((c) => c.p);
}
/** A plot the town accepts for `kind`, or null when none is found within the budget. */
export function plotFor(town: Town, kind: Structure, seed: number, salt = 0): Placement | null {
  const seat = town.camp();
  const camp = seat ? seat.center : town.map().camp();
  if (kind === Structure.Camp) {
    for (const p of [camp, ...candidates(town, kind, camp, seed, salt).slice(0, plotBudget)]) {
      const spot = town.fit(kind, p, 0);
      if (town.canPlace(kind, spot.center, spot.angle).ok) return spot;
    }
    return null;
  }
  const anchor = anchorOf(town, kind, camp),
    corridor = streetCorridor(town),
    half = structureSpec(kind).size / 2;
  let tried = 0;
  for (const p of candidates(town, kind, anchor, seed, salt)) {
    if (++tried > plotBudget) break;
    const spot = town.fit(kind, p, 0);
    if (distance(spot.center, camp) > TownState.campReach || !offStreet(corridor, spot.center, half + 0.9)) continue;
    if (town.canPlace(kind, spot.center, spot.angle).ok) return spot;
  }
  return null;
}
/** True when a plot's footprint reaches a road, so its door needs no road of its own. */
export function besideRoad(town: Town, kind: Structure, spot: Placement): boolean {
  return town.roadAccess(new Footprint(spot.center, structureSpec(kind).size / 2, spot.angle));
}
/** The door a building of `kind` would have at `spot`, as `canPlace` measures it. */
export function doorAt(town: Town, kind: Structure, spot: Placement): Point {
  return new Building(-1, kind, { ...spot.center }, spot.angle, placementVariant(town.map(), kind, spot.center)).door();
}
/** A road from `from` to `to`: straight when it fits, else along the walking path between the buildings. */
export function routedRoad(town: Town, from: Point, to: Point): RoadPath | null {
  const straight = [sharpAnchor(from), sharpAnchor(to)];
  if (town.canBuildRoad(straight).ok) return straight;
  const steps = town.grid.path(from, to);
  if (!steps.length) return null;
  const points: Point[] = [from];
  for (const p of steps) if (distance(p, points[points.length - 1]) >= 0.7) points.push(p);
  if (distance(points[points.length - 1], to) > 0.05) points.push(to);
  for (const tolerance of [0.25, 0.1]) {
    const path = freehandRoad(points, tolerance);
    if (path.length >= 2 && town.canBuildRoad(path).ok) return path;
  }
  const corners = points.filter((_, i) => i === 0 || i === points.length - 1 || i % 2 === 0).map((p) => sharpAnchor(p));
  return corners.length >= 2 && town.canBuildRoad(corners).ok ? corners : null;
}
/** A road from the nearest road to the building's door; null when it already has one or none fits. */
export function roadToDoor(town: Town, site: Building): RoadPath | null {
  const network = town.roads();
  if (network.empty() || town.roadAccess(site.footprint())) return null;
  const door = site.door(),
    near = network.distance(door);
  if (!near.onRoad || near.distance < 0.6 || near.distance > TownState.maxRoadLength * 0.6) return null;
  const out = normalized(sub(door, site.center));
  for (const reach of [0.2, 0.5]) {
    const path = routedRoad(town, near.onRoad, add(door, scale(out, reach)));
    if (path) return path;
  }
  return null;
}
/** The settlement's main street: out of the camp door, as straight as the ground allows. */
export function firstRoad(town: Town, seed: number): RoadPath | null {
  const seat = town.camp();
  if (!seat) return null;
  const from = seat.door(),
    out = normalized(sub(from, seat.center)),
    heading = Math.atan2(out.y, out.x),
    lean = hash01(seed, 3, 5, 72) < 0.5 ? 1 : -1;
  for (const length of [9, 7, 5])
    for (let i = 0; i < 12; ++i) {
      const angle = heading + lean * (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 0.35,
        end = add(from, point(length * Math.cos(angle), length * Math.sin(angle))),
        bend = add(from, point((length / 2) * Math.cos(heading), (length / 2) * Math.sin(heading))),
        path =
          i === 0
            ? [sharpAnchor(from), sharpAnchor(end)]
            : [sharpAnchor(from), { point: bend, in: bend, out: bend }, sharpAnchor(end)];
      if (town.canBuildRoad(path).ok) return path;
    }
  return null;
}
/** A branch off the roads toward open ground, for a village that has filled its streets. */
export function branchRoad(town: Town, seed: number, salt: number): RoadPath | null {
  const seat = town.camp(),
    segments = town.roads().builtSegments();
  if (!seat || !segments.length) return null;
  for (let tries = 0; tries < 24; ++tries) {
    const segment = segments[Math.floor(hash01(seed, salt, tries, 74) * segments.length) % segments.length],
      t = hash01(seed, salt, tries, 75),
      at = point(segment.a.x + (segment.b.x - segment.a.x) * t, segment.a.y + (segment.b.y - segment.a.y) * t),
      dir = normalized(sub(segment.b, segment.a)),
      side = hash01(seed, salt, tries, 76) < 0.5 ? 1 : -1,
      end = add(at, scale(point(-dir.y * side, dir.x * side), 6));
    if (distance(end, seat.center) > TownState.campReach - 1) continue;
    const path = [sharpAnchor(at), sharpAnchor(end)];
    if (town.canBuildRoad(path).ok) return path;
  }
  return null;
}
/** A field of about six acres within the farmhouse's reach, or null. */
export function fieldBeside(town: Town, farm: Building, seed: number, salt = 0): Outline | null {
  const turn = hash01(seed, farm.id, salt, 73) * Math.PI * 2;
  for (let r = 2.6; r < TownState.farmReach; r += 0.8)
    for (let i = 0; i < 12; ++i) {
      const angle = turn + (i * Math.PI) / 6,
        c = point(farm.center.x + r * Math.cos(angle), farm.center.y + r * Math.sin(angle)),
        wide = i % 2 ? 1.5 : 1.1,
        deep = i % 2 ? 1.1 : 1.5,
        outline = [
          point(c.x - wide, c.y - deep),
          point(c.x + wide, c.y - deep),
          point(c.x + wide, c.y + deep),
          point(c.x - wide, c.y + deep),
        ];
      if (town.canPlantField(outline).ok) return outline;
    }
  return null;
}
