import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    passWithNoTests: true,
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
