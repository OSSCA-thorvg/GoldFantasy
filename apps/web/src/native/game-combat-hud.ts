// Fighting, rescue and loss in the player's hands, eyes and ears.
import type { Paint } from '@thorvg/webcanvas';
import { translate } from '../../../../packages/localization/src/index';
import { Rect, Align, ButtonStyle, button, type Context, type Color } from '../../../../packages/native-ui/src';
import { Person, Role, Activity, callingName, type Monster } from '../../../../packages/engine/src/person';
import { CombatCue, type CombatEvent, type Fallen } from '../../../../packages/engine/src/combat-events';
import { canControl, isPlayerResident } from '../../../../packages/engine/src/faction';
import { distance, project, type Point } from '../../../../packages/engine/src/geometry';
import { f32, clamp, hash01 } from '../../../../packages/engine/src/numeric';
import { toolStructure } from '../../../../packages/engine/src/game-tools';
import { worldName } from '../../../../packages/engine/src/world-map';
import { injuryOf, Mood } from '../../../../packages/engine/src/person-look';
import type { Town } from '../../../../packages/engine/src/town';
import { personPortrait } from '../../../../packages/native-renderer/src/person-portrait';
import { portraitBackdrop } from '../../../../packages/native-renderer/src/portrait-background';
import { Cue, Sound, VoiceLine } from '../../../../packages/native-audio/src';
import { combatSounds, CombatSoundState } from './game-combat-sound';
import { swarmBanner, swarmFrame, waveWarning } from './swarm-hud';
import { hudPaint } from './hud-paint';
import type { GameAppState } from './game-app-state';
import type { GameHudApp } from './game-hud-contract';

interface AutoPause {
  title: string;
  detail: string;
  at: Point;
  /** Downed resident or guardian to look at; -1 for none. */
  person: number;
  creature: number;
}
/** Combat HUD bookkeeping, owned by one game app and reset whenever its town is replaced. */
export class CombatHudState {
  town: object | null = null;
  heardEvent = 0n;
  fallenSeen = 0;
  guardianEngaged = -1;
  realmRevision = -1;
  memorials: Fallen[] = [];
  autoPause: AutoPause | null = null;
  portraits = new Map<string, { key: string; paint: Paint }>();
  drawn = new Set<string>();
  lastClick = { id: '', at: -1 };
  sound = new CombatSoundState();
  dispose(): void {
    for (const entry of this.portraits.values()) entry.paint.dispose();
    this.portraits.clear();
  }
}
export interface CombatFrameApp extends GameAppState {
  spatial(cue: Cue, at: Point): Sound;
  sayLine(id: number, line: VoiceLine): boolean;
  gameSpeed(): number;
}
export interface CombatKeyApp extends GameAppState {
  selectPeople(ids: readonly number[]): void;
}
export const combatHints = [
  'Q / W skills  ·  H hold  ·  S stop  ·  R recall',
  'M move past enemies  ·  A attack-move  ·  ` party',
  'Ctrl+1-9 make a group, 1-9 select it',
  'Right-click a downed ally to revive  ·  Space pause',
];

// ---------------------------------------------------------------- shared bits

export function wrapText(c: Context, text: string, width: number, size: number, lines = 3, bold = false): string[] {
  // Translate before breaking: a line of a sentence is not a phrase the tables know.
  text = translate(text);
  const rows: string[] = [];
  let row = '';
  for (const word of text.split(' ')) {
    const next = row ? row + ' ' + word : word;
    if (row && c.textWidth(next, size, bold) > width) {
      rows.push(row);
      row = word;
    } else row = next;
  }
  if (row) rows.push(row);
  if (rows.length > lines) {
    rows.length = lines;
    rows[lines - 1] = c.elideText(rows[lines - 1] + ' ' + '…', width, size, bold);
  }
  return rows;
}
const faded = (color: Color, a: number): Color => ({ ...color, a: Math.round(clamp(a, 0, 255)) });
export function centreOn(app: GameAppState, at: Point): void {
  const p = project(at.x, at.y);
  app.camera.x = p.x;
  app.camera.y = p.y;
  app.hoveredWorldTarget = null;
  app.renderer.invalidatePresentation();
}
/** A multi-line tooltip above the anchor control while it is hovered. */
export function tooltip(c: Context, id: string, hovered: boolean, lines: readonly string[]): void {
  if (!hovered || !lines.length) return;
  c.deferOverlay(
    (area, controls) => {
      const anchor = controls.find((control) => control.id === id)?.bounds;
      if (!anchor) return;
      const t = c.theme(),
        width = Math.min(area.w - 16, 300),
        rows = lines.flatMap((line, i) => wrapText(c, line, width - 20, 11, 3, i === 0));
      const h = 10 + rows.length * 16,
        x = clamp(f32(anchor.x + f32(anchor.w / 2) - f32(width / 2)), area.x + 8, f32(area.x + area.w - width - 8)),
        above = f32(anchor.y - h - 6),
        y = above >= area.y + 4 ? above : f32(anchor.y + anchor.h + 6),
        r = new Rect(x, y, width, h);
      c.rect(r, t.raised, 3, t.border);
      rows.forEach((row, i) =>
        c.text(new Rect(f32(x + 10), f32(y + 5 + i * 16), f32(width - 20), 16), row, i === 0 ? t.text : t.muted, 11, i === 0),
      );
    },
    'combat-tooltip',
    1,
  );
}
function portrait(app: GameAppState, slot: string, person: Person, mood: Mood, r: Rect): void {
  const c = app.context,
    t = app.theme,
    state = app.combatHud,
    backdrop = portraitBackdrop(app.town.map(), person.position, app.town.climate()),
    key = JSON.stringify([slot, person.id, person.look, person.race, String(person.lookRevision), person.calling, r.w, r.h, mood, injuryOf(person), backdrop]);
  let entry = state.portraits.get(slot);
  if (!entry || entry.key !== key) {
    if (entry) {
      const old = entry.paint;
      c.deferRelease(() => old.dispose());
    }
    entry = { key, paint: hudPaint(c, personPortrait(person, mood, r.w - 2, r.h - 2, backdrop)) };
    state.portraits.set(slot, entry);
  }
  state.drawn.add(slot);
  c.rect(r, t.raised, t.radius, t.border);
  c.add(entry.paint);
  entry.paint.transform({ e11: 1, e12: 0, e13: r.x + 1, e21: 0, e22: 1, e23: r.y + 1, e31: 0, e32: 0, e33: 1 });
}
/** Enough of a person, rebuilt from the record of the dead, to draw their likeness and voice. */
export function fallenPerson(fallen: Fallen): Person {
  const p = new Person(fallen.id, fallen.name, Role.Resident, fallen.calling, fallen.race, fallen.look, { ...fallen.position });
  p.past = fallen.past;
  p.level = fallen.level;
  p.kills = fallen.kills;
  p.days = fallen.days;
  p.food = p.rest = p.hydration = 1;
  p.health = 1;
  p.stress = 0;
  return p;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export function farewell(fallen: Fallen): string {
  const lines = [
    `${fallen.name} will be missed at the fire.`,
    `The settlement will remember ${fallen.name}.`,
    `Rest now, ${fallen.name}; others keep the watch.`,
    `${fallen.name}'s place at the table stays empty tonight.`,
  ];
  return lines[Math.trunc(hash01(fallen.id, fallen.look, fallen.day, 0x6d3a) * lines.length) % lines.length];
}
export function memorialLines(fallen: Fallen): string[] {
  return [
    `${callingName(fallen.calling)}  ·  Level ${fallen.level}`,
    `${fallen.cause} in ${fallen.place}, on day ${fallen.day + 1}.`,
    `${plural(fallen.kills, 'kill')}  ·  ${fallen.days ? plural(fallen.days, 'day') + ' in the settlement' : 'their first day in the settlement'}`,
    farewell(fallen),
  ];
}

// ---------------------------------------------------------------- keys

const isCombatKeyApp = (game: object): game is CombatKeyApp =>
  'combatHud' in game && 'selectPeople' in game && 'town' in game;
/** R recall and ` party beyond a gate; false leaves the key to its ordinary meaning. */
export function combatHotkey(game: object, key: string): boolean {
  if (!isCombatKeyApp(game)) return false;
  const town = game.town;
  if (key === 'r') {
    if (!town.realmActive() || toolStructure(game.tool) !== undefined) return false;
    recallParty(game);
    return true;
  }
  if (key === '`') {
    if (!town.realmActive()) return false;
    selectParty(game);
    return true;
  }
  return false;
}
export function recallParty(app: GameAppState): void {
  const plan = app.town.realmPlan();
  if (!plan || !app.town.recallParty()) return;
  app.status = '';
  centreOn(app, plan.entry);
  if (app.cues.length < 32) app.cues.push(new Sound(Cue.Order));
}
export function selectParty(app: CombatKeyApp): void {
  const party = app.town.realmParty();
  if (!party.length) return;
  app.selectPeople(party.map((p) => p.id));
  const standing = party.filter((p) => p.downedAt < 0),
    group = standing.length ? standing : party,
    at = { x: 0, y: 0 };
  for (const p of group) {
    at.x += p.position.x / group.length;
    at.y += p.position.y / group.length;
  }
  centreOn(app, at);
}
/** Click selects a party member; a second click soon after also brings the view to them. */
export function pickPartyMember(app: GameHudApp, id: number): void {
  const p = app.town.person(id);
  if (!p) return;
  const state = app.combatHud,
    key = 'member-' + id,
    now = app.context.time(),
    twice = state.lastClick.id === key && now - state.lastClick.at < 0.45;
  state.lastClick = { id: key, at: twice ? -1 : now };
  app.selectPeople([id]);
  if (twice) centreOn(app, p.position);
}
/** The nearest standing resident of the player on the same side of a gate who could kneel by `hurt`. */
export function nearestHelper(town: Town, hurt: Person): Person | null {
  const realm = town.inRealm(hurt.position);
  return (
    town
      .people()
      .filter(
        (p) =>
          p.id !== hurt.id &&
          canControl(p) &&
          p.downedAt < 0 &&
          p.health > 0 &&
          !p.inside &&
          p.activity !== Activity.Expedition &&
          town.inRealm(p.position) === realm,
      )
      .sort((a, b) => distance(a.position, hurt.position) - distance(b.position, hurt.position) || a.id - b.id)[0] ?? null
  );
}
export function goToDowned(app: GameHudApp, hurt: Person): void {
  centreOn(app, hurt.position);
  const helper = nearestHelper(app.town, hurt);
  if (helper) {
    app.selectPeople([helper.id]);
    app.status = '';
  } else app.status = `No one can reach ${hurt.name}`;
}

// ---------------------------------------------------------------- per frame: events, sound, auto-pause

function guardianOf(town: Town): Monster | null {
  if (!town.realmActive() || town.realmCleared) return null;
  const g = town.creature(town.realmGuardian);
  return g && g.health > 0 ? g : null;
}
function nextSerial(town: Town): bigint {
  let next = 0n;
  for (const e of town.combatEvents()) if (e.serial >= next) next = e.serial + 1n;
  return next;
}
function downedTitle(names: string[]): string {
  return names.length === 1
    ? `${names[0]} is down`
    : names.length === 2
      ? `${names[0]} and ${names[1]} are down`
      : `${names.length} residents are down`;
}
/** Hears the engine's combat cues once each: sounds, the memorial queue and the two auto-pause moments. */
export function combatFrame(app: CombatFrameApp, seconds: number): void {
  const state = app.combatHud,
    town = app.town;
  if (state.town !== town) {
    state.town = town;
    state.heardEvent = nextSerial(town);
    state.fallenSeen = town.fallen.length;
    state.memorials = [];
    state.autoPause = null;
    state.realmRevision = town.realmRevision;
    const guardian = guardianOf(town);
    state.guardianEngaged = guardian?.angry ? guardian.id : -1;
  }
  if (state.realmRevision !== town.realmRevision) {
    state.realmRevision = town.realmRevision;
    const guardian = guardianOf(town);
    state.guardianEngaged = guardian?.angry ? guardian.id : -1;
  }
  const autoplay = town.isTitleAutoplay(),
    downed: Person[] = [],
    heard: CombatEvent[] = [];
  for (const e of town.combatEvents()) {
    if (e.serial < state.heardEvent) continue;
    state.heardEvent = e.serial + 1n;
    if (autoplay) continue;
    heard.push(e);
    const person = e.cue === CombatCue.Downed && e.person >= 0 ? town.person(e.person) : null;
    if (person && isPlayerResident(person)) downed.push(person);
  }
  combatSounds(app, heard, seconds);
  swarmFrame(app, heard);
  if (town.fallen.length < state.fallenSeen) state.fallenSeen = town.fallen.length;
  for (; state.fallenSeen < town.fallen.length; ++state.fallenSeen)
    if (!autoplay) state.memorials.push(town.fallen[state.fallenSeen]);
  const guardian = guardianOf(town),
    roused = !!guardian && guardian.angry && state.guardianEngaged !== guardian.id;
  if (guardian && roused) state.guardianEngaged = guardian.id;
  if (autoplay || (!downed.length && !roused) || app.paused || app.gameSpeed() <= 0) return;
  app.paused = true;
  if (downed.length) {
    const first = downed[0];
    state.autoPause = {
      title: downedTitle(downed.map((p) => p.name)),
      detail: `${first.name} bleeds out unless an ally kneels beside them in time.`,
      at: { ...first.position },
      person: first.id,
      creature: -1,
    };
  } else if (guardian) {
    const site = town.map().dungeons()[town.realmGate];
    state.autoPause = {
      title: `The guardian of ${site ? worldName(town.map().destination(site)) : 'this world'} is roused`,
      detail: 'Its slam is marked on the ground before it lands: move away.',
      at: { ...guardian.position },
      person: -1,
      creature: guardian.id,
    };
  }
}

// ---------------------------------------------------------------- overlays

function column(width: number): { x: number; w: number } {
  const w = Math.min(390, f32(width - 24));
  return { x: f32(f32(width - w) / 2), w };
}
function guardianBar(app: GameHudApp, width: number, y: number): number {
  const town = app.town,
    guardian = guardianOf(town);
  if (!guardian || !(guardian.angry || app.renderer.visible(guardian.position))) return y;
  const c = app.context,
    t = app.theme,
    { x, w } = column(width),
    vigor = Math.max(0.01, guardian.vigor || town.guardianVigor()),
    share = clamp(guardian.health / vigor, 0, 1),
    clock = town.clock(),
    windup = guardian.windupUntil > clock,
    enraged = share < 0.5,
    site = town.map().dungeons()[town.realmGate],
    name = site ? worldName(town.map().destination(site)) : '',
    h = windup ? 58 : 42,
    r = new Rect(x, y, w, h),
    pulse = windup && !app.reducedMotion() ? f32(0.5 + 0.5 * Math.sin(c.time() * 12)) : 1;
  c.control('guardian-bar', r, undefined, true, false);
  c.rect(r, t.surface, t.radius, windup ? faded(t.danger, 140 + 115 * pulse) : t.border, windup ? 2 : 1);
  c.text(new Rect(f32(x + 12), f32(y + 4), f32(w - 120), 18), c.elideText(name ? `Guardian of ${name}` : 'Guardian', f32(w - 120), 12, true), t.text, 12, true);
  c.text(
    new Rect(f32(x + w - 112), f32(y + 4), 100, 18),
    enraged ? 'Enraged' : `${Math.ceil(share * 100)}%`,
    enraged ? t.danger : t.muted,
    11,
    enraged,
    Align.End,
  );
  const bar = new Rect(f32(x + 12), f32(y + 25), f32(w - 24), 9);
  c.rect(bar, t.raised, 2);
  c.rect(new Rect(bar.x, bar.y, Math.max(2, f32(bar.w * share)), bar.h), t.danger, 2);
  // The notch marks where it enrages and calls its brood.
  c.rect(new Rect(f32(bar.x + f32(bar.w / 2) - 1), f32(bar.y - 3), 2, f32(bar.h + 6)), t.text, 0);
  if (windup) {
    c.text(
      new Rect(f32(x + 12), f32(y + 38), f32(w - 24), 16),
      `Winding up a slam: move away! (${Math.max(0, guardian.windupUntil - clock).toFixed(1)} s)`,
      faded(t.danger, 170 + 85 * pulse),
      11,
      true,
      Align.Center,
    );
    c.requestAnimationFrame();
  }
  return f32(y + h + 6);
}
function autoPauseBanner(app: GameHudApp, width: number, y: number): number {
  const pause = app.combatHud.autoPause;
  if (!pause) return y;
  const c = app.context,
    t = app.theme,
    { x, w } = column(width),
    bh = app.touchMode ? 44 : 26,
    detail = wrapText(c, pause.detail, f32(w - 24), 11, 2),
    h = 61 + detail.length * 15 + bh,
    r = new Rect(x, y, w, h),
    downed = pause.person >= 0;
  c.control('auto-pause', r, undefined, true, false);
  c.rect(r, t.surface, t.radius, downed ? t.danger : t.accent, 2);
  c.text(new Rect(f32(x + 12), f32(y + 6), f32(w - 24), 20), c.elideText(pause.title, f32(w - 24), 14, true), downed ? t.danger : t.accent, 14, true);
  detail.forEach((row, i) => c.text(new Rect(f32(x + 12), f32(y + 28 + i * 15), f32(w - 24), 15), row, t.text, 11));
  c.text(
    new Rect(f32(x + 12), f32(y + 30 + detail.length * 15), f32(w - 24), 16),
    'Paused. You can give orders while paused.',
    t.muted,
    11,
  );
  const half = f32(f32(w - 32) / 2),
    target = downed ? app.town.person(pause.person) : app.town.creature(pause.creature);
  button(
    c,
    'auto-pause-look',
    new Rect(f32(x + 12), f32(y + h - bh - 8), half, bh),
    downed ? 'Go to them' : 'Go to it',
    () => {
      const hurt = downed ? app.town.person(pause.person) : null;
      if (hurt && hurt.downedAt >= 0) goToDowned(app, hurt);
      else centreOn(app, target?.position ?? pause.at);
    },
    ButtonStyle.Default,
    true,
    undefined,
    false,
    { fontSize: 12 },
  );
  button(
    c,
    'auto-pause-resume',
    new Rect(f32(x + 20 + half), f32(y + h - bh - 8), half, bh),
    app.touchMode ? 'Resume' : 'Resume (Space)',
    () => {
      app.paused = false;
      app.combatHud.autoPause = null;
    },
    ButtonStyle.Primary,
    true,
    undefined,
    false,
    { fontSize: 12 },
  );
  return f32(y + h + 6);
}
function memorialBanner(app: GameHudApp, width: number, y: number): number {
  const state = app.combatHud,
    fallen = state.memorials[0];
  if (!fallen) return y;
  const c = app.context,
    t = app.theme,
    { x, w } = column(width),
    bh = app.touchMode ? 44 : 26,
    size = 64,
    lines = memorialLines(fallen),
    left = f32(x + size + 22),
    inner = f32(w - size - 34),
    farewellRows = wrapText(c, lines[3], inner, 11, 2),
    h = Math.max(size + 20, 82 + farewellRows.length * 15) + bh + 8,
    r = new Rect(x, y, w, h),
    body = fallenPerson(fallen);
  c.control('memorial', r, undefined, true, false);
  c.rect(r, t.surface, t.radius, t.accent, 2);
  portrait(app, 'memorial', body, Mood.Asleep, new Rect(f32(x + 10), f32(y + 10), size, f32(size + 8)));
  c.text(new Rect(left, f32(y + 6), inner, 20), c.elideText(`${fallen.name} has died`, inner, 14, true), t.accent, 14, true);
  c.text(new Rect(left, f32(y + 27), inner, 15), c.elideText(lines[0], inner, 11), t.muted, 11);
  c.text(new Rect(left, f32(y + 43), inner, 15), c.elideText(lines[1], inner, 11), t.text, 11);
  c.text(new Rect(left, f32(y + 59), inner, 15), c.elideText(lines[2], inner, 11), t.muted, 11);
  farewellRows.forEach((row, i) => c.text(new Rect(left, f32(y + 77 + i * 15), inner, 15), row, t.text, 11));
  const more = state.memorials.length - 1;
  if (more > 0)
    c.text(new Rect(f32(x + 12), f32(y + h - bh - 8), 120, bh), `${more} more to remember`, t.muted, 10);
  button(
    c,
    'memorial-close',
    new Rect(f32(x + w - 132), f32(y + h - bh - 8), 120, bh),
    'Farewell',
    () => state.memorials.shift(),
    ButtonStyle.Primary,
    true,
    undefined,
    false,
    { fontSize: 12 },
  );
  return f32(y + h + 6);
}
function downedAlerts(app: GameHudApp, width: number, y: number): void {
  const town = app.town,
    hurt = town.downedResidents().filter((p) => isPlayerResident(p));
  if (!hurt.length) return;
  const c = app.context,
    t = app.theme,
    { x, w } = column(width),
    cardW = 124,
    cardH = app.touchMode ? 48 : 46,
    gap = 6,
    fit = Math.max(1, Math.floor((w + gap) / (cardW + gap))),
    shown = hurt.slice(0, fit),
    span = shown.length * cardW + (shown.length - 1) * gap,
    start = f32(x + f32(f32(w - span) / 2));
  shown.forEach((p, i) => {
    const r = new Rect(f32(start + i * (cardW + gap)), y, cardW, cardH),
      left = town.bleedOutLeft(p),
      total = Math.max(1, town.bleedOutTotal(p)),
      urgent = left < 10,
      pulse = urgent && !app.reducedMotion() ? f32(0.5 + 0.5 * Math.sin(c.time() * 8)) : 1,
      id = 'downed-' + p.id,
      s = button(c, id, r, '', () => goToDowned(app, p), ButtonStyle.Quiet, true, undefined, false, {
        border: faded(t.danger, urgent ? 120 + 135 * pulse : 200),
        borderWidth: 2,
      });
    portrait(app, id, p, Mood.Hurt, new Rect(f32(r.x + 5), f32(r.y + 5), 36, 36));
    c.text(new Rect(f32(r.x + 46), f32(r.y + 4), f32(cardW - 50), 17), c.elideText(p.name, f32(cardW - 50), 11, true), t.text, 11, true);
    c.text(new Rect(f32(r.x + 46), f32(r.y + 19), f32(cardW - 50), 14), `${Math.ceil(left)} s`, t.danger, 10, true);
    const bar = new Rect(f32(r.x + 46), f32(r.y + 35), f32(cardW - 54), 4);
    c.rect(bar, t.raised, 1);
    c.rect(new Rect(bar.x, bar.y, Math.max(1, f32(bar.w * clamp(left / total, 0, 1))), bar.h), t.danger, 1);
    tooltip(c, id, s.hovered, [
      `${p.name} is bleeding out`,
      'Click to look and select the nearest ally who can help, then right-click the body to revive.',
    ]);
  });
  if (hurt.length > shown.length)
    c.text(new Rect(x, f32(y + cardH + 2), w, 14), `+${hurt.length - shown.length} more down`, t.danger, 10, true, Align.Center);
  c.requestFrameAt(c.time() + 0.25);
}
/** Top-centre combat overlays: the guardian bar, the auto-pause banner, the memorial and the downed alerts. */
export function combatOverlays(app: GameHudApp, width: number, height: number): void {
  const state = app.combatHud;
  if (!app.paused) state.autoPause = null;
  state.drawn.clear();
  if (!app.town.isTitleAutoplay() && height >= 360) {
    let y = f32(f32(app.skyBounds.y + app.skyBounds.h) + (app.town.raiding() ? 30 : 8));
    y = guardianBar(app, width, y);
    y = swarmBanner(app, width, y);
    y = waveWarning(app, width, height, y);
    y = autoPauseBanner(app, width, y);
    y = memorialBanner(app, width, y);
    downedAlerts(app, width, y);
  }
  for (const [slot, entry] of state.portraits)
    if (!state.drawn.has(slot)) {
      app.context.deferRelease(() => entry.paint.dispose());
      state.portraits.delete(slot);
    }
}
