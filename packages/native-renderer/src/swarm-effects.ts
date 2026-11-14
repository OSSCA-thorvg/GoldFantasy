// The brood's moments: a swarmer's small fall, a newcomer climbing out of its den, a den's collapse, and the
// whole floor's brood breaking at once. Offsets are screen pixels from the ground point of the cue.
import { Tier } from './combat-depth';
import {
  appendCloud,
  appendRock,
  appendShard,
  dust,
  flat,
  inTier,
  jitter,
  piece,
  shards,
  tone,
  waveFronts,
  type Piece,
} from './combat-paint';

/** A monster's fall: a low puff and a few dark chips on the ground. The body itself is the rig's. */
export function killBurst(seed: number): Piece[] {
  return [
    piece(appendCloud(flat(tone.brown), 6.5, 3.4, 4, seed), { vy: -2, life: 0.4, end: 1.35, size: 0.75 }),
    piece(appendCloud(flat(tone.sand), 4.6, 2.5, 3, seed + 1), {
      x: 1.5,
      y: -1,
      vy: -3,
      delay: 0.03,
      life: 0.34,
      end: 1.3,
      size: 0.75,
    }),
    ...shards(seed, 3, -Math.PI / 2, 2.8, 10, [tone.ink, tone.ochre, tone.ink]).map((p) => ({ ...p, fall: 12 })),
  ];
}

/** Dirt thrown up as a monster climbs out of its den. */
export function spawnPuff(seed: number): Piece[] {
  const out = dust(seed, 7).map((p) => ({ ...p, vy: p.vy - 5, life: p.life * 0.75 }));
  for (let i = 0; i < 4; i++) {
    const j = jitter(seed, i + 5) - 0.5;
    out.push(
      piece(appendRock(flat(i % 2 ? tone.sand : tone.brown), 1.8, seed + i), {
        x: j * 6,
        vx: j * 22,
        vy: -12 - jitter(seed, i + 9) * 6,
        fall: 18,
        spin: j * 6,
        delay: 0.02 + i * 0.02,
        life: 0.42,
        end: 0.6,
      }),
    );
  }
  return out;
}

/** A den caving in: its mound sinks into heavy dust while rocks and shards fly. Clearly bigger than a kill. */
export function denCollapse(seed: number): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 11;
    out.push(
      piece(appendCloud(flat(tone.brown), 13 - Math.abs(i - 1) * 3, 11 - Math.abs(i - 1) * 2, 4, seed + i), {
        x,
        y: 1,
        vx: (i - 1) * 12,
        vy: -16 + Math.abs(i - 1) * 6,
        delay: 0.05 + i * 0.03,
        life: 1,
        end: 1.4,
      }),
      piece(appendCloud(flat(tone.sand), 8, 7, 3, seed + i + 9), {
        x: x + 3,
        y: -4,
        vx: (i - 1) * 12,
        vy: -20 + Math.abs(i - 1) * 6,
        delay: 0.09 + i * 0.03,
        life: 0.9,
        end: 1.35,
      }),
    );
  }
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (jitter(seed, i + 20) - 0.5) * 2.6,
      size = 3.4 + jitter(seed, i + 30) * 3;
    out.push(
      piece(appendRock(flat(i % 3 ? tone.brown : tone.sand), size, seed + i + 40), {
        x: (jitter(seed, i + 50) - 0.5) * 14,
        y: -4,
        vx: Math.cos(a) * 40,
        vy: Math.sin(a) * 34,
        fall: 46,
        spin: (jitter(seed, i + 60) - 0.5) * 4,
        delay: 0.02 + i * 0.012,
        life: 0.8,
        end: 0.55,
      }),
    );
  }
  out.push(
    ...shards(seed, 5, -Math.PI / 2, 2.4, 22, [tone.ochre, tone.rust, tone.ochre]),
    ...inTier(Tier.Ground, waveFronts(seed, 34, 17, [0.6, 1], 4, 3.4, tone.brown, tone.sand, 0.1, 0.5)),
  );
  return out;
}

/** The floor giving way under the brood: rings of earth rolling out from the last den across `rx` pixels,
 * with dark shards lifting off along the outermost. */
export function broodBreak(seed: number, rx: number): Piece[] {
  const ry = rx / 2,
    out = waveFronts(seed, rx, ry, [0.12, 0.3, 0.5, 0.72, 1], 6, 10, tone.brown, tone.sand, 0.16, 0.5);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + jitter(seed, i + 70) * 0.4;
    out.push(
      piece(appendShard(flat(i % 3 ? tone.ink : tone.ochre), 4, seed + i), {
        x: Math.cos(a) * rx * 0.85,
        y: Math.sin(a) * ry * 0.85,
        vx: Math.cos(a) * rx * 0.12,
        vy: -16,
        angle: -Math.PI / 2,
        spin: (jitter(seed, i + 80) - 0.5) * 3,
        delay: 0.55 + jitter(seed, i + 90) * 0.15,
        life: 0.55,
        end: 0.4,
      }),
    );
  }
  return out;
}
