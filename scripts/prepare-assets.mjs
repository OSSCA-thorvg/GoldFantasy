import { mkdir, copyFile } from 'node:fs/promises';
import { verifyAudioAssets } from './verify-audio-assets.mjs';
verifyAudioAssets();
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/vendor/', root), { recursive: true });
await copyFile(
  new URL('node_modules/@thorvg/webcanvas/dist/thorvg.wasm', root),
  new URL('public/vendor/thorvg.wasm', root),
);
await copyFile(
  new URL('node_modules/@thorvg/webcanvas/LICENSE', root),
  new URL('public/vendor/LICENSE', root),
);

await import('./prepare-audio-worklet.mjs');
