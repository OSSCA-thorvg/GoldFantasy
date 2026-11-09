import type { BuildingFiles } from './building-files';
import type { BuildingDocumentFiles } from '../../../../packages/native-editors/src';
import type { GameRenderApp } from './game-render';
import { Plan } from './game-app-state';
import { Town } from '../../../../packages/engine/src/town';
import { Traffic } from '../../../../packages/engine/src/traffic';
import { WorldMap } from '../../../../packages/engine/src/world-map';
import { Camera, project, point } from '../../../../packages/engine/src/geometry';
import { Tool, Order } from '../../../../packages/engine/src/game-tools';
import { validCharacter } from '../../../../packages/engine/src/character-preset';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { Key } from '../../../../packages/native-ui/src';
import {
  MapEditor,
  MapDocument,
  CharacterEditor,
  type MapPreviewRenderer,
  type CharacterPreviewRenderer,
  type DocumentFiles,
} from '../../../../packages/native-editors/src';
export interface GameFiles extends DocumentFiles, BuildingDocumentFiles {
  readSync(path: string, maxBytes?: number): string;
}
export interface EditorServices {
  files: GameFiles;
  buildings: BuildingFiles;
  mapPreview(): MapPreviewRenderer;
  characterPreview(): CharacterPreviewRenderer;
}
export interface GameEditorsApp extends GameRenderApp {
  editorServices: EditorServices;
  openBuildingEditor(path?: string): boolean;
}
export function openCharacterEditor(this: GameEditorsApp): void {
  if (this.editor || this.atlas || this.buildings || !this.town.people().length) return;
  const person = this.chosen.length ? this.town.person(this.chosen[0]) : this.town.people()[0];
  if (!person) return;
  for (const state of this.speakers.values()) {
    state.speech.stop();
    state.heard = 0n;
  }
  this.cues.push(new Sound(Cue.SpeechStop));
  this.pan = point();
  this.cancelPointer();
  this.editor = new CharacterEditor(
    person,
    this.editorServices.characterPreview(),
    this.editorServices.files,
  );
}
export function closeCharacterEditor(this: GameEditorsApp, apply: boolean): void {
  if (this.editor && (!apply || validCharacter(this.editor.current()))) {
    this.cues.push(new Sound(Cue.SpeechStop));
    this.editorDecision = apply;
  }
}
export function openMapEditor(this: GameEditorsApp): void {
  if (this.editor || this.atlas || this.buildings) return;
  for (const state of this.speakers.values()) {
    state.speech.stop();
    state.heard = 0n;
  }
  this.cues.push(new Sound(Cue.SpeechStop));
  this.pan = point();
  this.cancelPointer();
  this.renderer.scene().opacity(0);
  this.atlas = new MapEditor(this.town.map(), this.editorServices.mapPreview(), this.editorServices.files);
}
export function closeMapEditor(this: GameEditorsApp, play: boolean): void {
  if (!this.atlas || (play && this.atlas.document().validation())) return;
  this.atlas.document().endStroke();
  this.mapDecision = play;
}
export function mapKey(this: GameEditorsApp, key: Key, shift = false): void {
  if (!this.atlas) return;
  if (key === Key.Escape) this.closeMapEditor(false);
  else this.context.key(key, shift);
}
export function startMap(this: GameEditorsApp, map: WorldMap): void {
  this.campResources.reset();
  this.questsInitialized = this.questsAnimating = false;
  this.questPulseAt = -1;
  const seed = map.seed();
  this.town = new Town(map);
  this.traffic = new Traffic(seed);
  this.renderer.invalidateMap();
  this.speakers.clear();
  this.chosen = this.town.people().map((person) => person.id);
  const at = project(this.town.map().camp().x, this.town.map().camp().y);
  this.camera = new Camera(at.x, at.y, Math.fround(1.4));
  this.dismissBuildDrawer();
  this.tool = Tool.Select;
  this.speed = 1;
  this.paused = false;
  this.pending = Order.None;
  this.card = -1;
  this.selected = this.selectedDungeon = this.selectedTree = this.selectedRock = this.selectedAnimal = -1;
  this.workQueue = [];
  this.stoppedWork.clear();
  this.workSerial = 0n;
  this.lastDispatch = -1;
  this.globalCard = -1;
  this.pan = point();
  this.mouse = point(-1, -1);
  this.cursor = point(-1, -1);
  this.roadStroke = [];
  this.roadPress = null;
  this.roadMoved = false;
  this.outline = [];
  this.crew = [];
  this.cancelPointer();
  this.notice = this.status = '';
  this.finished = [];
  this.heardFinished = false;
  this.heardBlow = this.heardTree = 0n;
  this.heardRaids = 0;
  this.nextSpeechAt = [0, 0];
  this.cues.push(new Sound(Cue.SpeechStop));
  this.current = new Plan();
}
export function loadMapFile(this: GameEditorsApp, path: string, error?: { value: string }): boolean {
  try {
    const map = MapDocument.decode(this.editorServices.files.readSync(path)),
      doc = new MapDocument(map),
      problem = doc.validation();
    if (problem) throw new Error(problem);
    this.startMap(doc.gameMap());
    return true;
  } catch (cause) {
    if (error) error.value = cause instanceof Error ? cause.message : String(cause);
    return false;
  }
}
