import { emptyEvent, type AppEvent, type Point } from './application-contracts';

/** Own a whole touch sequence, so a pinch never finishes as a stray click or road. */
export class BrowserTouch {
  private readonly fingers = new Map<number, Point>();
  private multiple = false;
  private previous: { center: Point; distance: number } | null = null;
  constructor(private readonly dispatch: (event: AppEvent) => void) {}
  private sample() {
    const [a, b] = this.fingers.values();
    return a && b
      ? {
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          distance: Math.hypot(b.x - a.x, b.y - a.y),
        }
      : null;
  }
  cancel(): void {
    this.fingers.clear();
    this.multiple = false;
    this.previous = null;
  }
  event(type: 'PointerDown' | 'PointerMove' | 'PointerUp' | 'PointerCancel', id: number, at: Point): void {
    if (type === 'PointerCancel') {
      this.cancel();
      this.dispatch({ ...emptyEvent(type), pointerType: 'touch' });
      return;
    }
    if (type === 'PointerDown') {
      this.fingers.set(id, at);
      if (this.fingers.size > 1) {
        if (!this.multiple) this.dispatch({ ...emptyEvent('PointerCancel'), pointerType: 'touch' });
        this.multiple = true;
        this.previous = this.sample();
        return;
      }
    } else if (!this.fingers.has(id)) return;
    else if (type === 'PointerUp') {
      this.fingers.delete(id);
      if (this.multiple) {
        this.previous = this.sample();
        if (!this.fingers.size) this.cancel();
        return;
      }
    } else this.fingers.set(id, at);
    if (this.multiple) {
      const next = this.sample(),
        before = this.previous;
      if (next && before)
        this.dispatch({
          ...emptyEvent('Gesture'),
          x: next.center.x,
          y: next.center.y,
          pointerType: 'touch',
          gesture: {
            dx: next.center.x - before.center.x,
            dy: next.center.y - before.center.y,
            scale: before.distance > 4 && next.distance > 4 ? next.distance / before.distance : 1,
          },
        });
      this.previous = next;
      return;
    }
    this.dispatch({ ...emptyEvent(type), x: at.x, y: at.y, pointerType: 'touch' });
  }
}
