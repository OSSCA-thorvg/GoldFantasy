import { Rect, Align, ButtonStyle, button, rgba, type Color } from '../../../../packages/native-ui/src';
import {
  Role,
  Activity,
  callingName,
  raceName,
  activityName,
  type Person,
} from '../../../../packages/engine/src/person';
import { structureSpec } from '../../../../packages/engine/src/building-catalog';
import { personPortrait, moodOf } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { injuryOf } from '../../../../packages/engine/src/person-look';
import {
  isPlayerResident,
  canControl,
  controlReason,
  belongsToFaction,
} from '../../../../packages/engine/src/faction';
import { hudPaint } from './hud-paint';
import type { GameHudApp } from './game-hud-contract';

export function rosterBounds(this: GameHudApp, width: number, height: number): Rect {
  const w = Math.min(880, width - 24),
    h = Math.max(1, Math.min(height - 68, 408, Math.max(270, height - 154)));
  return new Rect((width - w) / 2, height - h - 56, w, h);
}
export function rosterPanel(this: GameHudApp, panel: Rect): void {
  const c = this.context,
    t = this.theme;
  const short = panel.h < 400;
  const micro = panel.h < 270;
  const stone = rgba(37, 39, 34),
    ochre = rgba(176, 151, 101),
    ink = rgba(226, 215, 188);
  c.rect(panel.inset(2), stone, 3, ochre);
  // A shallow interlocking frieze evokes a painted hall without covering portraits.
  c.paint(JSON.stringify(['oath-frieze', panel.x, panel.y, panel.w]), () => {
    const path = new c.tvg.Shape();
    for (let x = panel.x + 12; x < panel.x + panel.w - 18; x += 24)
      path
        .moveTo(x, panel.y + 9)
        .lineTo(x + 8, panel.y + 15)
        .lineTo(x + 16, panel.y + 9)
        .lineTo(x + 24, panel.y + 15);
    return path.stroke({ width: 1, color: [176, 151, 101, 100] });
  });
  c.text(
    new Rect(panel.x + 16, panel.y + (short ? 13 : 21), panel.w - 58, short ? 21 : 25),
    'SETTLEMENT HALL',
    ink,
    17,
    true,
  );
  button(
    c,
    'roster-close',
    new Rect(panel.x + panel.w - 40, panel.y + (panel.y < 52 ? 42 : 20), 26, 25),
    'X',
    () => {
      this.rosterOpen = false;
    },
    ButtonStyle.Quiet,
  );
  const tabY = panel.y + (short ? 36 : 52),
    tabW = Math.min(132, (panel.w - 32) / 2);
  for (const tab of ['units', 'guests'] as const) {
    const x = panel.x + 14 + (tab === 'guests' ? tabW + 6 : 0);
    button(
      c,
      `roster-tab-${tab}`,
      new Rect(x, tabY, tabW, 27),
      tab === 'units' ? 'Units' : 'Guests',
      () => {
        this.rosterTab = tab;
        this.rosterPage = 0;
        this.rosterSelected = '';
      },
      this.rosterTab === tab ? ButtonStyle.Primary : ButtonStyle.Quiet,
    );
  }
  const entries = this.town
    .people()
    .filter((p) =>
      this.rosterTab === 'guests'
        ? p.role === Role.Guest && belongsToFaction(p) && p.health > 0 && p.activity !== Activity.Leaving
        : isPlayerResident(p),
    )
    .map((person) => ({ key: `${this.rosterTab}:${person.id}`, person }));
  const listX = panel.x + 14,
    top = panel.y + (short ? 68 : 91),
    leftW = Math.max(108, Math.min(252, panel.w * 0.36));
  const rows = Math.max(2, Math.min(4, Math.floor((panel.h - 129) / 66)));
  const pages = Math.max(1, Math.ceil(entries.length / rows));
  this.rosterPage = Math.max(0, Math.min(pages - 1, this.rosterPage));
  if (!entries.some((entry) => entry.key === this.rosterSelected))
    this.rosterSelected = entries[this.rosterPage * rows]?.key ?? '';
  const portrait = (p: Person, frame: Rect) => {
    const mood = moodOf(p),
      backdrop = portraitBackdrop(this.town.map(), p.position, this.town.climate());
    const key = JSON.stringify([
      'roster',
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
      entry = { key, paint: hudPaint(c, personPortrait(p, mood, frame.w, frame.h, backdrop)) };
      this.dockPortraits.set(p.id, entry);
    }
    c.add(entry.paint);
    entry.paint.transform({
      e11: 1,
      e12: 0,
      e13: frame.x,
      e21: 0,
      e22: 1,
      e23: frame.y,
      e31: 0,
      e32: 0,
      e33: 1,
    });
    c.rect(frame, rgba(0, 0, 0, 0), 2, ochre);
  };
  const visible = entries.slice(this.rosterPage * rows, (this.rosterPage + 1) * rows);
  for (let i = 0; i < visible.length; ++i) {
    const entry = visible[i],
      row = new Rect(listX, top + i * 66, leftW, 60);
    const active = entry.key === this.rosterSelected;
    button(
      c,
      `roster-person-${entry.key}`,
      row,
      '',
      () => {
        this.rosterSelected = entry.key;
      },
      active ? ButtonStyle.Primary : ButtonStyle.Default,
    );
    // List portraits use separate retained instances from the large profile.
    c.paint(
      JSON.stringify([
        'roster-thumb',
        entry.person.look,
        entry.person.race,
        String(entry.person.lookRevision),
        entry.person.calling,
        row.x,
        row.y,
      ]),
      () => {
        const paint = hudPaint(
          c,
          personPortrait(
            entry.person,
            moodOf(entry.person),
            36,
            46,
            portraitBackdrop(this.town.map(), entry.person.position, this.town.climate()),
          ),
        );
        paint.translate(row.x + 5, row.y + 7);
        return paint;
      },
    );
    const textX = row.x + 46,
      w = Math.max(10, row.w - 51);
    c.text(
      new Rect(textX, row.y + 8, w, 24),
      c.elideText(entry.person.name, w, 12, true),
      active ? t.accentText : ink,
      12,
      true,
    );
    c.text(
      new Rect(textX, row.y + 32, w, 20),
      c.elideText(callingName(entry.person.calling), w, 11),
      active ? t.accentText : ochre,
      11,
    );
  }
  const pagerY = panel.y + panel.h - 33;
  button(
    c,
    'roster-prev',
    new Rect(listX, pagerY, 28, 22),
    '<',
    () => {
      --this.rosterPage;
      this.rosterSelected = '';
    },
    ButtonStyle.Quiet,
    this.rosterPage > 0,
  );
  c.text(
    new Rect(listX + 30, pagerY, leftW - 60, 22),
    `${this.rosterPage + 1} / ${pages}`,
    ochre,
    11,
    false,
    Align.Center,
  );
  button(
    c,
    'roster-next',
    new Rect(listX + leftW - 28, pagerY, 28, 22),
    '>',
    () => {
      ++this.rosterPage;
      this.rosterSelected = '';
    },
    ButtonStyle.Quiet,
    this.rosterPage < pages - 1,
  );
  const detail = new Rect(listX + leftW + 14, top, panel.w - leftW - 42, panel.h - 104);
  c.line(detail.x - 7, top, detail.x - 7, panel.y + panel.h - 15, rgba(176, 151, 101, 80));
  const selected = entries.find((entry) => entry.key === this.rosterSelected);
  if (!selected) {
    c.text(
      detail,
      this.rosterTab === 'guests'
        ? 'No guests are visiting the settlement.'
        : 'No player residents are available.',
      ochre,
      12,
    );
    return;
  }
  const p = selected.person,
    compact = detail.w < 300 || short;
  const split = short && detail.w > 400;
  const meta = split ? new Rect(detail.x + 200, top + 43, detail.w - 200, detail.h) : detail;
  const text = (y: number, label: string, color: Color = ink, size = 12, bold = false) =>
    c.text(
      new Rect(meta.x, y, meta.w, short ? 16 : 22),
      c.elideText(label, meta.w, size, bold),
      color,
      size,
      bold,
    );
  c.text(
    new Rect(detail.x, top, detail.w, 23),
    c.elideText(p.name, detail.w, compact ? 14 : 19, true),
    ink,
    compact ? 14 : 19,
    true,
  );
  c.text(
    new Rect(detail.x, top + (short ? 21 : 24), detail.w, 21),
    `${raceName(p.race)} · ${callingName(p.calling)} · Level ${p.level}`,
    ochre,
    compact ? 10 : 12,
  );
  const frame = new Rect(
    detail.x,
    top + (short ? 43 : 53),
    micro ? 32 : short ? 40 : compact ? 64 : 100,
    micro ? 36 : short ? 46 : compact ? 80 : 116,
  );
  portrait(p, frame);
  const sx = frame.x + frame.w + 12,
    sw = split ? 140 : detail.w - frame.w - 12;
  const stat = (row: number, value: string) =>
    c.text(
      new Rect(sx, frame.y + row * (micro ? 13 : short ? 15 : 23), sw, short ? 13 : 22),
      c.elideText(value, sw, compact ? 11 : 13),
      ink,
      compact ? 11 : 13,
    );
  stat(0, `Power ${this.town.power(p).toFixed(1)}`);
  stat(1, `Vitality ${p.vitalityMultiplier().toFixed(1)}x`);
  stat(2, `Health ${Math.round(p.health * 100)}%`);
  if (!compact) {
    stat(3, `Gear ${p.gear}`);
    c.text(new Rect(sx, top + 150, sw, 24), c.elideText(p.past, sw, 11), ochre, 11);
  }
  const y = split ? top + 43 : top + (micro ? 84 : short ? 92 : compact ? 144 : 182);
  const footer = new Rect(meta.x, panel.y + panel.h - 43, meta.w, 29);
  if (p.role === Role.Guest) {
    const lodging = this.town.building(p.bed);
    text(y, lodging ? `Lodging: ${structureSpec(lodging.kind).name}` : 'Looking for lodging', ochre, 12);
    text(y + (short ? 17 : 23), `${activityName(p.activity)} · Purse ${p.purse} gold`, ink, 11);
    text(y + (short ? 34 : 46), 'Visitors pay for lodging and services.', t.muted, 10);
    button(
      c,
      'roster-focus',
      footer,
      'Inspect guest',
      () => {
        this.rosterOpen = false;
        this.selectPeople([p.id]);
      },
      ButtonStyle.Primary,
    );
  } else {
    const job = this.town.building(p.job);
    text(y, job ? structureSpec(job.kind).name : 'Available for settlement work', ochre, 12);
    text(
      y + (short ? 17 : 23),
      controlReason(p) || activityName(p.activity),
      canControl(p) ? ink : t.danger,
      11,
    );
    text(
      y + (short ? 34 : 46),
      `Food ${Math.round(p.food * 100)}% · Water ${Math.round(p.hydration * 100)}% · Rest ${Math.round(p.rest * 100)}%`,
      t.muted,
      10,
    );
    button(
      c,
      'roster-focus',
      footer,
      canControl(p) ? 'Select unit' : 'Inspect unit',
      () => {
        this.rosterOpen = false;
        this.selectPeople([p.id]);
      },
      ButtonStyle.Primary,
    );
  }
}
