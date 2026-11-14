// Frame ordering, input overlays and sound notifications from native GameApp::render.
import type { Scene } from '@thorvg/webcanvas';
import type { GameCommandApp } from './game-commands';
import { GameAppState, type Plan, type WorldRenderer } from './game-app-state';
import type { Traffic } from '../../../../packages/engine/src/traffic';
import type { Town } from '../../../../packages/engine/src/town';
import { Tool, Preview } from '../../../../packages/engine/src/game-tools';
import { Camera, distance, project, unproject, type Point } from '../../../../packages/engine/src/geometry';
import { clamp, f32 as f } from '../../../../packages/engine/src/numeric';
import { Cue, Sound, SpeechChannel, VoiceLine, noticeCue } from '../../../../packages/native-audio/src/sound-types';
import { combatFrame } from './game-combat-hud';
import { bannerNotice } from './swarm-hud';
import { commandGroundMarks } from './command-ground-marks';
import { Moment } from '../../../../packages/native-audio/src/music-director';
import { Rect } from '../../../../packages/native-ui/src';
import { queueWorkSounds } from './work-audio';
import { objectSelectionOverlay } from './selection-overlay';
import { renderPrayer } from './game-prayer';
import { renderExpedition } from './expedition-window';
import { renderExpeditionResult } from './expedition-result';
import { stagingActive, stagingFrame, stagingHeld, stagingVeil } from './expedition-staging';
import { keepTouchPlacementVisible } from './game-touch';
import {
  type CharacterEditor,
  type BuildingEditor,
  type MapEditor,
  type PortraitBackdrop,
} from '../../../../packages/native-editors/src';
import { applyBuildingAsset } from '../../../../packages/native-renderer/src/building-assets';
import type { BuildingFiles } from './building-files';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { noticeDue, showNotice } from './notice-toast';
import { guideFrame } from './game-guide';
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
  speedHeld(): boolean;
  plan(): Plan;
  raiseAlarm(seconds: number): void;
  grunt(id: number): void;
  sayLine(id: number, line: VoiceLine): boolean;
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
  // The in-game setting, not only the OS preference, stills the water and the world shake.
  this.renderer.reducedMotion = this.theme.reducedMotion;
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
  const resized = width !== this.viewWidth || height !== this.viewHeight;
  this.viewWidth = width;
  this.viewHeight = height;
  if (resized) keepTouchPlacementVisible.call(this);
  const elapsed = !simulate || this.last < 0 ? 0 : clamp(seconds - this.last, 0, maxDelta);
  this.last = seconds;
  if (!editing && !this.prayer && !this.expedition && !this.expeditionResult && (this.pan.x !== 0 || this.pan.y !== 0)) {
    const speed = f(f(620 / this.camera.zoom) * f(elapsed));
    this.camera.x = f(this.camera.x + f(this.pan.x * speed));
    this.camera.y = f(this.camera.y + f(this.pan.y * speed));
    this.hoveredWorldTarget = null;
    this.renderer.invalidatePresentation();
    if (this.mouse.x >= 0) {
      const projected = this.camera.toWorld(this.mouse, width, height);
      this.cursor = unproject(projected.x, projected.y);
      this.context.pointerMove(this.mouse.x, this.mouse.y);
      this.sampleRoad();
    }
  }
  if (simulate) {
    this.town.advance(editing || this.prayer || stagingHeld(this) ? 0 : elapsed * this.gameSpeed());
    if (!editing && !this.prayer) this.dispatchWork();
  }
  if (this.realmSeen !== this.town.realmRevision || this.realmGateSeen !== this.town.realmGate) {
    // Land was raised or sunk, or a save made beyond a gate was loaded: repaint
    // the map and put the view and the selection on the party.
    const entered = this.realmSeen !== this.town.realmRevision;
    this.realmSeen = this.town.realmRevision;
    this.renderer.invalidateMap();
    const plan = this.town.realmPlan(),
      party = plan ? this.town.realmParty() : [],
      home = this.town.map().dungeons()[this.realmGateSeen],
      focus = plan
        ? entered || !party.length
          ? plan.entry
          : party[0].position
        : home
          ? { x: home.origin.x + 1, y: home.origin.y + 2.3 }
          : null;
    // An expedition that just ended keeps the view until its result screen is closed.
    if (focus && !this.town.realmOutcome) {
      const at = project(focus.x, focus.y);
      this.camera.x = at.x;
      this.camera.y = at.y;
    }
    if (party.length) this.selectPeople(party.map((p) => p.id));
    this.realmGateSeen = this.town.realmGate;
  }
  if (simulate && !editing) stagingFrame(this, this.context.time());
  this.chosen = this.chosen.filter((id) => !!this.town.person(id));
  for (const id of this.speakers.keys()) if (!this.town.person(id)) this.speakers.delete(id);
  if (simulate && !editing && !this.prayer && !this.expedition && !this.expeditionResult) guideFrame(this);
  if (simulate || this.town.isTitleAutoplay()) {
    if (noticeDue(this, seconds, this.town.notices.length > 0)) {
      let text = this.town.takeNotice();
      // A den falling and the brood breaking have their own banner.
      while (text && bannerNotice(text)) text = this.town.takeNotice();
      if (text) {
        showNotice(this, text, seconds);
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
    // The blow itself is heard through combatSounds, which knows the weapon's shape.
    for (const hit of this.town.hits()) {
      if (hit.serial < this.heardBlow) continue;
      this.heardBlow = hit.serial + 1n;
      if (this.chosen.includes(hit.person) && hit.onPerson && this.renderer.visible(hit.to)) this.grunt(hit.person);
    }
    combatFrame(this, seconds);
    queueWorkSounds(this);
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
  commandGroundMarks(this);
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
  if (this.prayer) {
    renderPrayer.call(this, width, height);
    this.context.end();
    return;
  }
  if (this.expedition) {
    renderExpedition.call(this, width, height);
    this.context.end();
    return;
  }
  if (this.expeditionResult) {
    renderExpeditionResult.call(this, width, height);
    this.context.end();
    return;
  }
  if (!editing) stagingVeil(this, width, height);
  if (!editing) objectSelectionOverlay(this);
  else this.renderer.setGroundSelection([]);
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
    this.prayer !== null ||
    stagingActive(this) ||
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
/** Beyond a gate the game runs at normal speed; the chosen speed comes back on the way home. */
export function speedHeld(this: GameRenderApp): boolean {
  return this.town.realmActive();
}
export function gameSpeed(this: GameRenderApp): number {
  return this.paused ? 0 : this.speedHeld() ? 1 : this.speed;
}
export function togglePause(this: GameRenderApp): void {
  this.paused = !this.paused;
}
export function cycleSpeed(this: GameRenderApp): void {
  if (this.speedHeld()) return;
  this.speed = this.speed >= GameAppState.maxSpeed ? 1 : this.speed + 1;
  this.paused = false;
}
export function setSpeed(this: GameRenderApp, value: number): void {
  if (this.speedHeld() && value !== 1) return;
  if (!this.speedHeld()) this.speed = value;
  this.paused = false;
}
