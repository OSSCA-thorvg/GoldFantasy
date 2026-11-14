// The ordinary blow by weapon: one sweep per cleave, a heavy crush, a pierce that carries on, a small splash.
// Offsets are screen pixels from the effect's anchor; each builder returns the pieces of one swing.
import type { Rgb } from './paint';
import { Tier } from './combat-depth';
import {
  appendCloud,
  appendRock,
  appendStar,
  appendStreak,
  appendTaperArc,
  flat,
  inTier,
  jitter,
  piece,
  shardRing,
  shards,
  tone,
  type Piece,
} from './combat-paint';

export interface Offset {
  x: number;
  y: number;
}
/** Iso squash of a sweep drawn round a standing figure. */
const squash = 0.6;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** One arc from the attacker (the anchor) across every enemy the swing caught, the first being the target. */
export function cleave(seed: number, targets: readonly Offset[], crit: boolean): Piece[] {
  const rel = targets.map((t) => ({ a: Math.atan2(t.y / squash, t.x), r: Math.hypot(t.x, t.y / squash) })),
    aim = rel[0]?.a ?? 0;
  let lo = 0,
    hi = 0;
  for (const t of rel) {
    const d = wrap(t.a - aim);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  lo -= 0.5;
  hi += 0.5;
  if (hi - lo < 1.7) {
    const grow = (1.7 - (hi - lo)) / 2;
    lo -= grow;
    hi += grow;
  }
  const r = Math.max(16, Math.min(40, Math.max(...rel.map((t) => t.r)) + 3)),
    big = crit ? 1.3 : 1,
    width = (3.6 + r * 0.1) * big,
    // Thin at the start of the sweep, thickest where it ends.
    envelope = [0.55, 0.85, 1],
    backhand = seed % 2 === 1,
    span = hi - lo,
    out: Piece[] = [];
  for (let j = 0; j < 3; j++) {
    const order = backhand ? 2 - j : j,
      a0 = aim + lo + (span * j) / 3 - 0.05,
      a1 = aim + lo + (span * (j + 1)) / 3 + 0.05,
      mid = (a0 + a1) / 2,
      w = width * envelope[order],
      drift = { vx: Math.cos(mid) * 5, vy: Math.sin(mid) * 5 * squash, end: 0.7 },
      outer = r + w * 0.95;
    out.push(
      piece(appendTaperArc(flat(tone.sage), outer, outer * squash, a0 + 0.12, a1 - 0.04, w * 0.45, 0.4, 0.4), {
        ...drift,
        reach: outer + w,
        delay: order * 0.028 + 0.02,
        life: 0.26,
      }),
      piece(appendTaperArc(flat(tone.teal), r, r * squash, a0, a1, w, 0.4, 0.4), {
        ...drift,
        reach: r + w,
        delay: order * 0.028,
        life: 0.3,
      }),
    );
  }
  targets.forEach((t, i) =>
    out.push(
      ...shards(seed + i * 7, crit && i === 0 ? 4 : 2, Math.atan2(t.y, t.x), 1.3, crit ? 14 : 10, [tone.ochre, tone.rust], t),
    ),
  );
  return out;
}

/** A short heavy impact on the target (the anchor, `lift` above its feet): a dark star, dust round the feet,
 * a few chips thrown up. */
export function crush(seed: number, lift: number, crit: boolean): Piece[] {
  const big = crit ? 1.3 : 1,
    out: Piece[] = [
      piece(appendStar(flat(tone.brown), 8.5 * big, 9, seed), {
        angle: jitter(seed, 1),
        life: 0.22,
        end: 0.45,
      }),
      piece(appendStar(flat(tone.sand), 4.6 * big, 5, seed + 1, 0.5), {
        x: -1,
        y: -1.4,
        angle: jitter(seed, 2),
        delay: 0.01,
        life: 0.15,
        end: 0.3,
      }),
    ];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4 + jitter(seed, i + 3) * 0.6,
      c = Math.cos(a),
      s = Math.sin(a);
    out.push(
      piece(appendCloud(flat(i % 2 ? tone.sand : tone.brown), 5, 3, 3, seed + i), {
        x: c * 8,
        y: lift + s * 4,
        vx: c * 11,
        vy: s * 5 - 2,
        delay: 0.03,
        life: 0.45,
        end: 1.25,
        size: 0.75,
        tier: Tier.Ground,
      }),
    );
  }
  for (let i = 0; i < 3; i++) {
    const j = jitter(seed, i + 9) - 0.5;
    out.push(
      piece(appendRock(flat(i ? tone.brown : tone.sand), 2.2, seed + i), {
        x: j * 6,
        y: lift,
        vx: j * 18,
        vy: -13 - jitter(seed, i + 12) * 5,
        fall: 20,
        spin: j * 5,
        delay: 0.02,
        life: 0.42,
        end: 0.6,
      }),
    );
  }
  out.push(...shards(seed, crit ? 4 : 2, -Math.PI / 2, 2, 11, [tone.ochre, tone.sand]));
  return out;
}

/** A streak from the attacker through every enemy it passed, carrying on past the last (the anchor).
 * `path` holds the attacker's offset first, then each target's. */
export function pierce(seed: number, path: readonly Offset[], crit: boolean): Piece[] {
  const from = path[0],
    angle = Math.atan2(-from.y, -from.x || 1e-6),
    head = { x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 },
    entry = path[1] ?? { x: 0, y: 0 },
    // From a little before the first enemy, through every one, to just past the last.
    length = Math.min(Math.hypot(from.x, from.y) + 10, Math.hypot(entry.x, entry.y) + 50),
    big = crit ? 1.3 : 1,
    flight = { ...head, angle, end: 0.2, thin: 0.4, reach: length },
    out: Piece[] = [
      piece(appendStreak(flat(tone.olive), length, 4 * big), { ...flight, life: 0.2 }),
      piece(appendStreak(flat(tone.ochre), length * 0.9, 2.3 * big), { ...flight, delay: 0.01, life: 0.18 }),
      piece(appendStreak(flat(tone.peach), 9, 1.5 * big), { ...flight, life: 0.12 }),
    ];
  path.slice(1).forEach((t, i) => {
    out.push(
      piece(appendCloud(flat(tone.sand), 3.6, 2.2, 3, seed + i), {
        x: t.x,
        y: t.y,
        vy: -4,
        delay: 0.04 + i * 0.02,
        life: 0.35,
        end: 1.3,
      }),
      // Exit shards fly on along the shot.
      ...shards(seed + i * 5, 2, angle, 0.8, 11, [tone.ochre, tone.sand], t),
    );
  });
  return out;
}

/** A bolt that bursts on its target (the anchor): a short streak in, a star, and shards running out across
 * the ground to the splash's true reach. */
export function splash(
  seed: number,
  from: Offset,
  lift: number,
  reach: { rx: number },
  crit: boolean,
): Piece[] {
  const angle = Math.atan2(-from.y, -from.x || 1e-6),
    length = Math.min(40, Math.hypot(from.x, from.y)),
    big = crit ? 1.3 : 1,
    main: Rgb = tone.teal,
    out: Piece[] = [
      piece(appendStreak(flat(main), length, 2.6), { angle, life: 0.1, end: 0.2, thin: 0.4, reach: length }),
      piece(appendStar(flat(tone.sage), 9 * big, 7, seed + 3, 0.5), {
        x: 1.2,
        y: 0.8,
        angle: jitter(seed, 4),
        delay: 0.03,
        life: 0.26,
        end: 0.4,
      }),
      piece(appendStar(flat(main), 7 * big, 9, seed), { angle: jitter(seed, 5), delay: 0.02, life: 0.24, end: 0.4 }),
    ],
    ground = shardRing(seed, 6, reach.rx * 0.35, reach.rx * 0.65, main, tone.ochre, 0.04, tone.sage);
  for (const p of ground) p.y += lift;
  out.push(...inTier(Tier.Ground, ground));
  return out;
}
