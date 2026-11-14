// Opening saga, first half: the void, the slaying of Ymir, and his body shaped into Midgard.
// Made with the Aurum FX tool from its hit_spark recipe (Heavy), recoloured to ice and exported as Lottie.
import giantBlow from './assets/saga/giant-blow.json?raw';
import { AnimationNode, SceneNode, ShapeNode, type Rgb } from './paint';
import { oval, pen, type Form } from './outline-form';
import { allfatherLunging, shoreTrio, spearman, type Fighter } from './saga-fighters';
import { frostGiant, giantHead } from './saga-giant';
import { dusk, paintForm } from './form-paint';
import {
  about,
  alphaOf,
  backdrop,
  cloud,
  ease,
  flat,
  frost,
  iceGlint,
  rime,
  lock,
  raven,
  sagaWidth,
  scatter,
  span,
  turn,
  waves,
  type SagaArt,
  type SagaPanel,
} from './saga-panel';

const night: Rgb = [18, 18, 40];

function stars(count: number, bottom: number): SceneNode {
  const scene = new SceneNode();
  for (let i = 0; i < count; i++)
    scene.add(
      new ShapeNode()
        .appendCircle(sagaWidth * scatter(i, 4), bottom * scatter(i, 5), 1.2 + 1.6 * scatter(i, 6))
        .fill(226, 226, 240, 90 + Math.round(120 * scatter(i, 7))),
    );
  return scene;
}

/** Ymir asleep between the frost and the fire, before anything else was. */
export function voidPanel(): SagaPanel {
  const scene = new SceneNode(),
    far = new SceneNode(),
    frostBank = new SceneNode(),
    fireBank = new SceneNode(),
    embers = new SceneNode(),
    chips = new SceneNode();
  far.add(backdrop([18, 14, 50], [46, 32, 86])).add(stars(60, 560));
  // Three stars that flicker; everything else holds still.
  const twinkles = [
    [250, 150],
    [1320, 110],
    [1130, 300],
  ].map(([x, y]) => {
    const star = flat([lock(x, y + 14, x, y - 14, 9, 0), lock(x - 14, y, x + 14, y, 9, 0)], [236, 232, 250]);
    far.add(star);
    return star;
  });
  // Low plum silhouettes: a far ridge, then cloud on either hand, cold to the left and warm to the right.
  far.add(
    flat(
      [
        pen(-200, 760)
          .curve([-40, 640], [120, 610], [260, 660], [420, 700])
          .curve([700, 720], [1000, 716], [1180, 690])
          .curve([1320, 640], [1480, 606], [1800, 700])
          .curve([1800, 900], [1800, 1100])
          .curve([800, 1100], [-200, 1100])
          .close(),
      ],
      [56, 40, 92],
    ),
  );
  for (const [x, y, w, alpha] of [
    [-260, 640, 620, 150],
    [-320, 740, 760, 190],
    [-200, 840, 560, 230],
  ])
    frostBank.add(flat(cloud(x, y, w, 150, 5), [78, 74, 132], alpha));
  for (let i = 0; i < 5; i++) {
    const x = 20 + i * 54;
    frostBank.add(flat([lock(x, 960, x + 16, 640 + 130 * scatter(i, 8), 60, -0.03)], rime, 110));
  }
  for (const [x, y, w, alpha] of [
    [1240, 640, 620, 150],
    [1160, 740, 760, 190],
    [1280, 840, 560, 230],
  ])
    fireBank.add(flat(cloud(x, y, w, 150, 5), [112, 52, 88], alpha));
  const sparks: ShapeNode[] = [];
  for (let i = 0; i < 12; i++) {
    const spark = new ShapeNode().appendCircle(0, 0, 2 + 3 * scatter(i, 11)).fill(238, 150, 84, 210);
    sparks.push(spark);
    embers.add(spark);
  }
  // Three fragments of ice let go of his left shoulder as he stirs.
  const slivers: ShapeNode[] = [];
  for (let i = 0; i < 3; i++) {
    const r = 12 + i * 5,
      sliver = flat(
        [
          pen(-r, 0)
            .curve([-r * 0.4, -r * 0.9], [r * 0.5, -r * 0.8])
            .curve([r, -r * 0.1], [r * 0.4, r * 0.8])
            .curve([-r * 0.5, r * 0.7], [-r, 0])
            .close(),
        ],
        iceGlint,
      );
    slivers.push(sliver);
    chips.add(sliver);
  }
  // Hunched and vast: shoulders like a hill, the head sunk between them.
  const ymir = frostGiant();
  ymir.scene.transform([1.7, 0, 800, 0, 1.7, 610, 0, 0, 1]);
  scene.add(far).add(frostBank).add(fireBank).add(ymir.scene).add(chips).add(embers);
  return {
    scene,
    pose(beat, seconds) {
      // Shot by shot: asleep, the lids part, the eyes open, the gaze comes down on whoever is below.
      const stage = beat < 0.36 ? 0 : beat < 0.6 ? 1 : beat < 0.72 ? 2 : 3,
        bowed = span(beat, 0.68, 0.84);
      about(scene, 800, 520, 1 + 0.03 * span(beat, 0, 0.6) - 0.02 * bowed);
      frostBank.translate(20 * beat, 0);
      fireBank.translate(-20 * beat, 0);
      about(ymir.body, 0, 229, 1 + 0.004 * Math.sin(seconds * 1.1) + 0.02 * bowed);
      ymir.head.look((['shut', 'half', 'wide', 'glare'] as const)[stage]);
      ymir.head.scene.translate(1.2 * Math.sin(seconds * 0.9) * bowed, 9 * bowed);
      ymir.sway(seconds);
      twinkles.forEach((star, i) =>
        star.opacity(alphaOf(0.55 + 0.45 * Math.sin(seconds * (1.6 + i * 0.5) + i * 2))),
      );
      slivers.forEach((sliver, i) => {
        const drop = (beat - 0.38 - i * 0.05) / 0.26;
        sliver
          .translate(1150 + i * 44 + 20 * drop, 560 + i * 12 + 380 * drop * drop)
          .opacity(drop > 0 && drop < 1 ? alphaOf(1.5 - drop) : 0);
      });
      sparks.forEach((spark, i) => {
        const life = (seconds * (0.05 + 0.05 * scatter(i, 12)) + scatter(i, 13)) % 1;
        spark
          .translate(1380 + 200 * scatter(i, 14) + 20 * Math.sin(seconds + i), 860 - 520 * life)
          .opacity(alphaOf(Math.sin(life * Math.PI)));
      });
    },
  };
}

/** Odin, Vili and Ve bring the giant down. */
export function slayingPanel(): SagaPanel {
  const scene = new SceneNode(),
    giant = new SceneNode(),
    brothers = new SceneNode(),
    wound = new SceneNode(),
    dust = new SceneNode(),
    blow = new SceneNode(),
    shards = new SceneNode(),
    birds = [raven(), raven()].map((bird) =>
      new SceneNode().add(bird.transform([1.6, 0, 0, 0, 1.6, 0, 0, 0, 1])),
    );
  scene.add(backdrop([18, 14, 50], [64, 38, 96])).add(stars(34, 400));
  // Low plum silhouettes behind the fight, and a few embers far to the right.
  scene.add(
    flat(
      [
        pen(-200, 700)
          .curve([0, 600], [200, 580], [380, 630], [560, 660])
          .curve([760, 640], [900, 660])
          .curve([1800, 660], [1800, 1100])
          .curve([800, 1100], [-200, 1100])
          .close(),
      ],
      [70, 44, 100],
    ),
  );
  for (const [x, y, w, alpha] of [
    [-240, 560, 520, 130],
    [180, 640, 600, 170],
    [-300, 700, 700, 210],
  ])
    scene.add(flat(cloud(x, y, w, 130, 5), [96, 58, 112], alpha));
  const sparks: ShapeNode[] = [];
  for (let i = 0; i < 8; i++) {
    const spark = new ShapeNode().appendCircle(0, 0, 2 + 3 * scatter(i, 61)).fill(238, 150, 84, 200);
    sparks.push(spark);
    scene.add(spark);
  }
  // The same giant, broader and nearer: he fills the right of the frame, arms at his sides.
  const ymir = frostGiant(1.2);
  ymir.head.look('wide');
  ymir.scene.transform([1.5, 0, 1150, 0, 1.5, 500, 0, 0, 1]);
  giant.add(ymir.scene);
  // Where the spear goes in, the ice of him splits: wide at the heart of it, kinked, forked.
  const fissure: Rgb = [50, 56, 104],
    cracks: Form = [],
    plates: Form = [];
  for (const [angle, length, kink] of [
    [-2.5, 190, 0.5],
    [-1.2, 170, -0.55],
    [0.2, 210, 0.45],
    [1.4, 180, -0.5],
    [2.6, 150, 0.6],
  ]) {
    const mx = 1030 + Math.cos(angle) * length * 0.5,
      my = 640 + Math.sin(angle) * length * 0.5,
      ex = mx + Math.cos(angle + kink) * length * 0.6,
      ey = my + Math.sin(angle + kink) * length * 0.6;
    cracks.push(
      lock(1030, 640, mx + Math.cos(angle) * 26, my + Math.sin(angle) * 26, 34, 0),
      lock(mx - Math.cos(angle) * 14, my - Math.sin(angle) * 14, ex, ey, 20, 0),
      lock(
        mx,
        my,
        mx + Math.cos(angle - kink * 1.5) * length * 0.36,
        my + Math.sin(angle - kink * 1.5) * length * 0.36,
        12,
        0,
      ),
    );
    // A plate of ice lifted beside each split.
    const px = mx + Math.cos(angle + 1.2) * 46,
      py = my + Math.sin(angle + 1.2) * 46;
    plates.push(
      pen(px - 54, py + 8)
        .curve([px - 20, py - 40], [px + 40, py - 34])
        .curve([px + 62, py], [px + 30, py + 36])
        .curve([px - 20, py + 40], [px - 54, py + 8])
        .close(),
    );
  }
  wound.add(flat(plates, rime, 120)).add(flat(cracks, fissure));
  giant.add(wound);
  // A dark ridge with the three brothers on it, spears up.
  const ridge: Form = [
    pen(-200, 1000)
      .curve([-200, 860], [-200, 790])
      .curve([120, 760], [420, 770], [700, 800], [940, 880], [1100, 1000])
      .close(),
  ];
  const figures: Fighter[] = [spearman('slate'), allfatherLunging(), spearman('ochre')];
  brothers.add(flat(ridge, night));
  for (const i of [0, 2, 1]) brothers.add(figures[i].scene);
  // Snow thrown up where he comes down.
  const mists = [
    [640, 760, 1200, 150],
    [760, 810, 1100, 190],
    [600, 860, 1300, 235],
  ].map(([x, y, w, alpha]) => {
    const layer = new SceneNode()
      .add(flat(cloud(x, y, w, 170, 7), rime, alpha))
      .add(new ShapeNode().appendRect(x - 100, y + 70, w + 200, 400).fill(...rime, alpha));
    dust.add(layer);
    return layer;
  });
  // The two frames of contact: one lopsided white star at the single point of impact.
  const flash = flat(
    [
      oval(1100, 600, 54, 46),
      lock(1100, 640, 1040, 380, 70, 0.04),
      lock(1140, 600, 1420, 500, 60, -0.04),
      lock(1100, 560, 1190, 860, 64, 0.04),
      lock(1060, 600, 820, 700, 54, -0.04),
      lock(1090, 570, 900, 440, 44, 0.03),
      lock(1120, 630, 1330, 760, 48, 0.03),
      lock(1110, 570, 1250, 360, 40, -0.03),
    ],
    [255, 255, 255],
  ).translate(-70, 40);
  // Six great pieces break from him as he goes over.
  const lumps: ShapeNode[] = [];
  for (let i = 0; i < 6; i++) {
    const r = 34 + 30 * scatter(i, 63),
      lump = flat(
        [
          pen(-r, r * 0.2)
            .curve([-r * 0.5, -r * 0.8], [r * 0.4, -r * 0.9])
            .curve([r, -r * 0.2], [r * 0.6, r * 0.7])
            .curve([-r * 0.3, r * 0.9], [-r, r * 0.2])
            .close(),
        ],
        i % 2 ? rime : dusk(frost, 0.1),
      );
    lumps.push(lump);
    shards.add(lump);
  }
  // The blow: one flat pale wedge from Odin's spear to the giant's chest.
  // The spear's path, a warm streak bending in from behind him.
  blow.add(flat([lock(1030, 640, 620, 500, 40, -0.14)], [250, 228, 176]));
  const chips: ShapeNode[] = [];
  for (let i = 0; i < 8; i++) {
    const r = 26 + 26 * scatter(i, 21),
      chip = flat([lock(-r * 0.4, r * 0.6, r * 0.3, -r * 1.4, r * 1.3, 0.1)], rime);
    chips.push(chip);
    shards.add(chip);
  }
  // Each effect is a few units across and centred on its canvas; scale it up about the wound.
  const burst = (json: string, canvas: number, across: number): AnimationNode => {
    const k = across / canvas;
    return new AnimationNode(json).transform([k, 0, 1030 - across / 2, 0, k, 640 - across / 2, 0, 0, 1]);
  };
  const spark = burst(giantBlow, 4, 1500);
  scene.add(giant).add(shards).add(blow).add(spark).add(flash).add(dust).add(brothers);
  for (const bird of birds) scene.add(bird);
  return {
    scene,
    cues: [
      { at: 0.39, sound: 'sfx/combat/pierce_02', volume: 0.9 },
      { at: 0.4, sound: 'sfx/saga/giant_fall', volume: 0.85 },
    ],
    pose(beat, seconds) {
      const struck = 0.4,
        fall = ease((beat - struck - 0.06) / (0.86 - struck - 0.06)),
        jolt =
          beat > struck && beat < struck + 0.1
            ? Math.sin((beat - struck) * 300) * 5 * (1 - (beat - struck) / 0.1)
            : 0;
      about(scene, 700, 560, 1.05 - 0.05 * beat, jolt, jolt * 0.5);
      turn(giant, 1150, 1100, 0.28 * fall, 70 * fall, 30 * fall);
      ymir.sway(seconds, beat > struck ? 2.2 : 1);
      figures.forEach((figure, i) => {
        // They come on with spears levelled; Odin draws back once and drives home. Only when the
        // giant is down do all three throw their spears up.
        const lead = i === 1,
          lunge =
            span(beat, struck - 0.12, struck) *
            (1 - span(beat, struck + 0.14, struck + 0.44) * (lead ? 0.3 : 0.6)),
          k = [0.6, 0.64, 0.6][i];
        figure.scene.transform([
          k,
          0,
          [120, 570, 350][i] + (lead ? 60 : 22) * lunge,
          0,
          k,
          [782, 806, 790][i] - 3 * Math.abs(Math.sin(seconds * 2.4 + i)) * (1 - lunge),
          0,
          0,
          1,
        ]);
        const drawn = lead ? Math.sin(Math.PI * span(beat, struck - 0.2, struck - 0.02)) : 0,
          raised = span(beat, 0.8 + i * 0.03, 0.94 + i * 0.02),
          level = lead ? -0.08 - 0.42 * drawn + 0.32 * lunge : -0.1 + 0.04 * Math.sin(seconds * 2 + i);
        figure.aim(level * (1 - raised) - 1.05 * raised);
        figure.flutter(seconds + i);
        figure.gleam(lead ? Math.sin(Math.PI * span(beat, struck - 0.2, struck - 0.04)) : 0);
      });
      const contact = (beat - struck) / 0.014;
      flash.opacity(contact >= 0 && contact < 1 ? 255 : 0);
      mists.forEach((layer, i) =>
        layer.translate((i - 1) * 40 * span(beat, 0.5, 1), 90 - 90 * span(beat, 0.5 + i * 0.06, 0.86)),
      );
      lumps.forEach((lump, i) => {
        const drop = (beat - 0.5 - i * 0.03) / 0.36;
        lump
          .translate(900 + i * 90 + 60 * drop * (i % 2 ? 1 : -1), 640 + 24 * i + 420 * drop * drop)
          .opacity(drop > 0 && drop < 1 ? 255 : 0);
      });
      sparks.forEach((spark, i) => {
        const life = (seconds * (0.05 + 0.04 * scatter(i, 62)) + scatter(i, 64)) % 1;
        spark
          .translate(1440 + 150 * scatter(i, 65), 700 - 420 * life)
          .opacity(alphaOf(Math.sin(life * Math.PI)));
      });
      dust.opacity(alphaOf(span(beat, 0.5, 0.74)));
      ymir.head.look(fall > 0.6 ? 'shut' : 'wide');
      wound.opacity(alphaOf(span(beat, struck, struck + 0.04)));
      // Played at about a third of their own speed, so the blow reads at storybook pace.
      const hit = (beat - struck) / 0.11;
      spark.frame(Math.max(0, Math.min(15, hit * 15))).opacity(hit >= 0 && hit < 1 ? 255 : 0);
      blow.opacity(
        alphaOf(span(beat, struck - 0.02, struck) * (1 - span(beat, struck + 0.03, struck + 0.16))),
      );
      const flight = (beat - struck) / 0.5;
      chips.forEach((chip, i) => {
        const angle = -2.6 + 1.9 * scatter(i, 22),
          reach = (220 + 420 * scatter(i, 23)) * ease(flight);
        chip
          .translate(1030 + Math.cos(angle) * reach, 640 + Math.sin(angle) * reach + 160 * flight * flight)
          .opacity(flight <= 0 ? 0 : alphaOf(1.2 - flight));
      });
      birds.forEach((bird, i) =>
        bird.translate(
          300 + i * 300 + 150 * Math.sin(seconds * 0.5 + i * 2.4),
          170 + i * 60 + 40 * Math.cos(seconds * 0.7 + i),
        ),
      );
    },
  };
}

/** The giant lies in the red sea; then the land that was made of him. */
export function shapingPanel(art?: SagaArt): SagaPanel {
  const scene = new SceneNode(),
    fallen = new SceneNode(),
    // The real world of the game, photographed in the Map Editor; open sea shows until it has loaded.
    midgard = new SceneNode().add(backdrop([30, 62, 96], [26, 54, 88])),
    world = art?.world,
    surf = waves(30, 710, 800, [226, 214, 224], 100),
    shards = new SceneNode(),
    shore = new SceneNode(),
    ymir = giantHead(),
    tilt = -0.5,
    k = 1.75;
  // Face up and half sunk, crown toward the dark, beard trailing into the water.
  ymir.scene.transform([
    k * Math.cos(tilt),
    -k * Math.sin(tilt),
    900,
    k * Math.sin(tilt),
    k * Math.cos(tilt),
    640,
    0,
    0,
    1,
  ]);
  for (const [x, w, h, lean] of [
    [90, 60, 150, 0.2],
    [330, 44, 110, -0.25],
    [1290, 52, 130, 0.3],
    [1470, 70, 170, -0.15],
  ])
    paintForm(
      shards,
      [
        pen(x, 716)
          .curve([x + lean * h * 0.4, 716 - h * 0.6], [x + lean * h, 716 - h])
          .curve([x + w * 0.4 + lean * h, 716 - h * 0.96], [x + w * 0.7 + lean * h, 716 - h * 0.84])
          .curve([x + w * 0.9 + lean * h * 0.4, 716 - h * 0.4], [x + w, 716])
          .close(),
      ],
      dusk(frost, 0.3),
      { ink: 0, rim: 6 },
    );
  shore.add(
    flat(
      [
        pen(-200, 836)
          .curve([300, 806], [800, 818], [1300, 802], [1800, 830])
          .curve([1800, 1000], [-200, 1000])
          .close(),
      ],
      night,
    ),
  );
  // The fight is over: Odin stands with his spear grounded, his brothers kneel beside him.
  const trio = shoreTrio();
  shore.add(trio.scene.transform([0.4, 0, 470, 0, 0.4, 858, 0, 0, 1]));
  fallen
    .add(backdrop([14, 12, 44], [128, 50, 96], 0, 640))
    .add(stars(70, 480))
    .add(new ShapeNode().appendRect(-200, 636, sagaWidth + 400, 500).fill(112, 36, 58))
    .add(ymir.scene)
    .add(new ShapeNode().appendRect(-200, 716, sagaWidth + 400, 400).fill(112, 36, 58))
    .add(shards)
    .add(surf)
    .add(shore);
  scene.add(fallen).add(midgard);
  if (world) midgard.add(world);
  return {
    scene,
    pose(beat, seconds) {
      const made = span(beat, 0.34, 0.5);
      about(fallen, 800, 600, 1.02 + 0.08 * beat);
      ymir.sway(seconds, 0.5);
      trio.sway(seconds);
      surf.translate(18 * Math.sin(seconds * 0.5), 0);
      midgard.opacity(alphaOf(made));
      about(midgard, 800, 450, 1.28 - 0.26 * span(beat, 0.34, 1));
      // Fitted to the board whatever size the picture arrives at.
      if (world && world.width > 1) {
        const k = Math.max(sagaWidth / world.width, 900 / world.height);
        world
          .transform([k, 0, (sagaWidth - world.width * k) / 2, 0, k, (900 - world.height * k) / 2, 0, 0, 1])
          .opacity(255);
      } else world?.opacity(0);
    },
  };
}
