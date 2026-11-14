// A bard plucks a short lyre phrase now and then while idle, strolling or resting in the settlement.
import { Activity, Calling, type Monster, type Person } from './person';
import { distance, type Point } from './geometry';
import { f32, hash01 } from './numeric';
import { auraReach } from './calling-auras';
import { playerFaction } from './faction';
import type { Building } from './town-models';

/** Seconds of each phrase in `sfx/bard/lyre_NN`, in bank order (`scripts/audio/bard_phrases.py --lengths`). */
export const bardPhraseSeconds: readonly number[] = [
  3.827, 3.957, 3.6, 4.1, 3.827, 3.709, 3.767, 4.671, 4.258, 2.35, 4.1, 2.3, 3.891, 4.027,
];
export const bardRules = {
  /** Seconds before a bard who has just become free plays the first phrase. */
  firstWait: [10, 30],
  /** Seconds of quiet after a phrase before the same bard plays again. */
  pause: [40, 90],
  /** A bard waits while another bard this near (in tiles) plays, and a little after. */
  apart: 16,
  afterOther: 3,
  /** No phrase with a monster this near. */
  danger: 10,
  /** Evening at the settlement fire: the night level from which it counts, how near the fire, stress eased. */
  evening: 0.35,
  fireReach: 6,
  calm: 0.03,
} as const;

export interface BardTown {
  time: number;
  folk: Person[];
  map(): { seed(): number };
  climate(): { night: number };
  monsters(): readonly Monster[];
  inRealm(at: Point): boolean;
  settlementOf(p: Person): number;
  camp(id?: number): Building | null;
  raiding(): boolean;
}

// Hands free and nothing pressing: standing about, walking, resting or arriving.
const free = new Set([
  Activity.Idle,
  Activity.Holding,
  Activity.Moving,
  Activity.Relaxing,
  Activity.Arriving,
  Activity.Leaving,
  Activity.Shopping,
  Activity.Brooding,
]);

/** Whether a bard may play now: in the settlement, outdoors, awake, unhurt and with nothing to fight. */
export function mayPlay(town: BardTown, p: Person): boolean {
  if (p.calling !== Calling.Bard || p.health <= 0 || p.downedAt >= 0 || p.inside || p.crossingDoorway())
    return false;
  if (!free.has(p.activity) || p.holding || p.aggressive || p.foe >= 0 || p.stressRecovery) return false;
  if (town.raiding() || town.inRealm(p.position)) return false;
  return !town
    .monsters()
    .some(
      (m) =>
        m.animal === null &&
        m.health > 0 &&
        !m.insideLair &&
        distance(m.position, p.position) <= bardRules.danger,
    );
}

export const playing = (p: Person, time: number): boolean => p.phrase >= 0 && time < p.playingUntil;

/** Starts, keeps and stops every bard's phrases; deterministic from the world seed and the clock. */
export function advanceBards(town: BardTown): void {
  const seed = town.map().seed(),
    now = town.time,
    tick = Math.trunc(now * 10);
  for (const p of town.folk) {
    if (p.calling !== Calling.Bard) continue;
    if (!mayPlay(town, p)) {
      if (playing(p, now)) p.playingUntil = now;
      p.phraseDue = -1;
      continue;
    }
    if (playing(p, now)) {
      continue;
    }
    const roll = (salt: number) => hash01(seed, p.id, tick, salt);
    if (p.phraseDue < 0) {
      const [low, high] = bardRules.firstWait;
      p.phraseDue = now + low + (high - low) * roll(0xb1);
      continue;
    }
    if (now < p.phraseDue) continue;
    let heard = -1,
      heardAt = -1,
      busy = false;
    for (const other of town.folk)
      if (
        other !== p &&
        other.calling === Calling.Bard &&
        other.phrase >= 0 &&
        distance(other.position, p.position) <= bardRules.apart
      ) {
        if (now < other.playingUntil + bardRules.afterOther) busy = true;
        if (other.phraseAt > heardAt) {
          heard = other.phrase;
          heardAt = other.phraseAt;
        }
      }
    if (busy) {
      p.phraseDue = now + 2 + 4 * roll(0xb2);
      continue;
    }
    const count = bardPhraseSeconds.length;
    let phrase = Math.trunc(roll(0xb3) * count) % count;
    while (phrase === p.phrase || phrase === heard) phrase = (phrase + 1) % count;
    p.phrase = phrase;
    p.phraseAt = now;
    p.playingUntil = now + bardPhraseSeconds[phrase];
    const [low, high] = bardRules.pause;
    p.phraseDue = p.playingUntil + low + (high - low) * roll(0xb4);
    soothe(town, p);
  }
}

/** An evening phrase by the settlement fire eases the residents who hear it. */
function soothe(town: BardTown, bard: Person): void {
  if (town.climate().night < bardRules.evening) return;
  const fire = town.camp(town.settlementOf(bard));
  if (!fire?.built() || distance(fire.center, bard.position) > bardRules.fireReach) return;
  for (const p of town.folk)
    if (
      p.faction === playerFaction &&
      p.health > 0 &&
      !p.inside &&
      distance(p.position, bard.position) <= auraReach
    )
      p.stress = Math.max(0, f32(p.stress - f32(bardRules.calm)));
}
