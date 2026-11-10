import { Rect } from '../../../../packages/native-ui/src';

export const compactViewport = (width: number, height: number): boolean => width < 600 || height < 500;
export const touchPlacementHeight = 110;
export function touchCommandColumns(width: number, count: number): number {
  const maximum = Math.max(1, Math.min(count, Math.floor((width + 6) / 50)));
  return Math.ceil(count / Math.ceil(count / maximum));
}
/** Leave room for the sky controls, the entire placement dock, and the fingertip. */
export function placementMapBounds(width: number, height: number): Rect {
  const top = Math.min(120, height * 0.3),
    bottom = height - touchPlacementHeight - 52;
  return new Rect(32, top, Math.max(1, width - 64), Math.max(1, bottom - top));
}
