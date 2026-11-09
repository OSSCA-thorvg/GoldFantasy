// AudioWorklet modules need a self-contained graph in both development and production.
// Build the TypeScript mixer with the existing Vite toolchain; no native runtime is involved.
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
// Earlier worklet builds copied these generated public files into their own output directory.
await Promise.all([
  rm(new URL('../public/vendor/assets/', import.meta.url), { recursive: true, force: true }),
  rm(new URL('../public/vendor/THIRD_PARTY_NOTICES.md', import.meta.url), { force: true }),
]);
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    target: 'es2022',
    emptyOutDir: false,
    copyPublicDir: false,
    minify: false,
    outDir: fileURLToPath(new URL('../public/vendor/', import.meta.url)),
    lib: {
      entry: fileURLToPath(new URL('../packages/native-audio/src/audio-worklet.ts', import.meta.url)),
      name: 'GoldFantasyAudio',
      formats: ['iife'],
      fileName: () => 'goldfantasy-audio.js',
    },
  },
});
