// Native SaveArchive primitives. Raw records retain ABI padding when a native save is round-tripped.
import layouts from '../data/native-save-layout.json';
export interface Codec<T> {
  read(archive: SaveArchive): T;
  write(archive: SaveArchive, value: unknown): void;
}
export type Schema = Readonly<Record<string, Codec<unknown>>>;
const textEncoder = new TextEncoder(),
  textDecoder = new TextDecoder();
const rawBytes = Symbol('native save padding');
export function object(value: unknown): object {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid save record');
  return value;
}
export function numeric(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Invalid numeric save field');
  return value;
}
export class SaveArchive {
  cursor = 0;
  formatVersion = 7;
  // The initial native v6 writer tagged monsters as well as wildlife. Read-only compatibility.
  legacyV6MonsterTags = false;
  private bytes: Uint8Array;
  // One view for every scalar; allocating a view per field dominated save time.
  private view: DataView;
  constructor(
    readonly reading = false,
    bytes: Uint8Array = new Uint8Array(1024),
  ) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  /** Reserves length bytes and returns their offset in data(). */
  reserve(length: number): number {
    const start = this.cursor,
      end = start + length;
    if (this.reading && end > this.bytes.length) throw new Error('Truncated save');
    if (!this.reading && end > this.bytes.length) this.grow(end);
    this.cursor = end;
    return start;
  }
  data(): DataView {
    return this.view;
  }
  private grow(end: number): void {
    const next = new Uint8Array(Math.max(end, this.bytes.length * 2, 1024));
    next.set(this.bytes);
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }
  buffer(): Uint8Array {
    return this.bytes.subarray(0, this.cursor);
  }
  remaining(): number {
    return this.bytes.length - this.cursor;
  }
  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid save length');
    const end = this.cursor + length;
    if (this.reading && end > this.bytes.length) throw new Error('Truncated save');
    if (!this.reading && end > this.bytes.length) this.grow(end);
    const result = this.bytes.subarray(this.cursor, end);
    this.cursor = end;
    return result;
  }
  value<T>(codec: Codec<T>, value: T): T {
    if (this.reading) return codec.read(this);
    codec.write(this, value);
    return value;
  }
  fields(target: object, schema: Schema): void {
    for (const [name, codec] of Object.entries(schema)) {
      if (this.reading) Reflect.set(target, name, codec.read(this));
      else codec.write(this, Reflect.get(target, name));
    }
  }
}
function scalar<T>(
  bytes: number,
  read: (view: DataView, at: number) => T,
  write: (view: DataView, at: number, value: unknown) => void,
): Codec<T> {
  return {
    read: (a) => {
      const at = a.reserve(bytes);
      return read(a.data(), at);
    },
    write: (a, v) => {
      const at = a.reserve(bytes);
      write(a.data(), at, v);
    },
  };
}
export const u8 = scalar(
  1,
  (v, at) => v.getUint8(at),
  (v, at, n) => v.setUint8(at, numeric(n)),
);
export const i8 = scalar(
  1,
  (v, at) => v.getInt8(at),
  (v, at, n) => v.setInt8(at, numeric(n)),
);
export const i32 = scalar(
  4,
  (v, at) => v.getInt32(at, true),
  (v, at, n) => v.setInt32(at, numeric(n), true),
);
export const u32 = scalar(
  4,
  (v, at) => v.getUint32(at, true),
  (v, at, n) => v.setUint32(at, numeric(n), true),
);
export const u64 = scalar(
  8,
  (v, at) => v.getBigUint64(at, true),
  (v, at, n) => {
    if (typeof n !== 'bigint') throw new Error('Invalid 64-bit save field');
    v.setBigUint64(at, n, true);
  },
);
export const f32 = scalar(
  4,
  (v, at) => v.getFloat32(at, true),
  (v, at, n) => v.setFloat32(at, numeric(n), true),
);
export const f64 = scalar(
  8,
  (v, at) => v.getFloat64(at, true),
  (v, at, n) => v.setFloat64(at, numeric(n), true),
);
export const boolean = scalar(
  1,
  (v, at) => v.getUint8(at) !== 0,
  (v, at, b) => {
    if (typeof b !== 'boolean') throw new Error('Invalid boolean save field');
    v.setUint8(at, b ? 1 : 0);
  },
);
export const string: Codec<string> = {
  read(a) {
    const count = u32.read(a);
    if (count > 1048576) throw new Error('Save string too large');
    return textDecoder.decode(a.take(count));
  },
  write(a, value) {
    if (typeof value !== 'string') throw new Error('Invalid save string');
    const bytes = textEncoder.encode(value);
    u32.write(a, bytes.length);
    if (bytes.length > 1048576) throw new Error('Save string too large');
    a.take(bytes.length).set(bytes);
  },
};
/** A length-prefixed f32 run, byte-identical to vector(f32) without a codec call per value. */
export function writeFloats(a: SaveArchive, values: Float32Array): void {
  if (values.length > 2000000) throw new Error('Save collection too large');
  u32.write(a, values.length);
  const at = a.reserve(values.length * 4),
    view = a.data();
  for (let i = 0; i < values.length; ++i) view.setFloat32(at + i * 4, values[i], true);
}
export function vector<T>(item: Codec<T>, limit = 2000000): Codec<T[]> {
  return {
    read(a) {
      const count = u32.read(a);
      if (count > limit) throw new Error(limit === 10000 ? 'Too many notices' : 'Save collection too large');
      const values: T[] = [];
      for (let i = 0; i < count; ++i) values.push(item.read(a));
      return values;
    },
    write(a, values) {
      if (!Array.isArray(values) && !(values instanceof Uint8Array) && !(values instanceof Float32Array))
        throw new Error('Invalid save collection');
      u32.write(a, values.length);
      if (values.length > limit)
        throw new Error(limit === 10000 ? 'Too many notices' : 'Save collection too large');
      for (const value of values) item.write(a, value);
    },
  };
}
export function optional<T>(item: Codec<T>): Codec<T | null> {
  return {
    read(a) {
      const present = u8.read(a);
      if (present > 1) throw new Error('Invalid optional');
      return present ? item.read(a) : null;
    },
    write(a, value) {
      u8.write(a, value === null ? 0 : 1);
      if (value !== null) item.write(a, value);
    },
  };
}
export function record<T extends object>(
  factory: () => T,
  schema: Schema,
  validate?: (value: T, reading: boolean) => void,
): Codec<T> {
  return {
    read(a) {
      const value = factory();
      a.fields(value, schema);
      validate?.(value, true);
      return value;
    },
    write(a, value) {
      object(value);
      const copy = factory();
      Object.assign(copy, value);
      a.fields(copy, schema);
      validate?.(copy, false);
    },
  };
}
interface RawField {
  name: string;
  type: string;
  offset: number;
  size: number;
}
interface RawLayout {
  size: number;
  fields: RawField[];
}
const types: Record<string, RawLayout> = layouts;
const scalars: Record<string, Codec<unknown>> = { u8, i8, i32, u32, u64, f32, f64, bool: boolean };
function readRaw(name: string, bytes: Uint8Array): Record<string, unknown> {
  const type = types[name];
  if (!type) throw new Error('Unknown save ABI record');
  const value: Record<string, unknown> = {};
  for (const field of type.fields) {
    const data = bytes.subarray(field.offset, field.offset + field.size);
    value[field.name] = scalars[field.type]
      ? scalars[field.type].read(new SaveArchive(true, data))
      : readRaw(field.type, data);
  }
  if (type.fields.reduce((size, field) => size + field.size, 0) !== type.size)
    Object.defineProperty(value, rawBytes, { value: new Uint8Array(bytes), enumerable: true });
  return value;
}
// Writes straight through one view: a tile map is tens of thousands of records.
function writeRawFields(type: RawLayout, target: object, view: DataView, base: number): void {
  for (const field of type.fields) {
    const current: unknown = Reflect.get(target, field.name),
      at = base + field.offset;
    switch (field.type) {
      case 'u8':
        view.setUint8(at, numeric(current));
        break;
      case 'i8':
        view.setInt8(at, numeric(current));
        break;
      case 'i32':
        view.setInt32(at, numeric(current), true);
        break;
      case 'u32':
        view.setUint32(at, numeric(current), true);
        break;
      case 'f32':
        view.setFloat32(at, numeric(current), true);
        break;
      case 'f64':
        view.setFloat64(at, numeric(current), true);
        break;
      case 'u64':
        if (typeof current !== 'bigint') throw new Error('Invalid 64-bit save field');
        view.setBigUint64(at, current, true);
        break;
      case 'bool':
        if (typeof current !== 'boolean') throw new Error('Invalid boolean save field');
        view.setUint8(at, current ? 1 : 0);
        break;
      default: {
        const nested = types[field.type];
        if (!nested) throw new Error('Unknown save ABI record');
        writeRawFields(nested, object(current), view, at);
      }
    }
  }
}
function writeRaw(name: string, value: unknown, bytes: Uint8Array): void {
  const target = object(value),
    type = types[name];
  if (!type) throw new Error('Unknown save ABI record');
  const padding: unknown = Reflect.get(target, rawBytes);
  if (padding instanceof Uint8Array && padding.length === bytes.length) bytes.set(padding);
  else bytes.fill(0);
  writeRawFields(type, target, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0);
}
export function raw<T extends object>(name: string, factory: () => T): Codec<T> {
  const type = types[name];
  if (!type) throw new Error('Unknown save ABI record');
  return {
    read: (a) => Object.assign(factory(), readRaw(name, a.take(type.size))),
    write: (a, value) => writeRaw(name, value, a.take(type.size)),
  };
}
export const nativeAppearanceSize = layouts.Appearance.size,
  nativeClimateSize = layouts.Climate.size;
export function digest(bytes: Uint8Array): bigint {
  // FNV-1a 64 in two 32-bit halves; a BigInt per byte took most of a save.
  let low = 0x84222325,
    high = 0xcbf29ce4;
  for (let i = 0; i < bytes.length; ++i) {
    low = (low ^ bytes[i]) >>> 0;
    // The prime is 2^40 + 0x1b3; the low word multiplies in 16-bit halves to stay in integers.
    const bottom = (low & 0xffff) * 0x1b3,
      top = (low >>> 16) * 0x1b3 + (bottom >>> 16);
    high = (Math.imul(high, 0x1b3) + (top >>> 16) + (low << 8)) >>> 0;
    low = (((top & 0xffff) << 16) | (bottom & 0xffff)) >>> 0;
  }
  return (BigInt(high) << 32n) | BigInt(low);
}
const hexDigits = textEncoder.encode('0123456789abcdef'),
  saveHeader = 'GoldFantasy-save\n';
/** Appends the checksum to a save payload and returns the stored text. Safe to run off the main thread. */
export function sealSave(payload: Uint8Array): string {
  const sum = digest(payload),
    digits = new Uint8Array((payload.length + 8) * 2);
  let at = 0;
  const put = (byte: number) => {
    digits[at++] = hexDigits[byte >> 4];
    digits[at++] = hexDigits[byte & 15];
  };
  for (let i = 0; i < payload.length; ++i) put(payload[i]);
  for (let i = 0n; i < 8n; ++i) put(Number((sum >> (i * 8n)) & 0xffn));
  return saveHeader + textDecoder.decode(digits);
}
