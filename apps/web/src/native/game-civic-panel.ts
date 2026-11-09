import { Rect, ButtonStyle, button, type Color } from '../../../../packages/native-ui/src';
import { Structure, describe, structureSpec } from '../../../../packages/engine/src/building-catalog';
import { Activity, callingName } from '../../../../packages/engine/src/person';
import {
  isPlayerResident,
  isPlayerBuilding,
  canControl,
  buildingControlReason,
} from '../../../../packages/engine/src/faction';
import { reachOf } from '../../../../packages/engine/src/town-monsters';
import { copyNative } from '../../../../packages/engine/src/native-copy';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import type { Building } from '../../../../packages/engine/src/town-models';
import type { GameHudApp } from './game-hud-contract';
import { hudPaint } from './hud-paint';

export function civicInspector(this: GameHudApp, building: Building, panel: Rect, draw: boolean): number {
  const c = this.context,
    t = this.theme;
  const altar = building.kind === Structure.Shrine;
  const compact = this.viewHeight < 560;
  const h = compact ? 204 : 286;
  const residents = this.town.people().filter(isPlayerResident);
  if (!residents.some((p) => p.id === this.inspectorPerson)) this.inspectorPerson = residents[0]?.id ?? -1;
  const selected = residents.findIndex((p) => p.id === this.inspectorPerson);
  const person = residents[selected];
  if (!draw) return h;
  const x = panel.x + 12,
    w = panel.w - 24,
    y = panel.y;
  const line = (at: number, text: string, color: Color = t.text, size = 12, bold = false) =>
    c.text(new Rect(x, y + at, w, 20), c.elideText(text, w, size, bold), color, size, bold);
  line(9, structureSpec(building.kind).name, t.text, 17, true);
  line(
    compact ? 30 : 34,
    altar
      ? 'Pray here. A new resident arrives the following day.'
      : `Choose one class · ${building.trainingCount} residents trained`,
    t.muted,
    compact ? 10 : 12,
  );
  if (!isPlayerBuilding(building)) {
    line(64, `Neutral settlement #${this.town.building(building.id)!.faction}`, t.accent, 13, true);
    line(90, buildingControlReason(building), t.muted);
    return h;
  }
  const top = compact ? 52 : 66;
  const size = compact ? 44 : 60;
  if (person) {
    c.paint(
      JSON.stringify([
        'civic-portrait',
        person.id,
        person.look,
        person.race,
        String(person.lookRevision),
        person.calling,
        x,
        y + top,
        size,
      ]),
      () => {
        const paint = hudPaint(
          c,
          personPortrait(
            person,
            moodOf(person),
            size,
            size,
            portraitBackdrop(this.town.map(), person.position, this.town.climate()),
          ),
        );
        paint.translate(x, y + top);
        return paint;
      },
    );
    const navX = x + size + 8,
      nameW = w - size - 72;
    button(
      c,
      'civic-person-prev',
      new Rect(navX, y + top, 26, 26),
      '<',
      () => {
        this.inspectorPerson = residents[(selected + residents.length - 1) % residents.length].id;
      },
      ButtonStyle.Quiet,
      residents.length > 1,
    );
    c.text(
      new Rect(navX + 28, y + top, nameW, 26),
      c.elideText(person.name, nameW, 13, true),
      t.text,
      13,
      true,
    );
    button(
      c,
      'civic-person-next',
      new Rect(x + w - 26, y + top, 26, 26),
      '>',
      () => {
        this.inspectorPerson = residents[(selected + 1) % residents.length].id;
      },
      ButtonStyle.Quiet,
      residents.length > 1,
    );
    c.text(
      new Rect(navX, y + top + 26, w - size - 8, 18),
      `${callingName(person.calling)} · Level ${person.level} · ${selected + 1} / ${residents.length}`,
      t.muted,
      compact ? 10 : 11,
    );
  } else line(top, 'No residents are available.', t.muted);
  if (altar) {
    const status = this.town.altarStatus(building.id);
    const preparing = this.town
      .people()
      .find((p) => p.health > 0 && p.task === Activity.Praying && p.taskSite === building.id);
    const reason = person
      ? this.town.prayerReason(person.id, building.id)
      : 'A resident must visit the altar.';
    line(
      compact ? 104 : 140,
      status.pendingBirths
        ? `Resident expected on day ${status.dueDay + 1}`
        : preparing
          ? `${preparing.name}: prayer in progress`
          : 'No resident expected yet',
      status.pendingBirths ? t.success : t.muted,
      12,
      true,
    );
    line(
      compact ? 123 : 165,
      `Offering: ${describe(status.cost)} · paid when the prayer finishes`,
      t.muted,
      compact ? 10 : 11,
    );
    line(
      compact ? 144 : 198,
      reason || 'Walk to the altar and pray for 5 seconds.',
      reason ? t.danger : t.muted,
      compact ? 10 : 11,
    );
    button(
      c,
      'altar-pray',
      new Rect(x, y + h - 39, w, 28),
      preparing ? 'Prayer in progress' : 'Pray for a resident',
      () => {
        if (
          person &&
          canControl(this.town.person(person.id)) &&
          this.town.orderPrayAtAltar([person.id], building.id)
        )
          this.status = 'Prayer ordered';
        else this.status = person ? this.town.prayerReason(person.id, building.id) : reason;
      },
      ButtonStyle.Primary,
      !!person && !preparing && !reason && canControl(person),
    );
  } else {
    const options = person ? this.town.guildTrainingOptions(person.id, building.id) : [];
    const option = options.find((option) => option.calling === this.inspectorCalling) ?? options[0];
    if (option) this.inspectorCalling = option.calling;
    const tabsY = compact ? 103 : 139,
      tabW = (w - 16) / 5;
    for (let i = 0; i < options.length; ++i) {
      const choice = options[i];
      button(
        c,
        `guild-class-${choice.calling}`,
        new Rect(x + i * (tabW + 4), y + tabsY, tabW, 25),
        choice.name,
        () => {
          this.inspectorCalling = choice.calling;
        },
        choice === option ? ButtonStyle.Primary : ButtonStyle.Default,
        true,
      );
    }
    if (person && option) {
      // Preview only the class field; health, level and equipment remain this resident's.
      const preview = copyNative(person);
      preview.calling = option.calling;
      line(
        compact ? 131 : 171,
        `Power ${this.town.power(preview).toFixed(1)} · Reach ${reachOf(preview).toFixed(1)} · Vitality ${preview.vitalityMultiplier().toFixed(1)}x`,
        t.accent,
        compact ? 10 : 12,
        true,
      );
      if (!compact) line(195, option.description, t.muted, 11);
      const training = person.task === Activity.Training && person.taskSite === building.id;
      const reason = option.reason;
      line(
        compact ? 147 : 220,
        training
          ? `Training ordered: ${callingName(person.trainingCalling)}`
          : reason || `${describe(option.cost)} · permanent class choice`,
        reason ? t.danger : t.muted,
        compact ? 9 : 11,
      );
      button(
        c,
        'guild-train',
        new Rect(x, y + h - 39, w, 28),
        training ? 'Training in progress' : `Train as ${option.name}`,
        () => {
          if (
            canControl(this.town.person(person.id)) &&
            this.town.orderTrainAtGuild(person.id, building.id, option.calling)
          )
            this.status = 'Training ordered';
          else this.status = this.town.trainingReason(person.id, building.id, option.calling);
        },
        ButtonStyle.Primary,
        !training && !reason && canControl(person),
      );
    }
  }
  return h;
}
