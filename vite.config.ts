import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Only VITE_* variables are exposed to the browser bundle. The Gemini key is
// read exclusively by the server (server/src/config.ts) and must never be
// given a VITE_ prefix.
export default defineConfig({
  root: r('./client'),
  envDir: r('.'),
  publicDir: r('./client/public'),
  resolve: {
    alias: {
      '@': r('./client/src'),
      '@shared': r('./shared'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'PRECEPTOR — Digital Clinical Pharmacy Preceptor',
        short_name: 'PRECEPTOR',
        description:
          'Clinical pharmacy rotation copilot: collect, understand, assess, act, monitor, follow up and reflect on patient cases.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f5f7fa',
        theme_color: '#0f2a4a',
        categories: ['education', 'medical', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // AI requests carry case data and must never be cached by the service worker.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: `http://localhost:${process.env.PORT || 8787}`, changeOrigin: true },
    },
  },
  preview: { port: 4173 },
  build: {
    outDir: r('./dist/client'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
