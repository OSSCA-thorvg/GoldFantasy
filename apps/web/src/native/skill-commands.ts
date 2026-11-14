// Both skills of every calling under the player's keys, buttons and cursor: who has them, why nothing fired,
// and the ground-aimed ones that wait for a point under the cursor.
import { Calling, callingName, type Person } from '../../../../packages/engine/src/person';
import type { AbilityState } from '../../../../packages/engine/src/combat-events';
import { SkillAim, secondSkillLevel, skillOfCalling, skillSpec, type SkillSpec } from '../../../../packages/engine/src/skill-catalog';
import { distance, type Point } from '../../../../packages/engine/src/geometry';
import type { Town } from '../../../../packages/engine/src/town';
import { Cue, Sound } from '../../../../packages/native-audio/src';
import { controllableIds } from './game-control';
import type { GameAppState } from './game-app-state';
import type { SkillAim as SkillAimState } from './army-state';
import { Order, Tool } from '../../../../packages/engine/src/game-tools';

/** One skill slot of one calling across the selection. */
export interface SkillSlotGroup {
  spec: SkillSpec;
  /** State of the first resident who has it unlocked, or of the first one at all. */
  ability: AbilityState;
  /** Residents who have it (level high enough). */
  holders: Person[];
  /** Residents of the calling still below the level that grants it. */
  locked: Person[];
  ready: number;
  /** Seconds until the first holder is ready again. */
  soonest: number;
  /** Every holder uses it on their own. */
  auto: boolean;
  active: boolean;
}
export interface CallingSkills {
  calling: Calling;
  members: Person[];
  /** Index is the slot; a calling without skills is never listed. */
  slots: SkillSlotGroup[];
}
export const skillKeys = ['Q', 'W'] as const;

/** The callings of the selection that have skills, in the order their first member was chosen. */
export function callingSkills(town: Town, ids: readonly number[]): CallingSkills[] {
  const out = new Map<Calling, CallingSkills>();
  for (const id of controllableIds(town, ids)) {
    const p = town.person(id);
    if (!p) continue;
    const states = town.skillsOf(p);
    if (!states.length) continue;
    let entry = out.get(p.calling);
    if (!entry) {
      entry = { calling: p.calling, members: [], slots: [] };
      out.set(p.calling, entry);
    }
    entry.members.push(p);
    for (const state of states) {
      const spec = skillSpec(state.id);
      let group = entry.slots[state.slot];
      if (!group) {
        group = { spec, ability: state, holders: [], locked: [], ready: 0, soonest: Infinity, auto: true, active: false };
        entry.slots[state.slot] = group;
      }
      if (state.locked) {
        group.locked.push(p);
        continue;
      }
      if (!group.holders.length) group.ability = state;
      group.holders.push(p);
      group.ready += Number(state.ready);
      group.soonest = Math.min(group.soonest, state.remaining);
      group.auto &&= state.auto;
      group.active ||= state.active;
    }
  }
  for (const entry of out.values())
    for (const group of entry.slots) if (group && !group.holders.length) group.soonest = 0;
  return [...out.values()];
}
/** The calling the card shows in full; the first when nothing is chosen or the choice left the selection. */
export function focusedCalling(app: GameAppState, groups: readonly CallingSkills[]): CallingSkills | null {
  return groups.find((g) => g.calling === app.army.focus) ?? groups[0] ?? null;
}
/** Tab: the next calling of a mixed selection. False when there is nothing to cycle. */
export function cycleFocus(app: GameAppState): boolean {
  const groups = callingSkills(app.town, app.chosen);
  if (groups.length < 2) return false;
  const now = groups.indexOf(focusedCalling(app, groups)!);
  app.army.focus = groups[(now + 1) % groups.length].calling;
  return true;
}
function skillOf(town: Town, p: Person, slot: number): AbilityState | null {
  return town.skillsOf(p)[slot] ?? null;
}
const readyIn = (town: Town, ids: readonly number[], slot: number): Person[] =>
  controllableIds(town, ids)
    .map((id) => town.person(id))
    .filter((p): p is Person => !!p && !!skillOf(town, p, slot)?.ready);
/** The ground point under the cursor, or none over the HUD or off the map. */
export function cursorGround(app: GameAppState): Point | undefined {
  const overWorld =
    app.mouse.x >= 0 &&
    app.mouse.y >= 0 &&
    app.mouse.x < app.viewWidth &&
    app.mouse.y < app.viewHeight &&
    !app.context.controlAt(app.mouse.x, app.mouse.y) &&
    app.town.map().inside(app.cursor);
  return overWorld ? { ...app.cursor } : undefined;
}
/** Why a skill fired for no one although someone had it ready. */
function noTarget(spec: SkillSpec, caster: Person, target?: Point): string {
  if (spec.aim === SkillAim.Ground && target && distance(target, caster.position) > spec.range)
    return `Too far: out of reach of ${spec.name}`;
  switch (spec.aim) {
    case SkillAim.Self:
      return spec.id === 'sanctuary' || spec.id === 'rally'
        ? `${spec.name}: no one in reach`
        : `${spec.name}: no monster in reach`;
    case SkillAim.Enemy:
      return `${spec.name}: no enemy in reach`;
    case SkillAim.Ally:
      return `${spec.name}: no one in reach needs healing`;
    case SkillAim.Ground:
      return `${spec.name}: no monsters in reach`;
  }
}
/** Why no one in `ids` could fire the skill in `slot` at all: none has one, it is locked, or it is recovering. */
function notReady(town: Town, ids: readonly number[], slot: number): string {
  const groups = callingSkills(town, ids)
    .map((entry) => entry.slots[slot])
    .filter((g): g is SkillSlotGroup => !!g);
  if (!groups.length) return slot ? 'No one selected has a second skill' : 'No one selected has a skill';
  const unlocked = groups.filter((g) => g.holders.length);
  if (!unlocked.length)
    return groups.length === 1
      ? `${groups[0].spec.name} comes at level ${groups[0].spec.level}`
      : `Second skills come at level ${secondSkillLevel}`;
  const first = [...unlocked].sort((a, b) => a.soonest - b.soonest)[0];
  return unlocked.length === 1
    ? `${first.spec.name} is ready in ${Math.ceil(first.soonest)} s`
    : `Skills are recovering (the first is ready in ${Math.ceil(first.soonest)} s)`;
}
/** Fires the skill in `slot` for every one of `ids` who has it ready. False when no one there has that slot. */
export function fireSkill(app: GameAppState, ids: readonly number[], slot: number, target?: Point): boolean {
  const town = app.town;
  if (!controllableIds(town, ids).some((id) => skillOf(town, town.person(id)!, slot))) {
    app.status = notReady(town, ids, slot);
    return false;
  }
  const ready = readyIn(town, ids, slot);
  if (!ready.length) {
    app.status = notReady(town, ids, slot);
    return true;
  }
  const fired = town.useSkill(
    ready.map((p) => p.id),
    slot,
    target,
  );
  if (fired > 0) {
    app.status = '';
    if (app.cues.length < 32) app.cues.push(new Sound(Cue.Order));
    return true;
  }
  const caster = ready[0];
  app.status = noTarget(skillOfCalling(caster.calling, slot)!, caster, target);
  return true;
}
/** Ground-aimed skills ready among `ids` in `slot`, one entry per skill. */
export function groundSkillsReady(town: Town, ids: readonly number[], slot: number): SkillSpec[] {
  const found = new Map<string, SkillSpec>();
  for (const p of readyIn(town, ids, slot)) {
    const spec = skillOfCalling(p.calling, slot);
    if (spec?.aim === SkillAim.Ground) found.set(spec.id, spec);
  }
  return [...found.values()];
}
/** A key press or a skill button: ground-aimed skills wait for a point, the rest fire at once. */
export function beginSkill(app: GameAppState, ids: readonly number[], slot: number, via: 'key' | 'pointer'): boolean {
  const own = controllableIds(app.town, ids);
  const held = currentAim(app);
  if (via === 'key' && held?.via === 'key' && held.slot === slot) return true;
  if (groundSkillsReady(app.town, own, slot).length) {
    app.army.aim = { slot, ids: own, via };
    app.status = '';
    return true;
  }
  app.army.aim = null;
  return fireSkill(app, own, slot, cursorGround(app));
}
/** The held key is released, or the ground is clicked: every caster fires at the point under the cursor. */
export function releaseSkill(app: GameAppState, target = cursorGround(app)): void {
  const aim = currentAim(app);
  if (!aim) return;
  app.army.aim = null;
  fireSkill(app, aim.ids, aim.slot, target);
}
export function cancelSkill(app: GameAppState): boolean {
  if (!currentAim(app)) return false;
  app.army.aim = null;
  return true;
}
/** The skill still waiting for its point; a tool in hand, an armed order or a new selection puts it down. */
export function currentAim(app: GameAppState): SkillAimState | null {
  const aim = app.army.aim;
  if (!aim) return null;
  if (app.tool !== Tool.Select || app.pending !== Order.None || !aim.ids.some((id) => app.chosen.includes(id))) {
    app.army.aim = null;
    return null;
  }
  return aim;
}
/** What the ground mark under the cursor shows while a skill is aimed: each ready skill's true radius, and
 * whether a caster is close enough to land it there. */
export function aimPreview(app: GameAppState): { at: Point; rings: { radius: number; inReach: boolean }[] } | null {
  const aim = currentAim(app),
    at = aim ? cursorGround(app) : undefined;
  if (!aim || !at) return null;
  const casters = readyIn(app.town, aim.ids, aim.slot),
    rings = groundSkillsReady(app.town, aim.ids, aim.slot).map((spec) => ({
      radius: spec.radius,
      inReach: casters.some(
        (p) => skillOfCalling(p.calling, aim.slot)?.id === spec.id && distance(p.position, at) <= spec.range,
      ),
    }));
  return rings.length ? { at, rings } : null;
}
/** The line under the order buttons while a skill waits for its point. */
export function aimPrompt(app: GameAppState): string {
  const aim = currentAim(app);
  if (!aim) return '';
  const names = groundSkillsReady(app.town, aim.ids, aim.slot).map((spec) => spec.name),
    what = names.join(' and ') || 'the skill';
  if (aim.via === 'key') return `${what}: release ${skillKeys[aim.slot] ?? ''} over the ground to cast`;
  return app.touchMode ? `Tap the ground for ${what}` : `${what}: click the ground; right-click cancels`;
}
/** "Warrior x2" for the calling tabs of a mixed selection. */
export function callingLabel(entry: CallingSkills): string {
  return entry.members.length > 1 ? `${callingName(entry.calling)} ×${entry.members.length}` : callingName(entry.calling);
}
