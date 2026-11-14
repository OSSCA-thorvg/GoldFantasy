// The bard's lyre: each phrase the simulation starts is heard once, softly and only near the bard on screen.
import type { Town } from '../../../../packages/engine/src/town';
import type { Point } from '../../../../packages/engine/src/geometry';
import { Calling } from '../../../../packages/engine/src/person';
import { playing } from '../../../../packages/engine/src/bard-phrases';
import { f32 } from '../../../../packages/engine/src/numeric';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';

export const lyreRules = {
  /** Under the spatial level of an effect: a tune in the background, never over voices or blows. */
  gain: 0.5,
  /** Quieter than this and it is not worth a mixer slot. */
  floor: 0.03,
  /** A phrase is cued only this soon (simulation seconds) after it begins, never joined halfway. */
  fresh: 0.5,
};
export interface LyreApp {
  town: Town;
  cues: Sound[];
  last: number;
  speakers: Map<number, { speech: { playing(now: number): boolean } }>;
  renderer: { visible(at: Point): boolean };
  spatial(cue: Cue, at: Point): Sound;
  gameSpeed(): number;
}
// Per app and town: when each bard's phrase that was last considered began.
const considered = new WeakMap<object, { town: Town; begun: Map<number, number> }>();

/** Cues every newly begun lyre phrase in view; `quiet` holds them back (a world's loop is playing). */
export function bardLyre(app: LyreApp, quiet: boolean): void {
  let state = considered.get(app);
  if (!state || state.town !== app.town) considered.set(app, (state = { town: app.town, begun: new Map() }));
  const now = app.town.clock();
  for (const p of app.town.people()) {
    if (p.calling !== Calling.Bard || !playing(p, now) || state.begun.get(p.id) === p.phraseAt) continue;
    state.begun.set(p.id, p.phraseAt);
    if (now - p.phraseAt > lyreRules.fresh || quiet || app.gameSpeed() <= 0) continue;
    if (!app.renderer.visible(p.position) || speaking(app)) continue;
    const sound = app.spatial(Cue.Lyre, p.position);
    sound.gain = f32(sound.gain * lyreRules.gain);
    sound.take = p.phrase;
    if (sound.gain > lyreRules.floor && app.cues.length < 32) app.cues.push(sound);
  }
}
const speaking = (app: LyreApp): boolean =>
  [...app.speakers.values()].some((s) => s.speech.playing(app.last));
