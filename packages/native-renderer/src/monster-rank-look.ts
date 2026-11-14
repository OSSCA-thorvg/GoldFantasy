// How a monster's rank shows in the world: its size, a guardian's crown, recoil from blows and a rearing wind-up.
import { project } from '../../engine/src/geometry';
import { CombatCue, MonsterRank } from '../../engine/src/combat-events';
import type { Hit, Monster } from '../../engine/src/person';
import type { Town } from '../../engine/src/town';
import { DungeonKind } from '../../engine/src/world-types';
import { SceneNode, ShapeNode, type Matrix } from './paint';
import { cuesOf, tone, unit } from './combat-paint';
import { monsterKind, monsterTop } from './monster-figures';
import { monsterParts } from './world-sprites';
import type { WorldRendererState } from './world-renderer-state';

/** Width and height scale of each rank. The rig draws a den as its own nest at full size, so only
 * this scales a swarmer. */
export function rankScale(rank: MonsterRank, giant = false): readonly [number, number] {
  switch (rank) {
    case MonsterRank.Brute:
      return [1.24, 1.18];
    case MonsterRank.Stalker:
      return [0.84, 0.86];
    case MonsterRank.Guardian:
      return giant ? [1.22, 1.22] : [1.55, 1.55];
    case MonsterRank.Swarmer:
      return [0.7, 0.7];
    default:
      return [1, 1];
  }
}
/** Unscaled height of the lair's art above its feet, from the rig that draws it. */
export function artHeight(lair: DungeonKind, body?: SceneNode): number {
  return body ? monsterTop(body) : monsterKind(lair).top;
}
/** Drawn height above the feet, for bars and floating text. Pass the renderer to read the posed figure. */
export function monsterHeight(town: Town, beast: Monster, s?: WorldRendererState): number {
  const lair = town.map().dungeons()[beast.lair]?.kind ?? DungeonKind.Ruin,
    sprite = s?.beasts.get(beast.id),
    body = sprite ? monsterParts(sprite.paint)?.body : undefined;
  return artHeight(lair, body) * rankScale(beast.rank ?? MonsterRank.Grunt, beast.giant())[1];
}

/** A crown of bone horns with a dark companion behind each, set on the art's head. */
export function guardianCrown(top: number): SceneNode {
  const crown = new SceneNode(),
    back = new ShapeNode(),
    front = new ShapeNode(),
    band = new ShapeNode(),
    accent = new ShapeNode();
  const horns = [-2, -1, 0, 1, 2];
  for (const i of horns) {
    const x = i * 2.6,
      tall = 5.5 - Math.abs(i) * 0.9,
      lean = i * 0.9;
    back
      .moveTo(x - 1.6, top + 1)
      .lineTo(x + lean * 1.25 - 0.4, top - tall - 1.1)
      .lineTo(x + 1.7, top + 1)
      .close();
    front
      .moveTo(x - 1.1, top + 0.6)
      .lineTo(x + lean, top - tall)
      .lineTo(x + 1.1, top + 0.6)
      .close();
  }
  band.appendRect(-7.2, top - 0.2, 14.4, 2.2, 0.6, 0.6);
  // Small warm shards fixed in the band.
  for (const x of [-4.2, 0, 4.2])
    accent
      .moveTo(x, top - 0.6)
      .lineTo(x + 1, top + 0.9)
      .lineTo(x - 1, top + 0.9)
      .close();
  back.fill(...tone.ink);
  front.fill(...tone.sand);
  band.fill(...tone.dusk);
  accent.fill(...tone.ochre);
  return crown.add(back).add(front).add(band).add(accent);
}
/** Shards fanned on the guardian's back like a torn banner. */
function guardianBanner(top: number): SceneNode {
  const banner = new SceneNode(),
    dark = new ShapeNode(),
    light = new ShapeNode();
  for (let i = 0; i < 3; i++) {
    dark
      .moveTo(-3 - i * 2.2, top * 0.55)
      .lineTo(-9 - i * 2.4, top * 0.55 - 7 + i * 2)
      .lineTo(-5 - i * 1.6, top * 0.55 + 2)
      .close();
    light
      .moveTo(-3.6 - i * 2.2, top * 0.55 - 0.4)
      .lineTo(-8 - i * 2.4, top * 0.55 - 6 + i * 2)
      .lineTo(-5 - i * 1.6, top * 0.55 + 0.6)
      .close();
  }
  dark.fill(...tone.ink);
  light.fill(...tone.rust);
  return banner.add(dark).add(light);
}

interface RankRig {
  rank: MonsterRank;
  adornment?: SceneNode;
}
const rigs = new WeakMap<SceneNode, RankRig>();
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[3],
  a[0] * b[1] + a[1] * b[4],
  a[0] * b[2] + a[1] * b[5] + a[2],
  a[3] * b[0] + a[4] * b[3],
  a[3] * b[1] + a[4] * b[4],
  a[3] * b[2] + a[4] * b[5] + a[5],
  0,
  0,
  1,
];
export interface RankPose {
  sx: number;
  sy: number;
  /** Screen offset of the whole sprite (recoil). */
  dx: number;
  dy: number;
}
const still: RankPose = { sx: 1, sy: 1, dx: 0, dy: 0 };

const fresh = new WeakMap<Town, { at: number; seen: number; hits: Hit[] }>();
/** Blows on monsters in the last moment, filtered once a frame rather than once per monster. */
function freshBlows(town: Town): readonly Hit[] {
  const now = town.clock(),
    all = town.hits(),
    last = fresh.get(town);
  if (last && last.at === now && last.seen === all.length) return last.hits;
  const hits = all.filter((h) => !h.onPerson && !h.blocked && now - h.at >= 0 && now - h.at < 0.22);
  fresh.set(town, { at: now, seen: all.length, hits });
  return hits;
}
/** Recoil from the latest blow on this monster: a quick shove away from the attacker, then back. */
export function recoilOf(town: Town, beast: Monster): { dx: number; dy: number; squash: number } {
  const now = town.clock();
  let best: Hit | undefined;
  const { x, y } = beast.position;
  for (const hit of freshBlows(town)) {
    const dx = hit.to.x - x,
      dy = hit.to.y - y;
    if (dx * dx + dy * dy < 0.49 && (!best || hit.at > best.at)) best = hit;
  }
  if (!best) return { dx: 0, dy: 0, squash: 0 };
  const age = now - best.at,
    push = Math.sin((Math.PI / 2) * unit(age / 0.04)) * (1 - unit((age - 0.04) / 0.18)) ** 2,
    from = project(best.from.x, best.from.y),
    to = project(best.to.x, best.to.y),
    length = Math.hypot(to.x - from.x, to.y - from.y) || 1,
    reach = (best.crit ? 4 : 2.6) * push;
  return {
    dx: ((to.x - from.x) / length) * reach,
    dy: ((to.y - from.y) / length) * reach * 0.6,
    squash: push,
  };
}
/** Seconds of the current wind-up and how far it has gone (0..1), or null. */
export function windupOf(town: Town, beast: Monster): number | null {
  const now = town.clock();
  if (!(beast.windupUntil > now)) return null;
  let total = 1.6;
  for (const event of cuesOf(town))
    if (event.cue === CombatCue.Telegraph && event.creature === beast.id && event.duration > 0)
      total = event.duration;
  return unit(1 - (beast.windupUntil - now) / total);
}

/** Poses rank, recoil and wind-up over whatever the body already holds; returns the sprite's own scale and shift. */
export function poseRank(town: Town, beast: Monster, root: SceneNode, body: SceneNode | undefined): RankPose {
  // A den is a still nest: no size, crown, recoil or rearing of ours.
  if ((beast.animal !== null && beast.animal !== undefined) || beast.rank === MonsterRank.Den) return still;
  const rank = beast.rank ?? MonsterRank.Grunt,
    lair = town.map().dungeons()[beast.lair]?.kind ?? DungeonKind.Ruin,
    [sx, sy] = rankScale(rank, beast.giant());
  let rig = rigs.get(root);
  if (!rig || rig.rank !== rank) {
    if (rig?.adornment) root.remove(rig.adornment);
    rig = { rank };
    if (rank === MonsterRank.Guardian) {
      const top = -artHeight(lair, body);
      rig.adornment = new SceneNode().add(guardianBanner(top)).add(guardianCrown(top + 1.5));
      root.add(rig.adornment);
    }
    rigs.set(root, rig);
  }
  const recoil = recoilOf(town, beast),
    rear = windupOf(town, beast);
  if (body) {
    let pose: Matrix = [1 + recoil.squash * 0.07, 0, 0, 0, 1 - recoil.squash * 0.07, 0, 0, 0, 1];
    if (rear !== null) {
      // Leans back and rises, trembling as the blow is about to fall.
      const p = Math.sin((Math.PI / 2) * rear),
        tremble = rear > 0.7 ? Math.sin(town.clock() * 70) * 0.025 * (rear - 0.7) * 3 : 0;
      pose = multiply(pose, [1 - 0.04 * p, 0.3 * p + tremble, 0, 0, 1 + 0.14 * p, 0, 0, 0, 1]);
    }
    if (rear !== null || recoil.squash > 0) body.transform(multiply(body.matrix, pose));
    rig.adornment?.transform(body.matrix);
  }
  return { sx, sy, dx: recoil.dx, dy: recoil.dy };
}
