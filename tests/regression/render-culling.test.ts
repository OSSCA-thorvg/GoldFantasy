import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ThorVG, { type ThorVGNamespace } from '@thorvg/webcanvas';
import { Person, Calling, Role, Race, Activity } from '../../packages/engine/src/person';
import { Camera, point, project } from '../../packages/engine/src/geometry';
import { Traffic } from '../../packages/engine/src/traffic';
import type { Town } from '../../packages/engine/src/town';
import { PictureNode, SceneNode, ShapeNode } from '../../packages/native-renderer/src/paint';
import { WorldRendererState } from '../../packages/native-renderer/src/world-renderer-state';
import { moveAgents } from '../../packages/native-renderer/src/world-people';
import { registerDepth, sortWorldObjects } from '../../packages/native-renderer/src/world-depth';
import { WebCanvasAdapter } from '../../packages/native-renderer/src/webcanvas-adapter';
import { Rect } from '../../packages/native-ui/src/types';

let tvg: ThorVGNamespace;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class {});
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
const actor = (at = point(6, 6)) =>
  new Person(0, 'Resident', Role.Resident, Calling.Warrior, Race.Human, 499096, at);
/** A renderer state with a camera on tile (6, 6) and a town holding the given people. */
function world(people: Person[], sight: (p: { x: number; y: number }) => number = () => 255) {
  const s = new WorldRendererState(tvg);
  s.rows = Array.from({ length: 64 }, () => new SceneNode());
  s.currentVisibility.sample = sight;
  const centre = project(6, 6);
  s.view = new Camera(centre.x, centre.y, 1);
  s.viewWidth = 800;
  s.viewHeight = 600;
  const town = {
    people: () => people,
    person: () => null,
    buildings: () => [],
    building: () => null,
    monsters: () => [],
    wildlife: () => [],
    hits: () => [],
    treeEvents: () => [],
    devotionEvents: () => [],
    creatureTarget: () => null,
    animalAsleep: () => false,
    clock: () => 0.2,
    map: () => ({ giant: () => null, volcano: () => null }),
  } as unknown as Town;
  return { s, town, draw: () => (moveAgents(s, town, new Traffic(5), 0.2, []), sortWorldObjects(s)) };
}

describe('the native tree holds only what shows', () => {
  it('leaves a fully transparent child out until it shows, then attaches it', () => {
    const adapter = new WebCanvasAdapter(tvg),
      root = new SceneNode(),
      shown = new ShapeNode().appendRect(0, 0, 4, 4).fill(1, 2, 3),
      tool = new SceneNode().add(new ShapeNode().appendRect(0, 0, 2, 2).fill(4, 5, 6));
    root.add(shown).add(tool);
    tool.opacity(0);
    try {
      adapter.sync(root);
      // The scene and its one visible shape: the hidden tool and its blade were never built.
      expect(adapter.retainedPaintCount).toBe(2);
      tool.opacity(255);
      adapter.sync(root);
      expect(adapter.retainedPaintCount).toBe(4);
      tool.opacity(0);
      adapter.sync(root);
      adapter.collect([root]);
      // Still part of the scene tree, so it is kept ready for the next time it shows.
      expect(adapter.retainedPaintCount).toBe(4);
    } finally {
      adapter.dispose();
    }
  });
  it('sends a shape its style once, not again each time it only moves or fades', () => {
    const adapter = new WebCanvasAdapter(tvg),
      shape = new ShapeNode().appendRect(0, 0, 4, 4).fill(1, 2, 3).strokeFill(9, 9, 9).strokeWidth(1),
      fill = vi.spyOn(tvg.Shape.prototype, 'fill'),
      stroke = vi.spyOn(tvg.Shape.prototype, 'stroke');
    try {
      adapter.sync(shape);
      const fills = fill.mock.calls.length,
        strokes = stroke.mock.calls.length;
      expect(fills).toBeGreaterThan(0);
      shape.translate(5, 5).opacity(120);
      adapter.sync(shape);
      expect(fill.mock.calls.length).toBe(fills);
      expect(stroke.mock.calls.length).toBe(strokes);
      shape.fill(7, 8, 9);
      adapter.sync(shape);
      expect(fill.mock.calls.length).toBe(fills + 1);
    } finally {
      fill.mockRestore();
      stroke.mockRestore();
      adapter.dispose();
    }
  });
});

describe('people outside the picture', () => {
  it('keeps the place of someone off screen without posing or attaching them', () => {
    const far = actor(point(90, 90)),
      { s, draw } = world([far]);
    far.activity = Activity.Fighting;
    far.ready = 1;
    draw();
    const figure = s.figures.get(far.id)!,
      at = project(far.position.x, far.position.y);
    expect(figure.paint.alpha).toBe(0);
    expect([figure.paint.matrix[2], figure.paint.matrix[5]]).toEqual([Math.fround(at.x), Math.fround(at.y)]);
    expect(s.objects.children).not.toContain(figure.paint);
    // No pose was computed: the body still rests where the sprite was built.
    expect(figure.parts.body!.matrix[4]).toBe(1);
    // They walk into view: drawn and posed again, at the new place.
    far.position = point(6, 6);
    draw();
    expect(figure.paint.alpha).toBe(255);
    expect(s.objects.children).toContain(figure.paint);
    expect(figure.parts.body!.matrix[4]).toBeLessThan(1);
  });
  it('treats someone hidden by fog the same way, and brings them back when seen', () => {
    let seen = false;
    const p = actor(),
      { s, draw } = world([p], () => (seen ? 255 : 0));
    draw();
    const figure = s.figures.get(p.id)!;
    expect(figure.paint.alpha).toBe(0);
    expect(s.objects.children).not.toContain(figure.paint);
    p.position = point(6.5, 6);
    draw();
    expect(figure.paint.matrix[2]).toBe(Math.fround(project(6.5, 6).x));
    seen = true;
    draw();
    expect(figure.paint.alpha).toBe(255);
    expect(s.objects.children).toContain(figure.paint);
  });
  it('culls nobody while no camera has been set', () => {
    const far = actor(point(90, 90)),
      { s, draw } = world([far]);
    s.viewWidth = s.viewHeight = 0;
    draw();
    expect(s.figures.get(far.id)!.paint.alpha).toBe(255);
    expect(s.objects.children).toContain(s.figures.get(far.id)!.paint);
  });
});

describe('land nobody has seen', () => {
  /** A tree-like object with its own bounds, standing on a tile. */
  function standing(s: WorldRendererState, x: number, y: number, key: string): SceneNode {
    const node = new SceneNode().add(new ShapeNode().appendRect(-6, -30, 12, 30).fill(20, 90, 40)),
      foot = project(x, y);
    registerDepth(node, point(x, y), key, new Rect(foot.x - 8, foot.y - 32, 16, 34));
    s.rowTrees[0].add(node);
    return node;
  }
  it('leaves out what the opaque veil covers whole, and adds it once the land is explored', () => {
    const { s } = world([]);
    s.rowTrees = [new SceneNode()];
    s.exploredVisibility.reset(32, 32);
    s.visibilityPicture = new PictureNode(new Uint8Array(4), 1, 1);
    s.exploredVisibility.stamp({ center: point(4, 6), radius: 2 });
    const known = standing(s, 4, 6, 'tree:known'),
      unknown = standing(s, 10, 6, 'tree:unknown');
    sortWorldObjects(s);
    expect(s.objects.children).toContain(known);
    expect(s.objects.children).not.toContain(unknown);
    // A scout reaches it: the same object appears without being rebuilt.
    s.exploredVisibility.stamp({ center: point(10, 6), radius: 2 });
    sortWorldObjects(s);
    expect(s.objects.children).toContain(unknown);
  });
  it('keeps everything in the editors, where there is no fog', () => {
    const { s } = world([]);
    s.rowTrees = [new SceneNode()];
    s.exploredVisibility.reset(32, 32);
    s.visibilityPicture = new PictureNode(new Uint8Array(4), 1, 1);
    s.editorView = true;
    const unknown = standing(s, 10, 6, 'tree:unknown');
    sortWorldObjects(s);
    expect(s.objects.children).toContain(unknown);
  });
});
