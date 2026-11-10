import { Rect, button, ButtonStyle, Align, type Context } from '../../../../packages/native-ui/src';
export type HudGlyph =
  | 'build'
  | 'unit'
  | 'move'
  | 'attack'
  | 'work'
  | 'stop'
  | 'close'
  | 'bag'
  | 'gear'
  | 'craft'
  | 'back'
  | 'next';
/** Small vector controls share hover/press feedback and explicit descriptive tooltips. */
export function actionButton(
  c: Context,
  id: string,
  r: Rect,
  glyph: HudGlyph,
  label: string,
  run: () => void,
  active = false,
  enabled = true,
): void {
  const s = button(c, id, r, '', run, active ? ButtonStyle.Primary : ButtonStyle.Quiet, enabled),
    t = c.theme();
  const color = !enabled ? t.muted : active ? t.accentText : s.hovered ? t.accent : t.text;
  const x = r.x + r.w / 2,
    y = r.y + r.h / 2;
  const line = (a: number, b: number, d: number, e: number, w = 1.7) =>
    c.line(x + a, y + b, x + d, y + e, color, w);
  if (glyph === 'close') {
    line(-5, -5, 5, 5);
    line(5, -5, -5, 5);
  } else if (glyph === 'stop') c.rect(new Rect(x - 5, y - 5, 10, 10), color, 1);
  else if (glyph === 'unit') {
    c.rect(new Rect(x - 3, y - 8, 6, 6), color, 3);
    line(-7, 8, -7, 3);
    line(-7, 3, 0, -1);
    line(0, -1, 7, 3);
    line(7, 3, 7, 8);
    line(-7, 8, 7, 8);
  } else if (glyph === 'move') {
    line(-8, 0, 8, 0);
    line(0, -8, 0, 8);
    line(5, -3, 8, 0);
    line(8, 0, 5, 3);
    line(-3, -5, 0, -8);
    line(0, -8, 3, -5);
  } else if (glyph === 'attack') {
    line(-7, 8, 7, -8, 2);
    line(-7, -8, 7, 8, 2);
    line(-7, 3, -2, 8);
    line(2, 8, 7, 3);
  } else if (glyph === 'build' || glyph === 'craft' || glyph === 'work') {
    line(-5, 8, 4, -5, 2.4);
    line(-1, -8, 8, -2, 4);
    if (glyph === 'craft') {
      line(-8, 9, 9, 9);
      line(-8, 6, -8, 9);
    }
  } else if (glyph === 'bag') {
    c.rect(new Rect(x - 7, y - 5, 14, 14), t.raised, 2, color);
    line(-4, -5, -4, -9);
    line(-4, -9, 4, -9);
    line(4, -9, 4, -5);
    line(-6, 1, 6, 1);
  } else if (glyph === 'gear') {
    c.rect(new Rect(x - 7, y - 7, 14, 14), t.raised, 5, color);
    line(-9, 0, 9, 0);
    line(0, -9, 0, 9);
    c.rect(new Rect(x - 3, y - 3, 6, 6), t.surface, 3, color);
  } else {
    const d = glyph === 'back' ? -1 : 1;
    line(-3 * d, -5, 3 * d, 0);
    line(3 * d, 0, -3 * d, 5);
  }
  if (s.hovered || s.focused) {
    const area = c.clip(),
      w = Math.min(area.w - 8, 260, Math.max(70, c.textWidth(label, 11) + 20)),
      left = Math.max(area.x + 4, Math.min(x - w / 2, area.x + area.w - w - 4));
    const tip = new Rect(left, Math.max(area.y + 4, r.y - 31), w, 25);
    c.rect(tip, t.raised, 3, t.border);
    c.text(tip, label, t.text, 11, false, Align.Center);
  }
}
