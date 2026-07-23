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
 * One tick of a CLEAN run: tap every go-critter that's up (so nothing escapes —
 * escapes ease the spatial track), and when the board is idle force exactly one
 * new critter. Strictly one-at-a-time keeps go-escapes ≈ 0, so the spatial meter
 * climbs and the board grows. Sleepers are left alone (sparing ≠ escape).
 */
async function driveCleanBop(page: Page): Promise<void> {
  const s = await readState(page)
  for (const h of s.holes) {
    if ((h.state === 'up' || h.state === 'rising') && !h.sleepy) {
      await page.mouse.click(h.xCss, h.yCss - 88)
    }
  }
  const anyBusy = s.holes.some((h) => h.state !== 'down')
  if (!anyBusy) {
    const hole = firstDownHole(s)
    if (hole >= 0) await forceSpawn(page, hole).catch(() => {})
  }
}

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

const setBoard = (page: Page, holeCount: number): Promise<number> =>
  page.evaluate((n) => window.__whackASilly!.setBoard(n as number), holeCount)

test('whack: an episode boundary re-rolls the board (transition machinery)', async ({ page }) => {
  test.setTimeout(70_000)
  await page.goto('./#/whack-a-silly')
  await waitForReady(page)

  const start = await readState(page)
  expect(start.episode, 'fresh session starts on episode 0').toBe(0)
  expect(start.holeCount, 'easiest board is four holes').toBe(4)
  expect(start.holes).toHaveLength(4)

  // Bop until the episode flips (the spatial track re-rolls the board).
  await expect
    .poll(
      async () => {
        if ((await readState(page)).episode > 0) return true
        await driveCleanBop(page)
        return (await readState(page)).episode > 0
      },
      { timeout: 55_000, intervals: [150] },
    )
    .toBe(true)

  // Wait for the WHOLE transition (dance → sink → reveal) to finish before
  // reading the settled board — mid-transition the old holeCount transiently
  // matches the old hole list, so we must key off `transitioning`, not lengths.
  await expect
    .poll(
      async () => {
        const s = await readState(page)
        return !s.transitioning && s.holes.length === s.holeCount
      },
      { timeout: 15_000, intervals: [150] },
    )
    .toBe(true)

  const after = await readState(page)
  expect(after.holeCount).toBeGreaterThanOrEqual(4)
  expect(after.holeCount).toBeLessThanOrEqual(9)
  expect(after.holes).toHaveLength(after.holeCount)
  await page.screenshot({ path: 'e2e/__screenshots__/whack-a-silly-episode2.png' })

  // Every fresh hole must actually come alive — a hole left stuck 'up' by the
  // dance (stale state) would count as occupied and never spawn. Confirm each
  // index is seen 'down' (ready) at least once within a short window.
  const seenDown = new Set<number>()
  await expect
    .poll(
      async () => {
        const s = await readState(page)
        s.holes.forEach((h, i) => {
          if (h.state === 'down') seenDown.add(i)
        })
        return seenDown.size
      },
      { timeout: 15_000, intervals: [120] },
    )
    .toBe(after.holeCount)
})

// The board must fit — and stay tappable — at both the easiest (4) and densest
// (9) sizes, on both target aspects. setBoard() pins the count deterministically.
for (const vp of [
  { name: 'iPad landscape 4:3', width: 1024, height: 768 },
  { name: 'iPhone landscape ~2.2:1', width: 896, height: 414 },
]) {
  for (const count of [4, 9]) {
    test(`whack: ${count} holes fit on-screen and stay reachable (${vp.name})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('./#/whack-a-silly')
      await waitForReady(page)

      expect(await setBoard(page, count)).toBe(count)
      await expect
        .poll(async () => (await readState(page)).holeCount, { timeout: 8_000 })
        .toBe(count)

      const s = await readState(page)
      expect(s.holes).toHaveLength(count)

      // Every hole center on-screen, head-tap point (~88css up) below the top,
      // mound clear of the bottom edge.
      for (const h of s.holes) {
        expect(h.xCss, 'left edge').toBeGreaterThan(20)
        expect(h.xCss, 'right edge').toBeLessThan(vp.width - 20)
        expect(h.yCss - 88, 'head-tap below top edge').toBeGreaterThan(0)
        expect(h.yCss, 'clear of bottom edge').toBeLessThan(vp.height - 8)
      }

      // No two openings collide — a floor on the effective touch separation.
      for (let i = 0; i < s.holes.length; i++) {
        for (let j = i + 1; j < s.holes.length; j++) {
          const dx = s.holes[i].xCss - s.holes[j].xCss
          const dy = s.holes[i].yCss - s.holes[j].yCss
          expect(Math.hypot(dx, dy), 'holes not stacked').toBeGreaterThan(55)
        }
      }
      await page.screenshot({
        path: `e2e/__screenshots__/whack-a-silly-${count}holes-${vp.width}x${vp.height}.png`,
      })
    })
  }
}
