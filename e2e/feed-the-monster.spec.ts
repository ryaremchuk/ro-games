import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
// Importing the type also loads the `declare global { Window.__feedTheMonster }`
// augmentation so the in-browser evaluate() callbacks below are typed.
import type { ConveyorLaneState, FeedTestState } from '../src/games/feed-the-monster/testHook'
import type { TaskKind } from '../src/games/feed-the-monster/logic'
import type { JourneyState } from '../src/games/feed-the-monster/journey'
import { EPISODES, FRIENDS_PER_EPISODE, GROW_STEPS } from '../src/games/feed-the-monster/journey'
import { VISITOR_TAP_MIN_CSS } from '../src/games/feed-the-monster/layout'

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

/** Jump the journey to a given point, retrying while mid-transition. */
async function forceJourneySettled(page: Page, journey: Partial<JourneyState>): Promise<void> {
  const deadline = Date.now() + 20_000
  for (;;) {
    await keepAwake(page)
    const ok = await page.evaluate(
      (j) => window.__feedTheMonster!.forceJourney(j as Partial<JourneyState>),
      journey,
    )
    if (ok) break
    if (Date.now() > deadline) throw new Error(`forceJourney never accepted`)
    await page.waitForTimeout(400)
  }
  await waitTraySettled(page)
}

/** Real-pointer drag from a tray food to an arbitrary drop point (css px). */
async function dragToPoint(
  page: Page,
  from: { xCss: number; yCss: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.xCss, from.yCss)
  await page.mouse.down()
  const steps = 14
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.xCss + ((to.x - from.xCss) * i) / steps,
      from.yCss + ((to.y - from.yCss) * i) / steps,
    )
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
}

/** Real-pointer drag from a tray food to the monster's mouth. */
async function dragToMouth(page: Page, from: { xCss: number; yCss: number }): Promise<void> {
  const { mouth } = await readState(page)
  await dragToPoint(page, from, { x: mouth.xCss, y: mouth.yCss })
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
    const now = await readState(page)
    // A KITCHEN round has a different next step: nothing on the tray is feedable
    // until the recipe has been cooked, so fill the pot first.
    if (now.kitchen !== null && now.kitchen.madeDish === null) {
      const part = now.foods.find((f) => now.kitchen!.wants.includes(f.foodId))
      expect(part, 'a wanted ingredient must always be on the tray').toBeTruthy()
      const inBefore = now.kitchen.contents.length
      await dragToPoint(page, part!, { x: now.kitchen.potCss.x, y: now.kitchen.potCss.y })
      await pollState(
        page,
        'ingredient went into the pot',
        (later) =>
          (later.kitchen?.contents.length ?? 0) > inBefore || later.kitchen?.madeDish !== null,
        12_000,
      ).catch(() => undefined)
      continue
    }
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

/**
 * Close an open commission by handing back a blank page.
 *
 * A commission is a journey BEAT, not a round: it lands on the first friend of an
 * episode, which means any spec that feeds through an episode boundary will meet
 * one and find no tray at all. Closing it blank is the child's own no-cost exit,
 * and it leaves the round to proceed normally.
 */
async function dismissCommission(page: Page): Promise<void> {
  if ((await readState(page)).commission === null) return
  await page.evaluate(() => window.__feedTheMonster!.submitDrawing([]))
  await pollState(page, 'commission closed', (s) => s.commission === null, 20_000)
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
  await dismissCommission(page)
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
  // Keep both rounds plain single-step grows — a random big bite could otherwise
  // graduate the friend mid-test; this keeps the focus on meter + round advance.
  await page.evaluate(() => window.__feedTheMonster!.setRandomBigBite(false))
  const skillBefore = (await waitTraySettled(page)).skill

  await feedRound(page)
  await feedRound(page)

  const s = await readState(page)
  expect(s.round).toBeGreaterThanOrEqual(3)
  expect(s.skill, 'two clean quick rounds must climb the meter').toBeGreaterThan(skillBefore)
})

test('feed: a fed round visibly grows the friend; a wrong feed deflates it', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  // Silence the random big-bite so "grow back one step" is an exact assertion
  // (the stuck catch-up never fires here — only one wrong feed).
  await page.evaluate(() => window.__feedTheMonster!.setRandomBigBite(false))

  // Jump mid-growth so both directions are observable.
  await forceJourneySettled(page, { growthStep: 3 })
  const mid = await readState(page)
  expect(mid.journey.growthStep).toBe(3)
  const scaleBefore = mid.growthScale
  await page.screenshot({ path: 'e2e/__screenshots__/feed-friend-mid.png' })

  // Wrong feed → one step smaller (and its growth aura dims).
  const wrong = mid.foods.find((f) => !f.correct)!
  await dragToMouth(page, wrong)
  await pollState(page, 'friend deflated', (s) => s.journey.growthStep === 2)
  await pollState(page, 'shrink animated', (s) => s.growthScale < scaleBefore)

  // Complete the round → the journey grows back a step, visibly: bigger, and a
  // brighter aura than the shrunk state.
  const shrunk = await readState(page)
  await feedRound(page)
  const after = await readState(page)
  expect(after.journey.growthStep).toBe(3)
  expect(after.growthScale).toBeGreaterThan(shrunk.growthScale)
  expect(after.aura).toBeGreaterThan(shrunk.aura)
})

test('feed: a big-bite round announces itself before it is played, then pays double', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  // Silence the dice so the only big bite in this test is the one we dress.
  await page.evaluate(() => window.__feedTheMonster!.setRandomBigBite(false))
  await forceJourneySettled(page, { growthStep: 0 })

  const plain = await readState(page)
  expect(plain.bigBite).toBe(false)
  expect(plain.foodBoost).toBe(1)

  // Dress the LIVE round — the whole point of the feature is that the child is
  // told before feeding a single item, not congratulated afterwards.
  await page.evaluate(() => window.__feedTheMonster!.devBigBite(true))
  const dressed = await pollState(
    page,
    'tray dressed for a big bite',
    (s) => s.bigBite && s.foodBoost > 1,
  )
  expect(dressed.round, 'the same round is dressed, not a new one dealt').toBe(plain.round)
  expect(dressed.eaten, 'announced before any feeding').toHaveLength(0)
  await page.screenshot({ path: 'e2e/__screenshots__/feed-big-bite.png' })

  // …and it really is worth two growth steps.
  await feedRound(page)
  expect((await readState(page)).journey.growthStep).toBe(2)
})

test('feed: struggling upgrades the round to a big bite mid-play', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  await page.evaluate(() => window.__feedTheMonster!.setRandomBigBite(false))
  await forceJourneySettled(page, { growthStep: 2 })

  // Two wrong feeds deflate the friend 2 → 0. That is the treadmill the catch-up
  // exists to break — and now the child SEES it break.
  for (let i = 0; i < 2; i++) {
    const s = await waitTraySettled(page)
    const before = s.spitBacks
    await dragToMouth(
      page,
      s.foods.find((f) => !f.correct)!,
    )
    await pollState(page, `wrong feed ${i + 1} spat back`, (now) => now.spitBacks > before)
  }

  const upgraded = await pollState(
    page,
    'round upgraded to a big bite mid-play',
    (s) => s.bigBite && s.foodBoost > 1,
  )
  expect(upgraded.transitioning, 'upgraded while the round is still being played').toBe(false)
  expect(upgraded.journey.growthStep).toBe(0)

  // Finishing pays +2, so the two slips are fully recovered — not a net loss.
  await feedRound(page)
  expect((await readState(page)).journey.growthStep).toBe(2)
})

test('feed: a fully grown friend joins the lineup and a new small friend arrives', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  // One bite away from full growth.
  await forceJourneySettled(page, { growthStep: GROW_STEPS - 1 })
  expect((await readState(page)).miniCount).toBe(0)

  await feedRound(page)

  const s = await readState(page)
  expect(s.journey.friendsFed).toBe(1)
  expect(s.journey.growthStep).toBe(0)
  expect(s.miniCount).toBe(1)
  expect(s.growthScale).toBeLessThan(1) // the new friend starts small again
  await page.screenshot({ path: 'e2e/__screenshots__/feed-friend-grown.png' })
})

test('feed: the 5th grown friend throws a dance party and opens the next episode', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  await forceJourneySettled(page, {
    friendsFed: FRIENDS_PER_EPISODE - 1,
    growthStep: GROW_STEPS - 1,
  })
  expect((await readState(page)).miniCount).toBe(FRIENDS_PER_EPISODE - 1)
  expect((await readState(page)).episodeId).toBe(EPISODES[0].id)

  await feedRound(page)

  const s = await readState(page)
  expect(s.journey).toEqual({ episode: 1, friendsFed: 0, growthStep: 0 })
  expect(s.episodeId).toBe(EPISODES[1].id)
  expect(s.miniCount).toBe(0) // fresh lineup for the new episode
  // The tray now serves the new episode's food pool.
  const episodeFoodIds = new Set(EPISODES[1].foods.map((f) => f.id))
  for (const food of s.foods) expect(episodeFoodIds.has(food.foodId)).toBe(true)
  await page.screenshot({ path: 'e2e/__screenshots__/feed-episode2.png' })
})

test('feed: the journey survives a reload (persistent long-term progression)', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  await forceJourneySettled(page, { episode: 2, friendsFed: 2, growthStep: 2 })

  await page.reload()
  await waitForReady(page)
  const s = await waitTraySettled(page)
  expect(s.journey).toEqual({ episode: 2, friendsFed: 2, growthStep: 2 })
  expect(s.episodeId).toBe(EPISODES[2].id)
  expect(s.miniCount).toBe(2)
  expect(s.aura).toBeGreaterThan(0)
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

// ─── The conveyor ─────────────────────────────────────────────────────────────
//
// The belt NEVER STOPS. Touching a dish lifts it clean off its plate instead of
// freezing the world, and the plate it came off keeps riding, empty. Everything
// below proves that contract rather than the old freeze.

/** Plates on the belt that currently carry a dish. */
const filledPlates = (s: FeedTestState): number =>
  (s.conveyor?.lanes ?? []).filter((l) => l.foodId !== null).length

/**
 * A dish is LOOSE when a food sprite exists that no plate is carrying — in the
 * child's hand, or flying home. Exactly one while a dish is held, and zero once
 * everything has settled: that difference is the "nothing is ever lost" invariant,
 * readable without seeing the canvas.
 */
const looseDishes = (s: FeedTestState): number => s.foods.length - filledPlates(s)

/** Deal a belt round and wait until it is loaded. */
async function startConveyor(page: Page): Promise<FeedTestState> {
  const deadline = Date.now() + 20_000
  for (;;) {
    await keepAwake(page)
    const ok = await page.evaluate(() => window.__feedTheMonster!.forceConveyor())
    if (ok) break
    if (Date.now() > deadline) throw new Error('forceConveyor never accepted')
    await page.waitForTimeout(400)
  }
  return pollState(
    page,
    'belt on stage',
    (s) => s.conveyorActive && (s.conveyor?.lanes.length ?? 0) > 0,
  )
}

/**
 * Put a real pointer down on a moving belt dish and confirm it came off its plate.
 * Retries, because nothing freezes: a dish travels between the state read and the
 * pointer landing, which is exactly the grab the child has to make.
 * Leaves the pointer DOWN — the caller drags or releases.
 */
async function grabBeltDish(
  page: Page,
  pick: (lane: ConveyorLaneState) => boolean = () => true,
): Promise<{ lane: number; foodId: string; xCss: number; yCss: number }> {
  // Generous: the belt does not stop, so a wanted dish reaching the near half of
  // the loop is something the spec WAITS for, exactly as the child does.
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    await keepAwake(page)
    const s = await readState(page)
    const lanes = s.conveyor?.lanes ?? []
    // Only the left half: a dish grabbed at the far edge wraps through the hatch
    // (and its plate is re-dressed) before a spec can finish looking at it.
    const index = lanes.findIndex(
      (l) =>
        l.foodId !== null &&
        l.visible &&
        l.msUntilReachable === 0 &&
        l.xCss < page.viewportSize()!.width * 0.55 &&
        pick(l),
    )
    if (index < 0) {
      await page.waitForTimeout(300)
      continue
    }
    const lane = lanes[index]
    await page.mouse.move(lane.xCss, lane.yCss)
    await page.mouse.down()
    const now = await readState(page)
    if (now.conveyor?.lifted === lane.foodId && now.conveyor.lanes[index].foodId === null) {
      return { lane: index, foodId: lane.foodId!, xCss: lane.xCss, yCss: lane.yCss }
    }
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
  throw new Error('never managed to lift a dish off the moving belt')
}

/** Drag the dish already under the pointer to a point, then let go. */
async function dragHeldTo(
  page: Page,
  from: { xCss: number; yCss: number },
  to: { x: number; y: number },
): Promise<void> {
  const steps = 14
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.xCss + ((to.x - from.xCss) * i) / steps,
      from.yCss + ((to.y - from.yCss) * i) / steps,
    )
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
}

test('feed: a conveyor round serves food from a belt that never stops', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  const s0 = await startConveyor(page)
  // The belt derives its plate count from the viewport — never the tray's fixed 8.
  expect(s0.conveyor!.lanes.length).toBeGreaterThanOrEqual(5)
  expect(s0.conveyor!.dishSpeedCss).toBeGreaterThan(0)
  expect(s0.conveyor!.traverseMs).toBeGreaterThan(0)
  expect(
    s0.conveyor!.lanes.some((l) => l.wanted),
    'the belt is loaded with something feedable from the first frame',
  ).toBe(true)
  await page.screenshot({ path: 'e2e/__screenshots__/feed-conveyor.png' })

  // It really moves, and it says so: the loop offset climbs on its own.
  const before = await readState(page)
  await pollState(
    page,
    'belt advanced a whole plate',
    (s) => (s.conveyor?.offset ?? 0) > before.conveyor!.offset + 1,
    30_000,
  )
  expect((await readState(page)).conveyor!.moving).toBe(true)

  // The anti-drought guarantee, as the child experiences it: something feedable
  // is always within the budget.
  const live = await readState(page)
  const soonest = Math.min(
    ...live.conveyor!.lanes.filter((l) => l.wanted).map((l) => l.msUntilReachable),
  )
  expect(soonest).toBeLessThanOrEqual(live.conveyor!.maxWaitMs + live.conveyor!.traverseMs)
})

test('feed: the belt keeps running while a dish is held, and its plate rides on empty', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  const s0 = await startConveyor(page)
  const plates = s0.conveyor!.lanes.length

  const grabbed = await grabBeltDish(page)
  const held = await readState(page)
  // The plate did not vanish with its dish — it is still there, and it is empty.
  expect(held.conveyor!.lanes.length, 'the plate count never changes').toBe(plates)
  expect(held.conveyor!.lanes[grabbed.lane].foodId).toBeNull()
  expect(looseDishes(held), 'exactly the held dish is off a plate').toBe(1)

  // …and the world did NOT stop under the finger: the loop keeps advancing and
  // the emptied plate keeps riding with it.
  const advanced = await pollState(
    page,
    'the belt kept running while the dish was held',
    (s) => (s.conveyor?.offset ?? 0) > held.conveyor!.offset + 0.4,
    20_000,
  )
  expect(advanced.conveyor!.moving).toBe(true)
  expect(advanced.conveyor!.lifted).toBe(grabbed.foodId)
  expect(
    advanced.conveyor!.lanes[grabbed.lane].xCss,
    'the emptied plate travelled too',
  ).not.toBeCloseTo(held.conveyor!.lanes[grabbed.lane].xCss, 0)
  expect(advanced.conveyor!.lanes[grabbed.lane].foodId).toBeNull()

  await page.mouse.up()
})

test('feed: a belt dish let go without being fed lands back on a plate', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  const s0 = await startConveyor(page)
  const plates = s0.conveyor!.lanes.length
  const dishesBefore = s0.foods.length

  const grabbed = await grabBeltDish(page)
  expect(looseDishes(await readState(page))).toBe(1)

  // Let go over empty stage, nowhere near the mouth — the child changed their mind.
  const size = page.viewportSize()!
  await dragHeldTo(page, grabbed, { x: size.width * 0.12, y: size.height * 0.45 })

  const landed = await pollState(
    page,
    'the dish flew back onto a plate',
    (s) => s.conveyor !== null && s.conveyor.lifted === null && looseDishes(s) === 0,
    20_000,
  )
  expect(landed.conveyor!.lanes.length, 'no plate was consumed by the round trip').toBe(plates)
  expect(landed.foods.length, 'no dish was lost').toBeGreaterThanOrEqual(dishesBefore)
  expect(landed.conveyor!.moving, 'and the belt never stopped for any of it').toBe(true)
})

test('feed: feeding from the belt leaves its plate riding empty, then the still tray returns', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)
  await page.evaluate(() => window.__feedTheMonster!.setRandomBigBite(false))

  const start = await startConveyor(page)
  const startRound = start.round
  const plates = start.conveyor!.lanes.length

  // Feed one dish straight off the moving belt. Grabbed from the LEFT half, so
  // the plate it came off is still several seconds from the hatch and cannot have
  // been re-dressed by the time this is read — whether or not the round completed
  // (the belt is torn down only when the NEXT round is dealt).
  const eatenBefore = start.eaten.length
  const grabbed = await grabBeltDish(page, (l) => l.wanted)
  await dragHeldTo(page, grabbed, { x: start.mouth.xCss, y: start.mouth.yCss })
  const fed = await pollState(
    page,
    'belt feed registered',
    (s) => s.eaten.length > eatenBefore || s.round !== startRound || s.transitioning,
    15_000,
  )
  // The eaten dish is gone — its PLATE is not. It keeps going round, empty, until
  // it rides through the hatch and is dressed again.
  expect(fed.conveyorActive, 'the belt is still on stage right after a feed').toBe(true)
  expect(fed.conveyor!.lanes.length, 'the plate count never changes').toBe(plates)
  expect(fed.conveyor!.lanes[grabbed.lane].foodId, 'the fed plate rides on empty').toBeNull()
  expect(looseDishes(fed), 'nothing was left hanging by the feed').toBe(0)

  // Finish the round off the belt and hand the still plate row back.
  for (let guard = 0; guard < 12; guard++) {
    const s = await readState(page)
    if (!s.conveyorActive || s.transitioning || s.round !== startRound) break
    const dish = (s.conveyor?.lanes ?? []).find(
      (l) => l.wanted && l.visible && l.msUntilReachable === 0,
    )
    if (!dish) {
      await keepAwake(page)
      await page.waitForTimeout(400)
      continue
    }
    const eatenBefore = s.eaten.length
    await dragToPoint(
      page,
      { xCss: dish.xCss, yCss: dish.yCss },
      { x: s.mouth.xCss, y: s.mouth.yCss },
    )
    await pollState(
      page,
      'belt feed registered',
      (now) => now.round !== startRound || now.transitioning || now.eaten.length > eatenBefore,
      12_000,
    ).catch(() => undefined)
  }

  await pollState(page, 'round after the belt started', (s) => s.round > startRound, 45_000)
  const after = await pollState(page, 'still tray restored', (s) => !s.conveyorActive, 30_000)
  await waitTraySettled(page)
  expect(after.foods.length).toBeGreaterThan(0)
})

// ─── The kitchen ──────────────────────────────────────────────────────────────
//
// A kitchen round is the only one that puts TWO task panels on screen at once:
// the friend's bubble ("bring me this dish") and the pot's own recipe panel
// ("cook this"). The specs below read both through the state hook.

/** The ingredients the pot's recipe panel is showing, left to right. */
const recipeParts = (s: FeedTestState): string[] =>
  (s.kitchen?.recipePanel?.cells ?? [])
    .filter((c) => c.kind === 'part')
    .map((c) => c.foodId as string)

/** The ingredients already ticked off on the pot's panel. */
const doneParts = (s: FeedTestState): string[] =>
  (s.kitchen?.recipePanel?.cells ?? [])
    .filter((c) => c.kind === 'part' && c.done)
    .map((c) => c.foodId as string)

test('feed: a dish round shows two panels — the recipe on the pot, the dish on the friend', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  await forceKindSettled(page, 'dish')
  const s = await pollState(
    page,
    'pot up with its recipe panel',
    (now) => now.kitchen?.recipePanel != null,
  )
  const panel = s.kitchen!.recipePanel!
  const bubble = s.bubbleBox

  // 1. BOTH panels are up at the same time.
  expect(s.bubbleTiles).toBe(1)
  expect(panel.cells.length).toBeGreaterThan(0)

  // 2. The friend's bubble holds exactly the finished dish — nothing else.
  expect(s.bubbleFoodIds).toEqual([s.kitchen!.result])

  // 3. The pot's panel holds the ingredients, in recipe order, as an equation:
  //    part (+ part)* = result. `+` and `=` are drawn glyphs, so they carry no
  //    food of their own.
  expect(recipeParts(s)).toEqual(s.kitchen!.ingredients)
  const equation = `${s.kitchen!.ingredients.map(() => 'part').join(' plus ')} equals result`
  expect(panel.cells.map((c) => c.kind).join(' ')).toBe(equation)
  expect(panel.cells.filter((c) => c.kind === 'result').map((c) => c.foodId)).toEqual([
    s.kitchen!.result,
  ])
  expect(panel.cells.filter((c) => c.foodId === null).every((c) => c.kind !== 'part')).toBe(true)
  // Nothing is ticked off before the child has cooked anything.
  expect(doneParts(s)).toEqual([])

  // 4. The two panels do not collide, and the recipe reads at a legible size.
  const gap = Math.abs(panel.yCss - bubble.yCss) - panel.hCss / 2 - bubble.hCss / 2
  const sideBySide =
    Math.abs(panel.xCss - bubble.xCss) - panel.wCss / 2 - bubble.wCss / 2 > 0 || gap > 0
  expect(sideBySide, 'the recipe panel never lands on the friend’s bubble').toBe(true)
  expect(panel.tileCss).toBeGreaterThanOrEqual(36)

  // 5. The recipe panel hugs the pot — the picture-language link between the
  //    task and the thing it belongs to.
  const potGap = Math.abs(panel.yCss - s.kitchen!.potCss.y) - panel.hCss / 2
  expect(potGap).toBeLessThan(panel.hCss * 2)

  // 6. Every cell is on screen.
  const viewport = page.viewportSize()!
  expect(panel.xCss - panel.wCss / 2).toBeGreaterThan(0)
  expect(panel.xCss + panel.wCss / 2).toBeLessThanOrEqual(viewport.width)
  for (const cell of panel.cells) {
    expect(cell.xCss - cell.sizeCss / 2).toBeGreaterThanOrEqual(panel.xCss - panel.wCss / 2 - 1)
    expect(cell.xCss + cell.sizeCss / 2).toBeLessThanOrEqual(panel.xCss + panel.wCss / 2 + 1)
  }

  await page.screenshot({ path: 'e2e/__screenshots__/feed-dish-two-panels.png' })
})

for (const kind of ['dish', 'dish-ordered'] as const) {
  test(`feed: a ${kind} round is cooked in the pot, then fed`, async ({ page }) => {
    await page.goto('./#/feed-the-monster')
    await waitForReady(page)
    await waitTraySettled(page)
    await page.evaluate(() => window.__feedTheMonster!.setRandomBigBite(false))

    await forceKindSettled(page, kind)
    const s0 = await pollState(page, 'pot on the table', (s) => s.kitchen !== null)
    expect(s0.taskKind).toBe(kind)
    expect(s0.kitchen!.ordered).toBe(kind === 'dish-ordered')
    expect(s0.kitchen!.ingredients.length).toBeGreaterThanOrEqual(2)
    expect(s0.kitchen!.contents).toEqual([])
    expect(s0.kitchen!.madeDish).toBeNull()
    // The round's two asks live on two panels: the RECIPE hangs over the pot…
    expect(recipeParts(s0)).toEqual(s0.kitchen!.ingredients)
    // …and the friend's bubble holds only the finished dish.
    expect(s0.bubbleFoodIds).toEqual([s0.kitchen!.result])
    // Every part the recipe needs is on the tray, and the RESULT is not.
    for (const part of s0.kitchen!.ingredients) {
      expect(s0.foods.map((f) => f.foodId)).toContain(part)
    }
    // The made dish is the only thing the mouth accepts, so a spare one on the
    // tray would let the child skip the pot entirely.
    expect(s0.foods.map((f) => f.foodId)).not.toContain(s0.kitchen!.result)
    expect(
      s0.foods.some((f) => f.correct),
      'nothing on the tray is feedable yet',
    ).toBe(false)
    await page.screenshot({ path: `e2e/__screenshots__/feed-${kind}.png` })

    // The friend refuses a raw part — the same spit-back the child already knows.
    const raw = s0.foods.find((f) => s0.kitchen!.ingredients.includes(f.foodId))!
    await dragToMouth(page, raw)
    await pollState(page, 'raw part refused', (s) => s.spitBacks >= 1, 20_000)
    expect((await readState(page)).kitchen!.contents).toEqual([])
    await pollState(page, 'tray restored', (s) => s.foods.length === 8, 20_000)

    // Now cook it: drop each wanted part into the pot.
    for (let guard = 0; guard < 8; guard++) {
      const s = await readState(page)
      if (!s.kitchen || s.kitchen.madeDish !== null) break
      const want = s.kitchen.wants[0]
      const food = s.foods.find((f) => f.foodId === want)
      if (!food) {
        await keepAwake(page)
        await page.waitForTimeout(400)
        continue
      }
      const inBefore = s.kitchen.contents.length
      await dragToPoint(page, food, { x: s.kitchen.potCss.x, y: s.kitchen.potCss.y })
      const after = await pollState(
        page,
        `part ${want} went in`,
        (now) => (now.kitchen?.contents.length ?? 0) > inBefore || now.kitchen?.madeDish !== null,
        15_000,
      )
      // Progress is marked on the POT's panel (the parts are cooked, never
      // eaten) — the ✓ lands on the part that just went in. Not checked for the
      // LAST part: that one finishes the recipe, and the panel bows out with the
      // dish popping out of the pot (which the assertions below prove instead).
      const full = (after.kitchen?.contents.length ?? 0) >= (after.kitchen?.ingredients.length ?? 0)
      if (!full && after.kitchen?.recipePanel) {
        await pollState(
          page,
          `part ${want} ticked off on the pot's panel`,
          (now) => doneParts(now).includes(want),
          10_000,
        )
      }
    }

    const cooked = await pollState(
      page,
      'dish popped out of the pot',
      (s) => s.kitchen?.madeDish !== null,
      20_000,
    )
    expect(cooked.kitchen!.contents.length).toBe(cooked.kitchen!.ingredients.length)
    await page.screenshot({ path: `e2e/__screenshots__/feed-${kind}-cooked.png` })

    // …and feeding the made dish completes the round.
    const startRound = cooked.round
    const made = await pollState(
      page,
      'made dish is draggable',
      (s) => s.foods.some((f) => f.foodId === s.kitchen?.madeDish),
      20_000,
    )
    const dish = made.foods.find((f) => f.foodId === made.kitchen!.madeDish)!
    expect(dish.correct, 'the cooked dish is the one thing the mouth wants').toBe(true)
    await dragToMouth(page, dish)
    await pollState(page, 'round completed by the made dish', (s) => s.round > startRound, 45_000)
  })
}

test('feed: an ordered kitchen round refuses a part offered out of turn', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  await forceKindSettled(page, 'dish-ordered')
  const s = await pollState(
    page,
    'ordered pot with more than one part left',
    (state) => (state.kitchen?.ingredients.length ?? 0) >= 2,
  )
  expect(s.kitchen!.wants, 'an ordered round wants exactly one part at a time').toHaveLength(1)
  // The order to follow is written on the POT's panel, left to right, and the
  // one the pot wants next is the first part not yet ticked off.
  expect(recipeParts(s)).toEqual(s.kitchen!.ingredients)
  expect(recipeParts(s)[doneParts(s).length]).toBe(s.kitchen!.wants[0])

  // The LAST part is not the next one, so the pot must spit it back.
  const wrong = s.kitchen!.ingredients[s.kitchen!.ingredients.length - 1]
  expect(wrong).not.toBe(s.kitchen!.wants[0])
  const food = s.foods.find((f) => f.foodId === wrong)!
  await dragToPoint(page, food, { x: s.kitchen!.potCss.x, y: s.kitchen!.potCss.y })
  await pollState(page, 'out-of-turn part spat back', (now) => now.spitBacks >= 1, 20_000)
  expect((await readState(page)).kitchen!.contents).toEqual([])
  // …and nothing was ticked off on the recipe: a refusal marks no progress.
  expect(doneParts(await readState(page))).toEqual([])
  // Nothing is lost: the part arcs home and the tray stays whole.
  await pollState(page, 'tray whole after the refusal', (now) => now.foods.length === 8, 20_000)
})

// ─── The thief ────────────────────────────────────────────────────────────────

test('feed: tapping the thief shoos it and the tray stays whole', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  const started = await page.evaluate(() => window.__feedTheMonster!.forceVisitor('thief'))
  expect(started).toBe(true)
  const visit = await pollState(page, 'thief telegraphed', (s) => s.visitor !== null)
  expect(visit.visitor!.kind).toBe('thief')
  // The telegraph is mandatory: nothing appears on a plate without warning.
  expect(['telegraph', 'approach']).toContain(visit.visitor!.phase)
  const before = await readState(page)
  const targeted = before.visitor!.foodId

  const perched = await pollState(
    page,
    'thief perched and pecking',
    (s) => s.visitor?.phase === 'peck',
    20_000,
  )
  expect(perched.visitor!.msLeft).toBeGreaterThan(0)
  await page.screenshot({ path: 'e2e/__screenshots__/feed-thief.png' })

  // Tap it inside the window.
  await page.mouse.move(perched.visitor!.xCss, perched.visitor!.yCss)
  await page.mouse.down()
  await page.mouse.up()
  await pollState(page, 'thief shooed off', (s) => s.visitor === null, 20_000)

  // Nothing was stolen: the targeted food is still on the tray, tray still full.
  const after = await pollState(page, 'tray whole', (s) => s.foods.length === 8, 20_000)
  expect(after.foods.map((f) => f.foodId)).toContain(targeted)
  expect(after.transitioning).toBe(false)
})

test('feed: an ignored thief steals the food, a replacement arrives, the round still completes', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)
  await page.evaluate(() => window.__feedTheMonster!.setRandomBigBite(false))

  expect(await page.evaluate(() => window.__feedTheMonster!.forceVisitor('thief'))).toBe(true)
  await pollState(page, 'thief on stage', (s) => s.visitor !== null)
  // Do nothing at all — let the peck window lapse.
  await pollState(page, 'thief left with the food', (s) => s.visitor === null, 30_000)

  // Rule 2: stolen food is ALWAYS replaced, so the round stays completable.
  const after = await pollState(page, 'plate refilled', (s) => s.foods.length === 8, 30_000)
  expect(
    after.foods.some((f) => f.correct),
    'a correct food is still reachable',
  ).toBe(true)
  await waitTraySettled(page)
  await feedRound(page)
})

test('feed: the butterfly takes nothing, whether it is tapped or left alone', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  expect(await page.evaluate(() => window.__feedTheMonster!.forceVisitor('butterfly'))).toBe(true)
  const visit = await pollState(page, 'butterfly on stage', (s) => s.visitor !== null)
  expect(visit.visitor!.kind).toBe('butterfly')
  const trayBefore = (await readState(page)).foods.length
  await pollState(
    page,
    'butterfly fluttering on the plate',
    (s) => s.visitor?.phase === 'peck',
    25_000,
  )
  await page.screenshot({ path: 'e2e/__screenshots__/feed-butterfly.png' })

  // Leave it entirely alone: it must fly off having taken nothing.
  await pollState(page, 'butterfly left on its own', (s) => s.visitor === null, 30_000)
  const after = await pollState(
    page,
    'tray untouched',
    (s) => s.foods.length === trayBefore,
    20_000,
  )
  expect(after.foods.length).toBe(trayBefore)

  // And tapping it is not punished either — the tray is still whole afterwards.
  expect(await page.evaluate(() => window.__feedTheMonster!.forceVisitor('butterfly'))).toBe(true)
  const second = await pollState(
    page,
    'second butterfly perched',
    (s) => s.visitor?.phase === 'peck',
    25_000,
  )
  await page.mouse.move(second.visitor!.xCss, second.visitor!.yCss)
  await page.mouse.down()
  await page.mouse.up()
  await pollState(page, 'tapped butterfly left', (s) => s.visitor === null, 20_000)
  expect((await readState(page)).foods.length).toBe(trayBefore)
})

/** What an armed air-tap saw, and what it did. */
interface AirTap {
  /** The visit reached its end (the visitor left the stage). */
  ended: boolean
  /** Taps issued — one at most, exactly like a child's single shot at it. */
  taps: number
  /** Visit phase at the instant the tap was pressed. */
  phaseAtTap: string
  yAtTap: number
  tapRadiusCss: number
  /** How far off the bird's centre the press was aimed, in css px. */
  aimedOffCentreCss: number
  /** Was the visitor EVER seen on the plate (the peck phase)? */
  perched: boolean
  /** Did the tray ever lose a food (i.e. was anything stolen)? */
  trayDipped: boolean
}

/**
 * Arm an in-page frame loop that taps the visitor the instant it is in the air over
 * the table, then reports what the whole visit did.
 *
 * Why the tap is dispatched in-page instead of through `page.mouse`: a
 * read-then-tap over CDP costs ~150 ms of round trips, and this harness's clock
 * advances in bursts around input (see keepAwake), so the bird can travel 200 css px
 * — 3× its hit circle — between the read and the press, which no finger ever does.
 * Fired from a frame callback, the press lands on the coordinates it was aimed at.
 * It is still the real input path: a DOM `mousedown` on the game canvas, which
 * Phaser hit-tests synchronously against the live sprite exactly as it does a
 * finger's (`InputManager.onMouseDown` → `updateInputPlugins`). Only ONE press is
 * ever issued, so a hit area that does not cover the flying bird fails the test
 * rather than being sprayed at until something lands.
 *
 * The press is aimed deliberately OFF the bird's centre — high, the way a finger
 * lags a target that is still descending — so it also proves the circle is as wide
 * as the game reports, not just that a bullseye works.
 *
 * The test still nudges the mouse from outside to keep frames coming; this loop only
 * decides where and when to press.
 */
const armAirTap = (page: Page, at: { trayYCss: number; wCss: number }): Promise<void> =>
  page.evaluate((a) => {
    const canvas = document.querySelector('canvas')!
    const seen = {
      started: false,
      ended: false,
      taps: 0,
      phaseAtTap: '',
      yAtTap: 0,
      tapRadiusCss: 0,
      aimedOffCentreCss: 0,
      perched: false,
      trayDipped: false,
    }
    ;(window as unknown as { __airTap: typeof seen }).__airTap = seen
    const tick = (): void => {
      const s = window.__feedTheMonster?.state()
      if (!s) return
      const v = s.visitor
      if (v !== null) seen.started = true
      if (v?.phase === 'peck') seen.perched = true
      if (s.foods.length < 8) seen.trayDipped = true
      if (seen.started && v === null) {
        seen.ended = true
        return
      }
      // Still flying, and its centre is on the glass — a press a finger could make.
      if (v !== null && seen.taps === 0 && v.phase === 'approach' && v.xCss < a.wCss - 24) {
        // 85 % of the way to the circle's edge, and HIGH — the way a finger lags a
        // target that is still descending. Past the sprite's own half-height, so a
        // hit proves the game's reported tap circle is really the hit area.
        const offCentre = v.tapRadiusCss * 0.85
        seen.taps++
        seen.phaseAtTap = v.phase
        seen.yAtTap = v.yCss
        seen.tapRadiusCss = v.tapRadiusCss
        seen.aimedOffCentreCss = offCentre
        const init = {
          bubbles: true,
          cancelable: true,
          clientX: v.xCss,
          clientY: v.yCss - offCentre,
          button: 0,
        }
        canvas.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }))
        canvas.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }))
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, at)

const readAirTap = (page: Page): Promise<AirTap> =>
  page.evaluate(() => (window as unknown as { __airTap: AirTap }).__airTap)

test('feed: the thief can be shooed in mid-air, before it ever reaches the plate', async ({
  page,
}) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  const tray = await waitTraySettled(page)
  const trayYCss = tray.foods[0].yCss
  const wCss = page.viewportSize()!.width

  expect(await page.evaluate(() => window.__feedTheMonster!.forceVisitor('thief'))).toBe(true)
  const visit = await pollState(page, 'thief telegraphed', (s) => s.visitor !== null)
  const targeted = visit.visitor!.foodId

  // One press, once the bird is on screen and still gliding.
  await armAirTap(page, { trayYCss, wCss })
  let air = await readAirTap(page)
  const deadline = Date.now() + 40_000
  while (!air.ended && Date.now() < deadline) {
    await keepAwake(page) // input is what keeps frames — and the glide — coming
    air = await readAirTap(page)
  }

  expect(air.taps, 'the bird was never found in the air to tap').toBe(1)
  // The state at the instant of the press: still flying in, not on the plate.
  expect(air.phaseAtTap).toBe('approach')
  expect(air.yAtTap, 'the press was not above the plate row').toBeLessThan(trayYCss - 20)
  // The target it offered a finger mid-flight is a real ~2.7 cm circle: the press
  // landed near that circle's edge, not on the bird's centre.
  expect(air.tapRadiusCss).toBeGreaterThanOrEqual(VISITOR_TAP_MIN_CSS)
  expect(air.aimedOffCentreCss).toBeGreaterThan(air.tapRadiusCss * 0.8)
  // The proof the press is what ended the visit: an untapped visitor always reaches
  // the plate (the peck window runs 1.5–3 s — unmissable at frame rate), and this
  // one never did. Nothing may be taken from the tray either.
  expect(air.perched, 'the thief reached the plate — the in-flight tap did nothing').toBe(false)
  expect(air.trayDipped, 'the tray lost a food to a thief that was tapped in flight').toBe(false)

  // Same consequences as a perched tap: nothing taken, tray whole, round intact.
  const after = await pollState(page, 'tray whole', (s) => s.foods.length === 8, 20_000)
  expect(after.foods.map((f) => f.foodId)).toContain(targeted)
  expect(after.visitor).toBeNull()
  expect(after.transitioning).toBe(false)
})

// ─── The food the child drew ──────────────────────────────────────────────────

test('feed: a commissioned drawing becomes a food and is eaten on the spot', async ({ page }) => {
  await page.goto('./#/feed-the-monster?e2e')
  await waitForReady(page)
  await waitTraySettled(page)
  await page.evaluate(() => window.__feedTheMonster!.setRandomBigBite(false))
  await page.evaluate(() => window.__feedTheMonster!.wipeDrawnFoods())

  expect(await page.evaluate(() => window.__feedTheMonster!.forceCommission())).toBe(true)
  const open = await pollState(page, 'commission open', (s) => s.commission !== null)
  expect(open.commission!.color).toBeTruthy()
  // No round is dealt while the pad is up — the friend is waiting to be given
  // something, not to be fed from a tray.
  expect(open.foods).toHaveLength(0)
  await page.screenshot({ path: 'e2e/__screenshots__/feed-commission.png' })

  // Paint something (a synthetic drawing — a spec should not have to paint 40
  // cells by hand) and hand it over.
  const submitted = await page.evaluate(() =>
    window.__feedTheMonster!.submitDrawing([
      { x: 6, y: 6, color: 3 },
      { x: 7, y: 6, color: 3 },
      { x: 6, y: 7, color: 3 },
      { x: 7, y: 7, color: 3 },
    ]),
  )
  expect(submitted).toBe(true)

  const dealt = await pollState(
    page,
    'the drawing landed on the tray as a food',
    (s) => s.commission === null && s.drawnFoodIds.length === 1 && s.foods.length === 8,
    30_000,
  )
  const drawnId = dealt.drawnFoodIds[0]
  expect(dealt.foods.map((f) => f.foodId)).toContain(drawnId)
  const drawn = dealt.foods.find((f) => f.foodId === drawnId)!
  expect(drawn.correct, 'the child’s drawing is exactly what the friend wants now').toBe(true)
  await waitTraySettled(page)

  // …and it is eaten, right now, which is the whole emotional payload.
  const startRound = (await readState(page)).round
  const target = (await readState(page)).foods.find((f) => f.foodId === drawnId)!
  await dragToMouth(page, target)
  await pollState(page, 'the friend ate the drawing', (s) => s.round > startRound, 45_000)

  // It survives a reload: a drawn food is a food from now on.
  await page.reload()
  await waitForReady(page)
  const resumed = await waitTraySettled(page)
  expect(resumed.drawnFoodIds).toContain(drawnId)
})

test('feed: the friend asks for a drawing BEFORE the easel arrives', async ({ page }) => {
  await page.goto('./#/feed-the-monster?e2e')
  await waitForReady(page)
  await waitTraySettled(page)
  await page.evaluate(() => window.__feedTheMonster!.wipeDrawnFoods())

  // The pad is a DOM overlay, so "has it arrived?" is literally "is its hook up?".
  expect(await page.evaluate(() => window.__pixelPad === undefined)).toBe(true)
  expect(await page.evaluate(() => window.__feedTheMonster!.forceCommission())).toBe(true)

  // The ASK comes first, alone: the request bubble is showing it, the tray is
  // cleared, and the easel is nowhere yet. This ordering is the whole point —
  // opening the pad on the same frame as the ask is what made the beat read as
  // arbitrary, because the child never saw anybody ask.
  const asking = await readState(page)
  expect(asking.commission).not.toBeNull()
  expect(asking.commission!.phase).toBe('asking')
  expect(asking.foods, 'nothing to feed — the friend wants something MADE').toHaveLength(0)
  expect(asking.bubbleTiles, 'the ask is on screen').toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__pixelPad === undefined)).toBe(true)

  // …and only then does the easel rise.
  await page.waitForFunction(() => window.__pixelPad !== undefined, undefined, { timeout: 10_000 })
  const drawing = await readState(page)
  expect(drawing.commission!.phase).toBe('drawing')

  // It really is an easel, not a bare square: this viewport is an iPad, which is
  // roomy enough for the full frame + ledge + legs.
  const pad = await page.evaluate(() => window.__pixelPad!.state())
  expect(pad.easel, 'the pad wears its frame on an iPad-sized box').not.toBeNull()
  expect(pad.easel!.border).toBeGreaterThan(0)
  expect(pad.easel!.ledge).toBeGreaterThan(pad.easel!.border)

  await dismissCommission(page)
})

test('feed: closing the pad blank costs nothing — the round just proceeds', async ({ page }) => {
  await page.goto('./#/feed-the-monster?e2e')
  await waitForReady(page)
  await waitTraySettled(page)
  await page.evaluate(() => window.__feedTheMonster!.wipeDrawnFoods())

  expect(await page.evaluate(() => window.__feedTheMonster!.forceCommission())).toBe(true)
  await pollState(page, 'commission open', (s) => s.commission !== null)

  // An empty grid: the plate fills with an ordinary food and play continues.
  expect(await page.evaluate(() => window.__feedTheMonster!.submitDrawing([]))).toBe(true)
  const after = await pollState(
    page,
    'an ordinary round was dealt instead',
    (s) => s.commission === null && s.foods.length === 8,
    30_000,
  )
  expect(after.drawnFoodIds).toHaveLength(0)
  await waitTraySettled(page)
  expect((await readState(page)).foods.some((f) => f.correct)).toBe(true)
  await feedRound(page)
})

// ─── The `?dev` panel ─────────────────────────────────────────────────────────

/**
 * The reported bug, from the device: "sometimes the ?dev panel stops responding —
 * often when there are two friends to feed and I press belt, after that no button
 * works". Two defects met there, and this pins both:
 *
 *  1. A duo starting while a belt round was on stage left the belt RIDING
 *     underneath it (`conveyorMode.stop()` used to live inside the next round's
 *     belt gate, which a duo returns before reaching). The tray's home was still a
 *     belt lane, so a duo food spat back was adopted onto a plate and destroyed
 *     when that lane wrapped — a duo missing a food it needs can never finish, and
 *     an unfinished duo never gives `round` back.
 *  2. Every dev force is gated on a live round, and a duo (or a drawing ask) nulls
 *     it — so the whole overlay was a silent no-op for as long as one ran.
 *
 * Driven through the real DOM buttons, because the panel is the thing that broke.
 */
test('feed: the ?dev panel answers every tap, mid-duo and mid-ask', async ({ page }) => {
  await page.goto('./#/feed-the-monster?dev')
  await waitForReady(page)
  await waitTraySettled(page)

  const tap = (label: string) => page.locator('button', { hasText: label }).first().click()

  // A belt round, then a duo straight on top of it: the belt must be stood down.
  await startConveyor(page)
  await tap('Duo')
  const duo = await pollState(page, 'duo on stage', (s) => s.duoActive)
  expect(duo.conveyorActive, 'no belt is left riding under a duo').toBe(false)
  expect(duo.conveyor, 'and it kept no lanes').toBeNull()

  // Mid-duo the panel still answers: Belt hands the stage back to a belt round.
  await tap('Belt')
  const belt = await pollState(page, 'belt round from mid-duo', (s) => s.conveyorActive)
  expect(belt.duoActive, 'the duo was stood down, not stacked').toBe(false)
  expect(belt.round, 'a real round is live again').toBeGreaterThan(0)

  // Mid-ask it answers too: the easel opens, and a task chip withdraws it.
  await tap('Draw')
  await pollState(page, 'the ask is up', (s) => s.commission !== null)
  await tap('count')
  const solo = await pollState(page, 'ask withdrawn for a solo round', (s) => s.taskKind !== null)
  expect(solo.commission, 'the easel is gone').toBeNull()
  expect(solo.conveyorActive, 'and so is the belt').toBe(false)
  // Withdrawing is not spending: the once-per-episode beat can still fire later.
  expect(solo.commissionGate.lastEpisode).toBe(-1)

  // Nothing was left half-dressed: the round it dealt is playable.
  await waitTraySettled(page)
  expect((await readState(page)).foods.some((f) => f.correct)).toBe(true)
})

test('feed: a duo bonus stands up two friends fed from one tray by mouth', async ({ page }) => {
  await page.goto('./#/feed-the-monster')
  await waitForReady(page)
  await waitTraySettled(page)

  // Force a duo (bypasses the data+chance axis so the spec sees one on demand).
  const started = await page.evaluate(() => window.__feedTheMonster!.forceDuo())
  expect(started).toBe(true)
  await pollState(
    page,
    'duo on stage',
    (s) => s.duoActive && s.duo !== null && s.duo.sides.length === 2,
  )
  await waitTraySettled(page) // duo tray dropped in — grab resting foods, not mid-bounce

  // Two distinct friends, each with its own food + mouth, one shared tray.
  const s0 = await readState(page)
  expect(s0.duo!.sides).toHaveLength(2)
  expect(s0.duo!.sides[0].foodId).not.toBe(s0.duo!.sides[1].foodId)
  expect(s0.duo!.sides[0].mouthCss.x).toBeLessThan(s0.duo!.sides[1].mouthCss.x) // left, right
  await page.screenshot({ path: 'e2e/__screenshots__/feed-duo.png' })

  // The core new mechanic: a food dropped on a mouth feeds THAT friend only.
  // Feed each side one correct food; the drop must register on that same side
  // (its eaten grew) — or, for the second mouth, roll the round over, which also
  // means the drop was accepted, not spat back. (Full 3-round growth + walk-off
  // is covered by journey.test's duoFeedStep/duoComplete; feeding it live here
  // would run ~130s on a loaded box.)
  for (const index of [0, 1] as const) {
    const s = await readState(page)
    if (!s.duoActive || !s.duo) break
    const before = s.duo.sides[index].eaten
    const stepBefore = s.duo.step
    const food = s.foods.find((f) => f.foodId === s.duo!.sides[index].foodId)
    expect(food, `a tray food for mouth ${index} must exist`).toBeTruthy()
    await dragToPoint(page, food!, {
      x: s.duo.sides[index].mouthCss.x,
      y: s.duo.sides[index].mouthCss.y,
    })
    // Resolving proves the drop landed on the correct friend (a wrong-mouth or
    // spat-back drop would leave eaten and step unchanged → timeout).
    await pollState(
      page,
      `mouth ${index} fed`,
      (now) =>
        !now.duoActive ||
        (now.duo?.step ?? -1) !== stepBefore ||
        (now.duo?.sides[index]?.eaten ?? 0) > before,
      15_000,
    )
    if (index === 0) await waitTraySettled(page).catch(() => undefined)
  }
})
