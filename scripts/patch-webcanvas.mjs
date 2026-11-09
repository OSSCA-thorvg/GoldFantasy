/**
 * @thorvg/webcanvas 1.1.3 ownership compatibility patch.
 *
 * Native Scene::add/Canvas::add/Paint::clip/Paint::mask already acquire their
 * own reference. Upstream additionally acquires a wrapper reference on EVERY
 * attachment. Reordering retained paints leaks references until the native
 * uint16 counter wraps. Acquire the wrapper reference once in Paint's
 * constructor instead; borrowed Animation/Accessor wrappers have no registry
 * and must not acquire it. No rendering or WASM code is changed.
 * Finalizers also retain the originating module identity so delayed GC after
 * term/init cannot free an unrelated paint in the replacement WASM heap.
 *
 * The pinned package's four published JS entry points are guarded byte-for-byte.
 * Modified bundles omit their old sourceMappingURL: upstream maps describe the
 * original minified columns and must not be consumed as maps for this patch.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const distributions = {
  'webcanvas.esm.js': [
    '5b8534c16767956f572aaa23a953ebe6ce028fb3c115807e8cf479bf01d8e64c',
    '5136edfc283227952743398e0a2925095dfde67e4aea650082eed6f7f3a522ae',
    '4de2bfaf9accc54c618daed6b71c4736200ca0dba5a1512f542633b05552d5cf',
  ],
  'webcanvas.cjs.js': [
    '904f3ef8625beeddbcfd63d50b727d43f6d989f7b121ad3915b38586e8554615',
    '8094b5d02b7e6aa6a92cdf9eb18cba46fc146f70efe76dc1e5a2a07569a04eec',
    '671c099583b4a7489317356dd64887227bc2cb242ec204c50a3d864a175e656e',
  ],
  'webcanvas.js': [
    'b925ecd33768bbd0ff26ef8bffa12cfe990518e402be0df7700a54aea4564d6b',
    '3e5a94a2e261ebaa6a6af2cd41b65c4e0a0037301681e4b9eda9a011b5fd2517',
    '4ce00a5cec121eefcfdad0ec27b604b0fd784db9586bd7dfbc47b94ff32f8272',
  ],
  'thread/webcanvas.esm.js': [
    '7256dbc059ffb06787ea35e1baa0ed813c8abe55d18f62e26c0dd014007212cc',
    '9bb06fd3a61d9aa6660f5c7d58df524af46289cc457a28ba46149c84dc21d688',
    '518d7b930b4a8a41b9ef96a6a98074c680053004b0e23257c533e5233fe55a7a',
  ],
};
const hash = (source) => createHash('sha256').update(source).digest('hex');
function balancedOwnership(source) {
  const paint =
    /class (\w+) extends (\w+)\{static registerType\((\w+),(\w+)\)\{(\w+)\.set\(\3,\4\)\}_cleanup\((\w+)\)\{(\w+)\(\)\._tvg_paint_unref\(\6,1\)\}/;
  const match = source.match(paint);
  if (!match) throw new Error('WebCanvas Paint constructor patch no longer matches upstream.');
  const calls = /,\w+\._tvg_paint_ref\((?:\w+|this\.#[\w$]+)\.ptr\)/g;
  if ([...source.matchAll(calls)].length !== 4)
    throw new Error('WebCanvas attachment reference sites no longer match upstream.');
  return (
    source
      .replace(calls, '')
      .replace(
        paint,
        (_text, name, parent, a, b, factories, pointer, module) =>
          `class ${name} extends ${parent}{constructor(ptr,registry){super(ptr,registry);if(registry)${module}()._tvg_paint_ref(ptr)}static registerType(${a},${b}){${factories}.set(${a},${b})}_cleanup(${pointer}){${module}()._tvg_paint_unref(${pointer},1)}`,
      )
      .replace(/\n?\/\/# sourceMappingURL=[^\r\n]*/g, '') +
    '\n/* Midgard: balanced WebCanvas 1.1.3 paint ownership. */\n'
  );
}
function scopedFinalizers(source) {
  const record = /\{ptr:(\w+),cleanup:this\._cleanup\}/g;
  const cleanup = /(\w+)\.ptr&&(\w+)\(\)&&\1\.cleanup\(\1\.ptr\)/g;
  if ([...source.matchAll(record)].length !== 1 || [...source.matchAll(cleanup)].length !== 1)
    throw new Error('WebCanvas finalizer ownership sites no longer match upstream.');
  return (
    source
      .replace(record, '{ptr:$1,module:globalThis.__ThorVGModule,cleanup:this._cleanup}')
      .replace(cleanup, '$1.ptr&&$2()&&$1.module===globalThis.__ThorVGModule&&$1.cleanup($1.ptr)') +
    '/* Midgard: finalizers belong to their originating WASM module. */\n'
  );
}
export async function patchWebCanvas(
  packageRoot = new URL('../node_modules/@thorvg/webcanvas/', import.meta.url),
) {
  const metadata = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  if (metadata.version !== '1.1.3')
    throw new Error('Review the WebCanvas ownership patch before changing SDK version.');
  const updates = [];
  // Validate every file before writing any of them.
  for (const [name, [originalHash, ownershipHash, patchedHash]] of Object.entries(distributions)) {
    const file = new URL('dist/' + name, packageRoot),
      source = await readFile(file, 'utf8'),
      digest = hash(source);
    if (patchedHash && digest === patchedHash) continue;
    if (digest !== originalHash && digest !== ownershipHash)
      throw new Error('Unexpected WebCanvas contents: ' + name);
    const patched = scopedFinalizers(digest === originalHash ? balancedOwnership(source) : source);
    if (patchedHash && hash(patched) !== patchedHash)
      throw new Error('Unexpected WebCanvas patch output: ' + name);
    updates.push({ file, patched, name });
  }
  for (const update of updates) await writeFile(update.file, update.patched);
  return updates.map((update) => update.name);
}
await patchWebCanvas();
