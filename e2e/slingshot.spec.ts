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

test('slingshot: clearing level 3 opens a star drop that rewards a new bird', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('./#/slingshot')
  await waitForAimable(page)

  // Jump straight to level 3 (the first star-drop level) instead of playing the
  // first two, and pin the reward so the assertion is deterministic. The reward
  // must be set BEFORE the level is cleared (it's consumed when the drop shows).
  await page.evaluate(() => window.__slingshot!.skipToLevel(3))
  await waitForAimable(page)
  await page.evaluate(() => window.__slingshot!.forceStarDrop('red'))
  expect((await readState(page)).level).toBe(3)

  // Clear level 3 with the flick hook; the invisible aim assist (ramps after 5
  // piggy-less launches) guarantees the single piggy is eventually freed. Note
  // freeing only ARMS after the first launch — so the first flick can't free.
  let attempt = 0
  await expect
    .poll(
      async () => {
        const s = await readState(page)
        if (s.starDropActive) return true
        if (s.birdState === 'loaded' && s.canAim && !s.aiming && !s.levelClearing) {
          const dy = 0.05 + (attempt++ % 4) * 0.025
          await page.evaluate((dyN) => window.__slingshot!.flick(-0.2, dyN), dy)
        }
        return (await readState(page)).starDropActive
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe(true)

  const dropped = await readState(page)
  expect(dropped.starDropActive).toBe(true)
  expect(dropped.starDropTapsRemaining).toBeGreaterThan(0)
  await page.screenshot({ path: 'e2e/__screenshots__/slingshot-stardrop.png' })

  // The whole screen is the tap target. Tap the center with real pointer events
  // at human-ish gaps until the star opens and the overlay dismisses. Taps that
  // land mid-animation are ignored, so the loop just keeps tapping.
  const cx = 834 / 2
  const cy = 1112 / 2
  await expect
    .poll(
      async () => {
        if ((await readState(page)).starDropActive) {
          await page.mouse.click(cx, cy)
          await page.waitForTimeout(450 + Math.floor(Math.random() * 250))
        }
        return (await readState(page)).starDropActive
      },
      { timeout: 45_000, intervals: [400] },
    )
    .toBe(false)

  // The reward promoted the active bird, the game advanced, and the new level
  // flies the rewarded bird.
  await expect
    .poll(async () => (await readState(page)).activeBirdKind, { timeout: 5_000 })
    .toBe('red')
  await expect.poll(async () => (await readState(page)).level, { timeout: 5_000 }).toBe(4)
  await expect.poll(async () => (await readState(page)).birdKind, { timeout: 10_000 }).toBe('red')
  await page.screenshot({ path: 'e2e/__screenshots__/slingshot-rewarded.png' })
})
