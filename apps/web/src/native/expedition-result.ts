// The result screen at the end of an expedition: how it ended, what the party did, who came back and in what
// state, the spoils and what the floor opened. The settlement waits behind it; closing it eases the view home.
import { Rect, Align, ButtonStyle, button, rgba, type Color } from '../../../../packages/native-ui/src';
import { callingName, type Person } from '../../../../packages/engine/src/person';
import { describe } from '../../../../packages/engine/src/building-catalog';
import { f32 } from '../../../../packages/engine/src/numeric';
import { project } from '../../../../packages/engine/src/geometry';
import { Mood } from '../../../../packages/engine/src/person-look';
import {
  ExpeditionEnd,
  MemberState,
  type ExpeditionResult,
  type MemberOutcome,
} from '../../../../packages/engine/src/expedition-record';
import type { Town } from '../../../../packages/engine/src/town';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { fallenPerson, wrapText } from './game-combat-hud';
import { glideStaging } from './expedition-staging';
import { hudPaint } from './hud-paint';
import type { AppEvent } from './application-contracts';
import type { GameAppState } from './game-app-state';

export interface ExpeditionResultWindow {
  town: Town;
  outcome: ExpeditionResult;
  /** The player's pause before the expedition ended, restored on closing. */
  previousPaused: boolean;
  pointer: { x: number; y: number };
}
export interface ResultApp extends GameAppState {
  reducedMotion(): boolean;
  selectPeople(ids: readonly number[]): void;
}
/** Seconds of the camera's ease home after the screen closes, and where it starts from, in tiles off the gate. */
export const homeGlide = 0.9;
const homeOffset = { x: 3, y: -2.5 };

const lost = (end: ExpeditionEnd) => end === ExpeditionEnd.CastOut || end === ExpeditionEnd.Lost;
export function resultTitle(outcome: ExpeditionResult): string {
  switch (outcome.end) {
    case ExpeditionEnd.Cleared:
      return `Floor ${outcome.floor + 1} cleared`;
    case ExpeditionEnd.Sealed:
      return `${outcome.world} is sealed`;
    case ExpeditionEnd.Withdrew:
      return 'The party withdrew';
    case ExpeditionEnd.CastOut:
      return 'Thrown back through the gate';
    case ExpeditionEnd.Lost:
      return 'No one came back';
  }
}
/** The plain line under the title, then what was lost with the party. */
export function resultLines(outcome: ExpeditionResult): string[] {
  const lines = [
    [
      'The floor is cleared.',
      'The gate is sealed for good.',
      'The party came home before the floor was cleared.',
      'You barely made it out of the gate.',
      'The whole party fell beyond the gate.',
    ][outcome.end],
  ];
  if (lost(outcome.end)) lines.push(outcome.spoils.empty() ? 'Nothing was carried out.' : 'The spoils were lost.');
  return lines;
}
function duration(seconds: number): string {
  if (seconds < 60) return 'Beyond the gate for less than a minute';
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'Beyond the gate for a minute' : `Beyond the gate for ${minutes} minutes`;
}
/** What the party did: the clock, the dens, the guardian, the slain and the spoils. Unknown counts are left out. */
export function resultDeeds(outcome: ExpeditionResult): string[] {
  const lines: string[] = [];
  if (outcome.seconds >= 0) lines.push(duration(outcome.seconds));
  if (outcome.dens > 0) lines.push(`Dens destroyed: ${outcome.densDestroyed} of ${outcome.dens}`);
  lines.push(outcome.guardianFell ? 'The guardian fell' : 'The guardian still stands');
  if (outcome.slain >= 0) lines.push(`Monsters slain: ${outcome.slain}`);
  if (outcome.spoilsKept)
    lines.push(outcome.spoils.empty() ? 'Came home empty-handed' : `Spoils brought home: ${describe(outcome.spoils)}`);
  else if (!outcome.spoils.empty()) lines.push(`Spoils lost: ${describe(outcome.spoils)}`);
  if (outcome.seconds < 0) lines.push('The time, the slain and the levels gained are not known across a load.');
  return lines;
}
export function memberLine(member: MemberOutcome): string {
  const gained = member.gained > 0 ? `  ·  ${member.gained === 1 ? '1 level gained' : `${member.gained} levels gained`}` : '';
  return `${callingName(member.calling)}  ·  Level ${member.level}${gained}`;
}
export function memberState(member: MemberOutcome): string {
  switch (member.state) {
    case MemberState.Unhurt:
      return 'Unhurt';
    case MemberState.Wounded:
      return `Wounded: heals in ${member.woundDays} ${member.woundDays === 1 ? 'day' : 'days'}`;
    case MemberState.Down:
      return 'Down: an ally must kneel beside them';
    case MemberState.Fallen:
      return `Fallen: ${member.cause}`;
  }
}
/** Every line the screen shows, in order, for tests and the browser check. */
export function resultText(outcome: ExpeditionResult): string[] {
  return [
    resultTitle(outcome),
    ...resultLines(outcome),
    ...resultDeeds(outcome),
    ...outcome.rewards,
    ...outcome.members.flatMap((m) => [m.name, memberLine(m), memberState(m)]),
  ];
}
/** The notices the screen speaks for; they are not also toasted. */
function spokenFor(text: string, outcome: ExpeditionResult): boolean {
  return (
    text.startsWith('The party returns from ') ||
    text.startsWith('The party withdraws from ') ||
    text === `${outcome.site} casts the fallen party back out, gravely wounded; the spoils are lost` ||
    text === `No one returned from ${outcome.site}`
  );
}
export function openExpeditionResult(app: GameAppState, outcome: ExpeditionResult, previousPaused: boolean): void {
  app.expeditionResult = {
    town: app.town,
    outcome,
    previousPaused,
    pointer: { x: app.mouse.x, y: app.mouse.y },
  };
  app.paused = true;
  app.combatHud.autoPause = null;
  app.army.banners = [];
  // The world beyond is already sunk: behind the screen the view cuts to just short of the gate, so closing it is a
  // short ease onto the party instead of a flight over empty sea.
  const near = project(outcome.home.x + homeOffset.x, outcome.home.y + homeOffset.y);
  app.camera.x = near.x;
  app.camera.y = near.y;
  app.renderer.invalidatePresentation();
  app.pan.x = app.pan.y = 0;
  app.hoveredWorldTarget = null;
  app.context.cancelPointer();
  // The floor's reward lines are on the screen; its banner would only repeat them.
  app.town.realmReward = null;
  app.town.notices = app.town.notices.filter((text) => !spokenFor(text, outcome));
  if (app.cues.length < 32) {
    const sound = new Sound(lost(outcome.end) ? Cue.WaveHorn : Cue.Notice);
    sound.gain = f32(0.7);
    app.cues.push(sound);
  }
}
/** Back to Midgard: the pause as it was, the survivors selected, and the view easing to the gate they came out of. */
export function closeExpeditionResult(app: ResultApp): void {
  const state = app.expeditionResult;
  if (!state) return;
  app.expeditionResult = null;
  app.paused = state.previousPaused;
  const home = state.outcome.home,
    now = app.context.time();
  glideStaging(app, home, now, app.reducedMotion() ? 0 : homeGlide);
  const back = state.outcome.members
    .filter((m) => m.state !== MemberState.Fallen)
    .map((m) => m.id)
    .filter((id) => !!app.town.person(id));
  if (back.length) app.selectPeople(back);
}
/** Consumes the whole input stream while open; Enter and Escape return to Midgard. */
export function handleResultEvent(this: ResultApp, event: AppEvent): boolean {
  const state = this.expeditionResult;
  if (!state) return false;
  const c = this.context;
  if (event.type === 'PointerMove') {
    state.pointer = { x: event.x, y: event.y };
    c.pointerMove(event.x, event.y);
  } else if (event.type === 'PointerDown' && event.button === 1) {
    state.pointer = { x: event.x, y: event.y };
    c.pointerDown(event.x, event.y);
  } else if (event.type === 'PointerUp' && event.button === 1) {
    c.pointerUp(event.x, event.y);
    if (event.pointerType === 'touch') {
      state.pointer = { x: -1, y: -1 };
      c.setPointerPosition(-1, -1);
    }
  } else if (event.type === 'PointerCancel') c.cancelPointer();
  else if (event.type === 'KeyDown') {
    if (event.text === 'return' || event.text === 'escape') closeExpeditionResult(this);
    else c.key(event.key, event.shift);
  }
  return true;
}

// ---------------------------------------------------------------- drawing

const veil = rgba(6, 10, 13, 200);
function portrait(app: GameAppState, member: MemberOutcome, home: { x: number; y: number }, r: Rect): void {
  const c = app.context,
    living = app.town.person(member.id),
    body: Person | null = member.fallen ? fallenPerson(member.fallen) : living,
    mood = member.fallen ? Mood.Asleep : living ? moodOf(living) : Mood.Content;
  c.rect(r, app.theme.raised, 3);
  if (!body) return;
  c.paint(JSON.stringify(['result-face', body.id, body.look, body.race, String(body.lookRevision), body.calling, mood, r]), () => {
    const paint = hudPaint(c, personPortrait(body, mood, r.w, r.h, portraitBackdrop(app.town.map(), home, app.town.climate())));
    paint.translate(r.x, r.y);
    return paint;
  });
  if (member.fallen) c.rect(r, rgba(20, 22, 20, 110), 3);
}
function stateColor(app: GameAppState, member: MemberOutcome): Color {
  const t = app.theme;
  return member.state === MemberState.Unhurt
    ? t.success
    : member.state === MemberState.Wounded
      ? t.accent
      : t.danger;
}
/** The screen itself, over the dimmed world; the settlement's HUD is not drawn meanwhile. */
export function renderExpeditionResult(this: ResultApp, width: number, height: number): void {
  const state = this.expeditionResult;
  if (!state) return;
  if (state.town !== this.town) {
    this.expeditionResult = null;
    this.paused = state.previousPaused;
    return;
  }
  const c = this.context,
    t = this.theme,
    outcome = state.outcome,
    touch = this.touchMode;
  c.setPointerPosition(state.pointer.x, state.pointer.y);
  c.modal('expedition-result-close', () => closeExpeditionResult(this));
  c.control('expedition-result-backdrop', new Rect(0, 0, width, height), undefined, true, false);
  c.rect(new Rect(0, 0, width, height), veil);
  const w = Math.min(640, f32(width - 16)),
    wide = w >= 560,
    pad = wide ? 22 : 14,
    inner = f32(w - pad * 2),
    buttonH = touch ? 44 : 34,
    rowH = 50,
    columns = wide ? 2 : 1,
    colW = f32((inner - (columns - 1) * 10) / columns),
    tone = lost(outcome.end) ? t.danger : outcome.end === ExpeditionEnd.Withdrew ? t.accent : t.success,
    lines = resultLines(outcome).flatMap((line, i) => wrapText(c, line, inner, i ? 12 : 13, 2, !i).map((row) => ({ row, first: i === 0 }))),
    deeds = resultDeeds(outcome).flatMap((line) => wrapText(c, line, colW, 11, 2)),
    rewards = outcome.rewards.flatMap((line) => wrapText(c, line, inner, 11, 2)),
    header = 74 + lines.length * 18,
    deedRows = wide ? Math.ceil(deeds.length / 2) : deeds.length,
    deedsH = deedRows * 17 + 10,
    rewardsH = rewards.length ? rewards.length * 17 + 10 : 0,
    footer = buttonH + 26,
    fixed = header + deedsH + rewardsH + 26 + footer,
    roomRows = Math.max(1, Math.floor((height - 16 - fixed) / (rowH + 6))),
    memberRows = Math.ceil(outcome.members.length / columns),
    shownRows = Math.min(memberRows, roomRows),
    h = Math.min(f32(height - 16), fixed + shownRows * (rowH + 6)),
    panel = new Rect(f32(f32(width - w) / 2), f32(f32(height - h) / 2), w, h);
  c.control('expedition-result-panel', panel, undefined, true, false);
  c.rect(panel, t.surface, 6, tone, 2);
  let y = f32(panel.y + 14);
  c.text(new Rect(f32(panel.x + pad), y, inner, 28), c.elideText(resultTitle(outcome), inner, 20, true), tone, 20, true, Align.Center);
  y = f32(y + 30);
  c.text(
    new Rect(f32(panel.x + pad), y, inner, 16),
    c.elideText(`${outcome.site}  ·  ${outcome.world}  ·  Floor ${outcome.floor + 1} of ${outcome.floors}`, inner, 11),
    t.muted,
    11,
    false,
    Align.Center,
  );
  y = f32(y + 24);
  for (const { row, first } of lines) {
    c.text(new Rect(f32(panel.x + pad), y, inner, 18), row, first ? t.text : t.danger, first ? 13 : 12, first, Align.Center);
    y = f32(y + 18);
  }
  y = f32(y + 6);
  c.line(f32(panel.x + pad), y, f32(panel.x + w - pad), y, t.border, 1);
  y = f32(y + 8);
  deeds.forEach((row, i) => {
    const column = wide ? i % 2 : 0,
      line = wide ? Math.floor(i / 2) : i;
    c.text(new Rect(f32(panel.x + pad + column * (colW + 10)), f32(y + line * 17), colW, 17), row, t.text, 11);
  });
  y = f32(y + deedRows * 17 + 6);
  for (const row of rewards) {
    c.text(new Rect(f32(panel.x + pad), y, inner, 17), row, t.accent, 11, true);
    y = f32(y + 17);
  }
  if (rewards.length) y = f32(y + 6);
  c.line(f32(panel.x + pad), y, f32(panel.x + w - pad), y, t.border, 1);
  y = f32(y + 10);
  outcome.members.slice(0, shownRows * columns).forEach((member, i) => {
    const r = new Rect(
      f32(panel.x + pad + (i % columns) * (colW + 10)),
      f32(y + Math.floor(i / columns) * (rowH + 6)),
      colW,
      rowH,
    );
    c.rect(r, t.raised, 4);
    const face = new Rect(f32(r.x + 5), f32(r.y + 4), 36, f32(rowH - 8));
    portrait(this, member, outcome.home, face);
    const left = f32(face.x + face.w + 9),
      textW = f32(r.x + r.w - left - 8);
    c.text(new Rect(left, f32(r.y + 3), textW, 16), c.elideText(member.name, textW, 12, true), t.text, 12, true);
    c.text(new Rect(left, f32(r.y + 18), textW, 14), c.elideText(memberLine(member), textW, 10), t.muted, 10);
    c.text(new Rect(left, f32(r.y + 32), textW, 14), c.elideText(memberState(member), textW, 10, true), stateColor(this, member), 10, true);
  });
  const hidden = outcome.members.length - shownRows * columns;
  if (hidden > 0)
    c.text(new Rect(f32(panel.x + pad), f32(panel.y + h - buttonH - 34), inner, 14), `+${hidden} more`, t.muted, 10, false, Align.Center);
  const bw = Math.min(inner, 240),
    back = new Rect(f32(panel.x + f32((w - bw) / 2)), f32(panel.y + h - buttonH - 14), bw, buttonH);
  button(c, 'expedition-result-close', back, touch ? 'Return to Midgard' : 'Return to Midgard (Enter)', () => closeExpeditionResult(this), ButtonStyle.Primary);
}
