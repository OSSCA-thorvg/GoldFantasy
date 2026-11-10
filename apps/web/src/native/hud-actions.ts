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
  | 'next'
  | 'rotate'
  | 'roads'
  | 'housing'
  | 'materials'
  | 'storage'
  | 'trade'
  | 'lodging'
  | 'faith';
function tooltipPlacement(
  viewport: Rect,
  anchor: Rect,
  width: number,
  controls: readonly Rect[],
): Rect | null {
  const height = 25,
    gap = 6,
    area = viewport.inset(4);
  if (area.w < width || area.h < height) return null;
  // Panel input shields contain their child controls; only the leaves obstruct
  // a tooltip. This includes disabled buttons and inventory cells, not just the
  // icons drawn by this helper.
  const obstacles = controls.filter(
    (a) =>
      a.w > 0 &&
      a.h > 0 &&
      !controls.some(
        (b) =>
          b !== a &&
          b.w > 0 &&
          b.h > 0 &&
          b.w * b.h < a.w * a.h &&
          b.x >= a.x &&
          b.y >= a.y &&
          b.x + b.w <= a.x + a.w &&
          b.y + b.h <= a.y + a.h,
      ),
  );
  const clampX = (x: number) => Math.max(area.x, Math.min(area.x + area.w - width, x)),
    clampY = (y: number) => Math.max(area.y, Math.min(area.y + area.h - height, y)),
    centerX = anchor.x + anchor.w / 2,
    centerY = anchor.y + anchor.h / 2,
    xs = new Set([clampX(centerX - width / 2), area.x, area.x + area.w - width]),
    ys = new Set([
      clampY(anchor.y - height - gap),
      clampY(anchor.y + anchor.h + gap),
      area.y,
      area.y + area.h - height,
    ]);
  for (const r of obstacles) {
    xs.add(clampX(r.x - width - gap));
    xs.add(clampX(r.x + r.w + gap));
    ys.add(clampY(r.y - height - gap));
    ys.add(clampY(r.y + r.h + gap));
  }
  let best: Rect | null = null,
    score = Infinity;
  for (const y of ys)
    for (const x of xs) {
      const candidate = new Rect(x, y, width, height);
      if (
        obstacles.some(
          (r) =>
            candidate.x < r.x + r.w + 3 &&
            candidate.x + candidate.w > r.x - 3 &&
            candidate.y < r.y + r.h + 3 &&
            candidate.y + candidate.h > r.y - 3,
        )
      )
        continue;
      const distance = (x + width / 2 - centerX) ** 2 + (y + height / 2 - centerY) ** 2;
      if (distance < score) {
        best = candidate;
        score = distance;
      }
    }
  return best;
}
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
  tooltip = true,
): void {
  const s = button(c, id, r, '', run, active ? ButtonStyle.Primary : ButtonStyle.Quiet, enabled),
    t = c.theme();
  const color = !enabled ? t.muted : active ? t.accentText : s.hovered ? t.accent : t.text;
  const x = r.x + r.w / 2,
    y = r.y + r.h / 2;
  const line = (a: number, b: number, d: number, e: number, w = 1.7) =>
    c.line(x + a, y + b, x + d, y + e, color, w);
  if (glyph === 'rotate') {
    const ink = [color.r, color.g, color.b, color.a] as [number, number, number, number];
    c.paint(JSON.stringify(['rotate-action', r, ink]), () => new c.tvg.Shape()
      .moveTo(x + 7, y - 3).cubicTo(x + 3, y - 12, x - 10, y - 7, x - 8, y + 2)
      .cubicTo(x - 6, y + 10, x + 6, y + 10, x + 8, y + 3)
      .moveTo(x + 7, y - 9).lineTo(x + 7, y - 3).lineTo(x + 1, y - 3)
      .fill(0, 0, 0, 0).stroke({ width: 1.7, color: ink }));
  } else if (glyph === 'close') {
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
  } else if (glyph === 'roads') {
    line(-8, 9, -4, -9);
    line(8, 9, 4, -9);
    for (const offset of [-7, -1, 5]) line(0, offset, 0, offset + 3, 1.4);
  } else if (glyph === 'housing') {
    line(-10, -1, 0, -9);
    line(0, -9, 10, -1);
    line(-7, -3, -7, 8);
    line(-7, 8, 7, 8);
    line(7, 8, 7, -3);
    line(-2, 8, -2, 2);
    line(-2, 2, 2, 2);
    line(2, 2, 2, 8);
  } else if (glyph === 'materials') {
    line(-3, 9, -3, -9);
    for (const offset of [-6, -1, 4]) {
      line(-3, offset + 2, -8, offset - 2);
      line(-3, offset + 2, 2, offset - 2);
    }
    line(4, 8, 3, 2);
    line(3, 2, 7, -1);
    line(7, -1, 10, 4);
    line(10, 4, 9, 8);
    line(9, 8, 4, 8);
  } else if (glyph === 'storage') {
    line(-9, -3, 9, -3);
    line(-9, -3, -7, 9);
    line(-7, 9, 7, 9);
    line(7, 9, 9, -3);
    line(-8, 3, 8, 3);
    line(-4, -3, -4, 9, 1.2);
    line(4, -3, 4, 9, 1.2);
    line(0, -10, -3, -6);
    line(-3, -6, 0, -4);
    line(0, -4, 3, -6);
    line(3, -6, 0, -10);
  } else if (glyph === 'trade') {
    line(-9, -8, 9, -8);
    line(-9, -8, -11, -1);
    line(-11, -1, 11, -1);
    line(11, -1, 9, -8);
    line(-4, -8, -4, -1, 1.2);
    line(4, -8, 4, -1, 1.2);
    line(-8, -1, -8, 9);
    line(8, -1, 8, 9);
    line(-8, 4, 8, 4);
    line(-8, 9, 8, 9);
  } else if (glyph === 'lodging') {
    line(-9, -7, -9, 9);
    line(-9, 5, 10, 5);
    line(10, -2, 10, 9);
    line(-9, -2, 10, -2);
    line(-8, -6, -3, -6);
    line(-3, -6, -3, -2);
  } else if (glyph === 'faith') {
    line(-9, 9, 9, 9);
    line(-6, 5, 6, 5);
    line(-4, 5, -4, 9);
    line(4, 5, 4, 9);
    line(0, -10, 5, -4);
    line(5, -4, 0, 2);
    line(0, 2, -5, -4);
    line(-5, -4, 0, -10);
    line(0, -8, 0, 0, 1.2);
  } else if (glyph === 'back') {
    line(8, 0, -8, 0);
    line(-8, 0, -2, -6);
    line(-8, 0, -2, 6);
  } else {
    line(-3, -5, 3, 0);
    line(3, 0, -3, 5);
  }
  if (tooltip && (s.hovered || s.focused)) {
    c.deferOverlay(
      (area, controls) => {
        const anchor = controls.find((control) => control.id === id)?.bounds;
        if (!anchor || anchor.w <= 0 || anchor.h <= 0) return;
        const width = Math.min(area.w - 8, 260, Math.max(70, c.textWidth(label, 11) + 20)),
          tip = tooltipPlacement(
            area,
            anchor,
            width,
            controls.map((control) => control.bounds),
          );
        if (!tip) return;
        c.rect(tip, t.raised, 3, t.border);
        c.text(tip, c.elideText(label, tip.w - 12, 11), t.text, 11, false, Align.Center);
      },
      'hud-action-tooltip',
      s.hovered ? 1 : 0,
    );
  }
}
