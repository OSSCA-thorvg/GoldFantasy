import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Building, Season } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Activity, AnimalKind, Calling, Role } from '../../packages/engine/src/person';
import { DungeonKind, World } from '../../packages/engine/src/world-types';
import { WorldMap } from '../../packages/engine/src/world-map';
import { WalkGrid } from '../../packages/engine/src/walk-paths';
import { RoadNetwork } from '../../packages/engine/src/road-network';
import { copyNative } from '../../packages/engine/src/native-copy';
import { distance } from '../../packages/engine/src/geometry';
import { monsterEntrance } from '../../packages/engine/src/town-monsters';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { ChamberKind, findRealmArea, inArea, planRealm, realmSizes, sinkRealm, stampRealm } from '../../packages/engine/src/realm-layout';
import { Saga, gateSealed, sagaState, sealFloors, sealProgress, sealable } from '../../packages/engine/src/gate-seals';
import { RaidKind, raidDue, raidShape } from '../../packages/engine/src/raid-progression';
import {
  GoalBranch,
  buildingUnlock,
  currentGoal,
  settlementGoals,
} from '../../packages/engine/src/settlement-progression';
import { TownState } from '../../packages/engine/src/town-state';

function settlement() {
  const town = new Town(5, 32, false),
    camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
  camp.village = 0;
  town.placed.push(camp);
  town.nextId = 1;
  town.foundSettlement(0);
  const gate = town.map().dungeons().findIndex((site) => site.kind !== DungeonKind.GiantHall);
  town.map().dungeons()[gate].discovered = true;
  return { town, camp, gate };
}
describe('worlds beyond the gates', () => {
  let base: WorldMap;
  beforeAll(() => {
    base = WorldMap.generate(5);
  }, 120000);
  function expedition(size: number, level: number, floor = 0) {
    const town = new Town(base, 176, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    const gate = town.map().dungeons().findIndex(sealable);
    town.map().dungeons()[gate].discovered = true;
    town.depth = town.map().dungeons().map((_, index) => (index === gate ? floor : 0));
    const members = Array.from({ length: size }, () => {
      const p = town.makePerson(Role.Resident, Calling.Warrior, monsterEntrance(town.map().dungeons()[gate]));
      town.folk.push(p);
      p.level = level;
      p.activity = Activity.Expedition;
      p.inside = true;
      // Armed, with both skills left on auto: a floor is a swarm now.
      p.inventory[0] = { item: 'sword', quantity: 1 };
      p.equipment.weapon = 1;
      p.abilityAuto = p.abilityAuto2 = 1;
      return p;
    });
    town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor });
    return { town, gate, members };
  }
  const terrain = (town: Town) => town.map().tiles.map((tile) => tile.terrain).join('');

  it('plans a connected floor inside one open-sea square', () => {
    const area = findRealmArea(base)!;
    expect(area.size).toBeGreaterThanOrEqual(40);
    for (let floor = 0; floor < sealFloors; ++floor) {
      const plan = planRealm(5, 2, floor, area),
        seen = new Set([0]),
        queue = [0];
      while (queue.length)
        for (const next of plan.chambers[queue.shift()!].links) if (!seen.has(next)) queue.push(next), seen.add(next);
      expect(seen.size).toBe(plan.chambers.length);
      expect(plan.chambers.filter((chamber) => chamber.kind === ChamberKind.Heart)).toHaveLength(1);
      expect(plan.chambers[0].kind).toBe(ChamberKind.Entry);
      for (const chamber of plan.chambers) expect(inArea(area, chamber.center)).toBe(true);
      expect(planRealm(5, 2, floor, area)).toEqual(plan);
    }
  });
  it('raises real walkable land for every world and reaches every chamber on foot', () => {
    for (let world = 0; world < World.Count; ++world) {
      const map = copyNative(base),
        area = findRealmArea(map)!,
        plan = planRealm(5, world, 1, area);
      stampRealm(map, plan, world);
      const grid = new WalkGrid();
      grid.rebuild(map, new RoadNetwork(), []);
      for (const chamber of plan.chambers) {
        expect(grid.walkable(chamber.center)).toBe(true);
        expect(grid.path(plan.entry, chamber.center).length).toBeGreaterThan(0);
      }
      expect(grid.path(plan.entry, map.camp())).toHaveLength(0);
      sinkRealm(map, area);
      expect(map.tiles.map((tile) => tile.terrain)).toEqual(base.tiles.map((tile) => tile.terrain));
      expect(findRealmArea(map)).toEqual(area);
    }
  }, 120000);
  it('still raises a walkable floor in the smallest sea a map may offer', () => {
    const wide = findRealmArea(base)!,
      area = { x: wide.x, y: wide.y, size: realmSizes.least };
    for (let world = 0; world < World.Count; ++world) {
      const map = copyNative(base),
        plan = planRealm(5, world, 2, area);
      stampRealm(map, plan, world);
      const grid = new WalkGrid();
      grid.rebuild(map, new RoadNetwork(), []);
      for (const chamber of plan.chambers) expect(grid.path(plan.entry, chamber.center).length).toBeGreaterThan(0);
      expect(grid.path(plan.entry, map.camp())).toHaveLength(0);
    }
  }, 120000);
  it('moves the party into the world, lets it kill the guardian and brings the hoard home', () => {
    const { town, gate, members } = expedition(6, 30),
      sea = terrain(town),
      sites = town.map().dungeons().length;
    town.advance(0.1);
    expect(town.realmActive()).toBe(true);
    const plan = town.realmPlan()!;
    for (const p of members) expect(town.inRealm(p.position)).toBe(true);
    expect(town.map().dungeons().at(-1)!.kind).toBe(DungeonKind.Return);
    expect(town.realmFoes().length).toBeGreaterThan(3);
    expect(town.canLeaveRealm().ok).toBe(true);
    expect(town.canPlace(Structure.Tent, plan.entry, 0).ok).toBe(false);
    const heart = plan.chambers.find((chamber) => chamber.kind === ChamberKind.Heart)!;
    const ids = members.map((p) => p.id);
    // Every den must fall as well as the guardian: go for the nearest den left, then the heart.
    const next = () =>
      town.realmDens().sort((a, b) => distance(a.position, members[0].position) - distance(b.position, members[0].position))[0]
        ?.position ?? heart.center;
    town.orderAttackMove(ids, next());
    for (let t = 0; t < 900 && !town.realmCleared; t += 0.2) {
      town.advance(0.2);
      if (Math.round(t * 5) % 50 === 0) town.orderAttackMove(ids, next());
    }
    expect(town.realmCleared).toBe(true);
    expect(town.depth[gate]).toBe(1);
    expect(town.realmReward?.title).toBe('Floor 1 cleared');
    expect(town.realmLoot.empty()).toBe(false);
    expect(town.stock(0).gold + town.stock(0).stone).toBe(0);
    for (let t = 0; t < 30 && !town.canLeaveRealm().ok; t += 0.2) town.advance(0.2);
    expect(town.leaveRealm()).toBe(true);
    expect(town.realmActive()).toBe(false);
    expect(town.map().dungeons()).toHaveLength(sites);
    expect(terrain(town)).toBe(sea);
    expect(town.stock(0).stone).toBeGreaterThan(0);
    for (const p of members.filter((p) => p.health > 0)) {
      expect(town.inRealm(p.position)).toBe(false);
      expect(distance(p.position, monsterEntrance(town.map().dungeons()[gate]))).toBeLessThan(4);
    }
    expect(town.monsters().every((beast) => beast.lair !== gate || beast.raider)).toBe(true);
    expect(town.floorOpen(gate, 1)).toBe(true);
    expect(town.floorOpen(gate, 2)).toBe(false);
    expect(town.floorOpen(gate, 0)).toBe(true);
  }, 120000);
  it('seals the gate and pays the great reward on the last floor', () => {
    const { town, gate, members } = expedition(6, 26, sealFloors - 1);
    town.advance(0.1);
    const guardian = town.realmFoes().find((foe) => foe.id === town.realmGuardian)!;
    expect(guardian.health).toBeCloseTo(town.guardianVigor());
    expect(town.realmDens().length).toBeGreaterThanOrEqual(2);
    for (const den of town.realmDens()) den.health = 0;
    town.stir(0.1);
    expect(town.realmCleared).toBe(false);
    guardian.health = 0;
    town.stir(0.1);
    expect(gateSealed(town, gate)).toBe(true);
    expect(town.realmReward?.sealed).toBe(true);
    expect(members.every((p) => p.level === 28)).toBe(true);
    expect(town.realmLoot.gold).toBeGreaterThanOrEqual(150);
    expect(town.canLeaveRealm().ok).toBe(true);
    expect(town.leaveRealm()).toBe(true);
    expect(town.floorOpen(gate, sealFloors - 1)).toBe(true);
    expect(town.expeditionProblem(gate, sealFloors - 1)).toBe('');
    town.days = 30;
    town.summonRaid(RaidKind.Pack);
    expect(town.monsters().some((beast) => beast.lair === gate)).toBe(false);
  }, 120000);
  it('loses the carried spoils when nobody comes back and keeps other gates shut meanwhile', () => {
    const { town, gate, members } = expedition(2, 1);
    town.advance(0.1);
    expect(town.expeditionProblem(gate, 0)).toBe('');
    const other = town.map().dungeons().findIndex((site, index) => index !== gate && sealable(site));
    town.map().dungeons()[other].discovered = true;
    expect(town.expeditionProblem(other, 0)).toBe('A party is already beyond another gate');
    town.realmLoot.gold = 50;
    members[0].position = { ...town.realmPlan()!.chambers.at(-1)!.center };
    expect(town.canLeaveRealm().ok).toBe(false);
    for (const p of members) p.health = -1;
    town.advance(0.1);
    expect(town.realmActive()).toBe(false);
    expect(town.stock(0).gold).toBe(0);
    expect(town.depth[gate]).toBe(0);
  }, 120000);
  it('lets reinforcements follow a party through the same gate', () => {
    const { town, gate, members } = expedition(2, 5);
    town.advance(0.1);
    const late = town.makePerson(Role.Resident, Calling.Warrior, monsterEntrance(town.map().dungeons()[gate]));
    town.folk.push(late);
    late.activity = Activity.Expedition;
    late.inside = true;
    town.parties.push({ dungeon: gate, members: [late.id], floor: 2 });
    town.advance(0.1);
    expect(town.realmFloor).toBe(0);
    expect(town.realmParty().map((p) => p.id)).toEqual([...members.map((p) => p.id), late.id]);
    expect(distance(late.position, town.realmPlan()!.entry)).toBeLessThan(3);
    town.realmCleared = true;
    expect(town.expeditionProblem(gate, 0)).toBe('This floor is already cleared');
  }, 120000);
  it('lets a settlement portal pull a scattered party home for mana', () => {
    const { town, members } = expedition(2, 5);
    town.advance(0.1);
    town.realmLoot.gold = 9;
    members[0].position = { ...town.realmPlan()!.chambers[1].center };
    expect(town.canLeaveRealm().ok).toBe(false);
    const portal = new Building(town.nextId++, Structure.Portal, { x: town.map().camp().x + 4, y: town.map().camp().y }, 0, 0);
    portal.village = 0;
    town.placed.push(portal);
    expect(town.canLeaveRealm().reason).toContain('8 mana');
    town.stock(0).mana = 10;
    expect(town.canLeaveRealm().cost.mana).toBe(8);
    expect(town.leaveRealm()).toBe(true);
    expect(town.stock(0).mana).toBe(2);
    expect(town.stock(0).gold).toBe(9);
    expect(town.realmActive()).toBe(false);
  }, 120000);
  it('saves and restores a party in the middle of another world', () => {
    const { town, gate, members } = expedition(3, 10);
    town.advance(0.1);
    town.realmLoot.gold = 7;
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 176, false, true));
    expect(loaded.realmGate).toBe(gate);
    expect(loaded.realmArea).toEqual(town.realmArea);
    expect(loaded.realmLoot.gold).toBe(7);
    expect(loaded.realmGuardian).toBe(town.realmGuardian);
    expect(loaded.realmParty().map((p) => p.id)).toEqual(members.map((p) => p.id));
    expect(loaded.realmFoes()).toHaveLength(town.realmFoes().length);
    expect(loaded.realmPlan()).toEqual(town.realmPlan());
    expect(loaded.grid.path(loaded.realmPlan()!.entry, loaded.realmPlan()!.chambers.at(-1)!.center).length).toBeGreaterThan(0);
  }, 120000);
});

describe('the player commands the party', () => {
  let base: WorldMap;
  beforeAll(() => {
    base = WorldMap.generate(5);
  }, 120000);
  function delve(size: number, level: number) {
    const town = new Town(base, 176, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    const gate = town.map().dungeons().findIndex(sealable);
    town.map().dungeons()[gate].discovered = true;
    const members = Array.from({ length: size }, () => {
      const p = town.makePerson(Role.Resident, Calling.Warrior, monsterEntrance(town.map().dungeons()[gate]));
      town.folk.push(p);
      p.level = level;
      return p;
    });
    return { town, gate, members };
  }
  it('obeys Move in the middle of a fight, and fights again once it has arrived', () => {
    const { town, gate, members } = delve(3, 30);
    for (const p of members) {
      p.activity = Activity.Expedition;
      p.inside = true;
    }
    town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor: 0 });
    town.advance(0.1);
    const plan = town.realmPlan()!,
      ids = members.map((p) => p.id),
      den = plan.chambers[plan.chambers[0].links[0]];
    town.orderAttackMove(ids, den.center);
    for (let t = 0; t < 120 && !members.some((p) => p.activity === Activity.Fighting); t += 0.2) town.advance(0.2);
    expect(members.some((p) => p.activity === Activity.Fighting)).toBe(true);
    town.orderMove(ids, plan.entry);
    town.advance(0.2);
    for (const p of members) {
      expect(p.activity).toBe(Activity.Moving);
      expect(p.foe).toBe(-1);
    }
    let fought = false;
    for (let t = 0; t < 60 && members.some((p) => p.moving()); t += 0.2) {
      town.advance(0.2);
      fought ||= members.some((p) => p.ordered && p.activity === Activity.Fighting);
    }
    expect(fought).toBe(false);
    for (const p of members) expect(distance(p.position, plan.entry)).toBeLessThan(3);
  }, 120000);
  it('attacks the chosen monster rather than the nearest one', () => {
    const { town, gate, members } = delve(1, 30),
      p = members[0];
    for (const m of members) {
      m.activity = Activity.Expedition;
      m.inside = true;
    }
    town.parties.push({ dungeon: gate, members: [p.id], floor: 0 });
    town.advance(0.1);
    const foes = town.realmFoes(),
      near = foes[0],
      far = foes[1];
    near.position = { x: p.position.x + 0.6, y: p.position.y };
    far.position = { x: p.position.x + 1.6, y: p.position.y };
    near.angry = far.angry = true;
    expect(town.orderAttack([p.id], far.id)).toBe(true);
    town.advance(0.1);
    expect(p.foe).toBe(far.id);
  }, 120000);
  it('lets a party walking to a gate be called back, but not one that has stepped in', () => {
    const { town, gate, members } = delve(2, 5),
      ids = members.map((p) => p.id);
    for (const p of members) p.position = town.grid.nearestWalkable({ x: p.position.x + 4, y: p.position.y + 4 });
    expect(town.sendExpedition(ids, gate, 0)).toBe(true);
    town.advance(0.2);
    expect(members.every((p) => p.activity === Activity.Expedition && !p.inside)).toBe(true);
    const back = town.grid.nearestWalkable({ x: members[0].position.x + 3, y: members[0].position.y + 3 });
    town.orderMove([ids[0]], back);
    expect(members[0].activity).toBe(Activity.Moving);
    for (let t = 0; t < 60 && !town.realmActive(); t += 0.2) town.advance(0.2);
    // The one who was called back stays in Midgard; the other goes through alone.
    expect(town.realmActive()).toBe(true);
    expect(town.realmParty().map((p) => p.id)).toEqual([ids[1]]);
    expect(town.inRealm(members[0].position)).toBe(false);
  }, 120000);
});

describe('saga end states', () => {
  it('is lost when no resident is left and won when every gate is sealed', () => {
    const { town } = settlement();
    expect(sagaState(town)).toBe(Saga.Defeat);
    town.placed[0].devotionDueDay = 3;
    expect(sagaState(town)).toBe(Saga.Playing);
    town.placed[0].devotionDueDay = -1;
    town.folk.push(town.makePerson(Role.Resident, Calling.Settler, town.map().camp()));
    expect(sagaState(town)).toBe(Saga.Playing);
    town.depth = town.map().dungeons().map(() => sealFloors);
    expect(sealProgress(town).sealed).toBe(sealProgress(town).total);
    expect(sealProgress(town).total).toBeGreaterThan(0);
    expect(sagaState(town)).toBe(Saga.Victory);
  });
});

describe('raid cadence and shapes', () => {
  it('gives two quiet opening nights and never more than two quiet nights in a row', () => {
    expect(raidDue(5, 0)).toBe(false);
    expect(raidDue(5, 1)).toBe(false);
    let quiet = 0,
      raids = 0;
    for (let day = 2; day < 200; ++day) {
      quiet = raidDue(5, day) ? 0 : quiet + 1;
      raids += raidDue(5, day) ? 1 : 0;
      expect(quiet).toBeLessThanOrEqual(2);
    }
    expect(raids).toBeLessThan(198);
    let winter = 0;
    for (let day = 2; day < 200; ++day) winter += raidDue(5, day, true) ? 1 : 0;
    expect(winter).toBeGreaterThan(raids);
  });
  it('shapes hordes as many weak raiders and brutes as few strong ones', () => {
    // A wave answers the settlement's might: more might, more swarm and more leaders.
    const strong = raidShape(RaidKind.Pack, 24);
    expect(raidShape(RaidKind.Horde, 24)).toMatchObject({ health: 0.8 });
    expect(raidShape(RaidKind.Horde, 24).swarm).toBeGreaterThan(strong.swarm);
    expect(raidShape(RaidKind.Horde, 24).count).toBeLessThan(strong.count);
    expect(raidShape(RaidKind.Brutes, 24)).toMatchObject({ health: 1.8 });
    expect(raidShape(RaidKind.Brutes, 24).swarm).toBeLessThan(strong.swarm);
    expect(raidShape(RaidKind.Pack, 3)).toMatchObject({ count: 0, brutes: 0, swarm: 3 });
    expect(strong.count).toBeGreaterThan(2);
    const { town } = settlement();
    town.days = 14;
    town.summonRaid(RaidKind.Pack);
    const pack = town.monsters().length,
      health = town.monsters()[0].health;
    town.beasts = [];
    town.summonRaid(RaidKind.Horde);
    expect(town.monsters().length).toBeGreaterThan(pack);
    expect(town.monsters()[0].health).toBeLessThan(health);
    expect(town.monsters().length).toBeLessThanOrEqual(TownState.maxRaiders);
  });
  it('lets a fortified seat shoot raiders while a bare camp cannot', () => {
    const { town, camp } = settlement();
    town.days = 14;
    town.summonRaid(RaidKind.Pack);
    const raider = town.monsters()[0];
    for (const beast of town.beasts) beast.position = { x: camp.center.x + 3, y: camp.center.y };
    const before = raider.health;
    town.stir(0.1);
    expect(town.monsters()[0].health).toBe(before);
    camp.kind = Structure.Palisade;
    town.stir(0.1);
    expect(town.monsters().some((beast) => beast.health < before)).toBe(true);
    expect(town.hits().some((hit) => hit.ranged && hit.person === -1)).toBe(true);
  });
});

describe('branching progression', () => {
  it('opens arms and faith without the trade branch', () => {
    const { town } = settlement();
    const add = (kind: Structure) => {
      const b = new Building(town.nextId++, kind, town.map().camp(), 0, 0);
      b.village = 0;
      town.placed.push(b);
    };
    for (let i = 0; i < 16; ++i) town.folk.push(town.makePerson(Role.Resident, Calling.Settler, town.map().camp()));
    add(Structure.Quarry);
    expect(buildingUnlock(town, Structure.Guild).available).toBe(true);
    expect(buildingUnlock(town, Structure.Chapel).reason).toBe('Complete Altar of Odin');
    add(Structure.Shrine);
    expect(buildingUnlock(town, Structure.Chapel).available).toBe(true);
    expect(buildingUnlock(town, Structure.MageTower).reason).toBe('Complete Apothecary');
    expect(buildingUnlock(town, Structure.MarketStalls).available).toBe(false);
  });
  it('tracks each branch separately and ends the saga with every gate sealed', () => {
    const { town } = settlement();
    const goals = settlementGoals();
    expect(goals[currentGoal(town, GoalBranch.Core)].title).toBe('Build a workbench');
    expect(goals[currentGoal(town, GoalBranch.Arms)].title).toBe('Build a guild');
    expect(goals[currentGoal(town, GoalBranch.Saga)].title).toBe('Lead a party of three');
    town.chronicle.largestParty = 3;
    expect(goals[currentGoal(town, GoalBranch.Saga)].title).toBe('Slay a floor guardian');
    expect(goals.at(-1)!.title).toBe('Seal every gate');
  });
});

describe('winter scarcity', () => {
  it('stocks fewer animals in winter and restocks one of each kind a day', () => {
    const summer = new Town(5, 64, false);
    summer.populateWildlife();
    const full = summer.wildlife().length;
    const winter = new Town(5, 64, false);
    winter.days = 45;
    expect(winter.calendar().season).toBe(Season.Winter);
    winter.populateWildlife();
    expect(winter.wildlife().length).toBeLessThan(full);
    summer.animals = [];
    summer.days = 1;
    summer.populateWildlife();
    expect(summer.wildlife().length).toBeLessThanOrEqual(6);
    expect(summer.wildlife().length).toBeGreaterThan(0);
  });
});

describe('sleeping animals', () => {
  it('keeps herd animals still at night, wakes them when struck and lets wolves prowl', () => {
    const town = new Town(5, 64, false);
    town.populateWildlife();
    const cow = town.wildlife().find((animal) => animal.animal === AnimalKind.Cow)!,
      wolf = town.wildlife().find((animal) => animal.animal === AnimalKind.Wolf)!;
    town.editHour(12);
    expect(town.animalAsleep(cow)).toBe(false);
    town.editHour(1);
    expect(town.climate().night).toBeGreaterThan(0.6);
    expect(town.animalAsleep(cow)).toBe(true);
    expect(town.animalAsleep(wolf)).toBe(false);
    cow.path = [{ x: cow.position.x + 1, y: cow.position.y }];
    const at = { ...cow.position };
    cow.ready = 0;
    for (let i = 0; i < 50; ++i) {
      town.time += 0.2;
      town.stirWildlife(0.2);
    }
    expect(cow.position).toEqual(at);
    expect(cow.path).toHaveLength(0);
    cow.angry = true;
    expect(town.animalAsleep(cow)).toBe(false);
  });
});
