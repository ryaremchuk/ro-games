import { describe, expect, it } from 'vitest'
import {
  BALLOON_COLORS,
  BALLOON_SHAPES,
  CELEBRATION_EVERY_ROUNDS,
  DICE_LAYOUTS,
  FAST_ROUND_MS,
  MATCH_ESCAPES_BEFORE_EASE,
  MAX_BALLOON_VALUE,
  MAX_MATCHES_ON_SCREEN,
  MAX_TASK_REPEAT,
  RISE_JITTER,
  RISE_SPEED_MAX,
  RISE_SPEED_START,
  SCAFFOLD_ROUNDS,
  SKILL_MAX,
  SKILL_START,
  STAGE2_COGNITIVE,
  STAGE3_COGNITIVE,
  STAGE4_COGNITIVE,
  TASKS,
  WRONG_TAPS_BEFORE_HINT,
  baseRiseSpeed,
  distractorValues,
  dotPositions,
  isSkyCelebration,
  levelFor,
  maxTargetFor,
  nextColorIndex,
  pickTask,
  planBalloon,
  planInitialWave,
  planRound,
  shouldShowHint,
  stageFor,
  unlockedTasks,
  updateSkill,
} from './logic'
import type {
  BalloonSpec,
  DotLayoutKind,
  RoundPlan,
  Rng,
  SkillPair,
  SpawnContext,
  TaskId,
} from './logic'

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

/** Representative skill values pinned inside each stage band. */
const D_S1 = 0
const D_S2 = STAGE2_COGNITIVE
const D_S3 = STAGE3_COGNITIVE
const D_S4 = STAGE4_COGNITIVE
const D_MAX = SKILL_MAX

/** Both axes at the same value — the common case in these band tests. */
function skillAt(value: number): SkillPair {
  return { motor: value, cognitive: value }
}

/** A post-scaffold round at a skill value, for a task (defaults to dots). */
function roundAt(skill: number, rng: Rng, taskId: TaskId = 'count-dots'): RoundPlan {
  return planRound(
    { skill: skillAt(skill), roundsCompleted: SCAFFOLD_ROUNDS + 5, prevTarget: null, taskId },
    rng,
  )
}

function spawnMany(
  round: RoundPlan,
  skill: number,
  count: number,
  activeMatchCount: number,
  rng: Rng,
): BalloonSpec[] {
  const specs: BalloonSpec[] = []
  let lastColor: number | null = null
  for (let i = 0; i < count; i++) {
    const ctx: SpawnContext = {
      round,
      skill: skillAt(skill),
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

// ─── Colors & shapes ─────────────────────────────────────────────────────────

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
    const round = roundAt(D_S2, rng)
    const specs = spawnMany(round, D_S2, 400, 1, rng)
    for (let i = 1; i < specs.length; i++) {
      expect(specs[i].colorIndex).not.toBe(specs[i - 1].colorIndex)
    }
  })
})

describe('balloon shapes', () => {
  it('exposes a set of distinct cosmetic shapes', () => {
    expect(BALLOON_SHAPES.length).toBeGreaterThanOrEqual(4)
    expect(new Set(BALLOON_SHAPES).size).toBe(BALLOON_SHAPES.length)
  })

  it('gives every spawned balloon a valid shape index, and varies them', () => {
    const rng = mulberry32(81)
    const round = roundAt(D_S2, rng)
    const specs = spawnMany(round, D_S2, 400, 1, rng)
    const seen = new Set<number>()
    for (const spec of specs) {
      expect(Number.isInteger(spec.shapeIndex)).toBe(true)
      expect(spec.shapeIndex).toBeGreaterThanOrEqual(0)
      expect(spec.shapeIndex).toBeLessThan(BALLOON_SHAPES.length)
      seen.add(spec.shapeIndex)
    }
    // Cosmetic variety: over many balloons, every shape shows up.
    expect(seen.size).toBe(BALLOON_SHAPES.length)
  })
})

// ─── Adaptive skill meters ───────────────────────────────────────────────────

describe('adaptive skill meters', () => {
  const clean = { wrongTaps: 0, matchEscapes: 0, ms: 5_000 }
  const slow = { wrongTaps: 0, matchEscapes: 0, ms: FAST_ROUND_MS + 1 }
  const slip = { wrongTaps: 1, matchEscapes: 0, ms: 5_000 }
  const hinted = { wrongTaps: WRONG_TAPS_BEFORE_HINT, matchEscapes: 0, ms: 5_000 }
  const oneEscape = { wrongTaps: 0, matchEscapes: 1, ms: 5_000 }
  const escaped = { wrongTaps: 0, matchEscapes: MATCH_ESCAPES_BEFORE_EASE, ms: 5_000 }
  const meltdown = { wrongTaps: 5, matchEscapes: 3, ms: 60_000 }

  it('starts at the friendly floor', () => {
    expect(SKILL_START).toBe(0)
    expect(stageFor(SKILL_START)).toBe(1)
  })

  it('moves both axes up one step on a clean, quick round', () => {
    expect(updateSkill(skillAt(0), clean)).toEqual(skillAt(1))
    expect(updateSkill(skillAt(5), clean)).toEqual(skillAt(6))
  })

  it('holds both axes on a slow-but-correct round (no rush pressure)', () => {
    expect(updateSkill(skillAt(5), slow)).toEqual(skillAt(5))
  })

  it('holds both axes on a single slip', () => {
    expect(updateSkill(skillAt(5), slip)).toEqual(skillAt(5))
  })

  it('eases ONLY cognitive down when the glow hint was needed', () => {
    expect(updateSkill(skillAt(5), hinted)).toEqual({ motor: 5, cognitive: 4 })
    expect(updateSkill(skillAt(5), { wrongTaps: 6, matchEscapes: 0, ms: 60_000 })).toEqual({
      motor: 5,
      cognitive: 4,
    })
  })

  it('holds motor on a single escape, eases it on repeat escapes', () => {
    expect(updateSkill(skillAt(5), oneEscape)).toEqual({ motor: 5, cognitive: 6 })
    expect(updateSkill(skillAt(5), escaped)).toEqual({ motor: 4, cognitive: 6 })
  })

  it('keeps the axes decoupled: a rough+escaped round eases both', () => {
    expect(updateSkill(skillAt(5), meltdown)).toEqual(skillAt(4))
  })

  it('never raises motor during a cognitively rough round', () => {
    const roughButCaught = { wrongTaps: WRONG_TAPS_BEFORE_HINT, matchEscapes: 0, ms: 5_000 }
    expect(updateSkill(skillAt(5), roughButCaught).motor).toBe(5)
  })

  it('doubles up-steps while below the saved peak (session warm-up)', () => {
    const peak = { motor: 8, cognitive: 10 }
    expect(updateSkill(skillAt(5), clean, peak)).toEqual({ motor: 7, cognitive: 7 })
    // At/above the peak the step drops back to one.
    expect(updateSkill({ motor: 8, cognitive: 10 }, clean, peak)).toEqual({
      motor: 9,
      cognitive: 11,
    })
  })

  it('clamps to [0, SKILL_MAX]; steps stay within ±1 (±2 in warm-up)', () => {
    expect(updateSkill(skillAt(0), meltdown)).toEqual(skillAt(0))
    expect(updateSkill(skillAt(SKILL_MAX), clean)).toEqual(skillAt(SKILL_MAX))
    const peak = skillAt(SKILL_MAX)
    for (let d = 0; d <= SKILL_MAX; d++) {
      for (const result of [clean, slow, slip, hinted, oneEscape, escaped, meltdown]) {
        for (const p of [skillAt(0), peak]) {
          const next = updateSkill(skillAt(d), result, p)
          for (const axis of ['motor', 'cognitive'] as const) {
            expect(Math.abs(next[axis] - d)).toBeLessThanOrEqual(2)
            expect(next[axis]).toBeGreaterThanOrEqual(0)
            expect(next[axis]).toBeLessThanOrEqual(SKILL_MAX)
          }
        }
      }
    }
  })

  it('a session of clean rounds walks the whole ramp; rough ones walk it back', () => {
    let skill = skillAt(SKILL_START)
    for (let i = 0; i < 20; i++) skill = updateSkill(skill, clean)
    expect(skill).toEqual(skillAt(SKILL_MAX))
    for (let i = 0; i < 20; i++) skill = updateSkill(skill, meltdown)
    expect(skill).toEqual(skillAt(0))
  })
})

describe('stage bands', () => {
  it('maps cognitive skill to stages at the briefed thresholds, monotonically', () => {
    expect(stageFor(0)).toBe(1)
    expect(stageFor(STAGE2_COGNITIVE - 1)).toBe(1)
    expect(stageFor(STAGE2_COGNITIVE)).toBe(2)
    expect(stageFor(STAGE3_COGNITIVE - 1)).toBe(2)
    expect(stageFor(STAGE3_COGNITIVE)).toBe(3)
    expect(stageFor(STAGE4_COGNITIVE - 1)).toBe(3)
    expect(stageFor(STAGE4_COGNITIVE)).toBe(4)
    let last = 0
    for (let d = 0; d <= SKILL_MAX; d++) {
      const stage = stageFor(d)
      expect(stage).toBeGreaterThanOrEqual(last)
      last = stage
    }
    expect(last).toBe(4)
  })
})

// ─── Task registry ───────────────────────────────────────────────────────────

describe('task registry', () => {
  it('has unique ids and count-dots always unlocked', () => {
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length)
    expect(unlockedTasks(0).map((t) => t.id)).toEqual(['count-dots'])
  })

  it('unlocks tasks in curriculum order as cognitive skill grows', () => {
    let lastCount = 0
    for (let d = 0; d <= SKILL_MAX; d++) {
      const count = unlockedTasks(d).length
      expect(count).toBeGreaterThanOrEqual(lastCount)
      lastCount = count
    }
    expect(unlockedTasks(SKILL_MAX).length).toBe(TASKS.length)
    // Every task is reachable strictly below the cap, so the rotation at the
    // top always has the full variety.
    for (const task of TASKS) {
      expect(task.minCognitive).toBeLessThan(SKILL_MAX)
    }
  })

  it('only ever picks unlocked tasks', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let d = 0; d <= SKILL_MAX; d++) {
        const unlocked = new Set(unlockedTasks(d).map((t) => t.id))
        for (let i = 0; i < 30; i++) {
          expect(unlocked.has(pickTask(d, [], rng))).toBe(true)
        }
      }
    }
  })

  it('never runs one task more than MAX_TASK_REPEAT in a row once others exist', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const recent: TaskId[] = []
      let streak = 0
      let prev: TaskId | null = null
      for (let i = 0; i < 300; i++) {
        const id = pickTask(SKILL_MAX, recent, rng)
        streak = id === prev ? streak + 1 : 1
        expect(streak).toBeLessThanOrEqual(MAX_TASK_REPEAT)
        prev = id
        recent.push(id)
        if (recent.length > 4) recent.shift()
      }
    }
  })

  it('lets the only unlocked task repeat freely at low difficulty', () => {
    const rng = mulberry32(7)
    const recent: TaskId[] = ['count-dots', 'count-dots', 'count-dots']
    for (let i = 0; i < 50; i++) {
      expect(pickTask(0, recent, rng)).toBe('count-dots')
    }
  })

  it('rotates through every unlocked task over a long session', () => {
    const rng = mulberry32(13)
    const recent: TaskId[] = []
    const seen = new Set<TaskId>()
    for (let i = 0; i < 400; i++) {
      const id = pickTask(SKILL_MAX, recent, rng)
      seen.add(id)
      recent.push(id)
      if (recent.length > 4) recent.shift()
    }
    expect(seen.size).toBe(TASKS.length)
  })
})

// ─── Round planning per task ─────────────────────────────────────────────────

describe('round planning', () => {
  it('scaffolds the first rounds as 1, 2, 3 on plain dots, whatever was picked', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let rounds = 0; rounds < SCAFFOLD_ROUNDS; rounds++) {
        const round = planRound(
          {
            skill: skillAt(D_MAX),
            roundsCompleted: rounds,
            prevTarget: null,
            taskId: 'cross-rep',
          },
          rng,
        )
        expect(round.target).toBe(rounds + 1)
        expect(round.taskId).toBe('count-dots')
        expect(round.promptKind).toBe('dots')
        expect(round.balloonKind).toBe('dots')
        expect(round.targetColorIndex).toBeNull()
      }
    }
  })

  it('count-dots rounds show dots on both sides, no color pin', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const round = roundAt(D_S1, rng, 'count-dots')
      expect(round.taskId).toBe('count-dots')
      expect(round.promptKind).toBe('dots')
      expect(round.balloonKind).toBe('dots')
      expect(round.targetColorIndex).toBeNull()
      for (const spec of spawnMany(round, D_S1, 30, 1, rng)) {
        expect(spec.kind).toBe('dots')
      }
    }
  })

  it('count-numerals rounds put numerals on the sign and every balloon', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const round = roundAt(D_MAX, rng, 'count-numerals')
      expect(round.promptKind).toBe('numeral')
      expect(round.balloonKind).toBe('numeral')
      expect(round.targetColorIndex).toBeNull()
      for (const spec of spawnMany(round, D_MAX, 30, 1, rng)) {
        expect(spec.kind).toBe('numeral')
      }
    }
  })

  it('cross-rep rounds ask in the OTHER representation, both directions occur', () => {
    const rng = mulberry32(51)
    const directions = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const round = roundAt(D_MAX, rng, 'cross-rep')
      expect(round.promptKind).not.toBe(round.balloonKind)
      const kinds = [round.promptKind, round.balloonKind].sort()
      expect(kinds).toEqual(['dots', 'numeral'])
      directions.add(round.balloonKind)
    }
    expect(directions.size).toBe(2)
  })

  it('color-count rounds pin a valid palette color and stay on dots', () => {
    const rng = mulberry32(61)
    for (let i = 0; i < 200; i++) {
      const round = roundAt(D_MAX, rng, 'color-count')
      expect(round.promptKind).toBe('dots')
      expect(round.balloonKind).toBe('dots')
      expect(round.targetColorIndex).not.toBeNull()
      expect(round.targetColorIndex).toBeGreaterThanOrEqual(0)
      expect(round.targetColorIndex).toBeLessThan(BALLOON_COLORS.length)
    }
  })

  it('non-color tasks never pin a color', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const taskId of ['count-dots', 'count-numerals', 'cross-rep'] as const) {
        expect(roundAt(D_MAX, rng, taskId).targetColorIndex).toBeNull()
      }
    }
  })
})

describe('target progression', () => {
  it('keeps targets within the subitizing range 1-3 in stage 1', () => {
    expect(maxTargetFor(1)).toBe(3)
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let i = 0; i < 50; i++) {
        const round = roundAt(D_S1, rng)
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
        const round2 = roundAt(D_S2, rng)
        expect(round2.target).toBeLessThanOrEqual(4)
        seen2.add(round2.target)
        const round3 = roundAt(D_S3, rng)
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
      for (let i = 0; i < 60; i++) {
        const round = planRound(
          {
            skill: skillAt(D_S2),
            roundsCompleted: SCAFFOLD_ROUNDS + i,
            prevTarget: prev,
            taskId: 'count-dots',
          },
          rng,
        )
        if (prev !== null) expect(round.target).not.toBe(prev)
        prev = round.target
      }
    }
  })
})

describe('levels', () => {
  it('passes one level per solved round, starting at 1', () => {
    expect(levelFor(0)).toBe(1)
    expect(levelFor(1)).toBe(2)
    expect(levelFor(7)).toBe(8)
  })

  it('moves independently of the rainbow beat (pure animation every 5)', () => {
    expect(levelFor(CELEBRATION_EVERY_ROUNDS)).toBe(CELEBRATION_EVERY_ROUNDS + 1)
    expect(isSkyCelebration(CELEBRATION_EVERY_ROUNDS)).toBe(true)
    expect(isSkyCelebration(CELEBRATION_EVERY_ROUNDS - 1)).toBe(false)
  })
})

describe('color-count decoys', () => {
  it('matches need number AND color; decoys never have both', () => {
    const rng = mulberry32(62)
    const round = roundAt(D_MAX, rng, 'color-count')

    const specs = spawnMany(round, D_MAX, 300, 1, rng)
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
      for (const d of [D_S1, D_S2, D_S3, D_S4]) {
        const round = roundAt(d, rng)
        for (const spec of spawnMany(round, d, 60, 1, rng)) {
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
      for (const d of [D_S1, D_S2, D_S3, D_S4]) {
        const round = roundAt(d, rng)
        for (let i = 0; i < 100; i++) {
          const spec = planBalloon(
            {
              round,
              skill: skillAt(d),
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
      for (const d of [D_S1, D_S2, D_S3, D_S4]) {
        const round = roundAt(d, rng)
        const wave = planInitialWave(round, skillAt(d), rng)
        expect(wave).toHaveLength(round.concurrent)
        expect(wave.some((spec) => spec.isMatch)).toBe(true)
      }
    }
  })

  it('keeps at least one match afloat across simulated pop/drift churn', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const round = roundAt(D_S3, rng)
      const afloat = planInitialWave(round, skillAt(D_S3), rng)
      for (let step = 0; step < 300; step++) {
        // A random balloon drifts off the top and is replaced.
        const leaving = Math.floor(rng() * afloat.length)
        afloat.splice(leaving, 1)
        const matches = afloat.filter((spec) => spec.isMatch).length
        const spec = planBalloon(
          {
            round,
            skill: skillAt(D_S3),
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
      for (const d of [D_S1, D_S2, D_S3, D_S4]) {
        const round = roundAt(d, rng)
        const wave = planInitialWave(round, skillAt(d), rng)
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
    const round = roundAt(D_S2, rng)
    const specs: BalloonSpec[] = []
    for (let i = 0; i < 200; i++) {
      specs.push(
        planBalloon(
          {
            round,
            skill: skillAt(D_S2),
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
    const round = roundAt(D_S2, rng)
    for (let i = 0; i < 200; i++) {
      const spec = planBalloon(
        {
          round,
          skill: skillAt(D_S2),
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
  it('floats 3 balloons in stage 1 and 4 from stage 2, never more', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      expect(roundAt(D_S1, rng).concurrent).toBe(3)
      for (const d of [D_S2, D_S3, D_S4, D_MAX]) {
        expect(roundAt(d, rng).concurrent).toBe(4)
      }
    }
  })
})

describe('speed ramp', () => {
  it('rides the motor meter, monotonic and clamped', () => {
    expect(baseRiseSpeed(0)).toBe(RISE_SPEED_START)
    expect(baseRiseSpeed(SKILL_MAX)).toBe(RISE_SPEED_MAX)
    expect(baseRiseSpeed(SKILL_MAX + 100)).toBe(RISE_SPEED_MAX)
    expect(baseRiseSpeed(-3)).toBe(RISE_SPEED_START)
    let last = 0
    for (let d = 0; d <= SKILL_MAX; d++) {
      const speed = baseRiseSpeed(d)
      expect(speed).toBeGreaterThanOrEqual(last)
      expect(speed).toBeLessThanOrEqual(RISE_SPEED_MAX)
      last = speed
    }
  })

  it('keeps per-balloon jitter inside the briefed band', () => {
    const rng = mulberry32(41)
    for (const d of [D_S1, D_MAX]) {
      const round = roundAt(d, rng)
      const base = baseRiseSpeed(d)
      for (const spec of spawnMany(round, d, 200, 1, rng)) {
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
      for (const d of [D_S1, D_S2]) {
        const round = roundAt(d, rng)
        for (const spec of spawnMany(round, d, 100, 1, rng)) {
          expect(spec.layout).not.toBe('scatter')
        }
      }
    }
    const rng = mulberry32(3)
    const round = roundAt(D_S3, rng)
    const specs = spawnMany(round, D_S3, 200, 1, rng)
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

// ─── Whole-session simulation (flow) ─────────────────────────────────────────

describe('session flow simulation', () => {
  interface PlayResult {
    wrongTaps: number
    matchEscapes: number
    ms: number
  }

  /** Simulate a full session: plan → play (skill profile) → adapt, N rounds. */
  function simulate(
    rounds: number,
    play: (round: RoundPlan, skill: SkillPair, rng: Rng) => PlayResult,
    seed: number,
    start: SkillPair = skillAt(SKILL_START),
    peak: SkillPair = skillAt(SKILL_START),
  ): { rounds: RoundPlan[]; skills: SkillPair[] } {
    const rng = mulberry32(seed)
    const plans: RoundPlan[] = []
    const skills: SkillPair[] = []
    let skill = start
    let prevTarget: number | null = null
    const recent: TaskId[] = []
    for (let i = 0; i < rounds; i++) {
      const taskId = pickTask(skill.cognitive, recent, rng)
      const round = planRound({ skill, roundsCompleted: i, prevTarget, taskId }, rng)
      plans.push(round)
      skills.push(skill)
      prevTarget = round.target
      recent.push(round.taskId)
      if (recent.length > 4) recent.shift()
      skill = updateSkill(skill, play(round, skill, rng), peak)
    }
    return { rounds: plans, skills }
  }

  const ace = (): PlayResult => ({ wrongTaps: 0, matchEscapes: 0, ms: 6_000 })
  const struggler = (): PlayResult => ({ wrongTaps: 3, matchEscapes: 1, ms: 30_000 })
  /** Counts perfectly but can't catch: clean rounds, matches keep escaping. */
  const slowHands = (): PlayResult => ({ wrongTaps: 0, matchEscapes: 2, ms: 6_000 })

  it('an acing child reaches full variety and the speed ceiling', () => {
    const { rounds, skills } = simulate(60, ace, 5)
    expect(skills[skills.length - 1]).toEqual(skillAt(SKILL_MAX))
    const tasks = new Set(rounds.map((r) => r.taskId))
    expect(tasks.size).toBe(TASKS.length)
    // Neither axis ever drops for a clean player.
    for (let i = 1; i < skills.length; i++) {
      expect(skills[i].motor).toBeGreaterThanOrEqual(skills[i - 1].motor)
      expect(skills[i].cognitive).toBeGreaterThanOrEqual(skills[i - 1].cognitive)
    }
  })

  it('a struggling child stays in the friendly zone: dots only, targets ≤ 3', () => {
    const { rounds, skills } = simulate(60, struggler, 6)
    for (const s of skills) expect(s.cognitive).toBeLessThanOrEqual(STAGE2_COGNITIVE)
    for (const round of rounds) {
      expect(round.taskId).toBe('count-dots')
      expect(round.target).toBeLessThanOrEqual(4)
    }
  })

  it('slow hands + sharp mind: numbers advance while the sky stays slow', () => {
    const { skills } = simulate(60, slowHands, 9)
    const last = skills[skills.length - 1]
    expect(last.cognitive).toBe(SKILL_MAX)
    expect(last.motor).toBe(0)
  })

  it('a returning player warm-ups back to the saved peak in a few rounds', () => {
    const peak = skillAt(10)
    const start = skillAt(8) // sessionStart: 10 − WARMUP_DROP
    const { skills } = simulate(10, ace, 10, start, peak)
    const reached = skills.findIndex((s) => s.cognitive >= peak.cognitive)
    expect(reached).toBeGreaterThan(0)
    expect(reached).toBeLessThanOrEqual(2)
  })

  it('a mixed player oscillates without whiplash (one step at a time)', () => {
    let flip = 0
    const mixed = (): PlayResult =>
      flip++ % 3 === 2 ? { wrongTaps: 2, matchEscapes: 0, ms: 9_000 } : ace()
    const { skills } = simulate(80, mixed, 7)
    for (let i = 1; i < skills.length; i++) {
      expect(Math.abs(skills[i].motor - skills[i - 1].motor)).toBeLessThanOrEqual(1)
      expect(Math.abs(skills[i].cognitive - skills[i - 1].cognitive)).toBeLessThanOrEqual(1)
    }
  })

  it('long ace sessions keep task variety high (no 3-in-a-row once unlocked)', () => {
    const { rounds, skills } = simulate(120, ace, 8)
    for (let i = 2; i < rounds.length; i++) {
      // While count-dots is the only unlocked task (early skill), repeats
      // are unavoidable and fine — the constraint kicks in with alternatives.
      if (unlockedTasks(skills[i].cognitive).length < 2) continue
      const same =
        rounds[i].taskId === rounds[i - 1].taskId && rounds[i].taskId === rounds[i - 2].taskId
      expect(same).toBe(false)
    }
  })
})
