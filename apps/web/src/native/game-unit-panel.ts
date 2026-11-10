import { Rect, button, ButtonStyle } from '../../../../packages/native-ui/src';
import {
  Role,
  Activity,
  callingName,
  raceName,
  activityName,
  type Person,
} from '../../../../packages/engine/src/person';
import { canControl, controlReason } from '../../../../packages/engine/src/faction';
import { structureSpec, describe } from '../../../../packages/engine/src/building-catalog';
import { resourceBundle } from '../../../../packages/engine/src/construction-materials';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { injuryOf } from '../../../../packages/engine/src/person-look';
import { hudPaint } from './hud-paint';
import { actionButton } from './hud-actions';
import type { GameHudApp } from './game-hud-contract';
import { touchCommandColumns } from './mobile-layout';

const footerHeight = 42;
function commandFooter(app: GameHudApp, width: number): number {
  if (!app.touchMode) return footerHeight;
  const count = app.shelteredSelection() ? 8 : 7,
    columns = touchCommandColumns(width - 24, count),
    rows = Math.ceil(count / columns);
  return rows * 44 + (rows - 1) * 6 + 10;
}
export function residentSelection(this: GameHudApp): boolean {
  return this.chosen.some((id) => canControl(this.town.person(id)));
}
export function shelteredSelection(this: GameHudApp): boolean {
  return this.chosen.some((id) => {
    const p = this.town.person(id);
    return canControl(p) && (p.inside || p.crossingDoorway() || p.task === Activity.Sleeping);
  });
}
export function personPanelBounds(this: GameHudApp, width: number, height: number, commands: boolean): Rect {
  const w = Math.min(720, width - 24),
    columns = Math.max(1, Math.floor((w - 24) / 56));
  const content =
    this.chosen.length === 1
      ? w < 520
        ? 116
        : 132
      : 34 + Math.min(3, Math.ceil(Math.min(20, this.chosen.length) / columns)) * 56;
  const h = Math.min(Math.max(90, height - 96), content + (commands ? commandFooter(this, w) : 12));
  return new Rect((width - w) / 2, height - 12 - h, w, h);
}
export function personPanel(this: GameHudApp, panel: Rect): void {
  const c = this.context,
    t = this.theme,
    commands = this.residentSelection();
  const portrait = (p: Person, r: Rect) => {
    const mood = moodOf(p),
      backdrop = portraitBackdrop(this.town.map(), p.position, this.town.climate());
    const key = JSON.stringify([
      'selection-profile',
      p.look,
      p.race,
      String(p.lookRevision),
      p.calling,
      r.w,
      r.h,
      mood,
      injuryOf(p),
      backdrop,
    ]);
    let entry = this.dockPortraits.get(p.id);
    if (!entry || entry.key !== key) {
      if (entry) {
        const old = entry.paint;
        c.deferRelease(() => old.dispose());
      }
      entry = { key, paint: hudPaint(c, personPortrait(p, mood, r.w - 2, r.h - 2, backdrop)) };
      this.dockPortraits.set(p.id, entry);
    }
    c.rect(r, t.raised, t.radius, t.border);
    c.add(entry.paint);
    entry.paint.transform({
      e11: 1,
      e12: 0,
      e13: r.x + 1,
      e21: 0,
      e22: 1,
      e23: r.y + 1,
      e31: 0,
      e32: 0,
      e33: 1,
    });
  };
  const first = this.town.person(this.chosen[0]);
  const manage = () => {
    this.rosterOpen = true;
    this.rosterTab = first?.role === Role.Guest ? 'guests' : 'units';
    this.rosterSelected = first ? this.rosterTab + ':' + first.id : '';
    this.equipmentTab = 'equipment';
    this.inventorySelected = -1;
  };
  actionButton(
    c,
    'unit-management',
    this.touchMode
      ? new Rect(panel.x + panel.w - 56, panel.y + 5, 44, 44)
      : new Rect(panel.x + panel.w - 67, panel.y + 5, 30, 28),
    'unit',
    'Unit equipment and inventory',
    manage,
  );
  if (this.chosen.length === 1 && first) {
    const p = first,
      narrow = panel.w < 520,
      size = narrow ? 48 : 72,
      left = panel.x + size + 24;
    portrait(p, new Rect(panel.x + 12, panel.y + 10, size, size));
    c.text(
      new Rect(left, panel.y + 7, panel.w - size - 104, 24),
      c.elideText(p.name + ' · Lv ' + p.level, panel.w - size - 104, 15, true),
      t.text,
      15,
      true,
    );
    c.text(
      new Rect(left, panel.y + 32, panel.w - size - 40, 18),
      raceName(p.race) +
        ' · ' +
        callingName(p.calling) +
        (p.role === Role.Guest ? ' · guest' : p.faction > 0 ? ' · neutral' : ''),
      t.accent,
      11,
    );
    const action = controlReason(p) || (p.moving() ? 'On the way: ' : '') + activityName(p.activity);
    c.text(
      new Rect(left, panel.y + 51, panel.w - size - 40, 18),
      c.elideText(action, panel.w - size - 40, 11),
      canControl(p) ? t.muted : t.danger,
      11,
    );
    const home = this.town.building(p.role === Role.Guest ? p.bed : p.home);
    const detail = p.carrying
      ? 'Carrying ' + describe(resourceBundle(p.carriedProduct, p.carrying))
      : home
        ? 'Home: ' + structureSpec(home.kind).name
        : 'No home assigned';
    const y = panel.y + (narrow ? 72 : 91),
      gap = 8,
      w = (panel.w - 24 - gap * 4) / 5;
    for (const [index, [label, value, positive]] of (
      [
        ['Health', p.health, true],
        ['Food', p.food, true],
        ['Water', p.hydration, true],
        ['Rest', p.rest, true],
        ['Stress', p.stress, false],
      ] as const
    ).entries()) {
      const x = panel.x + 12 + index * (w + gap),
        color = (positive ? value : 1 - value) < 0.3 ? t.danger : t.success;
      c.text(new Rect(x, y, w, 16), label + ' ' + Math.round(value * 100) + '%', t.muted, 9);
      c.rect(new Rect(x, y + 18, w, 4), t.raised, 2);
      c.rect(new Rect(x, y + 18, Math.max(1, w * Math.max(0, Math.min(1, value))), 4), color, 2);
    }
    if (!narrow)
      c.text(
        new Rect(left, panel.y + 70, panel.w - size - 40, 18),
        c.elideText(detail, panel.w - size - 40, 11),
        t.muted,
        11,
      );
  } else {
    c.text(
      new Rect(panel.x + 12, panel.y + 5, panel.w - 96, 24),
      this.chosen.length + ' units selected',
      t.text,
      14,
      true,
    );
    const columns = Math.max(1, Math.floor((panel.w - 24) / 56)),
      rows = Math.min(3, Math.ceil(Math.min(20, this.chosen.length) / columns));
    for (const [i, id] of this.chosen.slice(0, Math.min(20, columns * rows)).entries()) {
      const p = this.town.person(id);
      if (!p) continue;
      const r = new Rect(
        panel.x + 12 + (i % columns) * 56,
        panel.y + 33 + Math.floor(i / columns) * 56,
        48,
        48,
      );
      portrait(p, r);
      button(
        c,
        'pick-person-' + id,
        r,
        '',
        () => this.selectPeople([id]),
        ButtonStyle.Quiet,
        true,
        undefined,
        false,
        { fill: { r: 0, g: 0, b: 0, a: 0 } },
      );
      c.rect(
        new Rect(r.x + 3, r.y + r.h - 5, Math.max(1, (r.w - 6) * p.health), 3),
        p.health < 0.3 ? t.danger : t.success,
        1,
      );
    }
  }
  if (commands)
    this.commandCard(
      new Rect(
        panel.x + 12,
        panel.y + panel.h - commandFooter(this, panel.w),
        panel.w - 24,
        this.touchMode ? 44 : 32,
      ),
      1,
    );
  for (const [id, entry] of this.dockPortraits)
    if (!this.chosen.includes(id)) {
      c.deferRelease(() => entry.paint.dispose());
      this.dockPortraits.delete(id);
    }
}
