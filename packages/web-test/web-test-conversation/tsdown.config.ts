import { defineConfig } from 'tsdown'

/** Bundle the conversation service and its command Loader entry together. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/commands.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
