// Native application.cpp window/session/input boundary, independent of DOM layout.
import type { Scene, ThorVGNamespace } from '@thorvg/webcanvas';
import type { Application, AppEvent, LaunchOptions, NativeSound, Property } from './application-contracts';
import type { GameRuntime } from './game-runtime';
import { Tool, Order, PointerButton } from '../../../../packages/engine/src/game-tools';
import { Town } from '../../../../packages/engine/src/town';
import { Camera, project, point } from '../../../../packages/engine/src/geometry';
import { Weather } from '../../../../packages/engine/src/climate';
import { encodeTown, decodeTown } from '../../../../packages/engine/src/save-game';
import { decodeCharacter } from '../../../../packages/engine/src/character-preset';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { clamp, f32 as f } from '../../../../packages/engine/src/numeric';
import { applyBuildingAsset } from '../../../../packages/native-renderer/src/building-assets';
import { Context, Key, Rect, Theme } from '../../../../packages/native-ui/src';
import { Script } from '../../../../packages/native-ui/src/script';
export interface ApplicationFiles {
  readSync(path: string, maxBytes?: number): string;
  stage(path: string, text: string): void;
}
export interface GameApplicationServices {
  tvg: ThorVGNamespace;
  files: ApplicationFiles;
  loadBuildingAssets(directory: string): void;
  createGame(seed: number): GameRuntime;
  createContext(): Context;
  createSound(): NativeSound;
  designedWorldSeed: number;
  randomDevice(): number;
  frameTime(): number;
  buildDemo(game: GameRuntime, days: number): void;
}
export enum Playback {
  Stopped,
  Playing,
  Paused,
}
export interface SceneObject {
  id: string;
  name: string;
  type: string;
}
export function worldSeed(
  options: LaunchOptions,
  services: Pick<GameApplicationServices, 'designedWorldSeed' | 'randomDevice'>,
): number {
  return options.world === 'Designed'
    ? services.designedWorldSeed
    : (options.seed ?? services.randomDevice());
}
function objectId(object: string, prefix: string): number | undefined {
  if (!object.startsWith(prefix)) return;
  const suffix = object.slice(prefix.length);
  if (!/^-?\d+$/.test(suffix)) return;
  const value = Number(suffix);
  return value >= 0 && value <= 2147483647 ? value : undefined;
}
const shortcuts = new Map<string, Tool>([
  ['q', Tool.Select],
  ['1', Tool.Road],
  ['2', Tool.Field],
  ['p', Tool.Pave],
  ['c', Tool.Camp],
  ['3', Tool.Tent],
  ['4', Tool.Farm],
  ['5', Tool.Lumberyard],
  ['6', Tool.Quarry],
  ['w', Tool.Well],
  ['j', Tool.Storehouse],
  ['7', Tool.Market],
  ['8', Tool.Tavern],
  ['9', Tool.Inn],
  ['0', Tool.Guild],
  ['h', Tool.Shrine],
  ['k', Tool.MageTower],
  ['v', Tool.Portal],
  ['g', Tool.Chapel],
  ['b', Tool.Weaponsmith],
  ['n', Tool.Armorer],
  ['o', Tool.Apothecary],
  ['x', Tool.Demolish],
]);
const property = (
  id: string,
  label: string,
  value: number,
  minimum: number,
  maximum: number,
  step: number,
  readOnly = false,
): Property => ({ id, label, value, minimum, maximum, step, readOnly });
export class GameApplication implements Application {
  private readonly root: Scene;
  private game: GameRuntime;
  private authoredGame: GameRuntime | null = null;
  private retiredGames: GameRuntime[] = [];
  private readonly sound: NativeSound;
  private readonly script = new Script();
  private runtimeScript: Script | null = null;
  private readonly scriptContext: Context;
  private readonly scriptTheme = Theme.dark();
  private scriptPointer = false;
  private keys = new Set<string>();
  private lastTime = -1;
  private pendingReset = false;
  private resumeFrame = false;
  private presentationFrozen = false;
  private playback = Playback.Playing;
  private editorAttached = false;
  private dirty = true;
  private remount = false;
  private singleStep = false;
  private lastWidth = 0;
  private lastHeight = 0;
  private inspected = 'world';
  private authoredSelection = 'world';
  presented(pixelRatio: number): void {
    if (this.game.worldPresented(pixelRatio)) this.dirty = true;
  }
  invalidatePresentation(): void {
    this.game.invalidatePresentation();
  }
  constructor(
    private readonly options: LaunchOptions,
    private readonly services: GameApplicationServices,
  ) {
    services.loadBuildingAssets(options.buildingAssets);
    this.root = new services.tvg.Scene();
    this.scriptContext = services.createContext();
    this.sound = services.createSound();
    this.game = services.createGame(worldSeed(options, services));
    try {
      this.configure();
      this.mount();
      if (options.uiScript) {
        let source: string;
        try {
          source = services.files.readSync(options.uiScript);
        } catch {
          throw new Error('Cannot load UI script: ' + this.script.error());
        }
        if (!this.script.load(source, options.uiScript))
          throw new Error('Cannot load UI script: ' + this.script.error());
        this.script.onCommand = (name) => {
          this.command(name);
        };
      }
    } catch (error) {
      this.root.remove();
      this.script.dispose();
      this.scriptContext.destroy();
      this.game.dispose();
      this.sound.dispose();
      this.root.dispose();
      throw error;
    }
  }
  title(): string {
    return 'Midgard';
  }
  scene(): Scene {
    return this.root;
  }
  private authoringTool(): boolean {
    return !!this.game.atlas || !!this.game.editor || !!this.game.buildings;
  }
  private mount(): void {
    this.root.add(this.game.worldScene());
    this.root.add(this.game.hudScene());
    this.root.add(this.scriptContext.scene());
  }
  private configure(): void {
    const error = { value: '' };
    if (this.options.mapFile && !this.game.loadMapFile(this.options.mapFile, error))
      throw new Error(error.value);
    if (this.options.demo) this.services.buildDemo(this.game, this.options.days);
    if (this.options.raid) this.game.state().summonRaid();
    if (this.options.weather) {
      const kind =
        this.options.weather === 'snow'
          ? Weather.Snow
          : this.options.weather === 'storm'
            ? Weather.Storm
            : this.options.weather === 'clear'
              ? Weather.Clear
              : Weather.Rain;
      this.game
        .state()
        .weather()
        .force(kind, kind === Weather.Clear ? 0 : 1);
    }
    if (this.options.mapEditor) this.game.openMapEditor();
    if (
      (this.options.buildingStudio || this.options.buildingFile) &&
      !this.game.openBuildingEditor(this.options.buildingFile)
    )
      throw new Error('Cannot open building asset: ' + this.options.buildingFile);
    if (this.options.studio || this.options.characterFile) {
      this.game.openCharacterEditor();
      if (this.options.characterFile) {
        const preset = decodeCharacter(this.services.files.readSync(this.options.characterFile));
        this.game.editor!.setPreset(preset);
        this.game.editor!.setPresetPath(this.options.characterFile);
      }
    }
    this.dirty = true;
    this.keys.clear();
    this.lastTime = -1;
  }
  private reset(): void {
    this.root.remove();
    this.game.dispose();
    this.game = this.services.createGame(worldSeed(this.options, this.services));
    this.configure();
    this.mount();
  }
  render(width: number, height: number, seconds: number): void {
    if (this.remount) {
      this.root.remove();
      this.mount();
      for (const game of this.retiredGames) game.dispose();
      this.retiredGames = [];
      this.remount = false;
    }
    if (this.pendingReset) {
      const authored = this.properties();
      this.reset();
      for (const item of authored) this.property(item.id, item.value);
      this.pendingReset = false;
    }
    const authoring = this.authoringTool();
    if (this.editorAttached && this.playback === Playback.Stopped && !authoring) {
      if (this.dirty || width !== this.lastWidth || height !== this.lastHeight) {
        this.game.renderScene(width, height);
        this.scriptContext.begin(this.scriptTheme, new Rect(0, 0, width, height), 0);
        this.scriptContext.end();
      }
      this.dirty = false;
      this.lastWidth = width;
      this.lastHeight = height;
      this.lastTime = 0;
      return;
    }
    const dt = this.lastTime < 0 ? 0 : Math.max(0, seconds - this.lastTime);
    let simulate =
      !this.editorAttached || (dt > 0 && (this.playback === Playback.Playing || this.singleStep));
    if (this.resumeFrame) {
      simulate = false;
      this.resumeFrame = false;
    }
    if (this.presentationFrozen) simulate = false;
    this.singleStep = false;
    if (
      this.editorAttached &&
      this.playback === Playback.Paused &&
      !simulate &&
      !this.dirty &&
      !this.game.animatingUi() &&
      width === this.lastWidth &&
      height === this.lastHeight
    ) {
      this.lastTime = seconds;
      return;
    }
    if (
      this.editorAttached &&
      !authoring &&
      dt === 0 &&
      !this.dirty &&
      !this.game.animatingUi() &&
      width === this.lastWidth &&
      height === this.lastHeight
    )
      return;
    if (authoring && this.editorAttached) this.game.render(width, height, this.services.frameTime(), false);
    else
      this.game.render(
        width,
        height,
        seconds,
        simulate,
        this.editorAttached ? 2 : 0.25,
        this.services.frameTime(),
      );
    this.sound.setAmbience(this.game.ambience());
    for (const cue of this.game.takeCues()) this.sound.play(cue);
    const activeScript = this.runtimeScript ?? this.script;
    const showScript =
      activeScript.ready() &&
      (!this.editorAttached || this.playback !== Playback.Stopped) &&
      !this.game.buildings;
    if (showScript) {
      if (simulate && (!this.editorAttached || dt > 0)) activeScript.update(dt);
      this.scriptContext.begin(this.scriptTheme, new Rect(0, 0, width, height), seconds);
      if (this.editorAttached && !simulate) {
        const preview = activeScript.fork();
        try {
          preview?.render(this.scriptContext, new Rect(0, 0, width, height));
        } finally {
          preview?.dispose();
        }
      } else activeScript.render(this.scriptContext, new Rect(0, 0, width, height));
      this.scriptContext.end();
    } else if (this.script.ready()) {
      this.scriptContext.begin(this.scriptTheme, new Rect(0, 0, width, height), seconds);
      this.scriptContext.end();
    }
    this.lastTime = seconds;
    this.dirty = authoring;
    this.lastWidth = width;
    this.lastHeight = height;
  }
  event(e: AppEvent): void {
    if (this.editorAttached && this.playback !== Playback.Playing && !this.authoringTool()) {
      const openTool = e.type === 'KeyDown' && ['f2', 'f3', 'f4'].includes(e.text);
      if (!openTool) {
        if (this.playback === Playback.Stopped) {
          this.dirty = this.game.sceneEvent(e) || this.dirty;
          if (e.type === 'PointerDown' && e.button === 1)
            this.inspected =
              this.game.selectedBuilding() >= 0
                ? 'building:' + this.game.selectedBuilding()
                : this.game.selectedPeople().length === 1
                  ? 'unit:' + this.game.selectedPeople()[0]
                  : 'world';
        }
        return;
      }
    }
    this.dirty = true;
    const button = e.button === 1 ? PointerButton.Primary : PointerButton.Secondary;
    if (e.type === 'PointerCancel') {
      this.scriptContext.cancelPointer();
      this.scriptPointer = false;
      this.game.cancelPointer();
      return;
    }
    if (e.type === 'KeyDown' && e.text === 'f4' && !this.authoringTool()) {
      this.command('edit.building');
      return;
    }
    if (
      e.type === 'KeyDown' &&
      !e.control &&
      !e.meta &&
      !e.alt &&
      !this.scriptContext.textFocused() &&
      !this.game.buildings &&
      !this.game.atlas &&
      !this.game.editor &&
      this.game.selectedPeople().length &&
      (e.text.toLowerCase() === 'a' || e.text.toLowerCase() === 'm')
    ) {
      this.game.prepare(e.text.toLowerCase() === 'a' ? Order.Attack : Order.Move);
      return;
    }
    if (this.script.ready() && !this.game.buildings) {
      if (e.type === 'PointerMove') {
        this.scriptContext.pointerMove(e.x, e.y);
        if (this.scriptPointer) return;
      }
      if (e.type === 'KeyDown' && (e.key === Key.Tab || this.scriptContext.focused())) {
        this.scriptContext.key(e.key, e.shift);
        return;
      }
      if (e.type === 'Text' && this.scriptContext.focused()) {
        this.scriptContext.textInput(e.text);
        return;
      }
      if (e.type === 'PointerDown' && e.button === 1) {
        this.scriptPointer = this.scriptContext.controlAt(e.x, e.y);
        this.scriptContext.pointerDown(e.x, e.y);
        if (this.scriptPointer) return;
      }
      if (e.type === 'PointerUp' && e.button === 1) {
        this.scriptContext.pointerUp(e.x, e.y);
        if (this.scriptPointer) {
          this.scriptPointer = false;
          return;
        }
      }
    }
    if (e.type === 'PointerDown') this.game.pointerDown(e.x, e.y, button);
    else if (e.type === 'PointerUp') this.game.pointerUp(e.x, e.y, button);
    else if (e.type === 'PointerMove') this.game.pointerMove(e.x, e.y);
    else if (e.type === 'Wheel') this.game.wheel(e.x, e.y, e.delta);
    else if (e.type === 'Text') {
      if (this.authoringTool()) this.game.context.textInput(e.text);
    } else if (e.type === 'KeyDown') {
      const primary = e.control || e.meta,
        atlas = this.game.atlas,
        editor = this.game.editor;
      if (this.game.buildings) {
        const buildings = this.game.buildings;
        if (primary && e.text === 's') buildings.save();
        else if (primary && e.text === 'z') {
          if (e.shift) buildings.redo();
          else buildings.undo();
        } else if (primary && e.text === 'y') buildings.redo();
        else this.game.buildingKey(e.key, primary, e.shift);
        return;
      }
      if (atlas) {
        if (primary && e.text === 's') void atlas.save();
        else if (primary && e.text === 'o') void atlas.load();
        else if (primary && e.text === 'z') {
          if (e.shift) atlas.redo();
          else atlas.undo();
        } else if (primary && e.text === 'y') atlas.redo();
        else if (!atlas.textFocused(this.game.context) && e.text === 'f') atlas.fit();
        else if (!atlas.textFocused(this.game.context) && e.text === 'home') atlas.home();
        else if (!atlas.textFocused(this.game.context) && /^[1-9]$/.test(e.text))
          atlas.choose(Number(e.text) - 1);
        else if (!atlas.textFocused(this.game.context) && e.text === '[') atlas.resizeBrush(-1);
        else if (!atlas.textFocused(this.game.context) && e.text === ']') atlas.resizeBrush(1);
        else this.game.mapKey(e.key, e.shift);
        return;
      }
      if (editor) {
        if (primary && e.text === 's') void editor.save();
        else if (primary && e.text === 'o') void editor.load();
        else if (primary && e.text === 'z') {
          if (e.shift) editor.redo();
          else editor.undo();
        } else if (primary && e.text === 'y') editor.redo();
        else this.game.context.key(e.key, e.shift);
        return;
      }
      if (e.text === 'f2' || e.text === 'f3') return;
      if (e.control || e.meta || e.alt) return;
      if (e.text === 'space') this.game.togglePause();
      else if (e.text === 'tab') this.game.cycleSpeed();
      else if (e.text === 'escape') this.game.cancel();
      else if (e.text === 'return') this.game.finish();
      else if (e.text === 'backspace') this.game.undoPoint();
      else if (e.text === 'r') this.game.rotate(f((e.shift ? -1 : 1) * f(0.2618)));
      else if (e.text === 'm') this.game.prepare(Order.Move);
      else if (e.text === 'a') this.game.prepare(Order.Attack);
      else if (
        e.text === 'w' &&
        (this.game.selectedPeople().length > 0 ||
          this.game.selectedTreeCell() >= 0 ||
          this.game.selectedRockCell() >= 0)
      )
        this.game.prepare(Order.Work);
      else if (e.text === 's') this.game.stopSelected();
      else if (e.text === 'b' && this.game.selectedPeople().length) this.game.openUnitBuild();
      else {
        const tool = shortcuts.get(e.text);
        if (tool !== undefined) this.game.selectTool(tool, this.game.selectedPeople().length > 0);
      }
      this.keys.add(e.text);
    } else if (e.type === 'KeyUp') this.keys.delete(e.text);
    this.game.setPan(
      Number(this.keys.has('right')) - Number(this.keys.has('left')),
      Number(this.keys.has('down')) - Number(this.keys.has('up')),
    );
  }
  takesTyping(): boolean {
    return this.authoringTool() || this.editorAttached || !!this.scriptContext.focused();
  }
  properties(): Property[] {
    return [
      property('speed', 'Simulation speed', this.game.gameSpeed(), 0, 5, 1),
      property('zoom', 'Camera zoom', this.game.view().zoom, 0.1, 6, 0.1),
      property('camera.x', 'Camera X', this.game.view().x, -20000, 20000, 10),
      property('camera.y', 'Camera Y', this.game.view().y, -20000, 20000, 10),
      property('world.clock', 'World clock (s)', this.game.state().clock(), 0, 1e12, 1, true),
      property(
        'world.hour',
        'Time of day',
        this.game.state().dayFraction() * 24,
        0,
        23.99,
        0.25,
        this.editorAttached && this.playback !== Playback.Stopped,
      ),
    ];
  }
  property(id: string, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    this.dirty = true;
    if (id === 'world.hour')
      return (
        (!this.editorAttached || this.playback === Playback.Stopped) && this.game.state().editHour(value)
      );
    if (id === 'speed') {
      const speed = Math.trunc(clamp(value, 0, 5));
      if (!speed) {
        if (this.game.gameSpeed()) this.game.togglePause();
      } else this.game.setSpeed(speed);
    } else if (id === 'zoom') this.game.view().zoom = f(clamp(value, 0.1, 6));
    else if (id === 'camera.x') this.game.view().x = f(clamp(value, -20000, 20000));
    else if (id === 'camera.y') this.game.view().y = f(clamp(value, -20000, 20000));
    else return false;
    return true;
  }
  command(id: string, argument = ''): boolean {
    if (id === 'session.freeze') {
      this.presentationFrozen = argument !== 'off';
      return true;
    }
    if (id === 'session.focus-settlement') {
      const p = this.game.state().camp()?.center ?? this.game.state().map().camp(),
        at = project(p.x, p.y);
      this.game.setView(new Camera(at.x, f(at.y - 32), f(1.4)));
      return true;
    }
    if (id === 'session.suspend') {
      this.sound.fadeOut();
      this.keys.clear();
      this.game.setPan(0, 0);
      this.lastTime = -1;
      return true;
    }
    if (id === 'session.resume') {
      this.sound.fadeIn();
      this.lastTime = -1;
      this.resumeFrame = true;
      return true;
    }
    if (id === 'session.save') {
      try {
        this.services.files.stage(argument, encodeTown(this.game.state()));
        return true;
      } catch {
        return false;
      }
    }
    if (id === 'session.load') {
      try {
        const loaded = decodeTown(
          this.services.files.readSync(argument),
          (map) => new Town(map, 176, false, true),
        );
        this.game.town = loaded;
        const p = loaded.map().camp(),
          at = project(p.x, p.y);
        this.game.setView(new Camera(at.x, at.y, 1));
        this.dirty = true;
        this.lastTime = -1;
        return true;
      } catch {
        return false;
      }
    }
    if (id === 'session.authoring') return this.authoringTool();
    if (id === 'ui.cursor') return argument === 'crosshair' && this.game.targetingCursor();
    if (id === 'ui.text-input') return argument === 'off' && !this.takesTyping();
    if (id === 'runtime.step') {
      if (!this.editorAttached || this.playback !== Playback.Paused) return false;
      this.singleStep = true;
      return true;
    }
    if (id === 'runtime.playback') {
      if (!['playing', 'paused', 'stopped'].includes(argument)) return false;
      if (!this.editorAttached) {
        this.game.selectPeople([]);
        this.editorAttached = true;
      }
      if (argument !== 'stopped' && !this.authoredGame) {
        const next = this.game.fork();
        if (this.script.ready()) {
          this.runtimeScript = this.script.fork();
          if (!this.runtimeScript) {
            next.dispose();
            return false;
          }
          this.runtimeScript.onCommand = (name) => {
            this.command(name);
          };
        }
        this.authoredSelection = this.inspected;
        this.authoredGame = this.game;
        this.game = next;
        this.remount = true;
        this.lastTime = 0;
      }
      if (argument === 'stopped' && this.authoredGame) {
        this.retiredGames.push(this.game);
        this.game = this.authoredGame;
        this.authoredGame = null;
        this.inspected = this.authoredSelection;
        this.runtimeScript?.dispose();
        this.runtimeScript = null;
        this.remount = true;
        this.lastTime = 0;
      }
      this.playback =
        argument === 'playing'
          ? Playback.Playing
          : argument === 'paused'
            ? Playback.Paused
            : Playback.Stopped;
      this.keys.clear();
      this.game.setPan(0, 0);
      this.game.cancelPointer();
      this.scriptContext.cancelPointer();
      this.scriptPointer = false;
      this.dirty = true;
      if (argument === 'playing') this.sound.fadeIn();
      else this.sound.playback?.(argument === 'paused' ? 'Paused' : 'Stopped');
      return true;
    }
    if (id === 'reset') {
      this.pendingReset = true;
      return true;
    }
    if (id === 'pause') {
      this.game.togglePause();
      return true;
    }
    if (id === 'speed') {
      this.game.cycleSpeed();
      return true;
    }
    if (id === 'asset.apply') {
      try {
        applyBuildingAsset(argument);
        this.dirty = true;
        return true;
      } catch (error) {
        console.error('Building asset rejected: ' + (error instanceof Error ? error.message : String(error)));
        return false;
      }
    }
    if (id === 'asset.available') return true;
    if (['edit.building', 'asset.editor', 'asset.open', 'asset.save', 'asset.export'].includes(id)) {
      this.keys.clear();
      this.game.setPan(0, 0);
      this.scriptContext.cancelPointer();
      this.scriptPointer = false;
      return this.game.buildingCommand(id === 'edit.building' ? 'asset.editor' : id, argument);
    }
    if (id === 'edit.map') {
      this.game.openMapEditor();
      return true;
    }
    if (id === 'edit.character') {
      this.game.openCharacterEditor();
      return true;
    }
    return false;
  }
  actions(): { id: string; label: string }[] {
    return [
      { id: 'edit.map', label: 'Map Editor' },
      { id: 'edit.character', label: 'Character Studio' },
      { id: 'edit.building', label: 'Building Studio' },
      { id: 'reset', label: 'Restart game' },
    ];
  }
  sceneObjects(): SceneObject[] {
    return [
      { id: 'world', name: 'World', type: 'World' },
      ...this.game
        .state()
        .people()
        .map((p) => ({ id: 'unit:' + p.id, name: p.name, type: 'Unit' })),
      ...this.game
        .state()
        .buildings()
        .map((b) => ({ id: 'building:' + b.id, name: structureSpec(b.kind).name, type: 'Building' })),
      ...(this.script.ready() ? [{ id: 'script:hud', name: this.script.title(), type: 'Lua Script' }] : []),
    ];
  }
  sceneSelection(): string {
    return this.inspected;
  }
  selectSceneObject(id: string): boolean {
    const editing = !this.editorAttached || this.playback === Playback.Stopped,
      unit = objectId(id, 'unit:'),
      building = objectId(id, 'building:');
    if (id === 'world' || (id === 'script:hud' && this.script.ready())) {
      if (editing) this.game.selectPeople([]);
    } else if (unit !== undefined && this.game.state().person(unit)) {
      if (editing) this.game.selectPeople([unit]);
    } else if (building !== undefined && this.game.state().building(building)) {
      if (editing) this.game.selectBuilding(building);
    } else return false;
    this.inspected = id;
    this.dirty = true;
    return true;
  }
  sceneProperties(): Property[] {
    const unit = objectId(this.inspected, 'unit:'),
      id = objectId(this.inspected, 'building:');
    let result: Property[] = [];
    if (unit !== undefined) {
      const p = this.game.state().person(unit);
      if (p)
        result = [
          property('position.x', 'Position X', p.position.x, 0, 16384, 0.25),
          property('position.y', 'Position Y', p.position.y, 0, 16384, 0.25),
          property('health', 'Health', p.health, 0, 1, 0.05),
        ];
    } else if (id !== undefined) {
      const b = this.game.state().building(id);
      if (b)
        result = [
          property('position.x', 'Position X', b.center.x, 0, 16384, 0.25),
          property('position.y', 'Position Y', b.center.y, 0, 16384, 0.25),
          property('rotation', 'Rotation (deg)', (b.angle * 180) / Math.PI, -360, 360, 5),
          property('progress', 'Construction', b.progress, 0, 1, 0.05),
          property('health', 'Health', b.health, 0, 1, 0.05),
        ];
    } else if (this.inspected === 'script:hud') return (this.runtimeScript ?? this.script).properties();
    else
      result = [
        property(
          'world.hour',
          'Time of day',
          this.game.state().dayFraction() * 24,
          0,
          23.99,
          0.25,
          this.editorAttached && this.playback !== Playback.Stopped,
        ),
        property('map.width', 'Map width', this.game.state().map().width(), 0, 16384, 1, true),
        property('map.height', 'Map height', this.game.state().map().height(), 0, 16384, 1, true),
        property('world.clock', 'World clock (s)', this.game.state().clock(), 0, 1e12, 1, true),
      ];
    for (const field of result) {
      if (field.id === 'position.x') field.maximum = this.game.state().map().width() - 0.01;
      if (field.id === 'position.y') field.maximum = this.game.state().map().height() - 0.01;
    }
    return result;
  }
  sceneProperty(id: string, value: number): boolean {
    if (!Number.isFinite(value)) return false;
    let accepted = false;
    const unit = objectId(this.inspected, 'unit:'),
      building = objectId(this.inspected, 'building:');
    if (unit !== undefined) {
      const p = this.game.state().person(unit);
      if (p) {
        const position = { ...p.position };
        let health = p.health;
        if (id === 'position.x') position.x = f(clamp(value, 0, 16384));
        else if (id === 'position.y') position.y = f(clamp(value, 0, 16384));
        else if (id === 'health') health = f(clamp(value, 0, 1));
        else return false;
        accepted = this.game.state().editPerson(unit, position, health);
      }
    } else if (building !== undefined) {
      const b = this.game.state().building(building);
      if (b) {
        const center = { ...b.center };
        let angle = b.angle,
          progress = b.progress,
          health = b.health;
        if (id === 'position.x') center.x = f(clamp(value, 0, 16384));
        else if (id === 'position.y') center.y = f(clamp(value, 0, 16384));
        else if (id === 'rotation') angle = f(clamp(value, -360, 360) / (180 / Math.PI));
        else if (id === 'progress') progress = f(clamp(value, 0, 1));
        else if (id === 'health') health = f(clamp(value, 0, 1));
        else return false;
        accepted = this.game.state().editBuilding(building, center, angle, progress, health);
      }
    } else if (this.inspected === 'script:hud')
      accepted = (this.runtimeScript ?? this.script).property(id, value);
    else if (id === 'world.hour') accepted = this.property(id, value);
    this.dirty ||= accepted;
    return accepted;
  }
  dispose(): void {
    this.root.remove();
    this.runtimeScript?.dispose();
    this.script.dispose();
    this.scriptContext.destroy();
    this.game.dispose();
    this.authoredGame?.dispose();
    for (const game of this.retiredGames) game.dispose();
    this.sound.dispose();
    this.root.dispose();
  }
}
