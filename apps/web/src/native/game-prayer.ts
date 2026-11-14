import {
  Rect,
  Align,
  ButtonStyle,
  EventType,
  Key,
  TextInput,
  button,
  textField,
  rgba,
  setTransform,
} from '../../../../packages/native-ui/src';
import { Resources, Structure } from '../../../../packages/engine/src/building-catalog';
import { Activity, callingName, type Person } from '../../../../packages/engine/src/person';
import {
  offeringKeys,
  defaultOffering,
  offeringGradeOf,
  gradeNameInSentence,
  offeringAcceptedText,
  refusalWord,
  OfferingGrade,
  type OfferingKey,
} from '../../../../packages/engine/src/prayer-offering';
import { altarCap } from '../../../../packages/engine/src/altar-cap';
import { canControl } from '../../../../packages/engine/src/faction';
import { copyNative } from '../../../../packages/engine/src/native-copy';
import { weatherName } from '../../../../packages/engine/src/climate';
import type { Town } from '../../../../packages/engine/src/town';
import { TownState } from '../../../../packages/engine/src/town-state';
import { OfferingScene, offeringIcon } from '../../../../packages/native-renderer/src/offering-scene';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { WebCanvasAdapter } from '../../../../packages/native-renderer/src/webcanvas-adapter';
import { riteTimeline, type RiteTimeline } from '../../../../packages/native-renderer/src/offering-rite';
import { reducedMotionPreferred } from './game-theme';
import { riteCues, riteEnding, riteSound, type RiteCue } from './offering-rite-sound';
import type { GameAppState } from './game-app-state';
import type { AppEvent } from './application-contracts';
import { hudPaint } from './hud-paint';
import type { Building } from '../../../../packages/engine/src/town-models';

const resourceNames: Record<OfferingKey, string> = {
  water: 'Water',
  bones: 'Bones',
  gold: 'Gold',
  food: 'Food',
  stone: 'Stone',
};
const resourceHints: Record<OfferingKey, string> = {
  water: 'Water favors Clerics and Mages.',
  bones: 'Bones strengthen vitality and favor Warriors.',
  gold: 'Gold raises specialist odds; favors Mages and Bards.',
  food: 'Food strengthens vitality and favors Rangers.',
  stone: 'Stone raises potential level; favors Warriors and Clerics.',
};
export function altarInspector(this: GameAppState, building: Building, panel: Rect, draw: boolean): number {
  const h = this.viewHeight < 560 ? 118 : 148;
  if (!draw) return h;
  const c = this.context,
    t = this.theme,
    x = panel.x + 12,
    w = panel.w - 24;
  c.text(new Rect(x, panel.y + 8, w, 24), 'Altar of Odin', t.text, 17, true);
  c.text(new Rect(x, panel.y + 37, w, 19), 'Shape a new life from an offering.', t.muted, 12);
  if (h > 120) c.text(new Rect(x, panel.y + 62, w, 26), 'Water · Bones · Gold · Food · Stone', t.accent, 11);
  button(
    c,
    'altar-pray',
    new Rect(x, panel.y + h - 39, w, 28),
    'Prepare an offering',
    () => openPrayer.call(this, building.id),
    ButtonStyle.Primary,
    building.built() && building.faction === this.town.controlFaction && building.health > 0,
  );
  return h;
}

export interface PrayerDialog {
  town: Town;
  altar: number;
  previousPaused: boolean;
  started: number;
  finished: boolean;
  committed: boolean;
  born: Person | null;
  /** Odin turned the gifts away at the end of the rite. */
  refused: boolean;
  error: string;
  offering: Resources;
  inputs: Record<OfferingKey, TextInput>;
  scene: OfferingScene;
  adapter: WebCanvasAdapter;
  hour: string;
  /** Set when the player offers: the beats of the rite for this offering's grade. */
  rite: RiteTimeline | null;
  schedule: RiteCue[];
  heard: number;
}

export function openPrayer(this: GameAppState, altar: number): void {
  const place = this.town.building(altar);
  if (
    this.prayer ||
    !place?.built() ||
    place.health <= 0 ||
    place.kind !== Structure.Shrine ||
    place.faction !== this.town.controlFaction
  )
    return;
  const village = this.town.settlementOf(place),
    offering = defaultOffering(),
    climate = copyNative(this.town.climate()),
    people = this.town
      .people()
      .filter(
        (p) =>
          canControl(p, this.town.controlFaction) &&
          this.town.settlementOf(p) === village &&
          p.activity !== Activity.Expedition,
      )
      .slice(0, 3)
      .map(copyNative);
  const minutes = Math.floor(
    ((this.town.clock() % TownState.secondsPerDay) / TownState.secondsPerDay) * 24 * 60 + 1e-7,
  );
  this.prayer = {
    town: this.town,
    altar,
    previousPaused: this.paused,
    started: -1,
    finished: false,
    committed: false,
    born: null,
    refused: false,
    error: '',
    offering,
    inputs: Object.fromEntries(
      offeringKeys.map((key) => [key, new TextInput(offering[key] ? String(offering[key]) : '')]),
    ) as Record<OfferingKey, TextInput>,
    scene: new OfferingScene(
      climate,
      people,
      portraitBackdrop(this.town.map(), place.center, climate),
      reducedMotionPreferred(),
    ),
    adapter: new WebCanvasAdapter(this.context.tvg),
    hour: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    rite: null,
    schedule: [],
    heard: 0,
  };
  this.paused = true;
  this.pan.x = this.pan.y = 0;
  this.context.cancelPointer();
}

export function closePrayer(this: GameAppState): void {
  const state = this.prayer;
  if (!state || (state.started >= 0 && !state.finished)) return;
  this.prayer = null;
  this.paused = state.previousPaused;
  // Context.end first detaches the borrowed scene from the previous modal frame.
  this.context.deferRelease(() => state.adapter.dispose());
}

/** Consume the entire input stream while modal: shortcuts and map orders cannot unpause or alter the rite. */
export function handlePrayerEvent(this: GameAppState, event: AppEvent): boolean {
  if (!this.prayer) return false;
  const c = this.context;
  if (event.type === 'PointerMove') c.pointerMove(event.x, event.y);
  else if (event.type === 'PointerDown' && event.button === 1) c.pointerDown(event.x, event.y);
  else if (event.type === 'PointerUp' && event.button === 1) c.pointerUp(event.x, event.y);
  else if (event.type === 'PointerCancel') c.cancelPointer();
  else if (event.type === 'KeyDown') c.key(event.key, event.shift);
  else if (event.type === 'Text' && /^[0-9]+$/.test(event.text) && event.text.length <= 4)
    c.textInput(event.text);
  return true;
}

export function renderPrayer(this: GameAppState, width: number, height: number): void {
  const state = this.prayer;
  if (!state) return;
  if (state.town !== this.town) {
    state.finished = true;
    closePrayer.call(this);
    return;
  }
  const c = this.context,
    t = this.theme,
    now = c.time();
  for (const key of offeringKeys)
    if (state.started < 0) {
      const input = state.inputs[key];
      if (input.value.length > 4) {
        input.value = input.value.slice(0, 4);
        input.cursor = input.byteLength();
      }
      state.offering[key] = input.value === '' ? 0 : Number(input.value);
    }
  const elapsed = state.started < 0 ? -1 : Math.max(0, now - state.started);
  const rite = state.rite;
  while (
    rite &&
    elapsed >= 0 &&
    state.heard < state.schedule.length &&
    state.schedule[state.heard].at <= elapsed
  )
    this.cues.push(riteSound(state.schedule[state.heard++]));
  if (rite && elapsed >= rite.release && !state.committed) {
    state.committed = true;
    state.error = this.town.altarOfferingReason(state.altar, state.offering);
    if (!state.error) {
      const result = this.town.offerAtAltar(state.altar, state.offering);
      state.born = result.born;
      state.refused = result.refused;
    }
    state.schedule.push(...riteEnding(rite, state.refused));
    if (!state.born && !state.refused)
      state.error ||= 'The offering could not be completed. No resources were consumed.';
  }
  state.finished = !!rite && elapsed >= rite.end;
  c.modal(state.started < 0 ? 'offering-food' : 'prayer-return', () => closePrayer.call(this));
  c.control(
    'prayer-backdrop',
    new Rect(0, 0, width, height),
    (event) => {
      if (event.type === EventType.Activate) closePrayer.call(this);
    },
    true,
    false,
  );
  c.rect(new Rect(0, 0, width, height), rgba(6, 10, 13, 210));
  const w = Math.min(1000, width - 24),
    h = Math.min(690, height - 24),
    panel = new Rect((width - w) / 2, (height - h) / 2, w, h),
    wide = w >= 720 || (w >= 550 && h < 480),
    short = h < 490,
    header = short ? 42 : 56,
    footer = short ? 46 : 64;
  c.control('prayer-panel', panel, undefined, true, false);
  c.rect(panel, rgba(31, 39, 39), 6, rgba(145, 155, 130));
  c.text(
    new Rect(panel.x + 18, panel.y + 10, w - 36, 24),
    'AN OFFERING TO ODIN',
    t.text,
    short ? 15 : 19,
    true,
  );
  if (!short)
    c.text(
      new Rect(panel.x + 18, panel.y + 33, w - 36, 17),
      `${state.hour} · ${weatherName(state.scene.climate.weather)} · Settlement paused`,
      t.muted,
      11,
    );
  const bodyH = h - header - footer,
    sceneW = wide ? Math.max(220, w * 0.59 - 22) : w - 28,
    sceneH = wide ? bodyH : Math.min(240, bodyH * 0.46),
    stage = new Rect(panel.x + 14, panel.y + header, sceneW, sceneH),
    form = wide
      ? new Rect(stage.x + sceneW + 18, stage.y, w - sceneW - 46, bodyH)
      : new Rect(panel.x + 14, stage.y + sceneH + 8, w - 28, bodyH - sceneH - 8);
  state.scene.update(stage.w, stage.h, now, elapsed, state.offering, state.born, state.refused);
  c.clip(stage, () => {
    const paint = state.adapter.sync(state.scene.root);
    setTransform(paint, {
      e11: 1,
      e12: 0,
      e13: stage.x,
      e21: 0,
      e22: 1,
      e23: stage.y,
      e31: 0,
      e32: 0,
      e33: 1,
    });
    c.add(paint);
    state.adapter.collect([state.scene.root]);
  });
  const reading = offeringGradeOf(
      state.offering,
      this.town.stock(this.town.settlementOf(this.town.building(state.altar)!)),
    ),
    reason = state.started < 0 ? this.town.altarOfferingReason(state.altar, state.offering) : state.error,
    text = (y: number, value: string, color = t.text, size = 12, bold = false) =>
      c.text(new Rect(form.x, y, form.w, 22), c.elideText(value, form.w, size, bold), color, size, bold);
  if (state.started < 0) {
    let hint = '';
    const stock = this.town.stock(this.town.settlementOf(this.town.building(state.altar)!)),
      rowH = Math.min(wide ? 52 : 36, Math.max(25, (form.h - (wide && !short ? 128 : short ? 50 : 84)) / 5));
    offeringKeys.forEach((key, i) => {
      const y = form.y + rowH * i,
        iconSize = Math.min(30, rowH - 4);
      c.paint(JSON.stringify(['offering-icon', key, form.x, y, iconSize]), () => {
        const node = offeringIcon(key),
          scale = iconSize / 30;
        node.transform([scale, 0, form.x + iconSize / 2, 0, scale, y + rowH / 2, 0, 0, 1]);
        return hudPaint(c, node);
      });
      const controlsX = form.x + form.w - 132,
        labelX = form.x + iconSize + 7;
      const info = c.control(
        'offering-info-' + key,
        new Rect(form.x, y, controlsX - form.x - 3, rowH),
        undefined,
        true,
        false,
      );
      if (info.hovered) {
        hint = resourceHints[key];
        c.rect(new Rect(labelX - 3, y + 1, Math.max(1, controlsX - labelX - 4), rowH - 2), t.raised, 3);
      }
      c.text(
        new Rect(labelX, y, Math.max(25, controlsX - labelX - 4), rowH * 0.55),
        resourceNames[key],
        t.text,
        12,
        true,
      );
      c.text(
        new Rect(labelX, y + rowH * 0.5, Math.max(25, controlsX - labelX - 4), rowH * 0.45),
        `${stock[key]} available`,
        t.muted,
        10,
      );
      const step = (delta: number) => {
        const next = Math.max(0, Math.min(9999, stock[key], Number(state.inputs[key].value || 0) + delta));
        state.inputs[key].value = String(next);
        state.inputs[key].cursor = state.inputs[key].byteLength();
      };
      button(
        c,
        `offering-less-${key}`,
        new Rect(controlsX, y + 2, 25, rowH - 4),
        '−',
        () => step(-1),
        ButtonStyle.Quiet,
        state.offering[key] > 0,
      );
      textField(
        c,
        `offering-${key}`,
        new Rect(controlsX + 28, y + 2, 44, rowH - 4),
        state.inputs[key],
        '0',
        true,
        undefined,
        undefined,
        { fontSize: 12 },
      );
      button(
        c,
        `offering-more-${key}`,
        new Rect(controlsX + 75, y + 2, 25, rowH - 4),
        '+',
        () => step(1),
        ButtonStyle.Quiet,
        state.offering[key] < Math.min(9999, stock[key]),
      );
      button(
        c,
        `offering-more10-${key}`,
        new Rect(controlsX + 103, y + 2, 29, rowH - 4),
        '+10',
        () => step(10),
        ButtonStyle.Quiet,
        state.offering[key] < Math.min(9999, stock[key]),
        undefined,
        false,
        { fontSize: 10 },
      );
    });
    const y = form.y + rowH * 5 + 5;
    const people = this.town.population(),
      cap = altarCap(this.town),
      lines: [string, typeof t.text, boolean][] = [
        [`${reading.name} offering`, t.accent, true],
        [reading.line, t.text, false],
        [
          reading.favoured === null
            ? 'No calling is favoured yet.'
            : `Leans toward ${callingName(reading.favoured)}s.`,
          t.muted,
          false,
        ],
        [refusalWord(reading.grade), t.muted, false],
        [nextGradeLine(reading), t.muted, false],
        [
          `Odin sends up to ${cap} residents; ${people} live here.`,
          people >= cap ? t.danger : t.muted,
          false,
        ],
      ];
    const shown =
      wide && !short ? lines : short ? [lines[0], lines[5]] : [lines[0], lines[1], lines[3], lines[5]];
    shown.forEach(([value, color, bold], i) =>
      text(y + i * (i ? 19 : 22) + (i ? 3 : 0), value, color, i ? 11 : wide ? 15 : 13, bold),
    );
    if (hint) {
      const tip = new Rect(stage.x + 6, stage.y + stage.h - 26, stage.w - 12, 22);
      c.rect(tip, rgba(10, 18, 20, 230), 3);
      c.text(tip.inset(5), c.elideText(hint, tip.w - 10, 10), t.text, 10);
    }
  } else {
    const title = state.error
      ? 'The rite could not be completed'
      : !rite || elapsed < rite.bows[0]
        ? 'Lay the offering before Odin'
        : elapsed < rite.answer
          ? 'A prayer for a new life'
          : elapsed < rite.release
            ? 'Odin answers'
            : state.refused
              ? 'Odin turns the offering away'
              : state.born
                ? `${state.born.name} has joined`
                : 'A new life awakens';
    text(form.y + 12, title, state.error ? t.danger : t.accent, wide ? 17 : 14, true);
    if (state.born && rite) {
      text(form.y + 46, offeringAcceptedText(rite.grade), t.muted, 12);
      text(form.y + 74, `${callingName(state.born.calling)} · Level ${state.born.level}`, t.text, 15, true);
      text(form.y + 100, 'Arrives without equipment', t.muted, 12);
    } else if (state.refused) {
      text(form.y + 46, 'The offering was refused. The gifts are gone.', t.muted, 12);
      text(form.y + 74, 'No one came.', t.text, 15, true);
    } else {
      text(form.y + 45, 'The offerings become a resident.', t.muted);
      if (wide) text(form.y + 70, 'Time stands still for the settlement.', t.muted, 11);
    }
    if (wide)
      offeringKeys
        .filter((key) => state.offering[key] > 0)
        .forEach((key, i) =>
          text(form.y + 150 + i * 24, `${resourceNames[key]}  ${state.offering[key]}`, t.muted, 12),
        );
    const progress = rite ? Math.max(0, Math.min(1, elapsed / rite.end)) : 0;
    c.rect(new Rect(form.x, form.y + form.h - 9, form.w, 3), t.border, 1);
    c.rect(new Rect(form.x, form.y + form.h - 9, form.w * progress, 3), t.accent, 1);
  }
  const bottom = panel.y + h - footer;
  if (state.started < 0) {
    const note = reason || 'Food & bones strengthen life. Other offerings shape aptitude and calling.';
    c.text(
      new Rect(panel.x + 16, bottom + 3, w - 32, short ? 14 : 18),
      c.elideText(note, w - 32, 11),
      reason ? t.danger : t.muted,
      11,
    );
    button(
      c,
      'prayer-confirm',
      new Rect(panel.x + 16, bottom + (short ? 18 : 26), w - 32, short ? 25 : 30),
      'Offer & pray',
      () => {
        const gift = new Resources();
        for (const key of offeringKeys) gift[key] = Number(state.inputs[key].value || 0);
        const blocked = this.town.altarOfferingReason(state.altar, gift);
        if (blocked) {
          state.error = blocked;
          return;
        }
        state.started = c.time();
        state.offering = gift;
        state.error = '';
        const keys = offeringKeys.filter((key) => gift[key] > 0),
          rite = riteTimeline(offeringGradeOf(gift).grade, keys.length, state.scene.worshipperCount);
        state.rite = rite;
        state.schedule = riteCues(rite, keys, state.scene.worshipperCount);
        state.heard = 0;
        state.scene.begin(rite);
      },
      ButtonStyle.Primary,
      !reason,
    );
  } else if (state.finished) {
    button(
      c,
      'prayer-return',
      new Rect(panel.x + 16, bottom + 14, w - 32, 30),
      'Return to settlement',
      () => closePrayer.call(this),
      ButtonStyle.Primary,
    );
  } else
    c.text(
      new Rect(panel.x + 16, bottom + 12, w - 32, 26),
      'The rite is in progress',
      t.muted,
      12,
      false,
      Align.Center,
    );
  // Frozen game time must not freeze prayer, weather particles or modal feedback.
  c.requestAnimationFrame();
}

function nextGradeLine(reading: ReturnType<typeof offeringGradeOf>): string {
  if (reading.next)
    return `Lay more ${reading.next.resource} to reach a ${gradeNameInSentence(reading.next.grade)} offering.`;
  return reading.grade === OfferingGrade.Kingly
    ? 'No offering could be greater.'
    : 'The stores hold too little to raise it further.';
}
