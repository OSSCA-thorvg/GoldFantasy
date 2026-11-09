import {
  Rect,
  EventType,
  ButtonStyle,
  Icon,
  button,
  type Color,
  type Context,
} from '../../../../packages/native-ui/src';
import {
  Role,
  Activity,
  callingName,
  raceName,
  activityName,
  type Person,
} from '../../../../packages/engine/src/person';
import { resourceBundle } from '../../../../packages/engine/src/construction-materials';
import { structureSpec, describe } from '../../../../packages/engine/src/building-catalog';
import { Condition, conditionName, positiveCondition } from '../../../../packages/engine/src/unit-status';
import { injuryOf } from '../../../../packages/engine/src/person-look';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { f32, clamp } from '../../../../packages/engine/src/numeric';
import { canControl, controlReason } from '../../../../packages/engine/src/faction';
import { hudPaint } from './hud-paint';
import type { GameHudApp } from './game-hud-contract';
interface Badge {
  condition: Condition;
  box: Rect;
}
function badges(context: Context, conditions: readonly Condition[], width: number): Badge[] {
  const result: Badge[] = [];
  let x = 0,
    y = 0;
  for (const condition of conditions) {
    const w = Math.min(width, f32(context.textWidth(conditionName(condition), 11) + 12));
    if (x > 0 && f32(x + w) > width) {
      x = 0;
      y = f32(y + 20);
    }
    result.push({ condition, box: new Rect(x, y, w, 18) });
    x = f32(x + f32(w + 4));
  }
  return result;
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
  const count = commands ? (this.shelteredSelection() ? 8 : 7) : 0,
    w = Math.max(
      this.chosen.length === 1 ? 600 : 360,
      f32(f32(f32(count * 72) + f32(Math.max(0, f32(count - 1)) * 6)) + 24),
    );
  let h = 134;
  if (this.chosen.length === 1) {
    const p = this.town.person(this.chosen[0]);
    if (p) {
      const tags = badges(this.context, this.town.conditions(p), f32(w - 24));
      if (tags.length) h = f32(h + f32(tags[f32(tags.length - 1)].box.y + 22));
      if (p.past) h = f32(h + 20);
    }
  } else
    h = f32(
      38 +
        f32(
          Math.ceil(f32(Math.min(20, this.chosen.length) / Math.max(1, Math.trunc(f32(f32(w - 24) / 60))))) *
            60,
        ),
    );
  h = f32(h + (commands ? 44 : 12));
  const scale = Math.min(1, f32(Math.max(1, f32(width - 24)) / w));
  return new Rect(
    f32(f32(width - f32(w * scale)) / 2),
    f32(f32(height - 12) - f32(h * scale)),
    f32(w * scale),
    f32(h * scale),
  );
}
export function personPanel(this: GameHudApp, panel: Rect): void {
  const c = this.context,
    t = this.theme,
    commands = this.residentSelection(),
    logicalWidth = Math.max(
      this.chosen.length === 1 ? 600 : 360,
      commands
        ? this.shelteredSelection()
          ? f32(f32(f32(8 * 72) + f32(7 * 6)) + 24)
          : f32(f32(f32(7 * 72) + f32(6 * 6)) + 24)
        : 0,
    ),
    scale = f32(panel.w / logicalWidth),
    box = (r: Rect) =>
      new Rect(
        f32(panel.x + f32(r.x * scale)),
        f32(panel.y + f32(r.y * scale)),
        f32(r.w * scale),
        f32(r.h * scale),
      ),
    text = (r: Rect, value: string, color: Color, size = 12, bold = false) =>
      c.text(
        box(r),
        c.elideText(value, f32(r.w * scale), f32(size * scale), bold),
        color,
        f32(size * scale),
        bold,
      ),
    portrait = (p: Person, frame: Rect) => {
      c.rect(frame, t.raised, t.radius, t.border);
      const mood = moodOf(p),
        backdrop = portraitBackdrop(this.town.map(), p.position, this.town.climate()),
        key = JSON.stringify([
          p.look,
          p.race,
          String(p.lookRevision),
          p.calling,
          frame.w,
          frame.h,
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
        entry = {
          key,
          paint: hudPaint(c, personPortrait(p, mood, f32(frame.w - 2), f32(frame.h - 2), backdrop)),
        };
        this.dockPortraits.set(p.id, entry);
      }
      c.add(entry.paint);
      entry.paint.transform({
        e11: 1,
        e12: 0,
        e13: f32(frame.x + 1),
        e21: 0,
        e22: 1,
        e23: f32(frame.y + 1),
        e31: 0,
        e32: 0,
        e33: 1,
      });
    };
  if (this.chosen.length === 1) {
    const p = this.town.person(this.chosen[0]);
    if (!p) return;
    portrait(p, box(new Rect(12, 12, 80, 84)));
    const nameWidth = Math.min(f32(logicalWidth - 288), f32(c.textWidth(p.name, 17, true) + 2));
    text(new Rect(104, 10, nameWidth, 22), p.name, t.text, 17, true);
    c.rect(box(new Rect(f32(112 + nameWidth), 12, 48, 18)), t.raised, f32(3 * scale));
    text(new Rect(f32(118 + nameWidth), 12, 40, 18), 'Lv. ' + p.level, t.accent, 11, true);
    text(
      new Rect(104, 34, 252, 18),
      raceName(p.race) +
        ' ' +
        callingName(p.calling) +
        (p.role === Role.Guest ? ' · guest' : p.faction > 0 ? ` · neutral #${p.faction}` : ' · resident'),
      t.accent,
    );
    const action =
      p.autoMode && !p.ordered && p.job < 0 && p.activity === Activity.Idle && p.moving()
        ? 'Looking for work'
        : (p.moving() ? 'on the way: ' : '') + activityName(p.activity);
    text(
      new Rect(104, 53, 252, 18),
      controlReason(p) || 'Action: ' + action,
      canControl(p) ? t.text : t.danger,
    );
    const home = this.town.building(p.role === Role.Resident ? p.home : p.bed);
    const shelter =
      (p.role === Role.Resident ? 'Home: ' : 'Bed: ') + (home ? structureSpec(home.kind).name : 'none');
    text(
      new Rect(104, 73, 252, 16),
      p.carrying ? 'Carrying ' + describe(resourceBundle(p.carriedProduct, p.carrying)) : shelter,
      p.carrying ? t.accent : t.muted,
      11,
    );
    const job = this.town.building(p.job);
    let work = job ? structureSpec(job.kind).name : 'no job';
    if (p.supplyTarget >= 0 && (p.task === Activity.Building || p.task === Activity.Roadwork)) {
      const site = p.supplyRoad ? null : this.town.building(p.supplyTarget);
      work = 'Construction: ' + (p.supplyRoad ? 'road' : site ? structureSpec(site.kind).name : 'site');
    }
    text(new Rect(104, 90, 252, 16), 'Purse ' + p.purse + ' gold · ' + work, t.muted, 11);
    const bar = (y: number, label: string, value: number, good: boolean) => {
      const x = 374,
        w = f32(f32(logicalWidth - x) - 12);
      text(new Rect(x, y, 46, 16), label, t.muted, 11);
      c.rect(box(new Rect(f32(x + 46), f32(y + 5), f32(w - 46), 6)), t.raised, f32(3 * scale));
      c.rect(
        box(new Rect(f32(x + 46), f32(y + 5), Math.max(2, f32(f32(w - 46) * value)), 6)),
        (good ? value : f32(1 - value)) < f32(0.3) ? t.danger : t.success,
        f32(3 * scale),
      );
    };
    bar(30, 'Food', p.food, true);
    bar(45, 'Water', p.hydration, true);
    bar(60, 'Rest', p.rest, true);
    bar(75, 'Health', p.health, true);
    bar(90, 'Stress', p.stress, false);
    const needed = p.experienceToNextLevel(),
      progress = needed ? 'XP ' + p.experience + ' / ' + needed : 'Max level';
    text(new Rect(12, 112, 112, 18), progress, t.accent, 11, true);
    const fraction = needed ? clamp(f32(p.experience / needed), 0, 1) : 1;
    c.rect(box(new Rect(132, 118, f32(logicalWidth - 144), 6)), t.raised, f32(3 * scale));
    if (fraction > 0)
      c.rect(box(new Rect(132, 118, f32(f32(logicalWidth - 144) * fraction), 6)), t.accent, f32(3 * scale));
    const tags = badges(c, this.town.conditions(p), f32(logicalWidth - 24));
    for (const tag of tags) {
      const r = new Rect(f32(tag.box.x + 12), f32(tag.box.y + 136), tag.box.w, tag.box.h);
      let color = positiveCondition(tag.condition) ? t.success : t.accent;
      if (
        tag.condition === Condition.Starving ||
        tag.condition === Condition.Wounded ||
        tag.condition === Condition.Distressed
      )
        color = t.danger;
      c.rect(box(r), t.raised, f32(3 * scale));
      text(new Rect(f32(r.x + 6), r.y, f32(r.w - 12), r.h), conditionName(tag.condition), color, 11);
    }
    const after = tags.length ? f32(158 + tags[f32(tags.length - 1)].box.y) : 136;
    if (p.past) text(new Rect(12, after, f32(logicalWidth - 24), 18), p.past, t.muted, 11);
  } else {
    text(
      new Rect(12, 10, f32(logicalWidth - 144), 22),
      this.chosen.length + ' units selected',
      t.text,
      15,
      true,
    );
    const columns = Math.max(1, Math.trunc(f32(f32(logicalWidth - 24) / 60)));
    let shown = 0;
    for (const id of this.chosen) {
      const p = this.town.person(id);
      if (!p || shown >= 20) continue;
      const x = f32(12 + f32((shown % columns) * 60)),
        y = f32(38 + f32(Math.trunc(f32(shown / columns)) * 60));
      portrait(p, box(new Rect(x, y, 52, 54)));
      c.rect(box(new Rect(f32(x + 3), f32(y + 3), 34, 14)), t.surface, f32(3 * scale));
      text(new Rect(f32(x + 5), f32(y + 3), 30, 14), 'Lv. ' + p.level, t.accent, 9, true);
      c.rect(box(new Rect(f32(x + 3), f32(y + 47), 46, 4)), t.raised, f32(2 * scale));
      c.rect(
        box(new Rect(f32(x + 3), f32(y + 47), Math.max(2, f32(46 * p.health)), 4)),
        p.health < f32(0.35) ? t.danger : t.success,
        f32(2 * scale),
      );
      c.control(
        'pick-person-' + id,
        box(new Rect(x, y, 52, 54)),
        (e) => {
          if (e.type === EventType.Activate) this.selectPeople([id]);
        },
        true,
        false,
      );
      shown++;
    }
  }
  if (commands) {
    const allAuto = this.chosen
      .filter((id) => canControl(this.town.person(id)))
      .every((id) => this.town.person(id)?.autoMode);
    button(
      c,
      'unit-auto',
      box(new Rect(f32(logicalWidth - 112), 10, 100, 24)),
      allAuto ? 'Auto ON  T' : 'Auto OFF  T',
      () => this.toggleAuto(),
      allAuto ? ButtonStyle.Primary : ButtonStyle.Default,
      true,
      Icon.None,
      false,
      { fontSize: f32(11 * scale) },
    );
    this.commandCard(
      new Rect(
        f32(panel.x + f32(12 * scale)),
        f32(f32(panel.y + panel.h) - f32(42 * scale)),
        f32(panel.w - f32(24 * scale)),
        f32(30 * scale),
      ),
      scale,
    );
  }
  for (const [id, entry] of this.dockPortraits)
    if (!this.chosen.includes(id)) {
      c.deferRelease(() => entry.paint.dispose());
      this.dockPortraits.delete(id);
    }
}
