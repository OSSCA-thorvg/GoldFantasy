// Generic outline figures for units hidden behind trees and peaks: no likeness, only a body, a face's
// contour and what is in hand, posed as the unit is. Residents are read straight from their posed parts;
// monsters ride one shared humanoid or four-legged skeleton driven by the clips their own rig plays.
import { MonsterRank } from '../../engine/src/combat-events';
import type { Monster } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import { breedOf } from '../../engine/src/town-monsters';
import { DungeonKind } from '../../engine/src/world-types';
import { affineOf, shift, times, Trace, type Affine, type Draft } from './ghost-trace';
import { faceTrace, toolTrace, weaponTrace, type WeaponClass } from './ghost-tools';
import { humanoidClips, humanoidFigure } from './humanoid-rig';
import { emergeSeconds, monsterKind, monsterTop } from './monster-figures';
import { windupOf } from './monster-rank-look';
import type { Matrix, SceneNode } from './paint';
import { heldTools } from './person-equipment';
import { quadrupedClips, quadrupedFigure } from './quadruped-rig';
import type { RigClip } from './rig-clip';
import type { RigFigure } from './rig-figure';
import { PoseBank } from './rig-pose-bank';
import { SkinnedPath, type OutlinePoint } from './rig-skinned-path';
import type { Figure } from './world-renderer-state';
import type { PersonParts } from './world-sprites';

/** A piece of a ghost's hit area in world pixels: an ellipse, or a box when `box` is set. */
export interface GhostArea {
  x: number;
  y: number;
  rx: number;
  ry: number;
  box?: boolean;
}
const apply = (m: Affine, x: number, y: number, out: number[], at: number): void => {
  out[at] = m[0] * x + m[1] * y + m[2];
  out[at + 1] = m[3] * x + m[4] * y + m[5];
};
/** The body box the draft has bounded since `begin`, and a head disc when `r` is positive. */
function areasOf(draft: Draft, x = 0, y = 0, r = 0): GhostArea[] {
  const areas: GhostArea[] = [
    {
      x: (draft.left + draft.right) / 2,
      y: (draft.top + draft.bottom) / 2,
      rx: (draft.right - draft.left) / 2,
      ry: (draft.bottom - draft.top) / 2,
      box: true,
    },
  ];
  if (r > 0) areas.push({ x, y, rx: r, ry: r });
  return areas;
}

// ---- Residents: their own posed parts, in the body's space. ----

/** Height of the hem above the feet: the legs below it are short stubs. */
const hem = -3.8;
const torsos = new WeakMap<PersonParts, Trace>();
/** A plain robe-shaped torso fitted to the figure's shoulders and neck. */
function torsoOf(parts: PersonParts): Trace {
  let trace = torsos.get(parts);
  if (trace) return trace;
  const top = parts.neck.y,
    shoulder = Math.max(1.6, Math.abs(parts.arms[1].shoulder.x) - 0.5),
    waist = top * 0.42,
    narrow = shoulder * 0.86,
    wide = shoulder * 1.18;
  trace = new Trace()
    .moveTo(-shoulder, top + 0.9)
    .cubicTo(-shoulder, top + 0.2, -shoulder + 0.3, top, -shoulder + 0.9, top)
    .lineTo(shoulder - 0.9, top)
    .cubicTo(shoulder - 0.3, top, shoulder, top + 0.2, shoulder, top + 0.9)
    .lineTo(narrow, waist)
    .lineTo(wide, hem)
    .cubicTo(wide * 0.5, hem + 0.5, -wide * 0.5, hem + 0.5, -wide, hem)
    .lineTo(-narrow, waist)
    .close();
  torsos.set(parts, trace);
  return trace;
}
const limb: number[] = [];
/** Traces a resident as posed this frame; null when the figure has no body to read. */
export function traceResident(draft: Draft, figure: Figure): GhostArea[] | null {
  const parts = figure.parts;
  if (!parts.body) return null;
  const body = times(affineOf(figure.paint.matrix), affineOf(parts.body.matrix)),
    legX = Math.max(0.9, Math.abs(parts.arms[1].shoulder.x) * 0.5);
  draft.begin();
  draft.trace(torsoOf(parts), body);
  parts.feet.forEach((foot, i) => {
    const step: Affine = foot ? affineOf(foot.matrix) : [1, 0, 0, 0, 1, 0],
      x = i ? legX : -legX;
    limb[0] = x;
    limb[1] = hem + 0.4;
    apply(step, x, -0.6, limb, 2);
    apply(step, x + 1.3, -0.6, limb, 4);
    draft.stroke(body, limb, 3);
  });
  for (const arm of parts.arms) {
    if (!arm.forearm) continue;
    const fore = affineOf(arm.forearm.matrix);
    limb[0] = arm.shoulder.x;
    limb[1] = arm.shoulder.y + arm.shoulderLift;
    apply(fore, arm.elbow.x, arm.elbow.y, limb, 2);
    apply(fore, arm.wrist.x, arm.wrist.y, limb, 4);
    draft.stroke(body, limb, 3);
  }
  const seat = parts.head[0],
    head = seat ? times(body, affineOf(seat.matrix)) : null,
    areas = head ? areasOf(draft, head[2], head[5], Math.hypot(head[0], head[3])) : areasOf(draft);
  if (head) draft.trace(faceTrace, head, 0);
  const tool = heldTools.find((name) => (parts[name]?.alpha ?? 0) > 0),
    hand = parts.arms[1];
  if (tool && hand.forearm && hand.hand)
    draft.trace(
      toolTrace(tool),
      times(
        times(body, affineOf(hand.forearm.matrix)),
        times(affineOf(hand.hand.matrix), shift(hand.wrist.x, hand.wrist.y)),
      ),
      0,
    );
  return areas;
}

// ---- Monsters: one generic figure per kind of body, on the shared skeletons and clips. ----

interface Body {
  figure: RigFigure;
  bank: PoseBank;
  /** The lair whose creature this figure is built like (draugr, warg): its art's height and girth are this figure's. */
  reference: DungeonKind;
  torso: SkinnedPath;
  /** Closed outlines bound to bones beside the torso: a beast's head and neck. */
  more: SkinnedPath[];
  /** Strokes through joints: each entry is bone and rest point, in order. */
  strokes: { bone: Int16Array; x: Float32Array; y: Float32Array }[];
  head: { bone: number; seat: Affine } | null;
  hand: number;
}
type StrokePoint = readonly [bone: string, x: number, y: number];
function body(
  figure: RigFigure,
  reference: DungeonKind,
  torso: readonly OutlinePoint[],
  more: readonly (readonly OutlinePoint[])[],
  strokes: readonly (readonly StrokePoint[])[],
  head: { bone: string; x: number; y: number; r: number } | null,
  hand: string,
): Body {
  const { skeleton } = figure;
  return {
    figure,
    bank: new PoseBank(figure),
    reference,
    torso: new SkinnedPath(skeleton, [torso]),
    more: more.map((loop) => new SkinnedPath(skeleton, [loop])),
    strokes: strokes.map((points) => ({
      bone: Int16Array.from(points, (p) => skeleton.bone(p[0])),
      x: Float32Array.from(points, (p) => p[1]),
      y: Float32Array.from(points, (p) => p[2]),
    })),
    head: head && { bone: skeleton.bone(head.bone), seat: [head.r, 0, head.x, 0, head.r, head.y] },
    hand: hand ? skeleton.bone(hand) : -1,
  };
}
/** The joint of `bone` at rest. */
const rest = (figure: RigFigure, bone: string): readonly [number, number] => {
  const i = figure.skeleton.bone(bone);
  return [figure.skeleton.restX[i], figure.skeleton.restY[i]];
};
let humanoid: Body | undefined, quadruped: Body | undefined;
/** Two-legged: a draugr's build, the middle of the humanoid kinds. */
function humanoidBody(): Body {
  if (humanoid) return humanoid;
  const figure = humanoidFigure({
      hip: 5.2,
      chest: 8,
      neck: 10.6,
      shoulder: 2.6,
      shoulderDrop: 0.8,
      upperArm: 2.8,
      forearm: 3,
      stance: 1.2,
      knee: 3,
      ankle: 0.8,
    }),
    joint = (bone: string): StrokePoint => [bone, ...rest(figure, bone)],
    toe = (side: string): StrokePoint => [`foot.${side}`, rest(figure, `foot.${side}`)[0] + 1.2, -0.1];
  humanoid = body(
    figure,
    DungeonKind.Crypt,
    [
      // Square shoulders over a narrow trunk, so an arm hanging from either shoulder stays clear of it.
      [-2.7, -10, 'chest', true],
      [0, -10.5, 'chest'],
      [2.7, -10, 'chest', true],
      [1.5, -8.6, 'chest'],
      [1.2, -6.6, 'spine'],
      [1.7, -5, 'hips', true],
      [0, -4.7, 'hips'],
      [-1.7, -5, 'hips', true],
      [-1.2, -6.6, 'spine'],
      [-1.5, -8.6, 'chest'],
    ],
    [],
    [
      ...(['l', 'r'] as const).map((side) => [joint(`arm.${side}.1`), joint(`arm.${side}.2`), joint(`hand.${side}`)]),
      ...(['l', 'r'] as const).map((side) => [joint(`leg.${side}.1`), joint(`leg.${side}.2`), joint(`foot.${side}`), toe(side)]),
    ],
    { bone: 'head', x: 0.2, y: -13.2, r: 2.2 },
    'hand.r',
  );
  return humanoid;
}
/** Four-legged: the shared mannequin a warg is drawn on. */
function quadrupedBody(): Body {
  if (quadruped) return quadruped;
  const figure = quadrupedFigure(1),
    leg = (name: string): StrokePoint[] => {
      const [hx, hy] = rest(figure, `leg.${name}.1`),
        [kx, ky] = rest(figure, `leg.${name}.2`),
        [fx, fy] = rest(figure, `foot.${name}`);
      // From the belly line, so little of the leg crosses the body.
      return [
        [`leg.${name}.1`, hx + (kx - hx) * 0.3, hy + (ky - hy) * 0.3],
        [`leg.${name}.2`, kx, ky],
        [`foot.${name}`, fx, fy],
        [`foot.${name}`, fx + 0.9, fy + 0.3],
      ];
    };
  quadruped = body(
    figure,
    DungeonKind.Cave,
    [
      [-7.2, -7.4, 'hips'],
      [-5, -8.2, 'hips'],
      [-1, -8, 'chest'],
      [3.4, -8.4, 'chest'],
      [4.9, -7.2, 'chest'],
      [3.9, -5.4, 'chest'],
      [0, -5.1, 'chest'],
      [-4.6, -5, 'hips'],
      [-7, -5.8, 'hips'],
    ],
    [
      [
        [4.4, -8.6, 'neck'],
        [6.1, -10.1, 'head'],
        [6.8, -11.6, 'head', true],
        [7.6, -10.2, 'head'],
        [9.8, -9.4, 'head'],
        [10.1, -8.7, 'head', true],
        [9.5, -8.2, 'jaw'],
        [7.6, -7.9, 'jaw'],
        [5.6, -7.2, 'neck'],
      ],
    ],
    [
      [
        ['tail', -7, -7.1],
        ['tail', -9, -7.6],
        ['tail', -10.8, -6.6],
      ],
      leg('hl'),
      leg('fl'),
      leg('hr'),
      leg('fr'),
    ],
    null,
    '',
  );
  return quadruped;
}
const quadrupedSet = new Set<RigClip>(Object.values(quadrupedClips));

/** What a monster's ghost remembers between frames. */
export interface MonsterMotion {
  last: { x: number; y: number };
  stride: number;
  lair: DungeonKind;
  rank: MonsterRank;
  attack: RigClip;
  weapon: WeaponClass | null;
  /** Width against the generic figure: a jotunn is broader for its height than a draugr. */
  wide: number;
}
const girth = (lair: DungeonKind): number => {
  const kind = monsterKind(lair);
  return kind.shadow[0] / kind.top;
};
/** The blow a monster's own art is dressed for, and what that says it carries. */
export function monsterMotion(town: Town, beast: Monster): MonsterMotion {
  const lair = town.map().dungeons()[beast.lair]?.kind ?? DungeonKind.Ruin,
    rank = beast.rank ?? MonsterRank.Grunt,
    kind = monsterKind(lair),
    attack = rank === MonsterRank.Den ? humanoidClips.claw : kind.dress(beast.id, rank).attack,
    shape = quadrupedSet.has(kind.idle) ? quadrupedBody() : humanoidBody();
  return {
    wide: Math.max(0.85, Math.min(1.4, girth(lair) / girth(shape.reference))),
    last: { ...beast.position },
    stride: 0,
    lair,
    rank,
    attack,
    weapon:
      attack === humanoidClips.chop
        ? 'club'
        : attack === humanoidClips.slash
          ? 'blade'
          : attack === humanoidClips.thrust
            ? 'spear'
            : null,
  };
}
/** The clip and frame the monster's rig is playing now, worked out as `poseMonster` does. */
function playing(town: Town, beast: Monster, motion: MonsterMotion): { clip: RigClip; frame: number } {
  const kind = monsterKind(motion.lair),
    clock = town.clock(),
    { attack } = motion,
    moved = Math.hypot(beast.position.x - motion.last.x, beast.position.y - motion.last.y);
  motion.last = { ...beast.position };
  if (beast.bornAt >= 0 && clock - beast.bornAt < emergeSeconds)
    return { clip: kind.fall, frame: (1 - (clock - beast.bornAt) / emergeSeconds) * kind.fall.frames * 0.7 };
  const windup = windupOf(town, beast);
  if (windup !== null)
    return { clip: attack, frame: Math.min(1, windup * 1.25) * ((attack.markers.contact ?? attack.frames) - 5) };
  const period = breedOf(motion.lair).pause;
  if (beast.swingAt >= 0 && clock - beast.swingAt < period)
    return {
      clip: attack,
      frame: (attack.markers.contact ?? 0) + ((clock - beast.swingAt) / period) * attack.frames,
    };
  if (beast.path.length > 0 || moved > 0.0001) {
    const gait = motion.rank === MonsterRank.Swarmer ? (kind.run ?? kind.walk) : kind.walk;
    motion.stride += moved * kind.pace * (gait === kind.walk ? 1 : 0.6);
    return { clip: gait, frame: motion.stride };
  }
  return { clip: kind.idle, frame: clock * 30 + beast.id * 37 };
}
/** One pose of a body with what it holds, solved into the body's own space once and shared by all in it. */
interface Baked {
  trace: Trace;
  /** Ops that belong to the body, for the hit box; the face and the weapon come after. */
  body: number;
  /** Centre and radius of the head, or a negative radius when it has none. */
  head: readonly [number, number, number];
}
const baked = new WeakMap<readonly Matrix[], Map<WeaponClass | '', Baked>>(),
  joints: number[] = [];
function bake(shape: Body, matrices: readonly Matrix[], weapon: WeaponClass | null): Baked {
  let byWeapon = baked.get(matrices);
  if (!byWeapon) baked.set(matrices, (byWeapon = new Map()));
  const known = byWeapon.get(weapon ?? '');
  if (known) return known;
  const trace = new Trace().commands(shape.torso.commands(matrices)),
    { skeleton } = shape.figure;
  for (const loop of shape.more) trace.commands(loop.commands(matrices));
  for (const stroke of shape.strokes) {
    for (let i = 0; i < stroke.bone.length; i++)
      apply(affineOf(matrices[stroke.bone[i]]), stroke.x[i], stroke.y[i], joints, 2 * i);
    trace.polyline(...joints.slice(0, 2 * stroke.bone.length));
  }
  const body = trace.ops.length;
  let head: [number, number, number] = [0, 0, -1];
  if (shape.head) {
    const seat = times(affineOf(matrices[shape.head.bone]), shape.head.seat);
    trace.append(faceTrace, seat);
    head = [seat[2], seat[5], Math.hypot(seat[0], seat[3])];
  }
  if (weapon && shape.hand >= 0)
    trace.append(
      weaponTrace(weapon),
      times(affineOf(matrices[shape.hand]), shift(skeleton.restX[shape.hand], skeleton.restY[shape.hand])),
    );
  const pose = { trace, body, head };
  byWeapon.set(weapon ?? '', pose);
  return pose;
}
/** A den's outline one unit tall. */
const mound = new Trace().moveTo(-0.95, 0).cubicTo(-0.8, -1.3, 0.8, -1.3, 0.95, 0).close();
/** Traces a monster as its rig poses it now, placed by its sprite and body transforms. */
export function traceMonster(
  draft: Draft,
  town: Town,
  beast: Monster,
  sprite: SceneNode,
  rig: SceneNode | undefined,
  motion: MonsterMotion,
): GhostArea[] {
  const place = rig ? times(affineOf(sprite.matrix), affineOf(rig.matrix)) : affineOf(sprite.matrix);
  draft.begin();
  if (motion.rank === MonsterRank.Den) {
    // A den is a nest with no skeleton: a low mound.
    const top = rig ? monsterTop(rig) : 12;
    motion.last = { ...beast.position };
    draft.trace(mound, times(place, [top, 0, 0, 0, top, 0]));
    return areasOf(draft);
  }
  const kind = monsterKind(motion.lair),
    { clip, frame } = playing(town, beast, motion),
    shape = quadrupedSet.has(kind.idle) ? quadrupedBody() : humanoidBody(),
    pose = bake(shape, shape.bank.pose(clip, frame, 1), motion.weapon),
    size = kind.top / monsterKind(shape.reference).top,
    unit = times(place, [size * motion.wide, 0, 0, 0, size, 0]),
    [hx, hy, hr] = pose.head;
  draft.trace(pose.trace, unit, pose.body);
  return areasOf(
    draft,
    unit[0] * hx + unit[1] * hy + unit[2],
    unit[3] * hx + unit[4] * hy + unit[5],
    hr * Math.hypot(unit[1], unit[4]),
  );
}
