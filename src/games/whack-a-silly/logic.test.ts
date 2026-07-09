import { describe, expect, it } from 'vitest'
import {
  BOPS_PER_LEVEL,
  CRITTERS,
  GAP_FLOOR_MS,
  GAP_START_MS,
  HOLE_COUNT,
  PHASE2_BOPS,
  PHASE2_TIME_MS,
  PHASE3_BOPS,
  PHASE3_TIME_MS,
  PHASE4_BOPS,
  PHASE4_TIME_MS,
  UP_TIME_HARD_FLOOR_MS,
  UP_TIME_START_MS,
  critterById,
  gapMs,
  isConfettiBop,
  levelForBops,
  phaseFor,
  planSpawn,
  upTimeMs,
} from './logic'
import type { RampState, Rng, SpawnPlan } from './logic'

/** Seeded RNG so every property below is reproducible. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1)

/** Representative states pinned inside each phase. */
const P1: RampState = { elapsedMs: 10_000, bops: 3 }
const P2: RampState = { elapsedMs: 60_000, bops: 15 }
const P3: RampState = { elapsedMs: 110_000, bops: 30 }
const P4: RampState = { elapsedMs: 200_000, bops: 60 }

function manySpawns(state: RampState, count: number, rng: Rng): SpawnPlan[] {
  const plans: SpawnPlan[] = []
  let lastHole: number | null = null
  for (let i = 0; i < count; i++) {
    const plan = planSpawn(state, [], lastHole, rng)
    plans.push(plan)
    lastHole = plan.primary.hole
  }
  return plans
}

describe('critter pool', () => {
  it('has at least 6 critters with unique ids and emoji', () => {
    expect(CRITTERS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(CRITTERS.map((c) => c.id)).size).toBe(CRITTERS.length)
    expect(new Set(CRITTERS.map((c) => c.emoji)).size).toBe(CRITTERS.length)
  })

  it('critterById throws on unknown ids', () => {
    expect(() => critterById('dragon')).toThrow()
  })
})

describe('phase progression', () => {
  it('starts in warm-up phase 1', () => {
    expect(phaseFor({ elapsedMs: 0, bops: 0 })).toBe(1)
    expect(phaseFor({ elapsedMs: PHASE2_TIME_MS - 1, bops: PHASE2_BOPS - 1 })).toBe(1)
  })

  it('advances on elapsed time OR bops, whichever comes first', () => {
    expect(phaseFor({ elapsedMs: PHASE2_TIME_MS, bops: 0 })).toBe(2)
    expect(phaseFor({ elapsedMs: 0, bops: PHASE2_BOPS })).toBe(2)
    expect(phaseFor({ elapsedMs: PHASE3_TIME_MS, bops: 0 })).toBe(3)
    expect(phaseFor({ elapsedMs: 0, bops: PHASE3_BOPS })).toBe(3)
    expect(phaseFor({ elapsedMs: PHASE4_TIME_MS, bops: 0 })).toBe(4)
    expect(phaseFor({ elapsedMs: 0, bops: PHASE4_BOPS })).toBe(4)
  })

  it('never regresses as time and bops grow', () => {
    let last = 0
    for (let t = 0; t <= 300_000; t += 5_000) {
      const phase = phaseFor({ elapsedMs: t, bops: Math.floor(t / 4000) })
      expect(phase).toBeGreaterThanOrEqual(last)
      last = phase
    }
    expect(last).toBe(4)
  })
})

describe('go:no-go hat ratio', () => {
  it('spawns no hats during warm-up (all go)', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const plan of manySpawns(P1, 300, rng)) {
        expect(plan.primary.hat).toBe(false)
        expect(plan.double).toBeNull()
      }
    }
  })

  it('holds ~75:25 go:no-go once hats appear', () => {
    for (const state of [P2, P3]) {
      const rng = mulberry32(42)
      const plans = manySpawns(state, 4000, rng)
      const hatRate = plans.filter((p) => p.primary.hat).length / plans.length
      expect(hatRate).toBeGreaterThan(0.21)
      expect(hatRate).toBeLessThan(0.29)
    }
  })
})

describe('up-time and gap ramps', () => {
  it('starts at the briefed values', () => {
    const fresh: RampState = { elapsedMs: 0, bops: 0 }
    expect(upTimeMs(fresh)).toBe(UP_TIME_START_MS)
    expect(gapMs(fresh)).toBe(GAP_START_MS)
  })

  it('never leaves the briefed bounds and respects both floors', () => {
    for (let t = 0; t <= 600_000; t += 2_500) {
      const state: RampState = { elapsedMs: t, bops: Math.floor(t / 5000) }
      const up = upTimeMs(state)
      const gap = gapMs(state)
      expect(up).toBeLessThanOrEqual(UP_TIME_START_MS)
      expect(up).toBeGreaterThanOrEqual(UP_TIME_HARD_FLOOR_MS)
      expect(gap).toBeLessThanOrEqual(GAP_START_MS)
      expect(gap).toBeGreaterThanOrEqual(GAP_FLOOR_MS)
    }
  })

  it('ramps monotonically down to the floors', () => {
    let lastUp = Infinity
    let lastGap = Infinity
    for (let t = 0; t <= 400_000; t += 10_000) {
      const state: RampState = { elapsedMs: t, bops: 0 }
      const up = upTimeMs(state)
      const gap = gapMs(state)
      expect(up).toBeLessThanOrEqual(lastUp)
      expect(gap).toBeLessThanOrEqual(lastGap)
      lastUp = up
      lastGap = gap
    }
    expect(lastUp).toBe(UP_TIME_HARD_FLOOR_MS)
    expect(lastGap).toBe(GAP_FLOOR_MS)
  })

  it('bops alone also drive the ramp (fast kids ramp faster)', () => {
    const slow = upTimeMs({ elapsedMs: 30_000, bops: 0 })
    const fast = upTimeMs({ elapsedMs: 30_000, bops: 30 })
    expect(fast).toBeLessThan(slow)
  })
})

describe('double-pops', () => {
  it('never double-pops before phase 3', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const state of [P1, P2]) {
        for (const plan of manySpawns(state, 300, rng)) {
          expect(plan.double).toBeNull()
        }
      }
    }
  })

  it('occasionally double-pops in phase 3+, in a different free hole', () => {
    for (const state of [P3, P4]) {
      const rng = mulberry32(7)
      const plans = manySpawns(state, 600, rng)
      const doubles = plans.filter((p) => p.double !== null)
      expect(doubles.length).toBeGreaterThan(0)
      expect(doubles.length).toBeLessThan(plans.length / 2)
      for (const plan of doubles) {
        expect(plan.double!.hole).not.toBe(plan.primary.hole)
        expect(plan.double!.hole).toBeGreaterThanOrEqual(0)
        expect(plan.double!.hole).toBeLessThan(HOLE_COUNT)
      }
    }
  })
})

describe('golden critter', () => {
  it('never appears before phase 4', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const state of [P1, P2, P3]) {
        for (const plan of manySpawns(state, 300, rng)) {
          expect(plan.primary.golden).toBe(false)
          if (plan.double) expect(plan.double.golden).toBe(false)
        }
      }
    }
  })

  it('is rare (~5%) in phase 4 and never wears a hat', () => {
    const rng = mulberry32(99)
    const plans = manySpawns(P4, 4000, rng)
    const golden = plans.filter((p) => p.primary.golden)
    const rate = golden.length / plans.length
    expect(rate).toBeGreaterThan(0.02)
    expect(rate).toBeLessThan(0.08)
    for (const plan of golden) {
      expect(plan.primary.hat).toBe(false)
      expect(plan.primary.peek).toBe(false)
    }
  })
})

describe('sideways peeker', () => {
  it('only peeks in phase 4', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const state of [P1, P2, P3]) {
        for (const plan of manySpawns(state, 300, rng)) {
          expect(plan.primary.peek).toBe(false)
        }
      }
    }
    const rng = mulberry32(5)
    const plans = manySpawns(P4, 1000, rng)
    expect(plans.some((p) => p.primary.peek)).toBe(true)
  })
})

describe('hole selection', () => {
  it('never spawns in the same hole back-to-back', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const state of [P1, P2, P3, P4]) {
        let lastHole: number | null = null
        for (let i = 0; i < 500; i++) {
          const plan = planSpawn(state, [], lastHole, rng)
          expect(plan.primary.hole).not.toBe(lastHole)
          expect(plan.primary.hole).toBeGreaterThanOrEqual(0)
          expect(plan.primary.hole).toBeLessThan(HOLE_COUNT)
          lastHole = plan.primary.hole
        }
      }
    }
  })

  it('avoids currently-occupied holes', () => {
    const rng = mulberry32(13)
    const occupied = [0, 1, 2, 3]
    for (let i = 0; i < 300; i++) {
      const plan = planSpawn(P4, occupied, 4, rng)
      expect(occupied).not.toContain(plan.primary.hole)
      expect(plan.primary.hole).not.toBe(4)
      if (plan.double) {
        expect(plan.double.hole).not.toBe(plan.primary.hole)
        expect(occupied).not.toContain(plan.double.hole)
        expect(plan.double.hole).not.toBe(4)
      }
    }
  })

  it('skips the double-pop when only one hole is free', () => {
    const rng = mulberry32(13)
    const occupied = [0, 1, 2, 3, 4, 5, 6]
    for (let i = 0; i < 200; i++) {
      const plan = planSpawn(P4, occupied, 7, rng)
      expect(plan.primary.hole).toBe(8)
      expect(plan.double).toBeNull()
    }
  })
})

describe('confetti cadence', () => {
  it('celebrates every 10th successful bop without pausing anything', () => {
    expect(isConfettiBop(0)).toBe(false)
    expect(isConfettiBop(9)).toBe(false)
    expect(isConfettiBop(10)).toBe(true)
    expect(isConfettiBop(11)).toBe(false)
    expect(isConfettiBop(20)).toBe(true)
    expect(isConfettiBop(100)).toBe(true)
  })
})

describe('spawn plan timing', () => {
  it('carries the ramped up-time and gap for the given state', () => {
    const rng = mulberry32(3)
    for (const state of [P1, P2, P3, P4]) {
      const plan = planSpawn(state, [], null, rng)
      expect(plan.upTimeMs).toBe(upTimeMs(state))
      expect(plan.gapMs).toBe(gapMs(state))
    }
  })
})

describe('levels', () => {
  it('advances one level per confetti burst (every 10 bops)', () => {
    expect(levelForBops(0)).toBe(1)
    expect(levelForBops(BOPS_PER_LEVEL - 1)).toBe(1)
    expect(levelForBops(BOPS_PER_LEVEL)).toBe(2)
    expect(levelForBops(BOPS_PER_LEVEL * 4)).toBe(5)
    expect(levelForBops(-5)).toBe(1) // defensive: never below level 1
  })

  it('is monotonic in bops', () => {
    let last = 0
    for (let bops = 0; bops <= BOPS_PER_LEVEL * 5; bops++) {
      const level = levelForBops(bops)
      expect(level).toBeGreaterThanOrEqual(last)
      last = level
    }
  })
})
