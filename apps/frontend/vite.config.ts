import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { pmtilesStaticPlugin } from './vite.pmtiles-dev';

/// <reference types="vitest" />
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // This is a development-only mount. Production keeps /tiles/ on nginx.
  const pmtilesDirectory = env.VITE_PMTILES_DEV_DIR
    ? resolve(process.cwd(), env.VITE_PMTILES_DEV_DIR)
    : fileURLToPath(new URL('../../docker/data/tiles', import.meta.url));

  return {
    plugins: [vue(), pmtilesStaticPlugin(pmtilesDirectory)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/__tests__/**/*.test.ts'],
      root: fileURLToPath(new URL('.', import.meta.url)),
    },
  };
});
