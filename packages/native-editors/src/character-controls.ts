import {
  Align,
  ButtonStyle,
  Context,
  EventType,
  Icon,
  Key,
  Rect,
  button,
  rgba,
  type State,
} from '../../native-ui/src';
import { clamp, f32 as f, type Rgb } from '../../engine/src';

export function characterButton(
  c: Context,
  id: string,
  r: Rect,
  label: string,
  activate: () => void,
  style = ButtonStyle.Default,
  enabled = true,
  icon = Icon.None,
  active = false,
): State {
  return button(c, id, r, label, activate, style, enabled, icon, active, { focusRing: true });
}
export function characterChoice(
  c: Context,
  id: string,
  r: Rect,
  label: string,
  options: readonly string[],
  value: number,
  change: (value: number) => void,
): void {
  const t = c.theme();
  c.text(new Rect(r.x, r.y, r.w, 18), label, t.muted, 12);
  const y = f(r.y + 23);
  c.rect(new Rect(r.x, y, r.w, 30), t.background, t.radius, t.border);
  characterButton(
    c,
    id + '-prev',
    new Rect(r.x, y, 30, 30),
    '',
    () => change((value + options.length - 1) % options.length),
    ButtonStyle.Quiet,
    true,
    Icon.ChevronLeft,
  );
  c.text(new Rect(f(r.x + 34), y, f(r.w - 68), 30), options[value], t.text, 13, false, Align.Center);
  characterButton(
    c,
    id + '-next',
    new Rect(f(f(r.x + r.w) - 30), y, 30, 30),
    '',
    () => change((value + 1) % options.length),
    ButtonStyle.Quiet,
    true,
    Icon.Chevron,
  );
}
export function characterSlider(
  c: Context,
  id: string,
  r: Rect,
  label: string,
  value: number,
  minimum: number,
  maximum: number,
  begin: () => void,
  change: (value: number) => void,
): void {
  minimum = f(minimum);
  maximum = f(maximum);
  const t = c.theme(),
    fraction = clamp(f(f(value - minimum) / f(maximum - minimum)), 0, 1);
  c.text(new Rect(r.x, r.y, r.w, 18), label, t.muted, 12);
  c.text(new Rect(r.x, r.y, r.w, 18), `${Math.round(f(fraction * 100))}%`, t.text, 12, false, Align.End);
  const track = new Rect(f(r.x + 6), f(r.y + 31), f(r.w - 12), 4),
    state = c.control(
      id,
      new Rect(r.x, f(r.y + 20), r.w, 24),
      (event) => {
        if (event.type === EventType.Press || event.type === EventType.Drag) {
          if (event.type === EventType.Press) begin();
          change(f(minimum + f(clamp(f(f(event.x - track.x) / track.w), 0, 1) * f(maximum - minimum))));
        } else if (event.type === EventType.Key) {
          let next = value;
          if (event.key === Key.Left || event.key === Key.Down)
            next = f(next - f(f(maximum - minimum) * f(0.02)));
          else if (event.key === Key.Right || event.key === Key.Up)
            next = f(next + f(f(maximum - minimum) * f(0.02)));
          else if (event.key === Key.Home) next = minimum;
          else if (event.key === Key.End) next = maximum;
          else return;
          begin();
          change(clamp(next, minimum, maximum));
        }
      },
      true,
      true,
      false,
      true,
    );
  c.rect(track, t.border, 2);
  c.rect(new Rect(track.x, track.y, Math.max(4, f(track.w * fraction)), 4), t.accent, 2);
  c.rect(
    new Rect(f(f(track.x + f(track.w * fraction)) - 5), f(track.y - 4), 10, 12),
    t.text,
    5,
    state.focused || state.hovered ? t.accent : t.border,
  );
  if (state.focused) c.focusRing(new Rect(r.x, f(r.y + 20), r.w, 24));
}
export function characterColor(
  c: Context,
  r: Rect,
  value: Rgb,
  begin: () => void,
  change: (value: Rgb) => void,
): void {
  const palette: [[number, number, number], ...[number, number, number][]] = [
      [9, 17, 15],
      [55, 38, 23],
      [151, 98, 76],
      [211, 153, 130],
      [240, 205, 179],
      [237, 224, 171],
      [173, 72, 39],
      [219, 181, 93],
      [78, 91, 68],
      [48, 93, 111],
      [133, 81, 92],
      [55, 111, 116],
    ],
    t = c.theme();
  c.rect(new Rect(r.x, r.y, 30, 24), rgba(value.r, value.g, value.b), t.radius, t.border);
  c.text(new Rect(f(r.x + 42), r.y, f(r.w - 42), 24), `${value.r} / ${value.g} / ${value.b}`, t.text, 12);
  const cell = f(f(r.w - 30) / 6);
  palette.forEach(([red, green, blue], i) => {
    const swatch = { r: red, g: green, b: blue },
      box = new Rect(f(r.x + f((i % 6) * f(cell + 6))), f(f(r.y + 36) + Math.trunc(i / 6) * 30), cell, 24),
      selected = value.r === red && value.g === green && value.b === blue;
    const state = c.control('studio-swatch-' + i, box, (event) => {
      if (
        event.type === EventType.Activate ||
        (event.type === EventType.Key && (event.key === Key.Enter || event.key === Key.Space))
      ) {
        begin();
        change({ ...swatch });
      }
    });
    c.rect(
      box,
      rgba(red, green, blue),
      t.radius,
      selected || state.hovered ? t.text : t.border,
      selected ? 2 : 1,
    );
    if (state.focused) c.focusRing(box);
  });
  for (let channel = 0; channel < 3; channel++) {
    const key = (['r', 'g', 'b'] as const)[channel];
    characterSlider(
      c,
      'studio-rgb-' + channel,
      new Rect(r.x, f(f(r.y + 104) + channel * 44), r.w, 44),
      ['Red', 'Green', 'Blue'][channel],
      value[key],
      0,
      255,
      begin,
      (v) => change({ ...value, [key]: Math.round(v) }),
    );
  }
}
