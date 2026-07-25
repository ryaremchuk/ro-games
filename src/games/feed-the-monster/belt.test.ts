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
  beltDials,
  beltIsDry,
  hatchDelayMs,
  isSlotHidden,
  isSlotVisible,
  laneCount,
  laneSlot,
  msUntilReachable,
  nextDishFood,
  pickWantedFood,
  refillThresholdMs,
  rescueLane,
  slotPitchX,
  soonestWantedMs,
  stepMs,
  shouldInjectConveyor,
  updateBeltSkill,
} from './belt'
import type { BeltDials } from './belt'
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

  it('crosses the visible belt in exactly traverseMs', () => {
    expect(stepMs(18_000, 6) * 6).toBe(18_000)
    expect(stepMs(9_000, 4) * 4).toBe(9_000)
  })
})

describe('msUntilReachable', () => {
  const lanes = laneCount(6)
  const step = stepMs(18_000, 6)

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
      const dials = beltDials(skill)
      for (const visible of [4, 6, 9, 12]) {
        const total = laneCount(visible)
        const stepFor = stepMs(dials.traverseMs, visible)
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
      expect(harder.traverseMs).toBeLessThan(easier.traverseMs)
      expect(harder.maxWaitMs).toBeGreaterThan(easier.maxWaitMs)
      expect(harder.wantedEvery).toBeGreaterThan(easier.wantedEvery)
    }
  })

  it('runs from the design numbers at each end', () => {
    expect(beltDials(0)).toMatchObject({ traverseMs: 18_000, maxWaitMs: 4_000 })
    expect(beltDials(0).wantedEvery).toBeCloseTo(3)
    expect(beltDials(BELT_SKILL_MAX)).toMatchObject({ traverseMs: 9_000, maxWaitMs: 9_000 })
    expect(beltDials(BELT_SKILL_MAX).wantedEvery).toBeCloseTo(6)
  })

  it('clamps outside the meter range', () => {
    expect(beltDials(-5)).toEqual(beltDials(0))
    expect(beltDials(99)).toEqual(beltDials(BELT_SKILL_MAX))
  })

  it('leaves the scheduler room to rescue the child at every setting', () => {
    // If the trigger threshold were the budget itself, a rescue dish would arrive
    // a hatch-delay LATE. This is the invariant that makes the guarantee possible.
    for (const skill of SKILLS) {
      const dials = beltDials(skill)
      for (const visible of [4, 6, 9]) {
        const step = stepMs(dials.traverseMs, visible)
        expect(refillThresholdMs(dials.maxWaitMs, step) + hatchDelayMs(step)).toBeLessThanOrEqual(
          Math.max(dials.maxWaitMs, hatchDelayMs(step)),
        )
      }
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
  const step = stepMs(opts.dials.traverseMs, opts.visible)
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
        const step = stepMs(dials.traverseMs, visible)
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
      const step = stepMs(dials.traverseMs, 6)
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
    const step = stepMs(18_000, 6)
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
    const step = stepMs(9_000, 6)
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
      step: stepMs(18_000, 4),
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
