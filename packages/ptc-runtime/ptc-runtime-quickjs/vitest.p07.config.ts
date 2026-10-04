/** Keyless installed-profile launcher; it never loads the repository .env. */
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts'],
    include: ['packages/web-test/web-test-policy/tests/file-retention.profile.e2e.ts'],
    testTimeout: 65_000,
    hookTimeout: 30_000,
    retry: 0,
    fileParallelism: false,
    maxWorkers: 1,
    reporters: ['verbose'],
    silent: false,
  },
})
