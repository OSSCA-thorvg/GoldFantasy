import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Town } from '../../packages/engine/src/town';
import { Camera, point, project, unproject } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import { Preview } from '../../packages/engine/src/game-tools';
import { WorldMap } from '../../packages/engine/src/world-map';
import { DungeonKind, Terrain, World } from '../../packages/engine/src/world-types';
import {
  findRealmArea,
  inArea,
  planRealm,
  realmGap,
  sinkRealm,
  stampRealm,
} from '../../packages/engine/src/realm-layout';
import { WorldRenderer } from '../../packages/native-renderer/src/world-renderer';
import {
  SceneNode,
  ShapeNode,
  TextNode,
  identity,
  type PaintNode,
  type Rgb,
} from '../../packages/native-renderer/src/paint';
import { groundColor, paintGround } from '../../packages/native-renderer/src/terrain-painter';
import {
  Liquid,
  drift,
  driftOffset,
  moveWater,
  waterRate,
} from '../../packages/native-renderer/src/water-motion';
import { gateBody, gateBounds, gateSprite } from '../../packages/native-renderer/src/gate-sprites';
import { TreeBatch, TreeKind, treeAt } from '../../packages/native-renderer/src/tree-painter';
import {
  breath,
  lavaPatches,
  updateLava,
  type LavaPatch,
} from '../../packages/native-renderer/src/lava-motion';
import { PeakBatch } from '../../packages/native-renderer/src/mountain-peaks';

class PixelBuffer {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    return {
      putImageData: (image: PixelBuffer) => (this.pixels = image.data.slice()),
      clearRect: () => this.pixels.fill(0),
    };
  }
}
const calm = { summer: 0, autumn: 0, snow: 0, frost: 0 };
const flatten = (p: PaintNode): PaintNode[] => [
  p,
  ...(p instanceof SceneNode ? p.children.flatMap(flatten) : []),
];
const luma = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Extent of every path in a set of shapes, curves sampled (identity transforms only). */
function extent(shapes: readonly PaintNode[]): { left: number; top: number; right: number; bottom: number } {
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const p of shapes.flatMap(flatten))
    if (p instanceof ShapeNode)
      for (const [i, c] of p.commands.entries()) {
        const xs: number[] = [],
          ys: number[] = [];
        if (c[0] === 'M' || c[0] === 'L') (xs.push(c[1]), ys.push(c[2]));
        else if (c[0] === 'C') {
          const from = p.commands[i - 1],
            x0 = from[from.length - 2],
            y0 = from[from.length - 1];
          for (let t = 0; t <= 1; t += 0.05) {
            const u = 1 - t,
              at = (a: number, b: number, c2: number, d: number) =>
                u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c2 + t * t * t * d;
            xs.push(at(x0, c[1], c[3], c[5]));
            ys.push(at(y0, c[2], c[4], c[6]));
          }
        } else continue;
        box.left = Math.min(box.left, ...xs);
        box.right = Math.max(box.right, ...xs);
        box.top = Math.min(box.top, ...ys);
        box.bottom = Math.max(box.bottom, ...ys);
      }
  return box;
}

describe('liquid water', () => {
  it('drifts each band on a bounded, varied loop and keeps frozen water and reduced motion still', () => {
    const bands = [0, 1, 2, 3, 4].map((salt) => drift(Liquid.Water, 0.2, 10, salt));
    for (const band of bands)
      for (let t = 0; t < 60; t += 0.37) {
        const o = driftOffset(band, t, calm);
        expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(0.2 * 1.1);
      }
    const at = (t: number) => bands.map((band) => driftOffset(band, t, calm));
    expect(at(3)).not.toEqual(at(7));
    // Neighbouring bands do not slide together.
    expect(at(3)[0]).not.toEqual(at(3)[1]);
    expect(driftOffset(bands[0], 5, { ...calm, frost: 1 })).toEqual({ x: 0, y: 0 });
    const lava = drift(Liquid.Lava, 0.12, 19, 21);
    expect(driftOffset(lava, 5, { ...calm, frost: 1 })).not.toEqual({ x: 0, y: 0 });
  });

  it('moves a fixed set of contour shapes by transform alone, at most twelve times a second', () => {
    const map = WorldMap.generate(5, 48, 48),
      iso = new SceneNode(),
      tints = paintGround(iso, map),
      drifting = tints.filter((t) => t.drift),
      nodes = flatten(iso).length,
      paths = drifting.map((t) => t.shape.pathVersion),
      clock = { waterAt: -1, waterStill: false };
    // Five sea bands, three lake depths and two river channels; lava moves by cell, not with the water.
    expect(drifting.length).toBe(10);
    expect(drifting.filter((t) => t.drift!.liquid === Liquid.Lava).length).toBe(0);
    expect(moveWater(clock, [tints], 1, calm, false)).toBe(true);
    const first = drifting.map((t) => t.shape.matrix);
    expect(moveWater(clock, [tints], 1 + 0.5 / waterRate, calm, false)).toBe(false);
    expect(moveWater(clock, [tints], 2.5, calm, false)).toBe(true);
    expect(drifting.map((t) => t.shape.matrix)).not.toEqual(first);
    // No re-contouring: paths and node count are untouched by motion.
    expect(drifting.map((t) => t.shape.pathVersion)).toEqual(paths);
    expect(flatten(iso).length).toBe(nodes);
    // Reduced motion parks every band at rest once and then does nothing.
    expect(moveWater(clock, [tints], 3, calm, true)).toBe(true);
    expect(drifting.every((t) => t.shape.matrix.every((v, i) => v === identity[i]))).toBe(true);
    expect(moveWater(clock, [tints], 4, calm, true)).toBe(false);
  });
});

describe('the renderer keeps water moving cheaply', () => {
  let tvg: ThorVGNamespace;
  beforeAll(async () => {
    vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
    vi.stubGlobal('ImageData', PixelBuffer);
    const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
    tvg = await ThorVG.init({
      renderer: 'sw',
      locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
    });
    for (const font of ['DejaVuSans', 'DejaVuSans-Bold'])
      tvg.Font.load(font, new Uint8Array(readFileSync(`public/assets/native-fonts/${font}.ttf`)));
  });
  afterAll(() => {
    tvg.term();
    vi.unstubAllGlobals();
  });
  it('drifts the sea between frames without new nodes, and holds still under reduced motion', () => {
    const town = new Town(5, 64),
      renderer = new WorldRenderer(tvg),
      traffic = new Traffic(5),
      preview = new Preview(),
      c = project(32, 32),
      camera = new Camera(c.x, c.y, 1);
    renderer.reducedMotion = false;
    try {
      renderer.update(town, traffic, camera, 640, 480, 1, preview, []);
      const bands = renderer.groundTints.filter((t) => t.drift).map((t) => t.shape),
        nodes = flatten(renderer.ground).length,
        before = bands.map((b) => b.matrix);
      expect(bands.length).toBeGreaterThan(0);
      renderer.update(town, traffic, camera, 640, 480, 4, preview, []);
      expect(bands.map((b) => b.matrix)).not.toEqual(before);
      expect(flatten(renderer.ground).length).toBe(nodes);
      renderer.reducedMotion = true;
      renderer.update(town, traffic, camera, 640, 480, 7, preview, []);
      const still = bands.map((b) => b.matrix);
      renderer.update(town, traffic, camera, 640, 480, 9, preview, []);
      expect(bands.map((b) => b.matrix)).toEqual(still);
      expect(still.every((m) => m.every((v, i) => v === identity[i]))).toBe(true);
    } finally {
      renderer.dispose();
    }
  });
});

describe('gates', () => {
  const kinds = [
    DungeonKind.Cave,
    DungeonKind.Crypt,
    DungeonKind.Portal,
    DungeonKind.Ruin,
    DungeonKind.GiantHall,
    DungeonKind.Return,
  ];
  const draw = (kind: DungeonKind, world: World, sealed: boolean) => {
    const objects = new SceneNode(),
      lights = new SceneNode(),
      site = { name: 'Gate', kind, origin: { x: 10, y: 10 }, discovered: true },
      pulse = gateSprite(objects, lights, { site, world, sealed });
    return { objects, lights, pulse, body: gateBody(objects) };
  };
  it('draws every kind with a pick body, and an open gate pulses with the light of its world', () => {
    for (const kind of kinds) {
      const open = draw(kind, World.Asgard, false);
      expect(open.body.length, DungeonKind[kind]).toBeGreaterThan(2);
      expect(open.body).not.toContain(open.pulse);
      if (kind !== DungeonKind.GiantHall) {
        expect(open.pulse, DungeonKind[kind]).not.toBeNull();
        expect(open.lights.children.length).toBe(1);
      }
    }
    const hint = (world: World) =>
      JSON.stringify(
        flatten(draw(DungeonKind.Portal, world, false).objects).map((p) =>
          p instanceof ShapeNode ? p.color : null,
        ),
      );
    expect(new Set([World.Alfheim, World.Vanaheim, World.Niflheim].map(hint)).size).toBe(3);
  });
  it('draws no name on a gate (hover and selection show it) and registers bounds that hold all it draws', () => {
    for (const kind of kinds)
      for (const sealed of [false, true]) {
        const objects = new SceneNode(),
          site = { name: 'Eastshore Stone Hall', kind, origin: { x: 10, y: 10 }, discovered: true };
        gateSprite(objects, new SceneNode(), { site, world: World.Asgard, sealed });
        expect(
          objects.children.some((p) => p instanceof TextNode),
          DungeonKind[kind],
        ).toBe(false);
        const bounds = gateBounds(objects)!,
          drawn = extent(objects.children.filter((p) => p instanceof ShapeNode));
        expect(bounds, DungeonKind[kind]).toBeDefined();
        expect(drawn.left).toBeGreaterThanOrEqual(bounds.x);
        expect(drawn.right).toBeLessThanOrEqual(bounds.x + bounds.w);
        expect(drawn.top).toBeGreaterThanOrEqual(bounds.y);
        expect(drawn.bottom).toBeLessThanOrEqual(bounds.y + bounds.h);
      }
  });
  it('shuts a sealed gate for good: a slab and rune, no pulse and no light', () => {
    for (const kind of [DungeonKind.Cave, DungeonKind.Crypt, DungeonKind.Portal, DungeonKind.Ruin]) {
      const open = draw(kind, World.Helheim, false),
        sealed = draw(kind, World.Helheim, true);
      expect(sealed.pulse, DungeonKind[kind]).toBeNull();
      expect(sealed.lights.children.length).toBe(0);
      expect(
        JSON.stringify(sealed.objects.children.map((p) => (p instanceof ShapeNode ? p.commands : null))),
      ).not.toBe(
        JSON.stringify(open.objects.children.map((p) => (p instanceof ShapeNode ? p.commands : null))),
      );
    }
  });
});

describe('molten lava', () => {
  let tvg: ThorVGNamespace;
  let town: Town;
  beforeAll(async () => {
    vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
    vi.stubGlobal('ImageData', PixelBuffer);
    const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
    tvg = await ThorVG.init({
      renderer: 'sw',
      locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
    });
    town = new Town(5);
  }, 120000);
  afterAll(() => {
    tvg.term();
    vi.unstubAllGlobals();
  });
  const lavaTile = () => {
    const map = town.map();
    for (let y = 0; y < map.height(); ++y)
      for (let x = 0; x < map.width(); ++x)
        if (map.at(x, y).terrain === Terrain.Lava) return point(x + 0.5, y + 0.5);
    throw new Error('no lava on the map');
  };
  const camp = () => town.map().camp();
  /** Renders a few frames with one resident standing at `stand` and the camera on `look`. */
  const view = (
    stand: { x: number; y: number },
    look: { x: number; y: number },
    hour: number,
    still = false,
  ) => {
    const renderer = new WorldRenderer(tvg),
      traffic = new Traffic(5),
      preview = new Preview(),
      c = project(look.x, look.y),
      camera = new Camera(c.x, c.y, 1);
    town.editHour(hour);
    for (const p of town.folk) p.position = { x: stand.x, y: stand.y };
    renderer.reducedMotion = still;
    let now = 1;
    const frame = (dt: number) => {
      now += dt;
      renderer.update(town, traffic, camera, 1280, 800, now, preview, []);
    };
    frame(0);
    frame(0.5);
    frame(0.5);
    return { renderer, frame, patches: lavaPatches(renderer.ground) };
  };
  const pose = (patch: LavaPatch) =>
    JSON.stringify([
      patch.bands.map((b) => b.shape.matrix),
      patch.spots.map((s) => [s.node.matrix, s.node.alpha]),
    ]);
  const lit = (patch: LavaPatch) => [
    patch.lights!.cut.alpha,
    patch.lights!.hole.alpha,
    patch.lights!.tint.alpha,
  ];

  it('crawls slower than water and barely sways across its heading', () => {
    const across = (liquid: Liquid) => {
      const d = drift(liquid, 0.1, 10, 3);
      let most = 0;
      for (let t = 0; t < 20; t += 0.05) {
        const o = driftOffset(d, t, calm);
        most = Math.max(most, Math.abs(-Math.sin(d.heading) * o.x + Math.cos(d.heading) * o.y));
      }
      return most;
    };
    expect(across(Liquid.Lava)).toBeLessThan(across(Liquid.Water) * 0.4);
    // A breath swells quickly, settles slowly and comes round again.
    expect(breath(0, 6, 0)).toBe(0);
    expect(breath(2.4, 6, 0)).toBeCloseTo(1, 5);
    expect(breath(4.2, 6, 0)).toBeGreaterThan(0.4);
    expect(breath(6, 6, 0)).toBeCloseTo(0, 5);
  });

  it('moves the bands and breathes the cores of the lava in sight, and leaves the rest untouched', () => {
    const at = lavaTile(),
      { renderer, frame, patches } = view(at, at, 12);
    try {
      expect(patches.length).toBeGreaterThan(4);
      const seen = patches.filter((p) => p.shown),
        hidden = patches.filter((p) => !p.shown);
      expect(seen.length).toBeGreaterThan(0);
      expect(hidden.length).toBeGreaterThan(0);
      expect(seen.some((p) => p.spots.length)).toBe(true);
      const nodes = flatten(renderer.ground).length,
        before = patches.map(pose);
      frame(1.7);
      frame(1.3);
      patches.forEach((patch, i) => {
        if (patch.shown) expect(pose(patch)).not.toBe(before[i]);
        else {
          expect(pose(patch)).toBe(before[i]);
          expect(patch.glow.alpha).toBe(0);
        }
      });
      // Motion is transforms and opacity only: no node is added or removed.
      expect(flatten(renderer.ground).length).toBe(nodes);
    } finally {
      renderer.dispose();
    }
  }, 60000);

  it('lights the lava it can see at night, not by day, and never lava nobody sees', () => {
    const at = lavaTile(),
      night = view(at, at, 23);
    try {
      for (const patch of night.patches) {
        if (patch.shown) {
          expect(lit(patch)[0]).toBe(255);
          expect(lit(patch)[2]).toBeGreaterThan(0);
        }
        // Unseen lava throws no light; explored lava on screen keeps only its own brightness.
        else expect(lit(patch).slice(1)).toEqual([0, 0]);
      }
      expect(night.patches.some((p) => p.shown)).toBe(true);
    } finally {
      night.renderer.dispose();
    }
    const day = view(at, at, 12);
    try {
      for (const patch of day.patches.filter((p) => p.shown)) expect(lit(patch)[2]).toBe(0);
    } finally {
      day.renderer.dispose();
    }
  }, 60000);

  it('holds still under reduced motion but keeps its glow', () => {
    const at = lavaTile(),
      { renderer, frame, patches } = view(at, at, 23, true);
    try {
      const seen = patches.filter((p) => p.shown);
      expect(seen.length).toBeGreaterThan(0);
      for (const patch of seen) {
        expect(patch.bands.every((b) => b.shape.matrix.every((v, i) => v === identity[i]))).toBe(true);
        expect(lit(patch)[2]).toBeGreaterThan(0);
      }
      const before = patches.map(pose);
      frame(2.3);
      frame(1.9);
      expect(patches.map(pose)).toEqual(before);
    } finally {
      renderer.dispose();
    }
  }, 60000);

  it('does no work for lava off screen or under fog: no moving band and no light', () => {
    const at = lavaTile(),
      cases = [
        // Off screen: the camera is on the camp, far from any flow.
        view(at, camp(), 23),
        // Under fog: the camera is on the lava, but everyone is at the camp.
        view(camp(), at, 23),
      ];
    for (const { renderer, frame, patches } of cases)
      try {
        expect(patches.every((p) => !p.shown && p.glow.alpha === 0)).toBe(true);
        expect(patches.every((p) => lit(p).every((alpha) => alpha === 0))).toBe(true);
        const before = patches.map(pose);
        frame(1.1);
        frame(2.2);
        expect(patches.map(pose)).toEqual(before);
        expect(updateLava(renderer, 9, town.climate(), false, 1)).toBe(0);
      } finally {
        renderer.dispose();
      }
  }, 60000);
});

describe('tree stature', () => {
  let tvg: ThorVGNamespace;
  beforeAll(async () => {
    vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
    vi.stubGlobal('ImageData', PixelBuffer);
    const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
    tvg = await ThorVG.init({
      renderer: 'sw',
      locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
    });
  });
  afterAll(() => {
    tvg.term();
    vi.unstubAllGlobals();
  });
  it('stands a grown tree at least three residents tall, slender, and varied from young to old', () => {
    const town = new Town(5),
      map = town.map(),
      renderer = new WorldRenderer(tvg),
      c = project(map.camp().x, map.camp().y);
    let resident = 0;
    try {
      for (const t of [1, 1.1])
        renderer.update(town, new Traffic(5), new Camera(c.x, c.y, 1), 1280, 800, t, new Preview(), []);
      renderer.scene();
      for (const figure of renderer.figures.values())
        resident = Math.max(resident, renderer.adapter.renderedBounds(figure.paint)?.h ?? 0);
    } finally {
      renderer.dispose();
    }
    expect(resident).toBeGreaterThan(15);
    const quantile = (list: number[], q: number) =>
      [...list].sort((a, b) => a - b)[Math.floor(q * (list.length - 1))];
    for (const kind of [TreeKind.Fir, TreeKind.SnowySpruce, TreeKind.Snag]) {
      const heights: number[] = [],
        widths: number[] = [];
      for (let y = 0; y < map.height(); ++y)
        for (let x = 0; x < map.width(); ++x)
          for (let i = 0; i < map.at(x, y).trees; ++i) {
            const tree = treeAt(map, x, y, i);
            if (tree.kind !== kind) continue;
            const batch = new TreeBatch(calm);
            batch.add(tree);
            const box = extent(batch.finish(project(tree.foot.x, tree.foot.y).y));
            heights.push(box.bottom - box.top);
            widths.push(box.right - box.left);
          }
      expect(heights.length, TreeKind[kind]).toBeGreaterThan(20);
      const grown = quantile(heights, 0.5);
      // Dead trees stand a little lower than living ones.
      expect(grown, TreeKind[kind]).toBeGreaterThanOrEqual((kind === TreeKind.Snag ? 2.4 : 3) * resident);
      expect(quantile(widths, 0.5) * 2.5, TreeKind[kind]).toBeLessThan(grown);
      // Young, grown and old: a ragged skyline, not a row of equal cones.
      expect(quantile(heights, 0.9) / quantile(heights, 0.1), TreeKind[kind]).toBeGreaterThan(1.8);
    }
  }, 120000);
});

describe('the land of Midgard', () => {
  const lit = (shape: ShapeNode): Rgb => {
    const top = shape.gradient!.stops[0].color;
    return [top[0], top[1], top[2]];
  };
  it('stands fresh green trees clear of the muted ground under them', () => {
    const batch = new TreeBatch(calm);
    batch.add({ kind: TreeKind.Fir, foot: point(10, 10), size: 1, slender: 1, lean: 0, variant: 0.5 });
    const base = project(10, 10).y,
      [, lit0, shade] = batch.finish(base);
    // Stems, lit canopy, shaded canopy: both canopy halves are shaded top to bottom.
    expect(lit0.gradient?.type).toBe('linear');
    expect(shade.gradient?.type).toBe('linear');
    const canopy = lit(lit0);
    expect(canopy[1]).toBeGreaterThan(Math.max(canopy[0], canopy[2]));
    for (const terrain of [Terrain.Grass, Terrain.Meadow, Terrain.Forest])
      for (let tone = 0; tone < 4; ++tone)
        expect(luma(canopy), `${Terrain[terrain]} ${tone}`).toBeGreaterThan(
          luma(groundColor(terrain, tone, calm)) + 12,
        );
  });
  it('paints peaks as grey-brown stone under white caps', () => {
    const batch = new PeakBatch({ ...calm });
    batch.add({ foot: point(10, 10), rise: 0.8, lean: 0, volcanic: false });
    const [face, , cap] = batch.finish(project(10, 10).y),
      stone = lit(face),
      snow = cap.color;
    expect(Math.max(...stone) - Math.min(...stone)).toBeLessThan(24);
    expect(luma(stone)).toBeGreaterThan(90);
    expect(luma(snow)).toBeGreaterThan(200);
  });
});

describe('the worlds beyond the gates', () => {
  let tvg: ThorVGNamespace;
  let town: Town;
  beforeAll(async () => {
    vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
    vi.stubGlobal('ImageData', PixelBuffer);
    const bytes = readFileSync('node_modules/@thorvg/webcanvas/dist/thorvg.wasm');
    tvg = await ThorVG.init({
      renderer: 'sw',
      locateFile: () => `data:application/wasm;base64,${bytes.toString('base64')}`,
    });
    town = new Town(5);
  }, 120000);
  afterAll(() => {
    tvg.term();
    vi.unstubAllGlobals();
  });
  it('raises walls of peaks between open lanes, drawn by the ordinary terrain painter', () => {
    const map = town.map(),
      area = findRealmArea(map)!;
    expect(area).not.toBeNull();
    for (const world of [World.Muspelheim, World.Jotunheim, World.Asgard]) {
      const plan = planRealm(map.seed(), world, 0, area);
      stampRealm(map, plan, world);
      const renderer = new WorldRenderer(tvg),
        c = project(area.x + area.size / 2, area.y + area.size / 2);
      try {
        renderer.update(town, new Traffic(5), new Camera(c.x, c.y, 0.5), 1280, 800, 1, new Preview(), []);
        let walls = 0,
          onFloor = 0;
        for (const row of renderer.rowTrees)
          for (const paint of row.children) {
            const box = extent([paint]),
              foot = unproject((box.left + box.right) / 2, box.bottom - 6);
            if (!inArea(area, foot)) continue;
            ++walls;
            if (realmGap(map.seed(), plan, foot) < -1.5) ++onFloor;
          }
        // Dense walls round the chambers and corridors, and nothing standing in a lane.
        expect(walls, World[world]).toBeGreaterThan(area.size * 6);
        expect(onFloor, World[world]).toBe(0);
      } finally {
        renderer.dispose();
        sinkRealm(map, area);
      }
    }
  }, 240000);
  it('keeps the landmarks of Midgard after a visit, even when a sight seen there reached over the sea square', () => {
    const map = town.map(),
      area = findRealmArea(map)!,
      volcano = map.volcano()!.center(),
      nearest = point(
        Math.min(Math.max(volcano.x, area.x), area.x + area.size),
        Math.min(Math.max(volcano.y, area.y), area.y + area.size),
      );
    expect(inArea(area, volcano)).toBe(false);
    // One look from the volcano that also reached a little way over the sea where worlds are raised.
    town.scout(volcano.x, volcano.y, Math.hypot(nearest.x - volcano.x, nearest.y - volcano.y) + 3);
    const renderer = new WorldRenderer(tvg),
      c = project(volcano.x, volcano.y),
      draw = (seconds: number) =>
        renderer.update(
          town,
          new Traffic(5),
          new Camera(c.x, c.y, 0.55),
          1280,
          800,
          seconds,
          new Preview(),
          [],
        );
    try {
      draw(1);
      expect(renderer.volcanoPaint.paint).toBeDefined();
      for (const world of [World.Muspelheim, World.Jotunheim]) {
        stampRealm(map, planRealm(map.seed(), world, 0, area), world);
        renderer.invalidateMap();
        draw(2);
        sinkRealm(map, area);
        renderer.invalidateMap();
        draw(3);
        expect(map.revealed(volcano), World[world]).toBe(true);
        expect(renderer.fireRow, World[world]).toBeGreaterThanOrEqual(0);
        expect(renderer.objects.children).toContain(renderer.volcanoPaint.paint);
      }
    } finally {
      renderer.dispose();
    }
  }, 240000);
});
