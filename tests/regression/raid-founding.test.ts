import { beforeAll, describe, expect, it } from 'vitest';
import { CombatCue, MonsterRank } from '../../packages/engine/src/combat-events';
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
import * as mining from '../../packages/engine/src/mining';
import {
  GoalBranch,
  GoalKind,
  currentGoal,
  goalComplete,
  itemsOwned,
  settlementGoals,
  buildingUnlock,
  toolAvailable,
  type SettlementGoal,
} from '../../packages/engine/src/settlement-progression';
import { dispatchWork, queueWork, type GameCommandApp } from '../../apps/web/src/native/game-commands';
import { selectTool } from '../../apps/web/src/native/game-input';
import { foundingPeople } from '../../packages/engine/src/ymir-born';
import { isPlayerBuilding } from '../../packages/engine/src/faction';

// A scripted player follows the founding quests of a real new game: designed seed 5, the full map and two founders.
// It only uses what the quest panel offers a player: place, build, gather, craft, plant, pray and hunt.
// Raids and roaming monsters are switched off here: their numbers belong to the combat pass and are tested there.
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
const days = 6;
interface Run {
  /** Game day (fractional, from the start of day 0) at which each founding goal completed, by goal index. */
  done: Map<number, number>;
  /** Goal indices in the order the quest panel showed them. */
  shown: number[];
  firstNewcomer: number;
  town: Town;
  waves: { day: number; size: number; grunts: number; brutes: number; swarm: number; residents: number }[];
  downed: number;
}
function play(): Run {
  const town = new Town(5),
    app = controls(town),
    width = town.map().width();
  // Roaming monsters are left out as in the founding chain: this is about the raids.
  town.releaseMonster = () => {};
  const run: Run = { done: new Map(), shown: [], firstNewcomer: -1, town, waves: [], downed: 0 };
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
  const craft = (goal: SettlementGoal, camp: number): void => {
    const equip = goal.kind === GoalKind.Equip,
      items = equip ? ['wooden-axe', 'wooden-hoe', 'wooden-mallet', 'wooden-sword'] : goal.items;
    for (const p of residents()) {
      if (busy(p) || (equip && p.inventory.some((s) => s && itemSpec(s.item)?.category !== 'resource')))
        continue;
      const wanted = items
        .map((id) => itemSpec(id)!)
        .filter((item) => (equip || itemsOwned(town, [item.id]) === 0) && !item.cost.stone)
        .sort((a, b) => a.cost.wood - b.cost.wood)[0];
      if (!wanted) continue;
      if (craftCovered(town.stock(), p, wanted.cost)) town.orderCraft(p.id, camp, wanted.id);
      else gather(p, false);
    }
  };
  let tick = 0, seen = -1n, wasRaid = false;
  const build = (kind: Structure, near: Point): void => {
    let site = town.buildings().find((b) => b.kind === kind && !b.built() && isPlayerBuilding(b));
    if (!site && buildingUnlock(town, kind).available) {
      const at = spot(kind, near);
      if (at && town.place(kind, at, 0)) site = town.buildings().at(-1)!;
    }
    if (!site) return;
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
    for (const e of town.combatEvents()) {
      if (e.serial <= seen) continue;
      seen = e.serial;
      if (e.cue === CombatCue.Wave) {
        const raiders = town.monsters().filter((m) => m.raider);
        const mk = [MonsterRank.Grunt, MonsterRank.Brute, MonsterRank.Swarmer].map((r) => raiders.filter((m) => m.rank === r).length);
        const folk = residents();
        run.waves.push({ day: day(), size: e.amount, grunts: mk[0], brutes: mk[1], swarm: mk[2], residents: folk.length });
      }
      if (e.cue === CombatCue.Downed) ++run.downed;
    }
    if (tick % 20 === 0) {
      const up = residents().filter((p) => p.downedAt < 0);
      for (const d of town.people().filter((p) => p.downedAt >= 0 && p.health > -0.5))
        if (!up.some((p) => p.task === Activity.Tending && p.taskSite === d.id)) {
          const helper = up.filter((p) => p.task !== Activity.Tending).sort((a, b) => distance(a.position, d.position) - distance(b.position, d.position))[0];
          if (helper) town.orderTend([helper.id], d.id);
        }
    }
    if (town.raiding() && tick % 20 === 0) {
      // Some care: everyone on their feet meets the raiders, and the downed are tended.
      const folk = residents().filter((p) => p.downedAt < 0);
      const down = town.people().filter((p) => p.downedAt >= 0 && p.health > -0.5);
      for (const d of down) if (!folk.some((p) => p.task === Activity.Tending && p.taskSite === d.id)) {
        const helper = folk.filter((p) => p.task !== Activity.Tending).sort((a, b) => distance(a.position, d.position) - distance(b.position, d.position))[0];
        if (helper) town.orderTend([helper.id], d.id);
      }
      const seat = town.camp()!;
      const near = town.monsters().filter((m) => m.raider && distance(m.position, seat.center) < 14).sort((a, b) => distance(a.position, seat.center) - distance(b.position, seat.center))[0];
      const fighters = folk.filter((p) => p.task !== Activity.Tending).map((p) => p.id);
      if (near && fighters.length) town.orderAttackMove(fighters, near.position);
      wasRaid = true;
      continue;
    }
    if (wasRaid && !town.raiding()) {
      wasRaid = false;
      town.orderAutomatic(residents().map((p) => p.id));
    }
    if (!town.people().some((p) => p.role === Role.Resident && (p.health > 0 || (p.downedAt >= 0 && p.health > -0.5)))) break;
    if (run.firstNewcomer < 0 && town.population() > 2) run.firstNewcomer = day();
    const index = currentGoal(town, GoalBranch.Core);
    if (run.shown.at(-1) !== index) run.shown.push(index);
    for (const { goal, index: i } of core)
      if (!run.done.has(i) && (index < 0 || i < index) && goalComplete(town, goal)) run.done.set(i, day());
    if (index < 0 && day() >= days) break;
    const seat = town.camp()!;
    if (tick % 10 || !seat.built()) continue;
    if (index < 0) continue;
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
        craft(goal, seat.id);
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
}, 600000);

describe('raids against a real new game', () => {
  it('lets the founding camp beat off its first raids and keep growing through day six', () => {
    const town = run.town,
      alive = town.people().filter((p) => p.role === Role.Resident && p.health > 0);
    console.log(
      ['Raids (game day, size, make-up, residents at home):', ...run.waves.map((w) =>
        `day ${w.day.toFixed(2)}: ${w.size} (${w.grunts} grunts, ${w.brutes} brutes, ${w.swarm} swarmers) against ${w.residents}`)].join('\n'),
    );
    expect(town.clock() / 300).toBeGreaterThanOrEqual(6);
    expect(run.waves.length).toBeGreaterThanOrEqual(3);
    // The last wave may still be out when the sixth day ends.
    expect(town.chronicle.raidsRepelled).toBeGreaterThanOrEqual(run.waves.length - 1);
    expect(town.fallen).toHaveLength(0);
    expect(alive.length).toBeGreaterThanOrEqual(4);
    // The first raid is a probe: no brutes, a handful of swarmers and at most one leader.
    expect(run.waves[0]).toMatchObject({ brutes: 0 });
    expect(run.waves[0].grunts).toBeLessThanOrEqual(1);
    expect(run.waves[0].size).toBeLessThanOrEqual(2 * run.waves[0].residents + 1);
    // Waves follow what the settlement has, not the calendar alone.
    for (const w of run.waves) expect(w.size).toBeLessThanOrEqual(3 * w.residents + 3);
  });
});
