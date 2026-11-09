import type ThorVG from '@thorvg/webcanvas';

export type WebCanvas = Awaited<ReturnType<typeof ThorVG.init>>;
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}
export const rgba = (r: number, g: number, b: number, a = 255): Color => ({ r, g, b, a });
export const transparent = rgba(0, 0, 0, 0);

/** Literal translation of ui::Rect. Right and bottom edges are exclusive. */
export class Rect {
  constructor(
    public x = 0,
    public y = 0,
    public w = 0,
    public h = 0,
  ) {
    this.x = Math.fround(x);
    this.y = Math.fround(y);
    this.w = Math.fround(w);
    this.h = Math.fround(h);
  }
  contains(px: number, py: number): boolean {
    px = Math.fround(px);
    py = Math.fround(py);
    return (
      this.w > 0 &&
      this.h > 0 &&
      px >= this.x &&
      py >= this.y &&
      px < Math.fround(this.x + this.w) &&
      py < Math.fround(this.y + this.h)
    );
  }
  inset(amount: number): Rect {
    amount = Math.fround(amount);
    return new Rect(
      Math.fround(this.x + amount),
      Math.fround(this.y + amount),
      Math.max(0, Math.fround(this.w - Math.fround(amount * 2))),
      Math.max(0, Math.fround(this.h - Math.fround(amount * 2))),
    );
  }
  intersect(other: Rect): Rect {
    const left = Math.max(this.x, other.x),
      top = Math.max(this.y, other.y);
    return new Rect(
      left,
      top,
      Math.max(0, Math.fround(Math.min(Math.fround(this.x + this.w), Math.fround(other.x + other.w)) - left)),
      Math.max(0, Math.fround(Math.min(Math.fround(this.y + this.h), Math.fround(other.y + other.h)) - top)),
    );
  }
}
export enum Key {
  Unknown,
  Tab,
  Enter,
  Space,
  Escape,
  Left,
  Right,
  Up,
  Down,
  Home,
  End,
  Backspace,
  Delete,
}
export enum EventType {
  Press,
  Drag,
  Activate,
  Key,
  Text,
  Scroll,
  Release,
  Cancel,
  ContextMenu,
}
export enum Cursor {
  Default,
  Text,
  ResizeHorizontal,
  ResizeVertical,
}
export enum Align {
  Start,
  Center,
  End,
}
export enum ButtonStyle {
  Default,
  Primary,
  Quiet,
}
export enum Icon {
  None,
  Folder,
  Check,
  Chevron,
  ChevronLeft,
}
export interface Event {
  type: EventType;
  x: number;
  y: number;
  key: Key;
  shift: boolean;
  text: string;
}
export interface State {
  hovered: boolean;
  pressed: boolean;
  focused: boolean;
}
export interface IconState extends State {
  active: boolean;
  enabled: boolean;
}
export const iconName = (icon: Icon): string =>
  ['none', 'folder', 'check', 'chevron', 'chevron-left'][icon] ?? 'none';

export class FrameRequest {
  private next: number | undefined;
  clear(): void {
    this.next = undefined;
  }
  requestAt(seconds: number): void {
    if (Number.isFinite(seconds) && seconds >= 0 && (this.next === undefined || seconds < this.next))
      this.next = seconds;
  }
  deadline(): number | undefined {
    return this.next;
  }
  due(seconds: number): boolean {
    return this.next !== undefined && seconds >= this.next;
  }
  delay(seconds: number): number {
    return this.next === undefined
      ? -1
      : Math.min(2147483647, Math.ceil(Math.max(0, (this.next - seconds) * 1000 - 1e-6)));
  }
}
