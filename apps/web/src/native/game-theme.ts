import { FrameStyle, Theme, rgba } from '../../../../packages/native-ui/src';

export function reducedMotionPreferred(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export function gameTheme(): Theme {
  const t = Theme.dark();
  t.background = rgba(17, 20, 18);
  t.surface = rgba(25, 29, 25, 244);
  t.raised = rgba(35, 39, 32, 250);
  t.border = rgba(115, 98, 65, 210);
  t.text = rgba(225, 216, 189);
  t.muted = rgba(157, 151, 128);
  t.accent = rgba(191, 161, 99);
  t.accentText = rgba(24, 26, 21);
  t.selection = rgba(58, 66, 49);
  t.danger = rgba(202, 112, 83);
  t.success = rgba(145, 171, 132);
  t.radius = 3;
  t.frameStyle = FrameStyle.Carved;
  t.reducedMotion = reducedMotionPreferred();
  return t;
}
