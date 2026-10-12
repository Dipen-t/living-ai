import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@evolvekit/ai': fileURLToPath(new URL('./packages/ai/src/index.ts', import.meta.url)),
      '@evolvekit/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@evolvekit/server': fileURLToPath(
        new URL('./packages/server/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
