// What a fight sounds like: blows by weapon, skills, swarms, dens and the brood, thinned so a crowd stays legible.
import type { Person, Hit, Monster } from '../../../../packages/engine/src/person';
import {
  CombatCue,
  MonsterRank,
  type AbilityId,
  type CombatEvent,
} from '../../../../packages/engine/src/combat-events';
import { StrikeKind, skills, skillSpec } from '../../../../packages/engine/src/skill-catalog';
import { isPlayerResident } from '../../../../packages/engine/src/faction';
import type { Point } from '../../../../packages/engine/src/geometry';
import { f32, clamp, hash01 } from '../../../../packages/engine/src/numeric';
import { appearanceOf } from '../../../../packages/engine/src/person-look';
import type { Town } from '../../../../packages/engine/src/town';
import {
  Cue,
  Sound,
  VoiceLine,
  SpeechChannel,
  effectVolume,
  voiceKind,
  voiceTakes,
  voiceSample,
  characterVoicePitch,
} from '../../../../packages/native-audio/src';
import { fallenPerson } from './game-combat-hud';

/** Tuning for how much of a crowd is heard. */
export const combatSoundRules = {
  /** Blows heard in one frame, the most telling first. */
  blowsPerFrame: 4,
  /** Monster deaths heard in any one second, and in one frame. */
  deathsPerSecond: 5,
  deathsPerFrame: 2,
  /** Seconds between den spawn sounds overall, and from one den. */
  spawnGap: 0.4,
  denSpawnGap: 2,
  /** Monsters in earshot (weighted by distance) before the pack bed starts, and where it is full. */
  bedFrom: 4,
  bedFull: 28,
};
const skillCues: Record<AbilityId, Cue> = {
  challenge: Cue.Challenge,
  whirl: Cue.Whirl,
  aimed: Cue.AimedShot,
  volley: Cue.Volley,
  burst: Cue.RuneBurst,
  frost: Cue.FrostRing,
  mend: Cue.Mend,
  sanctuary: Cue.Sanctuary,
  rally: Cue.Rally,
  dirge: Cue.Dirge,
};
const strikeCues: Partial<Record<StrikeKind, Cue>> = {
  [StrikeKind.Cleave]: Cue.Cleave,
  [StrikeKind.Crush]: Cue.Crush,
  [StrikeKind.Pierce]: Cue.Pierce,
  [StrikeKind.Splash]: Cue.Splash,
};
/** Sound bookkeeping, owned by the combat HUD state and reset whenever its town is replaced. */
export class CombatSoundState {
  town: object | null = null;
  heardBlow = 0n;
  quietUntil = new Map<string, number>();
  /** Ranks of the monsters listed this frame and the last, so a death can be told after the body is gone. */
  ranks = new Map<number, MonsterRank>();
  lastRanks = new Map<number, MonsterRank>();
  /** When the recent swarm deaths were heard. */
  deaths: number[] = [];
  /** The pack bed's level and pan, for the ambience mix. */
  swarm = 0;
  swarmPan = 0;
}
export interface CombatSoundApp {
  town: Town;
  cues: Sound[];
  chosen: number[];
  camera: { zoom: number };
  renderer: { visible(at: Point): boolean };
  combatHud: { sound: CombatSoundState };
  spatial(cue: Cue, at: Point): Sound;
  sayLine(id: number, line: VoiceLine): boolean;
}

function push(app: CombatSoundApp, s: Sound): boolean {
  if (!(s.gain > f32(0.03)) || app.cues.length >= 32) return false;
  app.cues.push(s);
  return true;
}
function sound(app: CombatSoundApp, cue: Cue, at: Point, gain: number, pitch = 1, floor = 0): boolean {
  const s = app.spatial(cue, at);
  s.gain = f32(Math.min(1, Math.max(floor, s.gain * gain)));
  s.pitch = pitch;
  return push(app, s);
}
function quiet(state: CombatSoundState, key: string, seconds: number, now: number): boolean {
  const until = state.quietUntil.get(key) ?? -1;
  if (now < until) return true;
  state.quietUntil.set(key, now + seconds);
  return false;
}
function voiceOf(person: Person) {
  return voiceKind(appearanceOf(person).bodyType, person.look, person.id);
}
/** Loads a voice line ahead of need, without playing it. */
function warmVoice(app: CombatSoundApp, person: Person, line: VoiceLine): void {
  const cue = new Sound(Cue.PrepareSpeech);
  cue.line = line;
  cue.voice = voiceOf(person);
  cue.speaker = person.id;
  if (app.cues.length < 32) app.cues.push(cue);
}
/** The dead cannot speak through their speaker any more: their last line is played directly. */
function lastWords(app: CombatSoundApp, person: Person, at: Point): void {
  const voice = voiceOf(person),
    takes = voiceTakes(VoiceLine.Death, voice);
  if (!takes) return;
  const s = app.spatial(Cue.Speech, at),
    take = Math.trunc(hash01(person.id, person.look, 0, 0x5d2e) * takes) % takes,
    pitch = characterVoicePitch(person.look, person.id),
    duration = voiceSample(VoiceLine.Death, voice, take).duration() / pitch;
  if (!(duration > 0)) return;
  s.gain = f32(Math.max(0.35, s.gain * 0.8));
  s.line = VoiceLine.Death;
  s.voice = voice;
  s.take = take;
  s.pitch = pitch;
  s.speaker = -1;
  s.speechChannel = SpeechChannel.Selected;
  s.duration = f32(duration);
  if (app.cues.length < 32) app.cues.push(s);
}
/** The skill an event is for: its id, or, from an engine that names skills only, its name. */
export function eventSkill(e: CombatEvent): AbilityId | null {
  if (e.skill) return e.skill;
  return skills.find((skill) => skill.name === e.text)?.id ?? null;
}
function skillSound(app: CombatSoundApp, e: CombatEvent, now: number): void {
  const state = app.combatHud.sound,
    id = eventSkill(e);
  if (!id || quiet(state, `skill-${id}`, 0.2, now)) return;
  const s = app.spatial(skillCues[id], e.position);
  s.gain = f32(Math.min(1, s.gain * (id === 'mend' ? 0.8 : 0.9)));
  // Skills that land later are heard landing; Volley's clip already holds its flight.
  if (id === 'burst' || id === 'frost') s.delay = f32(skillSpec(id).delay);
  push(app, s);
  if ((id === 'challenge' || id === 'rally') && e.person >= 0) app.sayLine(e.person, VoiceLine.Attack);
}
/** How telling a blow is: the player's chosen fighters first, then crits, then the rest by weight. */
function blowWeight(app: CombatSoundApp, hit: Hit): number {
  const chosen = app.chosen.includes(hit.onPerson ? hit.person : (hit.attacker ?? hit.person));
  return (chosen ? 1000 : 0) + (hit.crit ? 500 : 0) + (hit.onPerson ? 100 : 0) + Math.min(99, hit.damage);
}
export function blowCue(hit: Hit): Cue {
  if (hit.onPerson) return Cue.Bite;
  return strikeCues[hit.strike ?? StrikeKind.Single] ?? (hit.ranged ? Cue.Arrow : Cue.Clash);
}
function blowSounds(app: CombatSoundApp): void {
  const state = app.combatHud.sound,
    fresh: Hit[] = [];
  for (const hit of app.town.hits()) {
    if (hit.serial < state.heardBlow) continue;
    state.heardBlow = hit.serial + 1n;
    // A cleave or volley's other targets are heard in its first.
    if (hit.primary !== false && app.renderer.visible(hit.to)) fresh.push(hit);
  }
  fresh.sort((a, b) => blowWeight(app, b) - blowWeight(app, a));
  for (const hit of fresh.slice(0, combatSoundRules.blowsPerFrame)) sound(app, blowCue(hit), hit.to, 0.6);
}
function monsterDeath(app: CombatSoundApp, e: CombatEvent, now: number, heard: { deaths: number }): void {
  const state = app.combatHud.sound,
    rank = state.ranks.get(e.creature) ?? state.lastRanks.get(e.creature);
  // Animals (never ranked) are hunted, not fought; a den's end is its own cue.
  if (rank === undefined || rank === MonsterRank.Den || !app.renderer.visible(e.position)) return;
  if (rank === MonsterRank.Guardian) {
    sound(app, Cue.Slam, e.position, 1, 0.75);
    return;
  }
  state.deaths = state.deaths.filter((t) => now - t < 1 && t <= now);
  const big = rank === MonsterRank.Brute || rank === MonsterRank.Grunt || rank === MonsterRank.Stalker;
  if (
    !big &&
    (heard.deaths >= combatSoundRules.deathsPerFrame ||
      state.deaths.length >= combatSoundRules.deathsPerSecond)
  )
    return;
  // Each death in a busy second is a little quieter, so ten read as a rout, not a roar.
  const thin = 1 / (1 + 0.15 * state.deaths.length),
    pitch = rank === MonsterRank.Brute ? 0.7 : big ? 0.85 : 1;
  if (sound(app, Cue.SwarmDeath, e.position, (big ? 0.85 : 0.6) * thin, pitch)) {
    ++heard.deaths;
    if (!big) state.deaths.push(now);
  }
}
const pack = (m: Monster): boolean =>
  m.animal === null && m.health > 0 && !m.insideLair && m.rank !== MonsterRank.Den;
/** Notes every monster's rank and sets the pack bed from those in earshot. */
function remember(app: CombatSoundApp): void {
  const state = app.combatHud.sound,
    ranks = new Map<number, MonsterRank>();
  let weight = 0,
    pan = 0;
  const volume = Math.max(f32(0.05), effectVolume(app.camera.zoom));
  for (const m of app.town.monsters()) {
    ranks.set(m.id, m.rank);
    if (!pack(m)) continue;
    const s = app.spatial(Cue.Place, m.position),
      w = Math.min(1, s.gain / volume);
    weight += w;
    pan += w * s.pan;
  }
  state.lastRanks = state.ranks;
  state.ranks = ranks;
  const rules = combatSoundRules,
    level = clamp((weight - rules.bedFrom) / (rules.bedFull - rules.bedFrom), 0, 1);
  state.swarm = f32(level ** 0.75 * Math.min(1, volume / f32(0.45)));
  state.swarmPan = weight > 0 ? f32(clamp(pan / weight, -1, 1)) : 0;
}
/** Hears this frame's blows and combat events once each and keeps the pack bed's level. `events` are the events
 * new this frame, none during the title autoplay. Residents' own moments carry floors so a crowd cannot bury them. */
export function combatSounds(app: CombatSoundApp, events: readonly CombatEvent[], now: number): void {
  const state = app.combatHud.sound,
    town = app.town;
  if (state.town !== town) {
    state.town = town;
    state.heardBlow = 0n;
    for (const hit of town.hits()) if (hit.serial >= state.heardBlow) state.heardBlow = hit.serial + 1n;
    state.quietUntil.clear();
    state.ranks.clear();
    state.lastRanks.clear();
    state.deaths = [];
  }
  remember(app);
  blowSounds(app);
  let heard = 0;
  const counted = { deaths: 0 };
  for (const e of events) {
    const person = e.person >= 0 ? town.person(e.person) : null,
      seen = app.renderer.visible(e.position);
    switch (e.cue) {
      case CombatCue.Downed:
        if (!person || !isPlayerResident(person)) break;
        sound(app, Cue.Downed, e.position, 0.55, 1.25, 0.3);
        app.sayLine(person.id, VoiceLine.Hut);
        warmVoice(app, person, VoiceLine.Death);
        warmVoice(app, person, VoiceLine.Thanks);
        break;
      case CombatCue.Revived:
        if (person) app.sayLine(person.id, VoiceLine.Thanks);
        break;
      case CombatCue.Death: {
        const record = town.fallen.find((f) => f.id === e.person && f.at === e.at) ?? null,
          body = record ? fallenPerson(record) : person;
        const knell = new Sound(Cue.Fall, 0.75);
        knell.pitch = 0.9;
        push(app, knell);
        if (body) lastWords(app, body, e.position);
        break;
      }
      case CombatCue.Crit:
        if (seen && heard < 4 && !quiet(state, 'crit', 0.12, now)) {
          ++heard;
          sound(app, Cue.Clash, e.position, 0.85, 0.8);
        }
        break;
      case CombatCue.Block:
        if (seen && heard < 4 && !quiet(state, 'block', 0.12, now)) {
          ++heard;
          sound(app, Cue.Parry, e.position, 0.75);
        }
        break;
      case CombatCue.Telegraph:
        sound(app, Cue.Swing, e.position, 1, 0.55);
        break;
      case CombatCue.Slam:
        sound(app, Cue.Slam, e.position, 1, 0.85);
        break;
      case CombatCue.Enrage:
        sound(app, Cue.Howl, e.position, 0.7);
        break;
      case CombatCue.Ability:
        if (seen) skillSound(app, e, now);
        break;
      case CombatCue.LevelUp:
        if (person && seen && isPlayerResident(person)) app.sayLine(person.id, VoiceLine.Ahh);
        break;
      case CombatCue.Kill:
        monsterDeath(app, e, now, counted);
        break;
      case CombatCue.Spawn:
        if (seen && !quiet(state, `spawn-${e.amount}`, combatSoundRules.denSpawnGap, now)) {
          if (quiet(state, 'spawn', combatSoundRules.spawnGap, now)) break;
          sound(app, Cue.Spawn, e.position, 0.5);
        }
        break;
      case CombatCue.DenDestroyed:
        sound(app, Cue.DenFall, e.position, 1, 1, seen ? 0.4 : 0);
        break;
      case CombatCue.BroodBreak: {
        const s = new Sound(Cue.BroodBreak, 0.8, app.spatial(Cue.BroodBreak, e.position).pan);
        push(app, s);
        break;
      }
      case CombatCue.Wave:
        if (!quiet(state, 'wave', 4, now))
          push(app, new Sound(Cue.WaveHorn, 0.55, app.spatial(Cue.WaveHorn, e.position).pan));
        break;
    }
  }
}
