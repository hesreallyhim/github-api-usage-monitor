import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30000, // Longer timeout for process tests
    hookTimeout: 10000,
    retry: 1, // Retry once on flaky failures
  },
});
