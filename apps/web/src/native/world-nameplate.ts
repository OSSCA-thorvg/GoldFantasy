import { Align, Rect, rgba, type Context, type Color } from '../../../../packages/native-ui/src';

/** Same square plate, gold ink and bold face as WorldRenderer's dungeon label. */
export const worldNameplateStyle = {
  fontSize: 8,
  height: 14,
  padding: 6,
  ink: rgba(214, 186, 120),
  plate: rgba(14, 12, 18, 190),
} as const;

/** Anchor is the horizontal center and bottom of the plate, in screen coordinates. */
export function worldNameplateBounds(
  context: Context,
  label: string,
  centerX: number,
  bottomY: number,
  scale = 1,
): Rect {
  const width =
    context.textWidth(label, worldNameplateStyle.fontSize * scale, true) +
    worldNameplateStyle.padding * 2 * scale;
  const height = worldNameplateStyle.height * scale;
  return new Rect(centerX - width / 2, bottomY - height, width, height);
}

/** The caller may reposition bounds to avoid other labels; Context owns every paint. */
export function paintWorldNameplate(
  context: Context,
  label: string,
  bounds: Rect,
  ink: Color = worldNameplateStyle.ink,
): void {
  const scale = bounds.h / worldNameplateStyle.height;
  context.rect(bounds, worldNameplateStyle.plate);
  context.text(bounds, label, ink, worldNameplateStyle.fontSize * scale, true, Align.Center);
}
