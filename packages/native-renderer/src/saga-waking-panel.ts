// Opening saga, last panel: the hill above the founding shore, Odin, the two he woke, and the
// feet of his great statue behind them.
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { capsule, oval, pen, type Form } from './outline-form';
import { dusk, paintForm } from './form-paint';
import { allfatherStanding } from './saga-fighters';
import {
  about,
  alphaOf,
  backdrop,
  ease,
  fir,
  flat,
  lock,
  raven,
  sagaWidth,
  scatter,
  span,
  stroke,
  type SagaPanel,
} from './saga-panel';

/**
 * One of the two founders from behind, in the game's own small round build: feet at the origin,
 * about 112 tall. Askr wears his hair as a mane, Embla hers in a side braid.
 */
function founderBack(hair: Rgb, wool: Rgb, skin: Rgb, braid: boolean): SceneNode {
  const scene = new SceneNode(),
    finish = { ink: 0, rim: 4 },
    linen: Rgb = [228, 216, 192];
  paintForm(scene, [capsule(-10, -24, -11, -5, 8, 7), capsule(10, -24, 11, -5, 8, 7)], [96, 84, 86], finish);
  paintForm(scene, [oval(-12, -2, 10, 6), oval(12, -2, 10, 6)], [78, 62, 58], { ink: 0, rim: 2 });
  paintForm(
    scene,
    [capsule(-23, -52, -27, -30, 7, 6), capsule(23, -52, 27, -30, 7, 6)],
    dusk(wool, 0.1),
    finish,
  );
  scene.add(flat([oval(-28, -26, 6, 6), oval(28, -26, 6, 6)], skin));
  paintForm(
    scene,
    [
      pen(-20, -60)
        .curve([-26, -42], [-28, -20])
        .curve([-14, -15], [0, -17], [14, -15], [28, -20])
        .curve([26, -42], [20, -60])
        .curve([0, -66], [-20, -60])
        .close(),
    ],
    wool,
    finish,
  );
  scene.add(
    flat(
      [
        pen(-28, -24)
          .curve([-14, -19], [0, -21], [14, -19], [28, -24])
          .curve([28, -19], [0, -15], [-28, -19])
          .close(),
      ],
      linen,
    ),
  );
  scene.add(flat([oval(-33, -82, 6, 8), oval(33, -82, 6, 8)], skin));
  const head: Form = braid
    ? [
        pen(-33, -84)
          .curve([-34, -112], [0, -120], [34, -112], [33, -84])
          .curve([32, -62], [14, -54], [0, -53], [-14, -54], [-32, -62])
          .close(),
        oval(22, -56, 8, 9),
        oval(25, -43, 7, 8),
        oval(27, -31, 6, 7),
        lock(28, -24, 30, -8, 9, 0.1),
      ]
    : [
        pen(-34, -84)
          .curve([-35, -113], [0, -121], [35, -113], [34, -84])
          .curve([36, -66], [30, -54])
          .curve([20, -58], [10, -50], [0, -56], [-10, -50], [-20, -58], [-30, -54])
          .curve([-36, -66], [-34, -84])
          .close(),
        ...[0, 1, 2, 3, 4].map((i) => lock(-24 + i * 12, -58, -27 + i * 13.5, -42 - (i % 2) * 5, 12, 0)),
      ];
  paintForm(scene, head, hair, finish);
  return scene;
}
/** The feet of the great statue as plain masses: a corner pier, two legs with broad capitals, the dark between. */
function statueLegs(): SceneNode {
  const scene = new SceneNode(),
    stone: Rgb = [58, 61, 78],
    lit: Rgb = [88, 90, 106],
    dark: Rgb = [33, 37, 56],
    rimLight: Rgb = [238, 152, 110];
  // The mass of the seat behind everything, and the hollow between the legs.
  scene.add(
    flat(
      [
        pen(700, -40)
          .curve([1100, -60], [1700, -40])
          .curve([1720, 300], [1700, 800])
          .curve([1200, 800], [700, 800])
          .curve([690, 300], [700, -40])
          .close(),
      ],
      [46, 49, 66],
    ),
  );
  scene.add(
    flat(
      [
        pen(1124, 186)
          .curve([1260, 180], [1392, 186])
          .curve([1398, 380], [1390, 566])
          .curve([1260, 572], [1124, 566])
          .curve([1118, 380], [1124, 186])
          .close(),
      ],
      dark,
    ),
  );
  // The corner pier on the left, its seaward edge catching the dawn.
  scene.add(
    flat(
      [
        pen(700, -40)
          .curve([760, -44], [856, -40])
          .curve([862, 300], [858, 600])
          .curve([780, 606], [700, 600])
          .curve([694, 300], [700, -40])
          .close(),
      ],
      stone,
    ),
  );
  scene.add(
    flat(
      [
        pen(698, -40)
          .curve([704, 300], [698, 600])
          .curve([708, 604], [716, 600])
          .curve([722, 300], [716, -40])
          .close(),
      ],
      rimLight,
    ),
  );
  const leg = (x: number, w: number, top: number, foot: number): void => {
    // A shaft that narrows a little toward the ankle, under a wide capital, on a low block.
    scene.add(
      flat(
        [
          pen(x - w * 0.5, top + 90)
            .curve([x - w * 0.46, (top + foot) / 2], [x - w * 0.42, foot])
            .curve([x, foot + 8], [x + w * 0.42, foot])
            .curve([x + w * 0.46, (top + foot) / 2], [x + w * 0.5, top + 90])
            .close(),
        ],
        stone,
      ),
    );
    scene.add(
      flat(
        [
          pen(x - w * 0.78, top + 20)
            .curve([x - w * 0.8, top - 10], [x - w * 0.6, top - 16])
            .curve([x, top - 30], [x + w * 0.6, top - 16])
            .curve([x + w * 0.8, top - 10], [x + w * 0.78, top + 20])
            .curve([x + w * 0.8, top + 78], [x + w * 0.56, top + 96])
            .curve([x, top + 108], [x - w * 0.56, top + 96])
            .curve([x - w * 0.8, top + 78], [x - w * 0.78, top + 20])
            .close(),
        ],
        stone,
      ),
    );
    scene.add(
      flat(
        [
          pen(x - w * 0.78, top + 20)
            .curve([x - w * 0.8, top - 10], [x - w * 0.6, top - 16])
            .curve([x, top - 30], [x + w * 0.6, top - 16])
            .curve([x + w * 0.8, top - 10], [x + w * 0.78, top + 20])
            .curve([x, top + 2], [x - w * 0.78, top + 20])
            .close(),
        ],
        lit,
      ),
    );
    scene.add(
      flat(
        [
          pen(x - w * 0.66, foot + 4)
            .curve([x, foot - 6], [x + w * 0.66, foot + 4])
            .curve([x + w * 0.68, foot + 40], [x + w * 0.66, foot + 74])
            .curve([x, foot + 80], [x - w * 0.66, foot + 74])
            .curve([x - w * 0.68, foot + 40], [x - w * 0.66, foot + 4])
            .close(),
        ],
        [44, 47, 64],
      ),
    );
    scene.add(
      flat(
        [
          pen(x - w * 0.66, foot + 4)
            .curve([x, foot - 6], [x + w * 0.66, foot + 4])
            .curve([x, foot + 18], [x - w * 0.66, foot + 4])
            .close(),
        ],
        lit,
        200,
      ),
    );
  };
  leg(1000, 280, 112, 610);
  leg(1560, 300, 150, 650);
  // Three pale studs on the hem of the stone robe.
  for (const [x, y] of [
    [1254, 46],
    [1140, 102],
    [1376, 102],
  ])
    scene.add(
      flat(
        [
          pen(x - 28, y)
            .curve([x, y - 8], [x + 28, y])
            .curve([x + 20, y + 30], [x, y + 46])
            .curve([x - 20, y + 30], [x - 28, y])
            .close(),
        ],
        [176, 180, 198],
      ),
    );
  return scene;
}

/** Dawn over the founding shore: the first camp will stand on this hill. */
export function wakingPanel(): SagaPanel {
  const scene = new SceneNode(),
    sun = new SceneNode(),
    glitter = new SceneNode(),
    odin = allfatherStanding(),
    bird = raven([26, 24, 40]),
    grass = new SceneNode();
  for (const [r, alpha] of [
    [620, 30],
    [440, 38],
    [290, 46],
    [170, 54],
  ])
    sun.add(new ShapeNode().appendCircle(290, 0, r, r * 0.66).fill(255, 196, 150, alpha));
  sun.add(new ShapeNode().appendCircle(290, 0, 84).fill(253, 222, 150));
  scene.add(backdrop([74, 84, 160], [250, 180, 130], 0, 450)).add(sun);
  // Far heights across the bay, the sea, a few bars of light on it.
  scene.add(
    flat(
      [pen(-200, 450).curve([-40, 420], [80, 426], [180, 392], [290, 430], [420, 416], [600, 452]).close()],
      [186, 128, 150],
    ),
  );
  scene.add(new ShapeNode().appendRect(-200, 444, sagaWidth + 400, 300).fill(72, 110, 150));
  scene.add(new ShapeNode().appendRect(-200, 444, sagaWidth + 400, 40).fill(60, 96, 140, 150));
  for (const [x, y, w] of [
    [246, 478, 104],
    [222, 506, 150],
    [256, 530, 90],
  ])
    glitter.add(flat([capsule(x, y, x + w, y, 3.2)], [252, 226, 160]));
  scene.add(glitter);
  // Firs on the point beyond the statue.
  const wood: Form = [];
  for (const [x, y, h] of [
    [636, 566, 96],
    [690, 520, 110],
    [596, 590, 60],
    [870, 520, 100],
  ])
    wood.push(...fir(x, y, h));
  scene.add(
    flat(
      [
        pen(560, 600)
          .curve([620, 560], [680, 520], [760, 500])
          .curve([760, 560], [760, 620])
          .curve([660, 620], [560, 600])
          .close(),
      ],
      [56, 82, 98],
    ),
  );
  scene.add(flat(wood, [46, 74, 88]));
  // The strand, pale where the light lies along its crest.
  scene.add(
    flat(
      [
        pen(-200, 600)
          .curve([200, 570], [500, 574], [760, 590])
          .curve([760, 700], [760, 800])
          .curve([300, 800], [-200, 800])
          .close(),
      ],
      [222, 184, 134],
    ),
  );
  scene.add(
    stroke(
      [
        [-200, 598],
        [200, 568],
        [500, 572],
        [760, 588],
      ],
      9,
      [250, 222, 170],
    ),
  );
  scene.add(statueLegs());
  // The hill: one broad green rise, darker toward us.
  scene.add(
    flat(
      [
        pen(-200, 750)
          .curve([200, 700], [500, 672], [800, 668], [1100, 684], [1400, 716], [1800, 760])
          .curve([1800, 900], [1800, 1100])
          .curve([800, 1100], [-200, 1100])
          .close(),
      ],
      [116, 146, 96],
    ),
  );
  scene.add(
    flat(
      [
        pen(-200, 880)
          .curve([300, 850], [800, 860], [1300, 850], [1800, 880])
          .curve([1800, 1000], [1800, 1100])
          .curve([800, 1100], [-200, 1100])
          .close(),
      ],
      [98, 128, 84],
      160,
    ),
  );
  for (const [x, y] of [
    [70, 826],
    [290, 796],
    [850, 750],
    [1420, 846],
    [1590, 800],
    [470, 870],
  ]) {
    const tuft: Form = [];
    for (let j = 0; j < 4; j++)
      tuft.push(
        lock(x + j * 8, y, x + j * 12 - 18, y - 28 - 14 * scatter(x + j, 118), 8, j % 2 ? 0.2 : -0.2),
      );
    grass.add(flat(tuft, [78, 110, 76]));
    if (x % 3 === 2) grass.add(flat([oval(x + 34, y - 6, 5, 5)], [246, 232, 186]));
  }
  scene.add(grass);
  // Long shadows fall toward us and to the right, away from the low sun.
  scene.add(flat([lock(985, 850, 1420, 905, 70, 0.02)], [70, 100, 70], 150));
  for (const x of [604, 722]) scene.add(flat([lock(x, 846, x + 250, 900, 44, 0.02)], [70, 100, 70], 140));
  odin.scene.transform([0.975, 0, 965, 0, 0.975, 852, 0, 0, 1]);
  scene.add(odin.scene);
  const askr = founderBack([198, 170, 110], [84, 110, 124], [240, 206, 182], false),
    embla = founderBack([186, 96, 58], [100, 120, 80], [246, 216, 196], true);
  scene.add(askr).add(embla).add(bird);
  return {
    scene,
    // The raven calls twice as it takes off and crosses the sky.
    cues: [
      { at: 0.5, sound: 'wildlife/raven_01', volume: 0.7 },
      { at: 0.66, sound: 'wildlife/raven_02', volume: 0.55 },
    ],
    pose(beat, seconds) {
      about(scene, 760, 560, 1.07 - 0.07 * ease(beat));
      sun.translate(0, 440 - 60 * ease(beat));
      glitter.opacity(alphaOf(0.7 + 0.3 * Math.sin(seconds * 1.3)));
      odin.flutter(seconds * 0.5);
      // They sway a little on new legs.
      askr.transform([1.5, 0.02 * Math.sin(seconds * 1.1), 604, 0, 1.5, 846, 0, 0, 1]);
      embla.transform([1.42, 0.02 * Math.sin(seconds * 1.1 + 1.7), 722, 0, 1.42, 848, 0, 0, 1]);
      // One raven waits on the statue, then lifts away over the bay.
      const flight = span(beat, 0.5, 0.95),
        flap = flight > 0 ? 0.4 + 0.6 * Math.abs(Math.sin(seconds * 7)) : 1,
        k = 1.5 - 0.7 * flight;
      bird.transform([
        k,
        0,
        820 - 520 * flight,
        0,
        k * flap,
        96 + 200 * flight - 60 * Math.sin(flight * Math.PI),
        0,
        0,
        1,
      ]);
    },
  };
}
