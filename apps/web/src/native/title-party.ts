// The title player's fighting: beating off raids at home, sending a party through a gate when the game's own
// forecast calls it ready, and leading it beyond: focus the dens, pull the hurt back, kneel by the downed, step
// out of a marked slam, carry the spoils home, or withdraw when the fight turns.
import type { Town } from '../../../../packages/engine/src/town';
import { Activity, type Person } from '../../../../packages/engine/src/person';
import { CombatCue, MonsterRank } from '../../../../packages/engine/src/combat-events';
import { ChamberKind } from '../../../../packages/engine/src/realm-layout';
import { add, distance, normalized, point, scale, sub, type Point } from '../../../../packages/engine/src/geometry';
import { equippedItem } from '../../../../packages/engine/src/equipment';
import { TownState } from '../../../../packages/engine/src/town-state';
import { sealable } from '../../../../packages/engine/src/gate-seals';
import { lairOf } from '../../../../packages/engine/src/town-monsters';
import { floorLevel, partyVerdict, Verdict } from './swarm-hud';
import { isFighter } from './title-gear';
import { beyond, living, order, take, type TitleContext } from './title-roster';

/** Largest party the title player sends; the rest keep the settlement. */
const mostMembers = 6;
/** Seconds between fresh orders to a fighting group, so blows land between them. */
const regroupSeconds = 2;

export interface PartyState {
  /** Residents sent through the gate on this expedition. */
  members: number[];
  gate: number;
  floor: number;
  lastEvent: bigint;
  dodgeUntil: number;
  orderedAt: number;
  withdrawing: boolean;
  /** Expeditions sent, cleared and withdrawn, for the log and the tests. */
  sent: number;
  cleared: number;
  withdrew: number;
  castOut: number;
  homeOrderedAt: number;
  /** Why no party went out at the last look, for the log. */
  note: string;
}
export const partyState = (): PartyState => ({
  members: [],
  gate: -1,
  floor: 0,
  lastEvent: -1n,
  dodgeUntil: -1,
  orderedAt: -1e9,
  withdrawing: false,
  sent: 0,
  cleared: 0,
  withdrew: 0,
  castOut: 0,
  homeOrderedAt: -1e9,
  note: '',
});
const centre = (items: readonly { position: Point }[]): Point =>
  items.reduce((c, p) => point(c.x + p.position.x / items.length, c.y + p.position.y / items.length), point());
const armed = (p: Person): boolean => isFighter(p) || !!equippedItem(p, 'weapon');

/** Raiders near home are met by everyone who can fight; the downed are tended once no raider stands over them. */
export function defend(ctx: TitleContext, state: PartyState): boolean {
  const { town } = ctx,
    seat = town.camp();
  if (!seat) return false;
  const raiders = town
    .monsters()
    .filter((m) => m.health > 0 && (m.raider || m.angry) && !town.inRealm(m.position) && distance(m.position, seat.center) < TownState.campReach * 1.8);
  const folk = living(town).filter((p) => !beyond(town, p));
  tendDowned(ctx, folk, town.people().filter((p) => p.faction === 0 && p.downedAt >= 0 && !town.inRealm(p.position)), raiders.map((m) => m.position));
  if (!raiders.length) return false;
  const close = raiders.some((m) => distance(m.position, seat.center) < 5);
  // Fighters meet a raid; armed settlers only when it reaches the fire, since fighting strains them.
  const defenders = folk.filter(
    (p) => (isFighter(p) || (close && armed(p) && p.stress < 0.6)) && p.health > 0.4 && p.task !== Activity.Praying && p.task !== Activity.Tending && !ctx.party.has(p.id),
  );
  for (const p of defenders) take(ctx, p);
  if (!defenders.length || town.clock() - state.homeOrderedAt < regroupSeconds) return true;
  state.homeOrderedAt = town.clock();
  const front = raiders.sort((a, b) => distance(a.position, seat.center) - distance(b.position, seat.center))[0];
  const hurt = defenders.filter((p) => p.health < 0.55),
    fit = defenders.filter((p) => p.health >= 0.55);
  if (fit.length) order(ctx, `defend:${front.id}:${town.clock() | 0}`, fit, () => (town.orderAttackMove(fit.map((p) => p.id), front.position), true));
  // The badly hurt step back to the fire instead of dying at the front.
  if (hurt.length) order(ctx, `fall-back:${town.clock() | 0}`, hurt, () => (town.orderMove(hurt.map((p) => p.id), seat.door()), true));
  return true;
}
/** The nearest free helper kneels by each downed resident no monster stands over. */
function tendDowned(ctx: TitleContext, helpers: readonly Person[], downed: readonly Person[], threats: readonly Point[]): void {
  const { town } = ctx,
    busy = new Set(helpers.filter((p) => p.task === Activity.Tending).map((p) => p.id));
  for (const d of downed) {
    if (d.health <= -0.5 || helpers.some((p) => p.task === Activity.Tending && p.taskSite === d.id)) continue;
    if (threats.some((t) => distance(t, d.position) < 3)) continue;
    const helper = helpers
      .filter((p) => !busy.has(p.id) && p.health > 0.3 && p.downedAt < 0)
      .sort((a, b) => distance(a.position, d.position) - distance(b.position, d.position))[0];
    if (helper && order(ctx, `tend:${helper.id}:${d.id}`, [helper], () => town.orderTend([helper.id], d.id))) busy.add(helper.id);
  }
}
/** Fighters fit to go: healthy, fed, rested and unwounded, best first. */
function fitFighters(town: Town): Person[] {
  return living(town)
    .filter((p) => isFighter(p) && !beyond(town, p) && p.health >= 0.85 && p.woundDays <= 0 && p.food > 0.45 && p.rest > 0.45)
    .filter((p) => p.task !== Activity.Praying && p.task !== Activity.Crafting)
    .sort((a, b) => b.level - a.level || a.id - b.id);
}
export interface PartyChoice {
  members: Person[];
  gate: number;
  floor: number;
}
/** The party and floor the expedition window would call ready, or null. Nearest gate, deepest ready floor. */
export function readyParty(town: Town): PartyChoice | null {
  const fighters = fitFighters(town),
    seat = town.camp();
  if (fighters.length < 3 || !seat || town.raiding()) return null;
  const gates = town
    .map()
    .dungeons()
    .map((site, index) => ({ site, index }))
    .filter((g) => g.site.discovered && sealable(g.site))
    .sort((a, b) => distance(lairOf(a.site), seat.center) - distance(lairOf(b.site), seat.center));
  for (const { index } of gates) {
    const deepest = town.deepestOpenFloor(index);
    for (let floor = deepest; floor >= 0; --floor) {
      if (town.expeditionProblem(index, floor)) continue;
      for (let count = Math.min(mostMembers, fighters.length); count >= 3; --count) {
        const members = fighters.slice(0, count),
          average = Math.round(members.reduce((s, p) => s + p.level, 0) / count);
        if (partyVerdict(count, average, floorLevel(floor)) === Verdict.Ready) return { members, gate: index, floor };
      }
    }
  }
  return null;
}
/** Sends the ready party, by day and with no raid at home. */
export function sendParty(ctx: TitleContext, state: PartyState): boolean {
  const { town } = ctx;
  if (town.realmActive() || state.members.some((id) => town.people().some((p) => p.id === id && beyond(town, p)))) return false;
  if (town.climate().night > 0.3) {
    state.note = 'night';
    return false;
  }
  const choice = readyParty(town);
  if (!choice) {
    const fit = fitFighters(town);
    state.note = `not ready: ${fit.length} fit fighters at ${fit.map((p) => p.level).join('/')}`;
    return false;
  }
  state.note = '';
  const ids = choice.members.map((p) => p.id);
  if (!town.canSendExpedition(ids, choice.gate, choice.floor).ok) return false;
  if (!order(ctx, `expedition:${choice.gate}:${choice.floor}:${ids.join(',')}`, choice.members, () => town.sendExpedition(ids, choice.gate, choice.floor)))
    return false;
  Object.assign(state, { members: ids, gate: choice.gate, floor: choice.floor, withdrawing: false, orderedAt: -1e9 });
  ++state.sent;
  return true;
}
/** Leads the party beyond the gate; true while there is one. */
export function commandRealm(ctx: TitleContext, state: PartyState): boolean {
  const { town } = ctx;
  for (const id of state.members) ctx.party.add(id);
  const walking = state.members.map((id) => town.person(id)).filter((p): p is Person => !!p && p.activity === Activity.Expedition);
  for (const p of walking) take(ctx, p);
  const plan = town.realmPlan();
  if (!plan) {
    if (!walking.length) {
      // The gate cast the fallen party out: the expedition is over all the same.
      if (state.members.length && state.sent > state.cleared + state.withdrew + state.castOut) ++state.castOut;
      state.members = [];
    }
    return walking.length > 0;
  }
  const party = town.realmParty(),
    standing = town.realmStanding();
  for (const p of party) {
    ctx.party.add(p.id);
    take(ctx, p);
  }
  if (!standing.length) return true;
  const now = town.clock(),
    foes = town.realmFoes(),
    dens = town.realmDens();
  if (town.realmCleared || state.withdrawing) {
    const home = town.canLeaveRealm();
    if (home.ok && !town.realmLeftBehind().length) {
      if (town.realmCleared) ++state.cleared;
      else ++state.withdrew;
      order(ctx, `leave:${now | 0}`, [], () => town.leaveRealm());
      state.members = [];
      return false;
    }
  }
  dodge(ctx, state, standing);
  if (now < state.dodgeUntil) return true;
  const fighting = foes.filter((m) => m.rank !== MonsterRank.Den);
  tendDowned(ctx, standing, party.filter((p) => p.downedAt >= 0), fighting.map((m) => m.position));
  handSkills(ctx, standing, fighting);
  if (now - state.orderedAt < regroupSeconds) return true;
  state.orderedAt = now;
  const rest = standing.filter((p) => p.task !== Activity.Tending),
    ids = rest.map((p) => p.id);
  if (!ids.length) return true;
  const healthy = standing.filter((p) => p.health > 0.35).length;
  // The fight turns when half the party is down or hurt badly and dens still breed.
  if (!town.realmCleared && dens.length && (healthy * 2 < party.length || standing.length < 2) && !state.withdrawing)
    state.withdrawing = true;
  if (town.realmCleared) return true;
  if (state.withdrawing) {
    order(ctx, `withdraw:${now | 0}`, [], () => (town.orderMove(ids, plan.entry), true));
    return true;
  }
  const middle = centre(standing),
    straggler = standing.find((p) => p.activity === Activity.Fighting && distance(p.position, middle) > 4),
    fallen = party.find((p) => p.downedAt >= 0),
    den = dens.sort((a, b) => distance(a.position, middle) - distance(b.position, middle))[0],
    heart = plan.chambers.find((c) => c.kind === ChamberKind.Heart)?.center ?? plan.entry;
  if (den && distance(den.position, middle) < 5 && fighting.filter((m) => distance(m.position, middle) < 3).length < 3) {
    order(ctx, `den:${den.id}:${now | 0}`, [], () => town.orderAttack(ids, den.id));
    return true;
  }
  const goal = fallen?.position ?? straggler?.position ?? den?.position ?? heart;
  order(ctx, `push:${now | 0}`, [], () => (town.orderAttackMove(ids, goal), true));
  return true;
}
/** Everyone inside a freshly marked slam steps out of it, away from its centre. */
function dodge(ctx: TitleContext, state: PartyState, standing: readonly Person[]): void {
  const { town } = ctx;
  for (const e of town.combatEvents()) {
    if (e.serial <= state.lastEvent) continue;
    state.lastEvent = e.serial;
    if (e.cue !== CombatCue.Telegraph) continue;
    for (const p of standing) {
      if (distance(p.position, e.position) >= e.radius + 0.8) continue;
      const away = sub(p.position, e.position),
        out = add(e.position, scale(distance(p.position, e.position) > 0.05 ? normalized(away) : point(1, 0), e.radius + 1.5)),
        spot = town.grid.nearestWalkable(out);
      order(ctx, `dodge:${p.id}:${e.serial}`, [], () => (town.orderMove([p.id], spot), true));
    }
    state.dodgeUntil = Math.max(state.dodgeUntil, town.clock() + e.duration + 0.3);
  }
}
/** Skills left off auto are fired by hand when ready and a pack is in reach. */
function handSkills(ctx: TitleContext, standing: readonly Person[], foes: readonly { position: Point }[]): void {
  const { town } = ctx;
  for (const p of standing)
    for (const skill of town.skillsOf(p)) {
      if (skill.auto || skill.locked || !skill.ready) continue;
      const reach = town.skillReach(p, skill.slot),
        near = foes.filter((m) => distance(m.position, p.position) <= Math.max(2, reach));
      if (near.length < 2) continue;
      const aim = skill.targeted ? centre(near) : undefined;
      order(ctx, `skill:${p.id}:${skill.slot}:${town.clock() | 0}`, [], () => town.useSkill([p.id], skill.slot, aim) > 0);
    }
}
