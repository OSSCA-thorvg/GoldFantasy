// What an expedition beyond a gate did, gathered as it runs and handed to the HUD when the party is home.
// Presentation only: the simulation writes it and never reads it back.
import type { TownState } from './town-state';
import type { Person } from './person';
import type { Fallen } from './combat-events';
import type { Point } from './geometry';
import { Resources } from './building-catalog';

export enum ExpeditionEnd {
  /** The floor's dens and guardian fell and the party went home. */
  Cleared,
  /** The third floor fell: the gate is sealed. */
  Sealed,
  /** The party went home before the floor was cleared. */
  Withdrew,
  /** The last one standing fell: the gate threw the party out alive, and the spoils were lost. */
  CastOut,
  /** Nobody came back. */
  Lost,
}
export enum MemberState {
  Unhurt,
  /** Home and on their feet, but carrying a wound for some days. */
  Wounded,
  /** Carried home downed, still bleeding out. */
  Down,
  Fallen,
}
/** One member of the party as they stood when it set out (or joined it, or when a mid-way save was loaded). */
interface RecordedMember {
  id: number;
  level: number;
}
/** The running record of the expedition beyond the open gate. Not saved: after a load it starts over as `known: false`. */
export interface ExpeditionRecord {
  gate: number;
  floor: number;
  /** False once rebuilt after a load: the clock, the count of the slain and the levels gained are then unknown. */
  known: boolean;
  startedAt: number;
  slain: number;
  /** Dens on the floor when the party arrived. */
  dens: number;
  members: RecordedMember[];
  /** The floor's reward lines (a floor opened, a gate sealed, the altar's cap), without the hoard. */
  rewards: string[];
}
export interface MemberOutcome {
  id: number;
  name: string;
  calling: number;
  level: number;
  /** Levels gained beyond the gate; -1 when unknown. */
  gained: number;
  state: MemberState;
  woundDays: number;
  /** Cause of death for the fallen, else ''. */
  cause: string;
  /** The memorial record of the fallen, to draw their likeness. */
  fallen: Fallen | null;
}
/** The finished expedition, for the result screen. */
export interface ExpeditionResult {
  end: ExpeditionEnd;
  gate: number;
  site: string;
  world: string;
  floor: number;
  floors: number;
  /** Clock seconds beyond the gate; -1 when unknown. */
  seconds: number;
  dens: number;
  densDestroyed: number;
  guardianFell: boolean;
  /** Monsters slain beyond the gate; -1 when unknown. */
  slain: number;
  members: MemberOutcome[];
  /** Brought home, or lost when the party was cast out or never came back. */
  spoils: Resources;
  spoilsKept: boolean;
  rewards: string[];
  /** Where the party came out, in Midgard. */
  home: Point;
}
export function beginRecord(town: TownState, members: readonly Person[], dens: number, known = true): ExpeditionRecord {
  town.realmRecord = {
    gate: town.realmGate,
    floor: town.realmFloor,
    known,
    startedAt: town.time,
    slain: 0,
    dens,
    members: members.map((p) => ({ id: p.id, level: p.level })),
    rewards: [],
  };
  return town.realmRecord;
}
export function joinRecord(record: ExpeditionRecord, members: readonly Person[]): void {
  for (const p of members) if (!record.members.some((m) => m.id === p.id)) record.members.push({ id: p.id, level: p.level });
}
function memberOutcome(town: TownState, member: RecordedMember, known: boolean): MemberOutcome | null {
  const p = town.person(member.id),
    gained = (level: number) => (known ? Math.max(0, level - member.level) : -1);
  if (!p || p.health <= -1) {
    const fallen = [...town.fallen].reverse().find((f) => f.id === member.id);
    if (!fallen) return null;
    const { name, calling, level, cause } = fallen;
    return { id: member.id, name, calling, level, gained: gained(level), state: MemberState.Fallen, woundDays: 0, cause, fallen };
  }
  return {
    id: member.id,
    name: p.name,
    calling: p.calling,
    level: p.level,
    gained: gained(p.level),
    state: p.downedAt >= 0 ? MemberState.Down : p.woundDays > 0 ? MemberState.Wounded : MemberState.Unhurt,
    woundDays: Math.ceil(p.woundDays),
    cause: '',
    fallen: null,
  };
}
export interface RecordEnding {
  end: ExpeditionEnd;
  site: string;
  world: string;
  floors: number;
  densLeft: number;
  guardianFell: boolean;
  spoils: Resources;
  spoilsKept: boolean;
  home: Point;
}
/** Seals the record into the result the HUD shows; the record itself is dropped. */
export function finishRecord(town: TownState, record: ExpeditionRecord, ending: RecordEnding): ExpeditionResult {
  town.realmRecord = null;
  const result: ExpeditionResult = {
    end: ending.end,
    gate: record.gate,
    site: ending.site,
    world: ending.world,
    floor: record.floor,
    floors: ending.floors,
    seconds: record.known ? Math.max(0, town.time - record.startedAt) : -1,
    dens: record.dens,
    densDestroyed: Math.max(0, record.dens - ending.densLeft),
    guardianFell: ending.guardianFell,
    slain: record.known ? record.slain : -1,
    members: record.members
      .map((m) => memberOutcome(town, m, record.known))
      .filter((m): m is MemberOutcome => m !== null),
    spoils: new Resources().add(ending.spoils),
    spoilsKept: ending.spoilsKept,
    rewards: [...record.rewards],
    home: { ...ending.home },
  };
  town.realmOutcome = result;
  return result;
}
