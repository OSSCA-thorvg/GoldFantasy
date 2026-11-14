// Ymir for the opening saga: one head and one body for every panel, rigged so mane and beard sway.
import { SceneNode, type Rgb } from './paint';
import { oval, pen, shapeOf, type Contour, type Form } from './outline-form';
import { dusk, paintForm } from './form-paint';
import { darkEye, flat, frost, iceGlint, lock, rime, sagaFinish, scatter, stroke, turn } from './saga-panel';

export type GiantEyes = 'shut' | 'half' | 'wide' | 'glare';
/** A lock that turns about its root. */
interface Strand {
  node: SceneNode;
  x: number;
  y: number;
  reach: number;
  phase: number;
}
export interface GiantHead {
  /** About 260 wide, chin at the origin. */
  readonly scene: SceneNode;
  look(eyes: GiantEyes): void;
  /** Lets mane and beard swing; `amount` 0 holds them still. */
  sway(seconds: number, amount?: number): void;
}
export interface Giant {
  /** In the head's own units, chin at the origin: scale and place it per panel. */
  readonly scene: SceneNode;
  readonly head: GiantHead;
  readonly body: SceneNode;
  sway(seconds: number, amount?: number): void;
}
const deepShade: Rgb = [108, 132, 186];

function strand(
  scene: SceneNode,
  shape: Contour,
  x: number,
  y: number,
  reach: number,
  phase: number,
  rim: number,
): Strand {
  const node = new SceneNode();
  paintForm(node, [shape], rime, { ink: 0, rim });
  scene.add(node);
  return { node, x, y, reach, phase };
}
export function giantHead(): GiantHead {
  const scene = new SceneNode(),
    strands: Strand[] = [],
    count = 13;
  // The mane: a pale mass behind the face, every spike free to swing on its root.
  scene.add(flat([oval(0, -122, 134, 136)], rime));
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (1.08 - (1.16 * i) / (count - 1)),
      reach = 196 + 60 * scatter(i, 9),
      cx = Math.cos(a),
      sy = Math.sin(a),
      x = cx * 96,
      y = -122 - sy * 100;
    strands.push(
      strand(
        scene,
        lock(x, y, cx * reach * 0.94, -122 - sy * reach, 82, i % 2 ? 0.14 : -0.14),
        x,
        y,
        0.045,
        i * 0.7,
        8,
      ),
    );
  }
  paintForm(
    scene,
    [
      pen(-96, -150)
        .curve([-70, -214], [0, -232], [70, -214], [96, -150])
        .curve([98, -100], [88, -60])
        .curve([50, -12], [0, 2], [-50, -12], [-88, -60])
        .curve([-98, -100], [-96, -150])
        .close(),
    ],
    frost,
    sagaFinish,
  );
  // Deep-set eyes in shadowed sockets; the brow drawn after them cuts their tops.
  const navy: Rgb = [34, 40, 78],
    eyes: Record<GiantEyes, SceneNode> = {
      shut: new SceneNode(),
      half: new SceneNode(),
      wide: new SceneNode(),
      glare: new SceneNode(),
    };
  for (const side of [-1, 1]) {
    scene.add(
      flat(
        [
          pen(side * 12, -128)
            .curve([side * 50, -136], [side * 90, -130])
            .curve([side * 80, -100], [side * 48, -92], [side * 20, -102])
            .curve([side * 12, -114], [side * 12, -128])
            .close(),
        ],
        dusk(frost, 0.3),
      ),
    );
    eyes.wide.add(flat([oval(side * 46, -115, 11, 12)], darkEye));
    eyes.glare.add(flat([oval(side * 41, -108, 11, 12)], darkEye));
    eyes.half.add(
      flat(
        [
          pen(side * 30, -112)
            .curve([side * 46, -118], [side * 62, -112])
            .curve([side * 46, -102], [side * 30, -112])
            .close(),
        ],
        navy,
      ),
    );
    eyes.shut.add(
      stroke(
        [
          [side * 28, -110],
          [side * 38, -104],
          [side * 52, -103],
          [side * 62, -108],
        ],
        5,
        navy,
      ),
    );
  }
  for (const pair of Object.values(eyes)) scene.add(pair);
  // Weathered cheeks, and a brow that bears down on the eyes.
  for (const side of [-1, 1]) {
    scene.add(
      stroke(
        [
          [side * 78, -96],
          [side * 70, -84],
          [side * 56, -78],
          [side * 40, -80],
        ],
        4,
        dusk(frost, 0.3),
      ),
    );
    scene.add(
      flat(
        [
          pen(side * 6, -136)
            .curve([side * 50, -150], [side * 102, -146])
            .curve([side * 60, -128], [side * 6, -120])
            .close(),
        ],
        dusk(frost, 0.34),
      ),
    );
  }
  paintForm(scene, [lock(-8, -140, -122, -180, 48, -0.12), lock(8, -140, 122, -180, 48, 0.12)], rime, {
    ink: 0,
    rim: 4,
  });
  // The beard: a band under the face, and icicles that swing like a slow wave across it.
  paintForm(
    scene,
    [
      pen(-92, -92)
        .curve([-40, -74], [0, -70], [40, -74], [92, -92])
        .curve([92, -60], [60, -30], [0, -22], [-60, -30], [-92, -60])
        .close(),
    ],
    rime,
    { ink: 0, rim: 6 },
  );
  for (let i = 0; i < 7; i++) {
    const x = -78 + i * 26,
      drop = 104 + 84 * Math.sin((i / 6) * Math.PI) + 24 * scatter(i, 10);
    strands.push(
      strand(
        scene,
        lock(x, -56, x + (i - 3) * 5, -56 + drop, 36, i % 2 ? 0.07 : -0.07),
        x,
        -56,
        0.05,
        2 + i * 0.5,
        5,
      ),
    );
  }
  for (const side of [-1, 1])
    strands.push(
      strand(scene, lock(side * 6, -84, side * 108, -50, 30, -side * 0.2), side * 6, -84, 0.03, side, 4),
    );
  const head: GiantHead = {
    scene,
    look(shown) {
      for (const [name, pair] of Object.entries(eyes)) pair.opacity(name === shown ? 255 : 0);
    },
    sway(seconds, amount = 1) {
      for (const s of strands) turn(s.node, s.x, s.y, s.reach * amount * Math.sin(seconds * 1.3 + s.phase));
    },
  };
  head.look('shut');
  return head;
}

/** A few broad planes of ice, lighter and darker, kept inside an outline. */
function frozen(body: Form, x: number, y: number, w: number, h: number, salt: number): SceneNode {
  const scene = new SceneNode();
  for (let i = 0; i < 9; i++) {
    const cx = x + w * (0.1 + 0.8 * scatter(i, salt)),
      cy = y + h * (0.15 + 0.8 * scatter(i, salt + 1)),
      r = 64 + 70 * scatter(i, salt + 2),
      lean = -0.5 + scatter(i, salt + 3);
    scene.add(
      flat(
        [
          pen(cx - r, cy + r * lean * 0.3)
            .curve([cx - r * 0.3, cy - r * 0.4], [cx + r * 0.5, cy - r * 0.5 + r * lean * 0.2])
            .curve([cx + r * 0.95, cy - r * 0.1], [cx + r * 0.7, cy + r * 0.34])
            .curve([cx, cy + r * 0.42], [cx - r, cy + r * lean * 0.3])
            .close(),
        ],
        i % 3 ? rime : dusk(frost, 0.22),
        i % 3 ? 60 : 110,
      ),
    );
  }
  return scene.clip(shapeOf(body));
}
/**
 * The whole giant, arms down at his sides. `breadth` widens the shoulders without changing the
 * head, so the same figure can loom larger in one panel than another.
 */
export function frostGiant(breadth = 1): Giant {
  const scene = new SceneNode(),
    body = new SceneNode(),
    head = giantHead(),
    b = breadth,
    torso: Form = [
      pen(-370 * b, 460)
        .curve(
          [-360 * b, 150],
          [-335 * b, 29],
          [-194 * b, -65],
          [0, -82],
          [194 * b, -65],
          [335 * b, 29],
          [360 * b, 150],
          [370 * b, 460],
        )
        .close(),
    ];
  paintForm(body, torso, frost, { ink: 0, rim: 12 });
  body.add(frozen(torso, -330 * b, 10, 660 * b, 420, 22));
  // The arms hang straight down, a shade darker than the chest.
  for (const side of [-1, 1])
    body.add(
      flat(
        [
          pen(side * 370 * b, 460)
            .curve([side * 362 * b, 170], [side * 322 * b, 40])
            .curve([side * 262 * b, 110], [side * 246 * b, 250], [side * 250 * b, 460])
            .close(),
        ],
        dusk(frost, side > 0 ? 0.2 : 0.1),
        side > 0 ? 220 : 190,
      ).clip(shapeOf(torso)),
    );
  // A hard plane of shadow under the beard.
  body.add(
    flat(
      [pen(-88, 12).curve([-60, 76], [0, 118], [60, 76], [88, 12]).curve([0, 36], [-88, 12]).close()],
      dusk(frost, 0.14),
    ),
  );
  // Rime lies thick on his shoulders and hangs from them in locks.
  const mantle: Form = [
      pen(-347 * b, 53)
        .curve([-306 * b, -18], [-194 * b, -65], [0, -82], [194 * b, -65], [306 * b, -18], [347 * b, 53])
        .curve([288 * b, 12], [176 * b, -18], [0, -26], [-176 * b, -18], [-288 * b, 12])
        .close(),
    ],
    // Every lock of the mantle hangs from its own root, so the rime on his shoulders stirs.
    locks: Strand[] = [],
    hung = new SceneNode();
  for (let i = 0; i < 10; i++) {
    const x = (-300 + i * 66.5) * b,
      y = -6 - 35 * Math.sin((i / 9) * Math.PI);
    if (Math.abs(x) < 88) continue;
    const shape = lock(x, y, x + (i - 4.5) * 4.7, 53 + 35 * scatter(i, 25), 49 * b, i % 2 ? 0.1 : -0.1),
      node = new SceneNode().add(flat([shape], deepShade).translate(0, 15));
    paintForm(node, [shape], rime, { ink: 0, rim: 6 });
    hung.add(node);
    locks.push({ node, x, y, reach: 0.05, phase: i * 0.9 });
  }
  const fringe = new SceneNode();
  for (let i = 0; i < 14; i++) {
    const x = (-294 + i * 45.9) * b;
    if (Math.abs(x) < 100) continue;
    const y = -29 - 29 * Math.sin((i / 13) * Math.PI),
      node = new SceneNode().add(
        flat([lock(x, y, x + (i - 6.5) * 3, 12 + 18 * scatter(i, 27), 27 * b, i % 2 ? 0.1 : -0.1)], iceGlint),
      );
    fringe.add(node);
    locks.push({ node, x, y, reach: 0.07, phase: 1.3 + i * 0.6 });
  }
  body.add(flat(mantle, deepShade).translate(0, 15)).add(hung);
  paintForm(body, mantle, rime, { ink: 0, rim: 6 });
  body.add(fringe);
  scene.add(body).add(head.scene);
  return {
    scene,
    head,
    body,
    sway(seconds, amount = 1) {
      head.sway(seconds, amount);
      for (const s of locks) turn(s.node, s.x, s.y, s.reach * amount * Math.sin(seconds * 1.1 + s.phase));
    },
  };
}
