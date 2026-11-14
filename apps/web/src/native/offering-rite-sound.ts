import { OfferingGrade, type OfferingKey } from '../../../../packages/engine/src/prayer-offering';
import type { RiteTimeline } from '../../../../packages/native-renderer/src/offering-rite';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';

export interface RiteCue {
  at: number;
  cue: Cue;
  gain: number;
  pitch: number;
  pan: number;
}

/** Fuller for higher grades; everything is a dry, low tabletop sound from the existing clips. */
const weight = [0.55, 0.7, 0.85, 1];

/** Every beat of the rite as a timed cue: gifts laid, the bow, the answer, the release and the birth. */
export function riteCues(tl: RiteTimeline, gifts: readonly OfferingKey[], worshippers: number): RiteCue[] {
  const w = weight[tl.grade],
    out: RiteCue[] = [];
  const add = (at: number, cue: Cue, gain: number, pitch = 1, pan = 0) =>
    out.push({ at, cue, gain: Math.min(1, gain), pitch, pan });
  gifts.forEach((key, i) => {
    const pan = (i - (gifts.length - 1) / 2) * 0.12;
    if (key === 'gold') add(tl.lays[i], Cue.Coins, 0.7 * w, 0.9, pan);
    else add(tl.lays[i], Cue.Click, 0.7 * w, key === 'stone' ? 0.55 : key === 'bones' ? 0.7 : 0.85, pan);
  });
  for (let k = 0; k < worshippers; ++k) add(tl.bows[k], Cue.Click, 0.35 * w, 0.5, -0.2 + 0.1 * k);
  add(tl.answer, Cue.Discover, 0.5 * w);
  if (tl.grade >= OfferingGrade.Worthy) add(tl.answer + 0.15, Cue.Raven, 0.3 * w, 1, 0.3);
  return out.sort((a, b) => a.at - b.at);
}

export function riteSound(cue: RiteCue): Sound {
  const sound = new Sound(cue.cue, cue.gain, cue.pan);
  sound.pitch = cue.pitch;
  return sound;
}

/** The last beats, known only once Odin has answered: a birth, or a refusal that falls silent and low. */
export function riteEnding(tl: RiteTimeline, refused: boolean): RiteCue[] {
  const w = weight[tl.grade],
    out: RiteCue[] = [];
  const add = (at: number, cue: Cue, gain: number, pitch = 1) =>
    out.push({ at, cue, gain: Math.min(1, gain), pitch, pan: 0 });
  if (refused) {
    add(tl.release, Cue.Fall, 0.6, 0.8);
    add(tl.release + 0.7, Cue.Click, 0.3, 0.45);
    return out;
  }
  if (tl.grade >= OfferingGrade.Bountiful) add(tl.release, Cue.Fall, 0.55 * w);
  add(tl.release, tl.grade >= OfferingGrade.Bountiful ? Cue.Sanctuary : Cue.Mend, 0.65 * w);
  if (tl.grade === OfferingGrade.Kingly) add(tl.join, Cue.Rally, 0.7);
  return out;
}
