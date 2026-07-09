import { test, expect } from '@playwright/test'
// Importing the type also loads the `declare global { Window.__slingshot }`
// augmentation so the in-browser evaluate() callbacks below are typed.
import type { SlingshotTestState } from '../src/games/slingshot/testHook'

const readState = (page: import('@playwright/test').Page): Promise<SlingshotTestState> =>
  page.evaluate(() => window.__slingshot!.state())

test('slingshot: aim, launch, and free the sleeping piggies', async ({ page }) => {
  await page.goto('./#/slingshot')

  // Wait for the Phaser scene to build and the bird to become aimable.
  await page.waitForFunction(() => window.__slingshot?.state().canAim === true, undefined, {
    timeout: 20_000,
  })

  const start = await readState(page)
  expect(start.piggiesTotal).toBeGreaterThan(0)
  expect(start.birdState).toBe('loaded')
  await page.screenshot({ path: 'e2e/__screenshots__/slingshot-ready.png' })

  // Fling birds down-left → they launch up-right at the towers. Flick only when a
  // bird is loaded and aimable; the built-in assist guarantees eventual success,
  // so poll until a piggy is freed (or the level auto-advances on a full clear).
  await expect
    .poll(
      async () => {
        const s = await readState(page)
        if (s.birdState === 'loaded' && s.canAim && !s.aiming && !s.levelClearing) {
          await page.evaluate(() => window.__slingshot!.flick(-0.28, 0.16))
        }
        const now = await readState(page)
        return now.piggiesFreed > 0 || now.level > start.level
      },
      { timeout: 45_000, intervals: [600] },
    )
    .toBe(true)

  await page.screenshot({ path: 'e2e/__screenshots__/slingshot-after.png' })
})
