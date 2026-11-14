// Ground circles that fill before an area blow lands, and the eruption when it does.
import { distance, project, unproject, type Point } from '../../engine/src/geometry';
import { boxAt, DepthSlot, type Extent } from './combat-depth';
import { CombatCue, type CombatEvent } from '../../engine/src/combat-events';
import type { Town } from '../../engine/src/town';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import {
  skillOfCue,
  appendArc,
  appendCloud,
  appendRock,
  appendShard,
  cuesOf,
  ease,
  extentOf,
  groundRadii,
  jitter,
  onView,
  piece,
  posePiece,
  tone,
  unit,
  type Piece,
} from './combat-paint';
import type { WorldRendererState } from './world-renderer-state';

export enum MarkKind {
  /** A monster's telegraphed blow: the one reserved danger colour. */
  Danger,
  /** The Mage's Rune Burst. */
  Rune,
}
export interface Mark {
  kind: MarkKind;
  at: number;
  duration: number;
  center: Point;
  radius: number;
  creature: number;
  /** Set once the monster was seen winding up, so a later stop means the blow was broken. */
  wound?: boolean;
  node: SceneNode;
  fill: ShapeNode;
}
export interface Burst {
  at: number;
  center: Point;
  /** Rocks and shards stand up from the ground: one depth-sorted node per sector of the circle. */
  sectors: { slot: DepthSlot; pieces: Piece[]; foot: { x: number; y: number }; extent: Extent }[];
  pieces: Piece[];
  life: number;
}
const sectorCount = 6;
interface MarkState {
  town: Town;
  next: bigint;
  marks: Mark[];
  bursts: Burst[];
}
const maxMarks = 12;
/** A mark that ran out without its blow lingers this long, fading. */
const linger = 0.35;
const states = new WeakMap<WorldRendererState, MarkState>();

export function telegraphsOf(s: WorldRendererState): { marks: readonly Mark[]; bursts: readonly Burst[] } {
  const state = states.get(s);
  return { marks: state?.marks ?? [], bursts: state?.bursts ?? [] };
}
/** How far a mark has filled, 0..1. */
export const markProgress = (mark: Mark, now: number) => unit((now - mark.at) / mark.duration);

function colorOf(kind: MarkKind): Rgb {
  return kind === MarkKind.Danger ? tone.rust : tone.teal;
}
function mark(kind: MarkKind, event: CombatEvent, duration: number): Mark {
  const { rx, ry } = groundRadii(event.radius),
    color = colorOf(kind),
    node = new SceneNode(),
    area = new ShapeNode().appendCircle(0, 0, rx, ry).fill(...color, 60),
    fill = new ShapeNode().appendCircle(0, 0, rx, ry).fill(...color, 105),
    rim = appendArc(new ShapeNode(), 0, 0, rx, ry, Math.min(3, rx * 0.08), 0, 1).fill(...color, 225);
  // Inward notches on the rim, like teeth of the coming blow.
  const teeth = new ShapeNode();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2,
      c = Math.cos(a),
      s = Math.sin(a),
      side = 0.07;
    teeth
      .moveTo(Math.cos(a - side) * rx, Math.sin(a - side) * ry)
      .lineTo(c * rx * 0.86, s * ry * 0.86)
      .lineTo(Math.cos(a + side) * rx, Math.sin(a + side) * ry)
      .close();
  }
  teeth.fill(...color, 225);
  node.add(area).add(fill).add(rim).add(teeth);
  return {
    kind,
    at: event.at,
    duration,
    center: { ...event.position },
    radius: event.radius,
    creature: event.creature,
    node,
    fill,
  };
}
function eruption(kind: MarkKind, center: Point, radius: number, at: number, seed: number): Burst {
  const { rx, ry } = groundRadii(radius),
    pieces: Piece[] = [],
    rune = kind === MarkKind.Rune,
    main: Rgb = rune ? tone.teal : tone.brown,
    light: Rgb = rune ? tone.sage : tone.sand,
    count = Math.round(6 + radius * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + jitter(seed, i) * 0.5,
      r = 0.35 + 0.65 * Math.sqrt(jitter(seed, i + 100)),
      x = Math.cos(a) * rx * r,
      y = Math.sin(a) * ry * r,
      size = (rune ? 3 : 4.5) + jitter(seed, i + 200) * 4,
      rise = 6 + jitter(seed, i + 300) * 8,
      delay = r * 0.06 + jitter(seed, i + 400) * 0.04,
      lean = (jitter(seed, i + 500) - 0.5) * 0.5,
      shape = (color: Rgb, k: number) =>
        rune
          ? appendShard(new ShapeNode().fill(...color), size * k, seed + i)
          : appendRock(new ShapeNode().fill(...color), size * k, seed + i);
    pieces.push(
      piece(shape(tone.ink, 1.1), {
        x,
        y,
        vy: -rise,
        fall: rise * 1.1,
        angle: rune ? -Math.PI / 2 + lean : lean,
        delay,
        life: 0.7,
        end: 0.5,
      }),
      piece(shape(i % 4 ? main : light, 0.85), {
        x: x - 0.5,
        y: y - 0.6,
        vy: -rise,
        fall: rise * 1.1,
        angle: rune ? -Math.PI / 2 + lean : lean,
        delay: delay + 0.01,
        life: 0.68,
        end: 0.5,
      }),
    );
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + jitter(seed, i + 600);
    pieces.push(
      piece(appendShard(new ShapeNode().fill(...(i % 2 ? tone.ochre : light)), 2.4, seed + i + 700), {
        x: Math.cos(a) * rx * 0.3,
        y: Math.sin(a) * ry * 0.3 - 4,
        vx: Math.cos(a) * rx * 0.8,
        vy: Math.sin(a) * ry * 0.8 - 10,
        fall: 14,
        angle: a,
        spin: 4,
        delay: 0.04,
        life: 0.55,
        end: 0.4,
      }),
    );
  }
  // Small scalloped dust puffs round the rim: a dark one with a lighter one riding on it.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.5,
      x = Math.cos(a) * rx * 0.8,
      y = Math.sin(a) * ry * 0.8,
      puff = { vy: -5, delay: 0.06, life: 0.75, end: 1.4, size: 0.7 };
    pieces.push(
      piece(appendCloud(new ShapeNode().fill(...main, 190), 9, 5, 3, seed + i), { ...puff, x, y }),
      piece(appendCloud(new ShapeNode().fill(...light, 200), 6.5, 3.6, 3, seed + i + 9), {
        ...puff,
        x: x + 1,
        y: y - 1.5,
        delay: 0.08,
      }),
    );
  }
  const sectors = Array.from({ length: sectorCount }, (_, i) => {
    const mid = ((i + 0.5) / sectorCount) * Math.PI * 2;
    return {
      slot: new DepthSlot(`eruption:${seed}:${at}:${i}`),
      pieces: [] as Piece[],
      foot: { x: Math.cos(mid) * rx * 0.6, y: Math.sin(mid) * ry * 0.6 },
      extent: extentOf([]),
    };
  });
  for (const p of pieces) {
    const turn = (Math.atan2(p.y / (ry / rx), p.x) + Math.PI * 2) % (Math.PI * 2),
      sector = sectors[Math.min(sectorCount - 1, Math.floor((turn / (Math.PI * 2)) * sectorCount))];
    sector.pieces.push(p);
    sector.slot.node.add(p.node.opacity(0));
  }
  for (const sector of sectors) sector.extent = extentOf(sector.pieces);
  return {
    at,
    center: { ...center },
    sectors: sectors.filter((sector) => sector.pieces.length),
    pieces,
    life: Math.max(...pieces.map((p) => p.delay + p.life)),
  };
}
const dropBurst = (b: Burst) => {
  for (const sector of b.sectors) sector.slot.detach();
};

/** Consumes telegraph, slam and Rune Burst cues and poses the marks on the ground layer. */
export function updateGroundTelegraphs(s: WorldRendererState, town: Town): void {
  let state = states.get(s);
  const layer = s.combatGround;
  if (!state || state.town !== town) {
    if (state) {
      for (const item of state.marks) layer.remove(item.node);
      state.bursts.forEach(dropBurst);
    }
    state = { town, next: 0n, marks: [], bursts: [] };
    states.set(s, state);
  }
  const now = town.clock();
  for (const event of cuesOf(town)) {
    if (event.serial < state.next) continue;
    state.next = event.serial + 1n;
    if (event.cue === CombatCue.Telegraph && event.radius > 0) {
      if (now - event.at > Math.max(0.1, event.duration) || !onView(s, event.position, 256)) continue;
      state.marks.push(mark(MarkKind.Danger, event, event.duration > 0 ? event.duration : 1.6));
    } else if (event.cue === CombatCue.Ability && event.radius > 0 && skillOfCue(town, event) === 'burst') {
      const duration = event.duration > 0 && event.duration <= 3 ? event.duration : 0.8;
      if (now - event.at > duration || !onView(s, event.position, 256)) continue;
      state.marks.push(mark(MarkKind.Rune, event, duration));
    } else if (event.cue === CombatCue.Slam) {
      const found = state.marks.find(
        (m) =>
          m.kind === MarkKind.Danger &&
          ((event.creature >= 0 && m.creature === event.creature) || distance(m.center, event.position) < 1),
      );
      if (found) {
        layer.remove(found.node);
        state.marks = state.marks.filter((m) => m !== found);
      }
      if (now - event.at < 0.4 && onView(s, event.position, 256))
        state.bursts.push(
          eruption(
            MarkKind.Danger,
            event.position,
            event.radius || found?.radius || 2,
            event.at,
            Number(event.serial % 100000n),
          ),
        );
    }
    while (state.marks.length > maxMarks) layer.remove(state.marks.shift()!.node);
  }
  state.marks = state.marks.filter((m) => {
    const age = now - m.at,
      winding = m.creature >= 0 && (town.creature(m.creature)?.windupUntil ?? -1) >= 0;
    if (winding) m.wound = true;
    // An interrupted wind-up sends no cue: the monster simply stops winding up.
    const broken = m.kind === MarkKind.Danger && m.wound === true && !winding && age < m.duration;
    if (broken) {
      layer.remove(m.node);
      return false;
    }
    if (age < 0 || age > m.duration + (m.kind === MarkKind.Rune ? 0 : linger)) {
      layer.remove(m.node);
      if (m.kind === MarkKind.Rune && age >= 0)
        state!.bursts.push(
          eruption(MarkKind.Rune, m.center, m.radius, m.at + m.duration, Number(m.at * 1000) | 0),
        );
      return false;
    }
    if (!layer.children.includes(m.node)) layer.add(m.node);
    const at = project(m.center.x, m.center.y),
      p = ease.smooth(markProgress(m, now)),
      fade = age > m.duration ? 1 - (age - m.duration) / linger : 1;
    m.node.translate(at.x, at.y);
    m.node.opacity(Math.round(255 * fade * (s.currentVisibility.sample(m.center) >= 119 ? 1 : 0.5)));
    m.fill.transform([p, 0, 0, 0, p, 0, 0, 0, 1]);
    return true;
  });
  state.bursts = state.bursts.filter((b) => {
    const age = now - b.at;
    if (age < 0 || age >= b.life) {
      dropBurst(b);
      return false;
    }
    const at = project(b.center.x, b.center.y),
      seen = s.currentVisibility.sample(b.center) >= 119;
    for (const p of b.pieces) posePiece(p, age);
    for (const sector of b.sectors) {
      const node = sector.slot.node;
      node.translate(at.x, at.y);
      // Kept in the world's order for the whole eruption: joining or leaving it re-sorts the world.
      node.opacity(seen ? 255 : 0);
      sector.slot.place(s, unproject(at.x + sector.foot.x, at.y + sector.foot.y), boxAt(at.x, at.y, sector.extent));
    }
    return true;
  });
}
