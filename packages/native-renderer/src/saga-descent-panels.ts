// Opening saga, second half: what festers under the land, what climbs out, and the waking on the shore.
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { capsule, oval, pen, type Form } from './outline-form';
import { dusk, paintForm } from './form-paint';
import {
  about,
  alphaOf,
  backdrop,
  bank,
  ease,
  fir,
  flat,
  lock,
  sagaWidth,
  scatter,
  span,
  stroke,
  type SagaPanel,
} from './saga-panel';

const bone: Rgb = [176, 172, 168];
const rot: Rgb = [96, 30, 70];
const shade: Rgb = [20, 16, 34];
const ember: Rgb = [222, 132, 78];

function pines(scene: SceneNode, count: number, from: number, to: number, ground: number, color: Rgb): void {
  const wood: Form = [];
  for (let i = 0; i < count; i++)
    wood.push(...fir(from + (to - from) * scatter(i, 41), ground + 6, 60 + 56 * scatter(i, 42)));
  scene.add(flat(wood, color));
}
/**
 * A gate to the depths, feet at the origin and about 340 tall: a cave mouth walled with cut stone,
 * framed by two of the giant's ribs. `depth` is the dark it opens on.
 */
function gate(): { scene: SceneNode; depth: SceneNode } {
  const scene = new SceneNode(),
    depth = new SceneNode(),
    rock: Rgb = [70, 72, 98],
    stone: Rgb = [112, 114, 138],
    arch = (w: number, h: number): Form => [
      pen(-w, 0)
        .curve([-w * 1.02, -h * 0.4], [-w * 0.96, -h * 0.62])
        .curve([-w * 0.66, -h * 0.92], [0, -h], [w * 0.66, -h * 0.92], [w * 0.96, -h * 0.62])
        .curve([w * 1.02, -h * 0.4], [w, 0])
        .close(),
    ];
  // The mound it is dug into, and the boulders at its feet.
  paintForm(
    scene,
    [
      pen(-290, 0)
        .curve([-270, -110], [-200, -210], [-90, -290], [30, -318], [150, -270], [240, -160], [290, 0])
        .close(),
    ],
    rock,
    { ink: 0, rim: 14 },
  );
  paintForm(
    scene,
    [oval(-236, -24, 62, 44), oval(250, -18, 54, 38), oval(-160, -8, 36, 22)],
    dusk(rock, 0.16),
    {
      ink: 0,
      rim: 6,
    },
  );
  paintForm(scene, arch(150, 300), stone, { ink: 0, rim: 10 });
  // Cut stones round the mouth, a rune on the keystone.
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.06 + 0.11 * i),
      c = Math.cos(a),
      n = Math.sin(a);
    scene.add(
      stroke(
        [
          [-c * 100, -150 - n * 100 + 36],
          [-c * 112, -150 - n * 114 + 34],
          [-c * 124, -150 - n * 128 + 32],
          [-c * 138, -150 - n * 142 + 30],
        ],
        3,
        dusk(stone, 0.5),
      ),
    );
  }
  scene.add(
    stroke(
      [
        [0, -286],
        [0, -274],
        [0, -266],
        [0, -258],
      ],
      4,
      rot,
    ),
  );
  scene.add(
    stroke(
      [
        [-9, -280],
        [-4, -276],
        [4, -270],
        [9, -264],
      ],
      3,
      rot,
    ),
  );
  scene.add(flat(arch(96, 244), shade));
  depth
    .add(flat(arch(96, 244), rot))
    .add(flat(arch(66, 196), [66, 20, 54]))
    .add(flat(arch(38, 140), [40, 14, 40]));
  scene.add(depth);
  // Worn steps down into it.
  for (const [w, y] of [
    [96, -18],
    [84, -34],
    [70, -48],
  ])
    scene.add(
      flat(
        [
          pen(-w, y + 18)
            .curve([-w * 0.5, y + 10], [0, y + 8], [w * 0.5, y + 10], [w, y + 18])
            .curve([0, y + 26], [-w, y + 18])
            .close(),
        ],
        dusk(stone, 0.5),
        200,
      ),
    );
  paintForm(scene, [lock(-196, 6, -36, -372, 40, -0.2), lock(196, 6, 36, -372, 40, 0.2)], dusk(bone, 0.16), {
    ink: 0,
    rim: 7,
  });
  return { scene, depth };
}
/** A hunched horned thing, feet at the origin, about 120 tall: a silhouette and two ember eyes. */
function fiend(seed: number): { scene: SceneNode; eyes: SceneNode } {
  const scene = new SceneNode(),
    eyes = new SceneNode(),
    lean = -8 + 16 * scatter(seed, 51),
    horn = 24 + 26 * scatter(seed, 52);
  scene.add(
    flat(
      [
        pen(-46, 0).curve([-56, -50], [-34, -96], [lean, -108], [36, -96], [56, -50], [46, 0]).close(),
        pen(lean - 24, -98)
          .curve([lean - 40, -118], [lean - 30 - horn * 0.3, -110 - horn])
          .curve([lean - 22, -124], [lean - 6, -106])
          .close(),
        pen(lean + 24, -98)
          .curve([lean + 40, -118], [lean + 30 + horn * 0.3, -110 - horn])
          .curve([lean + 22, -124], [lean + 6, -106])
          .close(),
        capsule(-44, -60, -74, -8, 12, 8),
        capsule(44, -60, 74, -8, 12, 8),
      ],
      shade,
    ),
  );
  for (const side of [-1, 1]) eyes.add(flat([oval(lean + side * 15, -74, 5.5, 4.5)], ember));
  scene.add(eyes);
  return { scene, eyes };
}

/** Under the fields: the giant's ribs, and the part of him that never stilled. */
export function remainsPanel(): SagaPanel {
  const scene = new SceneNode(),
    world = new SceneNode(),
    heart = new SceneNode(),
    creep = new SceneNode(),
    lurkers: SceneNode[] = [];
  world.add(backdrop([52, 60, 110], [214, 150, 124], 0, 300));
  world.add(flat(bank(-200, 262, 2000, 90, 5, 120), [96, 110, 108]));
  pines(world, 22, 0, sagaWidth, 300, [48, 74, 78]);
  world.add(
    flat(
      [
        pen(-200, 296)
          .curve([300, 310], [800, 292], [1300, 312], [1800, 298])
          .line(1800, 360)
          .line(-200, 360)
          .close(),
      ],
      [98, 128, 96],
    ),
  );
  // Soil in bands, darker the deeper it goes.
  for (const [i, tone] of (
    [
      [74, 54, 58],
      [54, 40, 54],
      [36, 28, 48],
      [22, 18, 38],
    ] as Rgb[]
  ).entries()) {
    const y = 340 + i * 230;
    world.add(
      flat(
        [
          pen(-200, y)
            .curve([200, y + 22], [600, y - 14], [1000, y + 18], [1400, y - 10], [1800, y + 12])
            .line(1800, 1700)
            .line(-200, 1700)
            .close(),
        ],
        tone,
      ),
    );
  }
  for (let i = 0; i < 16; i++) {
    const x = 60 + 1480 * scatter(i, 61),
      len = 70 + 190 * scatter(i, 62),
      sway = -50 + 100 * scatter(i, 63);
    world.add(
      stroke(
        [
          [x, 344],
          [x + sway * 0.2, 344 + len * 0.4],
          [x + sway, 344 + len * 0.7],
          [x + sway * 0.6, 344 + len],
        ],
        5 - 3 * scatter(i, 64),
        [44, 34, 44],
      ),
    );
  }
  for (let i = 0; i < 18; i++)
    world.add(
      flat(
        [
          oval(
            1600 * scatter(i, 65),
            420 + 500 * scatter(i, 66),
            14 + 22 * scatter(i, 67),
            9 + 10 * scatter(i, 68),
          ),
        ],
        [60, 52, 70],
        150,
      ),
    );
  // Ribs arching over the hollow where the heart lay.
  for (let i = 0; i < 6; i++) {
    const reach = 250 + i * 52,
      top = 900 + i * 18,
      width = 26 - i * 2;
    for (const side of [-1, 1])
      world.add(
        stroke(
          [
            [800 + side * 20, top],
            [800 + side * reach * 0.8, top - 30],
            [800 + side * reach, top + 180],
            [800 + side * reach * 0.62, top + 400 + i * 12],
          ],
          width,
          dusk(bone, 0.12 + i * 0.06),
        ),
      );
  }
  world.add(
    stroke(
      [
        [800, 870],
        [800, 1420],
      ],
      34,
      dusk(bone, 0.1),
    ),
  );
  heart
    .add(
      flat(
        [
          pen(-150, 0)
            .lobes(-30, -120, 3, 30)
            .lobes(130, -70, 3, 34)
            .lobes(150, 60, 3, 30)
            .lobes(10, 140, 3, 34)
            .lobes(-150, 0, 3, 30)
            .close(),
        ],
        [62, 22, 56],
      ),
    )
    .add(flat([oval(0, 6, 92, 80)], rot))
    .add(flat([oval(-14, -4, 44, 36)], [140, 44, 84]));
  const tendrils: ShapeNode[] = [];
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * (0.12 + 0.095 * i),
      r = 320 + 160 * scatter(i, 71),
      bend = -80 + 160 * scatter(i, 72),
      vine = stroke(
        [
          [800, 1180],
          [800 + Math.cos(a) * r * 0.4 + bend, 1180 + Math.sin(a) * r * 0.4],
          [800 + Math.cos(a) * r * 0.8 - bend, 1180 + Math.sin(a) * r * 0.8],
          [800 + Math.cos(a) * r, 1180 + Math.sin(a) * r],
        ],
        12 - 0.6 * i,
        [62, 22, 56],
      );
    tendrils.push(vine);
    creep.add(vine);
  }
  for (let i = 0; i < 7; i++) {
    const eyes = new SceneNode(),
      x = 300 + 1000 * scatter(i, 73),
      y = 980 + 420 * scatter(i, 74);
    eyes.add(flat([oval(x - 9, y, 4.5, 3.5), oval(x + 9, y, 4.5, 3.5)], ember));
    lurkers.push(eyes);
    world.add(eyes);
  }
  world.add(creep).add(heart);
  scene.add(world);
  return {
    scene,
    pose(beat, seconds) {
      world.translate(0, -640 * ease(beat * 1.15));
      about(heart, 0, 0, 1 + 0.05 * Math.sin(seconds * 2.2), 800, 1180);
      tendrils.forEach((vine, i) => vine.opacity(alphaOf(span(beat, 0.35 + i * 0.03, 0.7 + i * 0.03))));
      lurkers.forEach((eyes, i) =>
        eyes.opacity(
          alphaOf(
            span(beat, 0.5 + i * 0.05, 0.62 + i * 0.05) * (Math.sin(seconds * 0.9 + i * 1.7) > -0.86 ? 1 : 0),
          ),
        ),
      );
    },
  };
}

/** Night, and the gate in the hillside lets them out. */
export function risingPanel(): SagaPanel {
  const scene = new SceneNode(),
    arch = gate(),
    horde = new SceneNode(),
    near = fiend(9),
    crawlers: {
      thing: ReturnType<typeof fiend>;
      from: [number, number];
      to: [number, number];
      at: number;
    }[] = [];
  scene
    .add(backdrop([12, 14, 36], [44, 42, 84]))
    .add(new ShapeNode().appendCircle(1240, 190, 74).fill(226, 224, 214));
  scene.add(new ShapeNode().appendCircle(1272, 174, 66).fill(22, 23, 50));
  scene.add(flat(bank(-200, 486, 2000, 100, 5, 200), [34, 38, 74]));
  pines(scene, 14, 0, 520, 520, [22, 26, 54]);
  scene.add(
    flat(
      [
        pen(-200, 560)
          .curve([300, 540], [700, 620], [1100, 600], [1800, 520])
          .line(1800, 1000)
          .line(-200, 1000)
          .close(),
      ],
      [30, 34, 62],
    ),
  );
  arch.scene.transform([1.1, 0, 900, 0, 1.1, 640, 0, 0, 1]);
  scene.add(arch.scene);
  scene.add(
    flat(
      [pen(-200, 640).curve([400, 660], [900, 636], [1800, 668]).line(1800, 1000).line(-200, 1000).close()],
      [22, 24, 48],
    ),
  );
  for (let i = 0; i < 6; i++) {
    const thing = fiend(i),
      spread = -1 + 2 * scatter(i, 81);
    crawlers.push({
      thing,
      from: [900 + spread * 50, 640],
      to: [900 + spread * 620, 760 + 120 * scatter(i, 82)],
      at: 0.08 + i * 0.11,
    });
    horde.add(thing.scene);
  }
  scene.add(horde).add(near.scene);
  return {
    scene,
    pose(beat, seconds) {
      about(scene, 900, 560, 1 + 0.06 * beat);
      arch.depth.opacity(alphaOf(0.55 + 0.3 * Math.sin(seconds * 1.6)));
      for (const [i, crawler] of crawlers.entries()) {
        const go = ease((beat - crawler.at) / 0.6),
          k = 0.35 + 1.05 * go,
          step = Math.abs(Math.sin(seconds * 3 + i)) * 6 * (go < 1 ? 1 : 0);
        crawler.thing.scene
          .transform([
            k,
            0,
            crawler.from[0] + (crawler.to[0] - crawler.from[0]) * go,
            0,
            k,
            crawler.from[1] + (crawler.to[1] - crawler.from[1]) * go - step,
            0,
            0,
            1,
          ])
          .opacity(beat < crawler.at ? 0 : 255);
        crawler.thing.eyes.opacity(Math.sin(seconds * 0.8 + i * 2.1) > -0.9 ? 255 : 0);
      }
      // The last one rises in front of everything, close enough to fill the frame.
      const loom = span(beat, 0.62, 1);
      near.scene.transform([5, 0, 420, 0, 5, 1720 - 740 * loom, 0, 0, 1]);
    },
  };
}
