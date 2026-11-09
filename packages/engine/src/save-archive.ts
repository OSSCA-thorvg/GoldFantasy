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
  constructor(
    readonly reading = false,
    bytes: Uint8Array = new Uint8Array(1024),
  ) {
    this.bytes = bytes;
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
    if (!this.reading && end > this.bytes.length) {
      const next = new Uint8Array(Math.max(end, this.bytes.length * 2, 1024));
      next.set(this.bytes);
      this.bytes = next;
    }
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
  read: (view: DataView) => T,
  write: (view: DataView, value: unknown) => void,
): Codec<T> {
  return {
    read: (a) => {
      const data = a.take(bytes);
      return read(new DataView(data.buffer, data.byteOffset, data.byteLength));
    },
    write: (a, v) => {
      const data = a.take(bytes);
      write(new DataView(data.buffer, data.byteOffset, data.byteLength), v);
    },
  };
}
export const u8 = scalar(
  1,
  (v) => v.getUint8(0),
  (v, n) => v.setUint8(0, numeric(n)),
);
export const i8 = scalar(
  1,
  (v) => v.getInt8(0),
  (v, n) => v.setInt8(0, numeric(n)),
);
export const i32 = scalar(
  4,
  (v) => v.getInt32(0, true),
  (v, n) => v.setInt32(0, numeric(n), true),
);
export const u32 = scalar(
  4,
  (v) => v.getUint32(0, true),
  (v, n) => v.setUint32(0, numeric(n), true),
);
export const u64 = scalar(
  8,
  (v) => v.getBigUint64(0, true),
  (v, n) => {
    if (typeof n !== 'bigint') throw new Error('Invalid 64-bit save field');
    v.setBigUint64(0, n, true);
  },
);
export const f32 = scalar(
  4,
  (v) => v.getFloat32(0, true),
  (v, n) => v.setFloat32(0, numeric(n), true),
);
export const f64 = scalar(
  8,
  (v) => v.getFloat64(0, true),
  (v, n) => v.setFloat64(0, numeric(n), true),
);
export const boolean = scalar(
  1,
  (v) => v.getUint8(0) !== 0,
  (v, b) => {
    if (typeof b !== 'boolean') throw new Error('Invalid boolean save field');
    v.setUint8(0, b ? 1 : 0);
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
function writeRaw(name: string, value: unknown, bytes: Uint8Array): void {
  const target = object(value),
    type = types[name];
  if (!type) throw new Error('Unknown save ABI record');
  const padding: unknown = Reflect.get(target, rawBytes);
  if (padding instanceof Uint8Array && padding.length === bytes.length) bytes.set(padding);
  else bytes.fill(0);
  for (const field of type.fields) {
    const data = bytes.subarray(field.offset, field.offset + field.size),
      current: unknown = Reflect.get(target, field.name);
    if (scalars[field.type]) scalars[field.type].write(new SaveArchive(false, data), current);
    else writeRaw(field.type, current, data);
  }
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
  let hash = 14695981039346656037n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return hash;
}
