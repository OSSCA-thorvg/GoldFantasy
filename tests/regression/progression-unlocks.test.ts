import { describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { Building, Field } from '../../packages/engine/src/town-models';
import { Structure, structureSpec } from '../../packages/engine/src/building-catalog';
import { Tool, toolStructure } from '../../packages/engine/src/game-tools';
import { Calling, Role } from '../../packages/engine/src/person';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { point } from '../../packages/engine/src/geometry';
import { decodeTown, encodeTown } from '../../packages/engine/src/save-game';
import { RaidKind } from '../../packages/engine/src/raid-progression';
import { sharpAnchor } from '../../packages/engine/src/road-network';
import { Boon, boon } from '../../packages/engine/src/gate-boons';
import { sealFloors, sealable } from '../../packages/engine/src/gate-seals';
import { drillRules, towerVolley } from '../../packages/engine/src/progression-rules';
import { BUILDING_ASSETS } from '../../packages/content/src/assets';
import { addInventory, itemSpec } from '../../packages/engine/src/equipment';
import { decodeBuildingAsset } from '../../packages/native-renderer/src/building-asset';
import {
  GoalBranch,
  GoalKind,
  buildingUnlock,
  currentGoal,
  deedCount,
  goalComplete,
  goalProgress,
  settlementGoals,
  toolAvailable,
  unlockRequirements,
  type SettlementGoal,
} from '../../packages/engine/src/settlement-progression';

const added = [Structure.Watchtower, Structure.TrainingYard, Structure.Runestone];

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
function facility(town: Town, kind: Structure, at = town.map().camp()): Building {
  const b = new Building(town.nextId++, kind, { ...at }, 0, 0);
  b.village = 0;
  town.placed.push(b);
  return b;
}
function residents(town: Town, count: number): void {
  while (town.population() < count)
    town.folk.push(town.makePerson(Role.Resident, Calling.Settler, town.map().camp()));
}
function worker(town: Town, job: Building) {
  const p = town.makePerson(Role.Resident, Calling.Settler, { ...job.center });
  p.job = job.id;
  town.folk.push(p);
  return p;
}

describe('new buildings', () => {
  it('are appended after the old catalog with tools, assets and growth chains intact', () => {
    expect(Structure.Watchtower).toBe(35);
    // The workbench came after these, appended so saved building kinds keep their numbers.
    expect(Structure.Workbench).toBe(38);
    expect(Structure.Count).toBe(39);
    expect(added.map((kind) => structureSpec(kind).name)).toEqual(['Watchtower', 'Training yard', 'Runestone']);
    expect(added.map((kind) => structureSpec(kind).jobs)).toEqual([1, 2, 0]);
    expect(structureSpec(Structure.Runestone).cost.stone).toBeGreaterThan(structureSpec(Structure.Runestone).cost.wood);
    for (let kind = 0; kind < Structure.Count; ++kind) {
      const next = structureSpec(kind).next;
      expect(next).toBeLessThanOrEqual(Structure.Count);
      expect(added).not.toContain(next);
    }
    expect([Tool.Watchtower, Tool.TrainingYard, Tool.Runestone].map(toolStructure)).toEqual(added);
    expect(Tool.Runestone + 1).toBe(Tool.Workbench);
    expect(toolStructure(Tool.Workbench)).toBe(Structure.Workbench);
    expect(Tool.Workbench + 1).toBe(Tool.Count);
    for (const [key, id] of [
      ['Watchtower', 'watchtower'],
      ['TrainingYard', 'training-yard'],
      ['Runestone', 'runestone'],
    ] as const) {
      const asset = decodeBuildingAsset(JSON.stringify(BUILDING_ASSETS[key]));
      expect(asset.id).toBe(id);
      expect(asset.footprint).toBe(structureSpec(Structure[key]).size);
      expect(asset.variants).toHaveLength(1);
      // The building art is lineless: the shaded side is the lit colour pulled toward dusk indigo.
      for (const block of BUILDING_ASSETS[key].variants[0].blocks)
        block.wallLit.forEach((lit, i) =>
          expect(Math.abs(block.wallShade[i] - (lit * 0.68 + [46, 44, 84][i] * 0.32))).toBeLessThanOrEqual(1),
        );
    }
  });
  it('place, build and survive a save', () => {
    const { town, camp } = settlement();
    town.scout(camp.center.x, camp.center.y, 30);
    for (const kind of added) {
      let spot = null;
      for (let r = 3; r < 14 && !spot; ++r)
        for (let a = 0; a < 16 && !spot; ++a) {
          const p = point(camp.center.x + r * Math.cos(a * 0.39), camp.center.y + r * Math.sin(a * 0.39));
          if (town.canPlace(kind, p, 0).ok) spot = p;
        }
      expect(spot, structureSpec(kind).name).not.toBeNull();
      expect(town.place(kind, spot!, 0)).toBe(true);
    }
    town.completeConstruction();
    for (const kind of added) expect(town.placed.find((b) => b.kind === kind)?.built()).toBe(true);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 32, false, true));
    expect(loaded.placed.map((b) => [b.kind, b.built()])).toEqual(town.placed.map((b) => [b.kind, b.built()]));
    expect(encodeTown(loaded)).toBe(encodeTown(town));
  });
});

describe('watchtower', () => {
  function raid() {
    const { town, camp } = settlement();
    town.days = 14;
    town.summonRaid(RaidKind.Pack);
    const tower = facility(town, Structure.Watchtower, point(camp.center.x + 6, camp.center.y));
    for (const beast of town.beasts) beast.position = point(tower.center.x + 3, tower.center.y + 1);
    return { town, tower };
  }
  it('shoots raiders only while a resident keeps watch', () => {
    const { town, tower } = raid(),
      before = town.beasts.map((b) => b.health);
    town.defendSettlement(0.1);
    expect(town.beasts.map((b) => b.health)).toEqual(before);
    expect(town.watchtowerManned(tower.id)).toBe(false);
    const watcher = worker(town, tower);
    expect(town.watchtowerManned(tower.id)).toBe(true);
    town.defendSettlement(0.1);
    const lost = before.reduce((sum, h, i) => sum + h - town.beasts[i].health, 0),
      might = boon(town, Boon.Bulwark) ? 1.5 : 1;
    expect(lost).toBeCloseTo(towerVolley.damage * might, 4);
    const shot = town.hits().at(-1)!;
    expect(shot).toMatchObject({ ranged: true, onPerson: false, person: -1, from: tower.center });
    // One arrow per pause.
    town.defendSettlement(0.1);
    expect(before.reduce((sum, h, i) => sum + h - town.beasts[i].health, 0)).toBeCloseTo(lost, 4);
    town.time += towerVolley.pause;
    town.defendSettlement(0.1);
    expect(before.reduce((sum, h, i) => sum + h - town.beasts[i].health, 0)).toBeCloseTo(lost * 2, 4);
    // A downed watcher keeps no watch.
    watcher.downedAt = town.time;
    town.time += towerVolley.pause;
    const held = town.beasts.map((b) => b.health);
    town.defendSettlement(0.1);
    expect(town.beasts.map((b) => b.health)).toEqual(held);
  });
  it('reaches about nine tiles and ignores peaceful wildlife', () => {
    const { town, tower } = raid();
    worker(town, tower);
    for (const beast of town.beasts) beast.position = point(tower.center.x + towerVolley.reach + 0.5, tower.center.y);
    const before = town.beasts.map((b) => b.health);
    town.defendSettlement(0.1);
    expect(town.beasts.map((b) => b.health)).toEqual(before);
    for (const beast of town.beasts) beast.position = point(tower.center.x + towerVolley.reach - 0.5, tower.center.y);
    town.defendSettlement(0.1);
    expect(town.beasts.some((b, i) => b.health < before[i])).toBe(true);
  });
  it('shoots half again as hard with the Bulwark boon', () => {
    const { town, tower } = raid();
    worker(town, tower);
    const jotunheim = town
      .map()
      .dungeons()
      .findIndex((site, index) => {
        town.depth = town.map().dungeons().map((_, i) => (i === index ? sealFloors : 0));
        return sealable(site) && boon(town, Boon.Bulwark);
      });
    expect(jotunheim).toBeGreaterThanOrEqual(0);
    const might = 1.5,
      mark = town.beasts[0],
      before = mark.health;
    for (const beast of town.beasts.slice(1)) beast.position = point(0, 0);
    town.defendSettlement(0.1);
    expect(before - mark.health).toBeCloseTo(towerVolley.damage * might, 4);
  });
});

describe('training yard', () => {
  it('turns a day of drilling into experience and eases stress, below the level cap only', () => {
    const { town } = settlement(),
      yard = facility(town, Structure.TrainingYard),
      a = worker(town, yard),
      b = worker(town, yard),
      idle = worker(town, facility(town, Structure.Lumberyard));
    b.level = drillRules.levelCap;
    a.stress = 0.5;
    yard.attendance = 1;
    town.runDrills();
    // One day of drilling is most of the way to the first level, not all of it.
    expect(a.level).toBe(1);
    expect(a.experience).toBe(drillRules.experience);
    expect(a.experience).toBeLessThan(a.experienceToNextLevel());
    expect(a.stress).toBeCloseTo(0.5 - drillRules.stressRelief, 5);
    expect(b.level).toBe(drillRules.levelCap);
    expect(b.experience).toBe(0);
    expect(idle.experience).toBe(0);
    // A month (five days) of full drilling is worth a few levels, no more.
    for (let day = 1; day < 5; ++day) town.runDrills();
    expect(a.level).toBeGreaterThanOrEqual(3);
    expect(a.level).toBeLessThanOrEqual(5);
  });
  it('teaches nothing on a day nobody turned up or before it is built', () => {
    const { town } = settlement(),
      yard = facility(town, Structure.TrainingYard),
      p = worker(town, yard);
    yard.attendance = 0;
    town.runDrills();
    expect(p.experience).toBe(0);
    yard.attendance = 1;
    yard.progress = 0.5;
    town.runDrills();
    expect(p.experience).toBe(0);
  });
});

describe('runestone', () => {
  it('halves grief while one stands and names the fallen', () => {
    const { town } = settlement();
    town.fallen.push({
      id: 9,
      name: 'Ulf',
      past: '',
      look: 0,
      calling: Calling.Warrior,
      race: 0,
      level: 3,
      days: 4,
      kills: 2,
      cause: 'Slain by monsters',
      place: 'Midgard',
      day: 4,
      at: 1200,
      position: point(),
    });
    expect(town.memorialComfort()).toBe(1);
    expect(town.rememberedFallen()).toEqual([]);
    const stone = facility(town, Structure.Runestone);
    stone.progress = 0.4;
    expect(town.memorialComfort()).toBe(1);
    stone.progress = 1;
    expect(town.runestoneStands()).toBe(true);
    expect(town.memorialComfort()).toBe(0.5);
    expect(town.rememberedFallen().map((f) => f.name)).toEqual(['Ulf']);
    stone.faction = 1;
    expect(town.memorialComfort()).toBe(1);
  });
});

describe('unlocks by deeds', () => {
  it('asks for a guild, then a beaten raid, then a cleared floor along the arms branch', () => {
    const { town, gate } = settlement();
    residents(town, 12);
    expect(buildingUnlock(town, Structure.TrainingYard).reason).toBe('Complete Guild');
    facility(town, Structure.Guild);
    expect(buildingUnlock(town, Structure.TrainingYard).available).toBe(true);
    expect(buildingUnlock(town, Structure.Watchtower).reason).toBe('Complete Training yard');
    // The smith forges tools too: it follows the guild, not the drill yard.
    expect(buildingUnlock(town, Structure.Weaponsmith).reason).toBe('Complete Sawmill');
    facility(town, Structure.TrainingYard);
    expect(buildingUnlock(town, Structure.Watchtower)).toEqual({ available: false, reason: 'Beat off a raid' });
    town.chronicle.raidsRepelled = 1;
    expect(buildingUnlock(town, Structure.Watchtower).available).toBe(true);
    for (const kind of [Structure.Sawmill, Structure.Stoneworks]) facility(town, kind);
    expect(buildingUnlock(town, Structure.Weaponsmith).available).toBe(true);
    expect(buildingUnlock(town, Structure.Armorer).reason).toBe('Complete Weaponsmith');
    facility(town, Structure.Weaponsmith);
    expect(buildingUnlock(town, Structure.Armorer).reason).toBe('Clear a floor beyond a gate');
    town.depth = town.map().dungeons().map((_, i) => (i === gate ? 1 : 0));
    expect(buildingUnlock(town, Structure.Armorer).available).toBe(true);
    expect(toolAvailable(town, Tool.Armorer)).toBe(true);
  });
  it('puts the runestone and the apothecary early on the faith branch', () => {
    const { town } = settlement();
    expect(buildingUnlock(town, Structure.Runestone).available).toBe(true);
    expect(toolAvailable(town, Tool.Runestone)).toBe(true);
    residents(town, 5);
    expect(buildingUnlock(town, Structure.Apothecary).reason).toBe('Complete Altar of Odin');
    facility(town, Structure.Shrine);
    expect(buildingUnlock(town, Structure.Apothecary).reason).toBe('Needs 6 residents');
    residents(town, 6);
    expect(buildingUnlock(town, Structure.Apothecary).available).toBe(true);
    expect(buildingUnlock(town, Structure.Chapel).reason).toBe('Needs 10 residents');
    expect(structureSpec(Structure.Apothecary).cost.mana).toBe(0);
    expect(buildingUnlock(town, Structure.MageTower).reason).toBe('Complete Apothecary');
  });
  it('opens shelter, food and water with the camp, yards along a road and the altar after a home and a farm', () => {
    const { town } = settlement();
    for (const kind of [Structure.Tent, Structure.Farm, Structure.Well])
      expect(buildingUnlock(town, kind), structureSpec(kind).name).toEqual({ available: true, reason: '' });
    for (const kind of [Structure.Lumberyard, Structure.Quarry])
      expect(buildingUnlock(town, kind).reason, structureSpec(kind).name).toBe('Complete a road');
    expect(unlockRequirements(town, Structure.Shrine)).toEqual([
      { text: 'Complete Tent', done: false },
      { text: 'Complete Farmhouse', done: false },
    ]);
    facility(town, Structure.Tent);
    expect(buildingUnlock(town, Structure.Shrine).reason).toBe('Complete Farmhouse');
    facility(town, Structure.Farm);
    expect(buildingUnlock(town, Structure.Shrine).available).toBe(true);
  });
  it('opens the portal only after a gate is sealed', () => {
    const { town, gate } = settlement();
    residents(town, 30);
    for (const kind of [Structure.MageTower, Structure.Guild, Structure.Sawmill, Structure.Stoneworks])
      facility(town, kind);
    expect(buildingUnlock(town, Structure.Portal).reason).toBe('Seal a gate');
    town.depth = town.map().dungeons().map((_, i) => (i === gate ? sealFloors : 0));
    expect(buildingUnlock(town, Structure.Portal).available).toBe(true);
  });
  it('lists every requirement in the order buildingUnlock checks them', () => {
    const { town } = settlement();
    const check = () => {
      for (let kind = 0; kind < Structure.Count; ++kind) {
        const list = unlockRequirements(town, kind),
          unlock = buildingUnlock(town, kind);
        expect(unlock.available, structureSpec(kind).name).toBe(list.every((r) => r.done));
        expect(unlock.reason).toBe(list.find((r) => !r.done)?.text ?? '');
        expect(new Set(list.map((r) => r.text)).size).toBe(list.length);
      }
    };
    check();
    expect(unlockRequirements(town, Structure.Armorer).map((r) => r.text)).toEqual([
      'Complete Weaponsmith',
      'Clear a floor beyond a gate',
      'Complete Sawmill',
      'Complete Stoneworks',
      'Needs 12 residents',
    ]);
    residents(town, 12);
    facility(town, Structure.Guild);
    facility(town, Structure.TrainingYard);
    town.chronicle.raidsRepelled = 2;
    check();
    expect(unlockRequirements(town, Structure.Watchtower)).toEqual([
      { text: 'Complete Training yard', done: true },
      { text: 'Beat off a raid', done: true },
    ]);
    expect(unlockRequirements(town, Structure.Camp)).toEqual([]);
  });
});

describe('quests that follow the combat loop', () => {
  const goals = settlementGoals();
  function fulfil(town: Town, goal: SettlementGoal): void {
    switch (goal.kind) {
      case GoalKind.Building:
        facility(town, goal.building);
        break;
      case GoalKind.Population:
        residents(town, goal.count);
        break;
      case GoalKind.Road: {
        const c = town.map().camp(),
          id = town.roads().add([sharpAnchor(c), sharpAnchor(point(c.x + 3, c.y))], 1);
        town.roads().road(id)!.village = 0;
        break;
      }
      case GoalKind.Field:
        town.farmland.push(new Field(77, [point(1, 1), point(5, 1), point(5, 5), point(1, 5)], 0));
        break;
      case GoalKind.Floor:
      case GoalKind.Seal: {
        let left = goal.count || Infinity;
        town.depth = town
          .map()
          .dungeons()
          .map((site, i) => (sealable(site) && left-- > 0 ? sealFloors : (town.depth[i] ?? 0)));
        break;
      }
      case GoalKind.Craft:
        residents(town, 1);
        for (const id of goal.items.slice(0, goal.count)) addInventory(town.people()[0], id);
        break;
      case GoalKind.Equip:
        residents(town, goal.count);
        for (const p of town.people().slice(0, goal.count))
          if (addInventory(p, 'wooden-axe')) town.equipItem(p.id, p.inventory.findIndex((s) => s?.item === 'wooden-axe') + 1, 'tool2');
        break;
      case GoalKind.Deed:
        if (goal.deed === 'sworn') {
          const p = town.makePerson(Role.Resident, Calling.Warrior, town.map().camp());
          town.folk.push(p);
        } else if (goal.deed === 'floors' || goal.deed === 'seals')
          town.depth = town.map().dungeons().map(() => sealFloors);
        else if (goal.deed) town.chronicle[goal.deed] = goal.count;
        break;
    }
  }
  it('advances each branch in order and reports progress for every goal', () => {
    for (const branch of [GoalBranch.Core, GoalBranch.Trade, GoalBranch.Arms, GoalBranch.Faith, GoalBranch.Saga]) {
      const { town } = settlement(),
        // The fixture already stands on a founded camp.
        chain = goals.filter((goal) => goal.branch === branch && goal.building !== Structure.Camp),
        seen: string[] = [];
      for (let step = 0; step < chain.length + 2; ++step) {
        const index = currentGoal(town, branch);
        if (index < 0) break;
        const goal = goals[index],
          progress = goalProgress(town, goal);
        expect(progress.label, goal.title).not.toBe('');
        expect(progress.need).toBeGreaterThan(0);
        expect(goalComplete(town, goal)).toBe(false);
        seen.push(goal.title);
        fulfil(town, goal);
        expect(goalComplete(town, goal), goal.title).toBe(true);
        expect(goalProgress(town, goal).have).toBeGreaterThanOrEqual(goalProgress(town, goal).need);
      }
      expect(seen, GoalBranch[branch]).toEqual(chain.map((goal) => goal.title));
    }
  });
  it('opens every founding step with the steps before it, crafting before shelter and the altar after homes and food', () => {
    const { town } = settlement(),
      chain = goals.filter((goal) => goal.branch === GoalBranch.Core && goal.building !== Structure.Camp);
    expect(chain.map((goal) => goal.title).slice(0, 14)).toEqual([
      'Build a workbench',
      'Craft a wooden axe',
      'Craft wooden tools',
      'Craft a first weapon',
      'Equip both founders',
      'Build a tent',
      'Build a farmhouse',
      'Plant a field',
      'Build an altar',
      'Reach 4 residents',
      'Lay a road',
      'Build a lumberyard',
      'Build a well',
      'Build a quarry',
    ]);
    for (const goal of chain) {
      if (goal.kind === GoalKind.Building)
        expect(buildingUnlock(town, goal.building), goal.title).toEqual({ available: true, reason: '' });
      if (goal.kind === GoalKind.Road) expect(toolAvailable(town, Tool.Road)).toBe(true);
      if (goal.kind === GoalKind.Field) expect(toolAvailable(town, Tool.Field)).toBe(true);
      // Growth needs a standing altar and a free bed by the time the chain asks for it.
      if (goal.kind === GoalKind.Population) {
        expect(goalComplete(town, goals.find((g) => g.building === Structure.Shrine)!)).toBe(true);
        expect(town.housing()).toBeGreaterThanOrEqual(goal.count);
      }
      if (goal.kind === GoalKind.Craft)
        for (const id of goal.items) expect(itemSpec(id)?.workshop, id).toBe(Structure.Workbench);
      fulfil(town, goal);
    }
  });
  it('keeps a passed crafting lesson when its maker is lost, and reports it done', () => {
    const { town } = settlement(),
      axe = goals.find((goal) => goal.title === 'Craft a wooden axe')!,
      equip = goals.find((goal) => goal.kind === GoalKind.Equip)!;
    fulfil(town, axe);
    fulfil(town, equip);
    expect(goalComplete(town, axe)).toBe(true);
    for (const p of town.people()) p.inventory.fill(null);
    expect(goalComplete(town, axe)).toBe(false);
    expect(goalProgress(town, axe).label).toBe('Wood 0 / 3 for Wooden axe');
    facility(town, Structure.Tent);
    expect(goalComplete(town, axe)).toBe(true);
    expect(goalComplete(town, equip)).toBe(true);
    expect(goalProgress(town, axe)).toEqual({ have: 1, need: 1, label: 'Crafted' });
    expect(goalProgress(town, equip).have).toBe(2);
  });
  it('teaches the arms and saga loop with deeds', () => {
    const titles = (branch: GoalBranch) => goals.filter((g) => g.branch === branch).map((g) => g.title);
    expect(titles(GoalBranch.Arms)).toEqual([
      'Build a guild',
      'Swear a fighter',
      'Build a training yard',
      'Beat off a raid',
      'Build a watchtower',
      'Reach 10 residents',
      'Build a weaponsmith',
      'Forge a weapon',
      'Reach 12 residents',
      'Build an armorer',
    ]);
    expect(titles(GoalBranch.Saga)).toEqual([
      'Lead a party of three',
      'Slay a floor guardian',
      'Revive a downed ally',
      'Raise a runestone',
      'Seal a gate',
      'Reach 30 residents',
      'Build a portal',
      'Seal every gate',
    ]);
    // Every building goal is reachable: its own unlock never needs a goal further down the same branch.
    for (const branch of [GoalBranch.Arms, GoalBranch.Faith, GoalBranch.Saga]) {
      const chain = goals.filter((g) => g.branch === branch);
      chain.forEach((goal, i) => {
        if (goal.kind !== GoalKind.Building) return;
        const later = chain.slice(i + 1).filter((g) => g.kind === GoalKind.Building).map((g) => structureSpec(g.building).name);
        const { town } = settlement();
        for (const r of unlockRequirements(town, goal.building))
          expect(later.map((name) => 'Complete ' + name), goal.title).not.toContain(r.text);
      });
    }
  });
  it('reads deeds from the chronicle and the gates', () => {
    const { town, gate } = settlement();
    const swear = goals.find((g) => g.deed === 'sworn')!,
      party = goals.find((g) => g.deed === 'largestParty')!;
    expect(goalProgress(town, swear)).toEqual({ have: 0, need: 1, label: '0 / 1 residents sworn to a calling' });
    town.folk.push(town.makePerson(Role.Resident, Calling.Ranger, town.map().camp()));
    town.folk.push(town.makePerson(Role.Resident, Calling.Settler, town.map().camp()));
    expect(deedCount(town, 'sworn')).toBe(1);
    town.chronicle.largestParty = 2;
    expect(goalProgress(town, party)).toEqual({ have: 2, need: 3, label: 'Largest party 2 / 3' });
    expect(goalComplete(town, party)).toBe(false);
    town.depth = town.map().dungeons().map((_, i) => (i === gate ? 2 : 0));
    expect(deedCount(town, 'floors')).toBe(2);
    expect(deedCount(town, 'seals')).toBe(0);
    const every = goals.at(-1)!;
    expect(goalProgress(town, every).label).toMatch(/^0 \/ \d+ gates sealed$/);
    const portal = goals.find((g) => g.building === Structure.Portal)!;
    expect(goalProgress(town, portal)).toEqual({ have: 0, need: 1, label: 'Not built yet' });
    facility(town, Structure.Portal).progress = 0.2;
    expect(goalProgress(town, portal).label).toBe('Under construction');
  });
});
