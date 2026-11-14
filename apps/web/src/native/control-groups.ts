// Control groups: Ctrl+digit makes one from the selection, Shift+digit adds to it, the digit selects it and
// the same digit again soon after brings the view to it. Small tabs show them for the mouse and for touch.
import { Rect, Align, ButtonStyle, button } from '../../../../packages/native-ui/src';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import { isPlayerResident } from '../../../../packages/engine/src/faction';
import type { Person } from '../../../../packages/engine/src/person';
import { centreOn, tooltip } from './game-combat-hud';
import { controllableIds } from './game-control';
import type { GameAppState } from './game-app-state';
import type { GameHudApp } from './game-hud-contract';

export interface GroupApp extends GameAppState {
  selectPeople(ids: readonly number[]): void;
}
const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
/** Seconds within which the same digit again also centres the view. */
export const recallTwice = 0.45;
/** Drops residents who died or left; groups are forgotten when another town is loaded. */
export function syncGroups(app: GameAppState): void {
  const army = app.army;
  if (army.town !== app.town) {
    army.town = app.town;
    army.groups.clear();
    army.lastRecall = { digit: -1, at: -1 };
  }
  for (const [digit, ids] of army.groups) {
    const kept = ids.filter((id) => isPlayerResident(app.town.person(id)));
    if (!kept.length) army.groups.delete(digit);
    else if (kept.length !== ids.length) army.groups.set(digit, kept);
  }
}
export function groupMembers(app: GameAppState, digit: number): Person[] {
  syncGroups(app);
  return (app.army.groups.get(digit) ?? []).map((id) => app.town.person(id)).filter((p): p is Person => !!p);
}
/** The digits of the groups `id` belongs to. */
export function groupsOf(app: GameAppState, id: number): number[] {
  return digits.filter((digit) => app.army.groups.get(digit)?.includes(id));
}
/** Ctrl+digit makes the group from the selection; Shift+digit adds the selection to it. */
export function setGroup(app: GameAppState, digit: number, add: boolean): boolean {
  syncGroups(app);
  const ids = controllableIds(app.town, app.chosen).filter((id) => isPlayerResident(app.town.person(id)));
  if (!ids.length) {
    app.status = `Select residents first, then Ctrl+${digit} makes them group ${digit}`;
    return false;
  }
  const before = add ? (app.army.groups.get(digit) ?? []) : [];
  app.army.groups.set(digit, [...new Set([...before, ...ids])]);
  app.status = '';
  return true;
}
/** Where the standing members of a group are, on average. */
function middleOf(members: readonly Person[]) {
  const standing = members.filter((p) => p.downedAt < 0),
    shown = standing.length ? standing : members,
    at = { x: 0, y: 0 };
  for (const p of shown) {
    at.x += p.position.x / shown.length;
    at.y += p.position.y / shown.length;
  }
  return at;
}
/** The digit selects the group; the same digit again within a moment also centres the view on it. */
export function recallGroup(app: GroupApp, digit: number): boolean {
  const members = groupMembers(app, digit),
    now = app.context.time(),
    last = app.army.lastRecall;
  if (!members.length) {
    app.status = `Group ${digit} is empty: select residents and press Ctrl+${digit}`;
    return false;
  }
  const twice = last.digit === digit && now - last.at < recallTwice && now >= last.at;
  app.army.lastRecall = { digit, at: twice ? -1 : now };
  app.selectPeople(members.map((p) => p.id));
  app.status = '';
  if (twice) centreOn(app, middleOf(members));
  return true;
}
const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id) => b.includes(id));
/** The next digit without a group, or 0 when all nine are taken. */
export function freeDigit(app: GameAppState): number {
  return digits.find((digit) => !app.army.groups.has(digit)) ?? 0;
}
/** Tabs for the groups (number, size, a health pip) beside the selection panel, and + to make one by hand. */
export function groupTabs(app: GameHudApp, height: number): void {
  syncGroups(app);
  const own = controllableIds(app.town, app.chosen).filter((id) => isPlayerResident(app.town.person(id))),
    shown = digits.filter((digit) => app.army.groups.has(digit)),
    spare = own.length && !shown.some((digit) => sameIds(app.army.groups.get(digit)!, own)) ? freeDigit(app) : 0;
  if (!shown.length && !spare) return;
  const c = app.context,
    t = app.theme,
    h = app.touchMode ? 44 : 26,
    w = app.touchMode ? 58 : 54,
    gap = 6,
    count = shown.length + (spare ? 1 : 0),
    span = count * w + (count - 1) * gap,
    dock = app.dockBounds,
    beside = !app.touchMode && dock.x - 24 >= span,
    x = 12,
    // Above the panel they clear the status line and the notice toast.
    y = beside ? f32(height - 12 - h) : f32(dock.y - 52 - h);
  if (y < 60) return;
  shown.forEach((digit, i) => {
    const members = groupMembers(app, digit),
      r = new Rect(f32(x + i * (w + gap)), y, w, h),
      id = 'group-' + digit,
      active = sameIds(app.chosen, members.map((p) => p.id)),
      state = button(c, id, r, '', () => recallGroup(app, digit), ButtonStyle.Quiet, true, undefined, active),
      downed = members.filter((p) => p.downedAt >= 0).length,
      health = members.reduce((sum, p) => sum + clamp(p.health, 0, 1), 0) / Math.max(1, members.length),
      pip = new Rect(f32(r.x + w - 10), f32(r.y + 5), 4, f32(h - 10)),
      fill = f32(pip.h * health);
    c.text(new Rect(f32(r.x + 7), r.y, 14, h), String(digit), active ? t.text : t.accent, 13, true);
    c.text(new Rect(f32(r.x + 21), r.y, f32(w - 34), h), `·${members.length}`, t.muted, 11);
    c.rect(pip, t.raised, 2);
    c.rect(new Rect(pip.x, f32(pip.y + pip.h - fill), pip.w, Math.max(1, fill)), downed || health < 0.3 ? t.danger : t.success, 2);
    tooltip(c, id, state.hovered, [
      `Group ${digit}: ${members.map((p) => p.name).join(', ')}`,
      downed ? `${downed} down. Health ${Math.round(health * 100)}% on average.` : `Health ${Math.round(health * 100)}% on average.`,
      app.touchMode
        ? 'Tap to select them; tap again to look at them.'
        : `${digit} selects them, ${digit} twice looks at them. Ctrl+${digit} remakes the group, Shift+${digit} adds to it.`,
    ]);
  });
  if (spare) {
    const r = new Rect(f32(x + shown.length * (w + gap)), y, w, h),
      id = 'group-new',
      state = button(c, id, r, '', () => setGroup(app, spare, false), ButtonStyle.Quiet);
    c.text(r, `+ ${spare}`, t.accent, 12, true, Align.Center);
    tooltip(c, id, state.hovered, [
      `Make group ${spare}`,
      app.touchMode
        ? `The selected residents become group ${spare}; tap its tab to select them again.`
        : `The selected residents become group ${spare} (Ctrl+${spare}); press ${spare} to select them again.`,
    ]);
  }
}
