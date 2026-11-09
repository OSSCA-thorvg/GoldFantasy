export const f32 = Math.fround;
export const u32 = (value: number): number => value >>> 0;
export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
export const lround = (value: number): number => value < 0 ? -Math.floor(-value + .5) : Math.floor(value + .5);
export function remainder(value: number, divisor: number): number {
  const quotient = value / divisor, lower = Math.floor(quotient), fraction = quotient - lower;
  const nearest = fraction === .5 ? (lower % 2 === 0 ? lower : lower + 1) : Math.round(quotient);
  return f32(value - nearest * divisor);
}
function mix(value: number): number {
  value ^= value >>> 16; value = Math.imul(value, 0x7feb352d); value ^= value >>> 15; value = Math.imul(value, 0x846ca68b); value ^= value >>> 16; return value >>> 0;
}
export function hash01(seed: number, x: number, y: number, salt = 0): number {
  return (mix(Math.imul(seed, 0x9e3779b9) ^ mix(Math.imul(x, 0x85ebca6b) ^ mix(Math.imul(y, 0xc2b2ae35) ^ salt))) >>> 8) / 16777216;
}
export class Dice {
  constructor(public state: number) { this.state >>>= 0; }
  roll(): number { this.state ^= this.state << 13; this.state ^= this.state >>> 17; this.state ^= this.state << 5; this.state >>>= 0; return (this.state >>> 8) / 16777216; }
}
