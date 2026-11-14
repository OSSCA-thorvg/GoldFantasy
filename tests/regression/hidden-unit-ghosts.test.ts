import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Town } from '../../packages/engine/src/town';
import { Traffic } from '../../packages/engine/src/traffic';
import { Preview } from '../../packages/engine/src/game-tools';
import { Camera, point, project, type Point } from '../../packages/engine/src/geometry';
import { Monster, Role, type Person } from '../../packages/engine/src/person';
import { Terrain } from '../../packages/engine/src/world-types';
import type { Command } from '../../packages/native-renderer/src/paint';
import { WorldRenderer } from '../../packages/native-renderer/src/world-renderer';
import { ShapeNode } from '../../packages/native-renderer/src/paint';
import { TreeKind, treeAt } from '../../packages/native-renderer/src/tree-painter';
import { ghostWork, ghostTouches, hiddenUnitGhosts } from '../../packages/native-renderer/src/hidden-unit-ghosts';
import { DungeonKind } from '../../packages/engine/src/world-types';
import { MonsterRank } from '../../packages/engine/src/combat-events';
import { animateAction } from '../../packages/native-renderer/src/action-motion';
import { showEquipment } from '../../packages/native-renderer/src/person-equipment';
import { seatHead } from '../../packages/native-renderer/src/world-sprites';
import { Draft } from '../../packages/native-renderer/src/ghost-trace';
import { traceResident } from '../../packages/native-renderer/src/ghost-figures';

class Pixels {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}
class MemoryCanvas {
  pixels = new Uint8ClampedArray();
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      putImageData: (p: Pixels) => (this.pixels = p.data.slice()),
      clearRect: () => this.pixels.fill(0),
    };
  }
}
let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', MemoryCanvas);
  vi.stubGlobal('ImageData', Pixels);
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

const width = 640,
  height = 480;
/** A grown fir standing alone: no mountain or water within six tiles, and the trees there cleared. */
function loneFir(town: Town): { cell: number; index: number; foot: Point } {
  const map = town.map();
  for (let y = 8; y < map.height() - 8; ++y)
    for (let x = 8; x < map.width() - 8; ++x) {
      if (map.at(x, y).trees !== 1) continue;
      const tree = treeAt(map, x, y, 0);
      if (tree.kind !== TreeKind.Fir || tree.size < 1 || tree.slender < 1) continue;
      let open = true;
      for (let dy = -6; dy <= 6; ++dy)
        for (let dx = -6; dx <= 6; ++dx) {
          const t = map.at(x + dx, y + dy).terrain;
          open &&= t !== Terrain.Mountain && t !== Terrain.Water && t !== Terrain.Sea;
        }
      if (!open) continue;
      for (let dy = -6; dy <= 6; ++dy)
        for (let dx = -6; dx <= 6; ++dx) if (dx || dy) map.at(x + dx, y + dy).trees = 0;
      return { cell: y * map.width() + x, index: 0, foot: tree.foot };
    }
  throw new Error('no lone fir');
}
function scene(town: Town, focus: Point) {
  const renderer = new WorldRenderer(tvg),
    surface = new MemoryCanvas(width, height),
    canvas = new tvg.Canvas(surface as unknown as HTMLCanvasElement, {
      width,
      height,
      enableDevicePixelRatio: false,
    }),
    at = project(focus.x, focus.y),
    camera = new Camera(at.x, at.y, 1);
  let seconds = 1;
  const draw = () => {
    // Two frames past the coverage interval, so the pass has run on the current places.
    for (let i = 0; i < 2; ++i) {
      seconds += 0.15;
      renderer.update(town, new Traffic(5), camera, width, height, seconds, new Preview(), []);
    }
    renderer.scene();
    canvas.update().render();
    renderer.presented(1);
  };
  draw();
  canvas.add(renderer.scene());
  const screen = (p: Point, lift = 0) => {
    const q = project(p.x, p.y);
    return camera.toScreen(point(q.x, q.y - lift), width, height);
  };
  return {
    renderer,
    draw,
    screen,
    ghosts: () => hiddenUnitGhosts(renderer),
    shapes: () => renderer.ghosts.children.filter((c): c is ShapeNode => c instanceof ShapeNode),
    dispose() {
      canvas.remove();
      renderer.dispose();
      canvas.destroy();
    },
  };
}

/** An outline's points relative to a foot in world pixels, so a pose can be told apart from a step. */
function relative(commands: readonly Command[], foot: Point): number[] {
  const at = project(foot.x, foot.y),
    out: number[] = [];
  for (const c of commands)
    if (c[0] === 'E') out.push(c[1] - at.x, c[2] - at.y, c[3], c[4]);
    else for (let i = 1; i < c.length; i += 2) out.push((c[i] as number) - at.x, (c[i + 1] as number) - at.y);
  return out;
}
const differs = (a: number[], b: number[]) => a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]) > 0.3);
/** The resident's outline alone, drawn through a fresh draft. */
function traced(figure: Parameters<typeof traceResident>[1]): Command[] {
  const draft = new Draft(),
    shape = new ShapeNode();
  draft.clear();
  traceResident(draft, figure);
  draft.present(shape);
  return shape.commands;
}

describe('units hidden behind trees and peaks', () => {
  let town: Town;
  let fir: ReturnType<typeof loneFir>;
  let resident: Person;
  const at = (dx: number, dy: number) => ({ x: fir.foot.x + dx, y: fir.foot.y + dy });
  beforeAll(() => {
    town = new Town(5);
    fir = loneFir(town);
    town.scout(fir.foot.x, fir.foot.y, 12);
    resident = town.folk.find((p) => p.role === Role.Resident)!;
    // The others stay at the camp; one resident is enough to see the fir.
    town.folk = [resident];
    town.beasts = [];
  });
  it('draws a ghost over a resident behind the canopy, and none in the open, in front, in a gap, inside or fogged', () => {
    const v = scene(town, fir.foot);
    try {
      resident.position = at(-0.35, -0.35);
      v.draw();
      expect(v.ghosts().map((g) => g.ref)).toEqual([{ kind: 'person', id: resident.id }]);
      expect(v.ghosts()[0].hostile).toBe(false);
      const drawn = v.shapes().filter((s) => s.commands.length > 0);
      expect(drawn).toHaveLength(1);
      // Translucent, so the tree still reads through it.
      expect(drawn[0].color).toBeUndefined();
      expect(drawn[0].strokeColor![3]).toBeGreaterThan(100);
      // In front of the trunk, three tiles out in the open, and behind the row but beside the canopy.
      for (const place of [at(0.3, 0.3), at(2.5, -2.5), at(-0.35 + 0.65, -0.35 - 0.65)]) {
        resident.position = place;
        v.draw();
        expect(v.ghosts(), JSON.stringify([place, fir.foot, v.ghosts()])).toHaveLength(0);
        expect(v.shapes().every((s) => s.commands.length === 0)).toBe(true);
      }
      resident.position = at(-0.35, -0.35);
      resident.inside = true;
      v.draw();
      expect(v.ghosts()).toHaveLength(0);
      resident.inside = false;
      v.draw();
      expect(v.ghosts()).toHaveLength(1);
      const sample = v.renderer.currentVisibility.sample;
      v.renderer.currentVisibility.sample = () => 0;
      v.draw();
      expect(v.ghosts()).toHaveLength(0);
      v.renderer.currentVisibility.sample = sample;
    } finally {
      v.dispose();
    }
  }, 120000);
  it('tells a monster from a friend, and a click on a ghost picks the unit while a click beside it picks the tree', () => {
    const v = scene(town, fir.foot),
      monster = new Monster(9001, 0, at(-0.35, -0.35));
    monster.health = 5;
    try {
      resident.position = at(-0.3, -0.42);
      town.beasts = [monster];
      v.draw();
      const ghosts = v.ghosts();
      expect(ghosts.map((g) => g.ref.kind).sort()).toEqual(['monster', 'person']);
      const friend = ghosts.find((g) => !g.hostile)!,
        foe = ghosts.find((g) => g.hostile)!;
      expect(foe.ref.id).toBe(monster.id);
      const [foeShape, friendShape] = v.shapes();
      expect(foeShape.commands.length).toBeGreaterThan(0);
      expect(friendShape.commands.length).toBeGreaterThan(0);
      expect(foeShape.color).toBeUndefined();
      expect(foeShape.strokeColor!.slice(0, 3)).not.toEqual(friendShape.strokeColor!.slice(0, 3));
      // Alone behind the canopy, a click on the ghost's chest picks the unit, not the tree in front.
      town.beasts = [];
      resident.position = at(-0.35, -0.35);
      v.draw();
      expect(friend.ref.kind).toBe('person');
      const chest = v.screen(resident.position, 12);
      expect(v.renderer.pick(chest)).toMatchObject({ kind: 'person', id: resident.id });
      // Low on the canopy, below the feet of the one behind it: the tree, so felling orders still work.
      const canopy = v.screen(fir.foot, 14);
      expect(v.renderer.pick(point(canopy.x - 7, canopy.y))).toMatchObject({
        kind: 'tree',
        id: fir.cell,
        instanceIndex: fir.index,
      });
      // A hostile ghost is picked as the monster, so a right click there attacks it.
      town.beasts = [monster];
      resident.position = at(2.5, -2.5);
      v.draw();
      // On its body, which for a beast on four legs is long and low.
      expect(v.renderer.pick(v.screen(monster.position, 7))).toMatchObject({ kind: 'monster', id: monster.id });
    } finally {
      town.beasts = [];
      v.dispose();
    }
  }, 120000);
  it('outlines a resident in the pose it is drawn in: a walk, a blow with the tool in hand, lying down', () => {
    const v = scene(town, fir.foot);
    try {
      // Walking behind the canopy: two steps of the walk differ in more than where the feet are.
      const start = at(-0.45, -0.25);
      resident.position = { ...start };
      resident.path = [at(-0.25, -0.45)];
      const steps: number[][] = [];
      for (const along of [0.03, 0.11]) {
        resident.position = { x: start.x + along, y: start.y - along };
        v.draw();
        expect(v.ghosts()).toHaveLength(1);
        steps.push(relative(v.shapes()[1].commands, resident.position));
      }
      expect(differs(steps[0], steps[1])).toBe(true);
      resident.path = [];
      resident.position = at(-0.35, -0.35);
      v.draw();
      // A blow: the same figure at two moments of a sword's swing, read from its posed parts.
      const figure = v.renderer.figures.get(resident.id)!,
        parts = figure.parts,
        swing = (phase: number) => {
          showEquipment(parts, 'sword');
          animateAction(parts, 'sword', phase, 1);
          seatHead(parts);
          return traced(figure);
        },
        windUp = swing(0.3),
        strike = swing(0.8);
      expect(differs(relative(windUp, resident.position), relative(strike, resident.position))).toBe(true);
      // Empty hands carry nothing; the sword adds its own outline.
      showEquipment(parts, null);
      const bare = traced(figure);
      showEquipment(parts, 'sword');
      expect(traced(figure).length).toBeGreaterThan(bare.length + 2);
      // Downed behind the canopy: the outline lies along the ground, wider than it is tall.
      resident.downedAt = town.clock();
      for (let i = 0; i < 4; ++i) v.draw();
      const lying = v.ghosts().find((g) => g.ref.id === resident.id);
      expect(lying?.lying).toBe(true);
      const box = lying!.areas.find((a) => a.box)!;
      expect(box.rx).toBeGreaterThan(box.ry * 1.5);
      resident.downedAt = -1;
    } finally {
      resident.downedAt = -1;
      resident.path = [];
      v.dispose();
    }
  }, 120000);
  it('outlines a monster on its own kind of skeleton, walking or striking', () => {
    const v = scene(town, fir.foot),
      map = town.map(),
      lair = (kind: DungeonKind) => map.dungeons().findIndex((d) => d.kind === kind),
      foeOutline = (m: Monster) => relative(v.shapes()[0].commands, m.position);
    try {
      resident.position = at(2.5, -2.5);
      const draugr = new Monster(9201, lair(DungeonKind.Crypt), at(-0.35, -0.35));
      draugr.rank = MonsterRank.Brute;
      draugr.health = 5;
      town.beasts = [draugr];
      v.draw();
      expect(v.ghosts().map((g) => g.ref)).toEqual([{ kind: 'monster', id: draugr.id }]);
      const standing = foeOutline(draugr);
      // A blow lands now: arm and weapon come round.
      draugr.swingAt = town.clock();
      v.draw();
      const striking = foeOutline(draugr);
      expect(differs(standing, striking)).toBe(true);
      // A warg stands on four legs: long and low where a draugr is tall.
      draugr.swingAt = -1;
      const warg = new Monster(9202, lair(DungeonKind.Cave), at(-0.35, -0.35));
      warg.health = 5;
      town.beasts = [warg];
      v.draw();
      const beast = v.ghosts()[0].areas.find((a) => a.box)!;
      town.beasts = [draugr];
      v.draw();
      const upright = v.ghosts()[0].areas.find((a) => a.box)!;
      expect(beast.rx / beast.ry).toBeGreaterThan(upright.rx / upright.ry * 1.5);
      // Its hit area covers the outline closely: the box and the head, not the empty air beside them.
      const g = v.ghosts()[0],
        foot = project(draugr.position.x, draugr.position.y);
      expect(ghostTouches(g, { x: foot.x, y: foot.y - 6, w: 0.1, h: 0.1 })).toBe(true);
      expect(ghostTouches(g, { x: foot.x + 12, y: foot.y - 6, w: 0.1, h: 0.1 })).toBe(false);
    } finally {
      town.beasts = [];
      v.dispose();
    }
  }, 120000);
  it('looks at a bounded number of trees per unit, even with a swarm in a dense forest', () => {
    const map = town.map();
    let best = { x: 0, y: 0, n: -1 };
    for (let y = 10; y < map.height() - 10; y += 2)
      for (let x = 10; x < map.width() - 10; x += 2) {
        let n = 0;
        for (let dy = -4; dy <= 4; ++dy) for (let dx = -4; dx <= 4; ++dx) n += map.at(x + dx, y + dy).trees;
        if (n > best.n) best = { x, y, n };
      }
    const centre = { x: best.x + 0.5, y: best.y + 0.5 };
    town.beasts = Array.from({ length: 120 }, (_, i) => {
      const m = new Monster(9100 + i, 0, {
        x: centre.x + ((i * 37) % 70) / 10 - 3.5,
        y: centre.y + ((i * 53) % 70) / 10 - 3.5,
      });
      m.health = 3;
      return m;
    });
    resident.position = { ...centre };
    town.scout(centre.x, centre.y, 12);
    const v = scene(town, centre);
    try {
      v.draw();
      const work = ghostWork(v.renderer);
      expect(work.units).toBeGreaterThan(100);
      // Some of the swarm is hidden among the trees, and each unit tested only a few silhouettes.
      expect(v.ghosts().length).toBeGreaterThan(5);
      expect(work.tested / work.units).toBeLessThan(12);
      // Each outline is a fixed handful of path commands, whatever the crowd.
      const commands = v.shapes().reduce((n, shape) => n + shape.commands.length, 0);
      expect(commands / v.ghosts().length).toBeLessThan(45);
    } finally {
      town.beasts = [];
      v.dispose();
    }
  }, 120000);
});
