import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // partyserver pulls in `cloudflare:workers` (Workers-only); stub it so Node tests can import the app.
    alias: { partyserver: path.resolve(__dirname, 'tests/stubs/partyserver.ts') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30000,
  },
});
