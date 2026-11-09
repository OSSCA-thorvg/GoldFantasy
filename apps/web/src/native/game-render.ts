// Frame ordering, input overlays and sound notifications from native GameApp::render.
import type { Scene } from '@thorvg/webcanvas';
import type { GameCommandApp } from './game-commands';
import { GameAppState, type Plan, type WorldRenderer } from './game-app-state';
import type { Traffic } from '../../../../packages/engine/src/traffic';
import type { Town } from '../../../../packages/engine/src/town';
import { Tool, Preview } from '../../../../packages/engine/src/game-tools';
import { Camera, distance, type Point } from '../../../../packages/engine/src/geometry';
import { clamp, f32 as f } from '../../../../packages/engine/src/numeric';
import { TreeWorkKind } from '../../../../packages/engine/src/person';
import { treePosition } from '../../../../packages/engine/src/world-map';
import * as mining from '../../../../packages/engine/src/mining';
import { Cue, Sound, SpeechChannel, noticeCue } from '../../../../packages/native-audio/src/sound-types';
import { Moment } from '../../../../packages/native-audio/src/music-director';
import { Rect } from '../../../../packages/native-ui/src';
import {
  type CharacterEditor,
  type BuildingEditor,
  type MapEditor,
  type PortraitBackdrop,
} from '../../../../packages/native-editors/src';
import { applyBuildingAsset } from '../../../../packages/native-renderer/src/building-assets';
import type { BuildingFiles } from './building-files';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
export interface RenderWorld extends WorldRenderer {
  update(
    town: Town,
    traffic: Traffic,
    camera: Camera,
    width: number,
    height: number,
    seconds: number,
    preview: Preview,
    selected?: readonly number[],
  ): void;
}
export interface SpeakerState {
  speech: { stop(): void };
  heard: bigint;
  heardChannel: SpeechChannel;
}
export interface GameRenderApp extends GameCommandApp {
  renderer: RenderWorld;
  traffic: Traffic;
  speakers: Map<number, SpeakerState>;
  editorServices: { buildings: BuildingFiles };
  buildings: BuildingEditor | null;
  buildingClose: boolean;
  editor: CharacterEditor | null;
  atlas: MapEditor | null;
  editorDecision: boolean | null;
  mapDecision: boolean | null;
  startMap(map: Town['world']): void;
  closeMapEditor(play: boolean): void;
  closeCharacterEditor(apply: boolean): void;
  spatial(cue: Cue, world: Point): Sound;
  gameSpeed(): number;
  plan(): Plan;
  raiseAlarm(seconds: number): void;
  grunt(id: number): void;
  playMoment(moment: Moment, seconds: number): void;
  soundscape(seconds: number): void;
  updateSpeech(seconds: number): void;
  speechBubbles(width: number, height: number): void;
  hud(width: number, height: number): void;
  commandOverlay(): void;
  animatingUi(): boolean;
  reducedMotion(): boolean;
}
function backdrop(town: Town, position: Point): PortraitBackdrop {
  const b = portraitBackdrop(town.map(), position, town.climate()),
    rgb = (c: readonly number[]) => ({ r: c[0], g: c[1], b: c[2] });
  return { ground: rgb(b.ground), left: rgb(b.left), right: rgb(b.right), distant: rgb(b.distant) };
}
export function renderScene(this: GameRenderApp, width: number, height: number): void {
  this.campResources.reset();
  this.viewWidth = width;
  this.viewHeight = height;
  this.last = 0;
  this.renderer.setSceneView(true);
  const preview = new Preview();
  preview.zoom = this.camera.zoom;
  this.renderer.update(this.town, this.traffic, this.camera, width, height, 0, preview, this.chosen);
  this.context.begin(this.theme, new Rect(0, 0, width, height), 0);
  this.context.end();
}
export function render(
  this: GameRenderApp,
  width: number,
  height: number,
  seconds: number,
  simulate = true,
  maxDelta = 0.25,
  uiSeconds = -1,
): void {
  this.theme.reducedMotion = this.reducedMotion();
  width = f(width);
  height = f(height);
  if (this.atlas || this.buildings) this.campResources.reset();
  if (this.buildingClose) {
    this.buildings?.dispose();
    this.buildings = null;
    this.buildingClose = false;
    this.renderer.scene().opacity(255);
    this.last = seconds;
  }
  if (this.buildings) {
    this.viewWidth = width;
    this.viewHeight = height;
    this.last = seconds;
    this.context.begin({ ...this.theme, radius: 2 }, new Rect(0, 0, width, height), seconds);
    this.buildings.render(
      this.context,
      new Rect(0, 0, width, height),
      (asset, error) => {
        try {
          applyBuildingAsset(asset);
          this.editorServices.buildings.remember(this.buildings!.document());
          return true;
        } catch (cause) {
          error.value = cause instanceof Error ? cause.message : String(cause);
          return false;
        }
      },
      () => {
        this.buildingClose = true;
      },
    );
    this.context.end();
    return;
  }
  if (this.atlas && this.mapDecision !== null) {
    if (this.mapDecision) this.startMap(this.atlas.document().gameMap());
    const atlas = this.atlas;
    // The previous UI clip still holds the preview Scene until Context.end().
    this.context.deferRelease(() => atlas.dispose());
    this.atlas = null;
    this.mapDecision = null;
    this.renderer.scene().opacity(255);
    this.last = seconds;
  }
  if (this.atlas) {
    this.viewWidth = width;
    this.viewHeight = height;
    this.last = seconds;
    this.context.begin(this.theme, new Rect(0, 0, width, height), uiSeconds >= 0 ? uiSeconds : seconds);
    this.atlas.render(this.context, new Rect(0, 0, width, height), (play) => this.closeMapEditor(play));
    this.context.end();
    return;
  }
  if (this.editor && this.editorDecision !== null) {
    if (this.editorDecision) this.town.customizePerson(this.editor.personId(), this.editor.current());
    this.editor = null;
    this.editorDecision = null;
    this.last = seconds;
  }
  const editing = this.editor !== null;
  this.viewWidth = width;
  this.viewHeight = height;
  const elapsed = !simulate || this.last < 0 ? 0 : clamp(seconds - this.last, 0, maxDelta);
  this.last = seconds;
  if (!editing && (this.pan.x !== 0 || this.pan.y !== 0)) {
    const speed = f(f(620 / this.camera.zoom) * f(elapsed));
    this.camera.x = f(this.camera.x + f(this.pan.x * speed));
    this.camera.y = f(this.camera.y + f(this.pan.y * speed));
    if (this.mouse.x >= 0) this.pointerMove(this.mouse.x, this.mouse.y);
  }
  if (simulate) {
    this.town.advance(editing ? 0 : elapsed * this.gameSpeed());
    if (!editing) this.dispatchWork();
    this.traffic.update(this.town, editing ? 0 : elapsed * this.gameSpeed());
  }
  this.chosen = this.chosen.filter((id) => !!this.town.person(id));
  for (const id of this.speakers.keys()) if (!this.town.person(id)) this.speakers.delete(id);
  if (simulate || this.town.isTitleAutoplay()) {
    if (seconds >= this.noticeUntil) {
      const text = this.town.takeNotice();
      if (text) {
        this.notice = text;
        this.noticeUntil = seconds + 3.5;
        this.cue(noticeCue(text));
      }
    }
    if (this.town.raids() !== this.heardRaids && this.town.raiding()) {
      const howl = this.spatial(Cue.Howl, this.town.monsters().at(-1)!.position);
      howl.gain = Math.max(howl.gain, f(0.45));
      if (this.cues.length < 32) this.cues.push(howl);
      this.raiseAlarm(seconds);
    }
    this.heardRaids = this.town.raids();
    let heard = 0;
    for (const hit of this.town.hits()) {
      if (hit.serial < this.heardBlow) continue;
      this.heardBlow = hit.serial + 1n;
      const picked = this.chosen.includes(hit.person);
      if (!this.renderer.visible(hit.to)) continue;
      if (hit.onPerson && picked) this.grunt(hit.person);
      if (heard++ >= 4) continue;
      const blow = this.spatial(hit.onPerson ? Cue.Bite : hit.ranged ? Cue.Arrow : Cue.Clash, hit.to);
      blow.gain = f(blow.gain * f(0.6));
      if (blow.gain > f(0.03) && this.cues.length < 32) this.cues.push(blow);
    }
    let timberHeard = 0;
    for (const event of this.town.treeEvents()) {
      if (event.serial < this.heardTree) continue;
      this.heardTree = event.serial + 1n;
      if (this.town.clock() - event.at > 0.25 || timberHeard >= 4) continue;
      const stone = event.kind === TreeWorkKind.Mine || event.kind === TreeWorkKind.Shatter,
        x = event.cell % this.town.map().width(),
        y = Math.trunc(event.cell / this.town.map().width()),
        at = stone ? mining.position(x, y) : treePosition(this.town.map(), x, y, event.index);
      if (!this.renderer.visible(at)) continue;
      const sound = this.spatial(
        stone ? Cue.Mine : event.kind === TreeWorkKind.Chop ? Cue.Chop : Cue.TreeFall,
        at,
      );
      sound.gain = f(sound.gain * f(0.4));
      sound.speaker = event.person;
      this.cues.push(sound);
      ++timberHeard;
    }
    let completed = false;
    for (const item of this.town.buildings()) {
      if (!item.built() || this.finished.includes(item.id)) continue;
      this.finished.push(item.id);
      if (this.heardFinished) this.cueAt(Cue.Complete, item.center);
      completed ||= this.heardFinished;
    }
    if (completed) this.playMoment(Moment.Build, seconds);
    this.heardFinished = true;
    this.soundscape(seconds);
  }
  if (this.selected >= 0 && !this.town.building(this.selected)) this.selected = -1;
  this.current = this.plan();
  this.renderer.update(
    this.town,
    this.traffic,
    this.camera,
    width,
    height,
    seconds,
    this.current.preview,
    this.chosen,
  );
  if (simulate || this.town.isTitleAutoplay()) this.updateSpeech(seconds);
  this.context.begin(this.theme, new Rect(0, 0, width, height), uiSeconds >= 0 ? uiSeconds : seconds);
  if (
    !editing &&
    this.tool === Tool.Select &&
    this.boxFrom &&
    !this.hudPointer &&
    !this.panFrom &&
    distance(this.boxFrom, this.mouse) > 6
  ) {
    const fill = { ...this.theme.success, a: 90 },
      border = { ...this.theme.success, a: 230 };
    this.context.rect(
      new Rect(
        Math.min(this.boxFrom.x, this.mouse.x),
        Math.min(this.boxFrom.y, this.mouse.y),
        Math.abs(f(this.mouse.x - this.boxFrom.x)),
        Math.abs(f(this.mouse.y - this.boxFrom.y)),
      ),
      fill,
      0,
      border,
      f(1.5),
    );
  }
  if (!editing) this.speechBubbles(width, height);
  this.hud(width, height);
  if (!editing) this.commandOverlay();
  if (this.editor) {
    const person = this.town.person(this.editor.personId());
    if (person) this.editor.setBackdrop(backdrop(this.town, person.position));
    this.editor.render(this.context, new Rect(0, 0, width, height), (apply) =>
      this.closeCharacterEditor(apply),
    );
  }
  this.context.end();
}
export function takeCues(this: GameRenderApp): Sound[] {
  let out = this.cues;
  this.cues = [];
  out = out.filter(
    (sound) =>
      sound.cue !== Cue.Speech ||
      sound.speaker < 0 ||
      sound.speechChannel ===
        (this.chosen.includes(sound.speaker) ? SpeechChannel.Selected : SpeechChannel.Nearby),
  );
  for (const [id, state] of this.speakers) {
    const channel = this.chosen.includes(id) ? SpeechChannel.Selected : SpeechChannel.Nearby;
    if (!state.heard || state.heardChannel === channel) continue;
    const stop = new Sound(Cue.SpeechStop);
    stop.speaker = id;
    out.push(stop);
    state.heard = 0n;
    state.heardChannel = channel;
  }
  return out;
}
export function nextFrameDelay(this: GameRenderApp): number {
  if (this.animatingUi()) return 1 / 60;
  if (this.buildings) return this.buildings.animating() ? 1 / 60 : 0.1;
  if (this.atlas) return this.atlas.dragging() ? 1 / 60 : 0.1;
  if (this.editor) return 0.1;
  if (this.chosen.length) return 1 / 60;
  if (this.renderer.animating() || this.pan.x !== 0 || this.pan.y !== 0 || this.panFrom) return 1 / 60;
  return 1 / 30;
}
export function animatingUi(this: GameRenderApp): boolean {
  return (
    this.dockProgress < 1 ||
    this.campResources.animating() ||
    this.context.motionActive() ||
    this.questsAnimating ||
    Math.abs(f(this.timeReveal - (this.timeExpanded ? 1 : 0))) > f(0.001)
  );
}
export function worldScene(this: GameRenderApp): Scene {
  return this.renderer.scene();
}
export function hudScene(this: GameRenderApp): Scene {
  return this.context.scene();
}
export function gameSpeed(this: GameRenderApp): number {
  return this.paused ? 0 : this.speed;
}
export function togglePause(this: GameRenderApp): void {
  this.paused = !this.paused;
}
export function cycleSpeed(this: GameRenderApp): void {
  this.speed = this.speed >= GameAppState.maxSpeed ? 1 : this.speed + 1;
  this.paused = false;
}
export function setSpeed(this: GameRenderApp, value: number): void {
  this.speed = value;
  this.paused = false;
}
