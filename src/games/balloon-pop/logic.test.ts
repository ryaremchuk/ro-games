import { describe, expect, it } from 'vitest'
import {
  BALLOON_COLORS,
  CELEBRATION_EVERY_ROUNDS,
  COLOR_TASK_MIN_LEVEL,
  CROSS_REP_MIN_LEVEL,
  DICE_LAYOUTS,
  MAX_BALLOON_VALUE,
  MAX_MATCHES_ON_SCREEN,
  RISE_JITTER,
  RISE_RAMP_ROUNDS,
  RISE_SPEED_MAX,
  RISE_SPEED_START,
  STAGE2_ROUNDS,
  STAGE3_ROUNDS,
  STAGE4_ROUNDS,
  baseRiseSpeed,
  distractorValues,
  dotPositions,
  isSkyCelebration,
  levelFor,
  maxTargetFor,
  nextColorIndex,
  planBalloon,
  planInitialWave,
  planRound,
  shouldShowHint,
  stageFor,
} from './logic'
import type { BalloonSpec, DotLayoutKind, RoundPlan, Rng, SpawnContext, Stage } from './logic'

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

/** Representative round counts pinned inside each stage. */
const ROUNDS_S1 = 0
const ROUNDS_S2 = STAGE2_ROUNDS
const ROUNDS_S3 = STAGE3_ROUNDS
const ROUNDS_S4 = STAGE4_ROUNDS + 4
/** First round of the cross-representation and color levels. */
const ROUNDS_L6 = (CROSS_REP_MIN_LEVEL - 1) * CELEBRATION_EVERY_ROUNDS
const ROUNDS_L8 = (COLOR_TASK_MIN_LEVEL - 1) * CELEBRATION_EVERY_ROUNDS

function roundAt(roundsCompleted: number, rng: Rng): RoundPlan {
  return planRound(roundsCompleted, null, rng)
}

function spawnMany(
  round: RoundPlan,
  roundsCompleted: number,
  count: number,
  activeMatchCount: number,
  rng: Rng,
): BalloonSpec[] {
  const specs: BalloonSpec[] = []
  let lastColor: number | null = null
  for (let i = 0; i < count; i++) {
    const ctx: SpawnContext = {
      round,
      roundsCompleted,
      activeMatchCount,
      activeXFracs: [],
      lastColorIndex: lastColor,
    }
    const spec = planBalloon(ctx, rng)
    specs.push(spec)
    lastColor = spec.colorIndex
  }
  return specs
}

describe('balloon colors', () => {
  it('cycles through the six palette colors', () => {
    expect(BALLOON_COLORS).toHaveLength(6)
    expect(new Set(BALLOON_COLORS).size).toBe(6)
    for (const hex of ['#FF6B6B', '#FFD93D', '#6BCB77', '#9B5DE5', '#FF8FAB', '#4ECDC4']) {
      expect(BALLOON_COLORS).toContain(hex)
    }
  })

  it('never repeats the previous color immediately', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      let last: number | null = null
      for (let i = 0; i < 500; i++) {
        const next = nextColorIndex(last, rng)
        expect(next).toBeGreaterThanOrEqual(0)
        expect(next).toBeLessThan(BALLOON_COLORS.length)
        if (last !== null) expect(next).not.toBe(last)
        last = next
      }
    }
  })

  it('spawned balloons never repeat the previous balloon color', () => {
    const rng = mulberry32(11)
    const round = roundAt(ROUNDS_S2, rng)
    const specs = spawnMany(round, ROUNDS_S2, 400, 1, rng)
    for (let i = 1; i < specs.length; i++) {
      expect(specs[i].colorIndex).not.toBe(specs[i - 1].colorIndex)
    }
  })
})

describe('stage progression', () => {
  it('moves 1 → 2 → 3 → 4 at the briefed round counts and never regresses', () => {
    expect(stageFor(0)).toBe(1)
    expect(stageFor(STAGE2_ROUNDS - 1)).toBe(1)
    expect(stageFor(STAGE2_ROUNDS)).toBe(2)
    expect(stageFor(STAGE3_ROUNDS - 1)).toBe(2)
    expect(stageFor(STAGE3_ROUNDS)).toBe(3)
    expect(stageFor(STAGE4_ROUNDS - 1)).toBe(3)
    expect(stageFor(STAGE4_ROUNDS)).toBe(4)
    let last = 0
    for (let rounds = 0; rounds <= 60; rounds++) {
      const stage = stageFor(rounds)
      expect(stage).toBeGreaterThanOrEqual(last)
      last = stage
    }
    expect(last).toBe(4)
  })
})

describe('target progression', () => {
  it('scaffolds the first three rounds as 1, 2, 3 in order', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      expect(planRound(0, null, rng).target).toBe(1)
      expect(planRound(1, 1, rng).target).toBe(2)
      expect(planRound(2, 2, rng).target).toBe(3)
    }
  })

  it('keeps targets within the subitizing range 1-3 in stage 1', () => {
    expect(maxTargetFor(1)).toBe(3)
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let rounds = 0; rounds < STAGE2_ROUNDS; rounds++) {
        const round = planRound(rounds, null, rng)
        expect(round.target).toBeGreaterThanOrEqual(1)
        expect(round.target).toBeLessThanOrEqual(3)
      }
    }
  })

  it('adds 4 in stage 2 and 5 only from stage 3 (late stretch)', () => {
    expect(maxTargetFor(2)).toBe(4)
    expect(maxTargetFor(3)).toBe(5)
    expect(maxTargetFor(4)).toBe(5)
    const seen2 = new Set<number>()
    const seen3 = new Set<number>()
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let i = 0; i < 200; i++) {
        const round2 = planRound(ROUNDS_S2, null, rng)
        expect(round2.target).toBeLessThanOrEqual(4)
        seen2.add(round2.target)
        const round3 = planRound(ROUNDS_S3, null, rng)
        expect(round3.target).toBeLessThanOrEqual(5)
        seen3.add(round3.target)
      }
    }
    expect(seen2.has(4)).toBe(true)
    expect(seen3.has(5)).toBe(true)
  })

  it('never repeats the previous target back-to-back after the scaffold', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      let prev: number | null = null
      for (let rounds = STAGE2_ROUNDS; rounds < 60; rounds++) {
        const round = planRound(rounds, prev, rng)
        if (prev !== null) expect(round.target).not.toBe(prev)
        prev = round.target
      }
    }
  })
})

describe('numeral rounds', () => {
  it('never put numerals on balloons before stage 4', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let rounds = 0; rounds < STAGE4_ROUNDS; rounds++) {
        for (let i = 0; i < 20; i++) {
          expect(planRound(rounds, null, rng).balloonKind).toBe('dots')
        }
      }
    }
  })

  it('appear regularly in stage 4 and put numerals on every balloon', () => {
    const rng = mulberry32(21)
    let numeralRounds = 0
    for (let i = 0; i < 400; i++) {
      const round = planRound(ROUNDS_S4, null, rng)
      if (round.balloonKind !== 'numeral') continue
      numeralRounds++
      for (const spec of spawnMany(round, ROUNDS_S4, 12, 1, rng)) {
        expect(spec.kind).toBe('numeral')
      }
    }
    expect(numeralRounds).toBeGreaterThan(100)
    expect(numeralRounds).toBeLessThan(300)
  })

  it('dot rounds put dots on every balloon', () => {
    const rng = mulberry32(22)
    const round = roundAt(ROUNDS_S1, rng)
    for (const spec of spawnMany(round, ROUNDS_S1, 50, 1, rng)) {
      expect(spec.kind).toBe('dots')
    }
  })
})

describe('levels', () => {
  it('advances one level per rainbow (every 5 rounds)', () => {
    expect(levelFor(0)).toBe(1)
    expect(levelFor(CELEBRATION_EVERY_ROUNDS - 1)).toBe(1)
    expect(levelFor(CELEBRATION_EVERY_ROUNDS)).toBe(2)
    expect(levelFor(2 * CELEBRATION_EVERY_ROUNDS - 1)).toBe(2)
    expect(levelFor(2 * CELEBRATION_EVERY_ROUNDS)).toBe(3)
    expect(levelFor(ROUNDS_L6)).toBe(CROSS_REP_MIN_LEVEL)
    expect(levelFor(ROUNDS_L8)).toBe(COLOR_TASK_MIN_LEVEL)
  })
})

describe('cross-representation rounds (level 6+)', () => {
  it('keeps the sign in the same representation as the balloons before level 6', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const rounds of [ROUNDS_S1, ROUNDS_S2, ROUNDS_S3, ROUNDS_S4, ROUNDS_L6 - 1]) {
        for (let i = 0; i < 20; i++) {
          const round = planRound(rounds, null, rng)
          expect(round.promptKind).toBe(round.balloonKind)
        }
      }
    }
  })

  it('regularly asks in the OTHER representation from level 6', () => {
    const rng = mulberry32(51)
    let crossed = 0
    for (let i = 0; i < 400; i++) {
      const round = planRound(ROUNDS_L6, null, rng)
      if (round.promptKind === round.balloonKind) continue
      crossed++
      const kinds = [round.promptKind, round.balloonKind].sort()
      expect(kinds).toEqual(['dots', 'numeral'])
    }
    expect(crossed).toBeGreaterThan(100)
    expect(crossed).toBeLessThan(300)
  })
})

describe('color rounds (level 8+)', () => {
  it('never pins a color before level 8', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const rounds of [ROUNDS_S1, ROUNDS_S4, ROUNDS_L6, ROUNDS_L8 - 1]) {
        for (let i = 0; i < 20; i++) {
          expect(planRound(rounds, null, rng).targetColorIndex).toBeNull()
        }
      }
    }
  })

  it('appears regularly from level 8 with a valid palette color', () => {
    const rng = mulberry32(61)
    let colorRounds = 0
    for (let i = 0; i < 400; i++) {
      const { targetColorIndex } = planRound(ROUNDS_L8, null, rng)
      if (targetColorIndex === null) continue
      colorRounds++
      expect(Number.isInteger(targetColorIndex)).toBe(true)
      expect(targetColorIndex).toBeGreaterThanOrEqual(0)
      expect(targetColorIndex).toBeLessThan(BALLOON_COLORS.length)
    }
    expect(colorRounds).toBeGreaterThan(80)
    expect(colorRounds).toBeLessThan(260)
  })

  it('matches need number AND color; decoys never have both', () => {
    const rng = mulberry32(62)
    let round = roundAt(ROUNDS_L8, rng)
    while (round.targetColorIndex === null) round = roundAt(ROUNDS_L8, rng)

    const specs = spawnMany(round, ROUNDS_L8, 300, 1, rng)
    for (const spec of specs) {
      if (spec.isMatch) {
        expect(spec.value).toBe(round.target)
        expect(spec.colorIndex).toBe(round.targetColorIndex)
      } else {
        const both = spec.value === round.target && spec.colorIndex === round.targetColorIndex
        expect(both).toBe(false)
      }
    }
    // Both decoy axes exist: right number in a wrong color, and wrong number.
    expect(specs.some((s) => !s.isMatch && s.value === round.target)).toBe(true)
    expect(specs.some((s) => !s.isMatch && s.value !== round.target)).toBe(true)
  })
})

describe('distractor distance rules', () => {
  it('stays at least ±2 away in stages 1-2 (easy discrimination)', () => {
    for (const stage of [1, 2] as const) {
      for (let target = 1; target <= maxTargetFor(stage); target++) {
        const values = distractorValues(target, stage)
        expect(values.length).toBeGreaterThan(0)
        for (const value of values) {
          expect(Math.abs(value - target)).toBeGreaterThanOrEqual(2)
          expect(value).not.toBe(target)
          expect(value).toBeGreaterThanOrEqual(1)
          expect(value).toBeLessThanOrEqual(MAX_BALLOON_VALUE)
        }
      }
    }
  })

  it('tightens to ±1..2 in stages 3-4 and always offers an off-by-one', () => {
    for (const stage of [3, 4] as const) {
      for (let target = 1; target <= maxTargetFor(stage); target++) {
        const values = distractorValues(target, stage)
        expect(values.length).toBeGreaterThan(0)
        for (const value of values) {
          const distance = Math.abs(value - target)
          expect(distance).toBeGreaterThanOrEqual(1)
          expect(distance).toBeLessThanOrEqual(2)
        }
        expect(values.some((value) => Math.abs(value - target) === 1)).toBe(true)
      }
    }
  })

  it('wrong balloons only carry round-approved distractor values', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const rounds of [ROUNDS_S1, ROUNDS_S2, ROUNDS_S3, ROUNDS_S4]) {
        const round = roundAt(rounds, rng)
        for (const spec of spawnMany(round, rounds, 60, 1, rng)) {
          if (spec.isMatch) expect(spec.value).toBe(round.target)
          else expect(round.distractors).toContain(spec.value)
        }
      }
    }
  })
})

describe('matching balloon invariant (CRITICAL)', () => {
  it('forces a match whenever no matching balloon is afloat', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const rounds of [ROUNDS_S1, ROUNDS_S2, ROUNDS_S3, ROUNDS_S4]) {
        const round = roundAt(rounds, rng)
        for (let i = 0; i < 100; i++) {
          const spec = planBalloon(
            {
              round,
              roundsCompleted: rounds,
              activeMatchCount: 0,
              activeXFracs: [],
              lastColorIndex: null,
            },
            rng,
          )
          expect(spec.isMatch).toBe(true)
          expect(spec.value).toBe(round.target)
        }
      }
    }
  })

  it('plans at least one match in every opening wave', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const rounds of [ROUNDS_S1, ROUNDS_S2, ROUNDS_S3, ROUNDS_S4]) {
        const round = roundAt(rounds, rng)
        const wave = planInitialWave(round, rounds, rng)
        expect(wave).toHaveLength(round.concurrent)
        expect(wave.some((spec) => spec.isMatch)).toBe(true)
      }
    }
  })

  it('keeps at least one match afloat across simulated pop/drift churn', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const round = roundAt(ROUNDS_S3, rng)
      let afloat = planInitialWave(round, ROUNDS_S3, rng)
      for (let step = 0; step < 300; step++) {
        // A random balloon drifts off the top and is replaced.
        const leaving = Math.floor(rng() * afloat.length)
        afloat.splice(leaving, 1)
        const matches = afloat.filter((spec) => spec.isMatch).length
        const spec = planBalloon(
          {
            round,
            roundsCompleted: ROUNDS_S3,
            activeMatchCount: matches,
            activeXFracs: afloat.map((s) => s.xFrac),
            lastColorIndex: afloat.length ? afloat[afloat.length - 1].colorIndex : null,
          },
          rng,
        )
        afloat.push(spec)
        expect(afloat.some((s) => s.isMatch)).toBe(true)
      }
      expect(afloat.length).toBe(round.concurrent)
    }
  })

  it('does not always lead the opening wave with the match', () => {
    let leadMisses = 0
    let waves = 0
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const rounds of [ROUNDS_S1, ROUNDS_S2, ROUNDS_S3, ROUNDS_S4]) {
        const round = roundAt(rounds, rng)
        const wave = planInitialWave(round, rounds, rng)
        expect(wave.some((spec) => spec.isMatch)).toBe(true)
        waves++
        if (!wave[0].isMatch) leadMisses++
      }
    }
    // The guaranteed match lands at a random slot, so a healthy share of
    // waves must open with a non-match.
    expect(leadMisses).toBeGreaterThan(waves / 8)
  })

  it('does not force a match when one is planned later in the wave', () => {
    const rng = mulberry32(71)
    const round = roundAt(ROUNDS_S2, rng)
    const specs: BalloonSpec[] = []
    for (let i = 0; i < 200; i++) {
      specs.push(
        planBalloon(
          {
            round,
            roundsCompleted: ROUNDS_S2,
            activeMatchCount: 0,
            activeXFracs: [],
            lastColorIndex: null,
            matchPlanned: true,
          },
          rng,
        ),
      )
    }
    expect(specs.some((spec) => !spec.isMatch)).toBe(true)
    expect(specs.some((spec) => spec.isMatch)).toBe(true)
  })

  it('caps simultaneous matches so the hunt stays meaningful', () => {
    const rng = mulberry32(31)
    const round = roundAt(ROUNDS_S2, rng)
    for (let i = 0; i < 200; i++) {
      const spec = planBalloon(
        {
          round,
          roundsCompleted: ROUNDS_S2,
          activeMatchCount: MAX_MATCHES_ON_SCREEN,
          activeXFracs: [],
          lastColorIndex: null,
        },
        rng,
      )
      expect(spec.isMatch).toBe(false)
    }
  })
})

describe('concurrency', () => {
  it('floats 3 balloons in warm-up and 4 from stage 2, never more', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      expect(roundAt(ROUNDS_S1, rng).concurrent).toBe(3)
      for (const rounds of [ROUNDS_S2, ROUNDS_S3, ROUNDS_S4]) {
        expect(roundAt(rounds, rng).concurrent).toBe(4)
      }
    }
  })
})

describe('speed ramp', () => {
  it('starts slow and ramps gently to the ceiling, monotonically', () => {
    expect(baseRiseSpeed(0)).toBe(RISE_SPEED_START)
    expect(baseRiseSpeed(RISE_RAMP_ROUNDS)).toBe(RISE_SPEED_MAX)
    expect(baseRiseSpeed(1000)).toBe(RISE_SPEED_MAX)
    let last = 0
    for (let rounds = 0; rounds <= 40; rounds++) {
      const speed = baseRiseSpeed(rounds)
      expect(speed).toBeGreaterThanOrEqual(last)
      expect(speed).toBeLessThanOrEqual(RISE_SPEED_MAX)
      last = speed
    }
  })

  it('keeps per-balloon jitter inside the briefed band', () => {
    const rng = mulberry32(41)
    for (const rounds of [ROUNDS_S1, ROUNDS_S4]) {
      const round = roundAt(rounds, rng)
      const base = baseRiseSpeed(rounds)
      for (const spec of spawnMany(round, rounds, 200, 1, rng)) {
        expect(spec.speedCss).toBeGreaterThanOrEqual(base * (1 - RISE_JITTER) - 1e-9)
        expect(spec.speedCss).toBeLessThanOrEqual(base * (1 + RISE_JITTER) + 1e-9)
      }
    }
  })
})

describe('dot layouts', () => {
  const layouts: DotLayoutKind[] = ['dice', 'line', 'scatter']

  it('returns the right number of distinct, in-disc dots for 1-6', () => {
    for (const layout of layouts) {
      for (let count = 1; count <= MAX_BALLOON_VALUE; count++) {
        const rng = mulberry32(count * 7)
        const dots = dotPositions(count, layout, rng)
        expect(dots).toHaveLength(count)
        for (const dot of dots) {
          expect(Math.hypot(dot.x, dot.y)).toBeLessThanOrEqual(0.9)
        }
        for (let i = 0; i < dots.length; i++) {
          for (let j = i + 1; j < dots.length; j++) {
            const distance = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y)
            expect(distance).toBeGreaterThan(0.1)
          }
        }
      }
    }
  })

  it('uses canonical dice patterns (1 centered, 4 corners, 6 two columns)', () => {
    expect(DICE_LAYOUTS[1]).toEqual([{ x: 0, y: 0 }])
    expect(DICE_LAYOUTS[4]).toHaveLength(4)
    expect(new Set(DICE_LAYOUTS[4].map((p) => Math.abs(p.x))).size).toBe(1)
    expect(new Set(DICE_LAYOUTS[6].map((p) => p.x)).size).toBe(2)
    for (let count = 1; count <= MAX_BALLOON_VALUE; count++) {
      expect(DICE_LAYOUTS[count]).toHaveLength(count)
    }
  })

  it('lays line dots on a single row', () => {
    for (let count = 1; count <= MAX_BALLOON_VALUE; count++) {
      const dots = dotPositions(count, 'line', mulberry32(1))
      for (const dot of dots) expect(dot.y).toBe(0)
    }
  })

  it('throws for counts without a layout', () => {
    expect(() => dotPositions(0, 'dice')).toThrow()
    expect(() => dotPositions(7, 'dice')).toThrow()
    expect(() => dotPositions(2.5, 'dice')).toThrow()
  })

  it('keeps scatter layouts out of stages 1-2 (dice/line easy first)', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const rounds of [ROUNDS_S1, ROUNDS_S2]) {
        const round = roundAt(rounds, rng)
        for (const spec of spawnMany(round, rounds, 100, 1, rng)) {
          expect(spec.layout).not.toBe('scatter')
        }
      }
    }
    const rng = mulberry32(3)
    const round = roundAt(ROUNDS_S3, rng)
    const specs = spawnMany(round, ROUNDS_S3, 200, 1, rng)
    expect(specs.some((spec) => spec.layout === 'scatter')).toBe(true)
  })
})

describe('hints and celebrations', () => {
  it('starts hinting after two wrong taps in a round', () => {
    expect(shouldShowHint(0)).toBe(false)
    expect(shouldShowHint(1)).toBe(false)
    expect(shouldShowHint(2)).toBe(true)
    expect(shouldShowHint(5)).toBe(true)
  })

  it('celebrates the sky every 5 correct rounds', () => {
    expect(isSkyCelebration(0)).toBe(false)
    expect(isSkyCelebration(4)).toBe(false)
    expect(isSkyCelebration(5)).toBe(true)
    expect(isSkyCelebration(7)).toBe(false)
    expect(isSkyCelebration(10)).toBe(true)
    expect(isSkyCelebration(25)).toBe(true)
  })
})

describe('stage typing', () => {
  it('exposes stages as the literal union 1|2|3|4', () => {
    const stages: Stage[] = [1, 2, 3, 4]
    for (const stage of stages) {
      expect(maxTargetFor(stage)).toBeGreaterThanOrEqual(3)
    }
  })
})
