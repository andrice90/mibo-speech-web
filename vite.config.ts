import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'rec-worklet.js'],
      manifest: {
        name: 'Mibo: speech practice buddy',
        short_name: 'Mibo',
        description: 'Playful speech practice for families. Mibo listens and writes his notes on your device; new lessons and his voice come from the cloud.',
        theme_color: '#d4efff',
        background_color: '#fff8ee',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // the app shell is precached; Mibo's bundled voice (24 MB of WAV) is cached as each lesson first plays
        globPatterns: ['**/*.{js,css,html,png,woff2,json}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/voice/') && url.pathname.endsWith('.wav'),
          handler: 'CacheFirst',
          options: { cacheName: 'mibo-voice-v1', expiration: { maxEntries: 200 } },
        }],
      },
    }),
  ],
  build: { target: 'es2022', chunkSizeWarningLimit: 5000 },
});
