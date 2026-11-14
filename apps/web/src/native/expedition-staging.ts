// The game speaking when a party member falls beyond a gate: the camera eases to them, the world holds for a beat
// under a flat veil that leaves the fallen in the light, and control comes back at once. The last fall dims the
// screen until the gate ends the expedition and the result screen opens. Presentation only: holding time just skips
// the town's advance for those frames, so the simulation sees the same steps it would have seen later.
import type { Shape } from '@thorvg/webcanvas';
import { Rect, type Context } from '../../../../packages/native-ui/src';
import { CombatCue } from '../../../../packages/engine/src/combat-events';
import { isPlayerResident } from '../../../../packages/engine/src/faction';
import { project, type Point } from '../../../../packages/engine/src/geometry';
import { clamp, f32 } from '../../../../packages/engine/src/numeric';
import { Order } from '../../../../packages/engine/src/game-tools';
import { realmRules } from '../../../../packages/engine/src/town-realm';
import type { Town } from '../../../../packages/engine/src/town';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { glideTo, stepGlide, type CameraGlide } from './camera-glide';
import { openExpeditionResult } from './expedition-result';
import type { GameAppState } from './game-app-state';

export const stagingRules = {
  /** Seconds of the camera's ease onto the fallen. */
  glide: 0.5,
  /** Seconds each emphasis lasts: a resident down, a resident dead, the last one standing. */
  down: 0.9,
  death: 1.4,
  last: 1.8,
  /** A fall this many seconds after the last emphasis only joins the banners; it starts no new one. */
  coalesce: 3,
  /** Seconds the veil takes to fade in and out. */
  fade: 0.25,
};
export enum Beat {
  Down,
  Death,
  /** The last one standing fell: a longer hold on them. */
  Last,
  /** After that hold, time runs again under a deepening dim until the gate ends the expedition. */
  Dim,
}
export interface StagedMoment {
  beat: Beat;
  /** Residents it is about, the one to look at last. */
  people: number[];
  names: string[];
  at: Point;
  start: number;
  until: number;
  /** The world is held still while it lasts. */
  held: boolean;
  /** Whether a party member was still alive when the last one fell. */
  survivors: boolean;
}
/** Per game app: the cues already heard, the moment on screen and its camera move. */
export class StagingState {
  town: object | null = null;
  heard = 0n;
  moment: StagedMoment | null = null;
  endedAt = -Infinity;
  glide: CameraGlide | null = null;
  /** Where the glide last put the camera, to notice the player taking it back. */
  placed: Point | null = null;
  /** The player's pause before the last fall, restored when the result screen closes. */
  previousPaused = false;
}
export interface StagingApp extends GameAppState {
  reducedMotion(): boolean;
  selectPeople(ids: readonly number[]): void;
}

const nextSerial = (town: Town): bigint => {
  let next = 0n;
  for (const e of town.combatEvents()) if (e.serial >= next) next = e.serial + 1n;
  return next;
};
/** The player is in the middle of giving an order: the camera stays theirs. */
export function steering(app: GameAppState): boolean {
  return (
    !!(app.panFrom || app.boxFrom || app.fieldFrom || app.roadPress || app.touchGesture || app.sceneDragAt || app.army.aim) ||
    app.roadStroke.length > 0 ||
    app.pan.x !== 0 ||
    app.pan.y !== 0 ||
    app.pending !== Order.None
  );
}
/** True while the world is held still for a moment. */
export function stagingHeld(app: GameAppState): boolean {
  return !!app.staging.moment?.held;
}
/** True while anything of the staging still moves on screen. */
export function stagingActive(app: GameAppState): boolean {
  return !!app.staging.moment || !!app.staging.glide;
}
export function glideStaging(app: GameAppState, at: Point, now: number, seconds = stagingRules.glide): void {
  app.staging.glide = glideTo(app.camera, at, now, seconds);
  app.staging.placed = { x: app.camera.x, y: app.camera.y };
}
function cue(app: GameAppState, which: Cue, gain: number): void {
  if (app.cues.length >= 32) return;
  const sound = new Sound(which);
  sound.gain = f32(gain);
  app.cues.push(sound);
}
interface Fall {
  id: number;
  name: string;
  at: Point;
  died: boolean;
}
function heardFalls(app: GameAppState): Fall[] {
  const s = app.staging,
    town = app.town,
    falls: Fall[] = [];
  for (const e of town.combatEvents()) {
    if (e.serial < s.heard) continue;
    s.heard = e.serial + 1n;
    if (!town.realmActive() || !town.inRealm(e.position) || e.person < 0) continue;
    if (e.cue === CombatCue.Downed) {
      const p = town.person(e.person);
      if (p && isPlayerResident(p)) falls.push({ id: p.id, name: p.name, at: { ...e.position }, died: false });
    } else if (e.cue === CombatCue.Death) {
      const fallen = town.fallen.find((f) => f.id === e.person);
      if (fallen) falls.push({ id: fallen.id, name: fallen.name, at: { ...e.position }, died: true });
    }
  }
  return falls;
}
function join(moment: StagedMoment, falls: Fall[]): void {
  for (const fall of falls)
    if (!moment.people.includes(fall.id)) {
      moment.people.push(fall.id);
      moment.names.push(fall.name);
    }
}
/** Once per frame, after the town has advanced and before notices are shown. */
export function stagingFrame(app: StagingApp, now: number): void {
  const s = app.staging,
    town = app.town;
  if (s.town !== town) {
    s.town = town;
    s.heard = nextSerial(town);
    s.moment = null;
    s.glide = null;
    s.endedAt = -Infinity;
  }
  if (town.isTitleAutoplay()) return;
  const reduced = app.reducedMotion();
  if (town.realmOutcome) {
    const outcome = town.realmOutcome,
      lastFall = !!s.moment && s.moment.beat >= Beat.Last;
    town.realmOutcome = null;
    s.heard = nextSerial(town);
    s.moment = null;
    s.glide = null;
    s.endedAt = now;
    openExpeditionResult(app, outcome, lastFall ? s.previousPaused : app.paused && !app.combatHud.autoPause);
    return;
  }
  const falls = heardFalls(app);
  if (falls.length) begin(app, falls, now, reduced);
  if (s.glide) {
    const camera = app.camera;
    // The player moved the view or began an order: the camera is theirs again.
    if ((s.placed && (camera.x !== s.placed.x || camera.y !== s.placed.y)) || steering(app)) s.glide = null;
    else {
      if (!stepGlide(camera, s.glide, now)) s.glide = null;
      s.placed = { x: camera.x, y: camera.y };
      app.hoveredWorldTarget = null;
      app.renderer.invalidatePresentation();
    }
  }
  const moment = s.moment;
  if (!moment) return;
  if (moment.beat === Beat.Dim) {
    // Someone stood up again (reinforcements came through): the expedition goes on.
    if (!town.realmActive() || town.realmStanding().length) {
      s.moment = null;
      s.endedAt = now;
      app.paused = s.previousPaused;
    }
    return;
  }
  if (now < moment.until) return;
  if (moment.beat === Beat.Last) {
    s.moment = { ...moment, beat: Beat.Dim, start: now, until: Infinity, held: false };
    // The gate needs the world's time to cast the party out.
    app.paused = false;
    app.combatHud.autoPause = null;
    return;
  }
  s.moment = null;
  s.endedAt = now;
}
function begin(app: StagingApp, falls: Fall[], now: number, reduced: boolean): void {
  const s = app.staging,
    town = app.town,
    lead = falls[falls.length - 1],
    current = s.moment;
  if (town.realmActive() && !town.realmStanding().length) {
    if (current && current.beat >= Beat.Last) return join(current, falls);
    s.previousPaused = app.paused && !app.combatHud.autoPause;
    s.moment = {
      beat: reduced ? Beat.Dim : Beat.Last,
      people: [],
      names: [],
      at: lead.at,
      start: now,
      until: reduced ? Infinity : now + stagingRules.last,
      held: !reduced,
      survivors: town.realmParty().length > 0,
    };
    join(s.moment, falls);
    app.combatHud.autoPause = null;
    if (reduced) app.paused = false;
    else glideStaging(app, lead.at, now);
    cue(app, Cue.Fall, 0.7);
    return;
  }
  // Falls close together make one emphasis; the banners already list the rest.
  if (current) return join(current, falls);
  if (reduced || now - s.endedAt < stagingRules.coalesce) return;
  const died = falls.some((fall) => fall.died);
  s.moment = {
    beat: died ? Beat.Death : Beat.Down,
    people: [],
    names: [],
    at: lead.at,
    start: now,
    until: now + (died ? stagingRules.death : stagingRules.down),
    // A fall is already held by the combat auto-pause; a death holds the world for its beat.
    held: died,
    survivors: true,
  };
  join(s.moment, falls);
  if (died) cue(app, Cue.Fall, 0.6);
  if (!steering(app)) glideStaging(app, lead.at, now);
}

// ---------------------------------------------------------------- drawing

const shade = { r: 13, g: 16, b: 18 };
/** The flat veil over the world, a clear oval left around the fallen; drawn under the HUD. */
export function stagingVeil(app: StagingApp, width: number, height: number): void {
  const moment = app.staging.moment;
  if (!moment || app.reducedMotion()) return;
  const c = app.context,
    now = c.time(),
    t = Math.max(0, now - moment.start),
    peak = moment.beat === Beat.Down ? 105 : moment.beat === Beat.Death ? 135 : 150;
  let alpha: number,
    open = 1;
  if (moment.beat === Beat.Dim) {
    const k = clamp(t / (realmRules.castOutDelay + 0.3), 0, 1);
    alpha = peak + (225 - peak) * k;
    open = 1 - k;
  } else alpha = peak * Math.min(clamp(t / stagingRules.fade, 0, 1), clamp((moment.until - now) / stagingRules.fade, 0, 1));
  c.requestAnimationFrame();
  if (alpha < 2) return;
  const lead = app.town.person(moment.people[moment.people.length - 1] ?? -1),
    at = lead && lead.health > -1 ? lead.position : moment.at,
    zoom = app.camera.zoom,
    screen = app.camera.toScreen(project(at.x, at.y), width, height),
    rx = f32(clamp(64 * zoom, 52, 170) * open),
    ry = f32(rx * 0.82),
    cx = Math.round(screen.x),
    cy = Math.round(f32(screen.y - 12 * zoom)),
    a = Math.round(alpha),
    band = 1.32;
  veilShape(c, ['staging-veil', width, height, cx, cy, Math.round(rx * band), Math.round(ry * band), a], width, height, (shape) => {
    if (rx > 1) shape.appendCircle(cx, cy, f32(rx * band), f32(ry * band));
  });
  // The second, lighter tone rings the clear oval: two flat steps, no gradient.
  if (rx > 1)
    veilShape(c, ['staging-ring', cx, cy, Math.round(rx), Math.round(ry), a], 0, 0, (shape) => {
      shape.appendCircle(cx, cy, f32(rx * band), f32(ry * band));
      shape.appendCircle(cx, cy, rx, ry);
    }, Math.round(a * 0.45));
}
function veilShape(
  c: Context,
  key: unknown[],
  width: number,
  height: number,
  hole: (shape: Shape) => void,
  alpha = Number(key[key.length - 1]),
): void {
  c.paint(JSON.stringify(key), () => {
    const shape = new c.tvg.Shape();
    if (width > 0) shape.appendRect(0, 0, width, height);
    hole(shape);
    shape.fillRule(c.tvg.FillRule.EvenOdd);
    shape.fill(shade.r, shade.g, shade.b, alpha);
    return shape;
  });
}
export function deathTitle(names: string[]): string {
  return names.length === 1
    ? `${names[0]} has died`
    : names.length === 2
      ? `${names[0]} and ${names[1]} have died`
      : `${names.length} residents have died`;
}
/** The moment's banner, in the combat banners' column; a plain fall is already named by the auto-pause banner. */
export function stagingBanner(
  app: StagingApp,
  x: number,
  w: number,
  y: number,
  downedTitle: (names: string[]) => string,
  wrap: (text: string, width: number) => string[],
): number {
  const moment = app.staging.moment;
  if (!moment || (moment.beat === Beat.Down && app.combatHud.autoPause)) return y;
  const c = app.context,
    t = app.theme,
    last = moment.beat >= Beat.Last,
    // The fallen may bleed out while the gate waits: say so as it happens.
    survivors = app.town.realmActive() ? app.town.realmParty().length > 0 : moment.survivors,
    title = moment.beat === Beat.Death || (last && !survivors) ? deathTitle(moment.names) : downedTitle(moment.names),
    detail = last
      ? wrap(survivors ? 'No one is left standing. The gate casts the party out.' : 'No one is left alive beyond the gate.', f32(w - 24))
      : [],
    h = 34 + detail.length * 15,
    r = new Rect(x, y, w, h);
  c.control('staging-banner', r, undefined, true, false);
  c.rect(r, t.surface, t.radius, t.danger, 2);
  c.text(new Rect(f32(x + 12), f32(y + 6), f32(w - 24), 20), c.elideText(title, f32(w - 24), 14, true), t.danger, 14, true);
  detail.forEach((row, i) => c.text(new Rect(f32(x + 12), f32(y + 28 + i * 15), f32(w - 24), 15), row, t.text, 11));
  return f32(y + h + 6);
}
