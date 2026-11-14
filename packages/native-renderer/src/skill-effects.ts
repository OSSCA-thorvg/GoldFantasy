// One-shot skill effects, one silhouette per skill: the challenge's horns, the whirl's full turn, falling
// arrows, the dirge's dark wave. Lasting ground areas live in skill-fields.ts, the Rune Burst's circle in
// ground-telegraphs.ts. Offsets are screen pixels from the effect's anchor.
import type { Rgb } from './paint';
import { Tier } from './combat-depth';
import {
  appendCloud,
  appendShard,
  appendStreak,
  appendTaperArc,
  chevrons,
  flat,
  inTier,
  jitter,
  motes,
  piece,
  shardRing,
  shards,
  tone,
  waveFronts,
  type Piece,
} from './combat-paint';

/** A war cry: shards ringing out from the feet and two horns rising over the head. */
export function challenge(seed: number): Piece[] {
  const horns = [-1, 1].flatMap((side) => {
    const angle = -Math.PI / 2 + side * 0.38,
      at = { x: side * 4, y: -24, angle, vx: side * 3, vy: -8, life: 0.62, end: 0.7 };
    return [
      piece(appendShard(flat(tone.ink), 9, seed + side), at),
      piece(appendShard(flat(tone.rust), 7, seed + side + 3), { ...at, x: at.x + side * 0.6, y: at.y - 0.8, delay: 0.02 }),
    ];
  });
  return [...inTier(Tier.Ground, shardRing(seed, 12, 7, 34, tone.ochre, tone.rust)), ...inTier(Tier.Overhead, horns)];
}

/** A full turn of the blade round the warrior at the whirl's true reach, after a short gathering sketch.
 * `delay` is the skill's wind-up; the anchor is the warrior's feet. */
export function whirl(seed: number, rx: number, ry: number, delay: number): Piece[] {
  const hip = -6,
    start = Math.max(0, delay - 0.04),
    quarterFoot = (j: number) => {
      const mid = ((j + 0.5) * Math.PI) / 2;
      return { x: Math.cos(mid) * rx * 0.8, y: Math.sin(mid) * ry * 0.8 };
    },
    out: Piece[] = [
      // Anticipation: a thin sketch of the turn, close in, while the blade is drawn back.
      piece(appendTaperArc(flat(tone.sage), rx * 0.35, ry * 0.35, -0.6, 2.6, 2.2, 0.5, 0.3), {
        y: hip,
        life: start + 0.05,
        end: 0.8,
        size: 0.9,
        tier: Tier.Body,
        reach: rx * 0.4,
      }),
    ];
  for (let j = 0; j < 4; j++) {
    // A slight spiral, so the turn reads as one stroke rather than a ring.
    const r = 0.9 + j * 0.035,
      a0 = (j * Math.PI) / 2 - 0.1,
      a1 = ((j + 1) * Math.PI) / 2 + 0.12,
      mid = (a0 + a1) / 2,
      w = 4.5 + j * 0.9,
      // Each quarter of the turn stands where it passes over the ground, so the back half goes behind the
      // warrior and whoever stands near the rim, the front half in front of them.
      foot = quarterFoot(j),
      timing = {
        tier: Tier.Standing,
        foot,
        reach: rx * r + w,
        y: hip,
        vx: Math.cos(mid) * 6,
        vy: Math.sin(mid) * 3,
        delay: start + j * 0.032,
        end: 0.75,
      };
    out.push(
      piece(appendTaperArc(flat(tone.sage), rx * r + w, ry * r + w * 0.5, a0 + 0.14, a1 - 0.05, w * 0.42, 0.45, 0.3), {
        ...timing,
        delay: timing.delay + 0.02,
        life: 0.3,
      }),
      piece(appendTaperArc(flat(tone.teal), rx * r, ry * r, a0, a1, w, 0.55, 0.25), { ...timing, life: 0.34 }),
    );
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + jitter(seed, i),
      rim = { x: Math.cos(a) * rx, y: hip + Math.sin(a) * ry },
      quarter = Math.floor((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2));
    // Flung along the turn, not straight out; each rides with its quarter of the turn.
    out.push(
      ...shards(seed + i * 3, 1, a + Math.PI / 2, 0.5, 14, [i % 2 ? tone.rust : tone.ochre], rim).map((p) => ({
        ...p,
        delay: p.delay + start + 0.06,
        tier: Tier.Standing,
        foot: quarterFoot(quarter),
      })),
    );
  }
  return out;
}

/** Arrows falling into the volley's circle (the anchor), each kicking up dust where it lands. */
export function volleyRain(seed: number, rx: number, ry: number): Piece[] {
  const out: Piece[] = [],
    count = 9;
  for (let i = 0; i < count; i++) {
    const reach = Math.sqrt(jitter(seed, i)) * 0.85,
      a = jitter(seed, i + 20) * Math.PI * 2,
      x = Math.cos(a) * rx * reach,
      y = Math.sin(a) * ry * reach,
      angle = Math.PI / 2 + (jitter(seed, i + 40) - 0.5) * 0.5,
      fall = 52,
      flight = {
        x: x - Math.cos(angle) * fall,
        y: y - Math.sin(angle) * fall,
        vx: Math.cos(angle) * fall,
        vy: Math.sin(angle) * fall,
        angle,
        delay: i * 0.035,
        life: 0.2,
        end: 0.9,
        reach: 30,
        // Each arrow and its dust stand where it lands, among the units.
        tier: Tier.Standing,
        foot: { x, y },
      };
    out.push(
      piece(appendStreak(flat(tone.brown), 21, 3.2), flight),
      piece(appendStreak(flat(tone.ochre), 15, 1.4), { ...flight, life: 0.19 }),
      piece(appendCloud(flat(i % 2 ? tone.sand : tone.brown), 5.5, 3.2, 3, seed + i), {
        x,
        y,
        vy: -3,
        delay: i * 0.035 + 0.15,
        life: 0.4,
        end: 1.3,
        size: 0.8,
        tier: Tier.Standing,
        foot: { x, y },
      }),
    );
  }
  out.push(
    ...shards(seed, 4, -Math.PI / 2, 2.6, 12, [tone.ochre, tone.sand]).map((p) => ({
      ...p,
      delay: p.delay + 0.12,
      tier: Tier.Standing,
    })),
  );
  return out;
}

/** The Bard's Dirge: a dark wave rolling out across the ground to the song's true reach. */
export function dirgeWave(seed: number, rx: number, ry: number): Piece[] {
  return waveFronts(seed, rx, ry, [0.25, 0.5, 0.75, 1], 5, 6, tone.dusk, tone.brown, 0.13, 0.5);
}
/** Frost biting into the ground as the ring lands: two quick fronts out to its true reach. */
export function frostBite(seed: number, rx: number, ry: number): Piece[] {
  return waveFronts(seed, rx, ry, [0.55, 1], 6, 4, tone.teal, tone.rime, 0.07, 0.32);
}
/** The hallowing spreading out slowly as the cleric kneels. */
export function sanctuaryBloom(seed: number, rx: number, ry: number): Piece[] {
  return waveFronts(seed, rx, ry, [0.5, 1], 6, 3.4, tone.sage, tone.leaf, 0.22, 0.7);
}

export function aimMark(): Piece[] {
  return inTier(Tier.Overhead, chevrons(tone.teal, 1));
}
export function castRing(seed: number): Piece[] {
  return shardRing(seed, 6, 3, 10, tone.teal, tone.sage);
}
export function mendCast(seed: number): Piece[] {
  return motes(seed, 3, [tone.leaf, tone.sage], 12);
}
/** The Rallying Verse: flat notes rising round the bard. */
export function verse(seed: number): Piece[] {
  return Array.from({ length: 5 }, (_, i) => {
    const color: Rgb = i % 2 ? tone.ochre : tone.sage,
      node = flat(color),
      a = (i / 5) * Math.PI * 2;
    // A flat note: an oval head and a tapered flag.
    node.appendCircle(0, 0, 1.9, 1.4);
    node.moveTo(1.3, -0.4).lineTo(1.9, -7).lineTo(4.2, -4.6).lineTo(1.9, -5.4).lineTo(1.9, -0.2).close();
    return piece(node, {
      x: Math.cos(a) * 9,
      y: Math.sin(a) * 4 - 8,
      vx: Math.cos(a + 1) * 6,
      vy: -14 - jitter(seed, i) * 6,
      angle: (jitter(seed, i + 5) - 0.5) * 0.6,
      spin: (jitter(seed, i + 6) - 0.5) * 1.5,
      delay: i * 0.1,
      life: 1.2,
      end: 0.7,
    });
  });
}
