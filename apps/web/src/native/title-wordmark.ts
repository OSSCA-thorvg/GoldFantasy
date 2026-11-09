import type { Context } from '../../../../packages/native-ui/src';
import artwork from './assets/midgard-wordmark.svg?raw';

/** Outlined Cinzel lettering keeps the title independent of font loading and raster scaling. */
export function drawTitleWordmark(context: Context, center: number, top: number, width: number): void {
  const height = (width * 1280) / 5600,
    left = center - width / 2;
  context.paint(`midgard-wordmark:${left}:${top}:${width}`, () =>
    new context.tvg.Picture().load(artwork, { type: 'svg' }).size(width, height).translate(left, top),
  );
}
