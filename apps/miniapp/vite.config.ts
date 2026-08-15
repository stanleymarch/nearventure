import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Mini App build — served at /tg/ in prod (nginx static). Dev on :5174.
export default defineConfig({
  base: '/tg/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Shared code lives in the web frontend — reuse, don't duplicate.
      '@shared': fileURLToPath(new URL('../frontend/src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // POI media proxy (images) lives under /api, covered above.
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
