import type { LottieAnimation } from '@thorvg/webcanvas';

type Value = number | boolean | string | null | Value[] | { [key: string]: Value };
function isValue(value: unknown): value is Value {
  if (value === null || ['number', 'boolean', 'string'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isValue);
  return typeof value === 'object' && Object.values(value).every(isValue);
}
interface Frame {
  t: number;
  s: Value[];
  h?: number;
}
interface Property {
  id: string;
  frames: Frame[];
}

/**
 * The native builtins use hold keyframes as authored pose snapshots. WebCanvas
 * exposes Lottie slots but not native tweenTo/tween. Slot snapshots preserve the
 * same source properties while the source timing below performs the tween.
 */
export class IconPoses {
  private readonly properties: Property[] = [];
  readonly data: string;
  private current: Value[] = [];
  private from: Value[] = [];
  private to: Value[] = [];
  private slot = 0;
  constructor(data: string) {
    const document: unknown = JSON.parse(data);
    if (!isValue(document)) throw new TypeError('An icon must contain valid Lottie JSON.');
    const visit = (value: Value): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value.a === 1 && Array.isArray(value.k)) {
        const frames: Frame[] = value.k.map((frame) => {
          if (
            !frame ||
            typeof frame !== 'object' ||
            Array.isArray(frame) ||
            typeof frame.t !== 'number' ||
            frame.h !== 1 ||
            !Array.isArray(frame.s)
          )
            throw new Error('Native icon pose requires authored hold keyframes.');
          return { t: frame.t, s: frame.s, h: frame.h };
        });
        if (!frames.length) throw new Error('Native icon pose requires authored hold keyframes.');
        const id = `native-icon-pose-${this.properties.length}`;
        this.properties.push({ id, frames });
        value.sid = id;
        return;
      }
      Object.values(value).forEach(visit);
    };
    visit(document);
    this.data = JSON.stringify(document);
  }
  private values(frame: number): Value[] {
    return this.properties.map((property) => {
      let chosen = property.frames[0];
      for (const value of property.frames) {
        if (value.t > frame) break;
        chosen = value;
      }
      return structuredClone(chosen.s.length === 1 ? chosen.s[0] : chosen.s);
    });
  }
  private apply(animation: LottieAnimation, values: Value[]): void {
    if (this.slot) animation.del(this.slot);
    const slots: Record<string, { p: { a: 0; k: Value } }> = {};
    this.properties.forEach((property, i) => (slots[property.id] = { p: { a: 0, k: values[i] } }));
    this.slot = animation.gen(JSON.stringify(slots));
    if (this.slot) animation.apply(this.slot);
    this.current = values;
  }
  frame(animation: LottieAnimation, frame: number): void {
    this.apply(animation, this.values(frame));
  }
  tweenTo(frame: number): void {
    this.from = structuredClone(this.current);
    this.to = this.values(frame);
  }
  tween(animation: LottieAnimation, progress: number): void {
    const f = Math.fround;
    const blend = (from: Value, to: Value): Value => {
      if (typeof from === 'number' && typeof to === 'number')
        return f(f(from) + f(f(f(to) - f(from)) * progress));
      if (Array.isArray(from) && Array.isArray(to)) return from.map((value, i) => blend(value, to[i]));
      if (
        from &&
        to &&
        typeof from === 'object' &&
        typeof to === 'object' &&
        !Array.isArray(from) &&
        !Array.isArray(to)
      )
        return Object.fromEntries(Object.keys(from).map((key) => [key, blend(from[key], to[key])]));
      return progress < 1 ? from : to;
    };
    this.apply(
      animation,
      this.from.map((value, i) => blend(value, this.to[i])),
    );
  }
  dispose(animation: LottieAnimation): void {
    if (this.slot) animation.del(this.slot);
    this.slot = 0;
  }
}
