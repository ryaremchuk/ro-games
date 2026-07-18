import { describe, expect, it } from 'vitest'
import {
  CATCHES_TO_CLIMB,
  CONCURRENT2_SKILL,
  CONCURRENT3_SKILL,
  CONFETTI_EVERY_BOPS,
  CRITTERS,
  ESCAPES_TO_EASE,
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
  WHACK_SKILL_MAX,
  bopVariantFor,
  comboStep,
  concurrentFor,
  critterById,
  gapForSkill,
  initialWhackSkill,
  isConfettiBop,
  levelForBops,
  phaseFor,
  planSpawn,
  registerCatch,
  registerEscape,
  upTimeForSkill,
} from './logic'
import type { RampState, Rng, SpawnContext, SpawnPlan } from './logic'

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

/** SpawnContext with quiet-garden defaults; override what a test cares about. */
function ctx(ramp: RampState, overrides: Partial<SpawnContext> = {}): SpawnContext {
  return {
    ramp,
    skill: 0,
    occupiedHoles: [],
    activeCritterIds: [],
    sleeperActive: false,
    lastHole: null,
    ...overrides,
  }
}

function manySpawns(ramp: RampState, count: number, rng: Rng): SpawnPlan[] {
  const plans: SpawnPlan[] = []
  let lastHole: number | null = null
  for (let i = 0; i < count; i++) {
    const plan = planSpawn(ctx(ramp, { lastHole }), rng)
    plans.push(plan)
    lastHole = plan.spawn.hole
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

describe('go:no-go sleepy ratio', () => {
  it('spawns no sleepers during warm-up (all go)', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const plan of manySpawns(P1, 300, rng)) {
        expect(plan.spawn.sleepy).toBe(false)
      }
    }
  })

  it('holds ~75:25 go:no-go once sleepers appear', () => {
    for (const state of [P2, P3]) {
      const rng = mulberry32(42)
      const plans = manySpawns(state, 4000, rng)
      const sleepyRate = plans.filter((p) => p.spawn.sleepy).length / plans.length
      expect(sleepyRate).toBeGreaterThan(0.21)
      expect(sleepyRate).toBeLessThan(0.29)
    }
  })

  it('never rolls a second sleeper while one is already napping', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let i = 0; i < 300; i++) {
        const plan = planSpawn(ctx(P3, { sleeperActive: true }), rng)
        expect(plan.spawn.sleepy).toBe(false)
      }
    }
  })
})

describe('adaptive skill meter', () => {
  it('starts fresh at the floor and resumes a clamped save', () => {
    expect(initialWhackSkill()).toEqual({ skill: 0, catchStreak: 0, escapeStreak: 0 })
    expect(initialWhackSkill(7).skill).toBe(7)
    expect(initialWhackSkill(-4).skill).toBe(0)
    expect(initialWhackSkill(99).skill).toBe(WHACK_SKILL_MAX)
  })

  it(`climbs one step after ${CATCHES_TO_CLIMB} catches in a row`, () => {
    let s = initialWhackSkill(5)
    for (let i = 1; i < CATCHES_TO_CLIMB; i++) {
      s = registerCatch(s)
      expect(s.skill).toBe(5)
    }
    s = registerCatch(s)
    expect(s).toEqual({ skill: 6, catchStreak: 0, escapeStreak: 0 })
  })

  it(`eases one step after ${ESCAPES_TO_EASE} escapes in a row`, () => {
    let s = initialWhackSkill(5)
    s = registerEscape(s)
    expect(s.skill).toBe(5)
    s = registerEscape(s)
    expect(s).toEqual({ skill: 4, catchStreak: 0, escapeStreak: 0 })
  })

  it('a catch and an escape reset each other’s streak', () => {
    let s = initialWhackSkill(5)
    s = registerCatch(s)
    s = registerCatch(s)
    s = registerEscape(s) // catch streak gone
    s = registerCatch(s)
    s = registerCatch(s)
    expect(s.skill).toBe(5) // needs a third consecutive catch again
    s = registerCatch(s)
    expect(s.skill).toBe(6)
  })

  it('climbs double while below the saved peak (session warm-up)', () => {
    let s = initialWhackSkill(4)
    for (let i = 0; i < CATCHES_TO_CLIMB; i++) s = registerCatch(s, 8)
    expect(s.skill).toBe(6)
    // At/above the peak the step drops back to one.
    let t = initialWhackSkill(8)
    for (let i = 0; i < CATCHES_TO_CLIMB; i++) t = registerCatch(t, 8)
    expect(t.skill).toBe(9)
  })

  it('clamps to [0, WHACK_SKILL_MAX]', () => {
    let bottom = initialWhackSkill(0)
    for (let i = 0; i < 10; i++) bottom = registerEscape(bottom)
    expect(bottom.skill).toBe(0)
    let top = initialWhackSkill(WHACK_SKILL_MAX)
    for (let i = 0; i < 10; i++) top = registerCatch(top)
    expect(top.skill).toBe(WHACK_SKILL_MAX)
  })
})

describe('adaptive speed knobs', () => {
  it('starts at the briefed values and reaches the floors at max skill', () => {
    expect(upTimeForSkill(0)).toBe(UP_TIME_START_MS)
    expect(gapForSkill(0)).toBe(GAP_START_MS)
    expect(upTimeForSkill(WHACK_SKILL_MAX)).toBe(UP_TIME_HARD_FLOOR_MS)
    expect(gapForSkill(WHACK_SKILL_MAX)).toBe(GAP_FLOOR_MS)
  })

  it('is monotonic in skill and clamped outside the meter', () => {
    let lastUp = Infinity
    let lastGap = Infinity
    for (let skill = -2; skill <= WHACK_SKILL_MAX + 2; skill++) {
      const up = upTimeForSkill(skill)
      const gap = gapForSkill(skill)
      expect(up).toBeLessThanOrEqual(lastUp)
      expect(gap).toBeLessThanOrEqual(lastGap)
      expect(up).toBeLessThanOrEqual(UP_TIME_START_MS)
      expect(up).toBeGreaterThanOrEqual(UP_TIME_HARD_FLOOR_MS)
      expect(gap).toBeLessThanOrEqual(GAP_START_MS)
      expect(gap).toBeGreaterThanOrEqual(GAP_FLOOR_MS)
      lastUp = up
      lastGap = gap
    }
  })
})

describe('concurrency ladder', () => {
  it('grows 1 → 2 → 3 simultaneous critters with skill', () => {
    expect(concurrentFor(0)).toBe(1)
    expect(concurrentFor(CONCURRENT2_SKILL - 1)).toBe(1)
    expect(concurrentFor(CONCURRENT2_SKILL)).toBe(2)
    expect(concurrentFor(CONCURRENT3_SKILL - 1)).toBe(2)
    expect(concurrentFor(CONCURRENT3_SKILL)).toBe(3)
    expect(concurrentFor(WHACK_SKILL_MAX)).toBe(3)
  })

  it('simultaneous critters are never the same species', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const onStage = [CRITTERS[0].id, CRITTERS[1].id]
      for (let i = 0; i < 300; i++) {
        const plan = planSpawn(ctx(P3, { activeCritterIds: onStage }), rng)
        expect(onStage).not.toContain(plan.spawn.critterId)
      }
    }
  })

  it('relaxes the species rule only when the whole pool is on stage', () => {
    const rng = mulberry32(17)
    const everyone = CRITTERS.map((c) => c.id)
    const plan = planSpawn(ctx(P3, { activeCritterIds: everyone }), rng)
    expect(everyone).toContain(plan.spawn.critterId)
  })
})

describe('golden critter', () => {
  it('never appears before phase 4', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const state of [P1, P2, P3]) {
        for (const plan of manySpawns(state, 300, rng)) {
          expect(plan.spawn.golden).toBe(false)
        }
      }
    }
  })

  it('is rare (~5%) in phase 4 and never wears a hat', () => {
    const rng = mulberry32(99)
    const plans = manySpawns(P4, 4000, rng)
    const golden = plans.filter((p) => p.spawn.golden)
    const rate = golden.length / plans.length
    expect(rate).toBeGreaterThan(0.02)
    expect(rate).toBeLessThan(0.08)
    for (const plan of golden) {
      expect(plan.spawn.sleepy).toBe(false)
      expect(plan.spawn.peek).toBe(false)
    }
  })
})

describe('sideways peeker', () => {
  it('only peeks in phase 4', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const state of [P1, P2, P3]) {
        for (const plan of manySpawns(state, 300, rng)) {
          expect(plan.spawn.peek).toBe(false)
        }
      }
    }
    const rng = mulberry32(5)
    const plans = manySpawns(P4, 1000, rng)
    expect(plans.some((p) => p.spawn.peek)).toBe(true)
  })
})

describe('hole selection', () => {
  it('never spawns in the same hole back-to-back', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const state of [P1, P2, P3, P4]) {
        let lastHole: number | null = null
        for (let i = 0; i < 500; i++) {
          const plan = planSpawn(ctx(state, { lastHole }), rng)
          expect(plan.spawn.hole).not.toBe(lastHole)
          expect(plan.spawn.hole).toBeGreaterThanOrEqual(0)
          expect(plan.spawn.hole).toBeLessThan(HOLE_COUNT)
          lastHole = plan.spawn.hole
        }
      }
    }
  })

  it('avoids currently-occupied holes', () => {
    const rng = mulberry32(13)
    const occupied = [0, 1, 2, 3]
    for (let i = 0; i < 300; i++) {
      const plan = planSpawn(ctx(P4, { occupiedHoles: occupied, lastHole: 4 }), rng)
      expect(occupied).not.toContain(plan.spawn.hole)
      expect(plan.spawn.hole).not.toBe(4)
    }
  })

  it('takes the single remaining free hole', () => {
    const rng = mulberry32(13)
    const occupied = [0, 1, 2, 3, 4, 5, 6]
    for (let i = 0; i < 200; i++) {
      const plan = planSpawn(ctx(P4, { occupiedHoles: occupied, lastHole: 7 }), rng)
      expect(plan.spawn.hole).toBe(8)
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
  it('carries the skill-driven up-time and gap', () => {
    const rng = mulberry32(3)
    for (const skill of [0, CONCURRENT2_SKILL, CONCURRENT3_SKILL, WHACK_SKILL_MAX]) {
      const plan = planSpawn(ctx(P2, { skill }), rng)
      expect(plan.upTimeMs).toBe(upTimeForSkill(skill))
      expect(plan.gapMs).toBe(gapForSkill(skill))
    }
  })
})

describe('levels', () => {
  it('passes one level per bop, starting at 1', () => {
    expect(levelForBops(0)).toBe(1)
    expect(levelForBops(1)).toBe(2)
    expect(levelForBops(9)).toBe(10)
    expect(levelForBops(-5)).toBe(1) // defensive: never below level 1
  })

  it('keeps the confetti on its own every-10 beat, decoupled from levels', () => {
    expect(isConfettiBop(CONFETTI_EVERY_BOPS - 1)).toBe(false)
    expect(isConfettiBop(CONFETTI_EVERY_BOPS)).toBe(true)
    expect(isConfettiBop(CONFETTI_EVERY_BOPS + 1)).toBe(false)
  })
})

describe('celebration helpers', () => {
  it('bopVariantFor rotates 0 → 1 → 2 across consecutive bops', () => {
    expect(bopVariantFor(1)).toBe(0)
    expect(bopVariantFor(2)).toBe(1)
    expect(bopVariantFor(3)).toBe(2)
    expect(bopVariantFor(4)).toBe(0)
    expect(bopVariantFor(5)).toBe(1)
  })

  it('bopVariantFor only ever returns 0, 1, or 2', () => {
    for (let bops = -3; bops <= 200; bops++) {
      expect([0, 1, 2]).toContain(bopVariantFor(bops))
    }
  })

  it('comboStep climbs one step per bop then caps at 7', () => {
    expect(comboStep(1)).toBe(0)
    expect(comboStep(2)).toBe(1)
    expect(comboStep(8)).toBe(7)
    expect(comboStep(9)).toBe(7)
    expect(comboStep(10)).toBe(7)
  })

  it('comboStep resets every 10 bops (aligned with the confetti cadence)', () => {
    expect(comboStep(11)).toBe(0)
    expect(comboStep(12)).toBe(1)
    expect(comboStep(21)).toBe(0)
  })

  it('comboStep stays within 0..7 for any bop count', () => {
    for (let bops = -3; bops <= 500; bops++) {
      const step = comboStep(bops)
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThanOrEqual(7)
    }
  })
})
