import type { Scene } from '@thorvg/webcanvas';
import { Key } from '../../../../packages/native-ui/src/types';
import type { Activity, Person } from '../../../../packages/engine/src/person';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { Sound, Ambience } from '../../../../packages/native-audio/src/sound-types';
export type { Sound, Ambience } from '../../../../packages/native-audio/src/sound-types';

export interface Point {
  x: number;
  y: number;
}
export interface Camera extends Point {
  zoom: number;
}
export type SceneId = 'Title' | 'Game' | 'CharacterStudio' | 'MapEditor';
export type AppEventType =
  'PointerDown' | 'PointerUp' | 'PointerMove' | 'Wheel' | 'KeyDown' | 'KeyUp' | 'Text' | 'PointerCancel';
export interface AppEvent {
  type: AppEventType;
  x: number;
  y: number;
  delta: number;
  button: number;
  key: Key;
  text: string;
  shift: boolean;
  control: boolean;
  alt: boolean;
  meta: boolean;
}
export interface Property {
  id: string;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  readOnly: boolean;
}
export interface Application {
  title(): string;
  scene(): Scene;
  render(width: number, height: number, seconds: number): void;
  /** Native hit geometry is valid only after the host has presented the Canvas. */
  presented?(pixelRatio: number): void;
  invalidatePresentation?(): void;
  event(event: AppEvent): void;
  properties(): Property[];
  property(id: string, value: number): boolean;
  command(id: string, argument?: string): boolean;
  dispose(): void;
}
export interface LaunchOptions {
  world: 'Designed' | 'Random';
  seed?: number;
  mapFile: string;
  characterFile: string;
  uiScript: string;
  buildingAssets: string;
  buildingFile: string;
  titleScreen: boolean;
  saveFile: string;
  mapEditor: boolean;
  studio: boolean;
  buildingStudio: boolean;
  demo: boolean;
  raid: boolean;
  days: number;
  weather: string;
}
export const defaultLaunchOptions = (): LaunchOptions => ({
  world: 'Designed',
  mapFile: '',
  characterFile: '',
  uiScript: '',
  buildingAssets: '',
  buildingFile: '',
  titleScreen: false,
  saveFile: '',
  mapEditor: false,
  studio: false,
  buildingStudio: false,
  demo: false,
  raid: false,
  days: 6,
  weather: '',
});
export interface NativeSound {
  play(cue: Sound): void;
  setAmbience(ambience: Ambience): void;
  fadeIn(seconds?: number): void;
  fadeOut(seconds?: number): void;
  playback?(state: 'Paused' | 'Stopped' | 'Playing'): void;
  dispose(): void;
}
export interface PreviewWorld {
  advanceTitleAutoplay(seconds: number): void;
  titleAutoplaySubject(): Person | null;
  building(id: number): Building | null | undefined;
  startTitleAutoplay(seed: number): void;
  map(): { camp(): Point };
  camp(): { center: Point } | undefined | null;
  people(): readonly { id: number; moving(): boolean; activity: Activity }[];
}
export interface Preview {
  state(): PreviewWorld;
  view(): Camera;
  setView(camera: Camera): void;
  worldScene(): Scene;
  render(width: number, height: number, seconds: number, hud: false): void;
  selectPeople(ids: number[]): void;
  selectedPeople(): readonly number[];
  ambience(): Ambience;
  takeCues(): Sound[];
  loadMapFile(path: string): boolean;
  dispose(): void;
}
export interface SceneServices {
  createApplication(options: LaunchOptions): Application;
  createPreview(seed: number): Preview;
  loadPreview(preview: Preview, path: string): boolean;
  createSound(): NativeSound;
  exists(path: string): boolean;
  preferenceSavePath(): string;
  randomDevice(): number;
  designedWorldSeed: number;
  syncSave(): void;
}
export function emptyEvent(type: AppEventType): AppEvent {
  return {
    type,
    x: 0,
    y: 0,
    delta: 0,
    button: 1,
    key: Key.Unknown,
    text: '',
    shift: false,
    control: false,
    alt: false,
    meta: false,
  };
}
