import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Single-file at a time — tests share a Postgres DB so parallel files
    // would race truncates against each other.
    fileParallelism: false,
    pool: 'forks',
    setupFiles: ['./test/env.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    include: ['test/**/*.test.ts'],
  },
});
