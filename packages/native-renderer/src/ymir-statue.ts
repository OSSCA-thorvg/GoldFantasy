import { add, sub, scale as mul, normalized, lerp, point, type Point } from '../../engine/src/geometry';
import { f32 } from '../../engine/src/numeric';
import { ShapeNode, SceneNode, type Rgb, type Rgba, type PaintNode } from './paint';
import { fill, opaque, ellipse, glow, verticalShade } from './vector-paint';
import type { Climate } from './render-types';
type Outline = number[][];
const pt = (p: number[]): Point => point(p[0], p[1]);
const pair = (p: Point): number[] => [p.x, p.y];
const glint: Rgb = [98, 102, 112],
  lit: Rgb = [78, 82, 92],
  stone: Rgb = [58, 61, 70],
  shade: Rgb = [42, 44, 54],
  deep: Rgb = [30, 32, 40],
  crevice: Rgb = [18, 20, 26];
const rimeLit: Rgb = [200, 214, 228],
  rimeShade: Rgb = [136, 156, 182],
  moss: Rgb = [44, 62, 38],
  lichen: Rgb = [120, 126, 74],
  snow: Rgb = [232, 238, 244];
function mirrored(points: Outline): Outline {
  return points.map((p) => [-p[0], p[1]]);
}
function color(c: Rgb | Rgba): Rgba {
  return c.length === 3 ? opaque(c) : c;
}
function facet(base: Point, points: Outline, c: Rgb | Rgba): ShapeNode {
  const shape = new ShapeNode();
  for (let i = 0; i < points.length; i++) {
    const p = add(base, pt(points[i]));
    if (i) shape.lineTo(p.x, p.y);
    else shape.moveTo(p.x, p.y);
  }
  shape.close();
  fill(shape, color(c));
  return shape;
}
function worn(base: Point, points: Outline, c: Rgb | Rgba): ShapeNode {
  const shape = new ShapeNode(),
    n = points.length,
    at = (i: number) => add(base, pt(points[i % n]));
  shape.moveTo(at(0).x, at(0).y);
  for (let i = 0; i < n; i++) {
    const p0 = at(f32(f32(i + n) - 1)),
      p1 = at(i),
      p2 = at(f32(i + 1)),
      p3 = at(f32(i + 2)),
      c1 = add(p1, mul(sub(p2, p0), f32(1 / 6))),
      c2 = sub(p2, mul(sub(p3, p1), f32(1 / 6)));
    shape.cubicTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
  }
  shape.close();
  fill(shape, color(c));
  return shape;
}
function weathered(shape: ShapeNode, base: Point, c: Rgb, top: number, bottom: number): ShapeNode {
  verticalShade(shape, c, f32(base.y + top), f32(base.y + bottom), f32(1.1), f32(0.82));
  return shape;
}
function limb(a0: number[], b0: number[], wa: number, wb: number): Outline {
  const a = pt(a0),
    b = pt(b0),
    along = normalized(sub(b, a)),
    across = point(-along.y, along.x);
  return [
    sub(a, mul(along, f32(wa * f32(0.45)))),
    add(a, mul(across, f32(wa / 2))),
    add(b, mul(across, f32(wb / 2))),
    add(b, mul(along, f32(wb * f32(0.45)))),
    sub(b, mul(across, f32(wb / 2))),
    sub(a, mul(across, f32(wa / 2))),
  ].map(pair);
}
function groove(objects: SceneNode, base: Point, points: Outline, width = f32(1.6), alpha = 210): void {
  const cut = new ShapeNode(),
    lip = new ShapeNode();
  let first = true;
  for (const p of points) {
    const q = add(base, pt(p));
    if (first) {
      cut.moveTo(q.x, q.y);
      lip.moveTo(f32(q.x + f32(0.8)), f32(q.y + f32(1.2)));
    } else {
      cut.lineTo(q.x, q.y);
      lip.lineTo(f32(q.x + f32(0.8)), f32(q.y + f32(1.2)));
    }
    first = false;
  }
  lip
    .strokeWidth(f32(width * f32(0.7)))
    .strokeFill(...glint, Math.trunc(f32(alpha / 3)))
    .strokeCap('round');
  cut
    .strokeWidth(width)
    .strokeFill(...crevice, alpha)
    .strokeCap('round')
    .strokeJoin('round');
  objects.add(lip).add(cut);
}
function stain(objects: SceneNode, base: Point, top: number[], length: number, width: number): void {
  objects.add(
    facet(
      base,
      [
        top,
        [f32(top[0] + width), top[1]],
        [f32(top[0] + f32(width * f32(0.65))), f32(top[1] + length)],
        [f32(top[0] + f32(width * f32(0.25))), f32(top[1] + length)],
      ],
      opaque(crevice, 50),
    ),
  );
}
function tier(
  objects: SceneNode,
  base: Point,
  ax: number,
  ay: number,
  corner: number,
  bottom: number,
  height: number,
  top: Rgb,
  west: Rgb,
  south: Rgb,
  east: Rgb,
): void {
  const ground: Outline = [
      [-ax, f32(-corner / 2)],
      [-corner, -ay],
      [corner, -ay],
      [ax, f32(-corner / 2)],
      [ax, f32(corner / 2)],
      [corner, ay],
      [-corner, ay],
      [-ax, f32(corner / 2)],
    ],
    at = (i: number, lift: number) => [ground[i][0], f32(ground[i][1] - lift)];
  const face = (from: number, to: number, c: Rgb) =>
    objects.add(
      facet(
        base,
        [at(from, f32(bottom + height)), at(to, f32(bottom + height)), at(to, bottom), at(from, bottom)],
        c,
      ),
    );
  face(0, 7, west);
  face(7, 6, west);
  face(6, 5, south);
  face(5, 4, east);
  face(4, 3, east);
  const cap: Outline = [];
  for (let i = 0; i < 8; i++) cap.push(at(i, f32(bottom + height)));
  objects.add(facet(base, cap, top));
}
function runes(
  objects: SceneNode,
  base: Point,
  from0: number[],
  to0: number[],
  low: number,
  high: number,
  count: number,
): void {
  const from = pt(from0),
    to = pt(to0),
    along = normalized(sub(to, from)),
    lift = point(0, -1);
  groove(objects, base, [add(from, mul(lift, high)), add(to, mul(lift, high))].map(pair), f32(1.2), 160);
  groove(objects, base, [add(from, mul(lift, low)), add(to, mul(lift, low))].map(pair), f32(1.2), 160);
  const mid = f32(f32(low + high) / 2),
    half = f32(f32(f32(high - low) / 2) - f32(2.5));
  for (let i = 0; i < count; i++) {
    const p = add(lerp(from, to, f32(f32(i + f32(0.5)) / count)), mul(lift, mid)),
      top = add(p, mul(lift, half)),
      bottom = sub(p, mul(lift, half));
    groove(objects, base, [top, bottom].map(pair), f32(1.4), 190);
    const kind = f32(f32(i * 7) + 3) % 5;
    if (kind === 0 || kind === 3)
      groove(objects, base, [top, add(add(top, mul(along, f32(4.5))), point(0, 3))].map(pair), f32(1.2), 180);
    if (kind === 1 || kind === 3)
      groove(objects, base, [p, sub(add(p, mul(along, f32(4.5))), point(0, 3))].map(pair), f32(1.2), 180);
    if (kind === 2)
      groove(
        objects,
        base,
        [
          add(add(top, mul(along, -f32(3.5))), point(0, 2)),
          sub(add(bottom, mul(along, f32(3.5))), point(0, 2)),
        ].map(pair),
        f32(1.2),
        180,
      );
    if (kind === 4)
      groove(objects, base, [add(p, mul(along, -4)), add(p, mul(along, 4))].map(pair), f32(1.2), 180);
  }
}
export interface YmirLight {
  eyes: Point[];
  dais: Point;
  glints: PaintNode[];
}
export const ymirHeight = 450;
export function lightYmir(lights: SceneNode, base: Point): void {
  lights.add(glow(base, 210, 105, [150, 190, 235], 34));
}
export function paintYmir(objects: SceneNode, base: Point, climate: Climate, inWater: boolean): YmirLight {
  const snowy = climate.snow > f32(0.3);
  const frost: Rgb = snowy ? snow : rimeLit;
  // Rising from the sea: the dark stone shows in the still water before its two front faces, fading away from them.
  if (inWater)
    for (const [depth, alpha] of [
      [34, Math.trunc(60)],
      [18, Math.trunc(70)],
    ])
      objects.add(
        facet(
          base,
          [
            [-172, 6],
            [0, 86],
            [172, 6],
            [172, f32(6 + f32(depth * f32(0.6)))],
            [0, f32(86 + depth)],
            [-172, f32(6 + f32(depth * f32(0.6)))],
          ],
          opaque([10, 16, 24], alpha),
        ),
      );
  // Two tiers of hewn granite, runes cut round the lower one, moss and lichen where the rain runs off.
  tier(objects, base, 172, 86, 12, 0, 24, [62, 66, 64], [56, 58, 66], [44, 46, 56], [32, 34, 42]);
  if (inWater)
    objects.add(
      facet(
        base,
        [
          [-172, 6],
          [-12, 86],
          [12, 86],
          [172, 6],
          [172, -2],
          [12, 78],
          [-12, 78],
          [-172, -2],
        ],
        opaque(crevice, 110),
      ),
    );
  runes(objects, base, [-172, 6], [-12, 86], 6, 19, 9);
  runes(objects, base, [12, 86], [172, 6], 6, 19, 9);
  tier(objects, base, 140, 70, 10, 24, 20, [68, 72, 70], [62, 64, 72], [48, 50, 60], [36, 38, 46]);
  groove(
    objects,
    base,
    [
      [-140, -29],
      [-10, -94],
    ],
    f32(1.2),
    120,
  );
  groove(
    objects,
    base,
    [
      [10, -94],
      [140, -29],
    ],
    f32(1.2),
    120,
  );
  groove(
    objects,
    base,
    [
      [-140, f32(5 - 34)],
      [-10, f32(70 - 34)],
      [10, f32(70 - 34)],
      [140, f32(5 - 34)],
    ],
    f32(1.4),
    150,
  );
  for (const patch of [
    [
      [-160, -26],
      [-132, -40],
      [-112, -30],
      [-138, -18],
    ],
    [
      [-40, 46],
      [-14, 50],
      [-24, 60],
      [-48, 56],
    ],
    [
      [96, 32],
      [124, 22],
      [134, 32],
      [110, 40],
    ],
  ])
    objects.add(worn(base, patch, opaque(moss, 200)));
  for (const dot of [
    [-150, 2],
    [-136, 12],
    [-96, 40],
    [-70, 52],
    [-120, -36],
    [-60, -46],
  ])
    objects.add(ellipse(add(base, pt(dot)), f32(2.6), f32(1.6), opaque(lichen, 160)));
  // His shadow on the upper tier, and the throne behind him: a slab with a ring cut round his head.
  objects.add(
    facet(
      base,
      [
        [44, -18],
        [96, -24],
        [130, -52],
        [134, -84],
        [112, -104],
        [66, -70],
      ],
      opaque(crevice, 70),
    ),
  );
  objects.add(
    facet(
      base,
      [
        [-118, -384],
        [-130, -378],
        [-130, -146],
        [-118, -150],
      ],
      lit,
    ),
  );
  const slab: Outline = [
    [-118, -150],
    [-118, -384],
    [-100, -414],
    [-60, -436],
    [0, -448],
    [60, -436],
    [100, -414],
    [118, -384],
    [118, -150],
  ];
  objects.add(weathered(facet(base, slab, stone), base, stone, -448, -150));
  objects.add(
    facet(
      base,
      [
        [50, -404],
        [100, -414],
        [118, -384],
        [118, -300],
        [96, -318],
        [60, -352],
      ],
      opaque(crevice, 60),
    ),
  );
  const ring = new ShapeNode();
  ring.appendCircle(base.x, f32(base.y - 368), 72, 72);
  ring.strokeWidth(5);
  ring.strokeFill(...crevice, 200);
  objects.add(ring);
  for (let i = 0; i < 16; ++i) {
    let a = f32(i * f32(0.3927));
    const inner = [f32(f32(Math.cos(a)) * 64), f32(-368 + f32(f32(Math.sin(a)) * 64))],
      outer = [f32(f32(Math.cos(a)) * 80), f32(-368 + f32(f32(Math.sin(a)) * 80))];
    groove(objects, base, [inner, outer], f32(1.6), 180);
  }
  objects.add(
    worn(
      base,
      [
        [-100, -414],
        [-60, -436],
        [0, -448],
        [60, -436],
        [100, -414],
        [60, -428],
        [0, -440],
        [-60, -428],
      ],
      opaque(frost, 220),
    ),
  );
  stain(objects, base, [-88, -410], 90, 7);
  stain(objects, base, [74, -400], 110, 7);
  groove(objects, base, [
    [92, -424],
    [82, -390],
    [94, -360],
  ]);
  // Arms of the throne, solid blocks at his sides, a spiral cut in each front.
  for (const side of [-1, 1]) {
    const west = side < 0;
    const block = (points: Outline): Outline => (west ? points : mirrored(points));
    objects.add(
      facet(
        base,
        block([
          [-164, -258],
          [-156, -196],
          [-156, -28],
          [-164, -92],
        ]),
        west ? lit : deep,
      ),
    );
    objects.add(
      facet(
        base,
        block([
          [-164, -258],
          [-124, -258],
          [-118, -196],
          [-156, -196],
        ]),
        west ? glint : stone,
      ),
    );
    objects.add(
      facet(
        base,
        block([
          [-156, -196],
          [-118, -196],
          [-118, -28],
          [-156, -28],
        ]),
        west ? stone : shade,
      ),
    );
    let x = f32(side * 137);
    groove(
      objects,
      base,
      [
        [x, -166],
        [f32(x + 6), -170],
        [f32(x + 9), -162],
        [f32(x + 2), -154],
        [f32(x - 8), -158],
        [f32(x - 10), -170],
        [f32(x - 2), -180],
        [f32(x + 10), -178],
      ],
      f32(1.5),
      180,
    );
    objects.add(
      facet(
        base,
        block([
          [-164, -258],
          [-124, -258],
          [-122, -250],
          [-162, -250],
        ]),
        opaque(frost, 200),
      ),
    );
  }
  // A fur mantle hangs behind his arms; the body sits upright, belted.
  const drape: Outline = [
    [-136, -292],
    [-154, -240],
    [-152, -196],
    [-128, -206],
    [-116, -296],
  ];
  objects.add(worn(base, drape, shade));
  objects.add(worn(base, mirrored(drape), deep));
  const torso: Outline = [
    [-118, -300],
    [-96, -318],
    [-50, -330],
    [0, -334],
    [50, -330],
    [96, -318],
    [118, -300],
    [110, -262],
    [98, -222],
    [86, -192],
    [50, -182],
    [-50, -182],
    [-86, -192],
    [-98, -222],
    [-110, -262],
  ];
  objects.add(weathered(worn(base, torso, stone), base, stone, -334, -182));
  objects.add(
    weathered(
      worn(
        base,
        [
          [-118, -300],
          [-96, -318],
          [-50, -330],
          [-4, -334],
          [-8, -182],
          [-50, -182],
          [-86, -192],
          [-98, -222],
          [-110, -262],
        ],
        lit,
      ),
      base,
      lit,
      -334,
      -182,
    ),
  );
  groove(objects, base, [
    [-96, -262],
    [-70, -252],
    [-44, -250],
  ]);
  groove(objects, base, [
    [96, -262],
    [70, -252],
    [44, -250],
  ]);
  objects.add(
    facet(
      base,
      [
        [-88, -202],
        [88, -202],
        [86, -186],
        [-86, -186],
      ],
      deep,
    ),
  );
  groove(
    objects,
    base,
    [
      [-88, -203],
      [88, -203],
    ],
    f32(1.2),
    120,
  );
  const buckle = new ShapeNode();
  buckle.appendCircle(base.x, f32(base.y - 194), 9, 8);
  buckle.strokeWidth(3);
  buckle.strokeFill(...glint, 220);
  objects.add(buckle);
  stain(objects, base, [-64, -232], 40, 5);
  groove(objects, base, [
    [-44, -310],
    [-36, -286],
    [-42, -262],
  ]);
  objects.add(
    worn(
      base,
      [
        [-108, -290],
        [-90, -298],
        [-86, -204],
        [-100, -218],
      ],
      opaque(crevice, 120),
    ),
  );
  objects.add(
    worn(
      base,
      [
        [108, -290],
        [90, -298],
        [86, -204],
        [100, -218],
      ],
      opaque(crevice, 150),
    ),
  );
  // Upper arms, and the mantle over his shoulders, its fur cut in short strokes.
  const upperArm = limb([-114, -298], [-134, -212], 64, 56);
  objects.add(weathered(worn(base, upperArm, lit), base, lit, -330, -184));
  objects.add(weathered(worn(base, mirrored(upperArm), shade), base, shade, -330, -184));
  stain(objects, base, [-124, -280], 60, 6);
  const mantle: Outline = [
    [-140, -290],
    [-128, -316],
    [-94, -336],
    [-50, -348],
    [0, -352],
    [50, -348],
    [94, -336],
    [128, -316],
    [140, -290],
    [118, -298],
    [96, -316],
    [50, -328],
    [0, -332],
    [-50, -328],
    [-96, -316],
    [-118, -298],
  ];
  objects.add(worn(base, mantle, shade));
  objects.add(
    worn(
      base,
      [
        [-140, -290],
        [-128, -316],
        [-94, -336],
        [-50, -348],
        [0, -352],
        [0, -332],
        [-50, -328],
        [-96, -316],
        [-118, -298],
      ],
      lit,
    ),
  );
  for (let i = 0; i <= 12; ++i) {
    let t = f32(i / 12),
      x = f32(-128 + f32(t * 256)),
      y = f32(-316 - f32(f32(Math.sin(f32(t * f32(3.1416)))) * 30));
    groove(
      objects,
      base,
      [
        [f32(x - 3), f32(y + 4)],
        [x, f32(y + 12)],
        [f32(x + 3), f32(y + 4)],
      ],
      f32(1.2),
      150,
    );
  }
  objects.add(
    worn(
      base,
      [
        [-140, -292],
        [-128, -318],
        [-94, -338],
        [-50, -350],
        [0, -354],
        [-50, -346],
        [-94, -334],
        [-126, -314],
      ],
      opaque(frost, snowy ? 230 : 150),
    ),
  );
  objects.add(
    worn(
      base,
      [
        [140, -292],
        [128, -318],
        [94, -338],
        [50, -350],
        [0, -354],
        [50, -346],
        [94, -334],
        [126, -314],
      ],
      opaque(snowy ? snow : rimeShade, snowy ? 220 : 120),
    ),
  );
  // Thighs on the seat, the seat's front between the shins, and the feet planted on the dais.
  const thigh: Outline = [
    [-104, -150],
    [-34, -150],
    [-30, -188],
    [-100, -192],
  ];
  objects.add(worn(base, thigh, lit));
  objects.add(worn(base, mirrored(thigh), shade));
  objects.add(
    facet(
      base,
      [
        [-42, -152],
        [42, -152],
        [42, -44],
        [-42, -44],
      ],
      deep,
    ),
  );
  groove(
    objects,
    base,
    [
      [-42, -96],
      [42, -96],
    ],
    f32(1.2),
    130,
  );
  for (const side of [-1, 1])
    objects.add(ellipse(add(base, point(f32(side * 70), 14)), 44, 7, opaque(crevice, 90)));
  const shin: Outline = [
    [-104, -128],
    [-38, -128],
    [-40, -70],
    [-46, -16],
    [-92, -16],
    [-100, -70],
  ];
  objects.add(weathered(worn(base, shin, lit), base, lit, -128, -16));
  objects.add(
    weathered(
      worn(
        base,
        [
          [-58, -128],
          [-38, -128],
          [-40, -70],
          [-46, -16],
          [-64, -16],
        ],
        stone,
      ),
      base,
      stone,
      -128,
      -16,
    ),
  );
  objects.add(weathered(worn(base, mirrored(shin), shade), base, shade, -128, -16));
  stain(objects, base, [70, -112], 70, 6);
  groove(objects, base, [
    [-86, -96],
    [-74, -70],
    [-80, -48],
  ]);
  const foot: Outline = [
    [-100, -22],
    [-40, -22],
    [-32, -2],
    [-40, 16],
    [-96, 16],
    [-106, -2],
  ];
  objects.add(worn(base, foot, stone));
  objects.add(worn(base, mirrored(foot), deep));
  for (const x of [-88, -74, -60, -48]) {
    groove(
      objects,
      base,
      [
        [x, 4],
        [f32(x + 1), 15],
      ],
      f32(1.3),
      170,
    );
    groove(
      objects,
      base,
      [
        [-x, 4],
        [f32(-x - 1), 15],
      ],
      f32(1.3),
      170,
    );
  }
  objects.add(
    worn(
      base,
      [
        [-98, -6],
        [-80, -12],
        [-76, 0],
        [-92, 4],
      ],
      opaque(moss, 170),
    ),
  );
  // Knees, the forearms laid along the thighs, and the great hands at rest on the knees.
  objects.add(
    worn(
      base,
      [
        [-104, -140],
        [-86, -158],
        [-54, -162],
        [-36, -148],
        [-38, -126],
        [-70, -118],
        [-100, -124],
      ],
      lit,
    ),
  );
  objects.add(
    worn(
      base,
      [
        [104, -140],
        [86, -158],
        [54, -162],
        [36, -148],
        [38, -126],
        [70, -118],
        [100, -124],
      ],
      shade,
    ),
  );
  const forearm = limb([-134, -214], [-78, -150], 54, 46);
  objects.add(weathered(worn(base, forearm, stone), base, stone, -240, -130));
  objects.add(weathered(worn(base, mirrored(forearm), deep), base, deep, -240, -130));
  // Each hand: its back on the knee, a thumb inside, four fingers hanging over the front.
  for (const side of [-1, 1]) {
    const west = side < 0;
    const own = (points: Outline): Outline => (west ? points : mirrored(points));
    objects.add(
      worn(
        base,
        own([
          [-112, -170],
          [-40, -170],
          [-36, -148],
          [-110, -146],
        ]),
        west ? lit : shade,
      ),
    );
    objects.add(
      worn(
        base,
        own([
          [-44, -164],
          [-30, -152],
          [-32, -134],
          [-44, -138],
        ]),
        west ? stone : deep,
      ),
    );
    for (let i = 0; i < 4; ++i) {
      let x = f32(-108 + f32(i * 17));
      objects.add(
        worn(
          base,
          own([
            [x, -150],
            [f32(x + 15), -150],
            [f32(x + 14), -124],
            [f32(x + f32(7.5)), -116],
            [f32(x + 1), -124],
          ]),
          i % 2 == (west ? 0 : 1) ? (west ? lit : shade) : west ? stone : deep,
        ),
      );
    }
    groove(
      objects,
      base,
      own([
        [-108, -149],
        [-42, -149],
      ]),
      f32(1.4),
      170,
    );
  }
  objects.add(
    worn(
      base,
      [
        [-112, -170],
        [-76, -175],
        [-40, -170],
        [-76, -167],
      ],
      opaque(frost, snowy ? 230 : 110),
    ),
  );
  // The head held high, carved a size up so his face holds at a distance: long hair behind it, the brow
  // heavy over deep sockets and blank stone eyes.
  const crown = point(0, -368);
  const big = f32(1.2);
  const up = (points: Outline): Outline => points.map((a) => pair(add(crown, mul(sub(pt(a), crown), big))));
  const hair: Outline = [
    [-50, -396],
    [-64, -372],
    [-68, -334],
    [-58, -312],
    [-44, -338],
  ];
  objects.add(worn(base, up(hair), shade));
  objects.add(worn(base, up(mirrored(hair)), deep));
  const head: Outline = [
    [-44, -404],
    [-24, -416],
    [0, -420],
    [24, -416],
    [44, -404],
    [50, -374],
    [46, -344],
    [34, -326],
    [0, -318],
    [-34, -326],
    [-46, -344],
    [-50, -374],
  ];
  objects.add(weathered(worn(base, up(head), stone), base, stone, -430, -308));
  objects.add(
    worn(
      base,
      up([
        [-44, -404],
        [-24, -416],
        [0, -420],
        [-2, -318],
        [-34, -326],
        [-46, -344],
        [-50, -374],
      ]),
      lit,
    ),
  );
  objects.add(
    facet(
      base,
      up([
        [-44, -386],
        [44, -386],
        [40, -372],
        [-40, -372],
      ]),
      shade,
    ),
  );
  objects.add(
    facet(
      base,
      up([
        [-44, -390],
        [44, -390],
        [44, -386],
        [-44, -386],
      ]),
      glint,
    ),
  );
  for (const x of [-17, 17]) {
    const socket = add(crown, mul(sub(point(x, -363), crown), big));
    objects.add(ellipse(add(base, socket), f32(12 * big), f32(7 * big), opaque(deep)));
    objects.add(ellipse(add(add(base, socket), point(0, 1)), f32(7 * big), f32(4 * big), opaque(shade)));
  }
  objects.add(
    facet(
      base,
      up([
        [-7, -372],
        [7, -372],
        [11, -340],
        [0, -335],
        [-11, -340],
      ]),
      stone,
    ),
  );
  objects.add(
    facet(
      base,
      up([
        [-7, -372],
        [0, -372],
        [0, -335],
        [-11, -340],
      ]),
      lit,
    ),
  );
  objects.add(
    worn(
      base,
      up([
        [-42, -356],
        [-26, -352],
        [-24, -342],
        [-40, -340],
      ]),
      opaque(glint, 130),
    ),
  );
  // The beard, full and broad, three braids cut in it with rime at their tips, under a heavy moustache.
  const beard: Outline = [
    [-46, -344],
    [-42, -320],
    [-54, -292],
    [-50, -262],
    [-34, -232],
    [-16, -212],
    [0, -204],
    [16, -212],
    [34, -232],
    [50, -262],
    [54, -292],
    [42, -320],
    [46, -344],
    [20, -336],
    [0, -332],
    [-20, -336],
  ];
  objects.add(weathered(worn(base, up(beard), shade), base, shade, -350, -170));
  objects.add(
    worn(
      base,
      up([
        [-46, -344],
        [-42, -320],
        [-54, -292],
        [-50, -262],
        [-34, -232],
        [-16, -212],
        [0, -204],
        [-2, -270],
        [0, -332],
        [-20, -336],
      ]),
      stone,
    ),
  );
  groove(
    objects,
    base,
    up([
      [-46, -345],
      [-20, -337],
      [0, -333],
      [20, -337],
      [46, -345],
    ]),
    f32(2.4),
    230,
  ); // Where the beard leaves the cheeks.
  groove(
    objects,
    base,
    up([
      [-18, -328],
      [-21, -290],
      [-17, -250],
      [-10, -218],
    ]),
    f32(2.2),
  );
  groove(
    objects,
    base,
    up([
      [18, -328],
      [21, -290],
      [17, -250],
      [10, -218],
    ]),
    f32(2.2),
  );
  for (const y of [-286, -248]) {
    groove(
      objects,
      base,
      up([
        [-44, y],
        [-23, f32(y + 2)],
      ]),
    );
    groove(
      objects,
      base,
      up([
        [-14, f32(y + 3)],
        [14, f32(y + 3)],
      ]),
    );
    groove(
      objects,
      base,
      up([
        [23, f32(y + 2)],
        [44, y],
      ]),
    );
  }
  for (const x of [-28, 0, 28]) {
    let y = f32(-224 + f32(Math.abs(x) * f32(0.5)));
    objects.add(
      worn(
        base,
        up([
          [f32(x - 6), f32(y + 2)],
          [f32(x + 6), f32(y + 2)],
          [x, f32(y + 11)],
        ]),
        opaque(frost, snowy ? 230 : 150),
      ),
    );
  }
  objects.add(
    worn(
      base,
      up([
        [-36, -342],
        [-8, -346],
        [0, -340],
        [8, -346],
        [36, -342],
        [30, -330],
        [0, -334],
        [-30, -330],
      ]),
      lit,
    ),
  );
  objects.add(
    worn(
      base,
      up([
        [0, -340],
        [8, -346],
        [36, -342],
        [30, -330],
        [0, -334],
      ]),
      stone,
    ),
  );
  groove(
    objects,
    base,
    up([
      [-30, -330],
      [0, -334],
      [30, -330],
    ]),
    f32(1.8),
    220,
  );
  // A circlet of stone set with spikes of ice.
  objects.add(
    facet(
      base,
      up([
        [-48, -398],
        [48, -398],
        [46, -388],
        [-46, -388],
      ]),
      shade,
    ),
  );
  objects.add(
    facet(
      base,
      up([
        [-48, -398],
        [0, -398],
        [0, -388],
        [-46, -388],
      ]),
      stone,
    ),
  );
  let band = f32(crown.y + f32(f32(-398 - crown.y) * big));
  for (const [x, h] of [
    [-40, 14],
    [-27, 20],
    [-14, 26],
    [0, 32],
    [14, 26],
    [27, 20],
    [40, 14],
  ]) {
    let at = f32(x * big);
    objects.add(
      facet(
        base,
        [
          [f32(at - 6), band],
          [at, band],
          [at, f32(band - h)],
        ],
        rimeLit,
      ),
    );
    objects.add(
      facet(
        base,
        [
          [at, band],
          [f32(at + 6), band],
          [at, f32(band - h)],
        ],
        rimeShade,
      ),
    );
  }
  for (const dot of [
    [-100, -250],
    [-84, -226],
    [-60, -290],
    [-94, -84],
    [-78, -40],
    [-30, -390],
  ])
    objects.add(ellipse(add(base, pt(dot)), f32(2.4), f32(1.8), opaque(lichen, 150)));
  if (snowy) {
    objects.add(
      worn(
        base,
        up([
          [-48, -398],
          [-24, -418],
          [0, -424],
          [24, -418],
          [48, -398],
          [0, -410],
        ]),
        snow,
      ),
    );
    objects.add(
      worn(
        base,
        [
          [-164, -258],
          [-140, -262],
          [-124, -258],
          [-140, -252],
        ],
        snow,
      ),
    );
    objects.add(
      worn(
        base,
        [
          [164, -258],
          [140, -262],
          [124, -258],
          [140, -252],
        ],
        snow,
      ),
    );
    objects.add(
      worn(
        base,
        [
          [-140, -44],
          [-10, -112],
          [10, -112],
          [140, -44],
          [120, -46],
          [10, -104],
          [-10, -104],
          [-120, -46],
        ],
        opaque(snow, 220),
      ),
    );
  }
  // Eyes that catch a cold light only after dark.
  const light: YmirLight = {
    eyes: [
      add(add(base, crown), mul(sub(point(-17, -362), crown), big)),
      add(add(base, crown), mul(sub(point(17, -362), crown), big)),
    ],
    dais: base,
    glints: [],
  };
  for (let i = 0; i < 2; ++i) {
    const eye = ellipse(light.eyes[i], 5, f32(2.4), [176, 214, 255, 255]);
    eye.opacity(0);
    objects.add(eye);
    light.glints[i] = eye;
  }
  return light;
}
