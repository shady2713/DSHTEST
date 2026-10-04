import { defineConfig } from 'vitest/config'

/**
 * Test configuration for the plugin package.
 *
 * The suite runs against `src` rather than the built `lib`, so a failure points
 * at the source line that caused it. `DSH_HOME` is set per test by the harness,
 * never here, because a value in this file would leak into a developer's real
 * harness home for any other suite that imports the config.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // The store's own write chain serialises records; tests only await the
    // promise the method returns, so no test should need real timers.
    testTimeout: 20_000,
  },
})
