import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Building } from '../../packages/engine/src/town-models';
import { Resources, Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Monster, Person, Role } from '../../packages/engine/src/person';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { sealable } from '../../packages/engine/src/gate-seals';
import { lairOf, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { add, distance, point } from '../../packages/engine/src/geometry';
import { CombatCue, MonsterRank, type CombatEvent } from '../../packages/engine/src/combat-events';
import { rankRules } from '../../packages/engine/src/monster-ranks';
import { realmRules } from '../../packages/engine/src/town-realm';
import { RaidKind } from '../../packages/engine/src/raid-progression';
import { itemCatalog } from '../../packages/engine/src/equipment';

const cues = (town: Town, cue: CombatCue) => town.combatEvents().filter((event) => event.cue === cue);
/** The best weapon of a shape the resident may wield. */
function arm(p: Person, visual: string) {
  const item = itemCatalog
    .filter((i) => i.category === 'weapon' && i.visual === visual && i.minimumLevel <= p.level)
    .sort((a, b) => b.attackBonus - a.attackBonus)[0];
  const index = p.inventory.findIndex((stack) => !stack);
  p.inventory[index] = { item: item.id, quantity: 1 };
  p.equipment.weapon = index + 1;
}
describe('swarms beyond a gate', () => {
  let base: WorldMap;
  beforeAll(() => {
    base = WorldMap.generate(5);
  }, 120000);
  function expedition(callings: Calling[], level: number, floor = 0) {
    const town = new Town(base, 176, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    const gate = town
      .map()
      .dungeons()
      .map((site, index) => ({ site, index }))
      .filter((g) => sealable(g.site))
      .sort((a, b) => distance(lairOf(a.site), camp.center) - distance(lairOf(b.site), camp.center))[0].index;
    town.map().dungeons()[gate].discovered = true;
    town.depth = town.map().dungeons().map((_, index) => (index === gate ? floor : 0));
    const members = callings.map((calling) => {
      const p = town.makePerson(Role.Resident, calling, monsterEntrance(town.map().dungeons()[gate]));
      town.folk.push(p);
      p.level = level;
      p.food = p.rest = p.hydration = 1;
      p.activity = Activity.Expedition;
      p.inside = true;
      return p;
    });
    town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor });
    town.advance(0.1);
    return { town, gate, members };
  }
  it('fills a floor with a brood: 40 to 90 monsters, mostly swarmers, two to four dens and a guardian', () => {
    for (const floor of [0, 1, 2]) {
      const { town } = expedition([Calling.Warrior], 4, floor),
        foes = town.realmFoes(),
        count = (rank: MonsterRank) => foes.filter((m) => m.rank === rank).length;
      expect(foes.length).toBeGreaterThanOrEqual(40);
      expect(foes.length).toBeLessThanOrEqual(90);
      expect(town.realmDens().length).toBeGreaterThanOrEqual(2);
      expect(town.realmDens().length).toBeLessThanOrEqual(4);
      expect(town.dens()).toEqual(town.realmDens());
      expect(count(MonsterRank.Guardian)).toBe(1);
      expect(count(MonsterRank.Swarmer)).toBeGreaterThan(foes.length / 2);
      expect(count(MonsterRank.Spitter)).toBeGreaterThan(0);
      expect(count(MonsterRank.Grunt)).toBeGreaterThan(0);
      for (const den of town.realmDens()) expect(foes.filter((m) => m.brood === den.id).length).toBeGreaterThan(0);
      for (const m of foes) expect(m.vigor).toBe(m.health);
    }
  }, 120000);
  it('lets a roused den put out a swarmer every few seconds up to its cap, and never move or bite', () => {
    const { town, members } = expedition([Calling.Warrior], 30),
      den = town.realmDens()[0],
      at = { ...den.position };
    // Only the den and one resident beside it.
    town.beasts = town.beasts.filter((m) => m === den || !town.inRealm(m.home));
    members[0].position = town.grid.nearestWalkable(add(den.position, point(3, 0)));
    town.orderHold([members[0].id]);
    const spawned: CombatEvent[] = [];
    let seen = -1n;
    for (let i = 0; i < 150; ++i) {
      town.advance(0.1);
      for (const e of town.combatEvents()) if (e.serial > seen && e.cue === CombatCue.Spawn) spawned.push(e);
      seen = town.combatEvents().at(-1)?.serial ?? seen;
    }
    expect(den.angry).toBe(true);
    expect(spawned.length).toBeGreaterThan(1);
    const young = town.monsters().find((m) => m.id === spawned[0].creature)!;
    expect(spawned[0].amount).toBe(den.id);
    expect(young).toMatchObject({ rank: MonsterRank.Swarmer, brood: den.id, angry: true });
    expect(young.bornAt).toBeGreaterThan(0);
    for (let i = 0; i < 400; ++i) {
      members[0].health = 1;
      town.advance(0.1);
    }
    const brood = town.realmFoes().filter((m) => m.brood === den.id && m.rank === MonsterRank.Swarmer);
    expect(brood.length).toBeLessThanOrEqual(rankRules.denBrood);
    expect(den.position).toEqual(at);
    expect(town.hits().some((hit) => hit.onPerson && distance(hit.from, at) < 0.01)).toBe(false);
  }, 120000);
  it('clears a floor only when every den and the guardian have fallen, then breaks the brood at once', () => {
    const { town, members } = expedition([Calling.Warrior, Calling.Warrior], 10),
      guardian = town.realmFoes().find((m) => m.id === town.realmGuardian)!,
      [first, ...others] = town.realmDens();
    town.strike(members[0], guardian);
    guardian.health = 0;
    town.stir(0.1);
    expect(town.realmCleared).toBe(false);
    expect(town.notices.at(-1)).toContain('The guardian has fallen');
    first.health = 0;
    town.combatState.slayers.set(first.id, members[0].id);
    town.stir(0.1);
    expect(cues(town, CombatCue.DenDestroyed).at(-1)).toMatchObject({ creature: first.id, person: members[0].id });
    expect(town.realmCleared).toBe(others.length === 0);
    const left = town.realmFoes().length - others.length,
      slain = town.chronicle.monstersSlain;
    for (const den of others) den.health = 0;
    town.stir(0.1);
    expect(town.realmCleared).toBe(true);
    expect(town.realmFoes()).toHaveLength(0);
    const broke = cues(town, CombatCue.BroodBreak);
    expect(broke).toHaveLength(1);
    expect(broke[0].amount).toBe(left);
    // Each of the brood still gets its death cue, for its death clip.
    expect(cues(town, CombatCue.Kill).filter((cue) => cue.person === -1).length).toBeGreaterThanOrEqual(left);
    expect(town.chronicle.monstersSlain).toBe(slain + others.length + left);
    expect(town.realmReward?.title).toBe('Floor 1 cleared');
    expect(town.canLeaveRealm().ok).toBe(true);
  }, 120000);
  it('lets a resident at the floor’s level fell a swarmer in one or two blows through its hide', () => {
    const { town, members } = expedition([Calling.Warrior], 4),
      [warrior] = members;
    arm(warrior, 'sword');
    town.roll = () => 0.99;
    const swarmer = town.realmFoes().find((m) => m.rank === MonsterRank.Swarmer)!,
      blow = town.blowAgainst(swarmer, town.blowStrength(warrior));
    expect(blow).toBeLessThan(town.blowStrength(warrior));
    expect(Math.ceil(swarmer.health / blow)).toBeLessThanOrEqual(2);
    // Bare hands barely scratch the hide.
    const bare = new Person(999, 'Bare', Role.Resident, Calling.Settler, 0, 0, point());
    expect(town.blowAgainst(swarmer, town.blowStrength(bare))).toBeLessThanOrEqual(town.blowStrength(bare) / 2);
  }, 120000);
  it('surrounds its prey instead of stacking on one spot', () => {
    const { town, members } = expedition([Calling.Warrior], 30),
      [p] = members,
      plan = town.realmPlan()!;
    town.beasts = town.beasts.filter((m) => !town.inRealm(m.home));
    p.position = { ...plan.entry };
    town.orderHold([p.id]);
    p.ready = Infinity;
    const pack: Monster[] = [];
    for (let i = 0; i < 6; ++i) {
      const m = new Monster(town.nextMonster++, town.realmGate, town.grid.nearestWalkable(add(p.position, point(3 + (i % 2) * 0.3, (i - 3) * 0.3))));
      m.home = { ...m.position };
      m.health = m.vigor = 1000;
      m.rank = MonsterRank.Swarmer;
      m.angry = true;
      town.beasts.push(m);
      pack.push(m);
    }
    for (let i = 0; i < 60; ++i) {
      p.health = 1;
      town.advance(0.1);
    }
    for (const m of pack) expect(distance(m.position, p.position)).toBeLessThan(1.3);
    for (let i = 0; i < pack.length; ++i)
      for (let j = i + 1; j < pack.length; ++j) expect(distance(pack[i].position, pack[j].position)).toBeGreaterThan(0.3);
    const sides = new Set(pack.map((m) => Math.round((Math.atan2(m.position.y - p.position.y, m.position.x - p.position.x) / Math.PI) * 2)));
    expect(sides.size).toBeGreaterThanOrEqual(3);
  }, 120000);
  it('answers the guardian’s enrage with a real wave of swarmers', () => {
    const { town } = expedition([Calling.Warrior], 20),
      guardian = town.realmFoes().find((m) => m.id === town.realmGuardian)!;
    const before = town.realmFoes().length;
    guardian.health = town.guardianVigor() * 0.4;
    town.advance(0.1);
    expect(cues(town, CombatCue.Enrage)).toHaveLength(1);
    const wave = cues(town, CombatCue.Spawn).filter((cue) => cue.amount === guardian.id);
    expect(wave).toHaveLength(realmRules.guardianWave);
    expect(town.realmFoes().length).toBe(before + realmRules.guardianWave);
  }, 120000);
  it('keeps a floor, its dens, timers and brood links exactly across a save', async () => {
    const { decodeTown, encodeTown } = await import('../../packages/engine/src/save-game');
    const { town, members } = expedition([Calling.Warrior, Calling.Ranger], 30),
      den = town.realmDens()[0];
    // Its own pack gone, the den has room to breed.
    town.beasts = town.beasts.filter((m) => m.brood !== den.id || m === den);
    members[0].position = town.grid.nearestWalkable(add(den.position, point(3, 0)));
    town.orderHold([members[0].id]);
    for (let i = 0; i < 25; ++i) town.advance(0.1);
    expect(den.ready).toBeGreaterThan(0);
    const loaded = decodeTown(encodeTown(town), (map) => new Town(map, 176, false, true)),
      shape = (t: Town) => t.realmFoes().map((m) => [m.id, m.rank, m.brood, m.ready, m.angry]);
    expect(shape(loaded)).toEqual(shape(town));
    expect(loaded.realmDens().map((m) => m.id)).toEqual(town.realmDens().map((m) => m.id));
    const saved = town.clock(),
      after = (t: Town) => cues(t, CombatCue.Spawn).filter((cue) => cue.at > saved).length;
    for (let i = 0; i < 60; ++i) {
      town.advance(0.1);
      loaded.advance(0.1);
    }
    expect(after(town)).toBeGreaterThan(0);
    expect(after(loaded)).toBe(after(town));
    expect(loaded.realmFoes().length).toBe(town.realmFoes().length);
  }, 120000);
});

describe('a party falling beyond a gate', () => {
  let base: WorldMap;
  beforeAll(() => {
    base = WorldMap.generate(5);
  }, 120000);
  function party() {
    const town = new Town(base, 176, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    const gate = town.map().dungeons().findIndex(sealable);
    town.map().dungeons()[gate].discovered = true;
    const members = [Calling.Ranger, Calling.Mage, Calling.Cleric].map((calling) => {
      const p = town.makePerson(Role.Resident, calling, monsterEntrance(town.map().dungeons()[gate]));
      town.folk.push(p);
      p.level = 22;
      p.activity = Activity.Expedition;
      p.inside = true;
      return p;
    });
    town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor: 0 });
    town.advance(0.1);
    // Nothing on the floor can reach them, and no skill gets anyone up: only the bleeding counts here.
    town.beasts = town.beasts.filter((m) => !town.inRealm(m.home));
    for (const slot of [0, 1]) town.setSkillAuto(members.map((p) => p.id), slot, false);
    town.orderMove([members[2].id], town.realmPlan()!.chambers.at(-1)!.center);
    return { town, members };
  }
  it('casts everyone out alive when the last one standing falls', () => {
    const { town, members } = party();
    for (const p of members.slice(0, 2)) town.strikeDown(p, 'Killed by monsters');
    for (let i = 0; i < 100; ++i) town.advance(0.1);
    town.strikeDown(members[2], 'Killed by monsters');
    town.advance(0.1);
    expect(town.realmActive()).toBe(false);
    expect(town.fallen).toHaveLength(0);
    for (const p of members) expect(p).toMatchObject({ downedAt: -1, health: expect.any(Number) });
  }, 120000);
  it('lets the downed bleed out while one still stands and nobody kneels by them', () => {
    const { town, members } = party(),
      [first, second, last] = members;
    town.strikeDown(first, 'Killed by monsters');
    town.strikeDown(second, 'Killed by monsters');
    // The last one walks away on orders and never kneels by them.
    for (let i = 0; i < 480 && town.realmActive(); ++i) {
      last.health = 1;
      town.advance(0.1);
    }
    expect(town.realmActive()).toBe(true);
    expect(town.fallen.map((f) => f.id).sort()).toEqual([first.id, second.id].sort());
  }, 120000);
});

describe('raids come as waves', () => {
  function settlement() {
    const town = new Town(5, 48, false),
      camp = new Building(0, Structure.Camp, town.map().camp(), 0, 0);
    camp.village = 0;
    town.placed.push(camp);
    town.nextId = 1;
    town.foundSettlement(0);
    Object.assign(town.stock(0), new Resources(200, 60, 60, 60, 0, 60, 20, 20));
    const gate = town.map().dungeons().findIndex((site) => site.kind !== DungeonKind.GiantHall && sealable(site));
    town.map().dungeons()[gate].discovered = true;
    return { town, camp, gate };
  }
  it('sends many weak monsters with a few leaders and says so', () => {
    const { town } = settlement();
    town.days = 35;
    town.summonRaid(RaidKind.Pack);
    const raiders = town.monsters(),
      swarm = raiders.filter((m) => m.rank === MonsterRank.Swarmer);
    expect(swarm.length).toBeGreaterThan(raiders.length / 2);
    expect(raiders.some((m) => m.rank === MonsterRank.Brute)).toBe(true);
    expect(swarm[0].health).toBeLessThan(raiders[0].health / 3);
    expect(cues(town, CombatCue.Wave)).toEqual([expect.objectContaining({ amount: raiders.length })]);
  });
  it('is held at the first raids by a manned watchtower, the ward and a few fighters', () => {
    const { town, camp, gate } = settlement(),
      at = camp.center,
      tower = new Building(town.nextId++, Structure.Watchtower, town.grid.nearestWalkable(add(at, point(3, 3))), 0, 0);
    tower.village = 0;
    town.placed.push(tower);
    town.tick(0);
    const fighter = (calling: Calling, visual: string, offset: number) => {
      const p = town.makePerson(Role.Resident, calling, town.grid.nearestWalkable(add(at, point(offset, -2))));
      town.folk.push(p);
      p.level = 2;
      p.home = p.village = 0;
      p.food = p.rest = p.hydration = 1;
      p.stress = 0;
      arm(p, visual);
      return p;
    };
    const guard = fighter(Calling.Settler, 'bow', 0),
      party = [fighter(Calling.Warrior, 'sword', -1), fighter(Calling.Warrior, 'sword', 1), fighter(Calling.Ranger, 'bow', 2)];
    guard.job = tower.id;
    guard.position = { ...tower.center };
    town.wardUntil = Infinity;
    town.days = 2;
    town.editHour(22);
    town.summonRaid(RaidKind.Pack);
    const size = town.monsters().filter((m) => m.raider).length;
    expect(size).toBeGreaterThan(4);
    // The raiders find the settlement; the fighters meet them.
    town.orderAttackMove(
      party.map((p) => p.id),
      lairOf(town.map().dungeons()[gate]),
    );
    for (let i = 0; i < 1800 && town.raiding(); ++i) {
      town.wildlifeDay = town.days;
      town.advance(0.1);
      if (i % 50 === 0) town.orderAttackMove(party.map((p) => p.id), town.monsters().find((m) => m.raider)?.position ?? at);
    }
    expect(town.raiding()).toBe(false);
    expect(town.chronicle.raidsRepelled).toBe(1);
    expect(town.fallen).toHaveLength(0);
    expect(town.building(camp.id)).not.toBeNull();
  }, 120000);
});
