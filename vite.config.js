import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['_IntuMedix_logo.png', '_IntuMedix_watermark.png', 'templates/**'],
      manifest: {
        name: 'IntuMedix',
        short_name: 'IntuMedix',
        description: 'تطبيق البطاقات الطبية الذكي - متوافق مع Anki',
        theme_color: '#6366f1',
        background_color: '#0a0e1a',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        icons: [
          {
            src: '_IntuMedix_logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '_IntuMedix_logo.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ],
        categories: ['education', 'medical', 'productivity'],
        screenshots: [],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15MB
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'], // Exclude PNG from precache (too large)
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 } }
          },
          {
            urlPattern: /\.png$/i,
            handler: 'CacheFirst',
            options: { cacheName: 'images-cache', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      }
    })
  ],
  // Copy sql.js WASM file
  optimizeDeps: {
    exclude: ['sql.js']
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  },
  server: {
    port: 5173,
    host: true
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 5000,
  }
})
