// Thor as a rigged figure on the residents' skeleton and clips: half again a resident's height, red-bearded,
// a short cloak, Mjolnir in hand. Props (a seat, a boulder, a drinking horn) ride with him.
import { SceneNode, ShapeNode, type PaintNode, type Rgb } from './paint';
import { dusk } from './form-paint';
import { humanoidClips, humanoidFigure } from './humanoid-rig';
import type { RigClip } from './rig-clip';
import { capsules, discs, fills, RigSkin } from './rig-skin';
import type { RigFigure } from './rig-figure';
import type { RigPose } from './rig-skeleton';

const skinTone: Rgb = [236, 198, 164],
  beard: Rgb = [184, 78, 44],
  beardShade: Rgb = dusk(beard, 0.28),
  tunic: Rgb = [78, 96, 128],
  tunicShade: Rgb = dusk(tunic, 0.3),
  cloak: Rgb = [164, 58, 48],
  cloakShade: Rgb = dusk(cloak, 0.32),
  leather: Rgb = [104, 72, 48],
  leatherShade: Rgb = dusk(leather, 0.3),
  trousers: Rgb = [70, 64, 70],
  iron: Rgb = [112, 116, 128],
  ironShade: Rgb = dusk(iron, 0.32),
  gold: Rgb = [206, 168, 92],
  ink: Rgb = [30, 26, 34];
/** Rig units are screen pixels at zoom 1; a resident stands about 21 tall, Thor about 31. */
export const thorHeight = 31;
const build = {
  hip: 8,
  chest: 12.4,
  neck: 17.6,
  shoulder: 3.7,
  shoulderDrop: 1,
  upperArm: 4.1,
  forearm: 3.9,
  stance: 1.7,
  knee: 4.3,
  ankle: 1,
};
/** Mjolnir in rest-pose units, its grip at the origin and the head below. */
function mjolnir(x: number, y: number, size = 1): PaintNode[] {
  const k = size,
    handle = capsules(1 * k, leather, [x, y - 0.8 * k, x, y + 2.6 * k]),
    head = fills(iron, [
      [x - 2.8 * k, y + 2.3 * k],
      [x + 2.8 * k, y + 2.3 * k],
      [x + 3 * k, y + 5.4 * k],
      [x - 3 * k, y + 5.4 * k],
    ]),
    shade = fills(ironShade, [
      [x + 0.4 * k, y + 2.3 * k],
      [x + 2.8 * k, y + 2.3 * k],
      [x + 3 * k, y + 5.4 * k],
      [x + 0.5 * k, y + 5.4 * k],
    ]),
    pommel = discs(leatherShade, [x, y - 1 * k, 0.6 * k]);
  return [handle, pommel, head, shade];
}
/** The thrown hammer on its own, centred on its head, for its flight. */
export function flyingHammer(): SceneNode {
  const node = new SceneNode();
  for (const paint of mjolnir(0, -3.9, 1.5)) node.add(paint);
  return node;
}
export interface ThorParts {
  node: SceneNode;
  figure: RigFigure;
  skin: RigSkin;
  hammer: PaintNode;
  /** Mjolnir hung at his belt while his hand holds a horn. */
  belted: PaintNode;
  horn: PaintNode;
  seat: PaintNode;
  boulder: SceneNode;
  shadow: PaintNode;
}
export function thorParts(): ThorParts {
  const figure = humanoidFigure(build),
    skin = new RigSkin(figure.skeleton),
    node = new SceneNode(),
    shadow = discs([0, 0, 0, 90], [0, 0, 8, 3]),
    seat = new SceneNode();
  // A log to sit on by the fire: bark and a pale cut end.
  seat.add(capsules(4.6, [122, 88, 58], [-7.4, -2.4, 3.2, -2.4])).add(capsules(1.2, [94, 66, 44], [-6.6, -1.2, 2.4, -1.2])).add(discs([214, 186, 140], [3.6, -2.4, 1.7, 2.3]));
  // A grey boulder, darker on its shaded side, its base at the origin.
  const boulder = new SceneNode(),
    stone = new ShapeNode().fill(134, 130, 122),
    shade = new ShapeNode().fill(98, 96, 94);
  stone.moveTo(-4.4, 0).cubicTo(-5.4, -3.6, -2.6, -7.2, 0.6, -6.8).cubicTo(3.8, -6.4, 5.4, -3.2, 4.6, 0).close();
  shade.moveTo(0.8, -6.7).cubicTo(3.8, -6.4, 5.4, -3.2, 4.6, 0).lineTo(-1.6, 0).cubicTo(1.2, -1.6, 2, -4, 0.8, -6.7).close();
  boulder.add(stone).add(shade);
  node.add(shadow).add(seat).add(skin.node);
  // Far side first: cloak, far arm and leg, then the body, head and the near arm with the hammer.
  skin.piece(
    'chest',
    fills(cloakShade, [
      [-3.4, -17.8],
      [2.6, -17.8],
      [0.4, -9],
      [-4.6, -7.6],
      [-7.6, -8.8],
    ]),
    fills(cloak, [
      [-4, -17.6],
      [-1.2, -17.8],
      [-3, -10.2],
      [-5.4, -8.2],
      [-8, -9.2],
      [-6.6, -13.6],
    ]),
  );
  const far = dusk(tunic, 0.42);
  skin.piece('arm.l.1', capsules(2.5, far, [-3.7, -16.6, -3.7, -12.6]));
  skin.piece('arm.l.2', capsules(2.2, far, [-3.7, -12.6, -3.7, -9.6]), discs(dusk(skinTone, 0.3), [-3.7, -8.8, 1.2]));
  const leg = (side: 'l' | 'r', x: number, shade: number) => {
    skin.piece(`leg.${side}.1`, capsules(2.6, dusk(trousers, shade), [x, -8, x, -4.4]));
    skin.piece(
      `leg.${side}.2`,
      capsules(2.4, dusk(trousers, shade), [x, -4.4, x, -2]),
      capsules(2.6, dusk(leather, shade), [x, -2.6, x, -0.6]),
      capsules(1.2, dusk([214, 200, 172], shade), [x - 1.2, -2.7, x + 1.2, -2.7]),
    );
    skin.piece(`foot.${side}`, capsules(1.6, dusk(leatherShade, shade), [x - 0.3, -0.5, x + 1.5, -0.5]));
  };
  leg('l', -1.7, 0.3);
  leg('r', 1.7, 0);
  skin.piece(
    'spine',
    fills(tunic, [
      [-3.6, -17.8],
      [3.8, -17.8],
      [4.4, -8.6],
      [2.4, -7.4],
      [-2.6, -7.4],
      [-4.2, -8.6],
    ]),
    fills(tunicShade, [
      [-3.6, -17.8],
      [-1.4, -17.8],
      [-1.8, -7.4],
      [-2.6, -7.4],
      [-4.2, -8.6],
    ]),
    capsules(1.3, leather, [-4, -10, 4.2, -10]),
    discs(gold, [1.8, -10, 0.8, 0.7]),
    // Shoulder clasps of the cloak.
    discs(gold, [-3, -17.2, 0.7], [3, -17.2, 0.7]),
  );
  const belted = new SceneNode();
  for (const paint of mjolnir(-2.6, -10.6, 0.8)) belted.add(paint);
  skin.piece('spine', belted);
  // Head: a round face with dot eyes, no mouth or nose; the beard hides the jaw, the hair falls behind.
  skin.piece(
    'head',
    fills(beardShade, [
      [-4.6, -26],
      [-1, -27.6],
      [-1.4, -19],
      [-4.2, -17.6],
      [-5.4, -20.4],
    ]),
    discs(skinTone, [0.6, -23.4, 5.3, 5.2]),
    fills(beard, [
      [-4.6, -24],
      [-3.4, -27.4],
      [0.4, -29],
      [4, -28.4],
      [6, -26],
      [5.6, -25.4],
      [2.6, -26.6],
      [-0.6, -26],
      [-2.2, -22.4],
      [-4, -21.2],
    ]),
    fills(beard, [
      [-0.8, -21.4],
      [1.6, -21],
      [4, -21.4],
      [5.9, -22.2],
      [5.8, -19.4],
      [4.2, -16.4],
      [1.8, -15.2],
      [-0.4, -16.6],
      [-1.4, -19.2],
    ]),
    capsules(0.55, beardShade, [1.8, -20, 2.2, -16.2], [3.8, -20.2, 3.6, -17]),
    discs(ink, [2.2, -23.7, 0.6, 0.66], [4.6, -23.6, 0.55, 0.62]),
  );
  skin.piece('arm.r.1', capsules(2.7, tunic, [3.7, -16.6, 3.7, -12.6]));
  const hammer = new SceneNode();
  for (const paint of mjolnir(3.7, -8.6)) hammer.add(paint);
  // A drinking horn, pale with a dark rim, its mouth up.
  const horn = new SceneNode();
  horn.add(
    fills([216, 192, 146], [
      [3.4, -8.2],
      [4.4, -8.8],
      [6.4, -11.4],
      [7.2, -13.6],
      [5.2, -13.8],
      [4.8, -11.6],
    ]),
  );
  horn.add(capsules(0.8, leatherShade, [5, -13.8, 7.3, -13.6]));
  skin.piece('hand.r', hammer, horn);
  skin.piece(
    'arm.r.2',
    capsules(2.4, skinTone, [3.7, -12.6, 3.7, -9.4]),
    capsules(2.6, leather, [3.7, -11.6, 3.7, -9.9]),
    discs(skinTone, [3.7, -8.6, 1.35]),
  );
  node.add(boulder);
  return { node, figure, skin, hammer, belted, horn, seat, boulder, shadow };
}
export enum ThorPose {
  Idle,
  Walk,
  Run,
  /** Getting up from a crouch after his bolt; `t` runs 0..1. */
  Rise,
  /** The overhand swing that lets the hammer go; `t` is seconds into it. */
  Throw,
  Sit,
  /** A gesture played once (cheer, admire, a drink); `t` is seconds into it. */
  Cheer,
  Admire,
  Drink,
  /** Bending to a boulder, heaving it overhead, holding it there; `t` is seconds into the lift. */
  Lift,
}
const clips = humanoidClips;
/** A seated pose: thighs forward, shins down, the trunk a little forward over the knees. */
function sitting(figure: RigFigure, pose: RigPose): void {
  const { skeleton } = figure;
  for (const side of ['l', 'r']) {
    pose.angle[skeleton.bone(`leg.${side}.1`)] = -1.45;
    pose.angle[skeleton.bone(`leg.${side}.2`)] = 1.45;
    pose.angle[skeleton.bone(`foot.${side}`)] = 0;
  }
  pose.angle[skeleton.bone('spine')] += 0.12;
}
const smooth = (t: number) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};
/** Both arms reach down and forward to a load (`up` 0) or straight overhead with it (`up` 1). */
function armsUp(figure: RigFigure, pose: RigPose, up: number, bob: number): void {
  const { skeleton } = figure;
  for (const side of ['l', 'r']) {
    pose.angle[skeleton.bone(`arm.${side}.1`)] = -0.7 - 2.25 * up + bob;
    pose.angle[skeleton.bone(`arm.${side}.2`)] = -0.25 - 0.2 * up;
    pose.angle[skeleton.bone(`hand.${side}`)] = 0;
  }
}
/** Poses Thor; `elapsed` seconds since the last frame ease one motion into the next. */
export function poseThor(parts: ThorParts, pose: ThorPose, t: number, clock: number, elapsed: number): void {
  const { figure } = parts,
    frame = (clip: RigClip, at: number) => Math.max(0, Math.min(clip.frames - 0.01, at));
  parts.seat.opacity(pose === ThorPose.Sit ? 255 : 0);
  switch (pose) {
    case ThorPose.Walk:
      figure.play(clips.walk, t, elapsed);
      break;
    case ThorPose.Run:
      figure.play(clips.run, t, elapsed);
      break;
    case ThorPose.Rise:
      figure.play(clips.kneel, frame(clips.kneel, (1 - t) * clips.kneel.frames), elapsed, 0.05);
      break;
    case ThorPose.Throw: {
      const contact = clips.slash.markers.contact ?? 26;
      figure.play(clips.slash, frame(clips.slash, contact - 9 + t * 30), elapsed, 0.08);
      break;
    }
    case ThorPose.Sit:
      figure.play(clips.idle, (clock * 30) % clips.idle.frames, elapsed, 0.3, (p) => sitting(figure, p));
      break;
    case ThorPose.Cheer:
      figure.play(clips.shout, frame(clips.shout, t * 30), elapsed, 0.2);
      break;
    case ThorPose.Admire:
      figure.play(clips.admire, frame(clips.admire, t * 30), elapsed, 0.2);
      break;
    case ThorPose.Drink: {
      // The horn up to his beard, his head back for a long draught, and down again.
      const lift = t < 0.5 ? smooth(t / 0.5) : t < 1.6 ? 1 : 1 - smooth((t - 1.6) / 0.6);
      figure.play(clips.idle, (clock * 30) % clips.idle.frames, elapsed, 0.2, (p) => {
        const { skeleton } = figure;
        p.angle[skeleton.bone('arm.r.1')] += -1.5 * lift;
        p.angle[skeleton.bone('arm.r.2')] += -2.2 * lift;
        p.angle[skeleton.bone('hand.r')] += 0.5 * lift;
        p.angle[skeleton.bone('head')] += -0.18 * lift;
      });
      break;
    }
    case ThorPose.Lift: {
      // Bend to the boulder, heave it up, hold it overhead, set it down.
      const crouch = t < 1 ? smooth(t) : t < 1.6 ? 1 - smooth((t - 1) / 0.6) : t < 3.6 ? 0 : t < 4.4 ? smooth((t - 3.6) / 0.8) * 0.6 : 0,
        up = t < 1 ? 0 : t < 1.6 ? smooth((t - 1) / 0.6) : t < 3.6 ? 1 : t < 4.4 ? 1 - smooth((t - 3.6) / 0.8) : 0,
        bob = t >= 1.6 && t < 3.6 ? Math.sin((t - 1.6) * 5) * 0.06 : 0;
      figure.play(clips.kneel, frame(clips.kneel, crouch * clips.kneel.frames * 0.55), elapsed, 0.15, (p) => armsUp(figure, p, up, bob));
      break;
    }
    default:
      figure.play(clips.idle, (clock * 30) % clips.idle.frames, elapsed, 0.3);
  }
  parts.skin.pose(Array.from({ length: figure.skeleton.count }, (_, bone) => figure.frame.matrix(bone)));
}
/** Where his two hands are now, in his own units: for a boulder held between them. */
export function thorHands(parts: ThorParts): { x: number; y: number } {
  const { figure } = parts,
    l = figure.frame.joint(figure.skeleton.bone('hand.l')),
    r = figure.frame.joint(figure.skeleton.bone('hand.r'));
  return { x: (l.x + r.x) / 2, y: Math.min(l.y, r.y) };
}
