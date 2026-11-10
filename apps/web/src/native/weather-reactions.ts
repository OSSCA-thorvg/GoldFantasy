import { Activity, Role, type Person } from '../../../../packages/engine/src/person';
import { Weather } from '../../../../packages/engine/src/climate';
import { appearanceOf } from '../../../../packages/engine/src/person-look';
import { hash01 } from '../../../../packages/engine/src/numeric';
import type { Strike } from '../../../../packages/engine/src/thunderstorm';
import {
  Cue,
  Sound,
  VoiceLine,
  VoiceKind,
  characterVoicePitch,
  voiceKind,
} from '../../../../packages/native-audio/src';
import { speakerState, type GameSpeechApp } from './game-speech';

export interface WeatherReactionApp extends GameSpeechApp {
  gameSpeed(): number;
}
type Reaction = 'rain' | 'snow' | 'thunder';
interface PendingReaction {
  kind: Reaction;
  serial: number;
  due: number;
  expires: number;
  warmed: Set<VoiceKind>;
}
interface ReactionState {
  town: WeatherReactionApp['town'];
  at: number;
  clock: number;
  wet: Reaction | null;
  nextWet: number;
  nextAllowed: number;
  serial: number;
  lastStrike: string;
  pending: PendingReaction[];
  speakers: Map<number, number>;
}
/** Presentation-time limits keep accelerated simulations and title previews quiet. */
export const weatherReactionTiming = Object.freeze({
  entryDelay: 0.8,
  thunderDelay: 0.2,
  quiet: 12,
  speakerQuiet: 40,
  expiry: 8,
  repeatMin: 35,
  repeatRange: 25,
});
const states = new WeakMap<WeatherReactionApp, ReactionState>();
const wetKind = (weather: Weather): Reaction | null =>
  weather === Weather.Snow ? 'snow' : weather === Weather.Rain || weather === Weather.Storm ? 'rain' : null;
const lineOf = (kind: Reaction): VoiceLine =>
  kind === 'rain' ? VoiceLine.Rain : kind === 'snow' ? VoiceLine.Snow : VoiceLine.Thunder;

export function resetWeatherReactions(app: WeatherReactionApp): void {
  states.delete(app);
}
function stateFor(app: WeatherReactionApp, seconds: number): ReactionState {
  let state = states.get(app);
  const clock = app.town.clock();
  if (!state || state.town !== app.town || seconds < state.at || clock < state.clock) {
    state = {
      town: app.town,
      at: seconds,
      clock,
      wet: null,
      nextWet: Infinity,
      nextAllowed: seconds,
      serial: 0,
      lastStrike: '',
      pending: [],
      speakers: new Map(),
    };
    states.set(app, state);
  }
  state.at = seconds;
  state.clock = clock;
  return state;
}
function repeatAfter(app: WeatherReactionApp, state: ReactionState): number {
  return (
    weatherReactionTiming.repeatMin +
    weatherReactionTiming.repeatRange * hash01(app.town.map().seed(), state.serial, 0, 0x77ea7)
  );
}
function enqueue(state: ReactionState, kind: Reaction, due: number): void {
  const previous = state.pending.find((event) => event.kind === kind);
  // Keep the first audible event, rather than postponing it on every new flash.
  if (previous && previous.due <= due) return;
  state.pending = state.pending.filter((event) => event.kind !== kind);
  state.pending.push({
    kind,
    serial: ++state.serial,
    due,
    expires: due + weatherReactionTiming.expiry,
    warmed: new Set(),
  });
}
function visibleOutdoor(app: WeatherReactionApp, p: Person): boolean {
  if (
    (p.role !== Role.Resident && p.role !== Role.Guest) ||
    p.health <= 0 ||
    p.inside ||
    p.crossingDoorway() ||
    p.visibility() <= 0.05
  )
    return false;
  const at = app.toScreen(p.position);
  return (
    at.x >= 0 &&
    at.x <= app.viewWidth &&
    at.y >= 0 &&
    at.y <= app.viewHeight &&
    app.renderer.visible(p.position) &&
    app.spatial(Cue.Speech, p.position).gain * 0.6 >= 0.03
  );
}
function eligible(app: WeatherReactionApp, p: Person): boolean {
  return (
    visibleOutdoor(app, p) &&
    ![Activity.Fighting, Activity.Sleeping, Activity.Expedition, Activity.Leaving].includes(p.activity)
  );
}
function candidates(
  app: WeatherReactionApp,
  state: ReactionState,
  event: PendingReaction,
  seconds: number,
): Person[] {
  const seed = app.town.map().seed();
  return app.town
    .people()
    .filter((p) => eligible(app, p) && seconds >= (state.speakers.get(p.id) ?? -Infinity))
    .map((p) => ({ p, score: hash01(seed, p.id, event.serial, 0x77ea8) }))
    .sort((a, b) => b.score - a.score || a.p.id - b.p.id)
    .map((item) => item.p);
}
function warm(app: WeatherReactionApp, event: PendingReaction, person: Person): void {
  const voice = voiceKind(appearanceOf(person).bodyType, person.look, person.id);
  if (event.warmed.has(voice)) return;
  event.warmed.add(voice);
  const cue = new Sound(Cue.PrepareSpeech);
  cue.line = lineOf(event.kind);
  cue.voice = voice;
  cue.speaker = person.id;
  app.cues.push(cue);
}

/** Invoke after command acknowledgements, passing only a newly emitted thunder strike.
 * Speech starts only after the audible thunder arrives; future-start speech would
 * be consumed prematurely by the existing speechAudio sequence bookkeeping.
 */
export function updateWeatherReactions(app: WeatherReactionApp, seconds: number, strike?: Strike): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const state = stateFor(app, seconds),
    wet = wetKind(app.town.climate().weather);
  for (const [id, until] of state.speakers)
    if (until <= seconds || !app.town.person(id)) state.speakers.delete(id);
  state.pending = state.pending.filter((event) => seconds <= event.expires);
  if (app.editor || app.gameSpeed() <= 0) {
    state.pending = [];
    state.wet = wet;
    state.nextWet = seconds + repeatAfter(app, state);
    return;
  }
  if (wet !== state.wet) {
    state.pending = state.pending.filter((event) => event.kind === 'thunder');
    state.wet = wet;
    if (wet) enqueue(state, wet, seconds + weatherReactionTiming.entryDelay);
    state.nextWet = wet ? seconds + repeatAfter(app, state) : Infinity;
  } else if (wet && seconds >= state.nextWet) {
    enqueue(state, wet, seconds + weatherReactionTiming.entryDelay);
    state.nextWet = seconds + repeatAfter(app, state);
  }
  if (strike && Number.isFinite(strike.delay) && strike.delay >= 0) {
    const key = `${strike.at}:${strike.seed}:${strike.reach}`;
    if (key !== state.lastStrike) {
      state.lastStrike = key;
      enqueue(state, 'thunder', seconds + strike.delay + weatherReactionTiming.thunderDelay);
    }
  }
  if (!state.pending.length) return;
  const pending = [...state.pending].sort(
    (a, b) =>
      Number(b.kind === 'thunder') - Number(a.kind === 'thunder') || a.due - b.due || a.serial - b.serial,
  );
  const available = new Map<PendingReaction, Person[]>();
  for (const event of pending) {
    const people = candidates(app, state, event, seconds);
    available.set(event, people);
    if (people[0]) warm(app, event, people[0]);
  }
  // Weather is background conversation: never replace another utterance or
  // compete with a command/alarm/combat cue. No selection-dependent channels.
  if (
    seconds < state.nextAllowed ||
    app.town
      .people()
      .some((person) => person.activity === Activity.Fighting && visibleOutdoor(app, person)) ||
    [...app.speakers.values()].some((s) => s.speech.playing(seconds)) ||
    app.cues.some((cue) =>
      [Cue.Order, Cue.Alarm, Cue.Howl, Cue.Clash, Cue.Bite, Cue.Arrow, Cue.Speech].includes(cue.cue),
    )
  )
    return;
  for (const event of pending) {
    if (seconds < event.due) continue;
    for (const person of available.get(event) ?? []) {
      const voice = voiceKind(appearanceOf(person).bodyType, person.look, person.id),
        speech = speakerState(app, person.id).speech;
      if (!speech.say(lineOf(event.kind), seconds, characterVoicePitch(person.look, person.id), voice))
        continue;
      state.nextAllowed = seconds + weatherReactionTiming.quiet;
      state.speakers.set(person.id, seconds + weatherReactionTiming.speakerQuiet);
      state.pending = state.pending.filter((item) => item !== event);
      return;
    }
  }
}
