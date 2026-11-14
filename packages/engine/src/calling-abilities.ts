import type { Town } from './town';
import { Activity, Role, type Monster, type Person } from './person';
import { distance, type Point } from './geometry';
import { f32 as f, lround } from './numeric';
import { CombatCue, type AbilityId, type AbilityState } from './combat-events';
import { canControl, playerFaction } from './faction';
import { healthCap } from './resident-wounds';
import { SkillAim, StrikeKind, skillOfCalling, skillPower, skillSpec, type SkillSpec } from './skill-catalog';

/** Seconds between two looks a resident on auto takes at whether a skill would help. */
const autoLook = 0.25;
const slots = [0, 1];
const standing = (p: Person): boolean => p.health > 0 && p.downedAt < 0;
const foeOf = (town: Town, m: Monster): boolean =>
  m.health > 0 && !m.insideLair && (m.animal === null || m.angry) && town.world.revealed(m.position);
const roused = (m: Monster): boolean => m.angry || m.raider;

function readyAt(p: Person, slot: number): number {
  return slot ? p.abilityReadyAt2 : p.abilityReadyAt;
}
function activeUntil(p: Person, slot: number): number {
  return slot ? p.abilityUntil2 : p.abilityUntil;
}
function setUntil(p: Person, slot: number, until: number): void {
  if (slot) p.abilityUntil2 = until;
  else p.abilityUntil = until;
}
function autoOn(p: Person, spec: SkillSpec): boolean {
  const choice = spec.slot ? p.abilityAuto2 : p.abilityAuto;
  return choice < 0 ? spec.auto : choice > 0;
}
const locked = (p: Person, spec: SkillSpec): boolean => p.level < spec.level;

function enemiesNear(town: Town, at: Point, reach: number): Monster[] {
  const out: Monster[] = [];
  for (const group of [town.beasts, town.animals])
    for (const m of group) if (distance(m.position, at) <= reach && foeOf(town, m)) out.push(m);
  return out;
}
function allies(town: Town, p: Person, reach: number, at = p.position): Person[] {
  return town.folk.filter(
    (a) => a.faction === p.faction && !a.inside && a.health > -0.5 && distance(a.position, at) <= reach,
  );
}
function aimedMark(town: Town, p: Person, reach: number): Monster | null {
  const current = p.foe >= 0 ? town.creature(p.foe) : null;
  if (current && foeOf(town, current) && distance(current.position, p.position) <= reach) return current;
  return (
    enemiesNear(town, p.position, reach).sort(
      (a, b) => distance(a.position, p.position) - distance(b.position, p.position) || a.id - b.id,
    )[0] ?? null
  );
}
/** The point within `range` of the resident with the most roused enemies inside one circle, and how many. */
function bestSpot(town: Town, p: Person, range: number, radius: number): { at: Point; count: number } | null {
  const near = enemiesNear(town, p.position, range + radius).filter((m) => m.animal !== null || roused(m));
  let best: { at: Point; count: number } | null = null;
  for (const m of near) {
    if (distance(m.position, p.position) > range) continue;
    let count = 0;
    for (const other of near) if (distance(other.position, m.position) <= radius) ++count;
    if (!best || count > best.count) best = { at: { ...m.position }, count };
  }
  return best;
}
function mendTarget(town: Town, p: Person, reach: number): { ally: Person; downed: boolean } | null {
  const near = allies(town, p, reach),
    fallen = near
      .filter((a) => a.downedAt >= 0 && a.health > -0.5)
      .sort((a, b) => distance(a.position, p.position) - distance(b.position, p.position))[0];
  if (fallen) return { ally: fallen, downed: true };
  const hurt = near
    .filter((a) => standing(a) && a.health < healthCap(a) - 0.02)
    .sort((a, b) => a.health / healthCap(a) - b.health / healthCap(b) || a.id - b.id)[0];
  return hurt ? { ally: hurt, downed: false } : null;
}
function rouse(m: Monster, p: Person): void {
  if (!m.raider) m.angry = true;
  if (m.giant() || m.animal !== null) m.provokedBy = p.id;
}
/** Lands one blow of a skill on a monster, with its hit for presentation. */
function skillBlow(town: Town, from: Point, m: Monster, raw: number, by: Person | null, ranged: boolean): void {
  const damage = town.blowAgainst(m, raw);
  if (by) rouse(m, by);
  else if (!m.raider) m.angry = true;
  town.blows.push({
    serial: town.nextBlow++,
    from: { ...from },
    to: { ...m.position },
    damage: lround(f(damage * 10)),
    onPerson: false,
    ranged,
    at: town.time,
    person: by?.id ?? -1,
    attacker: by?.id,
    strike: StrikeKind.Single,
    primary: true,
  });
  town.hurtCreature(m, damage, by);
}
function fire(town: Town, p: Person, spec: SkillSpec, target?: Point): boolean {
  const time = town.time,
    state = town.combatState,
    cue = (at: Point, creature = -1) =>
      town.emit(CombatCue.Ability, at, {
        person: p.id,
        creature,
        text: spec.name,
        skill: spec.id,
        radius: spec.radius || spec.range,
        duration: spec.duration || spec.delay,
      }),
    land = (at: Point, damage: number) => {
      state.bursts.push({ by: p.id, skill: spec.id, at: { ...at }, lands: time + spec.delay, damage, radius: spec.radius });
      setUntil(p, spec.slot, time + spec.delay + spec.duration);
      cue(at);
    },
    ground = (): Point | null => {
      const at = target ?? bestSpot(town, p, spec.range, spec.radius)?.at ?? null;
      return at && distance(at, p.position) <= spec.range ? at : null;
    };
  switch (spec.id) {
    case 'challenge': {
      const foes = enemiesNear(town, p.position, spec.radius).filter((m) => m.animal === null);
      if (!foes.length) return false;
      for (const m of foes) {
        state.taunts.set(m.id, { by: p.id, until: time + spec.duration });
        if (!m.raider) m.angry = true;
      }
      setUntil(p, spec.slot, time + spec.duration);
      cue(p.position);
      return true;
    }
    case 'whirl': {
      if (!enemiesNear(town, p.position, spec.radius).length) return false;
      land(p.position, f(town.blowStrength(p) * skillPower.whirl));
      return true;
    }
    case 'aimed': {
      const mark = aimedMark(town, p, spec.range);
      if (!mark) return false;
      if (mark.windupUntil >= 0) town.breakWindup(mark);
      skillBlow(town, p.position, mark, f(town.blowStrength(p) * skillPower.aimed), p, true);
      cue(mark.position, mark.id);
      return true;
    }
    case 'burst':
    case 'volley':
    case 'frost': {
      const at = ground();
      if (!at) return false;
      const power = spec.id === 'burst' ? skillPower.burst : spec.id === 'volley' ? skillPower.volley : 0;
      land(at, f(town.blowStrength(p) * power));
      return true;
    }
    case 'mend': {
      const mark = mendTarget(town, p, spec.range);
      if (!mark) return false;
      const before = mark.ally.health;
      if (mark.downed) town.revive(mark.ally);
      else mark.ally.health = Math.min(healthCap(mark.ally), f(mark.ally.health + skillPower.mendHealth));
      town.emit(CombatCue.Heal, mark.ally.position, {
        person: mark.ally.id,
        amount: Math.round((mark.ally.health - Math.max(0, before)) * 100),
      });
      cue(p.position);
      return true;
    }
    case 'sanctuary': {
      state.sanctuaries.push({ by: p.id, at: { ...p.position }, radius: spec.radius, until: time + spec.duration });
      setUntil(p, spec.slot, time + spec.duration);
      cue(p.position);
      return true;
    }
    case 'rally': {
      for (const a of allies(town, p, spec.radius))
        if (standing(a)) state.rallied.set(a.id, time + spec.duration);
      setUntil(p, spec.slot, time + spec.duration);
      cue(p.position);
      return true;
    }
    case 'dirge': {
      const foes = enemiesNear(town, p.position, spec.radius).filter((m) => m.animal === null);
      if (!foes.length) return false;
      for (const m of foes) {
        state.dirged.set(m.id, time + spec.duration);
        if (!m.raider) m.angry = true;
      }
      setUntil(p, spec.slot, time + spec.duration);
      cue(p.position);
      return true;
    }
    default:
      return false;
  }
}
function use(town: Town, p: Person, slot: number, target?: Point): boolean {
  const spec = skillOfCalling(p.calling, slot);
  if (!spec || locked(p, spec) || town.time < readyAt(p, slot) || !standing(p) || p.inside) return false;
  if (!fire(town, p, spec, target)) return false;
  if (slot) p.abilityReadyAt2 = town.time + spec.cooldown;
  else p.abilityReadyAt = town.time + spec.cooldown;
  p.cast = spec.id;
  p.castAt = town.time;
  p.castUntil = town.time + Math.max(spec.delay, 0.4);
  return true;
}
function worthUsing(town: Town, p: Person, spec: SkillSpec): boolean {
  const fighting = (a: Person) => a !== p && standing(a) && a.activity === Activity.Fighting;
  switch (spec.id) {
    case 'challenge':
      return enemiesNear(town, p.position, 3).filter((m) => m.animal === null).length >= 2;
    case 'whirl':
      return enemiesNear(town, p.position, spec.radius).filter((m) => m.animal === null).length >= 3;
    case 'aimed': {
      const mark = aimedMark(town, p, spec.range);
      return (
        !!mark &&
        (mark.angry || mark.raider || p.activity === Activity.Fighting) &&
        (mark.windupUntil >= 0 || mark.health > 2 * town.blowStrength(p))
      );
    }
    case 'burst':
      return (bestSpot(town, p, spec.range, spec.radius)?.count ?? 0) >= 2;
    case 'volley':
      return (bestSpot(town, p, spec.range, spec.radius)?.count ?? 0) >= 3;
    case 'frost':
      return (bestSpot(town, p, spec.range, spec.radius)?.count ?? 0) >= 4;
    case 'mend': {
      const mark = mendTarget(town, p, spec.range);
      return !!mark && (mark.downed || mark.ally.health < 0.5);
    }
    case 'sanctuary': {
      const near = allies(town, p, spec.radius);
      return (
        near.some((a) => a.downedAt >= 0) ||
        near.filter((a) => standing(a) && a.health < 0.5 * healthCap(a)).length >= 2
      );
    }
    case 'rally':
      return allies(town, p, spec.radius).filter(fighting).length >= 2;
    case 'dirge':
      return enemiesNear(town, p.position, spec.radius).filter((m) => m.animal === null && roused(m)).length >= 4;
    default:
      return false;
  }
}
function skillState(town: Town, p: Person, spec: SkillSpec): AbilityState {
  const remaining = Math.max(0, readyAt(p, spec.slot) - town.time),
    closed = locked(p, spec);
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    ready: !closed && remaining <= 0,
    remaining,
    cooldown: spec.cooldown,
    active: activeUntil(p, spec.slot) > town.time,
    auto: autoOn(p, spec),
    targeted: spec.aim === SkillAim.Ground,
    slot: spec.slot,
    locked: closed,
    level: spec.level,
  };
}

/** The skills of a resident's calling in slot order, a second one still locked included; none for settlers. */
export function skillsOf(this: Town, p: Person): AbilityState[] {
  const out: AbilityState[] = [];
  for (const slot of slots) {
    const spec = skillOfCalling(p.calling, slot);
    if (spec) out.push(skillState(this, p, spec));
  }
  return out;
}
/** Fires the skill in `slot` of every chosen resident who has it ready; returns how many did. */
export function useSkill(this: Town, ids: number[], slot: number, target?: Point): number {
  let used = 0;
  for (const p of this.folk)
    if (ids.includes(p.id) && canControl(p, this.controlFaction) && use(this, p, slot, target)) ++used;
  return used;
}
/** Turns auto-use of the skill in `slot` on or off for the chosen residents; returns how many changed. */
export function setSkillAuto(this: Town, ids: number[], slot: number, enabled: boolean): number {
  let changed = 0;
  for (const p of this.folk)
    if (ids.includes(p.id) && canControl(p, this.controlFaction) && skillOfCalling(p.calling, slot)) {
      if (slot) p.abilityAuto2 = enabled ? 1 : 0;
      else p.abilityAuto = enabled ? 1 : 0;
      ++changed;
    }
  if (changed) ++this.changes;
  return changed;
}
/** How far the skill in `slot` reaches, in tiles (casting range, or the radius of one acting on the spot); 0 without one. */
export function skillReach(this: Town, p: Person, slot: number): number {
  const spec = skillOfCalling(p.calling, slot);
  return spec ? spec.range || spec.radius : 0;
}
/** The first skill of a resident's calling, or null for callings without one. */
export function abilityOf(this: Town, p: Person): AbilityState | null {
  const spec = skillOfCalling(p.calling, 0);
  return spec ? skillState(this, p, spec) : null;
}
/** Fires the first skill of every chosen resident who has it ready; returns how many did. */
export function useAbility(this: Town, ids: number[], target?: Point): number {
  return useSkill.call(this, ids, 0, target);
}
/** Turns auto-use of the first skill on or off for the chosen residents; returns how many changed. */
export function setAbilityAuto(this: Town, ids: number[], enabled: boolean): number {
  return setSkillAuto.call(this, ids, 0, enabled);
}
/** How far the first skill reaches, in tiles; 0 without one. */
export function abilityReach(this: Town, p: Person): number {
  return skillReach.call(this, p, 0);
}
/** True while a Rallying Verse lifts this resident. */
export function rallied(this: Town, p: Person): boolean {
  return (this.combatState.rallied.get(p.id) ?? -1) > this.time;
}
/** True while hallowed ground of a Sanctuary holds this resident. */
export function hallowed(this: Town, p: Person): boolean {
  return this.combatState.sanctuaries.some((g) => g.until > this.time && distance(g.at, p.position) <= g.radius);
}
/** Lands pending skills, keeps lasting ones going and fires skills left on auto when they would help. */
export function advanceAbilities(this: Town, dt = 0): void {
  const state = this.combatState;
  for (const pending of state.bursts.filter((b) => this.time >= b.lands)) {
    const by = this.person(pending.by),
      caster = by && standing(by) ? by : null,
      // A whirl turns with the warrior; the rest land where they were aimed.
      at = pending.skill === 'whirl' ? (caster?.position ?? pending.at) : pending.at;
    if (pending.skill === 'whirl' && !caster) continue;
    for (const m of enemiesNear(this, at, pending.radius)) {
      if (pending.skill === 'frost') {
        state.chilled.set(m.id, this.time + skillSpec('frost').duration);
        if (caster) rouse(m, caster);
        else if (!m.raider) m.angry = true;
      } else skillBlow(this, at, m, pending.damage, caster, pending.skill !== 'whirl');
    }
  }
  state.bursts = state.bursts.filter((b) => this.time < b.lands);
  for (const [id, until] of state.taunts) if (until.until <= this.time) state.taunts.delete(id);
  for (const map of [state.rallied, state.chilled, state.dirged])
    for (const [id, until] of map) if (until <= this.time) map.delete(id);
  state.sanctuaries = state.sanctuaries.filter((g) => g.until > this.time);
  for (const ground of state.sanctuaries)
    for (const p of this.folk) {
      if (p.inside || p.health <= -0.5 || distance(p.position, ground.at) > ground.radius) continue;
      if (p.faction !== this.person(ground.by)?.faction) continue;
      // The downed on hallowed ground stop bleeding out.
      if (p.downedAt >= 0) p.downedAt = Math.min(this.time, p.downedAt + dt);
      else if (p.health > 0 && p.health < healthCap(p))
        p.health = Math.min(healthCap(p), f(p.health + skillPower.sanctuaryMend * dt));
    }
  for (const p of this.folk) {
    if (p.cast && this.time >= p.castUntil) p.cast = '';
    if (p.faction !== playerFaction || p.role !== Role.Resident || !standing(p) || p.inside) continue;
    if (p.stressRecovery || p.crossingDoorway() || p.activity === Activity.Expedition) continue;
    if (this.time < (state.skillCheckAt.get(p.id) ?? -1)) continue;
    let waiting = false;
    for (const slot of slots) {
      const spec = skillOfCalling(p.calling, slot);
      if (!spec || locked(p, spec) || !autoOn(p, spec) || this.time < readyAt(p, slot)) continue;
      waiting = true;
      if (worthUsing(this, p, spec)) use(this, p, slot);
    }
    if (waiting) state.skillCheckAt.set(p.id, this.time + autoLook);
  }
}
