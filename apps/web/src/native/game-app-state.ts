import type { Paint, Scene } from '@thorvg/webcanvas';
import { Town } from '../../../../packages/engine/src/town';
import { Camera, point, type Outline, type Point } from '../../../../packages/engine/src/geometry';
import { Resources } from '../../../../packages/engine/src/building-catalog';
import { Activity, Calling } from '../../../../packages/engine/src/person';
import { Tool, Order, Preview } from '../../../../packages/engine/src/game-tools';
import { Context, Rect } from '../../../../packages/native-ui/src';
import { Sound } from '../../../../packages/native-audio/src/sound-types';
import type { Strike } from '../../../../packages/engine/src/thunderstorm';
import type { Building } from '../../../../packages/engine/src/town-models';
import { CampResourceHud } from './camp-resource-hud';
import { gameTheme } from './game-theme';
export { gameTheme } from './game-theme';

export interface WorldRenderer {
  scene(): Scene;
  // Traffic is supplied by the native application render loop.
  visible(at: Point): boolean;
  buildingDrawnAt(town: Town, projected: Point): number;
  buildingRoof(building: Building): Point | null | undefined;
  animating(): boolean;
  invalidateMap(): void;
  setSceneView(value: boolean): void;
  lightning(strike: Strike): void;
  dispose(): void;
}
export enum DockView {
  Handle,
  Build,
  Unit,
  Inspector,
  Resource,
  Placement,
  Roster,
}
export class Plan {
  preview = new Preview();
  problem = '';
  cost = new Resources();
}
export interface QueuedWork {
  activity: Activity;
  target: number;
  serial: bigint;
}
/** State shared by direct translations of the native GameApp translation units. */
export class GameAppState {
  static readonly maxSpeed = 5;
  static readonly maxZoom = 6;
  theme = gameTheme();
  camera = new Camera();
  tool = Tool.Select;
  mouse = point(-1, -1);
  cursor = point(-1, -1);
  pan = point();
  roadStroke: Point[] = [];
  roadStart = point();
  roadPress: Point | null = null;
  roadMoved = false;
  outline: Outline = [];
  freeAngle = 0;
  panFrom: Point | null = null;
  pressAt: Point | null = null;
  panMoved = false;
  boxFrom: Point | null = null;
  fieldFrom: Point | null = null;
  chosen: number[] = [];
  speed = 1;
  paused = false;
  card = -1;
  globalCard = -1;
  drawerOpen = false;
  drawerPinned = false;
  drawerSuppressed = false;
  dockView = DockView.Handle;
  dockKey = '';
  dockBounds = new Rect();
  dockFrom = new Rect();
  dockTarget = new Rect();
  dockGhostBounds = new Rect();
  drawerBridge = new Rect();
  dockStarted = -1;
  dockProgress = 1;
  dockDuration = Math.fround(0.24);
  dockContent: Paint | null = null;
  dockGhost: Paint | null = null;
  dockPortraits = new Map<number, { key: string; paint: Paint }>();
  residentPage = 0;
  inspectorPerson = -1;
  inspectorCalling = Calling.Warrior;
  rosterOpen = false;
  rosterTab: 'units' | 'guests' = 'units';
  rosterPage = 0;
  rosterSelected = '';
  campResources = new CampResourceHud();
  pending = Order.None;
  crew: number[] = [];
  cues: Sound[] = [];
  heardChosen: number[] = [];
  heardSelected = -1;
  heardStatus = '';
  wasDark = false;
  soundscaping = false;
  nextRaven = 30;
  nextAnimal = 4;
  nextPig = 6;
  heardAnimal = 0n;
  heardRaids = 0;
  heardBlow = 0n;
  heardTree = 0n;
  finished: number[] = [];
  heardFinished = false;
  hudPointer = false;
  selected = -1;
  selectedDungeon = -1;
  selectedTree = -1;
  selectedRock = -1;
  selectedAnimal = -1;
  workQueue: QueuedWork[] = [];
  stoppedWork = new Map<number, bigint>();
  workSerial = 0n;
  lastDispatch = -1;
  viewWidth = 1;
  viewHeight = 1;
  last = -1;
  current = new Plan();
  status = '';
  notice = '';
  noticeUntil = 0;
  objectivesCollapsed = false;
  questsInitialized = false;
  questsAnimating = false;
  questsSeen = 0;
  questPulseAt = -1;
  skyArtwork: Paint | null = null;
  skyBounds = new Rect();
  timeToggleBounds = new Rect();
  timePanelBounds = new Rect();
  skyHovered = false;
  timeExpanded = false;
  timeReveal = 0;
  timeUiAt = -1;
  scenePanAt: Point | null = null;
  sceneDragAt: Point | null = null;
  sceneDragOrigin: Point | null = null;
  nextSpeechAt = [0, 0];
  constructor(
    public town: Town,
    public renderer: WorldRenderer,
    public context: Context,
  ) {}
}
