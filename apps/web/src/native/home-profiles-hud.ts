// Profiles of who lives in a home (camp, tent and their growth stages) or stays at a lodging, in the building inspector.
import { Rect, Align, ButtonStyle, button, type Color } from '../../../../packages/native-ui/src';
import { Activity, Role, callingName, type Person } from '../../../../packages/engine/src/person';
import { isHome, isLodging, structureSpec } from '../../../../packages/engine/src/building-catalog';
import type { Building } from '../../../../packages/engine/src/town-models';
import { f32 } from '../../../../packages/engine/src/numeric';
import type { Town } from '../../../../packages/engine/src/town';
import { centreOn, tooltip } from './game-combat-hud';
import { portrait } from './expedition-window';
import type { GameHudApp } from './game-hud-contract';
import type { InspectorRows } from './game-progress-hud';

export enum HomeState {
  Home,
  Asleep,
  Work,
  Out,
  Beyond,
  Downed,
}
const working = new Set([
  Activity.Building,
  Activity.Roadwork,
  Activity.Working,
  Activity.Hauling,
  Activity.Felling,
  Activity.Collecting,
  Activity.Mining,
  Activity.Treating,
  Activity.FetchingMaterials,
  Activity.DeliveringMaterials,
  Activity.WaitingMaterials,
  Activity.Training,
  Activity.Crafting,
  Activity.Guarding,
]);
export function homeState(town: Town, p: Person, home: number): HomeState {
  if (p.downedAt >= 0 || p.activity === Activity.Downed) return HomeState.Downed;
  if (p.activity === Activity.Expedition || town.inRealm(p.position)) return HomeState.Beyond;
  if (town.shelterOf(p) === home) return p.activity === Activity.Sleeping ? HomeState.Asleep : HomeState.Home;
  if (working.has(p.activity)) return HomeState.Work;
  return HomeState.Out;
}
const stateWords = ['At home', 'Asleep inside', 'At work', 'Out and about', 'Away beyond a gate', 'Downed'];
/** Who lives here: residents whose home it is, or the guests staying at a lodging. */
export function dwellers(town: Town, b: Building): Person[] {
  const ids = isLodging(b.kind)
    ? town.occupants(b.id)
    : town
        .people()
        .filter((p) => p.home === b.id && p.role === Role.Resident && p.health > 0 && p.activity !== Activity.Leaving)
        .map((p) => p.id);
  return ids.map((id) => town.person(id)).filter((p): p is Person => !!p);
}
export const hasProfiles = (b: Building | null): b is Building =>
  !!b && b.built() && (isHome(b.kind) || isLodging(b.kind));

const tileWidth = 70,
  tileGap = 6;
function layout(app: GameHudApp, width: number) {
  const columns = Math.max(1, Math.floor(f32(width + tileGap) / f32(tileWidth + tileGap))),
    rows = app.touchMode ? 1 : 2,
    tileHeight = 86,
    pager = app.touchMode ? 44 : 26;
  return { columns, rows, perPage: columns * rows, tileHeight, pager };
}
/** Height the profile block takes at `width`. */
export function profilesHeight(app: GameHudApp, b: Building, width: number): number {
  const { perPage, rows, tileHeight, pager, columns } = layout(app, width),
    capacity = Math.max(structureSpec(b.kind).residents, structureSpec(b.kind).beds),
    shown = Math.max(dwellers(app.town, b).length, capacity),
    used = Math.min(rows, Math.max(1, Math.ceil(Math.min(shown, perPage) / columns)));
  return f32(22 + used * f32(tileHeight + tileGap) + (shown > perPage ? f32(pager + 6) : 0));
}
function mark(app: GameHudApp, state: HomeState, wounded: boolean, r: Rect): void {
  const c = app.context,
    t = app.theme,
    box = new Rect(f32(r.x + r.w - 17), f32(r.y + r.h - 17), 16, 16),
    cx = f32(box.x + 8),
    cy = f32(box.y + 8);
  if (state === HomeState.Downed) c.rect(r, { r: 0, g: 0, b: 0, a: 0 }, 3, t.danger, 2);
  if (wounded && state !== HomeState.Downed) {
    c.rect(new Rect(f32(r.x + 1), f32(r.y + 1), 14, 14), t.surface, 3, t.danger, 1);
    c.line(f32(r.x + 4), f32(r.y + 8), f32(r.x + 12), f32(r.y + 8), t.danger, 2);
    c.line(f32(r.x + 8), f32(r.y + 4), f32(r.x + 8), f32(r.y + 12), t.danger, 2);
  }
  const ink: Color = state === HomeState.Downed ? t.danger : state === HomeState.Out ? t.muted : t.accent;
  c.rect(box, t.surface, 8, ink, 1);
  if (state === HomeState.Asleep) c.text(box, 'z', ink, 11, true, Align.Center);
  else if (state === HomeState.Home) {
    c.line(f32(cx - 4), cy, cx, f32(cy - 4), ink, 1.4);
    c.line(cx, f32(cy - 4), f32(cx + 4), cy, ink, 1.4);
    c.line(f32(cx - 3), cy, f32(cx - 3), f32(cy + 4), ink, 1.4);
    c.line(f32(cx + 3), cy, f32(cx + 3), f32(cy + 4), ink, 1.4);
  } else if (state === HomeState.Work) {
    c.line(f32(cx - 3), f32(cy + 4), f32(cx + 2), f32(cy - 1), ink, 1.6);
    c.line(f32(cx - 1), f32(cy - 4), f32(cx + 4), f32(cy + 1), ink, 2.2);
  } else if (state === HomeState.Beyond) {
    c.line(f32(cx - 3), f32(cy + 4), f32(cx - 3), f32(cy - 1), ink, 1.4);
    c.line(f32(cx + 3), f32(cy + 4), f32(cx + 3), f32(cy - 1), ink, 1.4);
    c.line(f32(cx - 3), f32(cy - 1), cx, f32(cy - 4), ink, 1.4);
    c.line(cx, f32(cy - 4), f32(cx + 3), f32(cy - 1), ink, 1.4);
  } else if (state === HomeState.Downed) c.text(box, '!', ink, 11, true, Align.Center);
  else c.rect(new Rect(f32(cx - 2), f32(cy - 2), 4, 4), ink, 2);
}
function profile(app: GameHudApp, b: Building, p: Person, r: Rect): void {
  const c = app.context,
    t = app.theme,
    id = 'home-profile-' + p.id,
    state = homeState(app.town, p, b.id),
    face = new Rect(f32(r.x + f32((r.w - 52) / 2)), f32(r.y + 4), 52, 52);
  const hover = button(
    c,
    id,
    r,
    '',
    () => {
      app.selectPeople([p.id]);
      centreOn(app, p.position);
    },
    ButtonStyle.Quiet,
    true,
    undefined,
    app.chosen.includes(p.id),
  );
  portrait(app, p, face);
  mark(app, state, p.woundDays > 0, face);
  c.text(new Rect(f32(r.x + 2), f32(face.y + 54), f32(r.w - 4), 14), c.elideText(p.name, f32(r.w - 4), 10, true), t.text, 10, true, Align.Center);
  const second = `Lv ${p.level} · ${callingName(p.calling)}`;
  c.text(new Rect(f32(r.x + 2), f32(face.y + 68), f32(r.w - 4), 13), c.elideText(second, f32(r.w - 4), 9), t.muted, 9, false, Align.Center);
  const lines = [`${p.name}, ${callingName(p.calling)}, level ${p.level}`, stateWords[state]];
  if (p.woundDays > 0) lines.push('Wounded');
  lines.push('Click to select and look');
  tooltip(c, id, hover.hovered, lines);
}
function freeBed(app: GameHudApp, r: Rect): void {
  const c = app.context,
    t = app.theme,
    face = new Rect(f32(r.x + f32((r.w - 52) / 2)), f32(r.y + 4), 52, 52);
  c.rect(r, { r: 0, g: 0, b: 0, a: 0 }, 4, t.border, 1);
  c.rect(face, t.raised, 3);
  c.text(new Rect(r.x, f32(face.y + 58), r.w, 14), 'Free bed', t.muted, 10, false, Align.Center);
}
/** Draws the header, the profile tiles of the current page, free beds and the pager. */
export function drawProfiles(app: GameHudApp, b: Building, left: number, top: number, width: number): void {
  const c = app.context,
    t = app.theme,
    people = dwellers(app.town, b),
    spec = structureSpec(b.kind),
    capacity = Math.max(spec.residents, spec.beds),
    free = Math.max(0, capacity - people.length),
    { columns, perPage, tileHeight, pager } = layout(app, width),
    slots = Math.max(people.length, capacity),
    pages = Math.max(1, Math.ceil(slots / perPage)),
    page = Math.min(app.residentPage, pages - 1),
    lodging = isLodging(b.kind),
    head = `${lodging ? 'Guests' : 'Residents'} ${people.length}${people.length > capacity ? '' : ` of ${capacity}`}`,
    tail = free ? (free === 1 ? '1 bed free' : `${free} beds free`) : 'No beds free';
  c.text(new Rect(left, top, width, 18), `${head}  ·  ${tail}`, t.accent, 12, true);
  const first = page * perPage;
  for (let i = first; i < Math.min(slots, first + perPage); i++) {
    const at = i - first,
      r = new Rect(
        f32(left + (at % columns) * f32(tileWidth + tileGap)),
        f32(top + 22 + Math.floor(at / columns) * f32(tileHeight + tileGap)),
        tileWidth,
        tileHeight,
      );
    if (i < people.length) profile(app, b, people[i], r);
    else freeBed(app, r);
  }
  if (pages < 2) return;
  const rowsUsed = Math.ceil(Math.min(slots - first, perPage) / columns),
    full = Math.ceil(Math.min(slots, perPage) / columns),
    y = f32(top + 22 + Math.max(rowsUsed, full) * f32(tileHeight + tileGap)),
    w = app.touchMode ? 72 : 80;
  button(c, 'residents-prev', new Rect(left, y, w, pager), 'Previous', () => (app.residentPage = page - 1), ButtonStyle.Quiet, page > 0);
  c.text(new Rect(f32(left + w), y, f32(width - 2 * w), pager), `${page + 1} / ${pages}`, t.muted, 12, false, Align.Center);
  button(
    c,
    'residents-next',
    new Rect(f32(left + width - w), y, w, pager),
    'Next',
    () => (app.residentPage = page + 1),
    ButtonStyle.Quiet,
    page + 1 < pages,
  );
}
/** Adds the profile block to an inspector; `out.y` advances. */
export function profileRows(app: GameHudApp, b: Building, out: InspectorRows): void {
  const at = out.y,
    { left, inner, top } = out;
  out.rows.push(() => drawProfiles(app, b, left, f32(top + at), inner));
  out.y = f32(out.y + profilesHeight(app, b, inner) + 4);
}
