import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  // Keep local development at /; Pages supplies its repository or custom-domain base.
  base: process.env.VITE_BASE_PATH || '/',
  resolve: {
    alias: Object.fromEntries(
      ['content', 'engine', 'native-renderer', 'native-ui', 'native-editors', 'native-audio'].map((name) => [
        `@goldfantasy/${name}`,
        fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@thorvg/webcanvas'] },
  server: { fs: { strict: true } },
});
