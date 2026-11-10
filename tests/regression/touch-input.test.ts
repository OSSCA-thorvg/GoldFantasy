import { describe, it, expect } from 'vitest';
import { BrowserTouch } from '../../apps/web/src/native/browser-touch';
import type { AppEvent } from '../../apps/web/src/native/application-contracts';

function fixture() {
  const events: AppEvent[] = [];
  return { events, touch: new BrowserTouch((event) => events.push(event)) };
}
describe('browser touch sequences', () => {
  it('forwards a single tap as one primary touch, with local canvas coordinates', () => {
    const { touch, events } = fixture();
    touch.event('PointerDown', 3, { x: 40, y: 80 });
    touch.event('PointerUp', 3, { x: 41, y: 82 });
    expect(events.map((e) => [e.type, e.pointerType, e.button, e.x, e.y])).toEqual([
      ['PointerDown', 'touch', 1, 40, 80],
      ['PointerUp', 'touch', 1, 41, 82],
    ]);
  });
  it('cancels the first finger before producing any two-finger camera gesture', () => {
    const { touch, events } = fixture();
    touch.event('PointerDown', 1, { x: 100, y: 100 });
    touch.event('PointerMove', 1, { x: 110, y: 100 });
    touch.event('PointerDown', 2, { x: 210, y: 100 });
    touch.event('PointerMove', 2, { x: 230, y: 120 });
    expect(events.map((e) => e.type)).toEqual(['PointerDown', 'PointerMove', 'PointerCancel', 'Gesture']);
    expect(events.at(-1)!.gesture!.dx).toBe(10);
    expect(events.at(-1)!.gesture!.dy).toBe(10);
    expect(events.at(-1)!.gesture!.scale).toBeCloseTo(Math.hypot(120, 20) / 100);
    expect([events.at(-1)!.x, events.at(-1)!.y]).toEqual([170, 110]);
  });
  it.each([false, true])('ignores the remaining finger after a pinch (third finger: %s)', (third) => {
    const { touch, events } = fixture();
    touch.event('PointerDown', 1, { x: 100, y: 100 });
    touch.event('PointerDown', 2, { x: 200, y: 100 });
    if (third) touch.event('PointerDown', 3, { x: 150, y: 150 });
    touch.event('PointerUp', 1, { x: 100, y: 100 });
    if (third) touch.event('PointerUp', 3, { x: 150, y: 150 });
    touch.event('PointerMove', 2, { x: 230, y: 100 });
    touch.event('PointerUp', 2, { x: 230, y: 100 });
    expect(events.map((e) => e.type)).toEqual(['PointerDown', 'PointerCancel']);
    touch.event('PointerDown', 4, { x: 50, y: 60 });
    touch.event('PointerUp', 4, { x: 50, y: 60 });
    expect(events.slice(-2).map((e) => e.type)).toEqual(['PointerDown', 'PointerUp']);
  });
  it('cancels every finger on interruption and rejects old pointer releases', () => {
    const { touch, events } = fixture();
    touch.event('PointerDown', 1, { x: 100, y: 100 });
    touch.event('PointerDown', 2, { x: 200, y: 100 });
    touch.event('PointerCancel', 1, { x: 100, y: 100 });
    const n = events.length;
    touch.event('PointerMove', 2, { x: 250, y: 150 });
    touch.event('PointerUp', 2, { x: 250, y: 150 });
    expect(events).toHaveLength(n);
    expect(events.at(-1)!.type).toBe('PointerCancel');
  });
  it('does not divide by a nearly coincident finger distance', () => {
    const { touch, events } = fixture();
    touch.event('PointerDown', 1, { x: 100, y: 100 });
    touch.event('PointerDown', 2, { x: 100, y: 100 });
    touch.event('PointerMove', 2, { x: 100.01, y: 100 });
    expect(events.at(-1)!.gesture!.scale).toBe(1);
  });
  it('clears a pinch on host focus loss before accepting a new touch', () => {
    const { touch, events } = fixture();
    touch.event('PointerDown', 1, { x: 100, y: 100 });
    touch.event('PointerDown', 2, { x: 200, y: 100 });
    touch.cancel();
    touch.event('PointerDown', 3, { x: 40, y: 40 });
    expect(events.at(-1)!.type).toBe('PointerDown');
  });
});
