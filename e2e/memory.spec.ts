import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
// Importing the type also loads the `declare global { Window.__memory }`
// augmentation so the in-browser evaluate() callbacks below are typed.
import type { MemoryCardState, MemoryTestState } from '../src/games/memory/testHook'

// Phaser advances its timers/tweens off the rAF loop, which Chromium throttles
// (and can freeze) for any page it treats as backgrounded — which is every
// non-focused page under parallel workers. This game has unavoidable unattended
// waits (the 1.5s mismatch hold, the ~3.2s level-complete celebration), so we
// run the file serially: only one memory page is ever active, staying focused
// and clocking at real speed. (playwright.config launchOptions help too.)
test.describe.configure({ mode: 'serial' })

const readState = (page: Page): Promise<MemoryTestState> =>
  page.evaluate(() => window.__memory!.state())

const waitForReady = (page: Page) =>
  page.waitForFunction(() => window.__memory !== undefined, undefined, { timeout: 20_000 })

/**
 * Headless Chromium throttles rAF (and thus Phaser's Time clock) on a page it
 * thinks is idle, so unattended timers (the mismatch hold, the celebration)
 * crawl. A tiny mouse move counts as input and keeps the page awake; the real
 * iPad PWA is always foreground, so this only compensates for the test harness.
 */
const keepAwake = (page: Page): Promise<void> => page.mouse.move(417, 250 + (Date.now() % 3))

/** Wait until the deal-in animation has fully landed. */
async function waitDealt(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        const s = await readState(page)
        return s.cardCount > 0 && !s.dealing
      },
      { timeout: 20_000, intervals: [200] },
    )
    .toBe(true)
}

/** Real pointer tap at a card's css-px center, with a human-ish settle after. */
async function tapCard(page: Page, card: MemoryCardState): Promise<void> {
  await page.mouse.click(card.xCss, card.yCss)
  await page.waitForTimeout(200 + Math.floor(Math.random() * 150))
}

/** Group the board's cards by subject so a spec can pick pairs / mismatches. */
function groupBySubject(s: MemoryTestState): Map<string, MemoryCardState[]> {
  const groups = new Map<string, MemoryCardState[]>()
  for (const card of s.cards) {
    const list = groups.get(card.subjectKey) ?? []
    list.push(card)
    groups.set(card.subjectKey, list)
  }
  return groups
}

/** Distinct subject keys currently on the board, sorted (a stable fingerprint). */
const subjectSet = (s: MemoryTestState): string =>
  [...new Set(s.cards.map((c) => c.subjectKey))].sort().join(',')

test('memory: level 1 deals four face-down cards — two subjects, two of each', async ({ page }) => {
  await page.goto('./#/memory')
  await waitForReady(page)
  await waitDealt(page)

  const s = await readState(page)
  expect(s.level).toBe(1)
  expect(s.cardCount).toBe(4)
  expect(s.cards.every((c) => !c.faceUp && !c.matched)).toBe(true)

  const groups = groupBySubject(s)
  expect(groups.size).toBe(2)
  for (const pair of groups.values()) expect(pair.length).toBe(2)

  await page.screenshot({ path: 'e2e/__screenshots__/memory-dealt.png' })
})

test('memory: two different-subject cards flip up, then flip back with no match', async ({
  page,
}) => {
  await page.goto('./#/memory')
  await waitForReady(page)
  await waitDealt(page)

  const s = await readState(page)
  const a = s.cards[0]
  const b = s.cards.find((c) => c.subjectKey !== a.subjectKey)!
  expect(b).toBeTruthy()

  await tapCard(page, a)
  await tapCard(page, b)

  // Both register as up and the board locks while the mismatch resolves.
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        const st = await readState(page)
        const up = st.cards.filter((c) => c.faceUp).length
        return up === 2 && st.busy
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(true)

  // After the ~1.5s learning hold both flip back down and nothing is matched.
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        const st = await readState(page)
        return st.cards.every((c) => !c.faceUp) && !st.busy
      },
      { timeout: 20_000, intervals: [200] },
    )
    .toBe(true)
  expect((await readState(page)).matchesInLevel).toBe(0)
})

test('memory: two same-subject cards match, stay up, and count as a pair', async ({ page }) => {
  await page.goto('./#/memory')
  await waitForReady(page)
  await waitDealt(page)

  const s = await readState(page)
  const pair = [...groupBySubject(s).values()].find((g) => g.length === 2)!
  await tapCard(page, pair[0])
  await tapCard(page, pair[1])

  await expect
    .poll(
      async () => {
        await keepAwake(page)
        return (await readState(page)).matchesInLevel
      },
      { timeout: 20_000, intervals: [200] },
    )
    .toBe(1)

  const after = await readState(page)
  const matched = after.cards.filter((c) => c.matched)
  expect(matched.length).toBe(2)
  expect(matched.every((c) => c.faceUp && c.subjectKey === pair[0].subjectKey)).toBe(true)
  await page.screenshot({ path: 'e2e/__screenshots__/memory-matched.png' })
})

test('memory: clearing level 1 celebrates and auto-advances to level 2', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('./#/memory')
  await waitForReady(page)
  await waitDealt(page)

  const s = await readState(page)
  const groups = [...groupBySubject(s).values()]

  // Match the first pair (not level-complete yet).
  await tapCard(page, groups[0][0])
  await tapCard(page, groups[0][1])
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        return (await readState(page)).matchesInLevel
      },
      { timeout: 20_000, intervals: [150] },
    )
    .toBeGreaterThanOrEqual(1)

  // Match the last pair → celebration.
  await tapCard(page, groups[1][0])
  await tapCard(page, groups[1][1])
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        return (await readState(page)).celebrating
      },
      { timeout: 15_000, intervals: [150] },
    )
    .toBe(true)
  await page.screenshot({ path: 'e2e/__screenshots__/memory-celebration.png' })

  // Auto-advance (~3.2s) deals a fresh level-2 board of 4.
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        return (await readState(page)).level
      },
      { timeout: 30_000, intervals: [200] },
    )
    .toBe(2)
  await expect(page.getByLabel('Level 2')).toBeVisible()

  await waitDealt(page)
  const lvl2 = await readState(page)
  expect(lvl2.cardCount).toBe(4)
  expect(lvl2.cards.every((c) => !c.faceUp && !c.matched)).toBe(true)
})

test('memory: clearing level 2 advances to level 3 with six cards', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('./#/memory')
  await waitForReady(page)

  // Play through level 1, then level 2.
  const afterL1 = await completeCurrentLevel(page)
  expect(afterL1).toBe(2)
  const afterL2 = await completeCurrentLevel(page)
  expect(afterL2).toBe(3)

  await waitDealt(page)
  expect((await readState(page)).cardCount).toBe(6)
})

test('memory: the board is locked while a mismatch is resolving', async ({ page }) => {
  await page.goto('./#/memory')
  await waitForReady(page)
  await waitDealt(page)

  const s = await readState(page)
  const a = s.cards[0]
  const b = s.cards.find((c) => c.subjectKey !== a.subjectKey)!
  // Identify the third card by its (stable, unique) slot position — a fresh
  // state read returns new objects, so reference equality would not survive it.
  const third = s.cards.find((c) => c !== a && c !== b)!
  const samePos = (c: MemoryCardState) => c.xCss === third.xCss && c.yCss === third.yCss

  await tapCard(page, a)
  await tapCard(page, b)
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        return (await readState(page)).busy
      },
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(true)

  // Tap a third card during the busy hold: it must NOT flip up.
  await page.mouse.click(third.xCss, third.yCss)
  await page.waitForTimeout(400)
  const during = await readState(page)
  expect(during.busy).toBe(true)
  expect(during.cards.filter((c) => c.faceUp).length).toBe(2)
  expect(during.cards.find(samePos)?.faceUp ?? false).toBe(false)
})

test('memory: fresh level-1 deals draw fresh random subject sets', async ({ page }) => {
  await page.goto('./#/memory')
  // A full document reload re-mounts the scene and re-deals — a hash-only goto
  // would not reload, so the board (and its subjects) would persist.
  const dealtSet = async (reload: boolean): Promise<string> => {
    if (reload) await page.reload()
    await waitForReady(page)
    await waitDealt(page)
    return subjectSet(await readState(page))
  }

  let a = await dealtSet(false)
  let b = await dealtSet(true)
  if (a === b) {
    // 2 subjects out of 16 → a 1/120 collision; one retry makes it negligible.
    a = await dealtSet(true)
    b = await dealtSet(true)
  }
  expect(a).not.toBe(b)
})

/**
 * Match every pair on the current board and return the level after it advances.
 * Positions are read once up front — cards never move until the final clear.
 */
async function completeCurrentLevel(page: Page): Promise<number> {
  await waitDealt(page)
  const s = await readState(page)
  const startLevel = s.level
  const pairs = [...groupBySubject(s).values()].filter((g) => g.length === 2)

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]
    await tapCard(page, pair[0])
    await tapCard(page, pair[1])
    if (i < pairs.length - 1) {
      // Not the last pair: wait for the match to register before the next.
      await expect
        .poll(
          async () => {
            await keepAwake(page)
            return (await readState(page)).matchesInLevel
          },
          { timeout: 20_000, intervals: [150] },
        )
        .toBeGreaterThanOrEqual(i + 1)
    }
  }

  // Last pair clears the level; wait for the auto-advance.
  await expect
    .poll(
      async () => {
        await keepAwake(page)
        return (await readState(page)).level
      },
      { timeout: 40_000, intervals: [200] },
    )
    .toBeGreaterThan(startLevel)
  return (await readState(page)).level
}
