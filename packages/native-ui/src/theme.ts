import { rgba, type Color, type Align } from './types';

export enum FrameStyle {
  Plain,
  Carved,
}

/** Palette and dimensions copied without tuning from ui/core/theme.cpp and ui.h. */
export class Theme {
  radius = 7;
  fontSize = 13;
  rowHeight = 32;
  font = 'DejaVuSans';
  boldFont = 'DejaVuSans-Bold';
  frameStyle = FrameStyle.Plain;
  reducedMotion = false;
  constructor(
    public background: Color,
    public surface: Color,
    public raised: Color,
    public border: Color,
    public text: Color,
    public muted: Color,
    public accent: Color,
    public accentText: Color,
    public selection: Color,
    public success: Color,
    public danger: Color,
  ) {}
  static dark(): Theme {
    return new Theme(
      rgba(23, 25, 29),
      rgba(30, 33, 38),
      rgba(39, 43, 49),
      rgba(57, 62, 70),
      rgba(235, 237, 239),
      rgba(151, 158, 168),
      rgba(168, 190, 151),
      rgba(24, 36, 25),
      rgba(53, 67, 54),
      rgba(153, 194, 162),
      rgba(224, 148, 140),
    );
  }
  static light(): Theme {
    return new Theme(
      rgba(241, 240, 235),
      rgba(252, 251, 247),
      rgba(233, 233, 226),
      rgba(213, 215, 205),
      rgba(39, 46, 40),
      rgba(113, 121, 111),
      rgba(76, 107, 66),
      rgba(255, 255, 250),
      rgba(222, 232, 215),
      rgba(64, 122, 81),
      rgba(174, 71, 65),
    );
  }
}
export type ThemeColor =
  | 'background'
  | 'surface'
  | 'raised'
  | 'border'
  | 'text'
  | 'muted'
  | 'accent'
  | 'accentText'
  | 'selection'
  | 'success'
  | 'danger';
export type StyleColor = Color | { token: ThemeColor };
export interface Appearance {
  fill?: StyleColor;
  border?: StyleColor;
  text?: StyleColor;
  hoverFill?: StyleColor;
  pressedFill?: StyleColor;
  activeFill?: StyleColor;
  disabledFill?: StyleColor;
  radius?: number;
  borderWidth?: number;
  fontSize?: number;
  bold?: boolean;
  textAlign?: Align;
  focusRing?: boolean;
}
export function resolve(color: StyleColor | undefined, theme: Theme, fallback: Color): Color {
  return color ? ('token' in color ? theme[color.token] : color) : fallback;
}
