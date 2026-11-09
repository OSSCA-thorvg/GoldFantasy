import {
  add,
  sub,
  scale,
  normalized,
  length,
  distance,
  centroid,
  tileHalfHeight,
  type Point,
} from '../../engine/src/geometry';
import { Layer, Terrain, isWater, isStone, lavaLevel, crestRidge } from '../../engine/src/world-types';
import { ShapeNode, SceneNode, type Rgb, type Rgba } from './paint';
import { appendPolygon, fill, mix, opaque, sightDisc } from './vector-paint';
import { region, eachCell, appendOutline, type Sample } from './contours';
import type { Climate, TerrainMap, TileRegion, River, Sight } from './render-types';
const f = Math.fround;
const seaDrop = f(22 / (2 * tileHalfHeight));
const palette: readonly (readonly Rgb[])[] = [
  [
    [36, 50, 40],
    [40, 55, 42],
    [44, 59, 45],
    [48, 63, 47],
  ],
  [
    [50, 62, 42],
    [54, 66, 44],
    [58, 70, 46],
    [62, 74, 48],
  ],
  [
    [28, 40, 33],
    [31, 43, 35],
    [34, 46, 37],
    [37, 49, 39],
  ],
  [
    [20, 31, 45],
    [22, 34, 49],
    [24, 37, 53],
    [26, 40, 57],
  ],
  [
    [58, 57, 61],
    [63, 62, 66],
    [68, 67, 71],
    [73, 72, 76],
  ],
  [
    [84, 76, 58],
    [88, 80, 61],
    [92, 83, 64],
    [96, 87, 67],
  ],
  [
    [14, 24, 36],
    [15, 26, 38],
    [16, 28, 40],
    [17, 30, 42],
  ],
  [
    [52, 52, 60],
    [56, 56, 64],
    [60, 60, 68],
    [64, 64, 72],
  ],
  [
    [58, 52, 50],
    [62, 56, 53],
    [66, 60, 56],
    [70, 64, 59],
  ],
  [
    [150, 158, 170],
    [156, 164, 176],
    [162, 170, 182],
    [168, 176, 188],
  ],
  [
    [120, 150, 172],
    [126, 156, 178],
    [132, 162, 184],
    [138, 168, 190],
  ],
  [
    [150, 52, 24],
    [162, 60, 26],
    [174, 68, 28],
    [186, 76, 30],
  ],
];
export type Tint = (climate: Climate) => Rgba;
export interface Tinted {
  shape: ShapeNode;
  color: Tint;
  stroke: boolean;
}
export interface FogPatch {
  disc: ShapeNode;
  sight: Sight;
}
function drop(p: Point, k = 1): Point {
  return { x: f(p.x + f(seaDrop * k)), y: f(p.y + f(seaDrop * k)) };
}
function layer(map: TerrainMap, which: Layer): Sample {
  return (i, j) => map.sample(which, i, j);
}
function paintSea(iso: SceneNode, map: TerrainMap, tints: Tinted[], area?: TileRegion): void {
  const land = layer(map, Layer.Land);
  const bands: [number, Rgb, number][] = [
    [0.32, [13, 22, 32], 0.08],
    [0.18, [16, 28, 39], 0.13],
    [0.09, [20, 35, 47], 0.18],
    [0.04, [25, 43, 55], 0.22],
    [0.012, [32, 53, 64], 0.26],
  ];
  for (const [depth, color, freezes] of bands) {
    const shape = region(map, 2, (i, j) => f(land(i, j) + f(depth)), drop({ x: 0, y: 0 }), area);
    tints.push({
      shape,
      color: (k) => opaque(mix(color, [84, 98, 116], f(f(freezes) * k.frost))),
      stroke: false,
    });
    iso.add(shape);
  }
}
function paintCliffs(iso: SceneNode, map: TerrainMap, area?: TileRegion): void {
  const faces: { a: Point; b: Point; depth: number; color: Rgb; molten: boolean }[] = [];
  eachCell(
    map,
    0,
    layer(map, Layer.Land),
    (cell) => {
      for (const { a, b } of cell.edges) {
        const nx = f(b.y - a.y),
          ny = f(a.x - b.x),
          len = f(Math.hypot(nx, ny));
        if (len < f(1e-4) || f(nx + ny) <= 0) continue;
        const side = Math.max(0, Math.min(1, f(f(f(f(nx - ny) / len) * f(0.5)) + f(0.5))));
        const inland = {
          x: f(f(f(a.x + b.x) / 2) - f(f(nx / len) * f(0.3))),
          y: f(f(f(a.y + b.y) / 2) - f(f(ny / len) * f(0.3))),
        };
        const ground = map.terrainAt(inland),
          molten = ground === Terrain.Lava;
        const color = molten
          ? mix([240, 128, 46], [198, 72, 28], side)
          : ground === Terrain.Sand
            ? mix([92, 80, 62], [66, 58, 46], side)
            : mix([50, 44, 44], [30, 27, 31], side);
        faces.push({ a, b, depth: f(f(f(f(a.x + b.x) + a.y) + b.y) / 2), color, molten });
      }
    },
    area,
  );
  faces.sort((a, b) => a.depth - b.depth);
  let current: ShapeNode | undefined,
    currentKey = -1;
  for (const face of faces) {
    const key = (face.color[0] << 16) | (face.color[1] << 8) | face.color[2];
    if (!current || key !== currentKey) {
      current = new ShapeNode();
      fill(current, opaque(face.color));
      iso.add(current);
      currentKey = key;
    }
    appendPolygon(current, [face.a, face.b, drop(face.b), drop(face.a)]);
  }
  const lip = new ShapeNode();
  for (const face of faces)
    if (!face.molten) appendPolygon(lip, [face.a, face.b, drop(face.b, f(0.18)), drop(face.a, f(0.18))]);
  fill(lip, [24, 22, 20, 120]);
  iso.add(lip);
}
export function riverRibbon(river: River, half: (i: number) => number): ShapeNode {
  const shape = new ShapeNode(),
    path = river.path;
  if (path.length < 2) return shape;
  const left: Point[] = [],
    right: Point[] = [],
    wet: boolean[] = [];
  for (let i = 0; i < path.length; i++) {
    const along = normalized(sub(path[Math.min(i + 1, path.length - 1)], path[i > 0 ? i - 1 : 0])),
      normal = { x: -along.y, y: along.x },
      reach = half(i);
    wet[i] = river.width[i] > 0 && reach > 0;
    left.push(add(path[i], scale(normal, reach)));
    right.push(sub(path[i], scale(normal, reach)));
  }
  for (let first = 0; first < path.length;) {
    while (first < path.length && !wet[first]) first++;
    let end = first;
    while (end < path.length && wet[end]) end++;
    if (end - first >= 2) {
      shape.moveTo(left[first].x, left[first].y);
      for (let i = first + 1; i < end; i++) shape.lineTo(left[i].x, left[i].y);
      for (let i = end - 1; i >= first; i--) shape.lineTo(right[i].x, right[i].y);
      shape.close();
    }
    first = end;
  }
  return shape;
}
export function groundColor(terrain: Terrain, shade: number, climate: Climate): Rgb {
  let base = palette[terrain][shade];
  const barren =
    terrain === Terrain.Ash ||
    terrain === Terrain.Frost ||
    terrain === Terrain.Ice ||
    terrain === Terrain.Lava;
  const bare = isWater(terrain) || isStone(terrain) || terrain === Terrain.Sand || barren;
  if (!bare) {
    base = mix(base, [58, 72, 44], f(f(0.2) * climate.summer));
    base = mix(base, [92, 70, 40], f(f(0.32) * climate.autumn));
  }
  if (isWater(terrain)) return mix(base, [84, 98, 116], f(f(0.55) * climate.frost));
  if (terrain === Terrain.Lava) return base;
  return mix(base, [148, 156, 168], f(climate.snow * (isStone(terrain) ? f(0.55) : f(0.8))));
}
export function paintGround(iso: SceneNode, map: TerrainMap, area?: TileRegion): Tinted[] {
  const tints: Tinted[] = [];
  paintSea(iso, map, tints, area);
  paintCliffs(iso, map, area);
  const land = layer(map, Layer.Land),
    elevation = layer(map, Layer.Elevation),
    moisture = layer(map, Layer.Moisture),
    beach = layer(map, Layer.Beach),
    shade = layer(map, Layer.Shade);
  const addTint = (shape: ShapeNode, color: Tint) => {
    tints.push({ shape, color, stroke: false });
    iso.add(shape);
  };
  const onLand =
    (sample: Sample): Sample =>
    (i, j) =>
      Math.min(sample(i, j), land(i, j));
  const tone =
    (terrain: Terrain): Tint =>
    (k) =>
      opaque(groundColor(terrain, 1, k));
  const bounded = (sample: Sample) => region(map, 0, sample, { x: 0, y: 0 }, area);
  addTint(bounded(land), tone(Terrain.Grass));
  addTint(bounded(onLand((i, j) => f(f(0.38) - moisture(i, j)))), tone(Terrain.Meadow));
  addTint(bounded(onLand((i, j) => f(moisture(i, j) - f(0.54)))), tone(Terrain.Forest));
  const heat = layer(map, Layer.Heat);
  addTint(bounded(onLand((i, j) => f(f(0.25) - heat(i, j)))), tone(Terrain.Frost));
  addTint(
    bounded(onLand((i, j) => Math.min(f(heat(i, j) - f(0.62)), f(f(0.5) - moisture(i, j))))),
    tone(Terrain.Ash),
  );
  addTint(bounded(onLand((i, j) => f(elevation(i, j) - f(0.7)))), tone(Terrain.Rock));
  addTint(
    bounded(onLand((i, j) => Math.min(f(f(0.2) - heat(i, j)), f(elevation(i, j) - f(0.55))))),
    tone(Terrain.Ice),
  );
  const ridge = layer(map, Layer.Ridge);
  addTint(bounded(onLand((i, j) => Math.min(ridge(i, j), f(land(i, j) - f(0.1))))), tone(Terrain.Mountain));
  const lava = (inset: number): Sample =>
    onLand((i, j) => f(lavaLevel(land(i, j), heat(i, j), ridge(i, j)) - f(inset)));
  addTint(bounded(lava(-0.12)), (k) => opaque(mix([46, 40, 39], [148, 156, 168], f(k.snow * f(0.3)))));
  addTint(bounded(lava(-0.03)), () => opaque([30, 24, 24]));
  addTint(bounded(lava(0)), tone(Terrain.Lava));
  addTint(bounded(lava(0.05)), () => opaque([204, 92, 34]));
  addTint(bounded(lava(0.13)), () => opaque([240, 150, 56]));
  addTint(
    bounded(
      onLand((i, j) =>
        Math.min(f(land(i, j) - f(0.1)), f(heat(i, j) - f(0.62)), f(ridge(i, j) - crestRidge)),
      ),
    ),
    tone(Terrain.Mountain),
  );
  addTint(
    bounded(onLand((i, j) => Math.min(f(f(0.05) - land(i, j)), f(beach(i, j) - f(0.45))))),
    tone(Terrain.Sand),
  );
  for (const level of [0.25, 0.5, 0.75])
    addTint(bounded(onLand((i, j) => f(shade(i, j) - f(level)))), () => [255, 255, 240, 6]);
  const facing = (i: number, j: number) =>
    f(
      f(
        f(elevation(i + 2, j) - elevation(i - 2, j)) +
          f(f(0.35) * f(elevation(i, j + 2) - elevation(i, j - 2))),
      ) / 2,
    );
  for (const [step, lit] of [
    [0.012, true],
    [0.03, true],
    [0.012, false],
    [0.03, false],
  ] as const)
    addTint(bounded(onLand((i, j) => f((lit ? facing(i, j) : -facing(i, j)) - f(step)))), () =>
      lit ? [255, 250, 235, 18] : [12, 14, 26, 26],
    );
  const lake: Sample = (i, j) => Math.min(f(land(i, j) - f(0.12)), f(f(0.3) - elevation(i, j)));
  const water: Tint = (k) => opaque(groundColor(Terrain.Water, 2, k)),
    bank: Tint = (k) =>
      opaque(mix(groundColor(Terrain.Sand, 1, k), groundColor(Terrain.Water, 2, k), f(0.35)));
  addTint(
    bounded((i, j) => f(lake(i, j) + f(0.025))),
    bank,
  );
  addTint(bounded(lake), water);
  const deeper =
    (color: Rgb): Tint =>
    (k) =>
      opaque(mix(color, [84, 98, 116], f(f(0.55) * k.frost)));
  const depths: [number, Rgb][] = [
    [0.03, [20, 31, 45]],
    [0.08, [16, 26, 38]],
    [0.14, [13, 22, 33]],
  ];
  for (const [depth, color] of depths)
    addTint(
      bounded((i, j) => f(lake(i, j) - f(depth))),
      deeper(color),
    );
  addTint(
    bounded((i, j) => Math.min(lake(i, j), f(f(0.2) - heat(i, j)))),
    tone(Terrain.Ice),
  );
  const river = map.river();
  for (const [extra, color] of [
    [f(0.22), bank],
    [0, water],
  ] as const) {
    const ribbon = riverRibbon(river, (i) => f(f(river.width[i] / 2) + extra));
    tints.push({ shape: ribbon, color, stroke: false });
    const cut = bounded(land);
    cut.fill(255, 255, 255);
    ribbon.clip(cut);
    iso.add(ribbon);
  }
  const inland = (p: Point) => {
    const pond = Math.min(f(map.value(Layer.Land, p) - f(0.12)), f(f(0.3) - map.value(Layer.Elevation, p)));
    return f(
      Math.max(0, Math.min(1, f(f(map.value(Layer.Land, p) - f(0.02)) / f(0.1)))) *
        Math.max(0, Math.min(1, f(-pond / f(0.03)))),
    );
  };
  for (const [share, color] of [
    [f(0.55), depths[0][1]],
    [f(0.25), depths[1][1]],
  ] as const)
    addTint(
      riverRibbon(river, (i) => f(f(f(river.width[i] / 2) * share) * inland(river.path[i]))),
      deeper(color),
    );
  return tints;
}
export function tintGround(tints: Tinted[], climate: Climate): void {
  for (const tint of tints) {
    const color = tint.color(climate);
    if (tint.stroke) tint.shape.strokeFill(...color);
    else fill(tint.shape, color);
  }
}
export interface FieldTown {
  calendar(): { season: number };
  climate(): Climate;
  tendedFieldAcres(): number;
  fields(): readonly { outline: Point[]; acres(): number }[];
  buildings(): readonly { built(): boolean; footprint(): { corners(): Point[] } }[];
}
function crop(season: number, tended: boolean): { ground: Rgb; furrow: Rgb } {
  if (!tended && season !== 3) return { ground: [52, 58, 40], furrow: [64, 72, 46] };
  const crops: { ground: Rgb; furrow: Rgb }[] = [
    { ground: [78, 60, 42], furrow: [56, 42, 30] },
    { ground: [62, 96, 50], furrow: [46, 74, 38] },
    { ground: [166, 136, 62], furrow: [124, 100, 44] },
    { ground: [106, 108, 114], furrow: [84, 86, 92] },
  ];
  return crops[season];
}
export function paintFields(iso: SceneNode, town: FieldTown): void {
  const season = town.calendar().season,
    snow = town.climate().snow;
  let tended = town.tendedFieldAcres();
  for (const field of town.fields()) {
    const worked = tended >= Math.trunc(field.acres() / 2);
    tended = Math.max(0, tended - field.acres());
    const colors = crop(season, worked);
    colors.ground = mix(colors.ground, [148, 156, 168], f(snow * f(0.85)));
    colors.furrow = mix(colors.furrow, [128, 136, 148], f(snow * f(0.85)));
    const outline = field.outline,
      plot = new ShapeNode();
    appendOutline(plot, outline);
    fill(plot, opaque(colors.ground));
    plot.strokeWidth(f(0.06)).strokeJoin('round').strokeFill(46, 34, 26);
    iso.add(plot);
    let along: Point = { x: 1, y: 0 },
      longest = 0;
    for (let i = 0; i < outline.length; i++) {
      const edge = sub(outline[(i + 1) % outline.length], outline[i]);
      if (length(edge) > longest) {
        longest = length(edge);
        along = normalized(edge);
      }
    }
    const across = { x: -along.y, y: along.x },
      c = centroid(outline);
    let reach = 0;
    for (const p of outline) reach = Math.max(reach, distance(p, c));
    const furrows = new ShapeNode();
    for (let offset = -reach; offset <= reach; offset = f(offset + f(0.25))) {
      const mid = add(c, scale(across, offset)),
        a = sub(mid, scale(along, reach)),
        b = add(mid, scale(along, reach));
      furrows.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    furrows.strokeWidth(f(0.06)).strokeFill(...colors.furrow);
    const clip = new ShapeNode();
    appendOutline(clip, outline);
    clip.fill(255, 255, 255);
    iso.add(new SceneNode().add(furrows).clip(clip));
  }
  for (const item of town.buildings()) {
    if (item.built()) continue;
    const corners = item.footprint().corners(),
      line = new ShapeNode();
    appendOutline(line, corners);
    line
      .strokeWidth(f(0.05))
      .strokeDash([f(0.18), f(0.12)])
      .strokeFill(214, 186, 120, 200);
    iso.add(line);
    const stakes = new ShapeNode();
    for (const p of corners) stakes.appendCircle(p.x, p.y, f(0.07), f(0.07));
    stakes.fill(120, 90, 60);
    iso.add(stakes);
  }
}
export function coveredSights(seen: Sight[]): boolean[] {
  const covered = seen.map(() => false),
    indexed = seen.every(
      (s) =>
        Number.isFinite(s.center.x) &&
        Number.isFinite(s.center.y) &&
        Number.isFinite(s.radius) &&
        Math.abs(s.center.x) <= 1e6 &&
        Math.abs(s.center.y) <= 1e6 &&
        s.radius >= 0 &&
        s.radius <= 1e6,
    );
  if (!indexed) {
    for (let i = 0; i < seen.length; i++)
      for (let j = 0; j < seen.length && !covered[i]; j++)
        covered[i] =
          j !== i &&
          f(distance(seen[i].center, seen[j].center) + seen[i].radius) <= seen[j].radius &&
          (seen[j].radius > seen[i].radius || j < i);
    return covered;
  }
  const order = seen.map((_, i) => i).sort((a, b) => seen[b].radius - seen[a].radius);
  if (!order.length) return covered;
  const cell = (p: Point) => ({ x: Math.floor(f(p.x / 8)), y: Math.floor(f(p.y / 8)) }),
    buckets = new Map<string, number[]>(),
    previous: number[] = [],
    largest = seen[order[0]].radius;
  for (const i of order) {
    const s = seen[i],
      padding = f(
        f(1e-4) +
          f(f(4 * f(1.1920928955078125e-7)) * f(f(Math.abs(s.center.x) + Math.abs(s.center.y)) + largest)),
      ),
      reach = f(f(largest - s.radius) + padding);
    const low = cell(sub(s.center, { x: reach, y: reach })),
      high = cell(add(s.center, { x: reach, y: reach })),
      contains = (j: number) => f(distance(s.center, seen[j].center) + s.radius) <= seen[j].radius;
    if ((high.x - low.x + 1) * (high.y - low.y + 1) > 4096) covered[i] = previous.some(contains);
    else
      for (let y = low.y; y <= high.y && !covered[i]; y++)
        for (let x = low.x; x <= high.x && !covered[i]; x++)
          covered[i] = (buckets.get(`${x},${y}`) ?? []).some(contains);
    const key = cell(s.center),
      name = `${key.x},${key.y}`,
      bucket = buckets.get(name) ?? [];
    bucket.push(i);
    buckets.set(name, bucket);
    previous.push(i);
  }
  return covered;
}
export function paintFog(iso: SceneNode, map: TerrainMap, patches?: FogPatch[]): ShapeNode[] {
  if (patches) patches.length = 0;
  const veil = new ShapeNode().appendRect(-2, -2, f(map.width() + 4), f(map.height() + 4)).fill(0, 0, 0),
    sight = new SceneNode(),
    seen = map.sights(),
    covered = coveredSights(seen);
  for (let i = 0; i < seen.length; i++) {
    if (covered[i]) continue;
    const s = seen[i],
      radius = f(s.radius + 1),
      disc = sightDisc(radius).translate(s.center.x, s.center.y);
    sight.add(disc);
    patches?.push({ disc, sight: { center: s.center, radius } });
  }
  veil.mask(sight, 'inverseAlpha');
  iso.add(veil);
  return [veil];
}
