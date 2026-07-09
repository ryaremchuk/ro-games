/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed to GitHub Pages at https://ryaremchuk.github.io/ro-games/,
// so every asset lives under the /ro-games/ base path.
const BASE = '/ro-games/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Icons are generated from public/logo.svg (see pwa-assets.config.ts).
      pwaAssets: { config: true, overrideManifestIcons: true },
      manifest: {
        name: 'Ro Games',
        short_name: 'Ro Games',
        description: 'Fun games for kids',
        lang: 'en',
        theme_color: '#5b8def',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: BASE,
        scope: BASE,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,mp3,ogg,wav}'],
        // Phaser bundles are large; allow precaching them for offline play.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Unit tests live in src/. Keep Vitest out of e2e/ — those are Playwright
    // specs (they import @playwright/test and can't run under the Vitest runner).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
