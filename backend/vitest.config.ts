import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Thresholds below current coverage — prevents regressions without blocking PRs.
      // Target: 80% lines / 75% branches by end of quarter (healthcare standard).
      thresholds: {
        lines: 63,
        branches: 53,
        functions: 59,
      },
    },
  },
});
