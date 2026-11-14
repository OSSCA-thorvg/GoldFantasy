// The expedition window: the one way a party is sent through a gate. It names the gate and the world behind it,
// offers the open floors and the forecast, and lets the player choose who goes; the settlement waits meanwhile.
import { Rect, Align, ButtonStyle, EventType, Key, button, rgba, type Color, type Context } from '../../../../packages/native-ui/src';
import { Activity, callingName, type Person } from '../../../../packages/engine/src/person';
import { canControl, controlReason, isPlayerResident } from '../../../../packages/engine/src/faction';
import { gateSealed, sealable, sealFloors } from '../../../../packages/engine/src/gate-seals';
import { worldName } from '../../../../packages/engine/src/world-map';
import { DungeonKind } from '../../../../packages/engine/src/world-types';
import { skillOfCalling } from '../../../../packages/engine/src/skill-catalog';
import { combatItem } from '../../../../packages/engine/src/equipment';
import { clamp, f32 } from '../../../../packages/engine/src/numeric';
import type { Town } from '../../../../packages/engine/src/town';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { Cue, Sound } from '../../../../packages/native-audio/src/sound-types';
import { floorForecast, floorLevel, partyVerdict, Verdict } from './swarm-hud';
import { groupMembers } from './control-groups';
import { wrapText } from './game-combat-hud';
import { hudPaint } from './hud-paint';
import type { AppEvent } from './application-contracts';
import type { GameAppState } from './game-app-state';

export interface ExpeditionWindow {
  town: Town;
  gate: number;
  floor: number;
  /** Chosen residents in the order they were picked. */
  party: number[];
  /** The selection the window was opened with, for its quick pick. */
  selection: number[];
  previousPaused: boolean;
  /** First roster row shown. */
  scroll: number;
  pointer: { x: number; y: number };
}
export interface ExpeditionApp extends GameAppState {
  selectPeople(ids: readonly number[]): void;
}
export const gateKindName = (kind: DungeonKind): string =>
  ['Cave', 'Crypt', 'Rift portal', 'Ruined tower', 'Coastal giant hall', 'Rift'][kind] ?? '';
const fighting = (p: Person): boolean => !!skillOfCalling(p.calling, 0);
const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;
/** Why a resident cannot join a party now; empty when they can. */
export function staysBehind(town: Town, p: Person): string {
  if (p.downedAt >= 0) return 'Downed: must be raised first';
  if (town.inRealm(p.position)) return 'Beyond a gate already';
  if (p.activity === Activity.Expedition) return 'On the way to a gate';
  if (p.woundDays > 0) return `Wounded: heals in ${days(Math.ceil(p.woundDays))}`;
  if (p.stressRecovery) return 'Overwhelmed: resting until calm';
  return canControl(p) ? '' : controlReason(p) || 'This resident is unavailable.';
}
/** The player's residents on this side of the gates, fighters first, then by level. */
export function expeditionRoster(town: Town): Person[] {
  return town
    .people()
    .filter((p) => isPlayerResident(p))
    .sort((a, b) => Number(fighting(b)) - Number(fighting(a)) || b.level - a.level || a.id - b.id);
}
/** Why nobody can be sent through this gate at all; empty while the window can send a party. */
export function gateLock(town: Town, gate: number): string {
  const site = town.map().dungeons()[gate];
  if (!site) return 'No known dungeon there';
  if (!site.discovered) return 'This gate is not yet explored';
  if (gateSealed(town, gate)) return 'Sealed: no raid leaves this gate and no party goes through it';
  return town.expeditionProblem(gate, joining(town, gate) ? town.realmFloor : town.deepestOpenFloor(gate));
}
/** True while a party fights beyond this very gate: those sent now join it on its floor. */
const joining = (town: Town, gate: number): boolean => town.realmGate === gate && town.realmActive();
const members = (state: ExpeditionWindow): Person[] =>
  state.party.map((id) => state.town.person(id)).filter((p): p is Person => !!p);

export function openExpedition(app: GameAppState, gate: number, chosen: readonly number[] = []): boolean {
  const town = app.town,
    site = town.map().dungeons()[gate];
  if (!site || !sealable(site) || app.prayer) return false;
  const able = (id: number) => {
      const p = town.person(id);
      return !!p && isPlayerResident(p) && !staysBehind(town, p);
    },
    ready = [...new Set(chosen)].filter(able),
    open = town.deepestOpenFloor(gate);
  if (app.expedition) closeExpedition(app);
  app.expedition = {
    town,
    gate,
    floor: joining(town, gate) ? town.realmFloor : Math.min(app.gateFloor.get(gate) ?? open, open),
    party: ready,
    selection: ready,
    previousPaused: app.paused,
    scroll: 0,
    pointer: { x: app.mouse.x, y: app.mouse.y },
  };
  app.paused = true;
  app.pan.x = app.pan.y = 0;
  app.hoveredWorldTarget = null;
  app.context.cancelPointer();
  return true;
}
export function closeExpedition(app: GameAppState): void {
  const state = app.expedition;
  if (!state) return;
  app.expedition = null;
  app.paused = state.previousPaused;
}
/** Why the chosen party cannot set out; empty when it can. */
export function setOutProblem(app: GameAppState): string {
  const state = app.expedition;
  if (!state) return '';
  const lock = gateLock(state.town, state.gate);
  if (lock) return lock;
  if (!state.party.length) return 'Choose who goes';
  return state.town.canSendExpedition(state.party, state.gate, state.floor).reason;
}
/** Sends the chosen party; they walk to the gate and step in as before, and can be called back until then. */
export function setOut(app: ExpeditionApp): boolean {
  const state = app.expedition;
  if (!state || setOutProblem(app)) return false;
  const party = [...state.party];
  if (!state.town.sendExpedition(party, state.gate, state.floor)) return false;
  app.gateFloor.set(state.gate, state.floor);
  closeExpedition(app);
  app.selectPeople(party.filter((id) => state.town.person(id)?.activity === Activity.Expedition));
  app.status = '';
  if (app.cues.length < 32) app.cues.push(new Sound(Cue.Order));
  return true;
}
export function toggleMember(app: GameAppState, id: number): void {
  const state = app.expedition,
    p = state?.town.person(id);
  if (!state || !p || staysBehind(state.town, p)) return;
  state.party = state.party.includes(id) ? state.party.filter((other) => other !== id) : [...state.party, id];
}
export function pickParty(app: GameAppState, ids: readonly number[]): void {
  const state = app.expedition;
  if (!state) return;
  state.party = ids.filter((id) => {
    const p = state.town.person(id);
    return !!p && isPlayerResident(p) && !staysBehind(state.town, p);
  });
}
/** The quick picks that would choose someone: label and the residents it picks. */
export function quickPicks(app: GameAppState): { id: string; label: string; ids: number[] }[] {
  const state = app.expedition;
  if (!state) return [];
  const able = expeditionRoster(state.town).filter((p) => !staysBehind(state.town, p)),
    picks = [{ id: 'fighters', label: 'All fighters', ids: able.filter(fighting).map((p) => p.id) }];
  const selected = state.selection.filter((id) => able.some((p) => p.id === id));
  if (selected.length) picks.push({ id: 'selected', label: `Selected (${selected.length})`, ids: selected });
  for (let digit = 1; digit <= 9; ++digit) {
    const ids = groupMembers(app, digit)
      .filter((p) => able.includes(p))
      .map((p) => p.id);
    if (ids.length) picks.push({ id: `group-${digit}`, label: `Group ${digit}`, ids });
  }
  return picks;
}

/** Consumes the whole input stream while open: map orders and shortcuts cannot reach the settlement behind it. */
export function handleExpeditionEvent(this: ExpeditionApp, event: AppEvent): boolean {
  const state = this.expedition;
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
    // Touch has no hover: a finger lifted leaves no highlighted row behind.
    if (event.pointerType === 'touch') {
      state.pointer = { x: -1, y: -1 };
      c.setPointerPosition(-1, -1);
      c.focus('');
    }
  } else if (event.type === 'PointerCancel') c.cancelPointer();
  else if (event.type === 'Wheel') c.wheel(event.delta);
  else if (event.type === 'KeyDown') {
    if (event.text === 'return') setOut(this);
    else c.key(event.key, event.shift);
  }
  return true;
}

// ---------------------------------------------------------------- drawing

const veil = rgba(6, 10, 13, 200);
function tick(c: Context, x: number, y: number, color: Color): void {
  c.line(x, f32(y + 4), f32(x + 3), f32(y + 7), color, 2);
  c.line(f32(x + 3), f32(y + 7), f32(x + 9), y, color, 2);
}
function portrait(app: GameAppState, p: Person, r: Rect): void {
  const c = app.context;
  c.rect(r, app.theme.raised, 3);
  c.paint(JSON.stringify(['expedition-face', p.id, p.look, p.race, String(p.lookRevision), p.calling, moodOf(p), r]), () => {
    const paint = hudPaint(
      c,
      personPortrait(p, moodOf(p), r.w, r.h, portraitBackdrop(app.town.map(), p.position, app.town.climate())),
    );
    paint.translate(r.x, r.y);
    return paint;
  });
}
/** One resident: tap or click to take them along or leave them; those who cannot go say why instead. */
function memberRow(app: GameAppState, p: Person, r: Rect): void {
  const c = app.context,
    t = app.theme,
    state = app.expedition!,
    reason = staysBehind(state.town, p),
    chosen = state.party.includes(p.id),
    usable = !reason;
  button(c, `expedition-member-${p.id}`, r, '', () => toggleMember(app, p.id), ButtonStyle.Quiet, usable, undefined, chosen, {
    border: chosen ? t.accent : t.border,
    borderWidth: chosen ? 2 : 1,
  });
  const middle = f32(r.y + f32(r.h / 2)),
    box = new Rect(f32(r.x + 10), f32(middle - 9), 18, 18);
  if (usable) {
    c.rect(box, chosen ? t.accent : t.surface, 3, chosen ? t.accent : t.muted, 1.5);
    if (chosen) tick(c, f32(box.x + 4), f32(box.y + 5), t.accentText);
  }
  const face = new Rect(f32(r.x + 36), f32(r.y + 4), f32(Math.min(40, r.h - 8) * 0.85), f32(r.h - 8));
  portrait(app, p, face);
  if (!usable) c.rect(face, rgba(20, 22, 20, 120), 3);
  const left = f32(face.x + face.w + 10),
    barW = r.w >= 420 ? 92 : 58,
    textW = f32(r.x + r.w - left - barW - 18),
    ink = usable ? t.text : t.muted;
  c.text(new Rect(left, f32(r.y + 5), textW, 18), c.elideText(p.name, textW, 12, true), ink, 12, true);
  const held = combatItem(p)?.name ?? 'Bare hands',
    second = reason || `${callingName(p.calling)}  ·  Lv ${p.level}  ·  ${held}`;
  c.text(
    new Rect(left, f32(r.y + 24), textW, 16),
    c.elideText(second, textW, 10),
    reason ? t.danger : t.muted,
    10,
  );
  const bar = new Rect(f32(r.x + r.w - barW - 10), f32(middle + 2), barW, 5),
    health = clamp(p.health, 0, 1);
  c.text(new Rect(bar.x, f32(middle - 15), barW, 14), `${Math.round(health * 100)}%`, health < 0.3 ? t.danger : t.muted, 10, false, Align.End);
  c.rect(bar, t.raised, 2);
  c.rect(new Rect(bar.x, bar.y, Math.max(2, f32(bar.w * health)), bar.h), health < 0.3 ? t.danger : t.success, 2);
}
function floorRow(app: GameAppState, r: Rect, locked: boolean): void {
  const c = app.context,
    t = app.theme,
    state = app.expedition!,
    town = state.town,
    cleared = town.gateFloors(state.gate).cleared,
    fixed = joining(town, state.gate),
    span = f32(f32(r.w - 8 * (sealFloors - 1)) / sealFloors);
  for (let floor = 0; floor < sealFloors; ++floor) {
    const b = new Rect(f32(r.x + (span + 8) * floor), r.y, span, r.h),
      open = !locked && !fixed && town.floorOpen(state.gate, floor);
    button(
      c,
      `expedition-floor-${floor}`,
      b,
      `Floor ${floor + 1}`,
      () => (state.floor = floor),
      ButtonStyle.Default,
      open || floor === state.floor,
      undefined,
      floor === state.floor,
    );
    if (floor < cleared) tick(c, f32(b.x + 8), f32(b.y + f32(b.h / 2) - 4), t.success);
  }
}

/** The window itself, drawn over the dimmed settlement; the settlement's own HUD is not drawn meanwhile. */
export function renderExpedition(this: ExpeditionApp, width: number, height: number): void {
  const state = this.expedition;
  if (!state) return;
  if (state.town !== this.town) {
    closeExpedition(this);
    return;
  }
  const c = this.context,
    t = this.theme,
    town = state.town,
    site = town.map().dungeons()[state.gate];
  if (!site) {
    closeExpedition(this);
    return;
  }
  state.party = state.party.filter((id) => {
    const p = town.person(id);
    return !!p && !staysBehind(town, p);
  });
  if (!joining(town, state.gate) && !town.floorOpen(state.gate, state.floor))
    state.floor = town.deepestOpenFloor(state.gate);
  c.setPointerPosition(state.pointer.x, state.pointer.y);
  c.modal('expedition-set-out', () => closeExpedition(this));
  c.control(
    'expedition-backdrop',
    new Rect(0, 0, width, height),
    (event) => {
      if (event.type === EventType.Activate) closeExpedition(this);
    },
    true,
    false,
  );
  c.rect(new Rect(0, 0, width, height), veil);
  const touch = this.touchMode,
    w = Math.min(860, f32(width - 16)),
    h = Math.min(width >= 640 ? 660 : 860, f32(height - 16)),
    panel = new Rect(f32(f32(width - w) / 2), f32(f32(height - h) / 2), w, h),
    wide = w >= 640,
    pad = wide ? 18 : 12,
    buttonH = touch ? 44 : 32,
    rowH = touch ? 52 : 46,
    lock = gateLock(town, state.gate),
    locked = !!lock,
    fixed = joining(town, state.gate);
  c.control('expedition-panel', panel, undefined, true, false);
  c.rect(panel, t.surface, 6, t.border, 1.5);
  const world = worldName(town.map().destination(site));
  c.text(new Rect(f32(panel.x + pad), f32(panel.y + 10), f32(w - pad * 2 - 56), 26), c.elideText(site.name, f32(w - pad * 2 - 56), 18, true), t.text, 18, true);
  c.text(
    new Rect(f32(panel.x + pad), f32(panel.y + 36), f32(w - pad * 2 - 56), 16),
    c.elideText(`${gateKindName(site.kind)}  -  a way to ${world}`, f32(w - pad * 2 - 56), 11),
    t.accent,
    11,
  );
  button(
    c,
    'expedition-close',
    new Rect(f32(panel.x + w - pad - 44 + 6), f32(panel.y + 8), touch ? 44 : 36, touch ? 44 : 36),
    '×',
    () => closeExpedition(this),
    ButtonStyle.Quiet,
  );
  const header = 60,
    footer = (wide ? 58 : 64) + buttonH,
    body = new Rect(f32(panel.x + pad), f32(panel.y + header), f32(w - pad * 2), f32(h - header - footer)),
    infoW = wide ? f32(Math.min(340, body.w * 0.42)) : body.w;
  // Gate, floors and forecast: the left column, or the top of a phone's one column.
  let y = body.y;
  const info = (text: string, color: Color, size = 11, bold = false, lines = 3) => {
    for (const row of wrapText(c, text, infoW, size, lines, bold)) {
      c.text(new Rect(body.x, y, infoW, size + 5), row, color, size, bold);
      y = f32(y + size + 4);
    }
  };
  const floors = town.gateFloors(state.gate);
  info(
    fixed
      ? `A party fights beyond this gate on floor ${town.realmFloor + 1}; those you send now join it.`
      : `Floors cleared: ${floors.cleared} of ${floors.total}`,
    fixed ? t.accent : t.text,
    11,
    true,
    2,
  );
  y = f32(y + 4);
  floorRow(this, new Rect(body.x, y, infoW, buttonH), locked);
  y = f32(y + buttonH + 10);
  const party = members(state),
    forecast = locked ? [] : floorForecast(this, state.gate, state.floor, party);
  if (!locked) {
    info(forecast[0] ?? '', t.text, 11, false, wide ? 3 : 2);
    info(forecast[1] ?? '', t.muted, 11, false, 2);
  }
  // The roster: the right column, or below on a phone.
  const list = wide
    ? new Rect(f32(body.x + infoW + pad), body.y, f32(body.w - infoW - pad), body.h)
    : new Rect(body.x, f32(y + 8), body.w, f32(body.y + body.h - y - 8));
  if (locked) {
    c.rect(list, t.raised, 4);
    // A sealed gate is a victory, not a fault.
    const sealed = gateSealed(town, state.gate),
      rows = wrapText(c, lock, f32(list.w - 32), 13, 4, true);
    rows.forEach((row, i) =>
      c.text(new Rect(f32(list.x + 16), f32(list.y + 18 + i * 19), f32(list.w - 32), 18), row, sealed ? t.success : t.danger, 13, true),
    );
  } else rosterList(this, list, buttonH, rowH);
  // The verdict for the chosen party, and the one button that sends it.
  const bottom = f32(panel.y + h - footer + 8),
    verdict = party.length ? forecast[2] ?? '' : '',
    problem = setOutProblem(this),
    average = party.length ? Math.round(party.reduce((s, p) => s + p.level, 0) / party.length) : 0,
    grade = party.length ? partyVerdict(party.length, average, floorLevel(state.floor)) : Verdict.TooFew,
    tone = grade === Verdict.Ready ? t.success : grade === Verdict.Hard ? t.accent : t.danger;
  c.line(f32(panel.x + pad), f32(bottom - 6), f32(panel.x + w - pad), f32(bottom - 6), t.border, 1);
  const lineW = f32(w - pad * 2),
    said = problem && problem !== 'Choose who goes' ? problem : verdict || 'Choose who goes: click or tap a resident to take them along.';
  if (!locked)
    wrapText(c, said, lineW, 11, 2, true).forEach((row, i) =>
    c.text(new Rect(f32(panel.x + pad), f32(bottom + i * 15), lineW, 15), row, said === problem ? t.danger : verdict ? tone : t.muted, 11, true),
  );
  const sendW = wide ? 180 : f32(lineW - 96),
    send = new Rect(f32(panel.x + w - pad - sendW), f32(panel.y + h - buttonH - 12), sendW, buttonH);
  button(
    c,
    'expedition-cancel',
    new Rect(f32(send.x - (wide ? 108 : 96)), send.y, wide ? 100 : 88, buttonH),
    'Close',
    () => closeExpedition(this),
    ButtonStyle.Quiet,
  );
  button(
    c,
    'expedition-set-out',
    send,
    party.length ? `${fixed ? 'Send to join' : 'Set out'} (${party.length})` : fixed ? 'Send to join' : 'Set out',
    () => setOut(this),
    ButtonStyle.Primary,
    !problem,
  );
  if (wide && !touch && !locked)
    c.text(
      new Rect(f32(panel.x + pad), f32(send.y + 8), f32(send.x - panel.x - pad - 116), 16),
      'Enter sets out  ·  Escape closes',
      t.muted,
      10,
    );
}
function rosterList(app: ExpeditionApp, list: Rect, buttonH: number, rowH: number): void {
  const c = app.context,
    t = app.theme,
    state = app.expedition!,
    town = state.town,
    roster = expeditionRoster(town),
    able = roster.filter((p) => !staysBehind(town, p)),
    away = roster.filter((p) => staysBehind(town, p)),
    picks = quickPicks(app);
  // Quick picks, as many as fit, with Clear always last.
  let x = list.x;
  const clearW = Math.max(76, f32(c.textWidth('Choose none', 13, false) + 24)),
    room = f32(list.w - clearW - 6);
  for (const pick of picks) {
    const bw = Math.max(76, f32(c.textWidth(pick.label, 13, false) + 24));
    if (x + bw > list.x + room) break;
    const same = pick.ids.length === state.party.length && pick.ids.every((id) => state.party.includes(id));
    button(c, `expedition-pick-${pick.id}`, new Rect(x, list.y, bw, buttonH), pick.label, () => pickParty(app, pick.ids), ButtonStyle.Default, pick.ids.length > 0, undefined, same, { fontSize: 11 });
    x = f32(x + bw + 6);
  }
  button(c, 'expedition-pick-clear', new Rect(f32(list.x + list.w - clearW), list.y, clearW, buttonH), 'Choose none', () => pickParty(app, []), ButtonStyle.Quiet, state.party.length > 0, undefined, false, { fontSize: 11 });
  const top = f32(list.y + buttonH + 8),
    area = new Rect(list.x, top, list.w, f32(list.y + list.h - top)),
    entries: (Person | 'away')[] = [...able, ...(away.length ? ['away' as const] : []), ...away],
    heading = 22,
    pager = buttonH,
    height = (entry: Person | 'away') => (entry === 'away' ? heading : rowH + 4),
    total = entries.reduce((s, e) => s + height(e), 0),
    paged = total > area.h,
    view = paged ? f32(area.h - pager - 6) : area.h;
  if (!roster.length) {
    c.text(new Rect(area.x, f32(area.y + 8), area.w, 18), 'No resident can be sent yet.', t.muted, 12);
    return;
  }
  // Rows that fit from the first shown; the wheel and the page buttons move it.
  const fits = (from: number) => {
    let used = 0,
      n = 0;
    for (let i = from; i < entries.length && used + height(entries[i]) <= view; ++i, ++n) used += height(entries[i]);
    return Math.max(1, n);
  };
  let last = entries.length - 1,
    used = 0;
  for (; last >= 0 && used + height(entries[last]) <= view; --last) used += height(entries[last]);
  const most = Math.max(0, last + 1);
  state.scroll = clamp(state.scroll, 0, most);
  const shown = fits(state.scroll),
    window = new Rect(area.x, area.y, area.w, view);
  c.control('expedition-list', window, (event) => {
    if (event.type === EventType.Scroll) state.scroll = clamp(state.scroll - Math.sign(event.y), 0, most);
    else if (event.type === EventType.Key && (event.key === Key.Down || event.key === Key.Up))
      state.scroll = clamp(state.scroll + (event.key === Key.Down ? 1 : -1), 0, most);
  }, true, false, true);
  let y = area.y;
  for (const entry of entries.slice(state.scroll, state.scroll + shown)) {
    if (entry === 'away') {
      c.text(new Rect(area.x, f32(y + 4), area.w, 16), 'Cannot go now', t.muted, 11, true);
      y = f32(y + heading);
      continue;
    }
    memberRow(app, entry, new Rect(area.x, y, area.w, rowH));
    y = f32(y + rowH + 4);
  }
  if (!paged) return;
  const py = f32(area.y + area.h - pager),
    half = f32(f32(area.w - 6) / 2);
  button(c, 'expedition-page-up', new Rect(area.x, py, half, pager), 'Previous', () => (state.scroll = Math.max(0, state.scroll - shown)), ButtonStyle.Quiet, state.scroll > 0, undefined, false, { fontSize: 11 });
  button(c, 'expedition-page-down', new Rect(f32(area.x + half + 6), py, half, pager), `More (${entries.length - state.scroll - shown})`, () => (state.scroll = Math.min(most, state.scroll + shown)), ButtonStyle.Quiet, state.scroll < most, undefined, false, { fontSize: 11 });
}
