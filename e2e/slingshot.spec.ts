import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
// Importing the type also loads the `declare global { Window.__slingshot }`
// augmentation so the in-browser evaluate() callbacks below are typed.
import type { SlingshotTestState } from '../src/games/slingshot/testHook'

const readState = (page: Page): Promise<SlingshotTestState> =>
  page.evaluate(() => window.__slingshot!.state())

const waitForAimable = (page: Page) =>
  page.waitForFunction(() => window.__slingshot?.state().canAim === true, undefined, {
    timeout: 20_000,
  })

/**
 * Drive the REAL input path (pointerdown → pointermove → pointerup), unlike
 * the __slingshot.flick() hook which calls the scene's aim/release internals
 * directly and is therefore blind to input-layer and timing bugs. Coordinates
 * are css px; `from` must be in the left aim zone (x < 55% of the screen).
 */
async function dragLaunch(
  page: Page,
  from: { x: number; y: number },
  by: { x: number; y: number },
) {
  const steps = 6
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (by.x * i) / steps, from.y + (by.y * i) / steps)
  }
  await page.mouse.up()
}

test('slingshot: a real pointer drag launches the bird even after a slow aim', async ({ page }) => {
  await page.goto('./#/slingshot')
  await waitForAimable(page)

  // A child pauses before shooting. By release time the bird body has sat
  // motionless for >60 physics steps — the window where Matter's sleeping
  // (enableSleeping: true) is eligible to freeze it.
  await page.waitForTimeout(1500)

  // Pull down-left from the left zone and let go: must launch up-right.
  await dragLaunch(page, { x: 350, y: 700 }, { x: -140, y: 90 })

  const launched = await readState(page)
  expect(launched.birdState).toBe('flying') // release() ran, not the hop-back branch
  const x0 = launched.birdX ?? 0
  const y0 = launched.birdY ?? 0

  // The launch must be real: an asleep body is skipped by gravity AND
  // integration, so it would report 'flying' while hanging frozen mid-air.
  await page.waitForTimeout(300)
  const later = await readState(page)
  expect(later.birdAsleep, 'launched bird body must not be asleep').not.toBe(true)
  if (later.birdState === 'flying') {
    const traveled = Math.hypot((later.birdX ?? x0) - x0, (later.birdY ?? y0) - y0)
    expect(traveled, 'bird must actually move after release').toBeGreaterThan(40)
  }
})

test('slingshot: real drags play through level 1 and advance to level 2', async ({ page }) => {
  // A full playthrough can take many flights (the assist ramps after 5 misses).
  test.setTimeout(150_000)
  await page.goto('./#/slingshot')
  await waitForAimable(page)

  const start = await readState(page)
  expect(start.level).toBe(1)
  expect(start.piggiesTotal).toBeGreaterThan(0)
  expect(start.birdState).toBe('loaded')
  await page.screenshot({ path: 'e2e/__screenshots__/slingshot-ready.png' })

  // Fling birds with real pointer drags, alternating two flat-ish arcs aimed
  // at the level-1 tower; the invisible assist guarantees eventual success.
  // Poll until every piggy is freed and the level auto-advances.
  let attempt = 0
  await expect
    .poll(
      async () => {
        const s = await readState(page)
        if (s.birdState === 'loaded' && s.canAim && !s.aiming && !s.levelClearing) {
          const by = attempt++ % 2 === 0 ? { x: -98, y: 9 } : { x: -108, y: 15 }
          await dragLaunch(page, { x: 350, y: 720 }, by)
        }
        return (await readState(page)).level
      },
      { timeout: 120_000, intervals: [700] },
    )
    .toBeGreaterThanOrEqual(2)

  // The shared level badge (real DOM, outside the canvas) must show level 2.
  await expect(page.getByLabel('Level 2')).toBeVisible()
  await page.screenshot({ path: 'e2e/__screenshots__/slingshot-level2.png' })
})
