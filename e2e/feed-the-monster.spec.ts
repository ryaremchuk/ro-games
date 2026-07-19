import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
// Importing the type also loads the `declare global { Window.__feedTheMonster }`
// augmentation so the in-browser evaluate() callbacks below are typed.
import type { FeedTestState } from '../src/games/feed-the-monster/testHook'
import type { TaskKind } from '../src/games/feed-the-monster/logic'

// The liveness polls below carry generous internal deadlines (a throttled
// headless clock can freeze Phaser for 15s+ mid-celebration), so the default
// 30s per-test budget is too tight — raise it well past the worst poll chain.
test.describe.configure({ timeout: 150_000 })

const readState = (page: Page): Promise<FeedTestState> =>
  page.evaluate(() => window.__feedTheMonster!.state())

const waitForReady = (page: Page) =>
  page.waitForFunction(() => window.__feedTheMonster !== undefined, undefined, {
    timeout: 20_000,
  })

/**
 * Headless Chromium throttles rAF (and thus Phaser's Time clock) on a page it
 * thinks is idle/backgrounded, so unattended timers (round start, celebration
 * auto-advance, tween completion) crawl or freeze outright. A tiny mouse move
 * counts as input and keeps the page awake; the real iPad PWA is always
 * foreground, so this only compensates for the test harness. Every poll below
 * nudges the mouse — a poll without it can wait forever on a frozen clock.
 */
const keepAwake = async (page: Page): Promise<void> => {
  await page.mouse.move(417, 180 + (Date.now() % 2))
}

/** Poll (with keep-awake nudges) until `predicate` returns truthy; returns state. */
async function pollState(
  page: Page,
  label: string,
  predicate: (s: FeedTestState) => boolean,
  timeoutMs = 30_000,
): Promise<FeedTestState> {
  const deadline = Date.now() + timeoutMs
  let last: FeedTestState | null = null
  while (Date.now() < deadline) {
    await keepAwake(page)
    last = await readState(page)
    if (predicate(last)) return last
    await page.waitForTimeout(300)
  }
  throw new Error(`pollState timed out: ${label}\nlast state: ${JSON.stringify(last)}`)
}

/**
 * Condition-based tray settle: the round is live and every food has held the
 * same position across two consecutive reads (drop-in bounce finished), so
 * real-pointer drags target resting coordinates — never mid-flight food.
 */
async function waitTraySettled(page: Page): Promise<FeedTestState> {
  let prev = ''
  return pollState(
    page,
    'tray settled',
    (s) => {
      if (s.round === 0 || s.transitioning || s.foods.length !== 8) {
        prev = ''
        return false
      }
      const snapshot = s.foods
        .map((f) => `${f.foodId}@${Math.round(f.xCss)},${Math.round(f.yCss)}`)
        .join('|')
      const settled = prev === snapshot
      prev = snapshot
      return settled
    },
    45_000,
  )
}

/** Force a task kind, retrying while the scene is mid-transition or booting. */
async function forceKindSettled(page: Page, kind: TaskKind): Promise<void> {
  const deadline = Date.now() + 20_000
  for (;;) {
    await keepAwake(page)
    const ok = await page.evaluate((k) => window.__feedTheMonster!.forceKind(k as TaskKind), kind)
    if (ok) break
    if (Date.now() > deadline) throw new Error(`forceKind(${kind}) never accepted`)
    await page.waitForTimeout(400)
  }
  await waitTraySettled(page)
}

/** Real-pointer drag from a tray food to the monster's mouth. */
async function dragToMouth(page: Page, from: { xCss: number; yCss: number }): Promise<void> {
  const { mouth } = await readState(page)
  await page.mouse.move(from.xCss, from.yCss)
  await page.mouse.down()
  const steps = 14
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.xCss + ((mouth.xCss - from.xCss) * i) / steps,
      from.yCss + ((mouth.yCss - from.yCss) * i) / steps,
    )
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
}

/**
 * Drag one correct food into the mouth until the feed registers (eaten grows
 * or the round flips). Retries the drag — a throttled clock can drop the
 * first pointer sequence.
 */
async function feedCorrectOnce(page: Page, s: FeedTestState): Promise<void> {
  const startRound = s.round
  const before = s.eaten.length
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = (await readState(page)).foods.find((f) => f.correct)
    expect(target, 'a correct food must always be on the tray').toBeTruthy()
    await dragToMouth(page, target!)
    try {
      await pollState(
        page,
        'feed registered',
        (now) => now.round !== startRound || now.transitioning || now.eaten.length > before,
        8_000,
      )
      return
    } catch {
      // Drag didn't land — settle and retry with fresh coordinates.
      await waitTraySettled(page).catch(() => undefined)
    }
  }
  throw new Error('correct feed never registered after 3 drags')
}

/** Feed correct foods one-by-one until the round completes and the next lays out. */
async function feedRound(page: Page): Promise<void> {
  const startRound = (await waitTraySettled(page)).round
  for (let guard = 0; guard < 12; guard++) {
    const s = await readState(page)
    if (s.round !== startRound || s.transitioning) break
    await feedCorrectOnce(page, s)
  }
  await pollState(page, 'next round started', (s) => s.round > startRound, 45_000)
  await waitTraySettled(page)
}

test('feed: round 1 lays a full tray and a picture request', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  const s = await waitTraySettled(page)

  expect(s.round).toBe(1)
  expect(s.foods).toHaveLength(8)
  expect(s.bubbleTiles).toBeGreaterThanOrEqual(1)
  expect(s.requestTotal).toBeGreaterThanOrEqual(1)
  expect(s.foods.some((f) => f.correct)).toBe(true)
  await page.screenshot({ path: 'e2e/__screenshots__/feed-round1.png' })
})

test('feed: dragging the right food feeds the monster; wrong food is spat back', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  const s = await waitTraySettled(page)

  // Round 1 asks for a single food, so a wrong item must exist too.
  const wrong = s.foods.find((f) => !f.correct)
  expect(wrong).toBeTruthy()
  await dragToMouth(page, wrong!)
  await pollState(page, 'wrong food spat back', (now) => now.spitBacks >= 1)
  expect((await readState(page)).eaten).toHaveLength(0)

  // The spat-back food arcs home — nothing is ever lost, tray stays full.
  await pollState(page, 'tray restored', (now) => now.foods.length === 8)
  await waitTraySettled(page)

  await feedCorrectOnce(page, await readState(page))
  await pollState(page, 'correct feed eaten', (now) => now.eaten.length >= 1 || now.round > 1)
})

test('feed: clean rounds climb the adaptive meter and advance rounds', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  const skillBefore = (await waitTraySettled(page)).skill

  await feedRound(page)
  await feedRound(page)

  const s = await readState(page)
  expect(s.round).toBeGreaterThanOrEqual(3)
  expect(s.skill, 'two clean quick rounds must climb the meter').toBeGreaterThan(skillBefore)
})

for (const kind of ['dots', 'not', 'pattern', 'mix'] as const) {
  test(`feed: forced ${kind} round plays by its own rule and completes`, async ({ page }) => {
    await page.goto('./#/feed-the-monster')
    await waitForReady(page)
    await waitTraySettled(page)

    await forceKindSettled(page, kind)

    const s = await readState(page)
    expect(s.taskKind).toBe(kind)
    expect(s.foods.some((f) => f.correct)).toBe(true)
    expect(s.foods.some((f) => !f.correct)).toBe(true)
    await page.screenshot({ path: `e2e/__screenshots__/feed-${kind}.png` })

    // A wrong food first: must be refused (this is the discrimination the
    // kind trains — banned temptation, pattern near-miss, off-color, …).
    const wrong = s.foods.find((f) => !f.correct)!
    await dragToMouth(page, wrong)
    await pollState(page, 'wrong food spat back', (now) => now.spitBacks >= 1)
    expect((await readState(page)).eaten).toHaveLength(0)

    // Then complete the round with correct feeds only.
    await feedRound(page)
  })
}
