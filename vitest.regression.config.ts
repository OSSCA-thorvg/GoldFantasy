import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/regression/**/*.test.ts'],
    maxWorkers: 2,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
