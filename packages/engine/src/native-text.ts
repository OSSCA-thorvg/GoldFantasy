/** C++ classic-locale float max_digits10 formatting, retaining float32 values. */
export function nativeFloat(value: number): string {
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded)) throw new Error('A document contains a non-finite number.');
  if (rounded === 0) return Object.is(rounded, -0) ? '-0' : '0';
  const text = rounded.toPrecision(9),
    parts = text.toLowerCase().split('e');
  const mantissa = parts[0].includes('.') ? parts[0].replace(/0+$/, '').replace(/\.$/, '') : parts[0];
  if (parts.length === 1) return mantissa;
  const exponent = Number(parts[1]);
  // std::defaultfloat uses scientific notation for exponent < -4 or >= precision.
  if (exponent >= -4 && exponent < 9)
    return Number(text)
      .toFixed(Math.max(0, 8 - exponent))
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, '');
  return `${mantissa}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
}
export const quoted = (value: string): string =>
  '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

export class NativeReader {
  private at = 0;
  constructor(
    private readonly source: string,
    private readonly message: string,
  ) {}
  private whitespace(): void {
    while (this.at < this.source.length && /[ \t\n\v\f\r]/.test(this.source[this.at])) this.at++;
  }
  private rawToken(): string {
    this.whitespace();
    const first = this.at;
    while (this.at < this.source.length && !/[ \t\n\v\f\r]/.test(this.source[this.at])) this.at++;
    if (first === this.at) throw new Error(this.message);
    return this.source.slice(first, this.at);
  }
  token(): string {
    this.whitespace();
    if (this.at === this.source.length) throw new Error(this.message);
    if (this.source[this.at] === '"') {
      this.at++;
      let result = '';
      while (this.at < this.source.length) {
        let c = this.source[this.at++];
        if (c === '"') return result;
        if (c === '\\') {
          if (this.at === this.source.length) break;
          c = this.source[this.at++];
        }
        result += c;
      }
      throw new Error(this.message);
    }
    return this.rawToken();
  }
  key(expected: string): void {
    if (this.rawToken() !== expected) throw new Error(this.message);
  }
  number(): number {
    const token = this.rawToken();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)) throw new Error(this.message);
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error(this.message);
    return value;
  }
  integer(low: number, high: number): number {
    const token = this.rawToken();
    if (!/^[+-]?\d+$/.test(token)) throw new Error(this.message);
    const value = Number(token);
    if (!Number.isInteger(value) || value < low || value > high) throw new Error(this.message);
    return value;
  }
  float(low = -Infinity, high = Infinity): number {
    const value = Math.fround(this.number());
    if (!Number.isFinite(value) || value < low || value > high) throw new Error(this.message);
    return value;
  }
  end(): void {
    this.whitespace();
    if (this.at !== this.source.length) throw new Error(this.message);
  }
}
export const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;
export const validNativeName = (value: string): boolean =>
  !!value &&
  utf8Bytes(value) <= 96 &&
  !/[\u0000-\u001f\u007f]/u.test(value) &&
  !/[\uD800-\uDFFF]/u.test(value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''));
