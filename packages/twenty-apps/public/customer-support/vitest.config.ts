import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      src: new URL('./src/', import.meta.url).pathname,
    },
  },
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Unit tests over the manifest run everywhere with no server.
    // *.integration-test.ts require a live instance and are opt-in.
    include: ['src/**/*.test.ts'],
    env: {
      TWENTY_API_URL: process.env.TWENTY_API_URL ?? 'http://localhost:2020',
      // No default. Integration tests must be handed a key by the
      // environment; a committed bearer token is a credential in a public
      // package, dev-seeded or not.
      ...(process.env.TWENTY_API_KEY
        ? { TWENTY_API_KEY: process.env.TWENTY_API_KEY }
        : {}),
    },
  },
});
