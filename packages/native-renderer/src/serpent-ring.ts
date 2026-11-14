// Where Jormungandr lies and when it shows: one closed loop out in deep water round the continent, and the
// parts of its body that break the surface. Derived from the map, the seed, the weather and the clock alone.
import { Weather } from '../../engine/src/climate';
import { point, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { findRealmArea, inArea, type RealmArea } from '../../engine/src/realm-layout';
import { Terrain } from '../../engine/src/world-types';
import type { WorldMap } from '../../engine/src/world-map';

export const serpentRules = {
  /** Tiles of open sea the loop keeps from any land, beach or shoal where the sea is wide enough, and the least
   * it ever keeps where the sea between the land and the map's edge is narrower. */
  clearance: 7,
  least: 4.5,
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
  /** 1 where the loop runs past the map's edge, where the land meets the edge with no sea to hold it. */
  beyond: Uint8Array;
  /** The map's size in tiles, to tell where the loop crosses its edge. */
  width: number;
  height: number;
}
export enum SerpentPartKind {
  Coil,
  /** The neck and head, with the tail rising in front of its jaws: the ring closes in one part. */
  Head,
}
export interface SerpentPart {
  kind: SerpentPartKind;
  /** Loop indices it spans, `from` < `to` (taken round the loop). */
  from: number;
  to: number;
  phase: number;
  /** Runs past the map's edge: drawn cut off by the edge, as if going on beyond it. */
  edge?: boolean;
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
    past: boolean[] = [];
  for (let k = 0; k < rays; ++k) {
    const a = (k / rays) * Math.PI * 2,
      dx = Math.cos(a),
      dy = Math.sin(a),
      at = (t: number) => point(center.x + dx * t, center.y + dy * t);
    let last = 0,
      exit = 0;
    for (let t = 0; t < w + h; t += 0.5) {
      const p = at(t);
      if (p.x < 0 || p.y < 0 || p.x >= w || p.y >= h) break;
      exit = t;
      if (distAt(p) === 0) last = t;
    }
    // The first point that far out to sea; else the widest sea the ray crosses; else past the edge.
    let found = NaN,
      best = -1,
      bestAt = NaN;
    for (let t = last; t < w + h; t += 0.5) {
      const p = at(t);
      if (!inside(p)) break;
      const d = distAt(p);
      if (d >= clearance + 1) {
        found = t;
        break;
      }
      if (d > best) {
        best = d;
        bestAt = t;
      }
    }
    if (Number.isNaN(found) && best >= serpentRules.least + 0.5) found = bestAt;
    past.push(Number.isNaN(found));
    reach.push(Number.isNaN(found) ? exit + 5 : found);
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
    open = new Uint8Array(points.length),
    beyond = new Uint8Array(points.length);
  points.forEach((p, i) => {
    open[i] = inside(p) && distAt(p) >= serpentRules.least && !inArea(gate, p) ? 1 : 0;
    const onMap = p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;
    // The strip of sea by the edge counts, but never close to land or the gate square.
    beyond[i] = !inside(p) && (!onMap || (distAt(p) >= serpentRules.least && !inArea(gate, p))) ? 1 : 0;
  });
  if (past.every(Boolean)) return null;
  return { points, open, beyond, width: w, height: h };
}
/** Coils every few tiles round the loop, and the head with the tail it bites. Where the loop leaves the map,
 * the coil at each side of the gap runs on past the edge. */
export function serpentParts(ring: SerpentRing, seed: number, episode: number): SerpentPart[] {
  const n = ring.points.length,
    { spacing, span } = serpentRules,
    wrap = (i: number) => ((i % n) + n) % n,
    fits = (from: number, to: number) => {
      for (let i = from; i <= to; ++i) if (!ring.open[wrap(i)]) return false;
      return true;
    },
    // Across the edge: every point open sea, the sea by the edge or past it; never near land or the gate.
    runsOff = (from: number, to: number) => {
      for (let i = from; i <= to; ++i) if (!ring.open[wrap(i)] && !ring.beyond[wrap(i)]) return false;
      return true;
    },
    parts: SerpentPart[] = [];
  // The head lies where the loop is open, so the serpent's face is never the part that is missing.
  let head = Math.floor(hash01(seed, episode, 1, 0x5e41) * n);
  for (let tries = 0; tries < n && !fits(head - span, head + span); ++tries) head = (head + 7) % n;
  if (!fits(head - span, head + span)) return parts;
  parts.push({ kind: SerpentPartKind.Head, from: head - span, to: head + span, phase: 0.2 });
  for (let at = head + span + spacing; at + span < head - span + n - spacing / 2; ) {
    if (fits(at, at + span)) parts.push({ kind: SerpentPartKind.Coil, from: at, to: at + span, phase: hash01(seed, episode, at, 0x5e42) });
    at += spacing + Math.floor(hash01(seed, episode, at, 0x5e43) * 5) - 2;
  }
  // A coil at each side of a gap where the loop runs past the edge, so the body goes on out of sight.
  const taken = (from: number, to: number) =>
    parts.some((p) => {
      const a = wrap(p.from) - 2,
        b = a + (p.to - p.from) + 4;
      for (let i = from; i <= to; ++i) {
        const j = wrap(i);
        if ((j >= a && j <= b) || (j + n >= a && j + n <= b)) return true;
      }
      return false;
    });
  // Centred where the loop crosses the edge itself, so the coil is cut by the edge and reads as going on.
  const onMap = (i: number) => {
    const p = ring.points[wrap(i)];
    return p.x >= 0 && p.y >= 0 && p.x < ring.width && p.y < ring.height;
  };
  for (let i = 0; i < n; ++i) {
    if (onMap(i) === onMap(i + 1)) continue;
    for (const d of [0, -1, 1, -2, 2]) {
      const from = i - (span >> 1) + d;
      if (!runsOff(from, from + span) || taken(from, from + span)) continue;
      parts.push({ kind: SerpentPartKind.Coil, from, to: from + span, phase: hash01(seed, episode, from, 0x5e42), edge: true });
      break;
    }
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
