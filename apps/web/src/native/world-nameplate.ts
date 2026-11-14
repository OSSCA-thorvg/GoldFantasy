import { Align, Rect, rgba, type Context, type Color } from '../../../../packages/native-ui/src';

/** Same square plate, gold ink and bold face as WorldRenderer's dungeon label. */
export const worldNameplateStyle = {
  fontSize: 8,
  height: 14,
  padding: 6,
  ink: rgba(214, 186, 120),
  plate: rgba(14, 12, 18, 190),
  /** Pixels between the target and its plate. */
  gap: 7,
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

/** Where a target's nameplate goes: under its feet, clear of the health bar and the marks over its head.
 * It goes above the target only when there is no room below, at `floor` (the view's edge or a panel's top). */
export function nameplatePlace(
  context: Context,
  label: string,
  target: { foot: { x: number; y: number }; bounds: { x: number; y: number; w: number; h: number } },
  viewWidth: number,
  floor: number,
  scale = 1,
): { bounds: Rect; below: boolean } {
  const center = target.bounds.x + target.bounds.w / 2,
    bounds = worldNameplateBounds(context, label, center, 0, scale),
    under = Math.max(target.foot.y, target.bounds.y + target.bounds.h) + worldNameplateStyle.gap,
    below = under + bounds.h <= floor - 4;
  bounds.w = Math.min(180, viewWidth - 8, bounds.w);
  bounds.x = Math.max(4, Math.min(viewWidth - bounds.w - 4, center - bounds.w / 2));
  bounds.y = below ? under : Math.max(4, target.bounds.y - worldNameplateStyle.gap - bounds.h);
  return { bounds, below };
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
