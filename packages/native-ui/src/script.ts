/** Literal translation of ui/script.cpp. The language VM is unmodified Lua 5.4.8. */
import { Context } from './context';
import { button } from './controls';
import { ButtonStyle, Rect, type Color } from './types';
import { scriptRuntime, type LuaModule } from './script-runtime';

export { prepareScriptRuntime } from './script-runtime';
export interface ScriptProperty {
  id: string;
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  readOnly: boolean;
}
const registry = -1001000,
  noRef = -2;
const nil = 0,
  boolean = 1,
  number = 3,
  string = 4,
  table = 5,
  func = 6;
const utf8 = new TextEncoder(),
  decoder = new TextDecoder();
// Lua strings are byte strings. Surrogate escapes keep malformed UTF-8 distinct
// in JavaScript identifiers; normal authored UTF-8 retains its original text.
function decodeBytes(bytes: Uint8Array): string {
  let result = '',
    start = 0;
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!,
      count =
        b < 128 ? 1 : b >= 194 && b <= 223 ? 2 : b >= 224 && b <= 239 ? 3 : b >= 240 && b <= 244 ? 4 : 0;
    let valid = count > 0 && i + count <= bytes.length;
    for (let n = 1; valid && n < count; n++) valid = bytes[i + n]! >= 128 && bytes[i + n]! <= 191;
    if (valid && count === 3) valid = b !== 224 || bytes[i + 1]! >= 160;
    if (valid && count === 3) valid = b !== 237 || bytes[i + 1]! < 160;
    if (valid && count === 4) valid = b !== 240 || bytes[i + 1]! >= 144;
    if (valid && count === 4) valid = b !== 244 || bytes[i + 1]! < 144;
    if (valid) {
      i += count;
      continue;
    }
    result += decoder.decode(bytes.subarray(start, i)) + String.fromCharCode(0xdc00 + b);
    start = ++i;
  }
  return result + decoder.decode(bytes.subarray(start));
}
function encodeBytes(value: string): Uint8Array {
  const parts: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i),
      previous = value.charCodeAt(i - 1);
    if (c < 0xdc80 || c > 0xdcff || (previous >= 0xd800 && previous <= 0xdbff)) continue;
    parts.push(utf8.encode(value.slice(start, i)), new Uint8Array([c - 0xdc00]));
    start = i + 1;
  }
  if (!parts.length) return utf8.encode(value);
  parts.push(utf8.encode(value.slice(start)));
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const f = Math.fround;
// C++ std::to_string(double) uses printf's six places and round-to-even.
// JS toFixed rounds exact halfway values differently and switches to exponents at 1e21.
function nativeFixed6(value: number): string {
  const negative = value < 0 || Object.is(value, -0);
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, Math.abs(value));
  const raw = bits.getBigUint64(0),
    exponent = Number((raw >> 52n) & 2047n);
  const mantissa = (raw & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const shift = exponent ? exponent - 1023 - 52 : -1074;
  let scaled = mantissa * 1000000n;
  if (shift >= 0) scaled <<= BigInt(shift);
  else {
    const divisor = 1n << BigInt(-shift),
      quotient = scaled / divisor,
      remainder = scaled % divisor;
    scaled =
      quotient +
      (remainder * 2n > divisor || (remainder * 2n === divisor && (quotient & 1n) !== 0n) ? 1n : 0n);
  }
  return (
    (negative ? '-' : '') +
    (scaled / 1000000n).toString() +
    '.' +
    (scaled % 1000000n).toString().padStart(6, '0')
  );
}
type Scalar = boolean | number | Uint8Array;
type Values = { key: Uint8Array; value: Scalar }[];
const keyOf = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

class Impl {
  readonly vm: LuaModule = scriptRuntime();
  readonly state: number;
  readonly functions: number[] = [];
  alive = true;
  used = 0;
  running = false;
  stateRef = noRef;
  drawRef = noRef;
  updateRef = noRef;
  budget = 0;
  elapsed = 0;
  title = 'Lua project';
  error = '';
  properties: ScriptProperty[] = [];
  initial = new Set<string>();
  context: Context | undefined;
  viewport = new Rect();
  activated = new Set<string>();
  overrides = new Set<string>();
  onCommand: ((command: string) => void) | undefined;
  drawings = 0;
  readonly allocator: number;
  readonly hook: number;
  readonly dispatch: number[];

  constructor() {
    this.allocator = this.callback((_opaque, pointer, before, after) => {
      before = pointer ? before : 0;
      if (!after) {
        this.vm._free(pointer);
        this.used -= before;
        return 0;
      }
      const limit = 32 * 1024 * 1024;
      if (this.running && (after > limit || this.used - before > limit - after)) return 0;
      const next = this.vm._realloc(pointer, after);
      if (next) this.used = this.used - before + after;
      return next;
    }, 'iiiii');
    this.state = this.vm._lua_newstate(this.allocator, 0);
    if (!this.state) {
      this.releaseFunctions();
      throw Error('cannot create Lua state');
    }
    this.hook = this.callback(() => {
      if (--this.budget > 0) return;
      this.vm._luaL_where(this.state, 1);
      this.pushString('Lua instruction budget exceeded');
      this.vm._lua_concat(this.state, 2);
      this.vm._lua_error(this.state);
    }, 'vii');
    for (const [name, symbol] of [
      ['_G', 'base'],
      ['table', 'table'],
      ['string', 'string'],
      ['math', 'math'],
      ['utf8', 'utf8'],
    ]) {
      const open = this.callback((L) => this.vm[`_luaopen_${symbol}`](L), 'ii');
      this.cstring(name!, (p) => this.vm._luaL_requiref(this.state, p, open, 1));
      this.pop();
    }
    for (const name of ['dofile', 'loadfile', 'load', 'pcall', 'xpcall']) {
      this.vm._lua_pushnil(this.state);
      this.cstring(name, (p) => this.vm._lua_setglobal(this.state, p));
    }
    this.dispatch = [0, 1, 2, 3].map((operation) =>
      this.callback(() => {
        let result = -1;
        try {
          result = this.draw(operation);
        } catch (error) {
          if (!(error instanceof Error)) throw error; // Preserve Lua's longjmp through a JS callback.
          this.error = error.message;
        }
        if (result >= 0) return result;
        this.pushString(this.error);
        return this.vm._lua_error(this.state);
      }, 'ii'),
    );
  }
  callback(fn: (...args: number[]) => number | void, signature: string): number {
    const pointer = this.vm.addFunction(fn, signature);
    this.functions.push(pointer);
    return pointer;
  }
  releaseFunctions(): void {
    for (const pointer of this.functions.splice(0)) this.vm.removeFunction(pointer);
  }
  close(): void {
    if (!this.alive) return;
    this.alive = false;
    this.vm._lua_close(this.state);
    this.releaseFunctions();
  }
  bytes<T>(value: Uint8Array, action: (pointer: number) => T): T {
    const pointer = this.vm._malloc(value.length + 1);
    if (!pointer) throw Error('not enough memory');
    this.vm.HEAPU8.set(value, pointer);
    this.vm.HEAPU8[pointer + value.length] = 0;
    try {
      return action(pointer);
    } finally {
      this.vm._free(pointer);
    }
  }
  cstring<T>(value: string, action: (pointer: number) => T): T {
    return this.bytes(encodeBytes(value), action);
  }
  pushBytes(value: Uint8Array): void {
    this.bytes(value, (p) => this.vm._lua_pushlstring(this.state, p, value.length));
  }
  pushString(value: string): void {
    this.pushBytes(encodeBytes(value));
  }
  pop(count = 1): void {
    this.vm._lua_settop(this.state, -count - 1);
  }
  type(index: number): number {
    return this.vm._lua_type(this.state, index);
  }
  rawString(index: number, strict = true): Uint8Array {
    if (strict && this.type(index) !== string) throw Error('expected a string');
    const length = this.vm._malloc(4);
    try {
      const pointer = this.vm._lua_tolstring(this.state, index, length);
      const size = this.vm.HEAPU32[length >>> 2]!;
      if (strict && size > 16384) throw Error('string exceeds 16 KiB');
      return pointer ? this.vm.HEAPU8.slice(pointer, pointer + size) : new Uint8Array();
    } finally {
      this.vm._free(length);
    }
  }
  readString(index: number): string {
    return decodeBytes(this.rawString(index));
  }
  field(index: number, name: string): void {
    index = this.vm._lua_absindex(this.state, index);
    this.pushString(name);
    this.vm._lua_rawget(this.state, index);
  }
  stringField(index: number, name: string, fallback = ''): string {
    this.field(index, name);
    const value = this.type(-1) === nil ? fallback : this.readString(-1);
    this.pop();
    return value;
  }
  numberField(index: number, name: string, fallback = 0): number {
    this.field(index, name);
    let value = fallback;
    if (this.type(-1) !== nil) {
      if (this.type(-1) !== number || !Number.isFinite(this.vm._lua_tonumberx(this.state, -1, 0)))
        throw Error(`${name} must be a finite number`);
      value = this.vm._lua_tonumberx(this.state, -1, 0);
    }
    this.pop();
    return value;
  }
  booleanField(index: number, name: string, fallback = false): boolean {
    this.field(index, name);
    let value = fallback;
    if (this.type(-1) !== nil) {
      if (this.type(-1) !== boolean) throw Error(`${name} must be a boolean`);
      value = !!this.vm._lua_toboolean(this.state, -1);
    }
    this.pop();
    return value;
  }
  values(index: number): Values {
    const result: Values = [];
    index = this.vm._lua_absindex(this.state, index);
    this.vm._lua_pushnil(this.state);
    while (this.vm._lua_next(this.state, index)) {
      if (result.length >= 256) throw Error('state exceeds 256 values');
      const key = this.rawString(-2);
      let value: Scalar;
      if (this.type(-1) === boolean) value = !!this.vm._lua_toboolean(this.state, -1);
      else if (this.type(-1) === number && Number.isFinite(this.vm._lua_tonumberx(this.state, -1, 0)))
        value = this.vm._lua_tonumberx(this.state, -1, 0);
      else if (this.type(-1) === string) value = this.rawString(-1);
      else throw Error('state values must be booleans, finite numbers, or strings');
      result.push({ key, value });
      this.pop();
    }
    // std::map visits byte strings in lexicographic order during restoration.
    result.sort((a, b) => keyOf(a.key).localeCompare(keyOf(b.key)));
    return result;
  }
  push(value: Scalar): void {
    if (typeof value === 'boolean') this.vm._lua_pushboolean(this.state, Number(value));
    else if (typeof value === 'number') this.vm._lua_pushnumber(this.state, value);
    else this.pushBytes(value);
  }
  saved(): Values {
    this.vm._lua_rawgeti(this.state, registry, BigInt(this.stateRef));
    const values = this.values(-1);
    this.pop();
    return values;
  }
  call(args: number, results: number): boolean {
    this.budget = 200;
    this.vm._lua_sethook(this.state, this.hook, 8, 1000);
    this.running = true;
    let result: number;
    try {
      result = this.vm._lua_pcallk(this.state, args, results, 0, 0, 0);
    } finally {
      this.running = false;
      this.vm._lua_sethook(this.state, 0, 0, 0);
    }
    if (result === 0) {
      this.error = '';
      return true;
    }
    this.error =
      this.type(-1) === string || this.type(-1) === number
        ? decodeBytes(this.rawString(-1, false))
        : 'Lua raised a non-string error';
    this.pop();
    return false;
  }
  reference(key: string, required: boolean): number {
    this.field(1, key);
    if (this.type(-1) === nil && !required) {
      this.pop();
      return noRef;
    }
    if (this.type(-1) !== func) throw Error(`${key} must be a function`);
    return this.vm._luaL_ref(this.state, registry);
  }
  load(source: string, name: string): boolean {
    const bytes = utf8.encode(source);
    this.running = true;
    let result: number;
    try {
      result = this.bytes(bytes, (p) =>
        this.cstring(name, (n) =>
          this.cstring('t', (mode) => this.vm._luaL_loadbufferx(this.state, p, bytes.length, n, mode)),
        ),
      );
    } finally {
      this.running = false;
    }
    if (result !== 0) {
      this.error = decodeBytes(this.rawString(-1, false));
      this.pop();
      return false;
    }
    if (!this.call(0, 1)) return false;
    if (this.type(1) !== table) throw Error('project must return a table');
    this.title = this.stringField(1, 'title', this.title);
    this.drawRef = this.reference('draw', true);
    this.updateRef = this.reference('update', false);
    this.field(1, 'state');
    if (this.type(-1) === nil) {
      this.pop();
      this.vm._lua_createtable(this.state, 0, 0);
    }
    if (this.type(-1) !== table) throw Error('state must be a table');
    this.initial = new Set(this.values(-1).map((item) => keyOf(item.key)));
    this.stateRef = this.vm._luaL_ref(this.state, registry);
    this.field(1, 'properties');
    if (this.type(-1) !== nil) {
      if (this.type(-1) !== table || this.vm._lua_rawlen(this.state, -1) > 64)
        throw Error('properties must be an array of at most 64 entries');
      const count = this.vm._lua_rawlen(this.state, -1),
        ids = new Set<string>();
      for (let i = 1; i <= count; ++i) {
        this.vm._lua_rawgeti(this.state, -1, BigInt(i));
        if (this.type(-1) !== table) throw Error('property must be a table');
        const index = this.vm._lua_gettop(this.state),
          id = this.stringField(index, 'id');
        const item: ScriptProperty = {
          id,
          label: this.stringField(index, 'label', id),
          minimum: this.numberField(index, 'minimum', 0),
          maximum: this.numberField(index, 'maximum', 100),
          step: this.numberField(index, 'step', 1),
          value: this.numberField(index, 'value'),
          readOnly: false,
        };
        if (
          !id ||
          encodeBytes(id).length > 128 ||
          id.includes('\0') ||
          ids.has(id) ||
          item.minimum > item.maximum ||
          item.step <= 0
        )
          throw Error('invalid or duplicate property');
        ids.add(id);
        item.value = clamp(item.value, item.minimum, item.maximum);
        this.properties.push(item);
        this.pop();
      }
    }
    this.vm._lua_settop(this.state, 0);
    return true;
  }
  setField(index: number, name: string): void {
    this.cstring(name, (p) => this.vm._lua_setfield(this.state, index, p));
  }
  pushProperties(): void {
    this.vm._lua_createtable(this.state, 0, this.properties.length);
    for (const item of this.properties) {
      this.vm._lua_pushnumber(this.state, item.value);
      this.setField(-2, item.id);
    }
  }
  restore(saved: Values): void {
    this.vm._lua_rawgeti(this.state, registry, BigInt(this.stateRef));
    for (const { key, value } of saved) {
      if (!this.initial.has(keyOf(key))) continue;
      this.push(value);
      this.bytes(key, (p) => this.vm._lua_setfield(this.state, -2, p));
    }
    this.pop();
  }
  bounds(): Rect {
    const r = new Rect(
      this.numberField(1, 'x'),
      this.numberField(1, 'y'),
      this.numberField(1, 'width', 160),
      this.numberField(1, 'height', 32),
    );
    for (const value of [r.x, r.y, r.w, r.h])
      if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw Error('drawing bounds exceed range');
    r.x = f(r.x + this.viewport.x);
    r.y = f(r.y + this.viewport.y);
    r.w = Math.max(0, r.w);
    r.h = Math.max(0, r.h);
    return r;
  }
  color(name: string, fallback: Color): Color {
    const value = this.stringField(1, name),
      theme = this.context!.theme();
    if (!value) return fallback;
    for (const token of [
      'background',
      'surface',
      'raised',
      'border',
      'text',
      'muted',
      'accent',
      'accentText',
      'success',
      'danger',
    ] as const)
      if (value === token) return theme[token];
    if (value[0] !== '#' || (value.length !== 7 && value.length !== 9))
      throw Error('color must be a theme token or #RRGGBB / #RRGGBBAA');
    if (!/^[0-9a-fA-F]+$/.test(value.slice(1))) throw Error('invalid hex color');
    return {
      r: parseInt(value.slice(1, 3), 16),
      g: parseInt(value.slice(3, 5), 16),
      b: parseInt(value.slice(5, 7), 16),
      a: value.length === 7 ? 255 : parseInt(value.slice(7, 9), 16),
    };
  }
  draw(operation: number): number {
    if (!this.context || this.type(1) !== table)
      throw Error('UI drawing expects a specification table during draw()');
    if (++this.drawings > 2048) throw Error('frame exceeds 2048 UI elements');
    const rect = this.bounds(),
      theme = this.context.theme();
    if (operation === 0) {
      this.context.rect(
        rect,
        this.color('color', theme.raised),
        clamp(f(this.numberField(1, 'radius', theme.radius)), 0, 1000),
      );
      return 0;
    }
    if (operation === 1) {
      this.context.text(
        rect,
        this.stringField(1, 'text'),
        this.color('color', theme.text),
        clamp(f(this.numberField(1, 'size', theme.fontSize)), 1, 256),
        this.booleanField(1, 'bold'),
      );
      return 0;
    }
    const id = this.stringField(1, 'id');
    if (!id || encodeBytes(id).length > 128) throw Error('interactive UI element requires an id');
    if (operation === 2) {
      const text = this.stringField(1, 'text', id),
        enabled = this.booleanField(1, 'enabled', true),
        command = this.stringField(1, 'command');
      button(
        this.context,
        'script/' + id,
        rect,
        text,
        () => {
          if (this.alive) {
            this.activated.add(id);
            if (command) this.onCommand?.(command);
          }
        },
        ButtonStyle.Default,
        enabled,
      );
      this.vm._lua_pushboolean(this.state, Number(this.activated.delete(id)));
      return 1;
    }
    const found = this.properties.find((item) => item.id === id);
    if (!found) throw Error('ui.number id must name a project property');
    const item = { ...found },
      width = Math.min(28, f(rect.w / 3));
    const change = (delta: number) => {
      if (this.alive)
        for (const value of this.properties)
          if (value.id === id) {
            value.value = clamp(value.value + delta, value.minimum, value.maximum);
            this.overrides.add(id);
          }
    };
    button(this.context, 'script/' + id + '/minus', new Rect(rect.x, rect.y, width, rect.h), '-', () =>
      change(-item.step),
    );
    button(
      this.context,
      'script/' + id + '/plus',
      new Rect(f(f(rect.x + rect.w) - width), rect.y, width, rect.h),
      '+',
      () => change(item.step),
    );
    this.context.text(
      new Rect(f(f(rect.x + width) + 6), rect.y, Math.max(0, f(f(rect.w - f(2 * width)) - 12)), rect.h),
      item.label + ': ' + nativeFixed6(item.value),
      theme.text,
    );
    this.vm._lua_pushnumber(this.state, item.value);
    return 1;
  }
  pushUi(): void {
    this.vm._lua_createtable(this.state, 0, 0);
    ['rect', 'label', 'button', 'number'].forEach((name, i) => {
      this.vm._lua_pushcclosure(this.state, this.dispatch[i], 0);
      this.setField(-2, name);
    });
  }
}

export class Script {
  private impl: Impl | undefined;
  private source = '';
  private name = '';
  private message = '';
  onCommand: ((command: string) => void) | undefined;
  load(text: string, filename: string, preserve = true): boolean {
    let next: Impl | undefined;
    try {
      if (utf8.encode(text).length > 1024 * 1024) throw Error('project exceeds 1 MiB');
      next = new Impl();
      if (!next.load(text, filename)) {
        this.message = next.error;
        next.close();
        return false;
      }
      if (this.impl && preserve) {
        next.restore(this.impl.saved());
        next.elapsed = this.impl.elapsed;
        for (const item of next.properties)
          for (const old of this.impl.properties)
            if (old.id === item.id && this.impl.overrides.has(item.id)) {
              item.value = clamp(old.value, item.minimum, item.maximum);
              next.overrides.add(item.id);
            }
      }
      this.impl?.close();
      this.impl = next;
      this.source = text;
      this.name = filename;
      this.message = '';
      return true;
    } catch (error) {
      next?.close();
      if (this.impl) this.impl.vm._lua_settop(this.impl.state, 0);
      this.message = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  reset(): boolean {
    const edited = this.impl?.properties
      .filter((item) => this.impl!.overrides.has(item.id))
      .map((item) => ({ ...item }));
    if (!this.load(this.source, this.name, false)) return false;
    for (const item of edited ?? []) this.property(item.id, item.value);
    return true;
  }
  fork(): Script | null {
    const copy = new Script();
    try {
      if (!this.impl || !copy.load(this.source, this.name, false)) {
        copy.dispose();
        return null;
      }
      copy.impl!.restore(this.impl.saved());
      copy.impl!.elapsed = this.impl.elapsed;
      for (const item of this.impl.properties) copy.property(item.id, item.value);
      return copy;
    } catch {
      copy.dispose();
      if (this.impl) this.impl.vm._lua_settop(this.impl.state, 0);
      return null;
    }
  }
  update(seconds: number): boolean {
    const p = this.impl;
    if (!p || !Number.isFinite(seconds) || seconds < 0) return false;
    p.elapsed += seconds;
    if (p.updateRef === noRef) return true;
    p.vm._lua_rawgeti(p.state, registry, BigInt(p.updateRef));
    p.vm._lua_rawgeti(p.state, registry, BigInt(p.stateRef));
    p.vm._lua_pushnumber(p.state, seconds);
    p.pushProperties();
    if (p.call(3, 0)) return true;
    this.message = p.error;
    return false;
  }
  render(context: Context, viewport: Rect): boolean {
    const p = this.impl;
    if (!p) return false;
    p.context = context;
    p.viewport = viewport;
    p.drawings = 0;
    p.onCommand = this.onCommand;
    p.vm._lua_rawgeti(p.state, registry, BigInt(p.drawRef));
    p.pushUi();
    p.vm._lua_rawgeti(p.state, registry, BigInt(p.stateRef));
    p.vm._lua_createtable(p.state, 0, 3);
    for (const [key, value] of [
      ['width', viewport.w],
      ['height', viewport.h],
      ['time', p.elapsed],
    ] as const) {
      p.vm._lua_pushnumber(p.state, value);
      p.setField(-2, key);
    }
    p.pushProperties();
    let ok = false;
    try {
      context.clip(viewport, () => {
        ok = p.call(4, 0);
      });
    } finally {
      p.context = undefined;
      p.activated.clear();
    }
    if (!ok) this.message = p.error;
    return ok;
  }
  title(): string {
    return this.impl?.title ?? 'Lua project';
  }
  properties(): ScriptProperty[] {
    return this.impl?.properties.map((item) => ({ ...item })) ?? [];
  }
  property(id: string, value: number): boolean {
    if (!this.impl || !Number.isFinite(value)) return false;
    for (const item of this.impl.properties)
      if (item.id === id) {
        item.value = clamp(value, item.minimum, item.maximum);
        this.impl.overrides.add(item.id);
        return true;
      }
    return false;
  }
  error(): string {
    return this.message;
  }
  ready(): boolean {
    return !!this.impl;
  }
  dispose(): void {
    this.impl?.close();
    this.impl = undefined;
  }
}
