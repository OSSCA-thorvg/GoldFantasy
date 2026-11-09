import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Layer, Terrain, DungeonKind, makeTile } from '../../packages/engine/src/world-types';
import { Activity, Person, Role, Calling, Race } from '../../packages/engine/src/person';
import { Building, Field } from '../../packages/engine/src/town-models';
import { Resources, Structure, resourceKeys } from '../../packages/engine/src/building-catalog';
import { point, distance } from '../../packages/engine/src/geometry';
import { updateStress, stressPolicy } from '../../packages/engine/src/stress-control';
import { defect } from '../../packages/engine/src/neutral-settlements';
import { canControl } from '../../packages/engine/src/faction';
import { encodeTown, decodeTown } from '../../packages/engine/src/save-game';
import { sharpAnchor } from '../../packages/engine/src/road-network';

function fixture() {
  const world = new WorldMap();
  world.columns = world.rows = 96;
  world.mapSeed = 5;
  world.origin = { x: 10, y: 10 };
  world.laidOut = false;
  world.tiles = Array.from({ length: 96 * 96 }, () => ({ ...makeTile(), terrain: Terrain.Grass }));
  world.layers = Array.from({ length: Layer.Count }, () => new Float32Array(193 * 193).fill(0.4));
  world.layer(Layer.Land).fill(1);
  world.layer(Layer.Ridge).fill(-1);
  world.sites = [
    { name: 'Old cavern', kind: DungeonKind.Cave, origin: { x: 13, y: 13 }, discovered: false },
    { name: 'Distant cavern', kind: DungeonKind.Cave, origin: { x: 75, y: 70 }, discovered: false },
  ];
  for (let y = 60; y < 84; ++y) for (let x = 65; x < 90; ++x) if ((x + y) % 5 === 0) world.at(x, y).trees = 3;
  world.reveal(10, 10, 8);
  const town = new Town(world, 96, false),
    camp = new Building(0, Structure.Camp, point(10, 10), 0, 0);
  town.placed.push(camp);
  town.nextId = 1;
  town.migrateSettlements();
  Object.assign(town.stock(), new Resources(500, 500, 500, 500, 500, 500, 100, 100));
  const p = new Person(0, 'Overworked founder', Role.Resident, Calling.Settler, Race.Human, 0, camp.door());
  p.home = p.village = 0;
  p.food = p.rest = p.health = p.hydration = 1;
  town.folk = [p];
  town.nextPerson = 1;
  town.editHour(12);
  town.wildlifeDay = 0;
  town.tick(0);
  return { town, p, camp };
}

function abandonedSettlement() {
  const { town, p } = fixture();
  defect.call(town, p);
  for (let i = 0; i < 3000; ++i) {
    town.wildlifeDay = town.days;
    town.advance(0.1);
  }
  const state = town.neutralSettlements[0],
    camp = town.camp(state.camp)!;
  expect(camp?.built()).toBe(true);
  const id = town.network.add(
      [
        sharpAnchor(point(camp.center.x + 1.2, camp.center.y)),
        sharpAnchor(point(camp.center.x + 5, camp.center.y)),
      ],
      1,
    ),
    road = Object.assign(town.network.road(id)!, { village: camp.id, faction: state.faction }),
    field = Object.assign(
      new Field(town.nextId++, [point(86, 86), point(88, 86), point(88, 88), point(86, 88)], camp.id),
      { faction: state.faction },
    );
  town.farmland.push(field);
  town.folk = [];
  town.raze(camp.id);
  return { town, state, road, field };
}

describe('stress recovery and independent settlements', () => {
  it('can immediately save an abandoned neutral village after its Camp is destroyed', () => {
    const { town, state } = abandonedSettlement();
    expect(() => decodeTown(encodeTown(town), (map) => new Town(map, 96, false, true))).not.toThrow();
    expect(state.camp).toBe(-1);
    town.advance(0.1);
    expect(() => decodeTown(encodeTown(town), (map) => new Town(map, 96, false, true))).not.toThrow();
  });

  it('keeps orphaned neutral roads and fields out of the player settlement', () => {
    const { town, state, road, field } = abandonedSettlement();
    expect(road.village).toBe(-1);
    expect(field.village).toBe(-1);
    expect(road.faction).toBe(state.faction);
    expect(field.faction).toBe(state.faction);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 96, false, true));
    expect(loaded.network.road(road.id)?.faction).toBe(state.faction);
    expect(loaded.farmland.find((f) => f.id === field.id)?.faction).toBe(state.faction);
  });

  it('chooses a surviving resident to rebuild after its founder and Camp are lost', () => {
    const { town, state, road, field } = abandonedSettlement();
    const survivor = new Person(
      town.nextPerson++,
      'Surviving child',
      Role.Resident,
      Calling.Settler,
      Race.Human,
      1,
      { ...state.destination },
    );
    survivor.faction = state.faction;
    survivor.food = survivor.rest = survivor.health = survivor.hydration = 1;
    town.folk.push(survivor);
    state.planAt = town.time;
    town.advance(0.1);
    expect(state.founder).toBe(survivor.id);
    expect(state.builder).toBe(survivor.id);
    expect(distance(state.destination, town.world.start())).toBeGreaterThan(50);
    expect(canControl(survivor)).toBe(false);
    expect(town.network.road(road.id)).toBe(road);
    expect(town.farmland.find((item) => item.id === field.id)).toBe(field);
    expect(road.faction).toBe(state.faction);
    expect(field.faction).toBe(state.faction);
    expect(() => decodeTown(encodeTown(town), (map) => new Town(map, 96, false, true))).not.toThrow();
  });
  it('enters a breakdown from actual hungry work and keeps recovery hysteresis across ticks', () => {
    const { town, p } = fixture();
    const mill = new Building(town.nextId++, Structure.Sawmill, point(15, 15), 0, 0);
    mill.village = 0;
    town.placed.push(mill);
    ++town.changes;
    expect(town.assignJob([p.id], mill.id)).toBe(true);
    for (let i = 0; i < 100; ++i) town.advance(0.1);
    expect(p.activity).toBe(Activity.Working);
    p.food = 0.1;
    p.stress = 0.8499;
    town.advance(0.1);
    expect(p.stressRecovery).toBe(true);
    expect(p.lastBreakdownAt).toBe(town.time);
    const began = p.lastBreakdownAt;
    for (let i = 0; i < 100; ++i) {
      town.advance(0.1);
      expect([Activity.Idle, Activity.Sleeping]).toContain(p.activity);
      expect(p.lastBreakdownAt).toBe(began);
    }
    expect(p.food).toBeGreaterThan(0.9);
    expect(town.neutralSettlements).toHaveLength(0);
  });
  it('suspends overwork, rejects commands and recovers with hysteresis in its own home', () => {
    const { town, p, camp } = fixture();
    p.stress = 0.9;
    p.activity = Activity.Working;
    p.task = Activity.Working;
    p.job = camp.id;
    expect(updateStress.call(town, p, 0.1)).toBe(true);
    expect(p.stressRecovery).toBe(true);
    expect(canControl(p)).toBe(false);
    const task = p.task;
    town.orderMove([p.id], point(20, 20));
    expect(p.task).toBe(task);
    for (let i = 0; i < 20; ++i) town.advance(0.1);
    expect(p.inside).toBe(true);
    expect(p.activity).toBe(Activity.Sleeping);
    p.stress = stressPolicy.recovered;
    expect(updateStress.call(town, p, 0.1)).toBe(false);
    expect(canControl(p)).toBe(true);
    expect(p.job).toBe(camp.id);
  });

  it('does not defect for a first breakdown or an episode outside the seven-day window', () => {
    const { town, p } = fixture();
    p.stress = 0.9;
    updateStress.call(town, p, 0.1);
    expect(p.faction).toBe(0);
    expect(town.neutralSettlements).toHaveLength(0);
    p.stressRecovery = false;
    p.lastBreakdownAt = town.time - 7 * 300 - 1;
    town.time = 3000;
    p.lastBreakdownAt = town.time - 7 * 300 - 1;
    p.stress = 0.9;
    updateStress.call(town, p, 0.1);
    expect(p.faction).toBe(0);
    expect(town.neutralSettlements).toHaveLength(0);
  });

  it('restores control through metered rest instead of an immediate Idle stress reset', () => {
    const { town, p } = fixture();
    p.stress = 0.9;
    town.advance(0.1);
    expect(p.stressRecovery).toBe(true);
    expect(p.stress).toBeGreaterThan(0.89);
    let recoveryTicks = 0;
    while (p.stressRecovery && recoveryTicks < 2500) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
      ++recoveryTicks;
    }
    expect(recoveryTicks).toBeGreaterThan(1000);
    expect(p.stressRecovery).toBe(false);
    expect(p.stress).toBeLessThanOrEqual(stressPolicy.recovered);
    expect(canControl(p)).toBe(true);
    expect(p.faction).toBe(0);
  });

  it('defects on the second recent breakdown and transfers only finite local supplies', () => {
    const { town, p } = fixture();
    p.stress = 0.9;
    updateStress.call(town, p, 0.1);
    p.stress = 0.3;
    updateStress.call(town, p, 0.1);
    const before = town.stock().clone();
    p.stress = 0.9;
    town.time += 1;
    updateStress.call(town, p, 0.1);
    expect(p.faction).toBeGreaterThan(0);
    expect(canControl(p)).toBe(false);
    expect(p.job).toBe(-1);
    expect(p.home).toBe(-1);
    expect(town.neutralSettlements).toHaveLength(1);
    const state = town.neutralSettlements[0];
    for (const key of resourceKeys) {
      expect(state.stock[key] + town.stock()[key]).toBe(before[key]);
      expect(state.stock[key]).toBeGreaterThanOrEqual(0);
    }
    expect(state.stock.wood).toBe(12);
    expect(town.isTitleAutoplay()).toBe(false);
  });

  it('keeps the isolated planner separate from global clock, title state and player resources', () => {
    const { town, p } = fixture();
    defect.call(town, p);
    const stock = town.stock().clone(),
      seen = JSON.stringify(town.world.sights());
    for (let i = 0; i < 3000; ++i) {
      town.time += 0.1;
      const clock = town.time;
      town.advanceNeutralSettlements(0.1);
      expect(town.time).toBe(clock);
    }
    const state = town.neutralSettlements[0];
    expect(
      state.camp,
      JSON.stringify({ state, activity: Activity[p.activity], position: p.position }),
    ).toBeGreaterThanOrEqual(0);
    expect(town.building(state.camp)?.built()).toBe(true);
    expect(town.stock()).toEqual(stock);
    expect(JSON.stringify(town.world.sights())).toBe(seen);
    expect(town.titleAutoplay).toBe(false);
  });

  it('does not metabolize a newly defecting resident twice in the same live tick', () => {
    const { town, p } = fixture();
    p.lastBreakdownAt = town.time - 1;
    p.stress = 0.9;
    const food = p.food;
    town.advance(0.1);
    expect(p.faction).toBeGreaterThan(0);
    expect(p.food).toBe(Math.fround(food - Math.fround(Math.fround(0.1) * Math.fround(0.1 / 300))));
    expect(town.neutralSettlements[0].planAt).toBe(0);
  });

  it('continues a saved neutral journey without taking the player treasury or changing faction', () => {
    const { town, p } = fixture();
    defect.call(town, p);
    town.advance(0.1);
    town.advance(0.1);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 96, false, true));
    const stock = loaded.stock().clone(),
      faction = p.faction;
    for (let i = 0; i < 3000; ++i) {
      loaded.wildlifeDay = loaded.days;
      loaded.advance(0.1);
    }
    const state = loaded.neutralSettlements[0];
    expect(state.faction).toBe(faction);
    expect(loaded.building(state.camp)?.built()).toBe(true);
    expect(loaded.person(p.id)?.faction).toBe(faction);
    expect(loaded.stock()).toEqual(stock);
    expect(loaded.controlFaction).toBe(0);
    expect(loaded.titleAutoplay).toBe(false);
  });

  it('keeps two independent founders, treasuries and planner identities separate', () => {
    const { town, p } = fixture();
    town.world.sites.push({
      name: 'Southern cavern',
      kind: DungeonKind.Cave,
      origin: { x: 15, y: 80 },
      discovered: false,
    });
    const other = new Person(1, 'Second founder', Role.Resident, Calling.Settler, Race.Human, 1, {
      ...p.position,
    });
    other.home = other.village = 0;
    other.food = other.rest = other.health = other.hydration = 1;
    town.folk.push(other);
    town.nextPerson = 2;
    defect.call(town, p);
    defect.call(town, other);
    const stock = town.stock().clone();
    for (let i = 0; i < 6000; ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
    }
    expect(town.neutralSettlements).toHaveLength(2);
    const [a, b] = town.neutralSettlements;
    const report = JSON.stringify({
      states: town.neutralSettlements,
      people: town.folk.map((p) => ({
        id: p.id,
        health: p.health,
        activity: Activity[p.activity],
        task: Activity[p.task],
        at: p.position,
        path: p.path.length,
        goal: p.goal,
      })),
    });
    expect(a.camp, report).toBeGreaterThan(0);
    expect(b.camp, report).toBeGreaterThan(0);
    expect(a.camp).not.toBe(b.camp);
    expect(town.camp(a.camp)?.faction).toBe(p.faction);
    expect(town.camp(b.camp)?.faction).toBe(other.faction);
    expect(town.stock(a.camp)).not.toBe(town.stock(b.camp));
    expect(town.stock()).toEqual(stock);
    expect(town.titleBuilder).toBe(-1);
    expect(canControl(p)).toBe(false);
    expect(canControl(other)).toBe(false);
    expect(new Set(town.buildings().map((item) => item.id)).size).toBe(town.buildings().length);
  });

  it('walks away, builds a real neutral Camp and runs the shared planner without touching player stock or fog', () => {
    const { town, p, camp } = fixture();
    defect.call(town, p);
    const stock = town.stock().clone(),
      exploration = JSON.stringify(town.world.sights()),
      activities = new Set<Activity>();
    for (let i = 0; i < 9000; ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
      activities.add(p.activity);
    }
    const state = town.neutralSettlements[0],
      seat = town.building(state.camp);
    expect(
      seat,
      JSON.stringify({ state, activity: Activity[p.activity], position: p.position }),
    ).not.toBeNull();
    expect(seat!.built()).toBe(true);
    expect(seat!.faction).toBe(p.faction);
    expect(distance(camp.center, seat!.center)).toBeGreaterThanOrEqual(50);
    expect(town.buildings().filter((b) => b.faction === p.faction).length).toBeGreaterThan(1);
    expect(activities.has(Activity.Building)).toBe(true);
    expect(town.stock()).toEqual(stock);
    expect(JSON.stringify(town.world.sights())).toBe(exploration);
    expect(town.titleAutoplay).toBe(false);
    expect(town.population()).toBe(0);
    expect(p.faction).not.toBe(0);
  }, 30000);
});
