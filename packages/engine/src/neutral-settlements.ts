import type { Town } from './town';
import { Activity, Role, type Person } from './person';
import { Resources, Structure, isSeat, resourceKeys } from './building-catalog';
import { add, distance, point, rotated, type Point } from './geometry';
import { NeutralSettlement } from './neutral-state';
import { neutralContext, commitNeutralContext, refreshNeutralNavigation } from './neutral-context';
import { resourceBundle } from './construction-materials';

export const defectionPolicy = {
  stockShare: 0.15,
  theftLimit: new Resources(20, 12, 8, 8, 0, 8, 4, 4),
  planningSeconds: 8,
} as const;
const firstTick = new WeakMap<Town, Set<number>>();

export function defect(this: Town, p: Person): void {
  if (p.faction !== 0 || p.role !== Role.Resident) return;
  const source = this.stock(this.settlementOf(p)),
    state = new NeutralSettlement(p.id + 1, p.id, { ...p.position });
  for (const key of resourceKeys) {
    const amount = Math.min(
      source[key],
      defectionPolicy.theftLimit[key],
      Math.ceil(source[key] * defectionPolicy.stockShare),
    );
    source[key] -= amount;
    state.stock[key] = amount;
  }
  if (p.carrying) state.stock.add(resourceBundle(p.carriedProduct, p.carrying));
  state.dice = (this.world.seed() ^ Math.imul(p.id + 1, 0x9e3779b1)) >>> 0 || 1;
  state.builder = p.id;
  p.faction = state.faction;
  p.stressRecovery = false;
  p.home = p.bed = p.job = p.village = -1;
  p.task = p.activity = Activity.Idle;
  p.taskSite = p.target = p.foe = p.tree = p.supplyTarget = p.attackPerson = -1;
  p.ordered = p.approachingOrder = p.aggressive = p.hunting = p.supplyRoad = false;
  p.carrying = 0;
  p.path = [];
  p.inside = false;
  p.autoMode = true;
  p.until = this.time;
  p.recoveringHealth = p.recoveringRest = false;
  this.neutralSettlements.push(state);
  let skipped = firstTick.get(this);
  if (!skipped) {
    skipped = new Set();
    firstTick.set(this, skipped);
  }
  skipped.add(state.faction);
  this.recount();
  ++this.changes;
  this.notify(`${p.name} has left with supplies to found an independent village.`);
}

function foundingSite(root: Town, town: Town, founder: Person): Point | null {
  const sites = [...root.world.dungeons()].sort(
    (a, b) => distance(a.origin, founder.position) - distance(b.origin, founder.position),
  );
  const known = town.world.revealed;
  // The neutral planner may seek its own distant village without exposing that
  // route or its destination to the player's exploration map.
  town.world.revealed = () => true;
  try {
    for (const site of sites) {
      const center = point(site.origin.x + 1, site.origin.y + 1);
      for (let radius = 4; radius <= 10; radius += 2)
        for (let direction = 0; direction < 24; ++direction) {
          const at = add(center, rotated(point(radius, 0), (direction * Math.PI) / 12));
          if (root.placed.some((b) => isSeat(b.kind) && distance(at, b.center) < 50)) continue;
          if (!town.canPlace(Structure.Camp, at, 0).ok) continue;
          if (
            !town.grid.path(
              founder.inside || founder.crossingDoorway() ? founder.entrance : founder.position,
              at,
            ).length
          )
            continue;
          return at;
        }
    }
  } finally {
    town.world.revealed = known;
  }
  return null;
}

export function advanceNeutralSettlements(this: Town, dt: number): void {
  if (this.controlFaction !== 0 || dt <= 0) return;
  for (const state of this.neutralSettlements) {
    if (firstTick.get(this)?.delete(state.faction)) continue;
    const town = neutralContext(this, state);
    let founder = town.person(state.founder);
    if (state.camp >= 0 && !town.camp(state.camp)) state.camp = -1;
    if (!town.folk.some((p) => p.health > 0) && !town.placed.some((b) => b.devotionDueDay >= 0)) continue;
    // A village outlives its founder. Choose a stable successor before planning
    // a replacement Camp, rather than falling back to the player's world start.
    if (!founder || founder.health <= 0) {
      founder =
        town.folk.filter((p) => p.role === Role.Resident && p.health > 0).sort((a, b) => a.id - b.id)[0] ??
        null;
      if (founder) {
        state.founder = state.builder = town.titleBuilder = founder.id;
        state.planAt = this.time;
      }
    }
    // Arrival must claim a site before the ordinary homeless wander schedule
    // chooses a route back toward the world's original starting location.
    if (
      state.camp < 0 &&
      founder?.task === Activity.Moving &&
      !founder.moving() &&
      distance(founder.position, state.destination) < 0.5
    ) {
      town.resumeOrder(founder);
      state.planAt = this.time;
    }
    if (this.time >= state.planAt) {
      state.planAt = this.time + defectionPolicy.planningSeconds;
      if (state.camp < 0 && founder) {
        if (distance(founder.position, state.destination) < 0.5 || !founder.moving()) {
          const destination = foundingSite(this, town, founder);
          if (destination) state.destination = destination;
        }
        if (distance(founder.position, state.destination) > 0.5) {
          if (
            !founder.moving() ||
            founder.task !== Activity.Moving ||
            distance(founder.goal, state.destination) > 0.1
          )
            town.orderMove([founder.id], state.destination);
        } else {
          town.maintainTitleBuilder();
          town.planTitleWork();
        }
      } else {
        town.maintainTitleBuilder();
        town.planTitleWork();
      }
      for (const person of town.folk)
        if (
          person.role === Role.Resident &&
          ![Activity.Moving, Activity.Fighting, Activity.Praying, Activity.Training].includes(person.task)
        )
          person.ordered = false;
    }
    // Planner changes can add obstacles; navigation always includes foreign walls.
    if (town.walkRevision !== town.changes) refreshNeutralNavigation(this, town);
    town.tick(dt);
    commitNeutralContext(this, town, state);
  }
}
