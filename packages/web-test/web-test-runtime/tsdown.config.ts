import { defineConfig } from 'tsdown'

/** Bundle the Runtime service and its public type-only entry. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/types.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
