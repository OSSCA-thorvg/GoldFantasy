import type { Person } from '../../engine/src/person';
import { Weather, type Climate } from '../../engine/src/climate';
import type { Resources } from '../../engine/src/building-catalog';
import { offeringKeys, type OfferingKey } from '../../engine/src/prayer-offering';
import { point } from '../../engine/src/geometry';
import { SceneNode, ShapeNode, type Rgb } from './paint';
import { poly, oval, stroke, glow } from './sprite-primitives';
import { paintYmir } from './ymir-statue';
import { personSprite, PersonParts, stridePose } from './world-sprites';
import { animatePrayer } from './devotion-effects';
import { type PortraitBackdrop } from './portrait-background';

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
const place = (node: SceneNode, x: number, y: number, s = 1) => node.transform([s, 0, x, 0, s, y, 0, 0, 1]);

/** Shared physical offerings: bowls, coins, stone and ivory, rather than text standing in for objects. */
export function offeringIcon(key: OfferingKey): SceneNode {
  const node = new SceneNode();
  if (key === 'bones') {
    node.add(stroke([-10, 6], [10, -6], 5, [222, 213, 183]));
    for (const [x, y] of [
      [-11, 3],
      [-8, 8],
      [8, -8],
      [11, -3],
    ])
      node.add(oval([x, y], 3.5, 3.5, [233, 225, 198]));
  } else if (key === 'gold') {
    for (const [x, y] of [
      [-7, 2],
      [5, 4],
      [0, -2],
    ]) {
      node.add(oval([x, y], 7, 3, [143, 101, 45]));
      node.add(oval([x, y - 2], 7, 3, [225, 183, 88]));
      node.add(stroke([x - 2, y - 3], [x + 2, y - 1], 0.8, [251, 224, 146]));
    }
  } else if (key === 'stone') {
    node.add(
      poly(
        [
          [-12, 4],
          [-8, -6],
          [3, -10],
          [12, 1],
          [8, 8],
          [-4, 8],
        ],
        [112, 124, 131],
      ),
    );
    node.add(
      poly(
        [
          [-8, -6],
          [3, -10],
          [1, 1],
          [-12, 4],
        ],
        [164, 172, 173],
      ),
    );
    node.add(
      poly(
        [
          [1, 1],
          [12, 1],
          [8, 8],
          [-4, 8],
        ],
        [86, 96, 105],
      ),
    );
  } else {
    node.add(
      poly(
        [
          [-14, -1],
          [14, -1],
          [10, 9],
          [-9, 9],
        ],
        [99, 77, 55],
      ),
    );
    node.add(oval([0, -1], 14, 5, [165, 141, 101]));
    node.add(oval([0, -2], 11, 3.5, key === 'water' ? [83, 161, 180] : [142, 91, 42]));
    if (key === 'food')
      for (const [x, y] of [
        [-6, -3],
        [1, -5],
        [7, -2],
      ])
        node.add(oval([x, y], 3.5, 2, [221, 172, 90]));
    else node.add(stroke([-6, -3], [2, -3], 1, [182, 224, 224]));
  }
  return node;
}

/** A retained, presentation-only scene. It never advances Town or consumes its RNG. */
export class OfferingScene {
  readonly root = new SceneNode();
  private backdrop = new SceneNode();
  private statue = new SceneNode();
  private table = new SceneNode();
  private gifts = offeringKeys.map((key) => ({ key, node: offeringIcon(key) }));
  private worshippers: { node: SceneNode; parts: PersonParts }[];
  private arrival = new SceneNode();
  private arriving: SceneNode | null = null;
  private bornParts: PersonParts | null = null;
  private born = -1;
  private halo = glow([0, 0], 58, 24, [176, 216, 191], 170);
  private beam = new ShapeNode();
  private ring = new ShapeNode().appendCircle(0, 0, 36, 14).strokeWidth(1.2).strokeFill(223, 232, 180, 220);
  private core = oval([0, -28], 7, 32, [234, 244, 196, 150]);
  private sparks = Array.from({ length: 18 }, (_, i) =>
    stroke([0, -2], [0, 2], i % 3 ? 0.8 : 1.4, [223, 232, 193]),
  );
  private weather = new SceneNode();
  private drops: ShapeNode[] = [];
  private night = new ShapeNode();
  private flash = new ShapeNode();
  private size = '';
  constructor(
    readonly climate: Readonly<Climate>,
    people: readonly Person[],
    private ground: PortraitBackdrop,
  ) {
    paintYmir(this.statue, point(), climate, false);
    this.table.add(
      poly(
        [
          [-74, -2],
          [0, -28],
          [74, -2],
          [0, 23],
        ],
        [101, 107, 100],
      ),
    );
    this.table.add(
      poly(
        [
          [-74, -2],
          [0, 23],
          [74, -2],
          [74, 7],
          [0, 32],
          [-74, 7],
        ],
        [58, 65, 65],
      ),
    );
    this.worshippers = people.slice(0, 3).map((person) => {
      const parts = new PersonParts(),
        node = personSprite(person, parts);
      for (const key of ['sack', 'logs', 'stone', 'planks', 'cutStone', 'alert', 'lute'] as const)
        parts[key]?.opacity(0);
      return { node, parts };
    });
    this.beam.moveTo(-17, 0).lineTo(-5, -138).lineTo(5, -138).lineTo(17, 0).close();
    this.beam.gradient = {
      type: 'linear',
      coordinates: [0, -138, 0, 0],
      stops: [
        { offset: 0, color: [162, 218, 199, 0] },
        { offset: 0.6, color: [162, 218, 199, 100] },
        { offset: 1, color: [243, 228, 173, 225] },
      ],
    };
    this.arrival.add(this.halo).add(this.ring).add(this.beam).add(this.core);
    this.sparks.forEach((spark) => this.arrival.add(spark));
    const snow = climate.weather === Weather.Snow;
    if (snow || climate.weather === Weather.Rain || climate.weather === Weather.Storm)
      this.drops = Array.from({ length: snow ? 40 : 60 }, (_, i) => {
        const drop = snow
          ? oval([0, 0], 1 + (i % 3) * 0.35, 1 + (i % 3) * 0.35, [233, 238, 236, 195])
          : stroke([0, 0], [((40 * (1 + climate.wind)) / 180) * 14, 14], 0.8, [173, 200, 211, 125]);
        this.weather.add(drop);
        return drop;
      });
    this.root.add(this.backdrop).add(this.statue).add(this.table);
    this.gifts.forEach((gift) => this.root.add(gift.node));
    this.worshippers.forEach((person) => this.root.add(person.node));
    this.root.add(this.arrival).add(this.night).add(this.weather).add(this.flash);
  }
  update(
    width: number,
    height: number,
    seconds: number,
    ritual: number,
    offering: Resources,
    born: Person | null,
  ): void {
    const key = `${width}:${height}`;
    if (this.size !== key) {
      this.size = key;
      this.backdrop.remove();
      const sky = new ShapeNode().appendRect(0, 0, width, height);
      sky.gradient = {
        type: 'linear',
        coordinates: [0, 0, 0, height],
        stops: [
          { offset: 0, color: this.climate.night > 0.5 ? [25, 35, 53, 255] : [131, 156, 163, 255] },
          { offset: 1, color: [...this.ground.ground, 255] },
        ],
      };
      this.backdrop.add(sky);
      const ground: Rgb = this.climate.snow > 0.3 ? [188, 201, 202] : this.ground.ground;
      this.backdrop.add(
        poly(
          [
            [0, height * 0.69],
            [width * 0.4, height * 0.62],
            [width, height * 0.72],
            [width, height],
            [0, height],
          ],
          ground,
        ),
      );
      for (let i = 0; i < 12; ++i) {
        const x = (i * 137.3) % width,
          y = height * (0.62 + (i % 3) * 0.023);
        this.backdrop.add(
          poly(
            [
              [x - 16, y],
              [x, y - 44 - (i % 4) * 8],
              [x + 16, y],
            ],
            this.climate.snow > 0.3 ? [114, 133, 135] : [52, 70, 64],
          ),
        );
      }
      this.night
        .reset()
        .appendRect(0, 0, width, height)
        .fill(9, 16, 31, Math.round(this.climate.night * 105));
      this.flash.reset().appendRect(0, 0, width, height).fill(222, 236, 241, 0);
    }
    const s = Math.min(width / 650, height / 410),
      cx = width * 0.57,
      cy = height * 0.78,
      lay = ritual < 0 ? 1 : smooth(ritual / 0.65),
      transform = smooth((ritual - 3.2) / 1.6),
      reveal = smooth((ritual - 4.8) / 1.2);
    place(this.statue, cx, cy - 12 * s, 0.61 * s);
    place(this.table, cx, cy + 24 * s, s);
    this.gifts.forEach((gift, i) => {
      const fromX = cx + (i - 2) * 25 * s,
        fromY = cy + (i % 2 ? 13 : 19) * s;
      place(
        gift.node,
        fromX + (cx - fromX) * transform - (1 - lay) * 18 * s,
        fromY + (1 - lay) * 30 * s - Math.sin(transform * Math.PI) * 30 * s - transform * 29 * s,
        s * (0.8 + 0.2 * lay) * (1 - 0.94 * transform),
      );
      gift.node.opacity(offering[gift.key] > 0 ? Math.round(255 * (1 - transform)) : 0);
    });
    this.worshippers.forEach((p, i) => {
      const x = cx - (130 - i * 43) * s,
        y = cy + (50 + (i % 2) * 18) * s;
      place(p.node, x, y, 3.2 * s);
      animatePrayer(p.parts, ritual < 0 ? 0 : Math.max(0, ritual - 0.45), 7.3);
    });
    if (born && this.born !== born.id) {
      this.born = born.id;
      const parts = new PersonParts();
      this.bornParts = parts;
      this.arriving = personSprite(born, parts);
      this.arrival.add(this.arriving);
    }
    place(this.arrival, cx, cy - 3 * s, s);
    const energy =
      ritual < 0 ? 0 : ritual < 4.8 ? smooth((ritual - 1.2) / 3.6) : 1 - smooth((ritual - 4.8) / 2.2);
    this.halo.opacity(Math.round(220 * energy));
    this.beam.opacity(Math.round(255 * energy));
    this.core.opacity(Math.round(230 * energy * smooth((ritual - 3.2) / 0.8)));
    const spread = 1 + 0.8 * smooth((ritual - 4.4) / 2.4);
    this.ring.transform([spread, 0, 0, 0, spread, 0, 0, 0, 1]);
    this.ring.opacity(Math.round(220 * energy));
    this.sparks.forEach((spark, i) => {
      const angle = (i * Math.PI * 2) / this.sparks.length + seconds * 0.23,
        radius = (16 + (1 - transform) * 35 + reveal * 25) * (i % 2 ? 0.85 : 1);
      spark.translate(Math.cos(angle) * radius, -28 + Math.sin(angle) * radius * 0.65);
      spark.opacity(Math.round(220 * energy * (0.65 + 0.35 * Math.sin(seconds * 2 + i))));
    });
    if (this.arriving) {
      const joining = smooth((ritual - 6) / 1.2);
      place(this.arriving, -14 * joining, -(1 - reveal) * 12 + joining * 25, 3.6 * (0.78 + 0.22 * reveal));
      if (this.bornParts) stridePose(this.bornParts, ritual * 7, joining > 0 && joining < 1);
      this.arriving.opacity(Math.round(255 * reveal));
    }
    this.drops.forEach((drop, i) => {
      const snow = this.climate.weather === Weather.Snow,
        speed = snow ? 23 : 180,
        x = ((i * 97.3 + seconds * (snow ? 13 : 40) * (1 + this.climate.wind)) % (width + 30)) - 15,
        y = ((i * 43.7 + seconds * speed) % (height + 30)) - 15;
      drop.translate(x, y);
    });
    if (this.climate.weather === Weather.Storm) {
      const flash = Math.max(0, 1 - ((seconds + 1.8) % 7.2) / 0.18);
      this.flash.fill(222, 236, 241, Math.round(flash * 130));
    }
  }
}
