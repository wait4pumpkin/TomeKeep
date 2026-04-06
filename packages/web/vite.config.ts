import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    https: {},
  },
  plugins: [
    react(),
    basicSsl(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'splash/*.png', 'favicon.svg'],
      manifest: {
        name: 'TomeKeep',
        short_name: 'TomeKeep',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell: cache-first for static assets, including WASM so it is
        // available offline from the very first PWA use (before any detect() call).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        runtimeCaching: [
          {
            // API data: network-first, fall back to cache
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // Cover images: cache-first (R2 signed URLs)
            urlPattern: /^\/api\/covers\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'covers-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            // ZXing WASM binary: cache-first, long TTL (content never changes for a given version)
            urlPattern: /\/zxing_reader\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm-cache',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
})
