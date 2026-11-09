import createLua, { type LuaModule } from '../vendor/lua-5.4.8.mjs';

let runtime: LuaModule | undefined;
let preparation: Promise<void> | undefined;
/** Load the original Lua 5.4.8 interpreter. GoldFantasy's Script bridge remains TypeScript. */
export function prepareScriptRuntime(options: { wasmBinary?: Uint8Array } = {}): Promise<void> {
  return (preparation ??= createLua({
    ...options,
    locateFile: () => new URL('../vendor/lua-5.4.8.wasm', import.meta.url).href,
  }).then((module) => {
    runtime = module;
  }));
}
export function scriptRuntime(): LuaModule {
  if (!runtime) throw Error('Lua runtime is not prepared');
  return runtime;
}
export type { LuaModule };
