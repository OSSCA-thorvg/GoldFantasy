import type { TownState } from './town-state';
import { Activity, Monster, Person, type Expedition } from './person';
import { Resources, Structure, describe } from './building-catalog';
import { Check, type Building } from './town-models';
import { add, distance, point, rotated, scale, sub, type Point } from './geometry';
import { f32 as f, hash01, lround } from './numeric';
import { DungeonKind, type Dungeon } from './world-types';
import { worldName } from './world-map';
import { breedOf, lairOf, monsterBite, monsterEntrance } from './town-monsters';
import { CombatCue, MonsterRank } from './combat-events';
import { choosePrey, rankMonster, rankPace, rankRules, rankWorth, slowedBy, tauntedBy } from './monster-ranks';
import { huntStep, walkPath } from './monster-navigation';
import { gateSealed, sealFloors, sealProgress, sealable } from './gate-seals';
import { altarCap, altarCapLine } from './altar-cap';
import {
  ChamberKind,
  findRealmArea,
  inArea,
  planRealm,
  sinkRealm,
  stampRealm,
  worldHoard,
  type RealmPlan,
} from './realm-layout';

export interface RealmTown extends TownState {
  camp(id?: number): Building | null;
  settlementOf(p: Person | Building): number;
  credit(gain: Resources, village: number): void;
  rewardExperience(p: Person, points: number): void;
  changeRenown(village: number, amount: number): void;
  reveal(x: number, y: number, radius: number): void;
  orderMove(ids: number[], to: Point): void;
  hurtGuest(p: Person, killed: boolean): void;
  stock(village?: number): Resources;
  killResident(p: Person, cause: string, notice?: string): void;
  strikeDown(p: Person, cause: string, notice?: string): void;
}
/** Shown once by the HUD when a floor falls. */
export interface RealmReward {
  title: string;
  lines: string[];
  sealed: boolean;
}
export const realmRules = {
  /** Monsters beyond a gate are a tier above the ones that raid Midgard. */
  health: 1.6,
  strength: 1.8,
  /** Each floor down, monsters gain this share of their health and strength. */
  healthPerFloor: 0.3,
  strengthPerFloor: 0.2,
  guardianHealth: 14,
  guardianStrength: 0.85,
  /** Below half health the guardian strikes harder and calls a wave of its brood once. */
  enrage: 1.5,
  guardianWave: 8,
  guardianWavePerFloor: 4,
  /** Monsters on a floor at the start: a base, more on each deeper floor and for every tile the gate lies from
   * the seat, never more than `mostMonsters`. */
  floorMonsters: 48,
  floorMonstersPerFloor: 12,
  floorMonstersPerTile: 0.12,
  mostMonsters: 90,
  /** Share of a floor's monsters each den keeps around it, against 2 in the heart and 1 in a plain chamber. */
  denPack: 2,
  /** Dens on the first floor, one more each floor down, never more than `mostDens`. */
  dens: 2,
  mostDens: 4,
  /** A den's brood alive at once: the rank rule's, and this many more each floor down. */
  broodPerFloor: 1,
  /** Share of a hoard a grunt's kill earns; other ranks by their worth. */
  killSpoils: 0.12,
  /** Melee bites land within this many tiles; a pack closes to this ring around its prey. */
  biteReach: 0.8,
  ring: 0.55,
  /** Den mates within this many tiles of a roused monster join the fight. */
  packReach: 12,
  /** Seconds a patrol stays in one chamber before walking to the next. */
  patrolPause: 22,
  notice: 6.5,
  leash: 15,
  gather: 3.5,
  sealGold: 150,
  sealLevels: 2,
  /** Mana a settlement portal burns to pull a scattered or fighting party home. */
  portalRecallMana: 8,
  /** When the last standing member falls, the gate casts the party out: survivors rise this hurt and wounded this long. */
  wipeHealth: 0.1,
  wipeWoundDays: 4,
  /** Going home carries a downed member only if the floor is cleared or someone stands this close. */
  carryReach: 2,
};
export function realmActive(this: TownState): boolean {
  return this.realmGate >= 0;
}
export function inRealm(this: TownState, p: Point): boolean {
  return this.realmGate >= 0 && inArea(this.realmArea, p);
}
export function realmPlan(this: TownState): RealmPlan | null {
  if (this.realmGate < 0 || !this.realmArea) return null;
  const key = `${this.realmGate}:${this.realmFloor}:${this.realmArea.x}:${this.realmArea.y}:${this.realmArea.size}`;
  if (this.realmPlanKey !== key) {
    this.realmPlanKey = key;
    this.realmPlanCache = planRealm(this.world.seed(), this.realmGate, this.realmFloor, this.realmArea);
  }
  return this.realmPlanCache;
}
/** Everyone of the party beyond the gate who still lives, standing or downed. */
export function realmParty(this: TownState): Person[] {
  return this.folk.filter(
    (p) =>
      (p.health > 0 || (p.downedAt >= 0 && p.health > -0.5)) &&
      p.faction === this.controlFaction &&
      inRealm.call(this, p.position),
  );
}
/** Party members on their feet beyond the gate. */
export function realmStanding(this: TownState): Person[] {
  return realmParty.call(this).filter((p) => p.downedAt < 0);
}
/** Downed members a "Go home" right now would leave behind to die. */
export function realmLeftBehind(this: TownState): Person[] {
  if (this.realmCleared) return [];
  const standing = realmStanding.call(this);
  return realmParty
    .call(this)
    .filter(
      (p) => p.downedAt >= 0 && !standing.some((other) => distance(other.position, p.position) <= realmRules.carryReach),
    );
}
export function realmFoes(this: TownState): Monster[] {
  return this.beasts.filter((m) => m.health > 0 && inRealm.call(this, m.home));
}
/** Living dens anywhere. */
export function dens(this: TownState): Monster[] {
  return this.beasts.filter((m) => m.health > 0 && m.rank === MonsterRank.Den);
}
/** Living dens on the floor beyond the gate; the floor is cleared once none is left and its guardian is dead. */
export function realmDens(this: TownState): Monster[] {
  return this.beasts.filter((m) => m.health > 0 && m.rank === MonsterRank.Den && inRealm.call(this, m.home));
}
/** Floors open in order; a cleared floor stays open to be fought again. */
export function floorOpen(this: TownState, dungeon: number, floor: number): boolean {
  return Number.isInteger(floor) && floor >= 0 && floor < sealFloors && floor <= (this.depth[dungeon] ?? 0);
}
export function deepestOpenFloor(this: TownState, dungeon: number): number {
  return Math.min(sealFloors - 1, this.depth[dungeon] ?? 0);
}
export function expeditionProblem(this: TownState, dungeon: number, floor: number): string {
  const site = this.world.dungeons()[dungeon];
  if (!site || !site.discovered) return 'No known dungeon there';
  if (!sealable(site)) return site.kind === DungeonKind.Return ? '' : 'A neutral giant dwelling';
  // Reinforcements may follow a party through the same gate while its guardian lives.
  if (this.realmGate === dungeon) return this.realmCleared ? 'This floor is already cleared' : '';
  if (!floorOpen.call(this, dungeon, floor)) return 'Clear the floor above first';
  if (this.realmGate >= 0) return 'A party is already beyond another gate';
  if (this.parties.some((party) => party.members.length && party.dungeon !== dungeon))
    return 'Another party is on its way to a gate';
  if (!findRealmArea(this.world)) return 'This map has no open sea for the world beyond';
  return '';
}
function threat(town: RealmTown, dungeon: number, floor: number) {
  const site = town.world.dungeons()[dungeon],
    fire = town.camp(),
    far = fire ? distance(lairOf(site), fire.center) : 0;
  return {
    health: f(breedOf(site.kind).health * realmRules.health * (1 + realmRules.healthPerFloor * floor + far / 120)),
    strength: f(realmRules.strength * (1 + realmRules.strengthPerFloor * floor + far / 240)),
  };
}
export function guardianVigor(this: RealmTown): number {
  return this.realmGate < 0
    ? 0
    : f(threat(this, this.realmGate, this.realmFloor).health * realmRules.guardianHealth);
}
/** Ranks of a pack of `size`: a grunt leads, a brute and deeper down a stalker stiffen a large one, spitters hang
 * back, and the rest is swarm. */
function packRanks(size: number, floor: number): MonsterRank[] {
  const ranks = [MonsterRank.Grunt];
  if (size >= 8) ranks.push(MonsterRank.Brute);
  if (floor > 0 && size >= 8) ranks.push(MonsterRank.Stalker);
  for (let i = 0; i < Math.floor(size / 7) + (size >= 5 ? 1 : 0); ++i) ranks.push(MonsterRank.Spitter);
  while (ranks.length < size) ranks.push(MonsterRank.Swarmer);
  return ranks.slice(0, size);
}
/** How many monsters a floor holds when the party arrives. */
function floorMonsters(floor: number, far: number): number {
  return Math.min(
    realmRules.mostMonsters,
    Math.round(realmRules.floorMonsters + realmRules.floorMonstersPerFloor * floor + realmRules.floorMonstersPerTile * far),
  );
}
function populate(town: RealmTown, plan: RealmPlan): void {
  const { health, strength } = threat(town, town.realmGate, town.realmFloor),
    floor = town.realmFloor,
    site = town.world.dungeons()[town.realmGate],
    fire = town.camp(),
    far = fire ? distance(lairOf(site), fire.center) : 0,
    rnd = (i: number, salt: number) => hash01(town.world.seed(), town.realmGate * 31 + floor, i, 540 + salt),
    spawn = (at: Point, rank: MonsterRank, brood = -1, vigor = health, might = strength): Monster => {
      const beast = new Monster(town.nextMonster++, town.realmGate, town.grid.nearestWalkable(at));
      beast.home = { ...beast.position };
      beast.health = f(vigor);
      beast.strength = f(might);
      beast.brood = brood;
      rankMonster(beast, rank);
      town.beasts.push(beast);
      return beast;
    },
    // Spread a pack over its chamber on a sunflower, so it neither stacks nor hugs the walls.
    scatter = (center: Point, radius: number, i: number, count: number, salt: number): Point =>
      add(center, rotated(point(radius * (0.3 + 0.6 * Math.sqrt((i + 0.5) / Math.max(1, count))), 0), i * 2.39996 + rnd(salt, 1) * 6)),
    rooms = plan.chambers.map((chamber, index) => ({ chamber, index })).filter((r) => r.chamber.kind !== ChamberKind.Entry),
    heart = rooms.find((r) => r.chamber.kind === ChamberKind.Heart)!,
    entry = plan.chambers[0].center,
    // Dens sit in the far chambers first; a small floor doubles them up, or lets one share the heart.
    denRooms = rooms
      .filter((r) => r.chamber.kind === ChamberKind.Den)
      .sort((a, b) => distance(b.chamber.center, entry) - distance(a.chamber.center, entry) || a.index - b.index),
    // Two dens at least; more only where a chamber of their own is free, so the heart keeps only its guardian.
    denCount = Math.max(realmRules.dens, Math.min(realmRules.mostDens, realmRules.dens + floor, denRooms.length)),
    sites: { room: (typeof rooms)[number]; den: Monster | null; weight: number }[] = [];
  for (let i = 0; i < denCount; ++i) {
    const room = denRooms.length ? denRooms[i % denRooms.length] : heart,
      shared = sites.filter((other) => other.room === room).length,
      at = shared || room === heart ? scatter(room.chamber.center, room.chamber.radius, 3 + shared * 5, 9, room.index) : room.chamber.center;
    sites.push({ room, den: spawn(at, MonsterRank.Den), weight: realmRules.denPack });
  }
  for (const room of rooms)
    if (!sites.some((other) => other.room === room)) sites.push({ room, den: null, weight: room === heart ? 2 : 1 });
  town.realmGuardian = spawn(
    heart.chamber.center,
    MonsterRank.Guardian,
    -1,
    health * realmRules.guardianHealth,
    strength * realmRules.guardianStrength,
  ).id;
  const patrol = rooms.length > 2 ? 4 : 0,
    budget = Math.max(0, floorMonsters(floor, far) - 1 - denCount - patrol),
    weights = sites.reduce((sum, other) => sum + other.weight, 0);
  let left = budget;
  sites.forEach((entry, i) => {
    const size = i === sites.length - 1 ? left : Math.min(left, Math.round((budget * entry.weight) / weights));
    left -= size;
    const center = entry.den?.position ?? entry.room.chamber.center;
    packRanks(size, floor).forEach((rank, k) =>
      spawn(scatter(center, entry.room.chamber.radius, k, size, entry.room.index * 7 + i), rank, entry.den?.id ?? -1),
    );
  });
  // A grunt leads a small patrol through the chambers, so a cleared room does not stay safe behind the party.
  town.realmPatrol = [];
  const beat = denRooms.at(-1) ?? heart;
  for (let i = 0; i < patrol; ++i)
    town.realmPatrol.push(
      spawn(add(beat.chamber.center, point(0.5 * i, 0.3)), i ? MonsterRank.Swarmer : MonsterRank.Grunt).id,
    );
  town.realmPatrolAt = town.time + realmRules.patrolPause;
  town.realmBroodCalled = false;
}
function arrive(town: RealmTown, members: Person[], entry: Point): void {
  members.forEach((p, i) => {
    p.position = town.grid.nearestWalkable(
      add(entry, rotated(point(0.7 + 0.25 * Math.floor(i / 6), 0), (i * 6.2832) / Math.min(6, members.length))),
    );
    p.entrance = { ...p.position };
    p.threshold = { ...p.position };
    p.doorway = 0;
    p.inside = false;
    p.path = [];
    p.activity = p.task = Activity.Idle;
    p.taskSite = p.target = p.foe = -1;
    p.ordered = p.approachingOrder = p.holding = false;
    p.until = town.time;
  });
}
function enterRealm(town: RealmTown, party: Expedition, members: Person[]): void {
  const area = findRealmArea(town.world),
    site = town.world.dungeons()[party.dungeon],
    floor = floorOpen.call(town, party.dungeon, party.floor) ? party.floor : deepestOpenFloor.call(town, party.dungeon),
    release = () => {
      for (const p of members) {
        p.inside = false;
        p.activity = Activity.Idle;
        p.until = town.time;
      }
      party.members = [];
    };
  if (town.realmGate === party.dungeon && !town.realmCleared) {
    arrive(town, members, realmPlan.call(town)!.entry);
    party.members = [];
    ++town.changes;
    town.notify(`${members.length} more step through ${site.name} to join the party`);
    return;
  }
  if (!area || town.realmGate >= 0) return release();
  town.realmArea = area;
  town.realmGate = party.dungeon;
  town.realmFloor = floor;
  town.realmLoot = new Resources();
  town.realmCleared = false;
  town.realmGuardian = -1;
  const plan = realmPlan.call(town)!,
    world = town.world.destination(site);
  stampRealm(town.world, plan, world);
  town.world.dungeons().push({ name: 'The way home', kind: DungeonKind.Return, origin: plan.gate, discovered: true });
  const index = town.world.dungeons().length - 1;
  for (let dy = 0; dy < 2; ++dy)
    for (let dx = 0; dx < 2; ++dx) town.world.at(plan.gate.x + dx, plan.gate.y + dy).dungeon = index;
  const open = new Uint8Array(town.world.dungeons().length);
  open.set(town.open.subarray(0, Math.min(town.open.length, open.length)));
  town.open = open;
  // Paths are resolved against the new land before anyone is placed on it.
  town.grid.rebuild(
    town.world,
    town.network,
    town.placed.filter((item) => item.built()).map((item) => item.footprint()),
  );
  forgetFloor(town);
  populate(town, plan);
  arrive(town, members, plan.entry);
  ++town.chronicle.partiesLed;
  town.chronicle.largestParty = Math.max(town.chronicle.largestParty, members.length);
  party.members = [];
  town.reveal(plan.entry.x, plan.entry.y, 8);
  ++town.changes;
  ++town.realmRevision;
  town.notify(`The party steps through ${site.name} into ${worldName(world)} (floor ${floor + 1} of ${sealFloors})`);
}
function forgetFloor(town: TownState): void {
  const state = town.combatState;
  state.flows.clear();
  state.steering.clear();
  state.struckAt.clear();
  state.spoils = 0;
  state.breakAt = null;
}
function closeRealm(town: RealmTown): void {
  town.beasts = town.beasts.filter((m) => !inRealm.call(town, m.home));
  forgetFloor(town);
  const sites = town.world.dungeons();
  if (sites.at(-1)?.kind === DungeonKind.Return) {
    sites.pop();
    town.open = town.open.slice(0, sites.length);
  }
  if (town.realmArea) sinkRealm(town.world, town.realmArea);
  town.realmGate = town.realmGuardian = -1;
  town.realmArea = null;
  town.realmLoot = new Resources();
  town.realmCleared = false;
  ++town.changes;
  ++town.realmRevision;
}
export function canLeaveRealm(this: RealmTown): Check {
  const check = new Check(),
    plan = realmPlan.call(this),
    party = realmParty.call(this),
    standing = realmStanding.call(this);
  if (!plan || !standing.length) {
    check.reason = 'No party is beyond a gate';
    return check;
  }
  if (standing.some((p) => p.activity === Activity.Fighting)) check.reason = 'The party is fighting';
  else if (!this.realmCleared && standing.some((p) => distance(p.position, plan.entry) > realmRules.gather))
    check.reason = 'Gather the whole party at the way home';
  else check.ok = true;
  if (!check.ok) {
    // A settlement portal can tear the party out of a fight or from anywhere on the floor.
    const village = this.settlementOf(party[0]),
      portal = this.placed.some(
        (b) => b.kind === Structure.Portal && b.built() && b.faction === this.controlFaction,
      );
    if (portal && this.stock(village).mana >= realmRules.portalRecallMana) {
      check.ok = true;
      check.reason = '';
      check.cost.mana = realmRules.portalRecallMana;
    } else if (portal) check.reason += ` (portal recall needs ${realmRules.portalRecallMana} mana)`;
  }
  const left = realmLeftBehind.call(this);
  if (left.length) {
    const warning = `${left.map((p) => p.name).join(', ')} would be left behind to die`;
    check.reason = check.reason ? `${check.reason}. ${warning}` : warning;
  }
  return check;
}
/** Puts the party back outside the gate it went through. */
function bringHome(town: RealmTown, party: Person[], site: Dungeon): void {
  town.grid.rebuild(
    town.world,
    town.network,
    town.placed.filter((item) => item.built()).map((item) => item.footprint()),
  );
  party.forEach((p, i) => {
    p.position = town.grid.nearestWalkable(
      add(monsterEntrance(site), rotated(point(0.6 + 0.25 * Math.floor(i / 6), 0), (i * 6.2832) / Math.min(6, party.length))),
    );
    p.entrance = { ...p.position };
    p.threshold = { ...p.position };
    p.doorway = 0;
    p.path = [];
    p.activity = p.downedAt >= 0 ? Activity.Downed : Activity.Idle;
    p.task = Activity.Idle;
    p.taskSite = p.target = p.foe = -1;
    p.ordered = p.approachingOrder = p.hunting = p.holding = false;
    p.until = town.time;
    p.stress = Math.min(1, f(p.stress + f(0.05)));
  });
}
/** Walking back out is the only way the carried spoils reach the settlement. */
export function leaveRealm(this: RealmTown): boolean {
  const leave = canLeaveRealm.call(this);
  if (!leave.ok) return false;
  if (!leave.cost.empty()) {
    this.stock(this.settlementOf(realmStanding.call(this)[0])).subtract(leave.cost);
    this.notify(`The portal pulls the party home for ${describe(leave.cost)}`);
  }
  const site = this.world.dungeons()[this.realmGate],
    left = realmLeftBehind.call(this),
    party = realmParty.call(this).filter((p) => !left.includes(p)),
    loot = this.realmLoot,
    cleared = this.realmCleared;
  for (const p of left)
    this.killResident(p, `Left behind beyond ${site.name}`, `${p.name} was left behind beyond ${site.name}`);
  closeRealm(this);
  bringHome(this, party, site);
  if (!loot.empty()) this.credit(loot, this.settlementOf(party[0]));
  this.notify(
    `The party ${cleared ? 'returns from' : 'withdraws from'} ${site.name}` +
      (loot.empty() ? ' empty-handed' : ' with ' + describe(loot)),
  );
  return true;
}
/** The last one standing fell: the gate casts the party out, gravely wounded, and the spoils are lost. */
function castOut(town: RealmTown, party: Person[]): void {
  const site = town.world.dungeons()[town.realmGate];
  for (const p of party) {
    p.downedAt = -1;
    p.health = realmRules.wipeHealth;
    p.woundDays = Math.max(p.woundDays, realmRules.wipeWoundDays);
    ++p.lookRevision;
    p.stress = Math.min(1, f(p.stress + f(0.2)));
    town.combatState.downedBy.delete(p.id);
  }
  closeRealm(town);
  bringHome(town, party, site);
  town.notify(`${site.name} casts the fallen party back out, gravely wounded; the spoils are lost`);
}
export function recallParty(this: RealmTown): boolean {
  const plan = realmPlan.call(this);
  if (!plan) return false;
  this.orderMove(
    realmParty.call(this).map((p) => p.id),
    plan.entry,
  );
  return true;
}
/** Called for every realm monster that dies, whoever killed it. */
export function realmKill(this: RealmTown, beast: Monster): void {
  if (this.realmGate < 0) return;
  const site = this.world.dungeons()[this.realmGate],
    world = this.world.destination(site),
    floor = this.realmFloor,
    state = this.combatState;
  // Small kills add up to a share of the hoard instead of rounding away one by one.
  state.spoils += realmRules.killSpoils * rankWorth(beast);
  while (state.spoils >= realmRules.killSpoils) {
    this.realmLoot.add(worldHoard(world, floor, realmRules.killSpoils));
    state.spoils -= realmRules.killSpoils;
  }
  if (this.realmCleared || (beast.rank !== MonsterRank.Den && beast.id !== this.realmGuardian)) return;
  const dens = realmDens.call(this).length,
    guardian = this.beasts.some((other) => other.id === this.realmGuardian && other.health > 0);
  if (dens || guardian) {
    this.notify(
      beast.rank === MonsterRank.Den
        ? `A den is destroyed (${dens} left)`
        : `The guardian has fallen; ${dens} ${dens === 1 ? 'den still breeds' : 'dens still breed'}`,
    );
    return;
  }
  state.breakAt = { ...beast.position };
  this.realmCleared = true;
  ++this.chronicle.guardiansSlain;
  while (this.depth.length <= this.realmGate) this.depth.push(0);
  const first = this.depth[this.realmGate] <= floor,
    last = floor === sealFloors - 1,
    party = realmParty.call(this),
    prize = worldHoard(world, floor, first ? 2 : 1),
    lines: string[] = [];
  if (first) this.depth[this.realmGate] = floor + 1;
  for (const p of party) this.rewardExperience(p, 25 * (floor + 1));
  if (first && last) {
    prize.add(worldHoard(world, floor, 6)).add(new Resources(realmRules.sealGold));
    for (const p of party) {
      p.level = Math.min(Person.maximumLevel, p.level + realmRules.sealLevels);
      if (p.downedAt < 0) p.health = 1;
      this.emit(CombatCue.LevelUp, p.position, { person: p.id, amount: p.level });
    }
    if (party.length) this.changeRenown(this.settlementOf(party[0]), 15);
    const { sealed, total } = sealProgress(this);
    lines.push(`${site.name} is sealed for good (${sealed} of ${total} gates).`);
    lines.push(`Every survivor gains ${realmRules.sealLevels} levels.`);
    this.notify(
      sealed === total
        ? `${site.name} is sealed. Every gate is closed: Midgard is safe!`
        : `${site.name} is sealed for good (${sealed} of ${total} gates closed)`,
    );
  } else {
    lines.push(
      first
        ? last
          ? ''
          : `Floor ${floor + 2} of ${site.name} is now open.`
        : 'This floor had already been cleared: a smaller hoard.',
    );
    this.notify(`${site.name}: the guardian of floor ${floor + 1} has fallen`);
  }
  if (first) lines.push(altarCapLine(altarCap(this)));
  this.realmLoot.add(prize);
  lines.push('Hoard: ' + describe(prize) + '.');
  lines.push('Go home from anywhere to bank the spoils.');
  this.realmReward = {
    title: first && last ? `${worldName(world)} is sealed` : `Floor ${floor + 1} cleared`,
    lines: lines.filter(Boolean),
    sealed: first && last,
  };
  ++this.changes;
}
/** The guardian's telegraphed slam lands on everyone still standing in its circle. */
function slam(town: RealmTown, beast: Monster, party: Person[], enraged: boolean): void {
  const breed = breedOf(town.world.dungeons()[beast.lair].kind),
    might = beast.strength;
  beast.windupUntil = -1;
  town.combatState.slamAt.set(beast.id, town.time + rankRules.slamPause);
  const center = town.combatState.slamCenter.get(beast.id) ?? { ...beast.position };
  town.combatState.slamCenter.delete(beast.id);
  if (enraged) beast.strength = f(might * realmRules.enrage);
  for (const p of party)
    if (!p.inside && p.health > 0 && p.downedAt < 0 && distance(p.position, center) <= rankRules.slamRadius)
      monsterBite(town, beast, p, breed, rankRules.slamPower, true);
  beast.strength = might;
  beast.ready = town.time + breed.pause;
  town.emit(CombatCue.Slam, center, { creature: beast.id, radius: rankRules.slamRadius });
}
/** Rouses a monster and its pack: its den and den mates, or those whose home lies close to its own; never the guardian. */
function rousePack(town: RealmTown, beast: Monster): void {
  if (beast.angry) return;
  beast.angry = true;
  for (const mate of town.beasts)
    if (
      !mate.angry &&
      mate.health > 0 &&
      // The guardian wakes only to the party itself, never to a neighbouring pack.
      mate.rank !== MonsterRank.Guardian &&
      inRealm.call(town, mate.home) &&
      ((beast.brood >= 0 && (mate.brood === beast.brood || mate.id === beast.brood)) ||
        (beast.rank === MonsterRank.Den && mate.brood === beast.id) ||
        distance(mate.home, beast.home) <= realmRules.packReach)
    )
      mate.angry = true;
}
/** A roused den puts out a swarmer every few seconds until its brood is full again. */
function advanceDen(town: RealmTown, den: Monster, party: Person[]): void {
  const near = party.some((p) => !p.inside && distance(p.position, den.position) <= realmRules.notice);
  if (near) rousePack(town, den);
  if (den.angry && !party.some((p) => !p.inside && distance(p.position, den.position) <= realmRules.leash))
    den.angry = false;
  // A den never bites, so `ready` holds when it next puts out a swarmer (0 while quiet) and is saved with it.
  if (!den.angry) {
    den.ready = 0;
    return;
  }
  if (den.ready <= 0) {
    den.ready = town.time + rankRules.denFirst;
    return;
  }
  if (town.time < den.ready) return;
  // A den under blows hatches slower, and a wounded one keeps a smaller brood.
  const struck = town.time - (town.combatState.struckAt.get(den.id) ?? -Infinity) < rankRules.denStruck;
  den.ready = town.time + (struck ? rankRules.denPauseStruck : rankRules.denPause);
  let brood = 0;
  for (const m of town.beasts) if (m.brood === den.id && m.health > 0 && m.rank === MonsterRank.Swarmer) ++brood;
  const most = (rankRules.denBrood + realmRules.broodPerFloor * town.realmFloor) * (den.vigor > 0 ? den.health / den.vigor : 1);
  if (brood >= Math.max(1, Math.round(most))) return;
  const { health, strength } = threat(town, town.realmGate, town.realmFloor),
    out = rotated(point(0.7, 0), hash01(den.id, Math.floor(town.time * 10), 3, 547) * 6.2832);
  hatch(town, add(den.position, out), health, strength, den.id, den.home);
}
/** A swarmer climbs out, already roused. */
function hatch(town: RealmTown, at: Point, health: number, strength: number, from: number, home: Point): Monster {
  const young = new Monster(town.nextMonster++, town.realmGate, town.grid.nearestWalkable(at));
  young.home = { ...home };
  young.health = health;
  young.strength = strength;
  young.angry = true;
  young.bornAt = town.time;
  young.brood = from;
  rankMonster(young, MonsterRank.Swarmer);
  town.beasts.push(young);
  town.emit(CombatCue.Spawn, young.position, { creature: young.id, amount: from });
  return young;
}
function nearestPrey(beast: Monster, party: Person[]): Person | null {
  const reach = beast.angry ? realmRules.leash : realmRules.notice;
  if (beast.rank === MonsterRank.Stalker)
    return choosePrey(
      beast,
      party.filter(
        (p) =>
          !p.inside &&
          distance(p.position, beast.position) < reach &&
          distance(p.position, beast.home) < realmRules.leash,
      ),
    );
  let best: Person | null = null,
    gap = reach;
  for (const p of party) {
    if (p.inside) continue;
    const d = distance(p.position, beast.position);
    if (d < gap && distance(p.position, beast.home) < realmRules.leash) {
      best = p;
      gap = d;
    }
  }
  return best;
}
function advanceFoe(town: RealmTown, beast: Monster, party: Person[], dt: number): void {
  if (beast.rank === MonsterRank.Den) return advanceDen(town, beast, party);
  const breed = breedOf(town.world.dungeons()[beast.lair].kind),
    guardian = beast.id === town.realmGuardian,
    enraged = guardian && beast.health < guardianVigor.call(town) / 2;
  if (beast.windupUntil >= 0) {
    beast.path = [];
    if (town.time >= beast.windupUntil) slam(town, beast, party, enraged);
    return;
  }
  const prey = tauntedBy(town, beast, realmRules.leash) ?? nearestPrey(beast, party),
    pace = slowedBy(town, beast);
  if (!prey) {
    beast.angry = false;
    if (!beast.path.length && distance(beast.position, beast.home) > f(0.4))
      beast.path = town.grid.path(beast.position, beast.home).slice(1);
    walkPath(beast, f(f(0.5) * pace * f(dt)));
    return;
  }
  rousePack(town, beast);
  const gap = distance(prey.position, beast.position);
  if (guardian && gap <= rankRules.slamRadius) {
    const due = town.combatState.slamAt.get(beast.id);
    if (due === undefined) town.combatState.slamAt.set(beast.id, town.time + rankRules.slamFirst);
    else if (town.time >= due) {
      beast.windupUntil = town.time + rankRules.slamWindup;
      beast.path = [];
      town.combatState.slamCenter.set(beast.id, { ...beast.position });
      town.emit(CombatCue.Telegraph, beast.position, {
        creature: beast.id,
        radius: rankRules.slamRadius,
        duration: rankRules.slamWindup,
      });
      return;
    }
  }
  const bite = () => {
    if (town.time < beast.ready) return;
    const might = beast.strength;
    if (enraged) beast.strength = f(might * realmRules.enrage);
    monsterBite(town, beast, prey, breed, 1, false, beast.rank === MonsterRank.Spitter);
    beast.strength = might;
  };
  const step = f(f(breed.speed * f(0.8) * rankPace(beast)) * pace * f(dt)),
    away = gap > 0.01 ? scale(sub(beast.position, prey.position), 1 / gap) : rotated(point(1, 0), beast.id * 2.39996);
  if (beast.rank === MonsterRank.Spitter) {
    if (gap <= rankRules.spitReach && town.time >= beast.ready && town.grid.clear(beast.position, prey.position, Infinity))
      bite();
    // It keeps its distance: backs off from whoever comes close, and closes in only to spit.
    const back = add(beast.position, scale(away, 1.2));
    // It backs off only within its own ground, so it never leads the party from room to room.
    if (gap < rankRules.spitShy && town.grid.walkable(back) && distance(back, beast.home) < rankRules.spitRoam) {
      beast.path = [back];
      walkPath(beast, step);
    } else if (gap > rankRules.spitReach * 0.9)
      huntStep(town, beast, add(prey.position, scale(away, rankRules.spitReach * 0.8)), town.realmArea, prey, step);
    else beast.path = [];
    return;
  }
  if (gap <= realmRules.biteReach) {
    beast.path = [];
    bite();
    return;
  }
  // A pack closes on a ring around its prey, each from its own side, instead of piling onto one spot.
  huntStep(town, beast, add(prey.position, scale(away, realmRules.ring)), town.realmArea, prey, step);
}
/** The floor has fallen: whatever is left of its brood dies at once. */
function breakBrood(town: RealmTown): void {
  const state = town.combatState,
    rest = town.beasts.filter((m) => m.health > 0 && inRealm.call(town, m.home));
  if (!rest.length) return;
  const gone = new Set(rest);
  town.beasts = town.beasts.filter((m) => !gone.has(m));
  for (const m of rest)
    for (const map of [state.taunts, state.slamAt, state.slamCenter, state.chilled, state.dirged, state.steering])
      map.delete(m.id);
  town.chronicle.monstersSlain += rest.length;
  for (const m of rest) town.emit(CombatCue.Kill, m.position, { creature: m.id });
  town.emit(CombatCue.BroodBreak, state.breakAt ?? rest[0].position, { amount: rest.length });
  town.notify(`What was left of the brood dies with it (${rest.length})`);
  ++town.changes;
}
/** True when the whole living party is down, after the gate has cast it out. */
function castOutFallen(town: RealmTown): boolean {
  const party = realmParty.call(town);
  if (!party.length || party.some((p) => p.downedAt < 0)) return false;
  castOut(town, party);
  return true;
}
/** Admits a waiting party, drives the monsters beyond the gate and ends a lost expedition. */
export function advanceRealm(this: RealmTown, dt: number): void {
  for (const party of this.parties) {
    party.members = party.members.filter((id) => {
      const p = this.person(id);
      return !!p && p.health > 0 && p.activity === Activity.Expedition;
    });
    if (!party.members.length) continue;
    const members = party.members.map((id) => this.person(id)!);
    if (members.every((p) => p.inside)) enterRealm(this, party, members);
  }
  this.parties = this.parties.filter((party) => party.members.length > 0);
  if (this.realmGate < 0) return;
  if (!realmParty.call(this).length) {
    this.notify('No one returned from ' + this.world.dungeons()[this.realmGate].name);
    closeRealm(this);
    return;
  }
  if (castOutFallen(this)) return;
  if (this.realmCleared) breakBrood(this);
  const plan = realmPlan.call(this)!,
    guardian = this.beasts.find((beast) => beast.id === this.realmGuardian && beast.health > 0);
  if (guardian && !this.realmBroodCalled && guardian.health < guardianVigor.call(this) / 2) {
    this.realmBroodCalled = true;
    const { health, strength } = threat(this, this.realmGate, this.realmFloor),
      count = realmRules.guardianWave + realmRules.guardianWavePerFloor * this.realmFloor;
    for (let i = 0; i < count; ++i)
      hatch(
        this,
        add(guardian.home, rotated(point(1.4 + 0.5 * (i % 2), 0), (i * 6.2832) / count)),
        health,
        strength,
        guardian.id,
        guardian.home,
      );
    this.emit(CombatCue.Enrage, guardian.position, { creature: guardian.id });
    this.notify('The guardian roars and its brood answers');
  }
  if (this.time >= this.realmPatrolAt) {
    this.realmPatrolAt = this.time + realmRules.patrolPause;
    const dens = plan.chambers.filter((chamber) => chamber.kind === ChamberKind.Den),
      next = dens[Math.floor(this.roll() * dens.length) % Math.max(1, dens.length)];
    if (next)
      this.realmPatrol.forEach((id, i) => {
        const beast = this.beasts.find((other) => other.id === id && other.health > 0);
        if (beast && !beast.angry) beast.home = this.grid.nearestWalkable(add(next.center, point(0.4 * i, 0.3)));
      });
  }
  const standing = realmStanding.call(this);
  for (const beast of this.beasts)
    if (beast.health > 0 && inRealm.call(this, beast.home)) advanceFoe(this, beast, standing, dt);
  castOutFallen(this);
}
export function gateFloors(this: TownState, dungeon: number): { cleared: number; sealed: boolean; total: number } {
  return {
    cleared: Math.min(sealFloors, this.depth[dungeon] ?? 0),
    sealed: gateSealed(this, dungeon),
    total: sealFloors,
  };
}
