// Native GameApp composition. Module methods follow the original translation-unit boundaries.
import { GameAppState } from './game-app-state';
import type { GameRuntime } from './game-runtime';
import type { RenderWorld } from './game-render';
import type { EditorServices } from './game-editors';
import { Town } from '../../../../packages/engine/src/town';
import { Traffic } from '../../../../packages/engine/src/traffic';
import { Camera, project, point } from '../../../../packages/engine/src/geometry';
import { copyNative } from '../../../../packages/engine/src/native-copy';
import { Order, PointerButton, toolStructure } from '../../../../packages/engine/src/game-tools';
import { Thunderstorm } from '../../../../packages/engine/src/thunderstorm';
import { MusicDirector, type MusicLibrary } from '../../../../packages/native-audio/src/music-director';
import { Context } from '../../../../packages/native-ui/src';
import {
  type CharacterEditor,
  type MapEditor,
  type BuildingEditor,
} from '../../../../packages/native-editors/src';
import * as input from './game-input';
import * as commands from './game-commands';
import * as ambience from './game-ambience';
import * as rendering from './game-render';
import * as editors from './game-editors';
import * as buildingEditors from './game-building-editor';
import * as hud from './game-hud';
import * as dock from './game-context-dock';
import * as units from './game-unit-panel';
import * as roster from './game-roster';
import * as worldSelection from './game-selection-panel';
import * as objectives from './game-objectives';
import * as skyHud from './game-sky-hud';
import * as speech from './game-speech';
import * as soundscape from './game-soundscape';
const {
  pointerDown: rawDown,
  pointerUp: rawUp,
  pointerMove: rawMove,
  wheel: rawWheel,
  cancel: rawCancel,
  ...inputMethods
} = input;
const { SpeakerState, speakerState: unusedSpeakerFactory, ...speechMethods } = speech;
const { buildGroups: unusedBuildGroups, ...hudMethods } = hud;
const methods = {
  ...inputMethods,
  ...commands,
  ...ambience,
  ...rendering,
  ...editors,
  ...buildingEditors,
  ...hudMethods,
  ...dock,
  ...units,
  ...roster,
  ...worldSelection,
  ...objectives,
  ...skyHud,
  ...speechMethods,
  ...soundscape,
};
type Bound<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R : never };
export interface GameApp extends Bound<typeof methods> {}
export interface GameAppServices extends EditorServices {
  createContext(): Context;
  createRenderer(): RenderWorld;
  sounds: MusicLibrary;
}
export class GameApp extends GameAppState implements GameRuntime {
  declare renderer: RenderWorld;
  traffic: Traffic;
  speakers = new Map<number, speech.SpeakerState>();
  director: MusicDirector;
  storm = new Thunderstorm();
  buildings: BuildingEditor | null = null;
  buildingClose = false;
  editor: CharacterEditor | null = null;
  atlas: MapEditor | null = null;
  editorDecision: boolean | null = null;
  mapDecision: boolean | null = null;
  readonly editorServices: EditorServices;
  constructor(
    seedOrSource: number | GameApp,
    private readonly services: GameAppServices,
  ) {
    const source = typeof seedOrSource === 'number' ? null : seedOrSource,
      town = source ? copyNative(source.town) : new Town(typeof seedOrSource === 'number' ? seedOrSource : 5);
    super(town, services.createRenderer(), services.createContext());
    this.editorServices = services;
    this.traffic = source ? copyNative(source.traffic) : new Traffic(town.map().seed());
    this.director = new MusicDirector(services.sounds);
    if (source) {
      this.theme = copyNative(source.theme);
      this.camera = copyNative(source.camera);
      this.chosen = [...source.chosen];
      this.speed = source.speed;
      this.paused = source.paused;
      this.workQueue = copyNative(source.workQueue);
      this.stoppedWork = new Map(source.stoppedWork);
      this.workSerial = source.workSerial;
      this.last = 0;
    } else {
      const focus = project(town.map().camp().x, town.map().camp().y);
      this.camera = town.map().giant()
        ? new Camera(focus.x, Math.fround(focus.y - 207), Math.fround(0.7))
        : new Camera(focus.x, focus.y, Math.fround(1.4));
      this.chosen = town.people().map((person) => person.id);
    }
  }
  state(): Town {
    return this.town;
  }
  view(): Camera {
    return this.camera;
  }
  setView(camera: { x: number; y: number; zoom: number }): void {
    this.camera = new Camera(Math.fround(camera.x), Math.fround(camera.y), Math.fround(camera.zoom));
  }
  selectedBuilding(): number {
    return this.selected;
  }
  selectedPeople(): readonly number[] {
    return this.chosen;
  }
  selectedTreeCell(): number {
    return this.selectedTree;
  }
  selectedRockCell(): number {
    return this.selectedRock;
  }
  pendingOrder(): Order {
    return this.pending;
  }
  selectedAnimalId(): number {
    return this.selectedAnimal;
  }
  toolStructure() {
    return toolStructure(this.tool);
  }
  contextPanelBounds() {
    return this.dockBounds;
  }
  setPan(dx: number, dy: number): void {
    this.pan = point(dx, dy);
  }
  rotate(radians: number): void {
    this.freeAngle = Math.fround(this.freeAngle + Math.fround(radians));
  }
  pointerDown(x: number, y: number, button: PointerButton): void {
    if (this.atlas) {
      this.atlas.pointerDown(this.context, point(x, y), button === PointerButton.Secondary);
      return;
    }
    if (this.editor || this.buildings) {
      if (button === PointerButton.Primary) this.context.pointerDown(x, y);
      return;
    }
    rawDown.call(this, x, y, button);
  }
  pointerMove(x: number, y: number): void {
    if (this.atlas) {
      this.atlas.pointerMove(this.context, point(x, y));
      return;
    }
    if (this.editor || this.buildings) {
      this.context.pointerMove(x, y);
      return;
    }
    rawMove.call(this, x, y);
  }
  pointerUp(x: number, y: number, button: PointerButton): void {
    if (this.atlas) {
      this.atlas.pointerUp(this.context, point(x, y), button === PointerButton.Secondary);
      return;
    }
    if (this.editor || this.buildings) {
      if (button === PointerButton.Primary) this.context.pointerUp(x, y);
      return;
    }
    rawUp.call(this, x, y, button);
  }
  wheel(x: number, y: number, amount: number): void {
    if (this.atlas) {
      this.atlas.wheel(this.context, point(x, y), amount);
      return;
    }
    if (this.editor || this.buildings) {
      this.context.pointerMove(x, y);
      this.context.wheel(amount);
      return;
    }
    rawWheel.call(this, x, y, amount);
  }
  cancel(): void {
    if (this.buildings) {
      this.buildings.command('close');
      return;
    }
    if (this.atlas) {
      this.closeMapEditor(false);
      return;
    }
    if (this.editor || this.buildings) {
      this.closeCharacterEditor(false);
      return;
    }
    rawCancel.call(this);
  }
  fork(): GameApp {
    return new GameApp(this, this.services);
  }
  dispose(): void {
    this.context.dispose();
    this.atlas?.dispose();
    this.buildings?.dispose();
    this.campResources.dispose();
    this.dockContent?.dispose();
    this.dockGhost?.dispose();
    for (const portrait of this.dockPortraits.values()) portrait.paint.dispose();
    this.dockPortraits.clear();
    this.skyArtwork?.dispose();
    this.renderer.dispose();
  }
}
Object.assign(GameApp.prototype, methods);
