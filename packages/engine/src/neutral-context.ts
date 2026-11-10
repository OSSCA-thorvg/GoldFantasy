import type { Town } from './town';
import { TownState } from './town-state';
import { WorldMap } from './world-map';
import { CampEconomy } from './camp-economy';
import { Building, Check } from './town-models';
import { Resources, Structure, isSeat, structureSpec } from './building-catalog';
import { Footprint, distance, overlaps } from './geometry';
import { constructionProducts, resourceAmount, resourceBundle } from './construction-materials';
import type { NeutralSettlement } from './neutral-state';
import { flatten } from './road-network';
import { touches } from './town-construction';

interface CachedContext {
  town: Town;
  revision: bigint;
}
const contexts = new WeakMap<Town, Map<number, CachedContext>>();

/** Shared simulation and planner, with faction-local entities, economy and sight. */
export function neutralContext(root: Town, state: NeutralSettlement): Town {
  let cache = contexts.get(root);
  if (!cache) {
    cache = new Map();
    contexts.set(root, cache);
  }
  let entry = cache.get(state.faction);
  if (!entry) {
    // This map view shares terrain/resources, but never writes player exploration.
    const world: WorldMap = Object.create(root.world);
    world.seen = [];
    world.sites = root.world.sites.map((site) => ({ ...site, discovered: true }));
    // The Town prototype supplies the same simulation methods; constructor state
    // is separate and deliberately contains no player founders or initial stock.
    const town = Object.assign(Object.create(Object.getPrototypeOf(root)), new TownState(world)) as Town;
    town.controlFaction = state.faction;
    town.titleAutoplay = false;
    town.neutralSettlements = [];
    const inSight = (at: { x: number; y: number }, margin = 0): boolean =>
      town.folk.some((p) => p.health > 0 && distance(p.position, at) + margin <= 12) ||
      town.placed.some((b) => distance(b.center, at) + margin <= 12);
    world.revealed = (at) => inSight(at);
    world.revealedWithin = (at, margin) => inSight(at, margin);
    world.reveal = () => false;
    world.discover = () => [];
    town.reveal = () => {};
    town.stir = () => {};
    town.admitGuests = () => {};
    town.advanceNeutralSettlements = () => {};
    town.notify = () => {};
    town.recordReceipt = () => {};
    const canPlace = town.canPlace,
      place = town.place,
      canBuildRoad = town.canBuildRoad,
      canPlantField = town.canPlantField;
    town.canPlace = (kind, at, angle) => {
      const check = canPlace.call(town, kind, at, angle);
      if (!check.ok) return check;
      const footprint = new Footprint(at, structureSpec(kind).size / 2, angle);
      for (const b of root.placed) {
        if (b.faction === state.faction) continue;
        if (kind === Structure.Camp && isSeat(b.kind) && distance(at, b.center) < 50)
          return new Check(false, 'Camps must be at least 50 tiles apart');
        if (footprint.overlaps(b.footprint())) return new Check(false, 'Occupied');
      }
      for (const field of root.farmland)
        if (field.faction !== state.faction && overlaps(footprint.corners(), field.outline))
          return new Check(false, 'Fields in the way');
      for (const segment of root.network.segments())
        if (
          root.network.road(segment.road)?.faction !== state.faction &&
          touches(footprint, segment.a, segment.b, TownState.roadHalfWidth)
        )
          return new Check(false, 'On the road');
      return check;
    };
    town.canBuildRoad = (path) => {
      const check = canBuildRoad.call(town, path);
      if (!check.ok) return check;
      const line = flatten(path);
      if (
        root.placed.some(
          (b) =>
            b.faction !== state.faction &&
            line.some((at) => b.footprint().contains(at, TownState.roadHalfWidth)),
        )
      )
        return new Check(false, 'Occupied');
      return check;
    };
    town.canPlantField = (outline) => {
      const check = canPlantField.call(town, outline);
      if (!check.ok) return check;
      if (
        root.placed.some((b) => b.faction !== state.faction && overlaps(outline, b.footprint().corners())) ||
        root.farmland.some((field) => field.faction !== state.faction && overlaps(outline, field.outline))
      )
        return new Check(false, 'Occupied');
      return check;
    };
    town.place = (kind, at, angle) => {
      if (!place.call(town, kind, at, angle)) return false;
      const building = town.placed.at(-1)!;
      building.faction = state.faction;
      if (kind === Structure.Camp) {
        // Travelling supplies become real construction deliveries, not free stock.
        const stock = town.stock(building.id);
        for (const product of constructionProducts) {
          const amount = Math.min(building.materials.missing(product), resourceAmount(stock, product));
          const cargo = resourceBundle(product, amount);
          stock.subtract(cargo);
          building.materials.delivered.add(cargo);
        }
        state.camp = building.id;
      }
      return true;
    };
    entry = { town, revision: -1n };
    cache.set(state.faction, entry);
  }
  const town = entry.town;
  town.folk = root.folk.filter((p) => p.faction === state.faction);
  town.placed = root.placed.filter((b) => b.faction === state.faction);
  town.villages = root.villages.filter((v) => v.faction === state.faction);
  town.provisions = new CampEconomy(-1, state.stock);
  town.provisions.faction = state.faction;
  town.farmland = root.farmland.filter((field) => field.faction === state.faction);
  town.network.list = root.network.list.filter((road) => road.faction === state.faction);
  town.network.nextId = root.network.nextId;
  town.beasts = root.beasts;
  town.animals = root.animals;
  town.sky = root.sky;
  town.time = root.time;
  town.days = root.days;
  town.nextId = root.nextId;
  town.nextPerson = root.nextPerson;
  town.nextBlow = root.nextBlow;
  town.nextTreeEvent = root.nextTreeEvent;
  town.nextAnimalCall = root.nextAnimalCall;
  town.nextDevotionEvent = root.nextDevotionEvent;
  town.blows = root.blows;
  town.timberEvents = root.timberEvents;
  town.animalCalls = root.animalCalls;
  town.altarEvents = root.altarEvents;
  town.changes = root.changes;
  town.roadChanges = root.roadChanges;
  town.roadOnlyChanges = root.roadOnlyChanges;
  town.dice = state.dice;
  town.titleBuilder = state.builder;
  town.titleFoodUntil = state.foodUntil;
  if (entry.revision !== root.changes) refreshNeutralNavigation(root, town);
  entry.revision = root.changes;
  return town;
}

export function refreshNeutralNavigation(root: Town, town: Town): void {
  town.grid.rebuild(
    root.world,
    root.network,
    root.placed.filter((b) => b.built() && b.kind !== Structure.Torch).map((b) => b.footprint()),
  );
  town.walkRevision = town.changes;
}

/** Commit local additions and shared counters; unrelated factions retain their objects. */
export function commitNeutralContext(root: Town, town: Town, state: NeutralSettlement): void {
  const faction = state.faction;
  for (const p of town.folk) p.faction = faction;
  for (const b of town.placed) b.faction = faction;
  for (const v of town.villages) v.faction = faction;
  for (const road of town.network.list) road.faction = faction;
  for (const field of town.farmland) field.faction = faction;
  root.folk = root.folk.filter((p) => p.faction !== faction).concat(town.folk);
  root.placed = root.placed.filter((b) => b.faction !== faction).concat(town.placed);
  root.villages = root.villages.filter((v) => v.faction !== faction).concat(town.villages);
  root.farmland = root.farmland.filter((field) => field.faction !== faction).concat(town.farmland);
  root.network.list = root.network.list.filter((road) => road.faction !== faction).concat(town.network.list);
  root.network.nextId = town.network.nextId;
  root.nextId = town.nextId;
  root.nextPerson = town.nextPerson;
  root.nextBlow = town.nextBlow;
  root.nextTreeEvent = town.nextTreeEvent;
  root.nextAnimalCall = town.nextAnimalCall;
  root.nextDevotionEvent = town.nextDevotionEvent;
  root.blows = town.blows;
  root.timberEvents = town.timberEvents;
  root.animalCalls = town.animalCalls;
  root.altarEvents = town.altarEvents;
  root.changes = town.changes;
  root.roadChanges = town.roadChanges;
  root.roadOnlyChanges = town.roadOnlyChanges;
  state.stock = state.camp < 0 ? town.provisions.stock : new Resources();
  state.builder = town.titleBuilder;
  state.foodUntil = town.titleFoodUntil;
  state.dice = town.dice;
}
