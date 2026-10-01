import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// /api calls are proxied to the Node server so the browser sees a single origin.
// The app installs on phones and laptops (PWA). Only the app itself, fonts and public photos are cached on the device;
// orders, prices, logins and private photos (/api) always come live from the server.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // a new version is picked up on the next visit, no "update" button needed
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'icons/favicon-48.png'],
      manifest: {
        id: '/',
        name: 'All Services',
        short_name: 'All Services',
        description: 'Fresh vegetables, milk, meat, kirana, plumbers, electricians and more — from trusted local partners in Siddipet.',
        lang: 'en-IN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#4f46e5',
        background_color: '#f5f7fb',
        categories: ['shopping', 'food', 'lifestyle'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Fresh vegetables', url: '/service/food-daily-fresh-vegetables', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'My orders', url: '/orders', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Agent app', url: '/agent', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // the app is a single page: any page opens index.html — but never for API calls or uploaded files
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        importScripts: ['/push-sw.js'], // phone notifications (new orders, order updates)
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          // live data is never cached
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
          // fonts
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 365 * 24 * 3600 } },
          },
          // public photos (products, services, promotions): fast and fine to keep for a while
          {
            urlPattern: ({ url, request }) => request.destination === 'image'
              && (url.pathname.startsWith('/uploads/') || /wikimedia\.org|staticflickr\.com|openverse/.test(url.hostname)),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } },
          },
          // map tiles (live tracking): short cache
          {
            urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 400, maxAgeSeconds: 7 * 24 * 3600 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5000', '/uploads': 'http://localhost:5000' },
  },
});
