/** C++ value-copy semantics for native state, retaining class prototypes and raw archive padding. */
export function copyNative<T>(value: T): T;
export function copyNative(value: unknown): unknown {
  const seen = new WeakMap<object, unknown>();
  const copy = (source: unknown): unknown => {
    if (source === null || typeof source !== 'object') return source;
    if (seen.has(source)) return seen.get(source);
    if (source instanceof ArrayBuffer) {
      const result = source.slice(0);
      seen.set(source, result);
      return result;
    }
    if (source instanceof DataView) {
      const result = new DataView(
        source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
      );
      seen.set(source, result);
      return result;
    }
    if (ArrayBuffer.isView(source)) {
      const result = Reflect.construct(source.constructor, [source]);
      seen.set(source, result);
      return result;
    }
    if (source instanceof Map) {
      const result = new Map();
      seen.set(source, result);
      for (const [key, item] of source) result.set(copy(key), copy(item));
      return result;
    }
    if (source instanceof Set) {
      const result = new Set();
      seen.set(source, result);
      for (const item of source) result.add(copy(item));
      return result;
    }
    const result = Array.isArray(source) ? [] : Object.create(Object.getPrototypeOf(source));
    seen.set(source, result);
    for (const key of Reflect.ownKeys(source)) {
      if (Array.isArray(source) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(source, key)!;
      if ('value' in descriptor) descriptor.value = copy(descriptor.value);
      Object.defineProperty(result, key, descriptor);
    }
    return result;
  };
  return copy(value);
}
