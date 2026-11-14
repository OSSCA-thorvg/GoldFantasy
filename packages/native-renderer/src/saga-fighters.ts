// Odin and his brothers, built from design sheets traced with the Aurum vectorizer (see
// saga-fighter-parts.ts). In the fight each is hung joint by joint so legs, cloaks, hair and a
// drawn spear arm can move; at rest they are whole traced figures with a few loose pieces.

import { SceneNode, ShapeNode } from './paint';
import { oval, pen, trace } from './outline-form';
import { limbJoints, threadCurve } from './rig-limb-path';
import { flat, lock, stroke, turn } from './saga-panel';
import {
  ochreRigParts,
  odinRigParts,
  odinStandingParts,
  shoreTrioParts,
  slateRigParts,
  type TracedPart,
} from './saga-fighter-parts';

export interface Fighter {
  /** Feet at the origin, facing right, in the sheet's pixels: Odin stands about 330 tall. */
  readonly scene: SceneNode;
  /** Turns the spear arm about the shoulder: negative raises it back, 0 is the level thrust. */
  aim(radians: number): void;
  /** A glint on the spear's point, 0..1. */
  gleam(amount: number): void;
  /** Lets cape, hair and beard stream and settle. */
  flutter(seconds: number): void;
}
/** A part that swings about a pivot. */
interface Flap {
  node: SceneNode;
  x: number;
  y: number;
  reach: number;
  phase: number;
}

/** Builds one traced path: absolute M, L, C and Z only, as the vectorizer writes them. */
function tracedShape(d: string): ShapeNode {
  const shape = new ShapeNode();
  for (const [, command, body] of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const v = body.trim() ? body.trim().split(/\s+/).map(Number) : [];
    if (command === 'M') shape.moveTo(v[0], v[1]);
    else if (command === 'L') shape.lineTo(v[0], v[1]);
    else if (command === 'C') shape.cubicTo(v[0], v[1], v[2], v[3], v[4], v[5]);
    else shape.close();
  }
  return shape;
}
function traced(part: TracedPart, x = 0, y = 0): SceneNode {
  const scene = new SceneNode();
  for (const [fill, d, evenOdd] of part) {
    const shape = tracedShape(d).fill(fill[0], fill[1], fill[2]);
    scene.add(evenOdd ? shape.fillRule('evenOdd') : shape);
  }
  return scene.translate(x, y);
}
/** Places a traced part by its joint: scaled, turned, then moved there. Turning swings what hangs below it back. */
function hang(node: SceneNode, x: number, y: number, radians: number, scale = 1): SceneNode {
  const c = Math.cos(radians) * scale,
    s = Math.sin(radians) * scale;
  return node.transform([c, -s, x, s, c, y, 0, 0, 1]);
}
/** A hung part that keeps swinging about its joint. */
interface Hinge {
  node: SceneNode;
  x: number;
  y: number;
  rest: number;
  scale: number;
  reach: number;
  phase: number;
}
/**
 * A two-bone limb as ONE path, the way the game's own figures draw theirs: a single round-capped
 * stroke threaded through shoulder, elbow and hand (or hip, knee and ankle). The bones keep
 * their length and the middle joint always bends to the same side, so it can neither stretch
 * nor flip.
 */
interface Limb {
  /** Lengths of the two bones. */
  upper: number;
  lower: number;
  /** Which side the middle joint bends to: +1 clockwise of the line from root to end. */
  bend: 1 | -1;
  width: number;
  color: readonly [number, number, number];
}
function drawLimb(
  shape: ShapeNode,
  limb: Limb,
  rootX: number,
  rootY: number,
  endX: number,
  endY: number,
): [number, number] {
  const dx = endX - rootX,
    dy = endY - rootY,
    reach = Math.max(
      Math.abs(limb.upper - limb.lower) + 1,
      Math.min(limb.upper + limb.lower - 1, Math.hypot(dx, dy)),
    ),
    toward = Math.atan2(dy, dx),
    // Law of cosines: the angle at the root between the line to the end and the first bone.
    open = Math.acos((limb.upper ** 2 + reach ** 2 - limb.lower ** 2) / (2 * limb.upper * reach)),
    way = toward + limb.bend * open,
    midX = rootX + Math.cos(way) * limb.upper,
    midY = rootY + Math.sin(way) * limb.upper,
    tipX = rootX + Math.cos(toward) * reach,
    tipY = rootY + Math.sin(toward) * reach;
  threadCurve(shape.reset(), limbJoints(rootX, rootY, midX, midY, tipX, tipY, 0.35))
    .strokeWidth(limb.width)
    .strokeCap('round')
    .strokeJoin('round')
    .strokeFill(...limb.color);
  return [tipX, tipY];
}
/** A leg and its boot. The boot stands flat on the ground under the ankle. */
function leg(
  scene: SceneNode,
  limb: Limb,
  hip: readonly [number, number],
  ankle: readonly [number, number],
  boot: readonly [number, number, number],
): void {
  const shape = new ShapeNode(),
    [ax, ay] = drawLimb(shape, limb, hip[0], hip[1], ankle[0], ankle[1]),
    r = limb.width * 0.56;
  scene.add(shape).add(
    flat(
      [
        pen(ax - r, ay - r * 0.6)
          .curve([ax - r * 1.1, ay * 0.5], [ax - r * 1.2, -3])
          .curve([ax - r * 1.1, 2], [ax - r * 0.5, 3])
          .curve([ax + r * 1.2, 4], [ax + r * 2.3, 2])
          .curve([ax + r * 2.6, -3], [ax + r * 2.1, -r * 0.8])
          .curve([ax + r * 1.4, -r * 1.2], [ax + r * 1.05, ay * 0.5])
          .curve([ax + r * 1.05, ay * 0.8], [ax + r, ay - r * 0.6])
          .curve([ax, ay - r], [ax - r, ay - r * 0.6])
          .close(),
      ],
      [...boot],
    ),
  );
}
/** What the spear arm needs: where it hangs and where the fist goes between draw and thrust. */
interface ArmSpec {
  shoulder: readonly [number, number];
  limb: Limb;
  /** The fist relative to the shoulder at full draw and at the thrust. */
  drawn: readonly [number, number];
  thrust: readonly [number, number];
  /** How far the shaft runs behind and ahead of the fist. */
  behind: number;
  ahead: number;
}
/** The spear arm: one limb path from shoulder to fist, and the spear turning in that fist. */
function spearArm(spec: ArmSpec): { nodes: SceneNode; aim(radians: number): void; glint: ShapeNode } {
  const nodes = new SceneNode(),
    spear = new SceneNode(),
    arm = new ShapeNode(),
    fist = new ShapeNode(),
    girth = spec.limb.width,
    tip = spec.ahead + 54,
    glint = flat(
      [lock(tip, 26, tip, -26, 14, 0), lock(tip - 26, 0, tip + 26, 0, 14, 0)],
      [255, 250, 232],
    ).opacity(0);
  spear
    .add(
      stroke(
        [
          [-spec.behind, 0],
          [-spec.behind / 3, 0],
          [spec.ahead / 2, 0],
          [spec.ahead, 0],
        ],
        girth * 0.24,
        [138, 104, 72],
      ),
    )
    .add(flat([lock(spec.ahead - 10, 0, spec.ahead + 64, 0, girth * 0.8, 0)], [233, 209, 183]))
    .add(glint);
  nodes.add(spear).add(arm).add(fist);
  return {
    nodes,
    glint,
    aim(radians) {
      // `radians` runs from about -0.5 (drawn back) to about 0.25 (driven home).
      const t = Math.max(0, Math.min(1, (radians + 0.5) / 0.75)),
        [sx, sy] = spec.shoulder,
        [hx, hy] = drawLimb(
          arm,
          spec.limb,
          sx,
          sy,
          sx + spec.drawn[0] + (spec.thrust[0] - spec.drawn[0]) * t,
          sy + spec.drawn[1] + (spec.thrust[1] - spec.drawn[1]) * t,
        );
      trace(fist.reset(), [oval(hx, hy, girth * 0.44, girth * 0.42)]).fill(234, 187, 165);
      turn(spear, 0, 0, radians, hx, hy);
    },
  };
}
function fighter(scene: SceneNode, arm: ReturnType<typeof spearArm>, hinges: readonly Hinge[]): Fighter {
  arm.aim(0);
  return {
    scene,
    aim: (radians) => arm.aim(radians),
    gleam: (amount) => arm.glint.opacity(Math.round(255 * Math.max(0, Math.min(1, amount)))),
    flutter: (seconds) => {
      for (const h of hinges)
        hang(h.node, h.x, h.y, h.rest + h.reach * Math.sin(seconds * 2.6 + h.phase), h.scale);
    },
  };
}
const hinge = (
  hinges: Hinge[],
  part: TracedPart,
  x: number,
  y: number,
  rest: number,
  scale: number,
  reach: number,
  phase: number,
): SceneNode => {
  const node = hang(traced(part), x, y, rest, scale);
  hinges.push({ node, x, y, rest, scale, reach, phase });
  return node;
};

/**
 * A brother: head, torso, cloak and shield from the traced sheet; the legs and the spear arm
 * drawn as single limb paths. Feet at the origin, facing right, about 470 tall.
 */
export function spearman(kind: 'slate' | 'ochre'): Fighter {
  const parts = kind === 'slate' ? slateRigParts : ochreRigParts,
    scene = new SceneNode(),
    upper = new SceneNode(),
    hinges: Hinge[] = [],
    neck: [number, number] = [40, -330],
    legs = { upper: 70, lower: 70, bend: -1, width: 44, color: [97, 99, 112] } as const,
    boot = [88, 80, 78] as const,
    arm = spearArm({
      shoulder: [30, -304],
      limb: { upper: 58, lower: 58, bend: 1, width: 40, color: [97, 99, 112] },
      drawn: [-30, -24],
      thrust: [104, 14],
      behind: 190,
      ahead: 250,
    });
  scene.add(hinge(hinges, parts.cloak, neck[0] - 6, neck[1] + 4, 0.5, 1, 0.05, 0));
  leg(scene, { ...legs, color: [71, 70, 77] }, [-4, -128], [-112, -30], boot);
  leg(scene, legs, [24, -128], [106, -30], boot);
  upper
    .add(hang(traced(parts.torso), neck[0], neck[1], 0.2))
    .add(hang(traced(parts.head), neck[0] + 10, neck[1] + 6, 0.08))
    .add(arm.nodes)
    // The shield rides on the leading arm, in front of everything.
    .add(traced(parts.shield, 128, -200));
  scene.add(upper);
  return fighter(scene, arm, hinges);
}
/**
 * Odin charging: head, robe, cape, hair and beard from the traced sheet; the legs and the spear
 * arm drawn as single limb paths. Feet at the origin, facing right, about 560 tall.
 */
export function allfatherLunging(): Fighter {
  const parts = odinRigParts,
    scene = new SceneNode(),
    hinges: Hinge[] = [],
    neck: [number, number] = [120, -362],
    legs = { upper: 92, lower: 92, bend: -1, width: 52, color: [74, 76, 92] } as const,
    boot = [64, 63, 76] as const,
    arm = spearArm({
      shoulder: [98, -330],
      limb: { upper: 88, lower: 88, bend: 1, width: 54, color: [54, 72, 123] },
      drawn: [-44, -40],
      thrust: [162, 16],
      behind: 280,
      ahead: 500,
    });
  scene.add(hinge(hinges, parts.cape, neck[0] - 8, neck[1], 1.05, 0.72, 0.05, 0.6));
  leg(scene, { ...legs, color: [58, 60, 76] }, [4, -160], [-150, -34], boot);
  leg(scene, legs, [38, -160], [150, -34], boot);
  scene
    .add(hang(traced(parts.robe), neck[0], neck[1], 0.5, 0.68))
    .add(hinge(hinges, parts.hair, neck[0] - 30, neck[1] - 72, 0.1, 1, 0.08, 0.4))
    .add(hang(traced(parts.head), neck[0] + 8, neck[1], 0.15))
    .add(hinge(hinges, parts.beard, neck[0] + 62, neck[1] - 44, 0.5, 0.55, 0.06, 2))
    .add(arm.nodes);
  return fighter(scene, arm, hinges);
}
/**
 * Odin at rest, traced from the reference for the last panel: feet at the origin, about 440 tall,
 * facing left, hands at his sides, hair and cape lifting behind him.
 */
export function allfatherStanding(): Fighter {
  const scene = new SceneNode(),
    cape = traced(odinStandingParts.cape),
    hair = traced(odinStandingParts.hair),
    flaps: Flap[] = [
      { node: cape, x: 20, y: -310, reach: 0.035, phase: 0.6 },
      { node: hair, x: 30, y: -350, reach: 0.045, phase: 0.1 },
    ];
  // The long white hair lies over the cape and lifts with it.
  scene.add(cape).add(traced(odinStandingParts.body)).add(hair).add(traced(odinStandingParts.head));
  return {
    scene,
    // He carries no spear here.
    aim: () => {},
    gleam: () => {},
    flutter: (seconds) => {
      for (const f of flaps) turn(f.node, f.x, f.y, f.reach * Math.sin(seconds * 2.6 + f.phase));
    },
  };
}

/** Which paths of a traced part swing, and how: [path index, pivot x, pivot y, reach, phase]. */
type Loose = readonly [index: number, x: number, y: number, reach: number, phase: number];
/** A traced part whose listed paths turn about their pivots; the rest stay put. */
function tracedRig(part: TracedPart, loose: readonly Loose[], flaps: Flap[], dx = 0): SceneNode {
  const scene = new SceneNode();
  part.forEach(([fill, d, evenOdd], index) => {
    const shape = tracedShape(d).fill(fill[0], fill[1], fill[2]);
    if (evenOdd) shape.fillRule('evenOdd');
    const swing = loose.find((entry) => entry[0] === index);
    if (!swing) {
      scene.add(shape);
      return;
    }
    const node = new SceneNode().add(shape);
    flaps.push({ node, x: swing[1], y: swing[2], reach: swing[3], phase: swing[4] });
    scene.add(node);
  });
  return scene.translate(dx, 0);
}
/**
 * The three after the fight, traced from the clean design sheet: Odin standing with his spear
 * grounded, a brother kneeling on either side. Odin's feet are at the origin; he is about 780
 * tall, so scale it to the shore. `sway` stirs hair, fur, cloaks and the tip of Odin's hat.
 */
export function shoreTrio(): { scene: SceneNode; sway(seconds: number): void } {
  const flaps: Flap[] = [],
    scene = new SceneNode()
      .add(
        tracedRig(
          shoreTrioParts.slate,
          [
            [0, 20, -330, 0.012, 0.3],
            [5, 30, -290, 0.07, 1.1],
          ],
          flaps,
          -400,
        ),
      )
      .add(
        tracedRig(
          shoreTrioParts.ochre,
          [
            [0, 10, -290, 0.01, 2.2],
            [8, 20, -270, 0.07, 0.2],
          ],
          flaps,
          400,
        ),
      )
      .add(
        tracedRig(
          shoreTrioParts.odin,
          [
            // Cape, hair and beard (one piece in this tracing), the crown of the hat.
            [1, -118, -340, 0.03, 0.6],
            [2, 20, -610, 0.018, 0.4],
            [6, 0, -600, 0.04, 3],
          ],
          flaps,
        ),
      );
  return {
    scene,
    sway(seconds) {
      for (const f of flaps) turn(f.node, f.x, f.y, f.reach * Math.sin(seconds * 1.6 + f.phase));
    },
  };
}
