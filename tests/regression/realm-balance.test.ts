import { beforeAll, describe, expect, it } from 'vitest';
import { Town } from '../../packages/engine/src/town';
import { WorldMap } from '../../packages/engine/src/world-map';
import { Building } from '../../packages/engine/src/town-models';
import { Structure } from '../../packages/engine/src/building-catalog';
import { Activity, Calling, Person, Role } from '../../packages/engine/src/person';
import { sealable } from '../../packages/engine/src/gate-seals';
import { lairOf, monsterEntrance } from '../../packages/engine/src/town-monsters';
import { itemCatalog } from '../../packages/engine/src/equipment';
import { ChamberKind } from '../../packages/engine/src/realm-layout';
import { distance, type Point } from '../../packages/engine/src/geometry';
import { CombatCue } from '../../packages/engine/src/combat-events';

// A scripted party plays the first floor beyond the nearest gate: attack-move from the entry to the nearest den
// left, then the heart; the downed are tended; a telegraphed slam is walked out of. With skills, every skill is
// left on auto, so each fires whenever it is ready and useful.
const shape = (c: Calling) => (c === Calling.Warrior ? 'sword' : c === Calling.Ranger ? 'bow' : c === Calling.Mage ? 'staff' : 'mace');
function arm(p: Person) {
  const item = itemCatalog
    .filter((i) => i.category === 'weapon' && i.visual === shape(p.calling) && i.minimumLevel <= p.level)
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
function play(level: number, skills: boolean): Outcome {
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
  const members = [Calling.Warrior, Calling.Warrior, Calling.Ranger, Calling.Ranger, Calling.Mage, Calling.Cleric].map((c) => {
    const p = town.makePerson(Role.Resident, c, monsterEntrance(town.map().dungeons()[gate]));
    town.folk.push(p);
    p.level = level;
    p.food = p.rest = p.hydration = 1;
    p.stress = 0;
    arm(p);
    p.activity = Activity.Expedition;
    p.inside = true;
    return p;
  });
  town.parties.push({ dungeon: gate, members: members.map((p) => p.id), floor: 0 });
  town.advance(0.1);
  const ids = members.map((p) => p.id);
  for (const slot of [0, 1]) town.setSkillAuto(ids, slot, skills);
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
        const helper = standing
          .filter((p) => !busy.has(p.id))
          .sort((a, b) => distance(a.position, d.position) - distance(b.position, d.position))[0];
        if (helper && town.orderTend([helper.id], d.id)) busy.add(helper.id);
      }
      const rest = standing.filter((p) => !busy.has(p.id)).map((p) => p.id);
      if (rest.length) town.orderAttackMove(rest, goal());
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
describe('the first floor, played by a scripted party of six', () => {
  const outcomes = new Map<string, Outcome>();
  beforeAll(() => {
    base = WorldMap.generate(5);
    for (const [key, level, skills] of [
      ['level', 4, true],
      ['no skills', 4, false],
      ['under level', 1, true],
      ['high level', 12, true],
    ] as const)
      outcomes.set(key, play(level, skills));
    console.log(JSON.stringify(Object.fromEntries(outcomes)));
  }, 600000);
  it('is cleared by a party at the floor’s level using its skills, losing nobody', () => {
    expect(outcomes.get('level')).toMatchObject({ cleared: true, dead: 0 });
    expect(outcomes.get('level')!.kills).toBeGreaterThan(55);
  });
  it('downs someone, or is lost, when the same party never uses a skill', () => {
    const plain = outcomes.get('no skills')!;
    expect(plain.downed > 0 || !plain.cleared).toBe(true);
  });
  it('is lost by a party clearly under its level', () => {
    expect(outcomes.get('under level')!.cleared).toBe(false);
  });
  it('falls markedly faster to a strong party', () => {
    const strong = outcomes.get('high level')!;
    expect(strong.cleared).toBe(true);
    expect(strong.seconds).toBeLessThan(0.85 * outcomes.get('level')!.seconds);
  });
});
