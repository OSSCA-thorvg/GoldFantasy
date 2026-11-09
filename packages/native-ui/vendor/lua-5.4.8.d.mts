export interface LuaModule {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _realloc(pointer: number, size: number): number;
  addFunction(callback: (...args: number[]) => number | void, signature: string): number;
  removeFunction(pointer: number): void;
  [key: `_${string}`]: (...args: any[]) => any;
}
export default function createLua(options?: {
  wasmBinary?: Uint8Array;
  locateFile?: (path: string) => string;
}): Promise<LuaModule>;
