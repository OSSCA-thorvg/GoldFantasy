// Thor in the world: his figure sorted with everyone else, Mjolnir in flight, the bolts he calls down and
// the scorch they leave. Nothing is built before his first visit, and nothing is posed while he is away.
import { distance, lerp, point, project, sub, type Point } from '../../engine/src/geometry';
import { hash01 } from '../../engine/src/numeric';
import { BoltKind, ThorDoing, thorRules, thorSettled, type ThorBolt } from '../../engine/src/thor-visit';
import type { Town } from '../../engine/src/town';
import { SceneNode, ShapeNode, type Matrix } from './paint';
import { appendStrip, softDisc } from './vector-paint';
import { DepthSlot, boxAt, inFront } from './combat-depth';
import { registerPick } from './world-pick-registry';
import type { WorldRendererState } from './world-renderer-state';
import { flyingHammer, poseThor, thorHands, thorParts, ThorPose, type ThorParts } from './thor-figure';

/** Pick id of Thor among the landmarks (0 Odin's statue, 1 Fire Mountain, 2 Hvergelmir). */
export const thorLandmark = 3;
/** His figure is drawn this much larger than the rig's units, half again a resident's height. */
const thorScale = 1.3,
  boltLife = 0.42,
  markLife = 2.6,
  boltHeight = 190;
interface BoltArt {
  slot: DepthSlot;
  node: SceneNode;
  serial: bigint;
  /** In the night veil's mask: the bolt itself and a flash of daylight on the ground round it. */
  cut: SceneNode;
  flash: ShapeNode;
}
interface Mark {
  node: SceneNode;
  at: number;
  where: Point;
}
interface ThorArt {
  parts: ThorParts;
  slot: DepthSlot;
  hammer: DepthSlot;
  flying: SceneNode;
  bolts: BoltArt[];
  marks: Mark[];
  /** Cuts through the night veil, held in its mask, so the strike is the brightest thing at night. */
  light: SceneNode;
  hammerLight: ShapeNode;
  seenBolt: bigint;
  facing: number;
  stride: number;
  last: Point;
  clock: number;
}
const arts = new WeakMap<WorldRendererState, ThorArt>();
/** Copies a shape's outline as a white cut for the night veil's mask. */
const cutOf = (shape: ShapeNode): ShapeNode => {
  const cut = new ShapeNode().fill(255, 255, 255);
  cut.commands = shape.commands;
  cut.pathVersion++;
  return cut;
};
/**
 * A bolt as the weather's lightning is drawn: a tapering brushed stroke falling in uneven steps, with one or
 * two short forks, a pale-blue edge round a white core; ground at the origin. `cut` is its outline for the
 * night veil's mask, so it is never dimmed.
 */
function boltShape(seed: number): { node: SceneNode; cut: SceneNode } {
  const path: Point[] = [point((hash01(seed, 0, 0, 0x7a11) - 0.5) * 50, -boltHeight)],
    roll = (i: number, k: number) => hash01(seed, i, k, 0x7a11);
  let sway = 0;
  // Uneven steps: some long falls, some short kinks.
  const steps = [0.07, 0.12, 0.05, 0.1, 0.14, 0.06, 0.09, 0.13, 0.05, 0.11, 0.08].map((d, i) => d * (0.7 + roll(i, 1) * 0.6)),
    total = steps.reduce((a, b) => a + b, 0);
  let fell = 0;
  for (let i = 0; i < steps.length; ++i) {
    fell += steps[i] / total;
    sway = sway * 0.55 + (roll(i, 2) - 0.5) * 34;
    const start = path[0].x;
    path.push(point(i === steps.length - 1 ? 0 : start * (1 - fell) + sway, -boltHeight * (1 - fell)));
  }
  const outer = new ShapeNode(),
    core = new ShapeNode();
  appendStrip(outer, path, 1.6, 4.6);
  appendStrip(core, path, 0.6, 2);
  for (let k = 0; k < 1 + Math.floor(roll(k + 20, 3) * 2); ++k) {
    const from = 3 + Math.floor(roll(k, 4) * 5),
      side = roll(k, 5) < 0.5 ? -1 : 1,
      fork: Point[] = [path[from]];
    for (let i = 1; i <= 4; ++i) {
      const last = fork[fork.length - 1];
      fork.push(point(last.x + side * (6 + roll(k * 8 + i, 6) * 9), last.y + 9 + roll(k * 8 + i, 7) * 8));
    }
    appendStrip(outer, fork, 2.4, 0.4);
    appendStrip(core, fork, 0.9, 0.2);
  }
  outer.fill(176, 190, 238);
  core.fill(252, 250, 240);
  return { node: new SceneNode().add(outer).add(core), cut: new SceneNode().add(cutOf(outer)) };
}
/** A scorch on the earth: a dark blot with pale cracks running out of it. */
function scorchShape(seed: number): SceneNode {
  const node = new SceneNode(),
    blot = new ShapeNode().fill(54, 46, 40, 150),
    cracks = new ShapeNode().strokeWidth(1.4).strokeFill(232, 222, 190, 220).strokeCap('round');
  for (let i = 0; i < 9; ++i) {
    const a = (i / 9) * Math.PI * 2,
      r = 9 + hash01(seed, i, 2, 0x7a12) * 4,
      x = Math.cos(a) * r,
      y = Math.sin(a) * r * 0.5;
    if (i) blot.lineTo(x, y);
    else blot.moveTo(x, y);
  }
  blot.close();
  for (let i = 0; i < 5; ++i) {
    const a = (i / 5) * Math.PI * 2 + hash01(seed, i, 3, 0x7a12),
      r = 11 + hash01(seed, i, 4, 0x7a12) * 6;
    cracks.moveTo(Math.cos(a) * 4, Math.sin(a) * 2).lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.5);
  }
  node.add(blot).add(cracks);
  return node;
}
function build(): ThorArt {
  const parts = thorParts(),
    slot = new DepthSlot('thor'),
    hammer = new DepthSlot('thor:hammer'),
    flying = flyingHammer();
  slot.node.add(parts.node);
  hammer.node.add(flying);
  const light = new SceneNode(),
    hammerLight = softDisc(26, [255, 255, 255], 230),
    bolts = [0, 1, 2].map((k) => {
      const slot = new DepthSlot(`thor:bolt:${k}`),
        { node, cut } = boltShape(k * 7 + 3),
        flash = softDisc(130, [255, 255, 255], 255);
      slot.node.add(node);
      slot.node.opacity(0);
      cut.opacity(0);
      flash.opacity(0);
      light.add(cut).add(flash);
      return { slot, node, serial: -1n, cut, flash };
    });
  hammerLight.opacity(0);
  light.add(hammerLight);
  return {
    parts,
    slot,
    hammer,
    flying,
    bolts,
    light,
    hammerLight,
    marks: [0, 1, 2].map((k) => ({ node: scorchShape(k * 5 + 1), at: -1e9, where: point() })),
    seenBolt: 0n,
    facing: 1,
    stride: 0,
    last: point(-1, -1),
    clock: -1,
  };
}
function hideAll(art: ThorArt): void {
  art.slot.node.opacity(0);
  art.hammer.node.opacity(0);
  for (const bolt of art.bolts) bolt.slot.node.opacity(0);
  for (const mark of art.marks) mark.node.opacity(0);
  art.light.opacity(0);
}
/** Keeps the cuts in the night veil's mask; the veil is rebuilt when lamps change, so they re-enter it. */
function holdLight(s: WorldRendererState, art: ThorArt): void {
  const lit = s.darkVeil?.masking?.paint;
  if (lit instanceof SceneNode && !lit.children.includes(art.light)) lit.add(art.light);
  art.light.opacity(255);
}
/** The bolts: a fresh one takes the next slot; each flickers out quickly and leaves a scorch. */
function updateBolts(s: WorldRendererState, art: ThorArt, bolts: readonly ThorBolt[], now: number, sight: (p: Point) => boolean): boolean {
  let live = false;
  for (const bolt of bolts) {
    if (bolt.serial < art.seenBolt) continue;
    art.seenBolt = bolt.serial + 1n;
    const free = art.bolts.reduce((a, b) => (b.serial < a.serial ? b : a));
    free.serial = bolt.serial;
    const mark = art.marks.reduce((a, b) => (b.at < a.at ? b : a));
    mark.at = bolt.at;
    mark.where = { ...bolt.position };
  }
  for (const b of art.bolts) {
    const bolt = bolts.find((x) => x.serial === b.serial),
      age = bolt ? now - bolt.at : Infinity;
    // Two quick flashes, then gone.
    const on = bolt && age >= 0 && age < boltLife && !(age > 0.1 && age < 0.16) && sight(bolt.position);
    // Daylight on the ground and on whoever stands near, fading fast after the bolt.
    const flash = bolt && age >= 0 && age < 0.55 && sight(bolt.position) ? Math.min(1, (0.55 - age) / 0.35) : 0;
    b.flash.opacity(Math.round(255 * flash));
    if (bolt && flash > 0) {
      const at = project(bolt.position.x, bolt.position.y),
        size = bolt.kind === BoltKind.Hammer ? 1 : 1.4;
      b.flash.transform([size, 0, at.x, 0, size * 0.5, at.y, 0, 0, 1]);
    }
    if (!on) {
      b.slot.node.opacity(0);
      b.cut.opacity(0);
      continue;
    }
    live = true;
    const at = project(bolt.position.x, bolt.position.y),
      wide = bolt.kind === BoltKind.Hammer ? 1 : 1.15,
      place: Matrix = [wide, 0, at.x, 0, 1, at.y - 2, 0, 0, 1];
    b.node.transform(place);
    b.cut.transform(place);
    b.cut.opacity(255);
    b.slot.node.opacity(255);
    b.slot.place(s, inFront(bolt.position), boxAt(at.x, at.y, { x0: -40, y0: -boltHeight - 10, x1: 40, y1: 8 }));
  }
  for (const mark of art.marks) {
    const age = now - mark.at;
    if (age < 0 || age > markLife || !sight(mark.where)) {
      mark.node.opacity(0);
      continue;
    }
    live = true;
    if (!s.combatGround.children.includes(mark.node)) s.combatGround.add(mark.node);
    const at = project(mark.where.x, mark.where.y);
    mark.node.translate(at.x, at.y);
    mark.node.opacity(Math.round(255 * Math.min(1, (markLife - age) / 1.2)));
  }
  return live;
}
/** Mjolnir between his hand and its mark: out in an arc, a bolt, and back again. */
function updateHammer(s: WorldRendererState, art: ThorArt, town: Town, now: number): boolean {
  const thor = town.thor,
    release = thor.throwAt + thorRules.windup,
    out = thorRules.flight,
    back = thorRules.flight + 0.15,
    age = now - release;
  if (thor.throwAt < 0 || age < 0 || age > out + back) {
    art.hammer.node.opacity(0);
    art.hammerLight.opacity(0);
    return false;
  }
  const going = age < out,
    u = going ? age / out : (age - out) / back,
    from = going ? thor.throwFrom : thor.throwTo,
    to = going ? thor.throwTo : thor.position,
    ground = lerp(from, to, u),
    a = project(from.x, from.y),
    b = project(to.x, to.y),
    lift = (going ? 16 - 6 * u : 10 + 6 * u) + 22 * u * (1 - u) * (1 + distance(from, to) * 0.15),
    spin = now * 22;
  const x = a.x + (b.x - a.x) * u,
    y = a.y + (b.y - a.y) * u - lift,
    c = Math.cos(spin),
    sn = Math.sin(spin);
  art.flying.transform([c, -sn, x, sn, c, y, 0, 0, 1]);
  art.hammerLight.translate(x, y);
  art.hammerLight.opacity(230);
  art.hammer.node.opacity(255);
  art.hammer.place(s, inFront(ground, 0.06), boxAt(x, y, { x0: -12, y0: -12, x1: 12, y1: 12 }));
  return true;
}
function poseOf(art: ThorArt, town: Town, now: number, walking: boolean): { pose: ThorPose; t: number } {
  const thor = town.thor,
    since = now - thor.since,
    throwing = thor.throwAt >= 0 ? now - thor.throwAt : -1;
  if (thor.doing === ThorDoing.Arriving && since < 1.4) return { pose: ThorPose.Rise, t: since / 1.4 };
  if (throwing >= 0 && throwing < thorRules.windup + 0.55) return { pose: ThorPose.Throw, t: throwing };
  if (walking) return { pose: thor.doing === ThorDoing.Hunting ? ThorPose.Run : ThorPose.Walk, t: art.stride };
  if (!thorSettled(town)) return { pose: ThorPose.Idle, t: 0 };
  switch (thor.doing) {
    case ThorDoing.Fireside:
      return { pose: ThorPose.Sit, t: 0 };
    case ThorDoing.Watching: {
      const beat = since % 8;
      return beat < 1.4 ? { pose: ThorPose.Admire, t: beat } : beat >= 4.5 && beat < 5.4 ? { pose: ThorPose.Cheer, t: beat - 4.5 } : { pose: ThorPose.Idle, t: 0 };
    }
    case ThorDoing.Drinking: {
      const beat = since % 7;
      return beat < 2.2 ? { pose: ThorPose.Drink, t: beat } : { pose: ThorPose.Idle, t: 0 };
    }
    case ThorDoing.Lifting: {
      const beat = since % 8;
      return beat < 4.4 ? { pose: ThorPose.Lift, t: beat } : { pose: ThorPose.Idle, t: 0 };
    }
  }
  return { pose: ThorPose.Idle, t: 0 };
}
/** Places, poses and picks Thor for this frame. Costs nothing before his first visit. */
export function updateThor(s: WorldRendererState, town: Town): void {
  const thor = town.thor;
  let art = arts.get(s);
  if (!art) {
    if (!thor.present && !thor.bolts.length) return;
    arts.set(s, (art = build()));
  }
  const now = town.clock(),
    sight = (p: Point) => s.sceneView || s.currentVisibility.sample(p) >= 119;
  if (s.editorView && !s.sceneView) {
    hideAll(art);
    return;
  }
  holdLight(s, art);
  updateBolts(s, art, thor.bolts, now, sight);
  updateHammer(s, art, town, now);
  if (!thor.present || !sight(thor.position)) {
    art.slot.node.opacity(0);
    art.last = { ...thor.position };
    art.clock = s.renderedAt;
    return;
  }
  // Poses ease on the screen's clock, so a paused game still settles into the pose it shows.
  const elapsed = art.clock < 0 ? 1 : Math.max(0, Math.min(0.25, s.renderedAt - art.clock)),
    moved = art.last.x >= 0 ? distance(thor.position, art.last) : 0,
    walking = moved > 0.0004;
  art.clock = s.renderedAt;
  if (walking) {
    const step = sub(thor.position, art.last);
    if (Math.abs(step.x - step.y) > 0.0001) art.facing = step.x - step.y < 0 ? -1 : 1;
    art.stride += moved * (thor.doing === ThorDoing.Hunting ? 13 : 19);
  } else {
    const look = thor.throwAt >= 0 ? thor.throwTo : thor.look,
      to = look ? sub(look, thor.position) : null;
    if (to && Math.abs(to.x - to.y) > 0.05) art.facing = to.x - to.y < 0 ? -1 : 1;
  }
  art.last = { ...thor.position };
  const { pose, t } = poseOf(art, town, now, walking),
    parts = art.parts,
    away = thor.throwAt >= 0 && now >= thor.throwAt + thorRules.windup && now < thor.throwAt + thorRules.windup + thorRules.flight * 2 + 0.15,
    drinking = thor.doing === ThorDoing.Drinking && thorSettled(town) && !walking;
  poseThor(parts, pose, t, now, elapsed);
  parts.hammer.opacity(away || drinking ? 0 : 255);
  parts.belted.opacity(drinking ? 255 : 0);
  parts.horn.opacity(drinking ? 255 : 0);
  const lifting = thor.doing === ThorDoing.Lifting && thorSettled(town) && !walking;
  if (!lifting) parts.boulder.opacity(0);
  else {
    parts.boulder.opacity(255);
    if (pose === ThorPose.Lift && t > 0.95 && t < 4.4) {
      const hands = thorHands(parts);
      parts.boulder.translate(hands.x, Math.min(0, hands.y + 0.9));
    } else parts.boulder.translate(7, 0);
  }
  const at = project(thor.position.x, thor.position.y);
  parts.node.transform([art.facing * thorScale, 0, at.x, 0, thorScale, at.y, 0, 0, 1]);
  art.slot.node.opacity(255);
  art.slot.place(s, thor.position, boxAt(at.x, at.y, { x0: -34, y0: -66, x1: 34, y1: 10 }));
  registerPick(art.slot.node, {
    ref: { kind: 'landmark', id: thorLandmark },
    body: [parts.skin.node],
    foot: { ...thor.position },
    ellipse: { rx: 16, ry: 6 },
  });
}
