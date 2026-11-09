import type { GameEditorsApp } from './game-editors';
import { Structure } from '../../../../packages/engine/src/building-catalog';
import { point } from '../../../../packages/engine/src/geometry';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { BuildingEditor } from '../../../../packages/native-editors/src';
import type { Key } from '../../../../packages/native-ui/src';
export function openBuildingEditor(this: GameEditorsApp, path = ''): boolean {
  if (this.buildings) return !path || this.buildings.load(path);
  if (this.editor || this.atlas) return false;
  const selected = this.town.building(this.selected),
    kind = selected?.kind ?? Structure.Cottage,
    candidate = new BuildingEditor(this.editorServices.buildings.entry(kind), this.editorServices.files);
  candidate.onSaved((entry) => this.editorServices.buildings.remember(entry));
  candidate.setChoices(
    Array.from({ length: Structure.Count }, (_, i) => this.editorServices.buildings.entry(i)),
  );
  candidate.setGameMode(true);
  candidate.setVariant((selected?.variant ?? 0) % candidate.current().variants.length);
  if (path && !candidate.load(path) && !candidate.pendingDiscard()) {
    this.status = candidate.message();
    candidate.dispose();
    return false;
  }
  this.cancelPointer();
  this.pan = point();
  for (const state of this.speakers.values()) {
    state.speech.stop();
    state.heard = 0n;
  }
  this.cues.push(new Sound(Cue.SpeechStop));
  this.buildings = candidate;
  this.buildingClose = false;
  this.renderer.scene().opacity(0);
  return true;
}
export function buildingCommand(this: GameEditorsApp, id: string, argument = ''): boolean {
  if (id === 'asset.available') return true;
  if (id === 'asset.editor' || (id === 'asset.open' && !this.buildings))
    return this.openBuildingEditor(argument);
  return this.buildings?.command(id, argument) ?? false;
}
export function buildingKey(this: GameEditorsApp, key: Key, primary: boolean, shift: boolean): void {
  this.buildings?.key(this.context, key, primary, shift);
}
