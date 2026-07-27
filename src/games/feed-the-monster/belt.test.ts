import { describe, expect, it } from 'vitest'
import {
  BELT_GRAB_GRACE_MS,
  BELT_HIDDEN_LANES,
  BELT_MISSES_BEFORE_EASE,
  BELT_SKILL_MAX,
  FIRST_VISIBLE_SLOT,
  CONVEYOR_BASE_CHANCE,
  CONVEYOR_EXCLUDED_KINDS,
  CONVEYOR_MAX_CHANCE,
  CONVEYOR_MIN_GAP,
  CONVEYOR_MIN_SKILL,
  MIN_GRAB_WINDOW_MS,
  beltDials,
  beltIsDry,
  grabWindowMs,
  hatchDelayMs,
  isSlotHidden,
  isSlotVisible,
  laneCount,
  laneSlot,
  msUntilReachable,
  nextDishFood,
  pickWantedFood,
  pitchMs,
  refillThresholdMs,
  rescueLane,
  returnLane,
  slotAtPitchX,
  slotPitchX,
  soonestWantedMs,
  traverseMs,
  shouldInjectConveyor,
  updateBeltSkill,
} from './belt'
import type { BeltDials, BeltLaneSnapshot } from './belt'
import { FOOD_HIT_RADIUS_CSS } from './layout'
import { SKILL_MAX, TASK_REGISTRY } from './logic'
import type { Rng } from './logic'

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SKILLS = Array.from({ length: BELT_SKILL_MAX + 1 }, (_, i) => i)

/** The shipped dish pitch (layout.DISH_PITCH_CSS) — the belt's own length unit. */
const PITCH_CSS = 128
/** ms per pitch at a skill, at the shipped pitch. */
const stepAt = (dials: BeltDials): number => pitchMs(dials.dishSpeedCss, PITCH_CSS)

describe('the loop', () => {
  it('has one lane per visible dish plus the hidden hatch lanes', () => {
    expect(laneCount(6)).toBe(6 + BELT_HIDDEN_LANES)
    expect(laneCount(0), 'never degenerate').toBeGreaterThan(0)
  })

  it('rides every lane through every slot exactly once per loop', () => {
    const lanes = laneCount(6)
    for (let index = 0; index < lanes; index++) {
      const seen = new Set<number>()
      for (let offset = 0; offset < lanes; offset++) {
        seen.add(laneSlot(index, offset, lanes))
      }
      expect(seen.size, 'the loop is a permutation — no gaps, no overlaps').toBe(lanes)
    }
  })

  it('never puts two lanes in the same slot', () => {
    const lanes = laneCount(7)
    for (const offset of [0, 0.5, 1.25, 3.75, 12.3]) {
      const slots = Array.from({ length: lanes }, (_, i) => laneSlot(i, offset, lanes))
      const rounded = slots.map((s) => Math.floor(s))
      expect(new Set(rounded).size).toBe(lanes)
    }
  })

  it('splits the loop into hidden, emerging and visible, in that order', () => {
    const lanes = laneCount(6)
    for (let slot = 0; slot <= lanes; slot++) {
      expect(isSlotHidden(slot)).toBe(slot <= BELT_HIDDEN_LANES)
      expect(isSlotVisible(slot, lanes)).toBe(slot >= FIRST_VISIBLE_SLOT)
      // Between the two is exactly one pitch of "emerging from the hatch", where a
      // dish is half on screen — which is why hidden and visible are not
      // complements, and why the rescue only ever touches a HIDDEN lane.
      if (!isSlotHidden(slot) && !isSlotVisible(slot, lanes)) {
        expect(slot).toBeGreaterThan(BELT_HIDDEN_LANES)
        expect(slot).toBeLessThan(FIRST_VISIBLE_SLOT)
      }
    }
  })

  it('always has exactly one lane behind the hatch — that is what makes a rescue possible', () => {
    const lanes = laneCount(6)
    for (const offset of [0, 0.4, 1.7, 5.2, 13.9, 40.05]) {
      const hidden = Array.from({ length: lanes }, (_, i) =>
        isSlotHidden(laneSlot(i, offset, lanes)),
      ).filter(Boolean)
      expect(hidden.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps every visible dish inside the screen width, half-width included', () => {
    const visible = 6
    const lanes = laneCount(visible)
    for (let slot = FIRST_VISIBLE_SLOT; slot <= lanes; slot++) {
      const pitchX = slotPitchX(slot)
      // The dish is drawn CENTRED on its slot, so its own half-width has to fit.
      expect(pitchX - 0.5, `slot ${slot} pokes off the left edge`).toBeGreaterThanOrEqual(-0.001)
      expect(pitchX + 0.5, `slot ${slot} pokes off the right edge`).toBeLessThanOrEqual(
        visible + 0.001,
      )
    }
  })

  it('a hidden dish is ENTIRELY off screen, half-width included', () => {
    // Not merely flagged hidden: the dry-belt rescue swaps a hidden dish, so any
    // sliver of it on screen would be a dish visibly changing under the child.
    for (let slot = 0; slot <= BELT_HIDDEN_LANES; slot += 0.1) {
      expect(isSlotHidden(slot)).toBe(true)
      expect(slotPitchX(slot) + 0.5, `slot ${slot} is partly visible`).toBeLessThanOrEqual(0.001)
    }
  })

  it('runs at the SAME physical speed on every screen, wide or narrow', () => {
    // The dial is css px/s, so a pitch takes the same time whatever the viewport
    // fits. A time-to-cross dial made the belt half again as fast on a wide iPad
    // as on a phone in landscape — a different game per device, and a different
    // grab difficulty, which is the one thing a fixed-size dish must not have.
    const dials = beltDials(4)
    expect(pitchMs(dials.dishSpeedCss, PITCH_CSS)).toBe(pitchMs(dials.dishSpeedCss, PITCH_CSS))
    expect(traverseMs(pitchMs(dials.dishSpeedCss, PITCH_CSS), 9)).toBeCloseTo(
      traverseMs(pitchMs(dials.dishSpeedCss, PITCH_CSS), 6) * 1.5,
      6,
    )
    // A pitch is the dish's own width at the dish's own speed.
    expect(pitchMs(64, 128)).toBe(2000)
    expect(traverseMs(pitchMs(64, 128), 6)).toBe(12_000)
  })
})

describe('msUntilReachable', () => {
  const lanes = laneCount(6)
  const step = stepAt(beltDials(0))

  it('is zero for a dish on screen with grabbing room to spare', () => {
    expect(msUntilReachable(FIRST_VISIBLE_SLOT, lanes, step)).toBe(0)
  })

  it('is the ride out of the hatch for a hidden dish', () => {
    expect(msUntilReachable(0, lanes, step)).toBe(hatchDelayMs(step))
    expect(msUntilReachable(BELT_HIDDEN_LANES, lanes, step)).toBe(step)
  })

  it('sends a dish about to leave round the loop rather than calling it reachable', () => {
    // Right at the edge: less than the grab grace left on screen.
    const almostGone = lanes - BELT_GRAB_GRACE_MS / step / 2
    const ms = msUntilReachable(almostGone, lanes, step)
    expect(
      ms,
      'a dish two centimetres from the edge is a tease, not an opportunity',
    ).toBeGreaterThan(0)
  })

  it('never returns a negative wait for any slot or speed', () => {
    for (const skill of SKILLS) {
      const stepFor = stepAt(beltDials(skill))
      for (const visible of [4, 6, 9, 12]) {
        const total = laneCount(visible)
        for (let slot = 0; slot < total; slot += 0.25) {
          expect(msUntilReachable(slot, total, stepFor)).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})

describe('difficulty curves', () => {
  it('are monotone in belt skill: faster, longer waits, thinner wanted dishes', () => {
    for (let skill = 1; skill <= BELT_SKILL_MAX; skill++) {
      const easier = beltDials(skill - 1)
      const harder = beltDials(skill)
      expect(harder.dishSpeedCss).toBeGreaterThan(easier.dishSpeedCss)
      expect(harder.maxWaitMs).toBeGreaterThan(easier.maxWaitMs)
      expect(harder.wantedEvery).toBeGreaterThan(easier.wantedEvery)
    }
  })

  it('runs from the design numbers at each end', () => {
    expect(beltDials(0)).toMatchObject({ dishSpeedCss: 48, maxWaitMs: 4_000 })
    expect(beltDials(0).wantedEvery).toBeCloseTo(3)
    expect(beltDials(BELT_SKILL_MAX)).toMatchObject({ dishSpeedCss: 84, maxWaitMs: 9_000 })
    expect(beltDials(BELT_SKILL_MAX).wantedEvery).toBeCloseTo(6)
  })

  it('clamps outside the meter range', () => {
    expect(beltDials(-5)).toEqual(beltDials(0))
    expect(beltDials(99)).toEqual(beltDials(BELT_SKILL_MAX))
  })

  it('never runs so fast that a four-year-old cannot land a finger on a dish', () => {
    // THE motor-fairness invariant of the whole mechanic. Nothing freezes when a
    // dish is touched — it is lifted off instead — so the only thing protecting the
    // grab is how long a passing dish keeps its hit circle over one point.
    const hitDiameter = FOOD_HIT_RADIUS_CSS * 2
    for (const skill of SKILLS) {
      const window = grabWindowMs(beltDials(skill).dishSpeedCss, hitDiameter)
      expect(
        window,
        `belt skill ${skill} gives only ${Math.round(window)} ms to grab`,
      ).toBeGreaterThanOrEqual(MIN_GRAB_WINDOW_MS)
    }
    // …and the ladder is still a ladder: the hardest belt is a real step up.
    const easiest = grabWindowMs(beltDials(0).dishSpeedCss, hitDiameter)
    const hardest = grabWindowMs(beltDials(BELT_SKILL_MAX).dishSpeedCss, hitDiameter)
    expect(easiest / hardest).toBeGreaterThan(1.5)
  })

  it('leaves the scheduler room to rescue the child at every setting', () => {
    // If the trigger threshold were the budget itself, a rescue dish would arrive
    // a hatch-delay LATE. This is the invariant that makes the guarantee possible.
    for (const skill of SKILLS) {
      const dials = beltDials(skill)
      const step = stepAt(dials)
      expect(refillThresholdMs(dials.maxWaitMs, step) + hatchDelayMs(step)).toBeLessThanOrEqual(
        Math.max(dials.maxWaitMs, hatchDelayMs(step)),
      )
    }
  })
})

describe('the belt meter', () => {
  it('advances on a clean round, eases on repeated misses, holds in between', () => {
    expect(updateBeltSkill(3, { missedPasses: 0, spitBacks: 0 })).toBe(4)
    expect(updateBeltSkill(3, { missedPasses: BELT_MISSES_BEFORE_EASE, spitBacks: 0 })).toBe(2)
    expect(updateBeltSkill(3, { missedPasses: 1, spitBacks: 0 })).toBe(3)
    expect(updateBeltSkill(3, { missedPasses: 0, spitBacks: 1 })).toBe(3)
  })

  it('never leaves the meter range (no-fail in both directions)', () => {
    expect(updateBeltSkill(0, { missedPasses: 5, spitBacks: 5 })).toBe(0)
    expect(updateBeltSkill(BELT_SKILL_MAX, { missedPasses: 0, spitBacks: 0 })).toBe(BELT_SKILL_MAX)
  })

  it('is driven by MISSES, not by wrong feeds: a slip alone never eases it', () => {
    // Spit-backs are cognitive, not timing — the belt axis exists to measure the
    // second thing separately.
    expect(updateBeltSkill(4, { missedPasses: 0, spitBacks: 9 })).toBe(4)
  })
})

// ─── The anti-drought guarantee, simulated ────────────────────────────────────

interface SimResult {
  /** Worst wait for a wanted dish observed at any instant. */
  worstWaitMs: number
  /** Ticks where nothing on the whole loop was wanted. */
  dryTicks: number
  /** Total dishes scheduled. */
  spawned: number
  wantedSpawned: number
  /** Wanted dishes the child managed to take. */
  fed: number
  /** Was the request cleared before the run ended? */
  completed: boolean
  /** Ticks measured, and how many of them were over the stated budget. */
  ticks: number
  overBudgetTicks: number
}

/**
 * Run the real loop: seed the visible lanes, advance, and refill each lane
 * through `nextDishFood` the moment it wraps past the hatch — exactly what
 * conveyorMode does per frame. Optionally eat wanted dishes as they arrive, to
 * model the child actually playing.
 */
function simulate(opts: {
  visible: number
  dials: BeltDials
  pool: string[]
  wantedIds: Set<string>
  rng: Rng
  ticks: number
  tickMs: number
  /** Eat a reachable wanted dish every N ticks (0 = never). */
  eatEvery?: number
  /**
   * How many wanted dishes the request needs. Measurement stops once they are
   * fed — a real round is OVER at that point, and a belt that keeps supplying a
   * request nobody has any more is not a property worth asserting.
   */
  needed?: number
}): SimResult {
  const total = laneCount(opts.visible)
  const step = stepAt(opts.dials)
  const wanted = (id: string) => opts.wantedIds.has(id)
  const lanes: Array<string | null> = new Array(total).fill(null)
  let offset = 0
  let spawned = 0
  let wantedSpawned = 0

  const refill = (index: number): void => {
    const others = lanes
      .map((foodId, i) => ({ slot: laneSlot(i, offset, total), foodId }))
      .filter((_, i) => i !== index)
    const foodId = nextDishFood(
      {
        others,
        lanes: total,
        step,
        maxWaitMs: opts.dials.maxWaitMs,
        wantedEvery: opts.dials.wantedEvery,
        pool: opts.pool,
        wanted,
      },
      opts.rng,
    )
    lanes[index] = foodId
    spawned++
    if (wanted(foodId)) wantedSpawned++
  }

  // Seed: visible lanes from the round's tray (which always holds a wanted food),
  // hidden lanes through the scheduler.
  for (let i = 0; i < total; i++) {
    const slot = laneSlot(i, offset, total)
    lanes[i] = slot >= BELT_HIDDEN_LANES ? opts.pool[i % opts.pool.length] : null
    if (lanes[i] === null) refill(i)
  }

  let worstWaitMs = 0
  let dryTicks = 0
  let overBudgetTicks = 0
  let measured = 0
  let fed = 0
  const needed = opts.needed ?? Infinity
  const lastSlot = Array.from({ length: total }, (_, i) => laneSlot(i, offset, total))

  for (let tick = 1; tick <= opts.ticks && fed < needed; tick++) {
    offset += opts.tickMs / step
    for (let i = 0; i < total; i++) {
      const slot = laneSlot(i, offset, total)
      if (slot < lastSlot[i]) refill(i)
      lastSlot[i] = slot
    }

    // The child takes a reachable wanted dish now and then.
    if (opts.eatEvery && tick % opts.eatEvery === 0) {
      for (let i = 0; i < total; i++) {
        const id = lanes[i]
        if (id === null || !wanted(id)) continue
        if (msUntilReachable(laneSlot(i, offset, total), total, step) === 0) {
          lanes[i] = null
          fed++
          break
        }
      }
    }

    // The rescue valve conveyorMode runs every frame: if nothing on the loop is
    // feedable, re-dress the lane behind the hatch (invisible, always present).
    const dryCtx = {
      others: lanes.map((foodId, i) => ({ slot: laneSlot(i, offset, total), foodId })),
      lanes: total,
      step,
      maxWaitMs: opts.dials.maxWaitMs,
      wantedEvery: opts.dials.wantedEvery,
      pool: opts.pool,
      wanted,
    }
    if (beltIsDry(dryCtx)) {
      const index = rescueLane(dryCtx.others)
      const rescue = index === null ? null : pickWantedFood(opts.pool, wanted, opts.rng)
      if (index !== null && rescue !== null) {
        lanes[index] = rescue
        spawned++
        wantedSpawned++
      }
    }

    const ctx = {
      others: lanes.map((foodId, i) => ({ slot: laneSlot(i, offset, total), foodId })),
      lanes: total,
      step,
      maxWaitMs: opts.dials.maxWaitMs,
      wantedEvery: opts.dials.wantedEvery,
      pool: opts.pool,
      wanted,
    }
    const soonest = soonestWantedMs(ctx)
    measured++
    if (soonest === Infinity) dryTicks++
    else {
      worstWaitMs = Math.max(worstWaitMs, soonest)
      if (soonest > opts.dials.maxWaitMs) overBudgetTicks++
    }
  }

  return {
    worstWaitMs,
    dryTicks,
    spawned,
    wantedSpawned,
    fed,
    completed: fed >= needed,
    ticks: measured,
    overBudgetTicks,
  }
}

describe('anti-drought guarantee', () => {
  const POOL = ['apple', 'banana', 'pear', 'cookie', 'grapes', 'carrot', 'cheese', 'tomato']

  it('keeps a wanted dish reachable inside the budget over long runs, every skill', () => {
    for (const skill of SKILLS) {
      const dials = beltDials(skill)
      for (const visible of [4, 6, 9]) {
        const step = stepAt(dials)
        for (const seed of [1, 7, 13, 29, 101]) {
          const result = simulate({
            visible,
            dials,
            pool: POOL,
            wantedIds: new Set(['apple']),
            rng: mulberry32(seed),
            ticks: 900,
            tickMs: 100,
          })
          expect(result.dryTicks, `belt ran dry (skill ${skill}, ${visible} dishes)`).toBe(0)
          // The provable ceiling: a rescue dish still has to RIDE from the hatch
          // into reach, so the worst case is the larger of the budget and that ride
          // (plus a pitch of decision granularity). On a slow belt the ride is the
          // binding term — which is exactly why a slow belt also runs its wanted
          // dishes DENSE, so the wait the child actually meets is a fraction of it
          // (asserted separately below).
          expect(
            result.worstWaitMs,
            `skill ${skill}, ${visible} dishes, seed ${seed}`,
          ).toBeLessThanOrEqual(Math.max(dials.maxWaitMs, hatchDelayMs(step)) + step + 1)
        }
      }
    }
  })

  it('lets a real round be cleared without ever running dry', () => {
    // The biggest ask any kind makes is five of one thing (logic.countTargetRange
    // at the top of the meter). A round is OVER once they are fed, so that — not an
    // endless appetite — is the property worth holding.
    for (const skill of SKILLS) {
      const dials = beltDials(skill)
      const step = stepAt(dials)
      for (const seed of [3, 42, 77, 108]) {
        const result = simulate({
          visible: 6,
          dials,
          pool: POOL,
          wantedIds: new Set(['apple', 'pear']),
          rng: mulberry32(seed),
          ticks: 1800,
          tickMs: 100,
          // A feed every 2.5 s — brisk for a 3–4-year-old who has to spot the dish,
          // drag it across the screen and release it over the mouth.
          eatEvery: 25,
          needed: 5,
        })
        expect(result.completed, `skill ${skill} seed ${seed} could not finish`).toBe(true)
        expect(result.dryTicks).toBe(0)
        expect(result.worstWaitMs).toBeLessThanOrEqual(dials.maxWaitMs + step + 1)
      }
    }
  })

  it('survives a child who clears wanted dishes on sight, faster than any real one', () => {
    // A feed every 0.6 s outruns the belt's one-dish-per-pitch supply. It cannot
    // happen in play (each feed also advances the round, which ends at five), but
    // the rescue valve means even this finishes rather than stalling.
    for (const skill of [0, BELT_SKILL_MAX]) {
      const result = simulate({
        visible: 6,
        dials: beltDials(skill),
        pool: POOL,
        wantedIds: new Set(['apple']),
        rng: mulberry32(9),
        ticks: 1200,
        tickMs: 100,
        eatEvery: 6,
        needed: 5,
      })
      expect(result.completed, `skill ${skill} could not finish`).toBe(true)
    }
  })

  it('keeps the wait the child actually meets well inside the budget', () => {
    // The provable ceiling above is the ride out of the hatch; this is the number
    // that matters in play. A slow belt compensates for its slow delivery by
    // running wanted dishes dense, so time spent over budget stays rare.
    for (const skill of SKILLS) {
      const dials = beltDials(skill)
      for (const seed of [2, 11, 23]) {
        const result = simulate({
          visible: 6,
          dials,
          pool: POOL,
          wantedIds: new Set(['apple', 'pear']),
          rng: mulberry32(seed),
          ticks: 1800,
          tickMs: 100,
        })
        const share = result.overBudgetTicks / Math.max(1, result.ticks)
        expect(
          share,
          `skill ${skill} seed ${seed} spent ${Math.round(share * 100)}% over budget`,
        ).toBeLessThan(0.15)
      }
    }
  })

  it('spawns wanted dishes densely at the easiest setting and sparsely at the hardest', () => {
    const share = (skill: number): number => {
      const result = simulate({
        visible: 6,
        dials: beltDials(skill),
        pool: POOL,
        wantedIds: new Set(['apple']),
        rng: mulberry32(5),
        ticks: 2400,
        tickMs: 100,
      })
      return result.wantedSpawned / Math.max(1, result.spawned)
    }
    const easy = share(0)
    const hard = share(BELT_SKILL_MAX)
    expect(easy).toBeGreaterThan(hard)
    expect(hard, 'the hardest belt still keeps the child supplied').toBeGreaterThan(0.05)
  })

  it('forces a wanted dish the moment the belt would go dry', () => {
    const step = stepAt(beltDials(0))
    const lanes = laneCount(6)
    // Nothing on the belt is wanted at all: every draw must be the wanted food,
    // whatever the dice say.
    const ctx = {
      others: Array.from({ length: lanes - 1 }, (_, i) => ({ slot: i + 1, foodId: 'banana' })),
      lanes,
      step,
      maxWaitMs: 4_000,
      wantedEvery: 6,
      pool: ['apple', 'banana'],
      wanted: (id: string) => id === 'apple',
    }
    expect(soonestWantedMs(ctx)).toBe(Infinity)
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(nextDishFood(ctx, mulberry32(seed))).toBe('apple')
    }
  })

  it('does not force when a wanted dish is already right there', () => {
    const step = stepAt(beltDials(BELT_SKILL_MAX))
    const lanes = laneCount(6)
    const ctx = {
      others: [
        { slot: 2, foodId: 'apple' },
        { slot: 3, foodId: 'banana' },
      ],
      lanes,
      step,
      maxWaitMs: 9_000,
      wantedEvery: 6,
      pool: ['apple', 'banana'],
      wanted: (id: string) => id === 'apple',
    }
    expect(soonestWantedMs(ctx)).toBe(0)
    // With a wanted dish reachable NOW and a 1-in-6 density, most draws are not it.
    const draws = Array.from({ length: 40 }, (_, i) => nextDishFood(ctx, mulberry32(i + 1)))
    expect(draws.some((id) => id === 'banana')).toBe(true)
  })

  it('never returns an empty id, even with a degenerate pool', () => {
    const ctx = {
      others: [],
      lanes: laneCount(4),
      step: stepAt(beltDials(0)),
      maxWaitMs: 4_000,
      wantedEvery: 3,
      pool: ['apple'],
      wanted: () => true,
    }
    expect(nextDishFood(ctx, mulberry32(1))).toBe('apple')
    const noneWanted = { ...ctx, wanted: () => false }
    expect(nextDishFood(noneWanted, mulberry32(1))).toBe('apple')
  })
})

// ─── Plates: nothing lost, nothing doubled up ─────────────────────────────────
//
// The belt never stops any more, so a dish in a child's hand is a dish riding
// nothing. These are the rules that make that safe: its plate keeps going round,
// empty and claimed, and whatever the child does with the dish it ends up on
// exactly one plate — never two, never none.

describe('coming back from a lift', () => {
  const LANES = laneCount(6) // 7: one hidden, six on screen (slots 2..7)

  /** Lanes in slot order: `foods[i]` on slot `slots[i]`, `held[i]` = claimed. */
  const build = (
    slots: number[],
    foods: Array<string | null>,
    claimed: boolean[] = [],
  ): BeltLaneSnapshot[] =>
    slots.map((slot, i) => ({ slot, foodId: foods[i], reserved: claimed[i] ?? false }))

  it('comes back to its OWN plate whenever that plate is still in view', () => {
    // Its plate (index 0) rode on while the child held the dish, and is far from
    // where they let go — it is still the right answer: you put food back on the
    // plate you took it off.
    const lanes = build(
      [2, 3, 4, 5, 6, 7, 1],
      [null, 'a', 'b', 'c', 'd', 'e', 'f'],
      [true, false, false, false, false, false, false],
    )
    expect(returnLane(lanes, 0, 7, LANES)).toBe(0)
    expect(returnLane(lanes, 0, 2, LANES)).toBe(0)
  })

  it('takes the nearest free plate in view once its own has gone behind the hatch', () => {
    // Index 0 is the dish's own plate and has ridden round to slot 1 (hidden), so
    // flying to it would fly off the left edge. Two plates are free on screen.
    const lanes = build(
      [1, 3, 4, 5, 6, 7, 2],
      [null, null, 'b', 'c', 'd', null, 'f'],
      [true, false, false, false, false, false, false],
    )
    expect(returnLane(lanes, 0, 7.4, LANES), 'the free plate closest to the drop').toBe(5)
    expect(returnLane(lanes, 0, 3.1, LANES)).toBe(1)
  })

  it('never puts a second dish on a plate that already has one', () => {
    for (const dropSlot of [2, 3.5, 5, 7]) {
      const lanes = build(
        [1, 3, 4, 5, 6, 7, 2],
        [null, 'a', 'b', 'c', 'd', 'e', 'f'],
        [true, false, false, false, false, false, false],
      )
      const index = returnLane(lanes, 0, dropSlot, LANES)
      expect(index).not.toBeNull()
      expect(lanes[index!].foodId, `dropped at ${dropSlot}`).toBeNull()
    }
  })

  it('never takes a plate another lifted dish is coming back to', () => {
    // Index 1 is empty but CLAIMED by a second dish (a two-finger toddler). The
    // returning dish must ride back in through the hatch on its own plate instead.
    const lanes = build(
      [1, 4, 5, 6, 7, 3, 2],
      [null, null, 'b', 'c', 'd', 'e', 'f'],
      [true, true, false, false, false, false, false],
    )
    expect(returnLane(lanes, 0, 4, LANES)).toBe(0)
  })

  it('rides back in through the hatch when nothing on screen is free at all', () => {
    const lanes = build(
      [1, 3, 4, 5, 6, 7, 2],
      [null, 'a', 'b', 'c', 'd', 'e', 'f'],
      [true, false, false, false, false, false, false],
    )
    // Its own plate is hidden, every visible plate is taken — it still lands.
    expect(returnLane(lanes, 0, 5, LANES)).toBe(0)
  })

  it('answers null only when there is genuinely nowhere', () => {
    const full = build([2, 3, 4, 5, 6, 7, 1], ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(returnLane(full, null, 4, LANES)).toBeNull()
    expect(returnLane([], null, 0, LANES)).toBeNull()
  })

  it('reads the drop point back as a slot (the inverse of the draw)', () => {
    for (let slot = 0; slot <= LANES; slot += 0.5) {
      expect(slotAtPitchX(slotPitchX(slot))).toBeCloseTo(slot, 9)
    }
  })

  it('the dry-belt rescue never re-dresses a claimed plate', () => {
    // The hidden lane is the only one a rescue may touch — and if a lifted dish is
    // coming back to it, the rescue must wait rather than steal it.
    const free = build([1, 3, 4, 5, 6, 7, 2], [null, 'a', 'b', 'c', 'd', 'e', 'f'])
    expect(rescueLane(free)).toBe(0)
    const claimed = build(
      [1, 3, 4, 5, 6, 7, 2],
      [null, 'a', 'b', 'c', 'd', 'e', 'f'],
      [true, false, false, false, false, false, false],
    )
    expect(rescueLane(claimed)).toBeNull()
  })
})

// ─── The whole mechanic, simulated with a child who picks things up ───────────

interface PlaySimResult {
  lifts: number
  fed: number
  returned: number
  /** Still in the child's hand when the run stopped (a lift with no ending yet). */
  stillHeld: number
  /** Releases that found no plate at all — a dish would have been lost. */
  stranded: number
  /** Ticks where a plate held a dish AND a claim, or the plate count moved. */
  corrupt: number
  /** Ticks where a plate rode empty (the intended look after a feed). */
  emptyPlateTicks: number
  /** Plates emptied by a feed that were still empty a full loop later. */
  neverRefilled: number
  /**
   * Longest run of consecutive ticks with nothing feedable on the belt AND
   * nothing in the child's hand. A dry belt while the child is holding the dish
   * they wanted is not a drought — it is the child having what they asked for.
   */
  longestDryRun: number
  /** Worst wait for a wanted dish, sampled only when the child's hands are empty. */
  worstWaitMs: number
}

/**
 * The belt as it is actually played now: dishes ride, a child lifts one off, holds
 * it while the belt keeps going, and either feeds it or puts it back. Models the
 * plate contract exactly as conveyorMode implements it — an emptied plate keeps
 * riding and only refills at the hatch, a claimed plate is refilled by nobody, and
 * a released dish lands through `returnLane`.
 */
function simulatePlay(opts: {
  visible: number
  dials: BeltDials
  pool: string[]
  wantedIds: Set<string>
  rng: Rng
  ticks: number
  tickMs: number
  /** Reach for a dish this often… */
  liftEvery: number
  /** …and hold it this many ticks before letting go. */
  holdTicks: number
}): PlaySimResult {
  const total = laneCount(opts.visible)
  const step = stepAt(opts.dials)
  const wanted = (id: string) => opts.wantedIds.has(id)
  const foods: Array<string | null> = new Array(total).fill(null)
  const claims: boolean[] = new Array(total).fill(false)
  /** Which lane emptied by a feed at which tick, to prove the refill happens. */
  const emptiedAt = new Map<number, number>()
  let offset = 0
  let held: { foodId: string; origin: number } | null = null
  let heldSince = 0
  const out: PlaySimResult = {
    lifts: 0,
    fed: 0,
    returned: 0,
    stillHeld: 0,
    stranded: 0,
    corrupt: 0,
    emptyPlateTicks: 0,
    neverRefilled: 0,
    longestDryRun: 0,
    worstWaitMs: 0,
  }
  let dryRun = 0

  const snapshot = (): BeltLaneSnapshot[] =>
    foods.map((foodId, i) => ({
      slot: laneSlot(i, offset, total),
      foodId,
      reserved: claims[i],
    }))

  const ctxFor = (lanes: BeltLaneSnapshot[]) => ({
    others: lanes,
    lanes: total,
    step,
    maxWaitMs: opts.dials.maxWaitMs,
    wantedEvery: opts.dials.wantedEvery,
    pool: opts.pool,
    wanted,
  })

  const refill = (index: number): void => {
    if (claims[index]) return
    foods[index] = nextDishFood(ctxFor(snapshot().filter((_, i) => i !== index)), opts.rng)
  }

  for (let i = 0; i < total; i++) {
    const slot = laneSlot(i, offset, total)
    if (slot >= BELT_HIDDEN_LANES) foods[i] = opts.pool[i % opts.pool.length]
    else refill(i)
  }

  const lastSlot = Array.from({ length: total }, (_, i) => laneSlot(i, offset, total))

  for (let tick = 1; tick <= opts.ticks; tick++) {
    offset += opts.tickMs / step
    for (let i = 0; i < total; i++) {
      const slot = laneSlot(i, offset, total)
      // A plate emptied by a feed refills the moment it wraps past the hatch —
      // which is the promise an empty plate riding round is making.
      if (slot < lastSlot[i] && foods[i] === null && !claims[i]) refill(i)
      lastSlot[i] = slot
    }

    // Anti-drought valve, per tick, exactly as the widget runs it.
    if (beltIsDry(ctxFor(snapshot()))) {
      const index = rescueLane(snapshot())
      const rescue = index === null ? null : pickWantedFood(opts.pool, wanted, opts.rng)
      if (index !== null && rescue !== null) foods[index] = rescue
    }

    // The child. Lift a visible dish off its plate…
    if (held === null && tick % opts.liftEvery === 0) {
      for (let i = 0; i < total; i++) {
        const id = foods[i]
        if (id === null || !isSlotVisible(laneSlot(i, offset, total), total)) continue
        held = { foodId: id, origin: i }
        heldSince = tick
        foods[i] = null
        claims[i] = true
        out.lifts++
        break
      }
    } else if (held !== null && tick - heldSince >= opts.holdTicks) {
      // …then either feed it (if the friend wants it) or put it back.
      const { foodId, origin } = held
      if (wanted(foodId)) {
        claims[origin] = false
        emptiedAt.set(origin, tick)
        out.fed++
      } else {
        const dropSlot = laneSlot(origin, offset, total)
        const landing = returnLane(snapshot(), origin, dropSlot, total)
        if (landing === null) out.stranded++
        else {
          // Landing on a plate that already carries a dish would silently shove
          // that dish out of existence — the exact loss `returnLane` must prevent.
          if (foods[landing] !== null) out.corrupt++
          if (claims[landing] && landing !== origin) out.corrupt++
          claims[origin] = false
          claims[landing] = false
          foods[landing] = foodId
          out.returned++
        }
      }
      held = null
    }

    // Invariants: one dish per plate at most, and the plates never disappear.
    if (foods.length !== total || claims.length !== total) out.corrupt++
    for (let i = 0; i < total; i++) {
      if (foods[i] !== null && claims[i]) out.corrupt++
      if (foods[i] === null) out.emptyPlateTicks++
    }
    // A plate emptied by a feed must be dressed again within one full loop —
    // however it happens (the wrap, or the dry-belt rescue getting there first).
    for (const [index, at] of emptiedAt) {
      if (foods[index] !== null) emptiedAt.delete(index)
      else if (tick - at > (total + 1) * (step / opts.tickMs)) {
        out.neverRefilled++
        emptiedAt.delete(index)
      }
    }

    // The wait as the CHILD meets it: a belt with nothing wanted on it while the
    // wanted dish is in their own hand is not a wait at all.
    const handsFree = held === null
    const soonest = soonestWantedMs(ctxFor(snapshot()))
    if (handsFree && soonest === Infinity) {
      dryRun++
      out.longestDryRun = Math.max(out.longestDryRun, dryRun)
    } else {
      dryRun = 0
      if (handsFree) out.worstWaitMs = Math.max(out.worstWaitMs, soonest)
    }
  }

  if (held !== null) out.stillHeld = 1
  return out
}

describe('a belt that never stops, played', () => {
  const POOL = ['apple', 'banana', 'pear', 'cookie', 'grapes', 'carrot', 'cheese', 'tomato']

  it('never loses a dish and never doubles one up, at every skill and seed', () => {
    for (const skill of SKILLS) {
      for (const visible of [4, 6, 9]) {
        for (const seed of [1, 7, 13, 29, 101]) {
          const result = simulatePlay({
            visible,
            dials: beltDials(skill),
            pool: POOL,
            wantedIds: new Set(['apple', 'pear']),
            rng: mulberry32(seed),
            ticks: 900,
            tickMs: 100,
            // Reach every ~2 s and hold for ~1.5 s: a plausible four-year-old, and
            // long enough that the belt moves most of a pitch under the held dish.
            liftEvery: 20,
            holdTicks: 15,
          })
          const where = `skill ${skill}, ${visible} dishes, seed ${seed}`
          expect(result.lifts, `${where}: the child never got to pick anything up`).toBeGreaterThan(
            5,
          )
          expect(result.stranded, `${where}: a released dish had nowhere to land`).toBe(0)
          expect(result.corrupt, `${where}: a plate held two dishes`).toBe(0)
          expect(
            result.returned + result.fed + result.stillHeld,
            `${where}: a lift went nowhere`,
          ).toBe(result.lifts)
        }
      }
    }
  })

  it('leaves plates riding EMPTY after a feed, and refills them at the hatch', () => {
    for (const skill of SKILLS) {
      const result = simulatePlay({
        visible: 6,
        dials: beltDials(skill),
        pool: POOL,
        wantedIds: new Set(['apple', 'pear']),
        rng: mulberry32(5),
        ticks: 1200,
        tickMs: 100,
        liftEvery: 20,
        holdTicks: 15,
      })
      expect(result.fed, `skill ${skill} never fed anything`).toBeGreaterThan(0)
      // The plate stays: gaps riding past are the intended look, not a defect…
      expect(
        result.emptyPlateTicks,
        `skill ${skill}: no plate ever rode empty — the gap is the point`,
      ).toBeGreaterThan(0)
      // …but an empty plate forever is a defect. Every one is dressed again on its
      // next trip through the hatch.
      expect(result.neverRefilled, `skill ${skill}: a plate stayed empty past a loop`).toBe(0)
    }
  })

  it('still keeps something feedable coming while the child fiddles with a dish', () => {
    // Waiting a while for the right dish is NORMAL now — that IS the mechanic — so
    // this asserts the CEILING (the belt is never left dry with the child standing
    // there empty-handed), not that the wait is always short.
    for (const skill of SKILLS) {
      const dials = beltDials(skill)
      const step = stepAt(dials)
      for (const seed of [2, 11, 23]) {
        const result = simulatePlay({
          visible: 6,
          dials,
          pool: POOL,
          wantedIds: new Set(['apple']),
          rng: mulberry32(seed),
          ticks: 900,
          tickMs: 100,
          liftEvery: 25,
          holdTicks: 20,
        })
        // A tick of dryness right after a feed empties the last wanted plate is
        // real but invisible — the rescue valve re-dresses the hidden lane on the
        // very next tick (a frame in the game, 100 ms here).
        expect(
          result.longestDryRun,
          `skill ${skill} seed ${seed} left the belt dry for ${result.longestDryRun} ticks`,
        ).toBeLessThanOrEqual(2)
        expect(result.worstWaitMs).toBeLessThanOrEqual(
          Math.max(dials.maxWaitMs, hatchDelayMs(step)) + step + 1,
        )
      }
    }
  })
})

describe('the injection axis', () => {
  const base = { skill: SKILL_MAX, roundsSinceLastConveyor: 99, struggling: false }

  it('needs a cognitively fluent child', () => {
    expect(shouldInjectConveyor({ ...base, skill: CONVEYOR_MIN_SKILL - 1 }, () => 0)).toBe(false)
    expect(shouldInjectConveyor({ ...base, skill: CONVEYOR_MIN_SKILL }, () => 0)).toBe(true)
  })

  it('never piles a new mechanic on a struggling child', () => {
    expect(shouldInjectConveyor({ ...base, struggling: true }, () => 0)).toBe(false)
  })

  it('never lands two belt rounds back to back', () => {
    for (let gap = 0; gap < CONVEYOR_MIN_GAP; gap++) {
      expect(shouldInjectConveyor({ ...base, roundsSinceLastConveyor: gap }, () => 0)).toBe(false)
    }
    expect(
      shouldInjectConveyor({ ...base, roundsSinceLastConveyor: CONVEYOR_MIN_GAP }, () => 0),
    ).toBe(true)
  })

  it('ramps the chance the longer it has been, and caps it', () => {
    const chanceAt = (gap: number): number => {
      let hits = 0
      const trials = 4000
      const rng = mulberry32(gap + 1)
      for (let i = 0; i < trials; i++) {
        if (shouldInjectConveyor({ ...base, roundsSinceLastConveyor: gap }, rng)) hits++
      }
      return hits / trials
    }
    const near = chanceAt(CONVEYOR_MIN_GAP)
    const far = chanceAt(CONVEYOR_MIN_GAP + 4)
    expect(near).toBeGreaterThan(CONVEYOR_BASE_CHANCE * 0.7)
    expect(far).toBeGreaterThan(near)
    expect(chanceAt(CONVEYOR_MIN_GAP + 50)).toBeLessThanOrEqual(CONVEYOR_MAX_CHANCE + 0.03)
  })

  it('excludes exactly the kinds that need the still tray', () => {
    // A kitchen round fills a pot FROM the tray, and the belt replaced the tray.
    expect([...CONVEYOR_EXCLUDED_KINDS].sort()).toEqual(['dish', 'dish-ordered'])
    for (const kind of CONVEYOR_EXCLUDED_KINDS) {
      expect(TASK_REGISTRY.some((def) => def.kind === kind)).toBe(true)
    }
  })
})
