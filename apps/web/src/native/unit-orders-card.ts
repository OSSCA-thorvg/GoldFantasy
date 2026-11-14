// The order buttons of the selection panel, each with its key and a tooltip that says what it does.
import { Rect, Align, ButtonStyle, button } from '../../../../packages/native-ui/src';
import { Order, Tool } from '../../../../packages/engine/src/game-tools';
import { f32 } from '../../../../packages/engine/src/numeric';
import { actionButton, type HudGlyph } from './hud-actions';
import { touchCommandColumns } from './mobile-layout';
import { tooltip } from './game-combat-hud';
import { allHolding, holdPosition } from './army-orders';
import type { GameHudApp } from './game-hud-contract';

interface OrderButton {
  id: string;
  glyph: HudGlyph | 'hold';
  label: string;
  key: string;
  lines: string[];
  run: () => void;
  active: boolean;
}
export function unitOrders(app: GameHudApp): OrderButton[] {
  const orders: OrderButton[] = [
    {
      id: 'card-build',
      glyph: 'build',
      label: 'Build',
      key: 'B',
      lines: ['Build', 'Choose a building for the selected residents to raise.'],
      run: () => app.openUnitBuild(),
      active: false,
    },
    {
      id: 'card-move',
      glyph: 'move',
      label: 'Move',
      key: 'M',
      lines: [
        'Move',
        'Walk to the point you click and ignore enemies on the way. A group arrives in formation: blades in front, bows and staves behind.',
      ],
      run: () => app.prepare(Order.Move),
      active: app.pending === Order.Move,
    },
    {
      id: 'card-attack',
      glyph: 'attack',
      label: 'Attack',
      key: 'A',
      lines: [
        'Attack-move',
        'Walk to the point you click and fight whatever they meet. Click an enemy to make it everyone’s first target.',
      ],
      run: () => app.prepare(Order.Attack),
      active: app.pending === Order.Attack,
    },
    {
      id: 'card-hold',
      glyph: 'hold',
      label: 'Hold',
      key: 'H',
      lines: [
        'Hold position',
        'Stand on this spot, strike whatever comes into reach and never chase. Skills on auto still fire. Any other order ends it.',
      ],
      run: () => holdPosition(app),
      active: allHolding(app.town, app.chosen),
    },
    {
      id: 'card-stop',
      glyph: 'stop',
      label: 'Stop',
      key: 'S',
      lines: ['Stop', 'Drop the current order and stand still.'],
      run: () => app.stopSelected(),
      active: false,
    },
    {
      id: 'card-work',
      glyph: 'work',
      label: 'Work',
      key: 'E',
      lines: ['Work', 'Fell, mine, build, mend or tend what you click next. Right-click does the same at once.'],
      run: () => app.prepare(Order.Work),
      active: app.pending === Order.Work,
    },
    {
      id: 'card-clear',
      glyph: 'close',
      label: 'Clear',
      key: 'X',
      lines: ['Clear', 'Demolish a building, a field or a road with these residents.'],
      run: () => app.selectTool(Tool.Demolish, true),
      active: app.tool === Tool.Demolish,
    },
    {
      id: 'card-select',
      glyph: 'unit',
      label: 'Select',
      key: '',
      lines: ['Select', 'Put the tool down and go back to selecting (Q while a tool is in hand).'],
      run: () => app.selectTool(Tool.Select, true),
      active: app.tool === Tool.Select,
    },
  ];
  if (app.shelteredSelection())
    orders.push({
      id: 'card-leave',
      glyph: 'back',
      label: 'Leave',
      key: '',
      lines: ['Leave', 'Come out of the building they are in.'],
      run: () => app.leaveSelected(),
      active: false,
    });
  return orders;
}
function holdButton(app: GameHudApp, id: string, r: Rect, order: OrderButton): boolean {
  const c = app.context,
    t = app.theme,
    s = button(c, id, r, '', order.run, order.active ? ButtonStyle.Primary : ButtonStyle.Quiet, true),
    color = order.active ? t.accentText : s.hovered ? t.accent : t.text,
    x = f32(r.x + r.w / 2),
    y = f32(r.y + r.h / 2),
    line = (a: number, b: number, d: number, e: number) => c.line(f32(x + a), f32(y + b), f32(x + d), f32(y + e), color, 1.7);
  // A shield planted on its point.
  line(-6, -7, 6, -7);
  line(-6, -7, -6, 1);
  line(6, -7, 6, 1);
  line(-6, 1, 0, 7);
  line(6, 1, 0, 7);
  line(0, -4, 0, 3);
  return s.hovered;
}
/** Build, Move, Attack-move, Hold, Stop, Work, Clear, Select (and Leave for residents indoors). */
export function unitOrdersCard(app: GameHudApp, area: Rect, scale = 1, global = false): void {
  const c = app.context,
    t = app.theme,
    orders = unitOrders(app),
    gap = f32(6 * scale),
    columns = app.touchMode ? touchCommandColumns(area.w, orders.length) : orders.length,
    w = f32(f32(area.w - f32(f32(columns - 1) * gap)) / columns),
    prefix = global ? 'global/' : 'unit/';
  orders.forEach((order, i) => {
    const r = new Rect(
        f32(area.x + f32((i % columns) * f32(w + gap))),
        area.y + Math.floor(i / columns) * (44 + gap),
        w,
        app.touchMode ? 44 : area.h,
      ),
      id = prefix + order.id;
    let hovered = false;
    if (order.glyph === 'hold') hovered = holdButton(app, id, r, order);
    else {
      actionButton(c, id, r, order.glyph, order.label, order.run, order.active, true, false);
      hovered = !app.touchMode && r.contains(app.mouse.x, app.mouse.y);
    }
    if (!app.touchMode && order.key)
      c.text(
        new Rect(f32(r.x + r.w - 16), f32(r.y + 2), 13, 12),
        order.key,
        order.active ? t.accentText : t.muted,
        9,
        true,
        Align.Center,
      );
    tooltip(c, id, hovered, order.key && !app.touchMode ? [`${order.lines[0]}  (${order.key})`, ...order.lines.slice(1)] : order.lines);
  });
}
