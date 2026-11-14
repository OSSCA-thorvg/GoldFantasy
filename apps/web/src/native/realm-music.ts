// Music of the worlds beyond the gates: one loop per world and floor while a party is there.
import type { Town } from '../../../../packages/engine/src/town';
import { World } from '../../../../packages/engine/src/world-types';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';

const worldTracks: Record<Exclude<World, World.Count>, string> = {
  [World.Asgard]: 'asgard',
  [World.Vanaheim]: 'vanaheim',
  [World.Alfheim]: 'alfheim',
  [World.Jotunheim]: 'jotunheim',
  [World.Svartalfheim]: 'svartalfheim',
  [World.Niflheim]: 'niflheim',
  [World.Muspelheim]: 'muspelheim',
  [World.Helheim]: 'helheim',
};
export const realmFloors = 3;

/** The loop for the world beyond the open gate and its floor, or '' when no party is beyond a gate. */
export function realmTrack(town: Town): string {
  if (town.realmGate < 0) return '';
  const site = town.map().dungeons()[town.realmGate],
    world = site ? town.map().destination(site) : World.Count;
  if (world === World.Count) return '';
  const floor = Math.min(realmFloors - 1, Math.max(0, Math.trunc(town.realmFloor)));
  return `music/realm/${worldTracks[world]}_${floor + 1}`;
}

export interface RealmMusicApp {
  town: Town;
  cues: Sound[];
}
// Per app: the town it was asked for, so a loaded game asks again.
const asked = new WeakMap<object, { town: Town; track: string }>();

/** Asks for the world's loop on entry and on a floor change, and for silence on leaving. */
export function realmMusic(app: RealmMusicApp): void {
  const track = app.town.isTitleAutoplay() ? '' : realmTrack(app.town),
    last = asked.get(app);
  if (last && last.town === app.town && last.track === track) return;
  asked.set(app, { town: app.town, track });
  if (!track && !last?.track) return;
  const tune = new Sound(Cue.Music);
  tune.track = track;
  tune.loop = !!track;
  app.cues.push(tune);
}

/** Whether a world's loop holds the music, so the settlement's moments keep quiet. */
export function realmMusicPlaying(app: RealmMusicApp): boolean {
  return !!asked.get(app)?.track;
}
