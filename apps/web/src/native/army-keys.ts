// One rule for keys the player can learn: with residents selected and no tool in hand, the letters on the command
// card (Q W E H S M A B) command them; every other letter picks a building, for them to build when they are
// selected. Digits are always control groups.
import { Order, Tool } from '../../../../packages/engine/src/game-tools';
import { controllableIds } from './game-control';
import { beginSkill, cancelSkill, currentAim, cycleFocus, releaseSkill } from './skill-commands';
import { recallGroup, setGroup, type GroupApp } from './control-groups';
import { fightersAtHand, holdPosition } from './army-orders';
import { selectParty } from './game-combat-hud';
import type { GameAppState } from './game-app-state';

export enum KeyState {
  /** Residents are selected and no tool is in hand: the command card's letters command them. */
  Command,
  /** A building, road, field or clearing tool is in hand: building keys, R rotates, Esc puts it down. */
  Placement,
  /** Nothing of the player's to command: building keys. */
  Free,
}
export interface ArmyKeyApp extends GroupApp {
  prepare(order: Order): void;
  stopSelected(): void;
  openUnitBuild(): void;
}
export interface KeyPress {
  text: string;
  shift: boolean;
  control: boolean;
  meta: boolean;
  alt: boolean;
}
export function keyState(app: GameAppState): KeyState {
  if (app.tool !== Tool.Select) return KeyState.Placement;
  return controllableIds(app.town, app.chosen).length ? KeyState.Command : KeyState.Free;
}
// Shift turns the digit row into these on a US layout; the digit is what the player pressed.
const shifted = '!@#$%^&*(';
function digitOf(e: KeyPress): number {
  const code = 'code' in e && typeof e.code === 'string' ? /^(?:Digit|Numpad)([1-9])$/.exec(e.code) : null;
  if (code) return Number(code[1]);
  if (/^[1-9]$/.test(e.text)) return Number(e.text);
  const symbol = shifted.indexOf(e.text);
  return e.shift && symbol >= 0 ? symbol + 1 : 0;
}
/** F2, and ` outside a gate: every resident with a fighting calling who is outdoors and not at work. */
export function selectFighters(app: GroupApp): boolean {
  const ids = fightersAtHand(app.town).map((p) => p.id);
  if (!ids.length) {
    app.status = 'No fighter is free: the warriors, rangers, mages, clerics and bards are busy or indoors';
    return false;
  }
  app.selectPeople(ids);
  app.status = '';
  return true;
}
const commandKeys = new Set(['q', 'w', 'e', 'h', 's', 'm', 'a', 'b', 'tab']);
/** Keys of the army: groups, the fighters, and in the Command state the unit orders and both skills.
 * False leaves the key to its building or game meaning. */
export function armyKeyDown(app: ArmyKeyApp, e: KeyPress): boolean {
  const digit = digitOf(e),
    primary = e.control || e.meta,
    text = e.text.toLowerCase();
  if (digit && !e.alt) {
    if (primary) setGroup(app, digit, false);
    else if (e.shift) setGroup(app, digit, true);
    else recallGroup(app, digit);
    return true;
  }
  if (primary || e.alt) return false;
  if (text === 'f2') {
    selectFighters(app);
    return true;
  }
  if (text === '`') {
    if (app.town.realmActive()) selectParty(app);
    else selectFighters(app);
    return true;
  }
  if (!commandKeys.has(text) || keyState(app) !== KeyState.Command) return false;
  switch (text) {
    case 'q':
      beginSkill(app, app.chosen, 0, 'key');
      return true;
    case 'w':
      beginSkill(app, app.chosen, 1, 'key');
      return true;
    case 'e':
      app.prepare(Order.Work);
      return true;
    case 'h':
      holdPosition(app);
      return true;
    case 's':
      cancelSkill(app);
      app.stopSelected();
      return true;
    case 'm':
      cancelSkill(app);
      app.prepare(Order.Move);
      return true;
    case 'a':
      cancelSkill(app);
      app.prepare(Order.Attack);
      return true;
    case 'b':
      app.openUnitBuild();
      return true;
    case 'tab':
      return cycleFocus(app);
  }
  return false;
}
/** Releasing Q or W casts the ground-aimed skill it was holding at the point under the cursor. */
export function armyKeyUp(app: GameAppState, e: KeyPress): boolean {
  const aim = currentAim(app);
  if (aim?.via !== 'key' || (e.text !== 'q' && e.text !== 'w') || (e.text === 'q' ? 0 : 1) !== aim.slot) return false;
  releaseSkill(app);
  return true;
}
