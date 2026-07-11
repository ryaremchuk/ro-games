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
// The port is configurable so a second concurrent dev session (on the default
// 5173, possibly serving a different checkout) is never accidentally reused:
// run `E2E_PORT=5199 npx playwright test …` to spin up a fresh server on 5199
// serving THIS worktree. Default behavior (5173) is unchanged.
const PORT = process.env.E2E_PORT ?? '5173'
const BASE_URL = `http://localhost:${PORT}/ro-games/`

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
    // Games are Phaser: their timers/tweens advance with the rAF loop. Chromium
    // throttles (and can freeze) the rAF loop of a renderer it thinks is
    // backgrounded/occluded — which happens to every non-focused page under
    // parallel workers — starving unattended waits (celebrations, holds). These
    // flags keep every page's clock running at real speed.
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    },
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
