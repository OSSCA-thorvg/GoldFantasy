import type { ThorVGNamespace, Scene } from '@thorvg/webcanvas';
import { Camera, isoMatrix, point, type Point } from '../../engine/src/geometry';
import { Preview } from '../../engine/src/game-tools';
import { VisibilityMap } from '../../engine/src/visibility-map';
import { Weather } from '../../engine/src/climate';
import type { Strike } from '../../engine/src/thunderstorm';
import type { Hit } from '../../engine/src/person';
import { Rect } from '../../native-ui/src/types';
import {
  PaintNode,
  ShapeNode,
  SceneNode,
  TextNode,
  PictureNode,
  AnimationNode,
  identity,
  type Matrix,
  type Rgb,
} from './paint';
import { SUN_PASSES, blendLayer } from './vector-paint';
import { WebCanvasAdapter } from './webcanvas-adapter';
import { Flicker } from './light-flicker';
import type { RiseAnimation } from './building-animation';
import { PersonParts, type TextBounds } from './world-sprites';
import type { Tinted } from './terrain-painter';
import type { TileRegion } from './render-types';
import type { YmirLight } from './ymir-statue';
import type { VolcanoLight } from './volcano-painter';
import type { CloudMottle } from './cloud-mottle';
export const isoLayer = (): SceneNode => new SceneNode().transform(isoMatrix() as unknown as Matrix);
export interface Visual {
  picture: AnimationNode;
  layout: RiseAnimation;
  version: number;
  appearances: bigint[];
  center: Point;
  angle: number;
  start: number;
  frame: number;
}
export interface Sprite {
  paint: SceneNode;
  row: number;
  seen: boolean;
}
export interface Figure extends Sprite {
  lookKey: string;
  parts: PersonParts;
  last: Point;
  stride: number;
  facing: number;
  striding: boolean;
}
export interface Pool {
  center: Point;
  rx: number;
  ry: number;
  warmth: Rgb;
  flicker: Flicker;
  glow?: PaintNode;
  halo?: PaintNode;
  flame: Point;
  hole?: PaintNode;
  tint?: PaintNode;
  glowAt: Matrix;
}
export const pool = (
  center: Point,
  rx: number,
  ry: number,
  warmth: Rgb = [0, 0, 0],
  flicker = Flicker.Magic,
  glow?: PaintNode,
  halo?: PaintNode,
  flame = point(),
): Pool => ({ center, rx, ry, warmth, flicker, glow, halo, flame, glowAt: identity });
export interface Landmark {
  paint?: SceneNode;
  key: bigint;
}
export interface GroundChunk {
  area: TileRegion;
  bounds: Rect;
  scene: SceneNode;
  terrain: SceneNode;
  tints: Tinted[];
  dirty: boolean;
  edited: boolean;
}
export interface FallingTree {
  paint: SceneNode;
  body: SceneNode;
  dust: ShapeNode;
  pivot: Point;
  row: number;
  at: number;
  side: number;
}
export interface GrowingTree {
  paint: SceneNode;
  body: SceneNode;
  leaves: ShapeNode;
  foot: Point;
  row: number;
  cell: number;
  index: number;
  at: number;
}
/** Native retained state. Browser/module ownership stays with the application. */
export class WorldRendererState {
  readonly adapter: WebCanvasAdapter;
  editorView = false;
  sceneView = false;
  root = new SceneNode();
  world = new SceneNode();
  ground = isoLayer();
  farmland = isoLayer();
  fog = isoLayer();
  roads = isoLayer();
  lights = new SceneNode();
  roadLights = new SceneNode();
  objects = new SceneNode();
  effects = new SceneNode();
  overlay = new SceneNode();
  background = new ShapeNode();
  vignette = new SceneNode();
  darkness = new SceneNode();
  warmth = new SceneNode();
  memory = isoLayer();
  clouds = new SceneNode();
  sunlight = new SceneNode();
  ornaments = new SceneNode();
  combat = new SceneNode();
  prints = isoLayer();
  overcast = new ShapeNode();
  precipitation = new ShapeNode();
  mapName = new SceneNode();
  storm = new SceneNode();
  damageBack: ShapeNode | null = null;
  damageLeft: ShapeNode | null = null;
  strike: Strike | null = null;
  struck = point();
  nameDirty = true;
  lettering: { text: TextNode; shadow: TextNode; at: Point; box: TextBounds } | null = null;
  flame: ShapeNode | null = null;
  flameCore: ShapeNode | null = null;
  pulses: PaintNode[] = [];
  wispPaints: PaintNode[] = [];
  ymirGlints: (PaintNode | null)[] = [null, null];
  ymirRow = -1;
  fireRow = -1;
  ymirPaint: Landmark = { key: -1n };
  volcanoPaint: Landmark = { key: -1n };
  ymirLight: YmirLight | null = null;
  volcanoLight: VolcanoLight | null = null;
  rows: SceneNode[] = [];
  rowBuildings: SceneNode[] = [];
  rowLamps: SceneNode[] = [];
  rowTrees: SceneNode[] = [];
  rowCanopies: SceneNode[][] = [];
  swayAt = -1;
  swaying = false;
  treeKeys: bigint[] = [];
  wisps: { center: Point; color: Rgb; radius: number }[] = [];
  pools: Pool[] = [];
  buildingPools = 0;
  lamps: Point[] = [];
  vision: { center: Point; radius: number }[] = [];
  exploredVisibility = new VisibilityMap();
  currentVisibility = new VisibilityMap();
  visibilityPixels = new Uint32Array();
  visibilityPicture: PictureNode | null = null;
  fogBorder: ShapeNode | null = null;
  cloudShapes: SceneNode[] = [];
  mottle: CloudMottle | null = null;
  ornamentLook = -1n;
  sunPasses: ShapeNode[] = [];
  darkVeil: ShapeNode | null = null;
  fitted = [0, 0, 0, 0];
  shownGrey = 0;
  shownSun = 1;
  shownShade = 0;
  shownCloudy = 0;
  shownWet = 0;
  fallingIntensity = 0;
  falling = Weather.Rain;
  weatherAt = -1;
  sparks: { hit: Hit; shown: number; paint: SceneNode; number: PaintNode }[] = [];
  nextSpark = 0n;
  footprints: { at: Point; made: number }[] = [];
  lastStep = new Map<number, Point>();
  leftFoot = false;
  printsAt = -1;
  firePosition = point();
  visuals = new Map<number, Visual>();
  sprites = new Map<number, Sprite>();
  figures = new Map<number, Figure>();
  beasts = new Map<number, Sprite>();
  climateKey = -1;
  sightCount = 0;
  lastAnimate = -1;
  revision = 0n;
  roadRevision = -1n;
  appearanceGeneration = 0n;
  groundTints: Tinted[] = [];
  groundChunks: GroundChunk[] = [];
  overviewChunks: GroundChunk[] = [];
  detailedGround: SceneNode | null = null;
  overviewGround: SceneNode | null = null;
  groundWidth = 0;
  groundHeight = 0;
  shownPreview = new Preview();
  view = new Camera();
  viewWidth = 0;
  viewHeight = 0;
  lastFlicker = -1;
  treeBounds: Rect[] = [];
  fallingTrees: FallingTree[] = [];
  growingTrees: GrowingTree[] = [];
  treeCounts = new Uint8Array();
  renderedAt = 0;
  seenTreeEvent = 0n;
  constructor(readonly tvg: ThorVGNamespace) {
    this.adapter = new WebCanvasAdapter(tvg);
    this.root.add(this.background).add(this.world).add(this.overcast).add(this.vignette);
    for (const layer of [
      this.ground,
      this.farmland,
      this.ornaments,
      this.roads,
      this.prints,
      this.lights,
      this.objects,
      this.effects,
      this.sunlight,
      this.clouds,
      this.darkness,
      this.warmth,
      this.memory,
      this.fog,
      this.combat,
      this.mapName,
      this.storm,
    ])
      this.world.add(layer);
    this.world.add(this.precipitation).add(this.overlay);
    this.warmth.blend('screen');
    for (const spec of SUN_PASSES) {
      const pass = new ShapeNode()
        .appendRect(0, 0, 1, 1)
        .fill(spec.color[0], spec.color[1], spec.color[2], spec.color[3]);
      this.sunlight.add(blendLayer(pass, spec.method));
      this.sunPasses.push(pass);
    }
  }
  scene(): Scene {
    return this.adapter.sync(this.root) as Scene;
  }
  setEditorView(value: boolean): void {
    this.editorView = value;
  }
  setSceneView(value: boolean): void {
    this.sceneView = value;
    this.editorView = value;
  }
  measureText = (text: string, size: number, font: string): TextBounds | undefined => {
    let paint: InstanceType<ThorVGNamespace['Text']> | undefined;
    try {
      paint = new this.tvg.Text().font(font).fontSize(size).text(text);
      const b = paint.bounds();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch {
      return undefined;
    } finally {
      paint?.dispose();
    }
  };
  dispose(): void {
    this.adapter.dispose();
  }
}
