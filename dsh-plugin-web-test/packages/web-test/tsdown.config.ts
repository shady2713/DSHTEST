/**
 * Build configuration for the `dsh-plugin-web-test` bundle.
 *
 * The DSH monorepo's `clientBundle` preset reads that repository's layout, so an
 * out-of-tree plugin cannot use it. This config restates the part of the client
 * contract an external plugin actually depends on: a CommonJS artifact that
 * registers itself with `window.__ModuleLoader__` and resolves its externals
 * through the injected `require` instead of a module map.
 *
 * The Node half keeps every `@deepseek-ai/*` specifier external, matching what
 * the shipped packages publish, and bundles everything else.
 */

import { isBuiltin } from 'node:module'
import type { UserConfig } from 'tsdown'

const ID = 'dsh-plugin-web-test'

/**
 * Module specifiers the browser shell shares into the frozen module table.
 *
 * The Host's `dsh.client.external` request is exact, so the baseline is not a
 * fallback: a value import of one of these names has to be answered by the
 * shell's identity, or the plugin would carry a second React or Cordis.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/** Non-baseline module-table rows this half requests through `dsh.client.external`. */
const CLIENT_EXTERNALS = ['@deepseek-ai/dsh-api-gateway/client'] as const

/** Whether a specifier names a shared module-table row or a Host-resolved package. */
function isExternal(specifier: string): boolean {
  return specifier.startsWith('@deepseek-ai/') || isBuiltin(specifier) || PLATFORM_MODULES.includes(specifier as never)
}

/**
 * Node half: tsc emits JavaScript under `lib/types`; tsdown bundles from there.
 *
 * The clean list names only this bundle's own outputs. `clean: true` would take
 * `lib` with it, including the `lib/types` tree tsc just emitted, and
 * `clean: false` lets a content-hashed chunk from an earlier build survive into
 * the published tarball, so the package ships two copies of every shared chunk.
 */
const nodeLib: UserConfig = {
  name: ID,
  entry: {
    'index': 'lib/types/index.js',
    'agent': 'lib/types/agent.js',
    'store-service': 'lib/types/store-service.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: ['lib/shared', 'lib/index.js', 'lib/agent.js', 'lib/store-service.js'],
  deps: {
    neverBundle: isExternal,
    alwaysBundle: specifier => !isBuiltin(specifier) && !isExternal(specifier),
  },
  outputOptions: { entryFileNames: '[name].js', chunkFileNames: 'shared/[name]-[hash].js' },
}

/**
 * Browser half.
 *
 * The host's module loader calls each dynamic bundle's factory with a `require`
 * bound to the shared module table, so the artifact is CommonJS wrapped in a
 * `window.__ModuleLoader__.load` call. React, Cordis, and the shared Client
 * libraries stay external so the plugin binds the shell's identities rather
 * than carrying a second copy of them.
 */
const clientLib: UserConfig = {
  name: ID,
  entry: { 'client': 'lib/types/client/index.js' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: ['lib/client.js'],
  external: [...PLATFORM_MODULES, ...CLIENT_EXTERNALS],
  // zod backs the generated Remote codecs and has no module-table row, so it
  // travels inside this bundle rather than as a bare specifier.
  noExternal: ['zod'],
  outputOptions: {
    entryFileNames: '[name].js',
    banner: [
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      'var module = { exports: {} };',
      'var exports = module.exports;',
    ].join('\n'),
    footer: 'return module.exports; } });',
  },
}

export default [nodeLib, clientLib]
