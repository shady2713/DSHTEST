import { defineConfig } from 'tsdown'

/** Explicit application entries; the browser automation provider lives in an experimental package. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/scope-provider.js', 'lib/types/assembly.js', 'lib/types/recovery-entry.js', 'lib/types/prototype-entry.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
