import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
// Mini App build — served at /tg/ in prod (nginx static). Dev on :5174.
export default defineConfig({
    base: '/tg/',
    plugins: [vue()],
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            // Shared code lives in the web frontend — reuse, don't duplicate.
            '@shared': resolve(__dirname, '../frontend/src'),
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
