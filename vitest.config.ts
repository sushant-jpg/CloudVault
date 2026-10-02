import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: { reporter: ['text', 'html'], include: ['apps/api/src/**/*.ts', 'packages/**/*.ts'] }
  },
  resolve: {
    alias: {
      '@cloudvault/types': new URL('./packages/types/src/index.ts', import.meta.url).pathname,
      '@cloudvault/validation': new URL('./packages/validation/src/index.ts', import.meta.url).pathname,
      '@cloudvault/config': new URL('./packages/config/src/index.ts', import.meta.url).pathname,
      '@cloudvault/security': new URL('./packages/security/src/index.ts', import.meta.url).pathname,
      '@cloudvault/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname
    }
  }
});
