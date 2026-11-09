import type { Town } from '../../../../packages/engine/src/town';
import type { Point } from '../../../../packages/engine/src/geometry';
import { TreeWorkKind, type TreeWorkEvent } from '../../../../packages/engine/src/person';
import { treePosition } from '../../../../packages/engine/src/world-map';
import * as mining from '../../../../packages/engine/src/mining';
import { f32 as f } from '../../../../packages/engine/src/numeric';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { treeFallClipImpactSeconds } from '../../../../packages/native-audio/src/sound-catalog';
import { treeFallTiming, titleAutoplayRate } from '../../../../packages/engine/src/work-timing';

export interface WorkAudioHost {
  town: Town;
  heardTree: bigint;
  cues: Sound[];
  renderer: { visible(at: Point): boolean };
  spatial(cue: Cue, at: Point): Sound;
  gameSpeed(): number;
}

interface PendingWorkAudio {
  town: Town;
  heard: bigint;
  clock: number;
  falls: Map<bigint, TreeWorkEvent>;
}
const pending = new WeakMap<WorkAudioHost, PendingWorkAudio>();

/** Prioritize one-off falls and wait until their visible contact is imminent.
 * Keeping future falls here makes pause, speed and world changes affect visuals
 * and sound together, instead of leaving a long timer in the audio device. */
export function queueWorkSounds(app: WorkAudioHost): void {
  const now = app.town.clock();
  let state = pending.get(app);
  if (!state || state.town !== app.town || app.heardTree < state.heard || now < state.clock) {
    state = { town: app.town, heard: app.heardTree, clock: now, falls: new Map() };
    pending.set(app, state);
  }
  state.clock = now;
  const unseen = app.town.treeEvents().filter((event) => event.serial >= app.heardTree);
  for (const event of unseen)
    if (event.kind === TreeWorkKind.Fall) {
      state.falls.set(event.serial, event);
      if (state.falls.size > 64) state.falls.delete(state.falls.keys().next().value!);
    }
  if (unseen.length) app.heardTree = unseen[unseen.length - 1].serial + 1n;
  state.heard = app.heardTree;
  const speed = app.town.isTitleAutoplay() ? titleAutoplayRate : app.gameSpeed();
  if (!(speed > 0)) return;
  const due = [...state.falls.values()].filter(
    (event) => now - event.at >= treeFallTiming.impact - treeFallClipImpactSeconds * speed - 1e-8,
  );
  const candidates = [...due, ...unseen.filter((event) => event.kind !== TreeWorkKind.Fall)];
  const rank = (kind: TreeWorkKind) =>
    kind === TreeWorkKind.Fall
      ? 0
      : kind === TreeWorkKind.Shatter
        ? 1
        : kind === TreeWorkKind.Regrow || kind === TreeWorkKind.Produced
          ? 3
          : 2;
  candidates.sort((a, b) => rank(a.kind) - rank(b.kind) || Number(a.serial - b.serial));
  let heard = 0;
  for (const event of candidates) {
    if (heard >= 4 || app.cues.length >= 32) break;
    const fall = event.kind === TreeWorkKind.Fall,
      age = Math.max(0, app.town.clock() - event.at),
      growth = event.kind === TreeWorkKind.Regrow || event.kind === TreeWorkKind.Produced;
    if (fall ? age > treeFallTiming.duration + 0.25 * speed : age / speed > (growth ? 0.25 : 0.12)) {
      if (fall) state.falls.delete(event.serial);
      continue;
    }
    const stone = event.kind === TreeWorkKind.Mine || event.kind === TreeWorkKind.Shatter,
      hammer = event.kind === TreeWorkKind.Hammer,
      x = event.cell % app.town.map().width(),
      y = Math.trunc(event.cell / app.town.map().width()),
      at =
        event.kind === TreeWorkKind.Produced || hammer
          ? event.worker
          : stone
            ? mining.position(x, y)
            : treePosition(app.town.map(), x, y, event.index);
    if (!app.renderer.visible(at)) {
      if (fall) state.falls.delete(event.serial);
      continue;
    }
    const sound = app.spatial(
      growth
        ? Cue.Growth
        : hammer
          ? Cue.Hammer
          : stone
            ? Cue.Mine
            : event.kind === TreeWorkKind.Chop
              ? Cue.Chop
              : Cue.TreeFall,
      at,
    );
    if (sound.gain <= 0) {
      if (fall) state.falls.delete(event.serial);
      continue;
    }
    sound.gain = f(sound.gain * f(growth ? 0.22 : fall ? 0.58 : hammer ? 0.34 : 0.4));
    sound.speaker = event.person;
    if (fall) {
      // The PCM's principal crash is near its beginning. Keep its natural pitch
      // and schedule that peak at the visual ground contact, including 4x title play.
      const remaining = (treeFallTiming.impact - age) / speed - treeFallClipImpactSeconds;
      sound.delay = Math.max(0, remaining);
      sound.offset = Math.max(0, -remaining);
    } else if (!growth) sound.offset = age / speed;
    app.cues.push(sound);
    if (fall) state.falls.delete(event.serial);
    heard++;
  }
}
