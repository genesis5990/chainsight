import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Bundle all internal workspace packages so the runtime doesn't need
  // to resolve them via node_modules (their package.json points at .ts).
  noExternal: [/^@chainsight\//],
  splitting: false,
  shims: false,
});
