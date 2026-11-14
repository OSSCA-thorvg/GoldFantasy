import { describe, expect, it } from 'vitest';
import type { Context } from '../../packages/native-ui/src';
import { nameplatePlace, worldNameplateStyle } from '../../apps/web/src/native/world-nameplate';

// Only the label's width is asked of the context.
const context = { textWidth: () => 48 } as unknown as Context;
/** A figure 20 wide and 40 tall standing with its feet at (x, feet). */
const figure = (x: number, feet: number) => ({
  foot: { x, y: feet },
  bounds: { x: x - 10, y: feet - 40, w: 20, h: 40 },
});

describe('the name of a hovered or selected target', () => {
  it('sits under its feet, clear of the health bar over its head', () => {
    const target = figure(300, 400),
      { bounds, below } = nameplatePlace(context, 'Askr', target, 1280, 800, 1.25);
    expect(below).toBe(true);
    expect(bounds.y).toBeGreaterThanOrEqual(400 + worldNameplateStyle.gap);
    // Nothing of the plate reaches above the feet, where bars and marks are drawn.
    expect(bounds.y).toBeGreaterThan(target.bounds.y + target.bounds.h);
    expect(bounds.x + bounds.w / 2).toBeCloseTo(300, 5);
  });
  it('goes above the target only when there is no room below it', () => {
    const target = figure(300, 700),
      { bounds, below } = nameplatePlace(context, 'Askr', target, 1280, 712, 1.25);
    expect(below).toBe(false);
    expect(bounds.y + bounds.h).toBeLessThanOrEqual(target.bounds.y);
  });
  it('stays inside the view at its sides', () => {
    expect(nameplatePlace(context, 'Askr', figure(2, 400), 1280, 800, 1.25).bounds.x).toBe(4);
    const right = nameplatePlace(context, 'Askr', figure(1278, 400), 1280, 800, 1.25).bounds;
    expect(right.x + right.w).toBeLessThanOrEqual(1276);
  });
});
