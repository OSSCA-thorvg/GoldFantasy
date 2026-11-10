import type { Scene } from '@thorvg/webcanvas';
import type { GameRenderApp } from './game-render';
import type { GameEditorsApp } from './game-editors';
import type { AppEvent } from './application-contracts';
import type { Town } from '../../../../packages/engine/src/town';
import type { Sound, Ambience } from '../../../../packages/native-audio/src/sound-types';
import type { Camera, Point } from '../../../../packages/engine/src/geometry';
import type { Tool, Order, PointerButton } from '../../../../packages/engine/src/game-tools';
import type { Key } from '../../../../packages/native-ui/src';
/** Native application window boundary; implementations retain original GameApp semantics. */
export interface GameRuntime extends GameEditorsApp {
  handlePrayerEvent?(event: AppEvent): boolean;
  state(): Town;
  view(): Camera;
  setView(camera: { x: number; y: number; zoom: number }): void;
  worldScene(): Scene;
  worldPresented(pixelRatio: number): boolean;
  invalidatePresentation(): void;
  hudScene(): Scene;
  renderScene(width: number, height: number): void;
  render(
    width: number,
    height: number,
    seconds: number,
    simulate?: boolean,
    maxDelta?: number,
    uiSeconds?: number,
  ): void;
  sceneEvent(event: AppEvent): boolean;
  pointerDown(x: number, y: number, button: PointerButton): void;
  pointerUp(x: number, y: number, button: PointerButton): void;
  wheel(x: number, y: number, amount: number): void;
  takeCues(): Sound[];
  ambience(): Ambience;
  loadMapFile(path: string, error?: { value: string }): boolean;
  openBuildingEditor(path?: string): boolean;
  buildingCommand(id: string, argument?: string): boolean;
  buildingKey(key: Key, primary: boolean, shift: boolean): void;
  openMapEditor(): void;
  openCharacterEditor(): void;
  mapKey(key: Key, shift?: boolean): void;
  prepare(order: Order): void;
  stopSelected(): void;
  toggleAuto(): void;
  openUnitBuild(): void;
  selectTool(tool: Tool, useSelection?: boolean): void;
  togglePause(): void;
  cycleSpeed(): void;
  setSpeed(value: number): void;
  rotate(radians: number): void;
  setPan(dx: number, dy: number): void;
  cancel(): void;
  undoPoint(): void;
  selectedBuilding(): number;
  selectedPeople(): readonly number[];
  selectedTreeCell(): number;
  selectedRockCell(): number;
  fork(): GameRuntime;
  dispose(): void;
}
