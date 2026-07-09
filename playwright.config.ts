import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests that drive the real games in a browser.
 *
 * Runs locally (not in CI) so Claude can verify a change end-to-end: it launches
 * the Vite dev server itself, drives the game, and reads screenshots + state.
 * Chromium only, emulating an iPad-sized touch viewport (the real target is an
 * iPad PWA). The dev server runs under the /ro-games/ base, so specs navigate
 * with relative paths ('./', './#/slingshot') against the baseURL below.
 */
const BASE_URL = 'http://localhost:5173/ro-games/'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 834, height: 1112 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: false,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
