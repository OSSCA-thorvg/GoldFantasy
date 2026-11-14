// The gates to the other worlds, drawn flat and lineless; each hints at the world behind it.
import { point, project, type Point } from '../../engine/src/geometry';
import { DungeonKind, World, type Dungeon } from '../../engine/src/world-types';
import { PaintNode, SceneNode, ShapeNode, type Rgb } from './paint';
import { glow, mix, opaque } from './vector-paint';
import { appendBlob, appendFacet, arch, blob, facet, stone, duskShade, type Local } from './flat-forms';
import { worldGlimpse } from './realm-palette';
import { Rect } from '../../native-ui/src/types';
const f = Math.fround;
const stoneLit: Rgb = [81, 76, 75],
  stoneShade: Rgb = [40, 40, 60],
  mouth: Rgb = [8, 8, 28],
  turfLit: Rgb = [44, 66, 40],
  turfShade: Rgb = [16, 34, 40],
  woodLit: Rgb = [101, 69, 40],
  woodShade: Rgb = [48, 32, 40],
  slabLit: Rgb = [92, 86, 82],
  slabShade: Rgb = [52, 50, 70],
  carved: Rgb = [24, 22, 50],
  rime: Rgb = [134, 143, 158];
export interface GateLook {
  site: Dungeon;
  world: World;
  sealed: boolean;
}
const gateBodies = new WeakMap<SceneNode, readonly PaintNode[]>(),
  gateBoxes = new WeakMap<SceneNode, Rect>();
export const gateBody = (paint: SceneNode): readonly PaintNode[] => gateBodies.get(paint) ?? [];
/** Everything a gate draws, for culling. */
export const gateBounds = (paint: SceneNode): Rect | undefined => gateBoxes.get(paint);
export const gateCenter = (site: Dungeon): Point => project(f(site.origin.x + 1), f(site.origin.y + 1));
/** A two-tone pair of shapes: everything appended to `shade` reads as the unlit side. */
function pair(lit: Rgb, shade: Rgb = mix(lit, duskShade, f(0.5))): [ShapeNode, ShapeNode] {
  return [new ShapeNode().fill(...opaque(lit)), new ShapeNode().fill(...opaque(shade))];
}
/** The slab and rune that close a sealed gate for good. */
function seal(objects: SceneNode, c: Point, shape: readonly Local[], rune: Point): void {
  const [lit, shade] = pair(slabLit, slabShade),
    x = f(rune.x - c.x),
    y = f(rune.y - c.y),
    carving = new ShapeNode();
  appendFacet(lit, c, shape);
  // The right half of the slab, folded onto the rune's axis, is its unlit face.
  appendFacet(shade, c, shape.map(([px, py]): Local => [Math.max(px, f(x + 3)), py]));
  objects.add(lit).add(shade);
  // Tiwaz over a crossbar: a binding rune cut into the slab.
  appendFacet(carving, c, [[f(x - 0.9), f(y + 7)], [f(x + 0.9), f(y + 7)], [f(x + 0.9), f(y - 7)], [f(x - 0.9), f(y - 7)]]);
  appendFacet(carving, c, [[x, f(y - 9)], [f(x + 6), f(y - 3)], [f(x + 5), f(y - 2)], [x, f(y - 6.5)], [f(x - 5), f(y - 2)], [f(x - 6), f(y - 3)]]);
  appendFacet(carving, c, [[f(x - 5), f(y + 2)], [f(x + 5), f(y + 2)], [f(x + 5), f(y + 3.6)], [f(x - 5), f(y + 3.6)]]);
  objects.add(carving.fill(...opaque(carved)));
}
/** Small props at the foot of a gate that tell which world lies behind it. */
function hint(objects: SceneNode, c: Point, world: World, sealed: boolean): void {
  const spots: Local[] = [
      [-46, 14],
      [40, 16],
      [52, 6],
      [-56, 4],
    ],
    glimpse = worldGlimpse(world),
    [lit, shade] = pair(glimpse, mix(glimpse, duskShade, f(0.55)));
  for (const [i, [x, y]] of spots.entries()) {
    const k = f(1 - f(i * f(0.12)));
    switch (world) {
      case World.Jotunheim:
      case World.Niflheim:
        appendFacet(lit, c, [[f(x - 4 * k), y], [f(x - 1), f(y - 15 * k)], [x, y]]);
        appendFacet(shade, c, [[x, y], [f(x - 1), f(y - 15 * k)], [f(x + 4 * k), y]]);
        break;
      case World.Svartalfheim:
        appendFacet(lit, c, [[f(x - 4 * k), y], [f(x - 3 * k), f(y - 9 * k)], [f(x + 1), f(y - 14 * k)], [x, y]]);
        appendFacet(shade, c, [[x, y], [f(x + 1), f(y - 14 * k)], [f(x + 4 * k), f(y - 7 * k)], [f(x + 4 * k), y]]);
        break;
      case World.Muspelheim:
        if (sealed) break;
        appendFacet(lit, c, [[f(x - 2), f(y - 4)], [f(x + 1), f(y - 12 * k)], [f(x + 2), f(y - 3)]]);
        appendFacet(shade, c, [[f(x + 3), f(y - 2)], [f(x + 6), f(y - 7 * k)], [f(x + 5), f(y - 1)]]);
        break;
      case World.Helheim:
        appendBlob(lit, c, [[f(x - 6), f(y - 1)], [f(x + 5), f(y - 3)], [f(x + 6), f(y - 1.5)], [f(x - 5), f(y + 0.5)]]);
        appendBlob(shade, c, [[f(x - 4), f(y + 1)], [f(x + 3), f(y + 3)], [f(x + 2), f(y + 4)], [f(x - 4), f(y + 2.5)]]);
        break;
      case World.Asgard:
        appendFacet(lit, c, [[f(x - 3), y], [f(x - 3), f(y - 9 * k)], [x, f(y - 11 * k)], [x, y]]);
        appendFacet(shade, c, [[x, y], [x, f(y - 11 * k)], [f(x + 3), f(y - 9 * k)], [f(x + 3), y]]);
        break;
      default:
        // Vanaheim and Alfheim: leafy tufts.
        appendBlob(lit, c, [[f(x - 6 * k), y], [f(x - 4 * k), f(y - 7 * k)], [x, f(y - 9 * k)], [f(x + 1), y]]);
        appendBlob(shade, c, [[f(x + 1), y], [f(x + 2), f(y - 8 * k)], [f(x + 6 * k), f(y - 5 * k)], [f(x + 6 * k), y]]);
    }
  }
  objects.add(lit).add(shade);
}
function rubble(objects: SceneNode, c: Point, at: readonly [number, number, number][]): void {
  const [lit, shade] = pair(stoneLit, stoneShade);
  for (const [x, y, s] of at) stone(lit, shade, c, x, y, s);
  objects.add(lit).add(shade);
}
function cave(objects: SceneNode, c: Point, look: GateLook): PaintNode | null {
  const [rockLit, rockShade] = pair(stoneLit, stoneShade);
  appendBlob(rockShade, c, [[-58, 12], [-52, -16], [-34, -38], [-6, -50], [22, -44], [46, -24], [58, 8], [30, 22], [-30, 22]]);
  appendBlob(rockLit, c, [[-58, 12], [-52, -16], [-34, -38], [-8, -50], [4, -32], [-2, 0], [-12, 22], [-30, 22]]);
  objects.add(rockShade).add(rockLit);
  const [moss, mossShade] = pair(turfLit, turfShade);
  appendBlob(mossShade, c, [[-34, -36], [-8, -50], [22, -45], [38, -33], [14, -37], [-12, -41]]);
  appendBlob(moss, c, [[-36, -35], [-10, -50], [6, -48], [-4, -42], [-20, -36]]);
  objects.add(mossShade).add(moss);
  const door = arch(-6, 18, 17, 34);
  objects.add(facet(c, door, mouth));
  if (look.world === World.Jotunheim) {
    const ice = new ShapeNode();
    for (let k = 0; k < 3; ++k) {
      const x = f(-14 + k * 8);
      appendFacet(ice, c, [[f(x - 2), f(-18 - (k % 2) * 1.5)], [f(x + 2), f(-18 - (k % 2) * 1.5)], [x, f(-11 - (k % 2) * 3)]]);
    }
    objects.add(ice.fill(...opaque(rime)));
  }
  rubble(objects, c, [[30, 20, 6], [40, 14, 4], [-44, 18, 5]]);
  hint(objects, c, look.world, look.sealed);
  if (look.sealed) {
    seal(objects, c, arch(-6, 18, 18, 35), point(f(c.x - 6), f(c.y)));
    return null;
  }
  const pulse = facet(c, arch(-6, 18, 11, 24), worldGlimpse(look.world));
  objects.add(pulse);
  return pulse;
}
function crypt(objects: SceneNode, c: Point, look: GateLook): PaintNode | null {
  const [turf, turfDark] = pair(turfLit, turfShade);
  appendBlob(turfDark, c, [[-60, 16], [-44, -14], [-8, -30], [30, -26], [56, -4], [60, 16], [0, 30]]);
  appendBlob(turf, c, [[-60, 16], [-44, -14], [-10, -30], [8, -29], [-6, -8], [-14, 28], [-40, 24]]);
  objects.add(turfDark).add(turf);
  const [lit, shade] = pair(stoneLit, stoneShade);
  appendFacet(lit, c, [[-24, 22], [-24, -16], [-15, -18], [-15, 22]]);
  appendFacet(shade, c, [[15, 22], [15, -18], [24, -16], [24, 22]]);
  appendFacet(lit, c, [[-30, -16], [-4, -24], [30, -18], [30, -12], [-30, -10]]);
  appendFacet(shade, c, [[-30, -10], [30, -12], [30, -9], [-30, -6]]);
  objects.add(lit).add(shade);
  objects.add(facet(c, [[-15, 22], [-15, -9], [15, -9], [15, 22]], mouth));
  rubble(objects, c, [[-46, 12, 4], [44, 10, 5]]);
  const [tall, tallShade] = pair(stoneLit, stoneShade);
  for (const [x, h] of [
    [-52, 26],
    [52, 34],
  ] as const) {
    appendBlob(tall, c, [[f(x - 5), 8], [f(x - 5), f(8 - h)], [f(x - 1), f(4 - h)], [x, 9]]);
    appendBlob(tallShade, c, [[x, 9], [f(x - 1), f(4 - h)], [f(x + 4), f(6 - h)], [f(x + 5), 7]]);
  }
  objects.add(tall).add(tallShade);
  hint(objects, c, look.world, look.sealed);
  if (look.sealed) {
    seal(objects, c, [[-16, 22], [-16, -10], [16, -10], [16, 22]], point(c.x, f(c.y + 6)));
    return null;
  }
  const pulse = facet(c, [[-10, 22], [-10, -3], [10, -3], [10, 22]], worldGlimpse(look.world));
  objects.add(pulse);
  return pulse;
}
function portal(objects: SceneNode, c: Point, look: GateLook, home: boolean): PaintNode | null {
  const [ringLit, ringShade] = pair(stoneLit, stoneShade);
  for (let i = 0; i < 6; ++i) {
    const a = f(f(i * f(1.047)) + f(0.3)),
      x = f(f(Math.cos(a)) * 46),
      y = f(f(Math.sin(a)) * 23),
      h = f(12 + (i % 3) * 3);
    appendBlob(ringLit, c, [[f(x - 4), y], [f(x - 3.5), f(y - h)], [f(x - 0.5), f(y - h - 2)], [x, f(y + 1)]]);
    appendBlob(ringShade, c, [[x, f(y + 1)], [f(x - 0.5), f(y - h - 2)], [f(x + 3), f(y - h)], [f(x + 4), y]]);
  }
  objects.add(ringLit).add(ringShade);
  const [lit, shade] = pair(home ? [96, 90, 84] : stoneLit, stoneShade);
  appendFacet(lit, c, [[-22, 6], [-22, -40], [-13, -42], [-13, 6]]);
  appendFacet(shade, c, [[13, 6], [13, -42], [22, -40], [22, 6]]);
  appendBlob(lit, c, [[-27, -40], [-24, -49], [0, -52], [10, -50], [8, -43], [-26, -38]]);
  appendBlob(shade, c, [[8, -43], [10, -50], [24, -49], [27, -40], [10, -40]]);
  objects.add(lit).add(shade);
  objects.add(blob(c, [[-13, 4], [-13, -26], [0, -38], [13, -26], [13, 4]], mouth));
  if (home) {
    // The way home: a hearth-lit doorway with a turf lintel, the warm colour of Midgard.
    objects.add(blob(c, [[-26, -45], [0, -55], [26, -45], [8, -47]], turfLit));
  } else hint(objects, c, look.world, look.sealed);
  if (look.sealed) {
    seal(objects, c, [[-14, 5], [-14, -26], [-6, -36], [6, -36], [14, -26], [14, 5]], point(c.x, f(c.y - 14)));
    return null;
  }
  const glimpse: Rgb = home ? [150, 108, 54] : worldGlimpse(look.world),
    swirl = new SceneNode()
      .add(blob(point(), [[-9, 0], [-8, -14], [0, -22], [8, -14], [9, 0], [0, 4]], glimpse))
      .add(blob(point(), [[-4, -2], [-3, -12], [2, -16], [4, -8], [2, 0]], mix(glimpse, [255, 240, 210], f(0.35))));
  swirl.translate(c.x, f(c.y - 4));
  objects.add(swirl);
  return swirl;
}
function ruin(objects: SceneNode, c: Point, look: GateLook): PaintNode | null {
  const b = project(f(look.site.origin.x + 1), f(look.site.origin.y + f(1.2))),
    at = point(f(b.x - c.x), f(b.y - c.y)),
    [lit, shade] = pair(stoneLit, stoneShade),
    x = at.x,
    y = at.y;
  appendFacet(lit, c, [[f(x - 22), f(y - 4)], [f(x - 22), f(y - 56)], [f(x - 14), f(y - 50)], [f(x - 8), f(y - 60)], [x, f(y - 52)], [x, f(y + 6)], [f(x - 12), f(y + 4)]]);
  appendFacet(shade, c, [[x, f(y + 6)], [x, f(y - 52)], [f(x + 7), f(y - 44)], [f(x + 14), f(y - 36)], [f(x + 22), f(y - 38)], [f(x + 22), f(y - 4)], [f(x + 12), f(y + 4)]]);
  objects.add(lit).add(shade);
  // A band of courses lit by the world behind the door.
  const glimpse = worldGlimpse(look.world);
  objects.add(facet(c, [[f(x - 22), f(y - 30)], [f(x + 22), f(y - 30)], [f(x + 22), f(y - 27)], [f(x - 22), f(y - 27)]], mix(glimpse, duskShade, f(0.35))));
  const door = arch(f(x - 10), f(y + 4), 7, 20);
  objects.add(facet(c, door, mouth));
  rubble(objects, c, [[f(x + 26), f(y + 10), 5], [f(x + 34), f(y + 4), 4], [f(x - 30), f(y + 8), 5], [f(x + 18), f(y + 16), 3]]);
  hint(objects, c, look.world, look.sealed);
  if (look.sealed) {
    seal(objects, c, arch(f(x - 10), f(y + 4), 8, 21), point(f(c.x + x - 10), f(c.y + y - 4)));
    return null;
  }
  const pulse = facet(c, arch(f(x - 10), f(y + 4), 4.5, 15), glimpse);
  objects.add(pulse);
  return pulse;
}
function giantHall(objects: SceneNode, c: Point): PaintNode | null {
  const [lit, shade] = pair(stoneLit, stoneShade);
  appendFacet(lit, c, [[-50, 12], [-50, -20], [-10, -30], [-10, 16]]);
  appendFacet(shade, c, [[-10, 16], [-10, -30], [50, -18], [50, 12], [20, 18]]);
  objects.add(lit).add(shade);
  const [roof, roofShade] = pair(turfLit, turfShade);
  appendBlob(roof, c, [[-56, -18], [-40, -36], [-14, -46], [-6, -38], [-14, -26]]);
  appendBlob(roofShade, c, [[-14, -26], [-6, -38], [-14, -46], [20, -42], [54, -24], [52, -14], [10, -22]]);
  objects.add(roofShade).add(roof);
  objects.add(facet(c, [[-18, 14], [-18, -12], [-10, -20], [10, -20], [16, -12], [16, 16]], mouth));
  objects.add(facet(c, [[-22, -16], [-10, -24], [12, -24], [22, -16], [20, -13], [-20, -13]], mix(stoneLit, [255, 246, 226], f(0.15))));
  const frost = new ShapeNode();
  for (const x of [-40, -24, 26, 42]) appendFacet(frost, c, [[f(x - 3), -4], [f(x + 3), -6], [x, 4]]);
  objects.add(frost.fill(...opaque(rime)));
  rubble(objects, c, [[-46, 18, 6], [44, 18, 7]]);
  return null;
}
/** Draws a gate into `objects`; returns the paint whose opacity the renderer pulses, if any. */
export function gateSprite(objects: SceneNode, lights: SceneNode, look: GateLook): PaintNode | null {
  const c = gateCenter(look.site),
    shadow = blob(c, [[-58, 10], [0, -14], [58, 10], [0, 30]], duskShade, 70);
  objects.add(shadow);
  let pulse: PaintNode | null;
  switch (look.site.kind) {
    case DungeonKind.Cave:
      pulse = cave(objects, c, look);
      break;
    case DungeonKind.Crypt:
      pulse = crypt(objects, c, look);
      break;
    case DungeonKind.Ruin:
      pulse = ruin(objects, c, look);
      break;
    case DungeonKind.GiantHall:
      pulse = giantHall(objects, c);
      break;
    default:
      pulse = portal(objects, c, look, look.site.kind === DungeonKind.Return);
  }
  if (pulse) lights.add(glow(point(c.x, f(c.y - 8)), 64, 32, look.site.kind === DungeonKind.Return ? [240, 170, 90] : worldGlimpse(look.world), 60));
  gateBodies.set(
    objects,
    objects.children.filter((paint) => paint !== pulse && paint !== shadow),
  );
  // No name is drawn here: hovering or selecting a gate shows it, like any other target.
  gateBoxes.set(objects, new Rect(f(c.x - 72), f(c.y - 90), 144, 132));
  return pulse;
}
