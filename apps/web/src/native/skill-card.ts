// The skill part of the selection panel: both skills of a calling with cooldown, ready count, the locked second
// skill and an auto toggle each; tabs to choose the calling when the selection is mixed.
import { Rect, Align, ButtonStyle, button } from '../../../../packages/native-ui/src';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import { SkillAim } from '../../../../packages/engine/src/skill-catalog';
import { tooltip, wrapText } from './game-combat-hud';
import type { GameHudApp } from './game-hud-contract';
import {
  beginSkill,
  currentAim,
  callingLabel,
  callingSkills,
  focusedCalling,
  skillKeys,
  type CallingSkills,
  type SkillSlotGroup,
} from './skill-commands';

const rowHeight = (app: GameHudApp) => (app.touchMode ? 44 : 30);
const tabHeight = (app: GameHudApp) => (app.touchMode ? 36 : 22);
/** Height of the skill part of the selection panel; 0 when no selected resident has a skill. */
export function skillCardHeight(app: GameHudApp): number {
  const groups = callingSkills(app.town, app.chosen);
  if (!groups.length) return 0;
  const h = rowHeight(app);
  if (groups.length === 1 && groups[0].members.length === 1) return f32(h * 2 + 6 + 6);
  return f32((groups.length > 1 ? tabHeight(app) + 4 : 0) + h + 6);
}
export function skillTooltip(group: SkillSlotGroup, slot: number, touch: boolean): string[] {
  const a = group.ability,
    spec = group.spec,
    key = skillKeys[slot],
    lines = [a.name, a.description];
  if (!group.holders.length) {
    lines.push(`Comes at level ${spec.level}.`);
    return lines;
  }
  if (group.holders.length > 1) lines.push(`${group.ready} of ${group.holders.length} ready.`);
  else if (a.auto) lines.push('Used on its own when it helps.');
  if (group.locked.length) lines.push(`${group.locked.length} more get it at level ${spec.level}.`);
  const ground = spec.aim === SkillAim.Ground;
  lines.push(
    touch
      ? ground
        ? 'Tap, then tap the ground where it should land.'
        : 'Tap to use it for every selected resident of this calling who has it ready.'
      : ground
        ? `${key}: hold to see where it lands under the cursor, release to cast. Or click here, then the ground.`
        : `${key}: every selected resident who has it ready uses it.`,
  );
  return lines;
}
function skillButton(app: GameHudApp, entry: CallingSkills, slot: number, r: Rect, compact: boolean): void {
  const c = app.context,
    t = app.theme,
    group = entry.slots[slot],
    a = group.ability,
    id = 'ability-' + a.id,
    single = group.holders.length === 1 && !group.locked.length,
    locked = !group.holders.length,
    ready = group.ready > 0,
    ids = group.holders.map((p) => p.id),
    aim = currentAim(app),
    aiming = aim?.via === 'pointer' && aim.slot === slot && ids.some((id) => aim.ids.includes(id)),
    state = button(
      c,
      id,
      r,
      '',
      () => {
        if (locked) app.status = `${a.name} comes at level ${group.spec.level}`;
        else if (aiming) app.army.aim = null;
        else beginSkill(app, ids, slot, 'pointer');
      },
      ready ? ButtonStyle.Default : ButtonStyle.Quiet,
      true,
      undefined,
      aiming || (single && a.active),
    );
  const charge = locked
      ? 0
      : single
        ? 1 - clamp(a.remaining / Math.max(1, a.cooldown), 0, 1)
        : group.ready / group.holders.length,
    bar = new Rect(f32(r.x + 3), f32(r.y + r.h - 5), f32(r.w - 6), 3);
  c.rect(bar, t.raised, 1);
  if (!locked) c.rect(new Rect(bar.x, bar.y, Math.max(1, f32(bar.w * charge)), 3), ready ? t.accent : t.muted, 1);
  const key = app.touchMode ? '' : skillKeys[slot] + '  ',
    shown = locked
      ? `Lv ${group.spec.level}`
      : single
        ? a.active
          ? 'Active'
          : ready
            ? compact
              ? ''
              : 'Ready'
            : `${Math.ceil(a.remaining)} s`
        : `${group.ready}/${group.holders.length}`,
    right = shown ? c.textWidth(shown, 10) + 10 : 0,
    size = compact ? 11 : 12;
  c.text(
    new Rect(f32(r.x + 8), r.y, f32(r.w - right - 12), f32(r.h - 3)),
    c.elideText(key + a.name, f32(r.w - right - 12), size, true),
    ready ? t.text : t.muted,
    size,
    true,
  );
  c.text(
    new Rect(f32(r.x + r.w - right - 4), r.y, right, f32(r.h - 3)),
    shown,
    locked ? t.muted : ready ? t.success : t.muted,
    10,
    false,
    Align.End,
  );
  if (!locked && (!ready || a.active)) c.requestFrameAt(c.time() + 0.25);
  tooltip(c, id, state.hovered, skillTooltip(group, slot, app.touchMode));
}
function autoToggle(app: GameHudApp, entry: CallingSkills, slot: number, r: Rect): void {
  const c = app.context,
    group = entry.slots[slot],
    a = group.ability,
    id = 'skill-auto-' + a.id,
    ids = group.holders.map((p) => p.id),
    on = group.holders.length > 0 && group.auto,
    state = button(
      c,
      id,
      r,
      on ? 'Auto on' : 'Auto off',
      () => app.town.setSkillAuto(ids, slot, !group.auto),
      ButtonStyle.Quiet,
      ids.length > 0,
      undefined,
      on,
      { fontSize: 11 },
    );
  const who = group.holders.length === 1 ? `${group.holders[0].name} uses` : `The ${group.holders.length} who have it use`;
  tooltip(c, id, state.hovered, [
    on ? 'Auto-use is on' : 'Auto-use is off',
    on ? `${who} ${a.name} on their own when it helps.` : `${a.name} waits for your order.`,
    'Every skill starts on auto. Turn it off to time it by hand.',
  ]);
}
/** One button with an auto toggle beside it. */
function skillPair(app: GameHudApp, entry: CallingSkills, slot: number, r: Rect, compact: boolean): number {
  const autoW = app.touchMode ? 64 : 62,
    w = f32(r.w - autoW - 4);
  skillButton(app, entry, slot, new Rect(r.x, r.y, w, r.h), compact);
  autoToggle(app, entry, slot, new Rect(f32(r.x + w + 4), r.y, autoW, r.h));
  return f32(w + 4 + autoW);
}
function callingTabs(app: GameHudApp, groups: readonly CallingSkills[], focus: CallingSkills, area: Rect): void {
  const c = app.context,
    t = app.theme,
    h = tabHeight(app);
  let x = area.x;
  if (!app.touchMode) {
    const badge = new Rect(x, area.y, 30, h);
    c.rect(badge, t.raised, 3, t.border);
    c.text(badge, 'Tab', t.accent, 10, true, Align.Center);
    x = f32(x + 36);
  }
  const room = f32(area.x + area.w - x),
    natural = groups.map((g) => c.textWidth(callingLabel(g), 11, true) + 40),
    scale = Math.min(1, f32((room - 6 * (groups.length - 1)) / natural.reduce((s, w) => s + w, 0)));
  groups.forEach((g, i) => {
    const w = f32(natural[i] * scale),
      r = new Rect(x, area.y, w, h),
      id = 'skill-calling-' + g.calling,
      state = button(
        c,
        id,
        r,
        '',
        () => (app.army.focus = g.calling),
        ButtonStyle.Quiet,
        true,
        undefined,
        g === focus,
        { fontSize: 11 },
      );
    c.text(
      new Rect(f32(r.x + 8), r.y, f32(w - 34), h),
      c.elideText(callingLabel(g), f32(w - 34), 11, g === focus),
      g === focus ? t.text : t.muted,
      11,
      g === focus,
    );
    // A pip per skill: filled when someone has it ready, hollow while it recovers, absent while locked.
    g.slots.forEach((slot, s) => {
      const pip = new Rect(f32(r.x + w - 22 + s * 10), f32(r.y + h / 2 - 3), 6, 6);
      if (!slot.holders.length) c.rect(pip, t.raised, 3);
      else if (slot.ready) c.rect(pip, t.accent, 3);
      else c.rect(pip, { r: 0, g: 0, b: 0, a: 0 }, 3, t.muted, 1);
    });
    tooltip(c, id, state.hovered, [
      callingLabel(g),
      g.slots.map((slot) => `${slot.ability.name}: ${slot.holders.length ? `${slot.ready}/${slot.holders.length} ready` : `level ${slot.spec.level}`}`).join('  ·  '),
      app.touchMode ? 'Tap to show their skills.' : 'Click or press Tab to show their skills. Q and W still fire for everyone selected.',
    ]);
    x = f32(x + w + 6);
  });
}
/** Both skills of the selection's calling, or of the calling chosen with Tab when the selection is mixed. */
export function skillCard(app: GameHudApp, area: Rect): void {
  const groups = callingSkills(app.town, app.chosen),
    focus = focusedCalling(app, groups);
  if (!focus) return;
  const c = app.context,
    t = app.theme,
    h = rowHeight(app);
  if (groups.length === 1 && focus.members.length === 1) {
    const w = Math.min(240, f32(area.w * 0.45));
    focus.slots.forEach((group, slot) => {
      const y = f32(area.y + slot * (h + 6)),
        used = skillPair(app, focus, slot, new Rect(area.x, y, w, h), false),
        left = f32(area.x + used + 10),
        room = f32(area.x + area.w - left),
        text = group.holders.length ? group.ability.description : `Comes at level ${group.spec.level}. ${group.ability.description}`;
      if (room > 80)
        wrapText(c, text, room, 10, 2).forEach((row, i) =>
          c.text(new Rect(left, f32(y + (h - 30) / 2 + i * 14), room, 15), row, t.muted, 10),
        );
    });
    return;
  }
  let y = area.y;
  if (groups.length > 1) {
    callingTabs(app, groups, focus, new Rect(area.x, y, area.w, tabHeight(app)));
    y = f32(y + tabHeight(app) + 4);
  }
  const half = f32((area.w - 8) / 2);
  focus.slots.forEach((_, slot) => skillPair(app, focus, slot, new Rect(f32(area.x + slot * (half + 8)), y, half, h), true));
}
