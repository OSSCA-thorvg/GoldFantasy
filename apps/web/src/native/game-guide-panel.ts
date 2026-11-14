// The guide on screen: one card at a time beside the play area, and the log of every explanation so far.
import { localeRevision, translate } from '../../../../packages/localization/src/index';
import { Align, ButtonStyle, EventType, Rect, button } from '../../../../packages/native-ui/src';
import { clamp, f32 } from '../../../../packages/engine/src/numeric';
import type { GameHudApp } from './game-hud-contract';
import { wrapText } from './game-progress-hud';
import { tooltip } from './game-combat-hud';
import { dismissGuideCard, guideLook, guideRules, guideUnread, toggleGuideLog, type GuideEntry } from './game-guide';
import { fill, guideMoment, line, type Line } from './guide-moments';
import { guidePreferences, setGuidePreference } from './guide-preferences';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Panels drawn last frame, so the card can keep clear of them this frame. */
const blocked = new WeakMap<GameHudApp, Box[]>();

const sentence = (value: Line) => translate(fill(value));
const paragraph = (lines: readonly Line[]) => lines.map(sentence).join(' ');
function titleOf(entry: GuideEntry): Line {
  return guideMoment(entry.key)?.title ?? entry.key;
}
// Texts follow from the rules alone, so their wrapping is kept until the language or the width changes.
const wrapped = new Map<string, string[]>();
function bodyRows(app: GameHudApp, entry: GuideEntry, width: number, lines: number): string[] {
  const key = `${entry.key}|${localeRevision()}|${width}|${lines}`;
  let rows = wrapped.get(key);
  if (!rows) {
    if (wrapped.size > 400) wrapped.clear();
    rows = wrapText(app.context, paragraph(guideMoment(entry.key)?.text(app.town) ?? []), width, 12, lines);
    wrapped.set(key, rows);
  }
  return rows;
}
/** The first spot down the right edge, then the left, clear of every panel; null when none fits. */
function place(boxes: readonly Box[], w: number, h: number, width: number, height: number): Rect | null {
  const columns = w >= width - 25 ? [12] : [f32(width - 12 - w), 12];
  for (const x of columns) {
    let y = 56;
    for (let guard = 0; guard < 40 && y + h <= height - 8; ++guard) {
      const spot = { x, y, w, h },
        hits = boxes.filter((b) => overlaps(b, spot));
      if (!hits.length) return new Rect(x, y, w, h);
      y = f32(Math.max(...hits.map((b) => b.y + b.h)) + 8);
    }
  }
  return null;
}
function logButton(app: GameHudApp): void {
  const c = app.context,
    t = app.theme,
    s = app.guide,
    size = app.touchMode ? 44 : 36,
    r = new Rect(12, 12, size, size);
  c.rect(r, t.surface, t.radius, s.logOpen ? t.accent : t.border);
  const state = button(c, 'guide-log-button', r, '', () => toggleGuideLog(app), ButtonStyle.Quiet, true, undefined, s.logOpen);
  const ink = state.hovered || s.logOpen ? t.text : t.accent,
    cx = f32(r.x + r.w / 2),
    cy = f32(r.y + r.h / 2);
  // An open book: two pages meeting at the spine.
  c.paint(JSON.stringify(['guide-book', cx, cy, ink]), () =>
    new c.tvg.Shape()
      .moveTo(cx, f32(cy - 6))
      .cubicTo(f32(cx - 3), f32(cy - 8), f32(cx - 7), f32(cy - 8), f32(cx - 10), f32(cy - 6))
      .lineTo(f32(cx - 10), f32(cy + 8))
      .cubicTo(f32(cx - 7), f32(cy + 6), f32(cx - 3), f32(cy + 6), cx, f32(cy + 8))
      .cubicTo(f32(cx + 3), f32(cy + 6), f32(cx + 7), f32(cy + 6), f32(cx + 10), f32(cy + 8))
      .lineTo(f32(cx + 10), f32(cy - 6))
      .cubicTo(f32(cx + 7), f32(cy - 8), f32(cx + 3), f32(cy - 8), cx, f32(cy - 6))
      .lineTo(cx, f32(cy + 8))
      .fill(0, 0, 0, 0)
      .stroke({ width: f32(1.4), color: [ink.r, ink.g, ink.b, ink.a] }),
  );
  const unread = guideUnread(s);
  if (unread > 0 && !s.logOpen) {
    const badge = new Rect(f32(r.x + r.w - 12), f32(r.y - 4), 16, 16);
    c.rect(badge, t.accent, 8);
    c.text(badge, unread > 9 ? '9+' : String(unread), t.accentText, 9, true, Align.Center);
  }
  if (!app.touchMode) tooltip(c, 'guide-log-button', state.hovered, ['Guide (F1)', 'Every first-time explanation, to read again.']);
}
function card(app: GameHudApp, width: number, height: number): void {
  const s = app.guide,
    shown = s.card,
    boxes = blocked.get(app);
  if (!shown || s.logOpen || !boxes) return;
  const c = app.context,
    t = app.theme,
    entry = shown.entry,
    now = c.time(),
    touch = app.touchMode,
    w = Math.min(width < 600 ? f32(width - 24) : 340, f32(width - 24)),
    inner = f32(w - 28),
    rows = bodyRows(app, entry, inner, 9),
    detail = entry.detail.slice(0, 2),
    bh = touch ? 44 : 28,
    h = f32(14 + 16 + 24 + rows.length * 17 + detail.length * 16 + 10 + bh + 14),
    r = place(boxes, w, h, width, height);
  if (!r) return;
  s.drawnAt = now;
  const state = c.control(
    'guide-card',
    r,
    (event) => {
      if (event.type === EventType.Activate) dismissGuideCard(app);
    },
    true,
    false,
  );
  if (state.hovered) shown.until = Math.max(shown.until, now + 1.5);
  c.rect(new Rect(f32(r.x - 1), f32(r.y + 3), f32(r.w + 2), f32(r.h + 2)), { r: 0, g: 0, b: 0, a: 60 }, f32(t.radius + 2));
  c.rect(r, t.raised, t.radius, t.accent, f32(1.5));
  const left = f32(r.x + 14);
  let y = f32(r.y + 12);
  c.text(new Rect(left, y, f32(inner - 80), 16), 'Guide', t.accent, 10, true);
  if (entry.day !== null)
    c.text(new Rect(f32(left + inner - 80), y, 80, 16), fill(line('Day {0}', entry.day)), t.muted, 10, false, Align.End);
  y = f32(y + 16);
  c.text(new Rect(left, y, inner, 24), c.elideText(fill(titleOf(entry)), inner, 15, true), t.text, 15, true);
  y = f32(y + 26);
  for (const row of rows) {
    c.text(new Rect(left, y, inner, 17), row, t.text, 12);
    y = f32(y + 17);
  }
  for (const text of detail) {
    c.text(new Rect(left, y, inner, 16), c.elideText(text, inner, 11), t.muted, 11);
    y = f32(y + 16);
  }
  const buttons = f32(r.y + r.h - 14 - bh),
    got = touch ? 104 : 88;
  button(c, 'guide-card/ok', new Rect(f32(r.x + r.w - 14 - got), buttons, got, bh), 'Got it', () => dismissGuideCard(app), ButtonStyle.Primary, true, undefined, false, { fontSize: 12 });
  const at = entry.at;
  if (at && !shown.looked)
    button(c, 'guide-card/look', new Rect(f32(r.x + r.w - 22 - got * 2), buttons, got, bh), 'Look', () => {
      shown.looked = true;
      guideLook(app, at);
    }, ButtonStyle.Default, true, undefined, false, { fontSize: 12 });
  if (s.queue.length)
    c.text(new Rect(left, buttons, 110, bh), fill(line('{0} more waiting', s.queue.length)), t.muted, 10);
  // What is left of the card's time, as a thin line along its foot.
  const left01 = clamp((shown.until - now) / guideRules.cardSeconds, 0, 1);
  c.rect(new Rect(f32(r.x + 3), f32(r.y + r.h - 4), f32((r.w - 6) * left01), 2), { ...t.accent, a: 150 }, 1);
  c.requestFrameAt(Math.min(shown.until, now + 0.5));
}
interface EntryLayout {
  entry: GuideEntry;
  rows: string[];
  height: number;
}
function measure(app: GameHudApp, entry: GuideEntry, inner: number): EntryLayout {
  const rows = bodyRows(app, entry, inner, 12),
    head = app.touchMode ? 44 : 24;
  return { entry, rows, height: head + rows.length * 16 + entry.detail.length * 15 + 12 };
}
function logPanel(app: GameHudApp, width: number): void {
  const c = app.context,
    t = app.theme,
    s = app.guide,
    prefs = guidePreferences(),
    touch = app.touchMode,
    bh = touch ? 44 : 28,
    top = touch ? 64 : 56,
    w = Math.min(440, f32(width - 24)),
    // Ends above the notice toast's line over the dock.
    bottom = Math.max(f32(top + 260), f32(app.dockBounds.y - 54)),
    r = new Rect(12, top, w, f32(Math.min(bottom, app.viewHeight - 8) - top)),
    inner = f32(w - 32),
    left = f32(r.x + 16);
  c.control('guide-log', r, undefined, true, false);
  c.rect(new Rect(f32(r.x - 1), f32(r.y + 4), f32(r.w + 2), f32(r.h + 2)), { r: 0, g: 0, b: 0, a: 70 }, f32(t.radius + 2));
  c.rect(r, { ...t.surface, a: 255 }, t.radius, t.border);
  c.text(new Rect(left, f32(r.y + 12), f32(inner - 50), 24), 'Guide', t.text, 17, true);
  c.text(new Rect(left, f32(r.y + 36), f32(inner - 50), 16), 'Every first-time explanation, newest first.', t.muted, 11);
  const close = new Rect(f32(r.x + r.w - 12 - bh), f32(r.y + 10), bh, bh),
    closing = button(c, 'guide-log/close', close, '', () => toggleGuideLog(app), ButtonStyle.Quiet),
    ink = closing.hovered || closing.focused ? t.text : t.muted,
    m = f32(bh / 2 - 5);
  c.line(f32(close.x + m), f32(close.y + m), f32(close.x + bh - m), f32(close.y + bh - m), ink, f32(1.5));
  c.line(f32(close.x + bh - m), f32(close.y + m), f32(close.x + m), f32(close.y + bh - m), ink, f32(1.5));
  let y = f32(r.y + 60);
  const half = f32((inner - 8) / 2);
  button(c, 'guide-log/focus', new Rect(left, y, half, bh), prefs.focus ? 'Camera focus: On' : 'Camera focus: Off', () => setGuidePreference('focus', !prefs.focus), ButtonStyle.Default, true, undefined, prefs.focus, { fontSize: 11 });
  button(c, 'guide-log/cards', new Rect(f32(left + half + 8), y, half, bh), prefs.cards ? 'Cards: On' : 'Cards: Off', () => setGuidePreference('cards', !prefs.cards), ButtonStyle.Default, true, undefined, prefs.cards, { fontSize: 11 });
  y = f32(y + bh + 12);
  c.rect(new Rect(left, y, inner, 1), t.border, 0);
  y = f32(y + 10);
  const newest = [...s.log].reverse(),
    footer = f32(r.y + r.h - 12 - bh),
    room = f32(footer - 8 - y);
  if (!newest.length) {
    for (const row of wrapText(c, 'Nothing yet. An explanation is written here the first time something happens.', inner, 12, 4)) {
      c.text(new Rect(left, y, inner, 17), row, t.muted, 12);
      y = f32(y + 17);
    }
    return;
  }
  const first = clamp(s.logPages.at(-1) ?? 0, 0, newest.length - 1);
  let used = 0,
    index = first;
  for (; index < newest.length; ++index) {
    const layout = measure(app, newest[index], inner);
    if (index > first && used + layout.height > room) break;
    entryRow(app, layout, left, f32(y + used), inner, index);
    used += layout.height;
  }
  button(c, 'guide-log/newer', new Rect(left, footer, 96, bh), 'Newer', () => s.logPages.pop(), ButtonStyle.Default, s.logPages.length > 1, undefined, false, { fontSize: 11 });
  button(c, 'guide-log/older', new Rect(f32(left + inner - 96), footer, 96, bh), 'Older', () => s.logPages.push(index), ButtonStyle.Default, index < newest.length, undefined, false, { fontSize: 11 });
  c.text(new Rect(f32(left + 100), footer, f32(inner - 200), bh), fill(line('{0}–{1} of {2}', first + 1, index, newest.length)), t.muted, 10, false, Align.Center);
}
function entryRow(app: GameHudApp, layout: EntryLayout, x: number, y: number, inner: number, index: number): void {
  const c = app.context,
    t = app.theme,
    { entry, rows } = layout,
    head = app.touchMode ? 44 : 24,
    look = app.touchMode ? 76 : 56,
    at = entry.at,
    day = entry.day === null ? 'Earlier' : fill(line('Day {0}', entry.day)),
    titleWidth = f32(inner - (at ? look + 8 : 0) - 64);
  c.text(new Rect(x, y, titleWidth, head), c.elideText(fill(titleOf(entry)), titleWidth, 13, true), t.text, 13, true);
  c.text(new Rect(f32(x + titleWidth + 4), y, 60, head), day, t.muted, 10, false, Align.End);
  if (at)
    button(c, `guide-log/look/${index}`, new Rect(f32(x + inner - look), f32(y + (app.touchMode ? 0 : 1)), look, f32(head - (app.touchMode ? 0 : 2))), 'Look', () => guideLook(app, at), ButtonStyle.Default, true, undefined, false, { fontSize: 11 });
  let row = f32(y + head);
  for (const text of rows) {
    c.text(new Rect(x, row, inner, 16), text, t.text, 12);
    row = f32(row + 16);
  }
  for (const text of entry.detail) {
    c.text(new Rect(x, row, inner, 15), c.elideText(text, inner, 11), t.muted, 11);
    row = f32(row + 15);
  }
  c.rect(new Rect(x, f32(y + layout.height - 5), inner, 1), { ...t.border, a: 90 }, 0);
}
/** Once per HUD frame, after every other panel: the log button, then the log or the card. */
export function guideHud(app: GameHudApp, width: number, height: number): void {
  if (app.town.isTitleAutoplay()) return;
  const c = app.context;
  logButton(app);
  if (app.guide.logOpen) logPanel(app, width);
  else card(app, width, height);
  if (app.guide.glide) c.requestAnimationFrame();
  c.deferOverlay(
    (_, controls) =>
      blocked.set(
        app,
        controls
          .filter((k) => !k.id.startsWith('guide') && !k.id.startsWith('resource-'))
          .map((k) => ({ x: k.bounds.x, y: k.bounds.y, w: k.bounds.w, h: k.bounds.h })),
      ),
    'guide-measure',
  );
}
