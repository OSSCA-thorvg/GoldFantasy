import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Activity, AnimalKind, Role, type Person } from '../../packages/engine/src/person';
import { Product, Structure } from '../../packages/engine/src/building-catalog';
import { Building } from '../../packages/engine/src/town-models';
import { Tool } from '../../packages/engine/src/game-tools';
import { distance, point, type Point } from '../../packages/engine/src/geometry';
import { freehandRoad } from '../../packages/engine/src/road-network';
import { treePosition } from '../../packages/engine/src/world-map';
import { itemSpec } from '../../packages/engine/src/equipment';
import { heldAmount } from '../../packages/engine/src/carried-resources';
import { craftCovered } from '../../packages/engine/src/town-equipment';
import { stationLevel, stationStep } from '../../packages/engine/src/craft-stations';
import * as mining from '../../packages/engine/src/mining';
import {
  GoalBranch,
  GoalKind,
  currentGoal,
  goalComplete,
  itemsOwned,
  settlementGoals,
  buildingUnlock,
  scoutPoint,
  unsourcedMaterial,
  toolAvailable,
  type SettlementGoal,
} from '../../packages/engine/src/settlement-progression';
import { dispatchWork, queueWork, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { selectTool } from '../../apps/web/src/native/game-input';
import { foundingPeople } from '../../packages/engine/src/ymir-born';
import { isPlayerBuilding } from '../../packages/engine/src/faction';

// A scripted player follows the founding quests of a real new game: designed seed 5, the full map and two founders.
// It only uses what the quest panel offers a player: place, build, gather, craft, upgrade, plant, pray and hunt.
// Roaming monsters and raids stay on, as in a real game; the script does not fight them on purpose.
function controls(town: Town): GameCommandApp {
  const app = {
    town,
    workQueue: [],
    workSerial: 0n,
    lastDispatch: -1,
    stoppedWork: new Map<number, bigint>(),
    chosen: [],
    crew: [],
    roadPress: null,
    roadStroke: [],
    roadMoved: false,
    status: '',
    tool: Tool.Select,
    cue() {},
    dismissBuildDrawer() {},
  } as unknown as GameCommandApp;
  app.selectTool = selectTool.bind(app);
  app.dispatchWork = dispatchWork.bind(app);
  app.queueWork = queueWork.bind(app);
  return app;
}
const goals = settlementGoals(),
  core = goals.map((goal, index) => ({ goal, index })).filter(({ goal }) => goal.branch === GoalBranch.Core);
const days = 10;
interface Run {
  /** Game day (fractional, from the start of day 0) at which each founding goal completed, by goal index. */
  done: Map<number, number>;
  /** Goal indices in the order the quest panel showed them. */
  shown: number[];
  firstNewcomer: number;
  /** Times the player had to send someone exploring because a site's material was nowhere in sight. */
  scouted: number;
  town: Town;
}
function play(): Run {
  const town = new Town(5),
    app = controls(town),
    width = town.map().width();
  const run: Run = { done: new Map(), shown: [], firstNewcomer: -1, scouted: 0, town };
  const day = () => town.clock() / 300;
  const residents = () => town.people().filter((p) => p.role === Role.Resident && p.health > 0);
  const busy = (p: Person) =>
    [Activity.Crafting, Activity.Building, Activity.Roadwork, Activity.Praying, Activity.Fighting].includes(
      p.task,
    ) ||
    (p.ordered && (p.task === Activity.Felling || p.task === Activity.Mining));
  const nearestCell = (from: Point, stone: boolean): number => {
    let best = -1,
      gap = Infinity;
    for (let y = Math.max(0, Math.floor(from.y) - 30); y < Math.min(width, from.y + 30); ++y)
      for (let x = Math.max(0, Math.floor(from.x) - 30); x < Math.min(width, from.x + 30); ++x) {
        const cell = y * width + x;
        if (stone ? !mining.deposit(town.map(), x, y) : !town.map().at(x, y).trees) continue;
        const foot = stone
          ? mining.position(x, y)
          : treePosition(town.map(), x, y, town.map().at(x, y).trees - 1);
        if (!town.map().revealed(foot) || town.people().some((p) => p.tree === cell)) continue;
        const gapHere = distance(from, foot);
        if (gapHere < gap) [gap, best] = [gapHere, cell];
      }
    return best;
  };
  const gather = (p: Person, stone: boolean): void => {
    if (p.task === (stone ? Activity.Mining : Activity.Felling)) return;
    const cell = nearestCell(p.position, stone);
    if (cell >= 0) void (stone ? town.orderMine([p.id], cell) : town.orderChop([p.id], cell));
  };
  const spot = (kind: Structure, near: Point): Point | null => {
    for (let r = 3; r < 16; r += 0.5)
      for (let a = 0; a < 32; ++a) {
        const at = point(
          near.x + r * Math.cos((a * Math.PI) / 16),
          near.y + r * Math.sin((a * Math.PI) / 16),
        );
        // A player places a building where its door can be reached.
        const door = new Building(0, kind, at, 0, 0).door();
        if (town.canPlace(kind, at, 0).ok && town.grid.path(town.camp()!.door(), door).length) return at;
      }
    return null;
  };
  const station = (kind: Structure) =>
    town.buildings().find((b) => b.kind === kind && b.built() && isPlayerBuilding(b));
  // As the quest button does: the station that makes the goal's items, the crafter chosen there.
  const craft = (goal: SettlementGoal): void => {
    const equip = goal.kind === GoalKind.Equip,
      items = equip ? ['wooden-axe', 'wooden-hoe', 'wooden-mallet', 'wooden-sword'] : goal.items;
    for (const p of residents()) {
      if (busy(p) || (equip && p.inventory.some((s) => s && itemSpec(s.item)?.category !== 'resource')))
        continue;
      const wanted = items
        .map((id) => itemSpec(id)!)
        .filter((item) => (equip || itemsOwned(town, [item.id]) === 0) && !item.cost.stone && station(item.workshop!))
        .sort((a, b) => a.cost.wood - b.cost.wood)[0];
      if (!wanted) continue;
      if (craftCovered(town.stock(), p, wanted.cost)) town.orderCraft(p.id, station(wanted.workshop!)!.id, wanted.id);
      else gather(p, false);
    }
  };
  // As the station panel's Upgrade button does; the rest gather what the step costs.
  const upgrade = (goal: SettlementGoal): void => {
    const site = station(goal.building);
    if (!site) return;
    const folk = residents();
    if (folk.some((p) => p.task === Activity.Crafting && p.craftWorkshop === site.id)) return;
    const free = folk.filter((p) => !busy(p));
    const crafter = free.find((p) => !town.stationUpgradeReason(p.id, site.id));
    if (crafter) {
      town.orderStationUpgrade(crafter.id, site.id);
      return;
    }
    const cost = stationStep(site.kind, stationLevel(site) + 1)!.cost,
      stoneShort = town.stock().stone < cost.stone;
    for (const p of free) gather(p, stoneShort && p.id % 2 === 0);
  };
  let tick = 0;
  const build = (kind: Structure, near: Point): void => {
    let site = town.buildings().find((b) => b.kind === kind && !b.built() && isPlayerBuilding(b));
    if (!site && buildingUnlock(town, kind).available) {
      const at = spot(kind, near);
      if (at && town.place(kind, at, 0)) site = town.buildings().at(-1)!;
    }
    if (!site) return;
    const folkNow = residents();
    if (unsourcedMaterial(town, site) !== null) {
      // As the quest's "Scout for stone" button does: walk someone onto unexplored ground until rock is in sight.
      if (!folkNow.some((p) => p.task === Activity.Moving && p.ordered)) {
        const p = folkNow.find((q) => !busy(q)),
          at = p && scoutPoint(town, p.position);
        if (p && at) {
          town.orderMove([p.id], at);
          ++run.scouted;
        }
      }
      return;
    }
    const { required, delivered } = site.materials,
      folk = residents(),
      stoneShort = required.stone - delivered.stone - town.stock().stone > 0,
      // One builder per site: crews that each hold part of the wood can wait on one another (see the report).
      builder =
        folk.find((p) => p.task === Activity.Building && p.taskSite === site.id) ??
        folk
          .filter((p) => !busy(p))
          .sort((a, b) => heldAmount(b, Product.Wood) - heldAmount(a, Product.Wood))
          .find((p) => town.orderBuild([p.id], site.id));
    for (const p of folk) if (p !== builder && !busy(p) && p.job < 0) gather(p, stoneShort);
  };
  const camp = town.map().camp();
  expect(town.place(Structure.Camp, camp, 0)).toBe(true);
  app.queueWork(Activity.Building, town.camp()!.id);
  for (tick = 0; tick < days * 3000; ++tick) {
    town.advance(0.1);
    app.dispatchWork();
    if (run.firstNewcomer < 0 && town.population() > 2) run.firstNewcomer = day();
    const index = currentGoal(town, GoalBranch.Core);
    if (run.shown.at(-1) !== index) run.shown.push(index);
    for (const { goal, index: i } of core)
      if (!run.done.has(i) && (index < 0 || i < index) && goalComplete(town, goal)) run.done.set(i, day());
    if (index < 0) break;
    const seat = town.camp()!;
    if (tick % 10 || !seat.built()) continue;
    const goal = goals[index],
      folk = residents();
    // Like a player: staff the farm, and pray as soon as an altar stands, hunting for its offering.
    const own = (kind: Structure) =>
        town.buildings().find((b) => b.kind === kind && b.built() && isPlayerBuilding(b)),
      farm = own(Structure.Farm);
    for (const [yard, crew] of [
      [farm, 1],
      [own(Structure.Quarry), 4],
      [own(Structure.Lumberyard), 5],
    ] as const)
      if (yard && !yard.workers && folk.length >= crew) {
        const p = folk.find((q) => !busy(q) && q.job < 0) ?? folk.find((q) => !busy(q));
        if (p) town.assignJob([p.id], yard.id);
      }
    const altar = own(Structure.Shrine);
    if (altar && town.population() < 4) {
      const reason = town.altarStatus(altar.id).reason;
      if (!reason) {
        const p = folk.find((q) => !busy(q) && !town.prayerReason(q.id, altar.id));
        if (p) town.orderPrayAtAltar([p.id], altar.id);
      } else if (/food/.test(reason) && !folk.some((q) => q.task === Activity.Fighting)) {
        const prey = town.animals
          .filter(
            (a) =>
              a.health > 0 &&
              [AnimalKind.Chicken, AnimalKind.Pig, AnimalKind.Cow].includes(a.animal!) &&
              town.map().revealed(a.position),
          )
          .sort((a, b) => distance(a.position, seat.center) - distance(b.position, seat.center))[0];
        const hunter = folk.find((q) => !busy(q));
        if (prey && hunter) town.orderAttack([hunter.id], prey.id);
      }
    }
    switch (goal.kind) {
      case GoalKind.Craft:
      case GoalKind.Equip:
        craft(goal);
        break;
      case GoalKind.Station:
        upgrade(goal);
        break;
      case GoalKind.Building:
        build(goal.building, seat.center);
        break;
      case GoalKind.Road: {
        if (!town.roads().roads().length)
          for (let a = 0; a < 16; ++a) {
            const dx = Math.cos((a * Math.PI) / 8),
              dy = Math.sin((a * Math.PI) / 8),
              stroke = [0.8, 2, 3.5, 5].map((r) => point(seat.center.x + dx * r, seat.center.y + dy * r));
            if (town.buildRoad(freehandRoad(stroke, 0.2))) break;
          }
        const road = town.roads().roads()[0];
        if (road) for (const p of folk) if (!busy(p)) town.orderRoadwork([p.id], road.id);
        break;
      }
      case GoalKind.Field: {
        const at = farm?.center ?? seat.center;
        for (let r = 3; r < 10 && !town.fieldAcres(); ++r)
          for (let a = 0; a < 8 && !town.fieldAcres(); ++a) {
            const c = point(at.x + r * Math.cos(a * 0.785), at.y + r * Math.sin(a * 0.785));
            town.plantField([
              point(c.x - 1.5, c.y - 1),
              point(c.x + 1.5, c.y - 1),
              point(c.x + 1.5, c.y + 1),
              point(c.x - 1.5, c.y + 1),
            ]);
          }
        break;
      }
      case GoalKind.Population:
        // Beds and prayers are handled above; idle hands fell wood for what comes next.
        for (const p of folk) if (!busy(p) && p.task === Activity.Idle) gather(p, false);
        break;
    }
  }
  return run;
}

let run: Run;
beforeAll(() => {
  run = play();
}, 240000);

describe('the founding chain in a real new game', () => {
  it('completes every founding goal in order, with no step back and no deadlock', () => {
    const order = core.map(({ index }) => index),
      shown = run.shown.filter((i) => i >= 0);
    // The quest panel only moved forward; a jump means two goals were met in the same moment.
    shown.forEach((index, i) => expect(index, JSON.stringify(run.shown)).toBeGreaterThan(shown[i - 1] ?? -1));
    expect(run.shown.at(-1), JSON.stringify(run.shown)).toBe(-1);
    expect([...run.done.keys()]).toEqual(order);
    const report = core.map(
      ({ goal, index }, n) =>
        `${String(n + 1).padStart(2)}. ${goal.title.padEnd(22)} day ${run.done.get(index)!.toFixed(2)}`,
    );
    console.log(
      ['Founding chain (game day; one day is 300 s; the first ten are the brief):', ...report].join('\n'),
    );
    console.log(`First newcomer from the altar: day ${run.firstNewcomer.toFixed(2)}; scouting trips for materials: ${run.scouted}`);
    console.log(`Raids beaten off: ${run.town.chronicle.raidsRepelled}; residents lost: ${run.town.fallen.length}; monsters slain: ${run.town.chronicle.monstersSlain}`);
  });
  it('makes and uses items before the altar, and grows the party before the first raid night', () => {
    const at = (title: string) => run.done.get(goals.findIndex((g) => g.title === title))!;
    expect(at('Craft a wooden axe')).toBeLessThan(at('Build a smithy'));
    expect(at('Build a smithy')).toBeLessThan(at('Make a shield'));
    expect(at('Make a shield')).toBeLessThan(at('Build a tent'));
    expect(at('Upgrade the workbench')).toBeLessThan(at('Upgrade the smithy'));
    expect(at('Equip both founders')).toBeLessThan(at('Build an altar'));
    expect(at('Build a farmhouse')).toBeLessThan(at('Build an altar'));
    // Raids start on the night of day 2; the smithy and the first arms come before it.
    expect(at('Make a shield')).toBeLessThan(2);
    expect(run.firstNewcomer).toBeGreaterThan(0);
    expect(run.firstNewcomer).toBeLessThan(3.5);
    expect(at('Reach 4 residents')).toBeLessThan(days);
  });
  it('counts only gear the residents really own and use', () => {
    const town = run.town;
    // The smithy stands, at level 2; iron waits for a cleared floor.
    expect(toolAvailable(town, Tool.Weaponsmith)).toBe(true);
    expect(town.chronicle.weaponsForged).toBe(0);
    const founders = town.people().filter((q) => foundingPeople.some((f) => f.name === q.name));
    expect(founders).toHaveLength(2);
    for (const p of founders)
      expect(
        p.inventory.some((stack) => stack && itemSpec(stack.item)?.workshop === Structure.Workbench),
        p.name,
      ).toBe(true);
  });
});
