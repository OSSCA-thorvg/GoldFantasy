// Where Jormungandr lies and when it shows: one closed loop out in deep water round the continent, and the
// parts of its body that break the surface. Derived from the map, the seed, the weather and the clock alone.
import { Weather } from '../../engine/src/climate';
import { point, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { findRealmArea, inArea, type RealmArea } from '../../engine/src/realm-layout';
import { Terrain } from '../../engine/src/world-types';
import type { WorldMap } from '../../engine/src/world-map';

export const serpentRules = {
  /** Least tiles of open sea between the body and any land, beach or shoal. */
  clearance: 7,
  /** Tiles kept clear of the map's edge and round the square where a world beyond a gate rises. */
  edge: 3,
  gateMargin: 5,
  /** Tiles of loop between coils, and the length of loop a coil spans. */
  spacing: 12,
  span: 5,
  /** Chance a spell of rain, or of thunderstorm, brings the serpent up. */
  rain: 0.35,
  storm: 0.85,
  /** Tiles from one swell to the next along the loop, and how fast a swell runs along it, in tiles a second. */
  swell: 48,
  swellPace: 1.5,
};
export interface SerpentRing {
  /** The loop, one point a tile apart, closed (the last joins the first). */
  points: Point[];
  /** 1 where the body may break the surface. */
  open: Uint8Array;
}
export enum SerpentPartKind {
  Coil,
  Head,
  Tail,
}
export interface SerpentPart {
  kind: SerpentPartKind;
  /** Loop indices it spans, `from` < `to` (taken round the loop). */
  from: number;
  to: number;
  phase: number;
}
const rings = new WeakMap<WorldMap, { key: string; ring: SerpentRing | null }>();
/** Tiles to the nearest land, counting the gate square as open sea (a raised world beyond a gate is no coast). */
function seaDistance(map: WorldMap, realm: RealmArea | null): Float32Array {
  const w = map.width(),
    h = map.height(),
    d = new Float32Array(w * h);
  for (let y = 0; y < h; ++y)
    for (let x = 0; x < w; ++x)
      d[y * w + x] = map.at(x, y).terrain === Terrain.Sea || inArea(realm, point(x + 0.5, y + 0.5)) ? 1e6 : 0;
  const diagonal = Math.SQRT2,
    relax = (i: number, j: number, cost: number) => {
      if (d[j] + cost < d[i]) d[i] = d[j] + cost;
    };
  for (let y = 0; y < h; ++y)
    for (let x = 0; x < w; ++x) {
      const i = y * w + x;
      if (x) relax(i, i - 1, 1);
      if (y) relax(i, i - w, 1);
      if (x && y) relax(i, i - w - 1, diagonal);
      if (y && x < w - 1) relax(i, i - w + 1, diagonal);
    }
  for (let y = h - 1; y >= 0; --y)
    for (let x = w - 1; x >= 0; --x) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, 1);
      if (y < h - 1) relax(i, i + w, 1);
      if (x < w - 1 && y < h - 1) relax(i, i + w + 1, diagonal);
      if (y < h - 1 && x) relax(i, i + w - 1, diagonal);
    }
  return d;
}
/** The serpent's loop on this map, or null when the sea round the land is too narrow to hold it. */
export function serpentRing(map: WorldMap, realm: RealmArea | null = findRealmArea(map)): SerpentRing | null {
  const w = map.width(),
    h = map.height(),
    key = `${map.seed()}:${w}:${h}:${realm ? `${realm.x},${realm.y},${realm.size}` : '-'}`,
    cached = rings.get(map);
  if (cached?.key === key) return cached.ring;
  const ring = traceRing(map, realm);
  rings.set(map, { key, ring });
  return ring;
}
function traceRing(map: WorldMap, realm: RealmArea | null): SerpentRing | null {
  const w = map.width(),
    h = map.height();
  if (w < 32 || h < 32) return null;
  const sea = seaDistance(map, realm),
    { clearance, edge, gateMargin } = serpentRules,
    distAt = (p: Point) => {
      const x = Math.floor(p.x),
        y = Math.floor(p.y);
      return x < 0 || y < 0 || x >= w || y >= h ? 1e6 : sea[y * w + x];
    },
    inside = (p: Point) => p.x >= edge && p.y >= edge && p.x <= w - edge && p.y <= h - edge;
  let cx = 0,
    cy = 0,
    count = 0;
  for (let y = 0; y < h; ++y)
    for (let x = 0; x < w; ++x)
      if (sea[y * w + x] === 0) {
        cx += x + 0.5;
        cy += y + 0.5;
        ++count;
      }
  if (!count) return null;
  const center = point(cx / count, cy / count),
    rays = 180,
    reach: number[] = [],
    valid: boolean[] = [];
  for (let k = 0; k < rays; ++k) {
    const a = (k / rays) * Math.PI * 2,
      dx = Math.cos(a),
      dy = Math.sin(a);
    let last = 0,
      found = NaN;
    for (let t = 0; t < w + h; t += 0.5) {
      const p = point(center.x + dx * t, center.y + dy * t);
      if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) break;
      if (distAt(p) === 0) last = t;
    }
    for (let t = last; t < w + h; t += 0.5) {
      const p = point(center.x + dx * t, center.y + dy * t);
      if (!inside(p)) break;
      if (distAt(p) >= clearance + 1) {
        found = t;
        break;
      }
    }
    valid.push(!Number.isNaN(found));
    reach.push(found);
  }
  if (valid.filter(Boolean).length < rays / 3) return null;
  // Gaps take the reach of the rays on either side, so the loop stays whole; no part surfaces there.
  for (let k = 0; k < rays; ++k) {
    if (valid[k]) continue;
    let back = 1,
      ahead = 1;
    while (!valid[(k - back + rays) % rays]) ++back;
    while (!valid[(k + ahead) % rays]) ++ahead;
    const a = reach[(k - back + rays) % rays],
      b = reach[(k + ahead) % rays];
    reach[k] = a + ((b - a) * back) / (back + ahead);
  }
  // Smoothed outward only, so a headland never pulls the loop in toward its shore.
  const smooth = reach.map((r, k) => {
    let sum = 0;
    for (let j = -4; j <= 4; ++j) sum += reach[(k + j + rays) % rays];
    return Math.max(r, sum / 9);
  });
  const corners = smooth.map((r, k) => {
    const a = (k / rays) * Math.PI * 2;
    return point(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r);
  });
  // Resampled a tile apart along the loop.
  const points: Point[] = [];
  let carry = 0;
  for (let k = 0; k < rays; ++k) {
    const a = corners[k],
      b = corners[(k + 1) % rays],
      span = Math.hypot(b.x - a.x, b.y - a.y);
    let t = carry;
    while (t < span) {
      points.push(point(a.x + ((b.x - a.x) * t) / span, a.y + ((b.y - a.y) * t) / span));
      t += 1;
    }
    carry = t - span;
  }
  const gate = realm
      ? { x: realm.x - gateMargin, y: realm.y - gateMargin, size: realm.size + gateMargin * 2 }
      : null,
    open = new Uint8Array(points.length);
  points.forEach((p, i) => {
    const k = Math.round((Math.atan2(p.y - center.y, p.x - center.x) / (Math.PI * 2)) * rays + rays) % rays;
    open[i] = valid[k] && inside(p) && distAt(p) >= clearance && !inArea(gate, p) ? 1 : 0;
  });
  return { points, open };
}
/** Coils every few tiles round the loop, with the head and, in front of its jaws, the tail it bites. */
export function serpentParts(ring: SerpentRing, seed: number, episode: number): SerpentPart[] {
  const n = ring.points.length,
    { spacing, span } = serpentRules,
    fits = (from: number, to: number) => {
      for (let i = from; i <= to; ++i) if (!ring.open[((i % n) + n) % n]) return false;
      return true;
    },
    parts: SerpentPart[] = [];
  // The head lies where the loop is open, so the serpent's face is never the part that is missing.
  let head = Math.floor(hash01(seed, episode, 1, 0x5e41) * n);
  for (let tries = 0; tries < n && !fits(head - span, head + span + 2); ++tries) head = (head + 7) % n;
  if (fits(head - span, head)) parts.push({ kind: SerpentPartKind.Head, from: head - span, to: head, phase: 0.2 });
  if (fits(head + 2, head + 2 + span)) parts.push({ kind: SerpentPartKind.Tail, from: head + 2, to: head + 2 + span, phase: 0.65 });
  for (let at = head + 2 + span + spacing; at + span < head - span + n - spacing / 2; ) {
    if (fits(at, at + span))
      parts.push({ kind: SerpentPartKind.Coil, from: at, to: at + span, phase: hash01(seed, episode, at, 0x5e42) });
    at += spacing + Math.floor(hash01(seed, episode, at, 0x5e43) * 5) - 2;
  }
  return parts;
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Names one spell of rain or storm: the sky's peak strength is drawn afresh for each. */
export const weatherSpell = (peak: number): number => Math.trunc(peak * 1e6);
/** How far the serpent has risen in this weather, 0..1: never in clear, cloudy or snowy skies. */
export function serpentEmergence(seed: number, weather: Weather, intensity: number, spell: number): number {
  const chance = weather === Weather.Storm ? serpentRules.storm : weather === Weather.Rain ? serpentRules.rain : 0;
  if (!chance || hash01(seed, spell, 0, 0x5e44) >= chance) return 0;
  return smoothstep(0.2, 0.55, intensity);
}
/** How far one part is up, 0..1, as swells run slowly round the loop. */
export function partRise(part: SerpentPart, ring: SerpentRing, emergence: number, clock: number): number {
  if (emergence <= 0) return 0;
  const { swell, swellPace } = serpentRules,
    along = (part.from + part.to) / 2,
    // One coherent swell running along the body: each part rises as the one behind it sinks.
    wave = Math.sin(((clock * swellPace - along) / swell + part.phase * 0.1) * Math.PI * 2),
    // The head keeps above water more often than a coil.
    lift = part.kind === SerpentPartKind.Head ? 0.35 : 0;
  return emergence * smoothstep(-0.3, 0.6, wave + lift);
}
/** Ground point in the middle of a part, for culling and the guide. */
export function partMiddle(part: SerpentPart, ring: SerpentRing): Point {
  const n = ring.points.length;
  return ring.points[(((part.from + part.to) >> 1) % n + n) % n];
}
/** What a serpent sighting reads from the game. */
export interface SerpentWorld {
  map(): WorldMap;
  realmArea: RealmArea | null;
  climate(): { weather: Weather; intensity: number };
  weather(): { snapshot(): { peak: number } };
  clock(): number;
}
/** A part of the serpent well above water where the player can see it, or null. */
export function serpentSighting(town: SerpentWorld, seen: (at: Point) => boolean): Point | null {
  const climate = town.climate();
  if (climate.weather !== Weather.Rain && climate.weather !== Weather.Storm) return null;
  const map = town.map(),
    spell = weatherSpell(town.weather().snapshot().peak),
    emergence = serpentEmergence(map.seed(), climate.weather, climate.intensity, spell);
  if (emergence < 0.5) return null;
  const ring = serpentRing(map, town.realmArea ?? findRealmArea(map));
  if (!ring) return null;
  for (const part of serpentParts(ring, map.seed(), spell)) {
    const at = partMiddle(part, ring);
    if (partRise(part, ring, emergence, town.clock()) > 0.5 && map.revealed(at) && seen(at)) return at;
  }
  return null;
}
