// Odin and his brothers, traced whole from design sheets with the Aurum vectorizer (see
// saga-fighter-parts.ts). Nothing is jointed. In the fight, cloth and hair move because their
// outline points ride a travelling wave, and Odin's blow is three drawn poses shown in turn over
// planted feet; at rest a few traced pieces turn about a pivot.

import { SceneNode, ShapeNode } from './paint';
import { pen, type Form } from './outline-form';
import { alphaOf, flat, span, stroke, turn } from './saga-panel';
import {
  ochreGuardParts,
  odinCoiledParts,
  odinHeldParts,
  odinStandingParts,
  odinThrustParts,
  shoreTrioParts,
  slateGuardParts,
  type TracedPart,
} from './saga-fighter-parts';

/** A traced path as numbers: its commands (absolute M, L, C and Z only) and their coordinates in order. */
interface Outline {
  kinds: string;
  at: number[];
}
function outlineOf(d: string): Outline {
  const at: number[] = [];
  let kinds = '';
  for (const [, kind, body] of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    kinds += kind;
    if (body.trim()) at.push(...body.trim().split(/\s+/).map(Number));
  }
  return { kinds, at };
}
function emit(shape: ShapeNode, kinds: string, at: ArrayLike<number>): ShapeNode {
  let i = 0;
  for (const kind of kinds) {
    if (kind === 'M') shape.moveTo(at[i], at[i + 1]);
    else if (kind === 'L') shape.lineTo(at[i], at[i + 1]);
    else if (kind === 'C') shape.cubicTo(at[i], at[i + 1], at[i + 2], at[i + 3], at[i + 4], at[i + 5]);
    else shape.close();
    i += kind === 'C' ? 6 : kind === 'Z' ? 0 : 2;
  }
  return shape;
}
function tracedShape(d: string): ShapeNode {
  const outline = outlineOf(d);
  return emit(new ShapeNode(), outline.kinds, outline.at);
}
function traced(part: TracedPart): SceneNode {
  const scene = new SceneNode();
  for (const [fill, d, evenOdd] of part) {
    const shape = tracedShape(d).fill(fill[0], fill[1], fill[2]);
    scene.add(evenOdd ? shape.fillRule('evenOdd') : shape);
  }
  return scene;
}

/**
 * Cloth or hair pinned at one end. A point swings across `flow`, more the further along it lies,
 * and a ripple travels out to the free end. The swing dies away at the `guard` line, so whatever
 * the cloth lies against (the body, a planted boot) keeps still.
 */
interface Streamer {
  /** Where it is pinned, and the unit direction it trails away in. */
  pin: readonly [x: number, y: number];
  flow: readonly [x: number, y: number];
  /** How far along the flow the swing reaches full strength. */
  reach: number;
  /** A point on the guard line, its unit normal toward the free cloth, and how far out the swing is whole. */
  guard?: readonly [x: number, y: number, nx: number, ny: number, soft: number];
  /** Peak swing in sheet pixels, the ripple's wavelength, and its pace in radians a second. */
  swing: number;
  ripple: number;
  pace: number;
}
/** One traced path of a flowing part: how freely each point swings on each streamer, and how late. */
interface Sheet {
  shape: ShapeNode;
  outline: Outline;
  give: Float64Array;
  lag: Float64Array;
  now: Float64Array;
}
/** A traced part whose outline points ride streamers, so it stays one piece while it moves. */
class Flowing {
  readonly scene = new SceneNode();
  private readonly sheets: Sheet[] = [];
  constructor(
    part: TracedPart,
    private readonly streamers: readonly Streamer[],
  ) {
    const n = streamers.length;
    for (const [fill, d, evenOdd] of part) {
      const outline = outlineOf(d),
        shape = emit(new ShapeNode(), outline.kinds, outline.at).fill(fill[0], fill[1], fill[2]),
        give = new Float64Array((outline.at.length / 2) * n),
        lag = new Float64Array(give.length);
      for (let i = 0; i < outline.at.length; i += 2)
        streamers.forEach((s, j) => {
          const x = outline.at[i],
            y = outline.at[i + 1],
            along = (x - s.pin[0]) * s.flow[0] + (y - s.pin[1]) * s.flow[1],
            g = s.guard;
          give[(i / 2) * n + j] =
            span(along, 0, s.reach) * (g ? span((x - g[0]) * g[2] + (y - g[1]) * g[3], 0, g[4]) : 1);
          lag[(i / 2) * n + j] = (along / s.ripple) * Math.PI * 2;
        });
      this.scene.add(evenOdd ? shape.fillRule('evenOdd') : shape);
      // A path no streamer reaches is drawn once and left alone.
      if (give.some((v) => v > 0))
        this.sheets.push({ shape, outline, give, lag, now: new Float64Array(outline.at.length) });
    }
  }
  /** `gust` is a steady wind from ahead, in units of each streamer's own swing. */
  flutter(seconds: number, gust = 0): void {
    const n = this.streamers.length;
    for (const { shape, outline, give, lag, now } of this.sheets) {
      for (let i = 0; i < now.length; i += 2) {
        let x = outline.at[i],
          y = outline.at[i + 1];
        for (let j = 0; j < n; j++) {
          const s = this.streamers[j],
            at = (i / 2) * n + j,
            push = give[at] * s.swing * (Math.sin(seconds * s.pace - lag[at]) + gust);
          x -= s.flow[1] * push;
          y += s.flow[0] * push;
        }
        now[i] = x;
        now[i + 1] = y;
      }
      emit(shape.reset(), outline.kinds, now);
    }
  }
}

// Where the cloth of each drawing hangs from, measured on the sheets.
const coiledCape: Streamer = {
  pin: [-48, -271],
  flow: [-0.708, 0.706],
  reach: 260,
  guard: [-20, -232, -0.799, -0.602, 80],
  swing: 9,
  ripple: 230,
  pace: 3.1,
};
const coiledTail: Streamer = {
  pin: [-50, -252],
  flow: [-0.93, 0.37],
  reach: 75,
  swing: 4,
  ripple: 90,
  pace: 4.3,
};
const coiledBeard: Streamer = {
  pin: [70, -282],
  flow: [0, 1],
  reach: 120,
  guard: [14, -282, 1, 0, 25],
  swing: 4,
  ripple: 170,
  pace: 2.7,
};
const thrustCape: Streamer = {
  pin: [46, -247],
  flow: [-0.875, 0.484],
  reach: 290,
  guard: [40, -233, -0.684, -0.73, 80],
  swing: 9,
  ripple: 250,
  pace: 3.1,
};
const thrustHair: Streamer = {
  pin: [81, -292],
  flow: [-0.97, 0.243],
  reach: 160,
  swing: 7,
  ripple: 130,
  pace: 4.6,
};
const guardCloak: Streamer = {
  pin: [0, -580],
  flow: [0, 1],
  reach: 470,
  guard: [-54, -480, -0.982, -0.186, 70],
  swing: 10,
  ripple: 520,
  pace: 1.9,
};

/** How far along the spear its point lies from the grip. */
const spearReach = 372;
/** Odin's spear, drawn rather than traced so it stays straight: the grip at the origin, the point to the right. */
function gungnir(): SceneNode {
  const neck = spearReach - 34;
  return new SceneNode()
    .add(
      stroke(
        [
          [-102, 0],
          [neck + 6, 0],
        ],
        12,
        [134, 92, 60],
      ),
    )
    .add(
      flat(
        [
          pen(neck, 0)
            .curve([neck + 18, -13], [neck + 66, 0])
            .curve([neck + 18, 13], [neck, 0])
            .close(),
        ],
        [246, 227, 202],
      ),
    );
}
/** A four-pointed glint about the origin: tall rays, shorter arms. */
const sparkle = (r: number): Form => [
  pen(0, -r)
    .line(r * 0.12, -r * 0.12)
    .line(r * 0.72, 0)
    .line(r * 0.12, r * 0.12)
    .line(0, r)
    .line(-r * 0.12, r * 0.12)
    .line(-r * 0.72, 0)
    .line(-r * 0.12, -r * 0.12)
    .close(),
];

export type Stance = 'coiled' | 'thrust' | 'held';
/** One moment of Odin's blow. */
export interface StrikeBeat {
  /** Which drawing shows: spear cocked overhead, driven home, or held after the blow. */
  stance: Stance;
  /** Leans him over planted feet: negative back, positive into the blow. */
  lean: number;
  /** Sinks him into his knees, 0..1. */
  crouch: number;
  /** Turns the spear in his fist, radians: negative lifts the point. */
  spear: number;
  /** A glint on the spear's point, 0..1. */
  gleam: number;
  /** Wind from ahead, in units of each cloth's own swing: lifts cape, hair and beard. */
  gust: number;
}
export interface Striker {
  /**
   * The ground midway between his boots is the origin; he faces right, about 420 tall in the
   * sheet's pixels. Driven home and upright, the spear's point lies 660 ahead and 226 up.
   */
  readonly scene: SceneNode;
  act(beat: StrikeBeat, seconds: number): void;
}
/** Odin striking the giant: three traced poses over the same planted boots, one spear between them. */
export function allfatherStriking(): Striker {
  const spear = gungnir(),
    // Gold under white, so it shows against the night and against the ice alike.
    glint = new SceneNode().add(flat(sparkle(58), [250, 214, 134])).add(flat(sparkle(34), [255, 252, 240])),
    body = new SceneNode().add(spear),
    // Each drawing's fist, and how the spear lies in it.
    drawings = (
      [
        ['coiled', odinCoiledParts, [coiledCape], [coiledTail, coiledBeard], [-55, -308], -0.464],
        ['thrust', odinThrustParts, [thrustCape], [thrustHair], [258, -226], 0],
        ['held', odinHeldParts, [thrustCape], [thrustHair], [234, -224], 0],
      ] as const
    ).map(([stance, parts, cape, locks, grip, level]) => {
      const robe = new Flowing(parts.robe, cape),
        hair = new Flowing(parts.hair, locks),
        scene = new SceneNode().add(robe.scene).add(hair.scene).add(traced(parts.head));
      body.add(scene);
      return { stance, scene, robe, hair, grip, level };
    });
  body.add(glint);
  const striker: Striker = {
    scene: new SceneNode().add(body),
    act(beat, seconds) {
      for (const drawing of drawings) {
        const shown = drawing.stance === beat.stance;
        drawing.scene.opacity(shown ? 255 : 0);
        if (!shown) continue;
        const angle = drawing.level + beat.spear,
          // The glint sits on the point but keeps upright, and swells as it brightens.
          k = (0.55 + 0.45 * beat.gleam) * (1 + 0.07 * Math.sin(seconds * 9));
        turn(spear, 0, 0, angle, drawing.grip[0], drawing.grip[1]);
        glint.transform([
          k,
          0,
          drawing.grip[0] + Math.cos(angle) * spearReach,
          0,
          k,
          drawing.grip[1] + Math.sin(angle) * spearReach,
          0,
          0,
          1,
        ]);
        drawing.robe.flutter(seconds, beat.gust);
        drawing.hair.flutter(seconds, beat.gust);
      }
      body.transform([1 + 0.02 * beat.crouch, -beat.lean, 0, 0, 1 - 0.035 * beat.crouch, 0, 0, 0, 1]);
      glint.opacity(alphaOf(beat.gleam));
    },
  };
  striker.act({ stance: 'coiled', lean: 0, crouch: 0, spear: 0, gleam: 0, gust: 0 }, 0);
  return striker;
}

export interface Guard {
  /** Feet at the origin, facing right, in the sheet's pixels: about 800 tall, the spear's point 940 up. */
  readonly scene: SceneNode;
  /** Stirs the cloak; `gust` blows it back, in units of its own swing. */
  flutter(seconds: number, gust?: number): void;
}
/** A brother standing guard with spear grounded and shield at his side: he does not strike. */
export function brotherOnGuard(kind: 'slate' | 'ochre'): Guard {
  const parts = kind === 'slate' ? slateGuardParts : ochreGuardParts,
    cloak = new Flowing(parts.cloak, [guardCloak]);
  return {
    scene: new SceneNode().add(cloak.scene).add(traced(parts.body)),
    flutter: (seconds, gust = 0) => cloak.flutter(seconds, gust),
  };
}

/** A part that swings about a pivot. */
interface Flap {
  node: SceneNode;
  x: number;
  y: number;
  reach: number;
  phase: number;
}
/**
 * Odin at rest, traced from the reference for the last panel: feet at the origin, about 440 tall,
 * facing left, hands at his sides, hair and cape lifting behind him.
 */
export function allfatherStanding(): { scene: SceneNode; flutter(seconds: number): void } {
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
