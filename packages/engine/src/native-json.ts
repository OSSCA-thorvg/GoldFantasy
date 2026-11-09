// Native core/json/json.cpp semantics. The browser boundary supplies UTF-8 text;
// duplicate keys, malformed UTF-8, nonfinite/underflowed numbers and limits retain
// the original reader's byte positions and error messages.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface JsonLimits {
  maxBytes: number;
  maxDepth: number;
  maxValues: number;
}
export const jsonLimits: Readonly<JsonLimits> = {
  maxBytes: 4 * 1024 * 1024,
  maxDepth: 64,
  maxValues: 200000,
};
function utf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff)
      c = 0x10000 + ((c - 0xd800) << 10) + text.charCodeAt(++i) - 0xdc00;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(bytes);
}
function sequence(bytes: Uint8Array, at: number): { size: number; code: number } | undefined {
  const first = bytes[at],
    size =
      first >= 0xc2 && first <= 0xdf
        ? 2
        : first >= 0xe0 && first <= 0xef
          ? 3
          : first >= 0xf0 && first <= 0xf4
            ? 4
            : 0;
  if (!size || at + size > bytes.length) return undefined;
  let code = first & ((1 << (7 - size)) - 1);
  for (let i = 1; i < size; i++) {
    const b = bytes[at + i];
    if ((b & 0xc0) !== 0x80) return undefined;
    code = code * 64 + (b & 63);
  }
  if (
    code < (size === 2 ? 0x80 : size === 3 ? 0x800 : 0x10000) ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff)
  )
    return undefined;
  return { size, code };
}
class Reader {
  at = 0;
  count = 0;
  constructor(
    readonly text: Uint8Array,
    readonly limits: JsonLimits,
  ) {}
  fail(reason: string): never {
    throw new Error(`${reason} at byte ${this.at}`);
  }
  peek(): number {
    return this.at < this.text.length ? this.text[this.at] : 0;
  }
  spaces(): void {
    while ([32, 9, 13, 10].includes(this.peek())) this.at++;
  }
  eat(ch: number): boolean {
    if (this.peek() !== ch) return false;
    this.at++;
    return true;
  }
  digit(ch: number): boolean {
    return ch >= 48 && ch <= 57;
  }
  hex4(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const ch = this.peek(),
        digit =
          ch >= 48 && ch <= 57
            ? ch - 48
            : ch >= 97 && ch <= 102
              ? ch - 97 + 10
              : ch >= 65 && ch <= 70
                ? ch - 65 + 10
                : 16;
      if (digit === 16) this.fail('Invalid Unicode escape');
      this.at++;
      value = value * 16 + digit;
    }
    return value;
  }
  string(): string {
    if (!this.eat(34)) this.fail('Expected string');
    let result = '';
    while (this.at < this.text.length) {
      const byte = this.text[this.at++];
      if (byte === 34) return result;
      if (byte < 32) this.fail('Unescaped control character');
      if (byte === 92) {
        if (this.at === this.text.length) this.fail('Unfinished escape');
        const ch = this.text[this.at++];
        const escaped: Record<number, string> = {
          34: '"',
          92: '\\',
          47: '/',
          98: '\b',
          102: '\f',
          110: '\n',
          114: '\r',
          116: '\t',
        };
        if (ch in escaped) result += escaped[ch];
        else if (ch === 117) {
          let code = this.hex4();
          if (code >= 0xd800 && code <= 0xdbff) {
            if (!this.eat(92) || !this.eat(117)) this.fail('Missing low surrogate');
            const low = this.hex4();
            if (low < 0xdc00 || low > 0xdfff) this.fail('Invalid low surrogate');
            code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
          } else if (code >= 0xdc00 && code <= 0xdfff) this.fail('Unpaired low surrogate');
          result += String.fromCodePoint(code);
        } else this.fail('Invalid escape');
      } else if (byte < 128) result += String.fromCharCode(byte);
      else {
        const s = sequence(this.text, this.at - 1);
        if (!s) this.fail('Invalid UTF-8');
        result += String.fromCodePoint(s.code);
        this.at += s.size - 1;
      }
    }
    return this.fail('Unterminated string');
  }
  number(): number {
    const begin = this.at;
    this.eat(45);
    if (!this.eat(48)) {
      if (!this.digit(this.peek())) this.fail('Expected number');
      while (this.digit(this.peek())) this.at++;
    }
    if (this.eat(46)) {
      if (!this.digit(this.peek())) this.fail('Expected fraction');
      while (this.digit(this.peek())) this.at++;
    }
    if (this.eat(101) || this.eat(69)) {
      if (!this.eat(43)) this.eat(45);
      if (!this.digit(this.peek())) this.fail('Expected exponent');
      while (this.digit(this.peek())) this.at++;
    }
    const token = new TextDecoder().decode(this.text.subarray(begin, this.at)),
      value = Number(token);
    if (!Number.isFinite(value) || (value === 0 && /[1-9]/.test(token.split(/[eE]/)[0])))
      this.fail('Number out of range');
    return value;
  }
  read(depth: number): JsonValue {
    if (depth > this.limits.maxDepth) this.fail('JSON nesting limit exceeded');
    if (++this.count > this.limits.maxValues) this.fail('JSON value limit exceeded');
    this.spaces();
    if (this.peek() === 34) return this.string();
    if (this.eat(123)) {
      const object: { [key: string]: JsonValue } = Object.create(null);
      this.spaces();
      if (this.eat(125)) return object;
      do {
        this.spaces();
        const key = this.string();
        this.spaces();
        if (!this.eat(58)) this.fail('Expected colon');
        const child = this.read(depth + 1);
        if (Object.hasOwn(object, key)) this.fail('Duplicate object key');
        object[key] = child;
        this.spaces();
        if (this.eat(125)) return object;
      } while (this.eat(44));
      this.fail('Expected comma or closing brace');
    }
    if (this.eat(91)) {
      const array: JsonValue[] = [];
      this.spaces();
      if (this.eat(93)) return array;
      do {
        array.push(this.read(depth + 1));
        this.spaces();
        if (this.eat(93)) return array;
      } while (this.eat(44));
      this.fail('Expected comma or closing bracket');
    }
    for (const literal of ['true', 'false', 'null'])
      if ([...literal].every((ch, i) => this.text[this.at + i] === ch.charCodeAt(0))) {
        this.at += literal.length;
        return literal === 'null' ? null : literal === 'true';
      }
    if (this.peek() === 45 || this.digit(this.peek())) return this.number();
    return this.fail('Expected JSON value');
  }
  document(): JsonValue {
    if (this.text.length > this.limits.maxBytes) this.fail('JSON byte limit exceeded');
    const result = this.read(0);
    this.spaces();
    if (this.at !== this.text.length) this.fail('Trailing data');
    return result;
  }
}
export function parseJson(source: string | Uint8Array, limits: Partial<JsonLimits> = {}): JsonValue {
  return new Reader(typeof source === 'string' ? utf8(source) : source, {
    ...jsonLimits,
    ...limits,
  }).document();
}
// std::to_chars chooses the shorter fixed/scientific representation, preferring
// fixed on ties. Fixed integers are exact rather than JS's shortest significant digits.
function fixed(value: number, places: number): string {
  const buffer = new DataView(new ArrayBuffer(8));
  buffer.setFloat64(0, value);
  const bits = buffer.getBigUint64(0),
    exponent = Number((bits >> 52n) & 0x7ffn);
  let numerator = bits & 0xfffffffffffffn;
  if (exponent) numerator |= 1n << 52n;
  const binaryExponent = (exponent || 1) - 1023 - 52;
  let denominator = 1n;
  if (binaryExponent >= 0) numerator <<= BigInt(binaryExponent);
  else denominator <<= BigInt(-binaryExponent);
  numerator *= 10n ** BigInt(places);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && rounded % 2n !== 0n)) rounded++;
  let text = rounded.toString();
  if (places) {
    text = text.padStart(places + 1, '0');
    text = text.slice(0, -places) + '.' + text.slice(-places);
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  return text;
}
export function jsonNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Nonfinite JSON number');
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const sign = value < 0 ? '-' : '',
    absolute = Math.abs(value),
    [mantissa, exp] = absolute.toExponential().split('e'),
    exponent = Number(exp);
  const scientific =
    mantissa + 'e' + (exponent >= 0 ? '+' : '-') + Math.abs(exponent).toString().padStart(2, '0');
  const decimal = fixed(absolute, Math.max(0, mantissa.replace('.', '').length - 1 - exponent));
  return sign + (decimal.length <= scientific.length ? decimal : scientific);
}
export function stringifyJson(value: JsonValue, pretty = true): string {
  let count = 0,
    bytes = 0;
  const chunks: string[] = [];
  const append = (text: string) => {
    chunks.push(text);
    bytes += utf8(text).length;
  };
  const check = () => {
    if (bytes > jsonLimits.maxBytes) throw new Error('JSON byte limit exceeded');
  };
  const indent = (depth: number) => {
    if (pretty) append('\n' + ' '.repeat(depth * 2));
  };
  const quoted = (text: string) => {
    append('"');
    const encoded = utf8(text);
    for (let i = 0; i < encoded.length;) {
      const ch = encoded[i];
      if (ch < 32) {
        append('\\u00' + ch.toString(16).padStart(2, '0'));
        i++;
      } else if (ch < 128) {
        append((ch === 34 || ch === 92 ? '\\' : '') + String.fromCharCode(ch));
        i++;
      } else {
        const s = sequence(encoded, i);
        if (!s) throw new Error('Invalid UTF-8 in JSON string');
        append(String.fromCodePoint(s.code));
        i += s.size;
      }
      check();
    }
    append('"');
  };
  const compareKeys = (a: string, b: string) => {
    const aa = utf8(a),
      bb = utf8(b);
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return aa.length - bb.length;
  };
  const write = (item: JsonValue, depth: number) => {
    if (depth > jsonLimits.maxDepth || ++count > jsonLimits.maxValues)
      throw new Error('JSON complexity limit exceeded');
    if (typeof item === 'boolean') append(item ? 'true' : 'false');
    else if (typeof item === 'number') append(jsonNumber(item));
    else if (typeof item === 'string') quoted(item);
    else if (Array.isArray(item)) {
      append('[');
      item.forEach((child, i) => {
        if (i) append(',');
        indent(depth + 1);
        write(child, depth + 1);
      });
      if (item.length) indent(depth);
      append(']');
    } else if (item) {
      const keys = Object.keys(item).sort(compareKeys);
      append('{');
      keys.forEach((key, i) => {
        if (i) append(',');
        indent(depth + 1);
        quoted(key);
        append(pretty ? ': ' : ':');
        write(item[key], depth + 1);
      });
      if (keys.length) indent(depth);
      append('}');
    } else append('null');
    check();
  };
  write(value, 0);
  if (pretty) append('\n');
  return chunks.join('');
}
