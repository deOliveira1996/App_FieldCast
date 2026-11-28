/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const basePath = process.env.VITE_BASE_PATH || './';
  const isMinimal = mode === 'minimal' || process.env.VITE_APP_EDITION === 'minimal';

  return {
    base: basePath,
    define: {
      'import.meta.env.VITE_APP_EDITION': JSON.stringify(isMinimal ? 'minimal' : 'full'),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'icon.svg',
          'icons/192x192.png',
          'icons/512x512.png',
          'icons/maskable-512x512.png',
          'icons/icon-192x192.png',
          'icons/icon-512x512.png',
          'icons/maskable-icon-512x512.png',
        ],
        manifest: {
          name: isMinimal
            ? 'FieldCast Minimal — Previsão & Radar'
            : 'FieldCast — Previsão Local & Campo',
          short_name: isMinimal ? 'FieldCast Minimal' : 'FieldCast',
          description: isMinimal
            ? 'Edição leve de previsão meteorológica multi-modelo, radar interativo e alertas em campo 100% open-source e offline-first.'
            : 'Previsão meteorológica multi-modelo, oceanográfica e apoio à decisão em campo 100% open-source e offline-first.',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'any',
          start_url: basePath,
          scope: basePath,
          icons: [
            {
              src: 'icons/192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
      }),
    ],
    build: {
      outDir: isMinimal ? 'dist-minimal' : 'dist',
      rollupOptions: {
        output: {
          manualChunks: {
            echarts: ['echarts', 'echarts-for-react'],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/test/**/*.test.ts', 'src/test/**/*.test.tsx'],
    },
  };
});
