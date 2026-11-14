// The Clear button in a building, field or road inspector, and the shared way a clear order picks its crew.
import { Rect, ButtonStyle, button } from '../../../../packages/native-ui/src';
import { f32 } from '../../../../packages/engine/src/numeric';
import type { Town } from '../../../../packages/engine/src/town';
import {
  canClear,
  clearCrewNames,
  clearMarkOf,
  keepClear,
  markClear,
  type ClearResult,
  type ClearTarget,
} from '../../../../packages/engine/src/town-clearing';
import { controllableIds } from './game-control';
import type { GameHudApp } from './game-hud-contract';
import type { InspectorRows } from './game-progress-hud';
import { wrapText } from './game-progress-hud';

const lastCrew = new WeakMap<object, number[]>();
const confirming = new WeakMap<object, { key: string; until: number }>();
const confirmSeconds = 4;

/** Keeps the residents chosen before the player clicked something else; they are the crew a clear order sends. */
export function rememberCrew(app: object, ids: readonly number[]): void {
  if (ids.length) lastCrew.set(app, [...ids]);
}
/** One path for the inspector button and the Clear tool: `ids` if given, else the residents chosen last, else Auto. */
export function orderClear(app: object, town: Town, target: ClearTarget, ids: readonly number[] = []): ClearResult {
  const crew = controllableIds(town, ids.length ? ids : (lastCrew.get(app) ?? []));
  return markClear(town, target.kind, target.id, crew);
}
/** The player's field or road on the shown page of the selected objects, if that is what it is. */
export function objectClearTarget(app: Pick<GameHudApp, 'town' | 'selectedObjects' | 'objectPage'>): ClearTarget | null {
  const ref = app.selectedObjects[Math.max(0, Math.min(app.selectedObjects.length - 1, app.objectPage))];
  if (ref?.kind === 'field') return app.town.field(ref.id)?.faction === app.town.controlFaction ? { kind: 'field', id: ref.id } : null;
  if (ref?.kind === 'road')
    return app.town.roads().road(ref.id)?.faction === app.town.controlFaction ? { kind: 'road', id: ref.id } : null;
  return null;
}
/** Dock height for a selected field or road with its clear rows. */
export const objectClearHeight = (touch: boolean): number => (touch ? 272 : 240);
const keyOf =(t: ClearTarget): string => `${t.kind}:${t.id}`;
/** Needs a second press: a finished building, a field or a road. An empty blueprint goes at once. */
function needsConfirm(town: Town, t: ClearTarget): boolean {
  if (t.kind !== 'building') return true;
  const b = town.building(t.id);
  return !!b && (b.built() || b.progress > 0);
}
/** Adds the clear rows to an inspector; `out.y` advances. */
export function clearRows(app: GameHudApp, target: ClearTarget, out: InspectorRows): void {
  const c = app.context,
    t = app.theme,
    town = app.town,
    { left, inner, top } = out,
    height = app.touchMode ? 44 : 28,
    width = Math.min(inner, app.touchMode ? 180 : 150),
    line = (text: string, color: typeof t.text) => {
      for (const words of wrapText(c, text, inner, 12, 2)) {
        const at = out.y;
        out.rows.push(() => c.text(new Rect(left, f32(top + at), inner, 20), words, color, 12));
        out.y = f32(out.y + 21);
      }
    },
    place = (id: string, label: string, run: () => void, enabled = true) => {
      const at = out.y;
      out.rows.push(() =>
        button(c, id, new Rect(left, f32(f32(top + at) + 2), width, height), label, run, ButtonStyle.Quiet, enabled),
      );
      out.y = f32(out.y + height + 8);
    };
  out.y = f32(out.y + 10);
  const mark = clearMarkOf(town, target.kind, target.id);
  if (mark) {
    line(`Marked for clearing: ${Math.trunc(f32(mark.done * 100))}% torn down`, t.accent);
    const names = clearCrewNames(town, mark);
    line(names.length ? `Tearing it down: ${names.join(', ')}` : 'Waiting for free residents', t.muted);
    place('clear-keep', 'Keep it', () => keepClear(town, target.kind, target.id));
    return;
  }
  const check = canClear(town, target.kind, target.id);
  if (!check.ok) {
    place('clear-target', 'Clear it', () => undefined, false);
    line(check.reason, t.muted);
    return;
  }
  const key = keyOf(target),
    now = c.time(),
    pending = confirming.get(app),
    armed = !!pending && pending.key === key && now < pending.until;
  place('clear-target', armed ? 'Press again to clear' : 'Clear it', () => {
    if (needsConfirm(town, target) && !armed) {
      confirming.set(app, { key, until: now + confirmSeconds });
      return;
    }
    confirming.delete(app);
    orderClear(app, town, target);
  });
  if (armed) line('Residents will tear it down.', t.muted);
}
