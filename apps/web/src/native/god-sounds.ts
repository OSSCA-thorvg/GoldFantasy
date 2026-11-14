// Thunder for the bolts Thor calls down: as he comes, with each hammer strike, and as he goes.
import type { Point } from '../../../../packages/engine/src/geometry';
import { f32 as f } from '../../../../packages/engine/src/numeric';
import { Reach } from '../../../../packages/engine/src/thunderstorm';
import { BoltKind } from '../../../../packages/engine/src/thor-visit';
import type { Town } from '../../../../packages/engine/src/town';
import { Cue, type Sound } from '../../../../packages/native-audio/src';

const heard = new WeakMap<Town, bigint>();
/** New bolts in view, as thunder: a hammer strike cracks close by, his coming and going right overhead. */
export function thorThunder(town: Town, visible: (at: Point) => boolean, spatial: (cue: Cue, at: Point) => Sound): Sound[] {
  let next = heard.get(town) ?? 0n;
  const out: Sound[] = [];
  for (const bolt of town.thor.bolts) {
    if (bolt.serial < next) continue;
    next = bolt.serial + 1n;
    if (town.clock() - bolt.at > 0.5 || !visible(bolt.position)) continue;
    const hammer = bolt.kind === BoltKind.Hammer,
      sound = spatial(Cue.ThunderCrack + (hammer ? Reach.Near : Reach.Overhead), bolt.position);
    // A bolt at the player's feet: as loud as the weather's nearest strikes, never quieter than half of one.
    sound.gain = f(Math.max(f(0.45), sound.gain) * (hammer ? f(0.85) : 1));
    out.push(sound);
  }
  heard.set(town, next);
  return out;
}
