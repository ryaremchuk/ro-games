import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
// Importing the type also loads the `declare global { Window.__whackASilly }`
// augmentation so the in-browser evaluate() callbacks below are typed.
import type { WhackTestState } from '../src/games/whack-a-silly/testHook'

const readState = (page: Page): Promise<WhackTestState> =>
  page.evaluate(() => window.__whackASilly!.state())

const waitForReady = (page: Page) =>
  page.waitForFunction(() => window.__whackASilly !== undefined, undefined, { timeout: 20_000 })

/** Force a deterministic spawn (bypasses the ~45s phase-2 wait for sleepers). */
const forceSpawn = (page: Page, hole: number, opts?: { sleepy?: boolean; golden?: boolean }) =>
  page.evaluate(
    ([h, o]) => window.__whackASilly!.forceSpawn(h as number, o as { sleepy?: boolean }),
    [hole, opts ?? {}] as const,
  )

/** Wait until a hole reaches the given state (critters emerge asynchronously). */
const waitHoleState = (page: Page, hole: number, state: string, timeout = 10_000) =>
  page.waitForFunction(
    ([h, s]) => window.__whackASilly!.state().holes[h as number].state === s,
    [hole, state] as const,
    { timeout },
  )

/**
 * Headless Chromium throttles rAF (and thus Phaser's Time clock) on a page it
 * thinks is idle/backgrounded, so an unattended timer (a sleeper's up-time)
 * crawls. A tiny mouse move counts as input and keeps the page awake; the real
 * iPad PWA is always foreground, so this only compensates for the test harness.
 */
const keepAwake = async (page: Page): Promise<void> => {
  await page.mouse.move(417, 250 + (Date.now() % 2))
}

const firstDownHole = (s: WhackTestState): number => s.holes.findIndex((h) => h.state === 'down')

/**
 * Tap the critter's head (the hit target sits ~88 css above the hole center)
 * until it reacts — i.e. leaves 'up'/'rising'. Retrying absorbs the first-click
 * input warm-up and any sub-pixel jitter, and works for both a go critter (bop)
 * and a sleeper (wake-grumpy), which both transition to 'leaving' on a tap.
 */
async function tapUntilReacts(page: Page, hole: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const h = (await readState(page)).holes[hole]
        if (h.state !== 'up' && h.state !== 'rising') return 'reacted'
        await page.mouse.click(h.xCss, h.yCss - 88)
        return h.state
      },
      { timeout: 10_000, intervals: [250] },
    )
    .toBe('reacted')
}

test('whack: a critter is invisible while down and visible once it pops up', async ({ page }) => {
  await page.goto('./#/whack-a-silly')
  await waitForReady(page)

  // Belt guarantee: any hole reported as "down" must never show its critter.
  for (let i = 0; i < 6; i++) {
    const s = await readState(page)
    for (const h of s.holes) {
      if (h.state === 'down') expect(h.critterVisible, 'down critters must be hidden').toBe(false)
    }
    await keepAwake(page)
    await page.waitForTimeout(250)
  }

  // Force a spawn and confirm the critter becomes visible as it emerges.
  const hole = firstDownHole(await readState(page))
  expect(hole).toBeGreaterThanOrEqual(0)
  expect(await forceSpawn(page, hole)).toBe(true)
  await waitHoleState(page, hole, 'up')

  const up = await readState(page)
  expect(up.holes[hole].critterVisible).toBe(true)
  await page.screenshot({ path: 'e2e/__screenshots__/whack-a-silly-up.png' })
})

test('whack: tapping go critters scores bops and re-hides each hole', async ({ page }) => {
  await page.goto('./#/whack-a-silly')
  await waitForReady(page)
  expect((await readState(page)).bops).toBe(0)

  // Three bops exercise all three rotating celebrations (launch/boing/hearts).
  for (let k = 0; k < 3; k++) {
    const hole = firstDownHole(await readState(page))
    expect(hole, 'a free hole should be available').toBeGreaterThanOrEqual(0)
    expect(await forceSpawn(page, hole)).toBe(true)
    await waitHoleState(page, hole, 'up')

    const before = (await readState(page)).bops
    await tapUntilReacts(page, hole)

    // The tap must register as a bop…
    await expect.poll(async () => (await readState(page)).bops, { timeout: 8_000 }).toBe(before + 1)
    // …and the critter must sink back and hide (launch is the longest exit).
    await page.waitForFunction(
      (h) => {
        const st = window.__whackASilly!.state().holes[h as number]
        return st.state === 'down' && st.critterVisible === false
      },
      hole,
      { timeout: 10_000 },
    )
  }

  expect((await readState(page)).bops).toBe(3)
})

test('whack: tapping a sleeper wakes it but never scores a bop', async ({ page }) => {
  await page.goto('./#/whack-a-silly')
  await waitForReady(page)

  const hole = firstDownHole(await readState(page))
  expect(await forceSpawn(page, hole, { sleepy: true })).toBe(true)
  await waitHoleState(page, hole, 'up')

  const before = await readState(page)
  expect(before.holes[hole].sleepy).toBe(true)
  expect(before.bops).toBe(0)
  await page.screenshot({ path: 'e2e/__screenshots__/whack-a-silly-sleeper.png' })

  await tapUntilReacts(page, hole)
  // It wakes grumpy and ducks back down — no bop, no spare (that's the mistake).
  await page.waitForFunction(
    (h) => window.__whackASilly!.state().holes[h as number].state === 'down',
    hole,
    { timeout: 10_000 },
  )
  const after = await readState(page)
  expect(after.bops, 'tapping a sleeper is not a bop').toBe(0)
  expect(after.spared, 'a woken sleeper was not spared').toBe(0)
})

test('whack: sparing a sleeper (leaving it to nap) counts as the win', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('./#/whack-a-silly')
  await waitForReady(page)

  const hole = firstDownHole(await readState(page))
  expect(await forceSpawn(page, hole, { sleepy: true })).toBe(true)
  await waitHoleState(page, hole, 'up')
  expect((await readState(page)).spared).toBe(0)

  // Do NOT tap it. When its up-time elapses it wakes happy and `spared` ticks up.
  // No random sleeper can interfere: they only appear in phase 2 (~45s in). Nudge
  // the mouse each poll so the throttled headless clock keeps advancing.
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        return (await readState(page)).spared
      },
      { timeout: 40_000, intervals: [400] },
    )
    .toBe(1)
  expect((await readState(page)).bops, 'sparing is not a bop').toBe(0)
})
