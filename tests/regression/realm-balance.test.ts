import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Person, Role } from '../../packages/engine/src/person';
import { sealable } from '../../packages/engine/src/gate-seals';
import { lairOf, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { itemCatalog, itemSpec } from '../../packages/engine/src/equipment';
import { ChamberKind } from '../../packages/engine/src/realm-layout';
import { distance, type Point } from '../../packages/engine/src/geometry';
import { CombatCue, MonsterRank } from '../../packages/engine/src/combat-events';
import { rankRules } from '../../packages/engine/src/monster-ranks';

// A scripted party plays a floor beyond the nearest gate: attack-move from the entry to the nearest den left, then
// the heart; a member fighting away from the rest is helped first; the downed are tended once no monster stands over
// them; a telegraphed slam is walked out of. Skills are left on auto (the default) or all switched off.
const letters: Record<string, Calling> = { W: Calling.Warrior, R: Calling.Ranger, M: Calling.Mage, C: Calling.Cleric };
const shape = (c: Calling) => (c === Calling.Warrior ? 'sword' : c === Calling.Ranger ? 'bow' : c === Calling.Mage ? 'staff' : 'mace');
const wooden = (id: string) => itemSpec(id)?.material === 'wood' && id !== 'staff' && id !== 'bow';
function arm(p: Person, gear: 'wood' | 'iron') {
  const item = itemCatalog
    .filter((i) => i.category === 'weapon' && i.visual === shape(p.calling) && i.minimumLevel <= p.level && wooden(i.id) === (gear === 'wood'))
    .sort((a, b) => b.attackBonus - a.attackBonus)[0];
  if (!item) return;
  p.inventory[0] = { item: item.id, quantity: 1 };
  p.equipment.weapon = 1;
}
interface Outcome {
  cleared: boolean;
  seconds: number;
  downed: number;
  dead: number;
  kills: number;
}
let base: WorldMap;
function enter(comp: string, level: number, gear: 'wood' | 'iron', floor: number) {
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
  const members = [...comp].map((c) => {
    const p = town.makePerson(Role.Resident, letters[c], monsterEntrance(town.map().dungeons()[gate]));
    town.folk.push(p);
    p.level = level;
    p.food = p.rest = p.hydration = 1;
    p.stress = 0;
    arm(p, gear);
    p.activity = Activity.Expedition;
    p.inside = true;
    return p;
  });
  town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor });
  town.advance(0.1);
  return { town, members };
}
function play(comp: string, level: number, gear: 'wood' | 'iron', skills: boolean, floor = 0): Outcome {
  const { town, members } = enter(comp, level, gear, floor),
    ids = members.map((p) => p.id);
  if (!skills) for (const slot of [0, 1]) town.setSkillAuto(ids, slot, false);
  const heart = town.realmPlan()!.chambers.find((c) => c.kind === ChamberKind.Heart)!,
    downed = new Set<number>(),
    lead = () => members.find((p) => p.downedAt < 0) ?? members[0],
    goal = () =>
      town.realmDens().sort((a, b) => distance(a.position, lead().position) - distance(b.position, lead().position))[0]
        ?.position ?? heart.center;
  let t = 0,
    seen = -1n,
    dodgeUntil = -1,
    warn: { position: Point; radius: number; duration: number } | null = null;
  for (; t < 600 && town.realmActive() && !town.realmCleared; t += 0.1) {
    if (warn) {
      for (const p of members)
        if (p.downedAt < 0 && distance(p.position, warn.position) < warn.radius + 0.8) {
          const dx = p.position.x - warn.position.x,
            dy = p.position.y - warn.position.y,
            len = Math.hypot(dx, dy) || 1,
            out = warn.radius + 1.5;
          town.orderMove([p.id], town.grid.nearestWalkable({ x: warn.position.x + (dx / len) * out, y: warn.position.y + (dy / len) * out }));
        }
      dodgeUntil = t + warn.duration + 0.3;
      warn = null;
    }
    if (t >= dodgeUntil && Math.round(t * 10) % 20 === 0) {
      const standing = members.filter((p) => p.downedAt < 0 && p.health > 0),
        busy = new Set(members.filter((p) => p.task === Activity.Tending).map((p) => p.id));
      for (const d of members.filter((p) => p.downedAt >= 0 && p.health > -0.5)) {
        if (members.some((p) => p.task === Activity.Tending && p.taskSite === d.id)) continue;
        if (town.realmFoes().some((m) => m.rank !== MonsterRank.Den && distance(m.position, d.position) < 3)) continue;
        const helper = standing
          .filter((p) => !busy.has(p.id))
          .sort((a, b) => distance(a.position, d.position) - distance(b.position, d.position))[0];
        if (helper && town.orderTend([helper.id], d.id)) busy.add(helper.id);
      }
      const rest = standing.filter((p) => !busy.has(p.id)).map((p) => p.id),
        fallen = members.find((p) => p.downedAt >= 0 && p.health > -0.5),
        centre = standing.reduce(
          (c, p) => ({ x: c.x + p.position.x / standing.length, y: c.y + p.position.y / standing.length }),
          { x: 0, y: 0 },
        ),
        alone = standing.find((p) => p.activity === Activity.Fighting && distance(p.position, centre) > 4);
      if (rest.length) town.orderAttackMove(rest, fallen?.position ?? alone?.position ?? goal());
    }
    town.advance(0.1);
    for (const p of members) if (p.downedAt >= 0) downed.add(p.id);
    for (const e of town.combatEvents()) {
      if (e.serial <= seen) continue;
      seen = e.serial;
      if (e.cue === CombatCue.Telegraph) warn = e;
    }
  }
  return {
    cleared: town.realmCleared,
    seconds: Math.round(t),
    downed: downed.size,
    dead: town.fallen.length,
    kills: members.reduce((sum, p) => sum + p.kills, 0),
  };
}
const cases = {
  four: ['WRMC', 4, 'wood', true, 0],
  'four without skills': ['WRMC', 4, 'wood', false, 0],
  'four under level': ['WRMC', 2, 'wood', true, 0],
  six: ['WWRRMC', 4, 'wood', true, 0],
  'three at 8': ['WMC', 8, 'iron', true, 0],
  'three at 12': ['WMC', 12, 'iron', true, 0],
  'three at 20': ['WMC', 20, 'iron', true, 0],
  'floor 2': ['WRMC', 8, 'iron', true, 1],
  'floor 3': ['WRMC', 12, 'iron', true, 2],
} as const;
describe('floors played by small parties', () => {
  const outcomes = new Map<string, Outcome>();
  beforeAll(() => {
    base = WorldMap.generate(5);
    for (const [key, [comp, level, gear, skills, floor]] of Object.entries(cases))
      outcomes.set(key, play(comp, level, gear, skills, floor));
    console.log(JSON.stringify(Object.fromEntries(outcomes)));
  }, 900000);
  it('lets four at level 4 with wooden arms clear floor 1, one downed at most and nobody dead', () => {
    expect(outcomes.get('four')).toMatchObject({ cleared: true, dead: 0 });
    expect(outcomes.get('four')!.downed).toBeLessThanOrEqual(1);
  });
  it('makes the same four worse without skills, but not wiped inside a minute', () => {
    const plain = outcomes.get('four without skills')!;
    expect(plain.downed).toBeGreaterThan(0);
    if (!plain.cleared) expect(plain.seconds).toBeGreaterThanOrEqual(60);
  });
  it('defeats four two levels under, or leaves most of them downed', () => {
    const under = outcomes.get('four under level')!;
    expect(!under.cleared || under.downed >= 3).toBe(true);
  });
  it('is easy for six at level 4', () => {
    expect(outcomes.get('six')).toMatchObject({ cleared: true, downed: 0, dead: 0 });
    expect(outcomes.get('six')!.seconds).toBeLessThan(outcomes.get('four')!.seconds);
  });
  it('lets three iron-armed residents through as they rise: at 8, at 12 unhurt, at 20 walking', () => {
    expect(outcomes.get('three at 8')).toMatchObject({ cleared: true, dead: 0 });
    expect(outcomes.get('three at 12')).toMatchObject({ cleared: true, downed: 0 });
    expect(outcomes.get('three at 20')).toMatchObject({ cleared: true, downed: 0 });
    expect(outcomes.get('three at 20')!.seconds).toBeLessThan(0.85 * outcomes.get('three at 8')!.seconds);
  });
  it('fits floor 2 to four at level 8 and floor 3 to four at level 12', () => {
    expect(outcomes.get('floor 2')).toMatchObject({ cleared: true, dead: 0 });
    expect(outcomes.get('floor 3')).toMatchObject({ cleared: true, dead: 0 });
  });
  it('lets three at the floor’s level cut a den’s brood down faster than it grows and fell the den', () => {
    const { town, members } = enter('WRC', 4, 'wood', 0),
      den = town.realmDens()[0];
    // Only this den and its own pack.
    town.beasts = town.beasts.filter((m) => !town.inRealm(m.home) || m === den || m.brood === den.id);
    for (const p of members) p.position = town.grid.nearestWalkable({ x: den.position.x + 4, y: den.position.y });
    const brood = () => town.realmFoes().filter((m) => m.brood === den.id && m.rank === MonsterRank.Swarmer).length,
      start = brood();
    let most = 0,
      t = 0;
    for (; t < 120 && den.health > 0 && town.realmActive(); t += 0.1) {
      if (Math.round(t * 10) % 20 === 0) town.orderAttack(members.filter((p) => p.downedAt < 0).map((p) => p.id), den.id);
      town.advance(0.1);
      most = Math.max(most, brood());
    }
    expect(den.health).toBeLessThanOrEqual(0);
    expect(t).toBeLessThan(60);
    // The brood never outgrows what the den started with, or its cap.
    expect(most).toBeLessThanOrEqual(Math.max(start, rankRules.denBrood));
    console.log(`den: fell after ${Math.round(t)} s, brood ${start} at the start, ${most} at most`);
    expect(town.fallen).toHaveLength(0);
  });
});
