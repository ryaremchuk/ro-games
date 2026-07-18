import { describe, expect, it } from 'vitest'
import {
  BANK,
  BASIC_GROUPS,
  COLOR_GROUPS,
  CONCEPT_PAIRS,
  CORRECT_TO_ADVANCE,
  FLAWLESS_TO_ADVANCE,
  MAX_LEVEL,
  MIN_LEVEL,
  MISSES_TO_DROP,
  PUZZLE_SIZE,
  SHAPE_GROUPS,
  SIGNATURE_WINDOW,
  STAR_EVERY_SOLVES,
  TRIO_SHAPES,
  TRIO_SIZE,
  TRIO_SUPERORDINATES,
  WARMUP_CORRECT_TO_ADVANCE,
  WARMUP_FLAWLESS_TO_ADVANCE,
  clampLevel,
  dimensionForLevel,
  earnsStar,
  generatePuzzle,
  initialSessionState,
  nextPuzzle,
  registerMiss,
  registerSolve,
  showHint,
} from './logic'
import type { Level, Puzzle, Rng, SessionState } from './logic'

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

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)
const LEVELS: Level[] = [1, 2, 3, 4, 5]

function stateAtLevel(level: Level, overrides: Partial<SessionState> = {}): SessionState {
  return { ...initialSessionState(), level, ...overrides }
}

function trioOf(puzzle: Puzzle) {
  return puzzle.items.filter((_, i) => i !== puzzle.oddIndex)
}

function oddOf(puzzle: Puzzle) {
  return puzzle.items[puzzle.oddIndex]
}

// ─── Bank metadata integrity ─────────────────────────────────────────────────

describe('item bank', () => {
  it('has at least 40 items with unique ids and emoji', () => {
    expect(BANK.length).toBeGreaterThanOrEqual(40)
    expect(new Set(BANK.map((i) => i.id)).size).toBe(BANK.length)
    expect(new Set(BANK.map((i) => i.emoji)).size).toBe(BANK.length)
  })

  it('gives every item a name, emoji, theme and basic category', () => {
    for (const item of BANK) {
      expect(item.name.length).toBeGreaterThan(0)
      expect(item.emoji.length).toBeGreaterThan(0)
      expect(item.theme.length).toBeGreaterThan(0)
      expect(item.basic.length).toBeGreaterThan(0)
    }
  })

  it('spans enough themes to rotate pools between rounds', () => {
    expect(new Set(BANK.map((i) => i.theme)).size).toBeGreaterThanOrEqual(5)
  })

  it('has ≥3 color-variant families, each with ≥2 colors of the same thing', () => {
    expect(COLOR_GROUPS.size).toBeGreaterThanOrEqual(3)
    for (const [, items] of COLOR_GROUPS) {
      expect(new Set(items.map((i) => i.color)).size).toBeGreaterThanOrEqual(2)
      // Same thing in different colors: one basic, one superordinate, one shape.
      expect(new Set(items.map((i) => i.basic)).size).toBe(1)
      expect(new Set(items.map((i) => i.superordinate)).size).toBe(1)
      expect(new Set(items.map((i) => i.shape)).size).toBe(1)
    }
  })

  it('has ≥3 shape groups big enough for a trio, plus odd candidates for each', () => {
    expect(TRIO_SHAPES.length).toBeGreaterThanOrEqual(3)
    for (const shape of TRIO_SHAPES) {
      expect(SHAPE_GROUPS.get(shape)?.length).toBeGreaterThanOrEqual(TRIO_SIZE)
      const odds = BANK.filter((i) => i.shape !== undefined && i.shape !== shape)
      expect(odds.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('has ≥3 big and ≥3 small animals for size puzzles', () => {
    const animals = BANK.filter((i) => i.theme === 'animals')
    expect(animals.filter((i) => i.size === 'big').length).toBeGreaterThanOrEqual(TRIO_SIZE)
    expect(animals.filter((i) => i.size === 'small').length).toBeGreaterThanOrEqual(TRIO_SIZE)
  })

  it('has ≥4 basic-category trio groups, single-superordinate, with odd candidates', () => {
    expect(BASIC_GROUPS.size).toBeGreaterThanOrEqual(4)
    for (const [basic, items] of BASIC_GROUPS) {
      expect(items.length).toBeGreaterThanOrEqual(TRIO_SIZE)
      expect(new Set(items.map((i) => i.superordinate)).size).toBe(1)
      const superordinate = items[0].superordinate
      const odds = BANK.filter(
        (i) =>
          i.basic !== basic && i.superordinate !== superordinate && i.superordinate !== 'shape',
      )
      expect(odds.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('has rich superordinate pools spanning ≥2 basics, with odd candidates', () => {
    for (const superordinate of TRIO_SUPERORDINATES) {
      const items = BANK.filter((i) => i.superordinate === superordinate)
      expect(items.length).toBeGreaterThanOrEqual(TRIO_SIZE)
      expect(new Set(items.map((i) => i.basic)).size).toBeGreaterThanOrEqual(2)
      const odds = BANK.filter(
        (i) => i.superordinate !== superordinate && i.superordinate !== 'shape',
      )
      expect(odds.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('has ≥3 trio items and ≥1 odd item for every concept contrast', () => {
    for (const [shared, opposite] of CONCEPT_PAIRS) {
      const trio = BANK.filter((i) => i.concepts.includes(shared))
      const odds = BANK.filter((i) => i.concepts.includes(opposite) && !i.concepts.includes(shared))
      expect(trio.length).toBeGreaterThanOrEqual(TRIO_SIZE)
      expect(odds.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('never tags one item with both sides of a concept contrast', () => {
    for (const [shared, opposite] of CONCEPT_PAIRS) {
      for (const item of BANK) {
        expect(item.concepts.includes(shared) && item.concepts.includes(opposite)).toBe(false)
      }
    }
  })
})

// ─── Puzzle validity per level ───────────────────────────────────────────────

describe('puzzle generation', () => {
  it('maps levels to the researched dimension ladder', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      expect(dimensionForLevel(1, rng)).toBe('color')
      expect(['shape', 'size']).toContain(dimensionForLevel(2, rng))
      expect(dimensionForLevel(3, rng)).toBe('basic')
      expect(dimensionForLevel(4, rng)).toBe('superordinate')
      expect(dimensionForLevel(5, rng)).toBe('concept')
    }
  })

  const validate = (puzzle: Puzzle) => {
    expect(puzzle.items).toHaveLength(PUZZLE_SIZE)
    expect(puzzle.oddIndex).toBeGreaterThanOrEqual(0)
    expect(puzzle.oddIndex).toBeLessThan(PUZZLE_SIZE)
    const trio = trioOf(puzzle)
    const odd = oddOf(puzzle)
    expect(trio).toHaveLength(TRIO_SIZE)

    switch (puzzle.dimension) {
      case 'color':
        // 3 of the same thing in one color; the odd is the SAME thing in
        // another color — color is the only clean discriminator.
        for (const item of trio) expect(item.color).toBe(puzzle.attribute)
        expect(odd.color).not.toBe(puzzle.attribute)
        expect(odd.variantGroup).toBe(trio[0].variantGroup)
        expect(new Set(trio.map((i) => i.id)).size).toBe(1)
        break
      case 'shape':
        for (const item of trio) expect(item.shape).toBe(puzzle.attribute)
        expect(odd.shape).toBeDefined()
        expect(odd.shape).not.toBe(puzzle.attribute)
        break
      case 'size':
        for (const item of puzzle.items) expect(item.theme).toBe('animals')
        for (const item of trio) expect(item.size).toBe(puzzle.attribute)
        expect(odd.size).not.toBe(puzzle.attribute)
        break
      case 'basic':
        for (const item of trio) expect(item.basic).toBe(puzzle.attribute)
        expect(odd.basic).not.toBe(puzzle.attribute)
        // Cross-superordinate odd (3 fish + 1 tractor), never another shape.
        expect(odd.superordinate).not.toBe(trio[0].superordinate)
        expect(odd.superordinate).not.toBe('shape')
        break
      case 'superordinate':
        for (const item of trio) expect(item.superordinate).toBe(puzzle.attribute)
        // A genuinely superordinate trio spans ≥2 basic categories.
        expect(new Set(trio.map((i) => i.basic)).size).toBeGreaterThanOrEqual(2)
        expect(odd.superordinate).not.toBe(puzzle.attribute)
        expect(odd.superordinate).not.toBe('shape')
        break
      case 'concept': {
        for (const item of trio) expect(item.concepts).toContain(puzzle.attribute)
        // The odd must NOT share the discriminating concept, and must carry
        // the contrasting one (3 fliers + 1 swimmer, 3 hot + 1 cold).
        expect(odd.concepts).not.toContain(puzzle.attribute)
        const pair = CONCEPT_PAIRS.find(([shared]) => shared === puzzle.attribute)
        expect(pair).toBeDefined()
        if (pair) expect(odd.concepts).toContain(pair[1])
        break
      }
    }

    // Non-color trios are 3 distinct items (color rounds repeat one item on
    // purpose: 🍎🍎🍎 + 🍏 reads clearest for a 4yo).
    if (puzzle.dimension !== 'color') {
      expect(new Set(puzzle.items.map((i) => i.id)).size).toBe(PUZZLE_SIZE)
    }
  }

  it.each(LEVELS)('level %i puzzles have 4 items and exactly 1 genuine odd', (level) => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed * 31 + level)
      let history: string[] = []
      let lastGroupKey: string | null = null
      for (let round = 0; round < 8; round++) {
        const puzzle = generatePuzzle(level, rng, { recentSignatures: history, lastGroupKey })
        expect(puzzle.level).toBe(level)
        validate(puzzle)
        history = [...history, puzzle.signature].slice(-SIGNATURE_WINDOW)
        lastGroupKey = puzzle.groupKey
      }
    }
  })

  it.each(LEVELS)('level %i uses the dimension its rung prescribes', (level) => {
    const expected: Record<Level, string[]> = {
      1: ['color'],
      2: ['shape', 'size'],
      3: ['basic'],
      4: ['superordinate'],
      5: ['concept'],
    }
    for (const seed of SEEDS) {
      const puzzle = generatePuzzle(level, mulberry32(seed))
      expect(expected[level]).toContain(puzzle.dimension)
    }
  })

  it('never repeats a puzzle inside the session window, and rotates themes', () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS.slice(0, 10)) {
        const rng = mulberry32(seed * 101 + level)
        let state = stateAtLevel(level)
        const signatures: string[] = []
        const groupKeys: string[] = []
        for (let round = 0; round < 12; round++) {
          const puzzle = nextPuzzle(state, rng)
          signatures.push(puzzle.signature)
          groupKeys.push(puzzle.groupKey)
          // Keep the level pinned so the whole chain exercises this rung.
          state = { ...registerSolve(state, puzzle), level }
        }
        for (let i = 0; i < signatures.length; i++) {
          const window = signatures.slice(Math.max(0, i - SIGNATURE_WINDOW), i)
          expect(window).not.toContain(signatures[i])
        }
        for (let i = 1; i < groupKeys.length; i++) {
          expect(groupKeys[i]).not.toBe(groupKeys[i - 1])
        }
      }
    }
  })
})

// ─── Level state machine ─────────────────────────────────────────────────────

describe('session state machine', () => {
  const solvedPuzzle = (level: Level, seed = 1) => generatePuzzle(level, mulberry32(seed))

  it('starts at level 1 with clean counters', () => {
    const state = initialSessionState()
    expect(state.level).toBe(MIN_LEVEL)
    expect(state.correctAtLevel).toBe(0)
    expect(state.flawlessStreak).toBe(0)
    expect(state.missesThisRound).toBe(0)
    expect(state.roundsCompleted).toBe(0)
    expect(state.recentSignatures).toEqual([])
    expect(state.lastGroupKey).toBeNull()
  })

  it('counts misses within the round without touching the level', () => {
    let state = stateAtLevel(3)
    state = registerMiss(state)
    expect(state.missesThisRound).toBe(1)
    expect(state.level).toBe(3)
    state = registerMiss(state)
    expect(state.missesThisRound).toBe(2)
    expect(state.level).toBe(3)
  })

  it('shows the pulse-glow hint from the first miss onward', () => {
    let state = stateAtLevel(2)
    expect(showHint(state)).toBe(false)
    state = registerMiss(state)
    expect(showHint(state)).toBe(true)
    state = registerMiss(state)
    expect(showHint(state)).toBe(true)
  })

  it(`advances after ${CORRECT_TO_ADVANCE} correct rounds at a level`, () => {
    let state = stateAtLevel(3)
    for (let i = 0; i < CORRECT_TO_ADVANCE; i++) {
      expect(state.level).toBe(3)
      // One miss per round: correct still counts, but never the fast-track.
      state = registerMiss(state)
      state = registerSolve(state, solvedPuzzle(3, i + 1))
    }
    expect(state.level).toBe(4)
    expect(state.correctAtLevel).toBe(0)
    expect(state.flawlessStreak).toBe(0)
  })

  it(`fast-tracks after ${FLAWLESS_TO_ADVANCE} flawless rounds in a row`, () => {
    let state = stateAtLevel(2)
    state = registerSolve(state, solvedPuzzle(2, 1))
    expect(state.level).toBe(2)
    state = registerSolve(state, solvedPuzzle(2, 2))
    expect(state.level).toBe(3)
  })

  it('a missed round breaks the flawless streak but still counts as correct', () => {
    let state = stateAtLevel(2)
    state = registerSolve(state, solvedPuzzle(2, 1)) // flawless #1
    state = registerMiss(state)
    state = registerSolve(state, solvedPuzzle(2, 2)) // correct #2, streak reset
    expect(state.level).toBe(2)
    expect(state.correctAtLevel).toBe(2)
    expect(state.flawlessStreak).toBe(0)
    state = registerSolve(state, solvedPuzzle(2, 3)) // correct #3 → advance
    expect(state.level).toBe(3)
  })

  it(`drops one level after ${MISSES_TO_DROP} misses in one round — only between rounds`, () => {
    let state = stateAtLevel(4, { correctAtLevel: 1 })
    state = registerMiss(state)
    state = registerMiss(state)
    // Still mid-round: the rule (and level) must not change yet.
    expect(state.level).toBe(4)
    state = registerSolve(state, solvedPuzzle(4))
    expect(state.level).toBe(3)
    expect(state.correctAtLevel).toBe(0)
    expect(state.flawlessStreak).toBe(0)
    expect(state.missesThisRound).toBe(0)
  })

  it('a rough round does not count toward advancing', () => {
    let state = stateAtLevel(2, { correctAtLevel: 2 })
    state = registerMiss(state)
    state = registerMiss(state)
    state = registerSolve(state, solvedPuzzle(2))
    expect(state.level).toBe(1)
    expect(state.correctAtLevel).toBe(0)
  })

  it('never drops below level 1 and never climbs above level 5', () => {
    let floor = stateAtLevel(MIN_LEVEL)
    floor = registerMiss(floor)
    floor = registerMiss(floor)
    floor = registerSolve(floor, solvedPuzzle(MIN_LEVEL))
    expect(floor.level).toBe(MIN_LEVEL)

    let ceiling = stateAtLevel(MAX_LEVEL)
    for (let i = 0; i < 6; i++) {
      ceiling = registerSolve(ceiling, solvedPuzzle(MAX_LEVEL, i + 1))
      expect(ceiling.level).toBe(MAX_LEVEL)
    }
  })

  it('resets the miss counter every round', () => {
    let state = stateAtLevel(3)
    state = registerMiss(state)
    state = registerSolve(state, solvedPuzzle(3))
    expect(state.missesThisRound).toBe(0)
  })

  it('records history: rounds, signature window and last theme group', () => {
    let state = initialSessionState()
    const seen: string[] = []
    for (let i = 0; i < SIGNATURE_WINDOW + 3; i++) {
      const puzzle = solvedPuzzle(state.level, i + 1)
      seen.push(puzzle.signature)
      state = registerSolve(state, puzzle)
      expect(state.lastGroupKey).toBe(puzzle.groupKey)
    }
    expect(state.roundsCompleted).toBe(SIGNATURE_WINDOW + 3)
    expect(state.recentSignatures).toEqual(seen.slice(-SIGNATURE_WINDOW))
  })

  it('nextPuzzle generates at the session level', () => {
    for (const level of LEVELS) {
      const puzzle = nextPuzzle(stateAtLevel(level), mulberry32(7))
      expect(puzzle.level).toBe(level)
    }
  })
})

// ─── Persistence warm-up (session start below the saved peak) ────────────────

describe('session warm-up and peak fast-track', () => {
  const solvedPuzzle = (level: Level, seed = 1) => generatePuzzle(level, mulberry32(seed))

  it('seeds start and peak levels, clamped to the ladder', () => {
    const state = initialSessionState(3, 4)
    expect(state.level).toBe(3)
    expect(state.peakLevel).toBe(4)
    // Peak can never sit below the start.
    expect(initialSessionState(4, 2).peakLevel).toBe(4)
    expect(initialSessionState(9 as Level, 9 as Level).level).toBe(MAX_LEVEL)
    expect(clampLevel(0)).toBe(MIN_LEVEL)
    expect(clampLevel(99)).toBe(MAX_LEVEL)
  })

  it(`climbs after ${WARMUP_CORRECT_TO_ADVANCE} correct (not ${CORRECT_TO_ADVANCE}) below the peak`, () => {
    let state = initialSessionState(2, 4)
    for (let i = 0; i < WARMUP_CORRECT_TO_ADVANCE; i++) {
      expect(state.level).toBe(2)
      state = registerMiss(state) // one miss per round: correct, never flawless
      state = registerSolve(state, solvedPuzzle(2, i + 1))
    }
    expect(state.level).toBe(3)
  })

  it(`fast-tracks after ${WARMUP_FLAWLESS_TO_ADVANCE} flawless below the peak`, () => {
    let state = initialSessionState(2, 4)
    state = registerSolve(state, solvedPuzzle(2, 1))
    expect(state.level).toBe(3)
  })

  it('returns to normal pacing once the peak is reached', () => {
    let state = initialSessionState(3, 4)
    state = registerSolve(state, solvedPuzzle(3, 1)) // warm-up flawless → L4 = peak
    expect(state.level).toBe(4)
    state = registerSolve(state, solvedPuzzle(4, 2)) // at peak: one flawless is not enough
    expect(state.level).toBe(4)
    state = registerSolve(state, solvedPuzzle(4, 3)) // two flawless → normal fast-track
    expect(state.level).toBe(5)
    expect(state.peakLevel).toBe(5)
  })

  it('keeps the peak intact through a mid-session drop', () => {
    let state = initialSessionState(4, 4)
    state = registerMiss(state)
    state = registerMiss(state)
    state = registerSolve(state, solvedPuzzle(4, 1)) // rough round → L3
    expect(state.level).toBe(3)
    expect(state.peakLevel).toBe(4)
    // Below the peak again, so the way back is the fast one.
    state = registerSolve(state, solvedPuzzle(3, 2))
    expect(state.level).toBe(4)
  })
})

describe('star beat', () => {
  it(`banks a star exactly every ${STAR_EVERY_SOLVES} solves`, () => {
    expect(earnsStar(0)).toBe(false)
    expect(earnsStar(STAR_EVERY_SOLVES - 1)).toBe(false)
    expect(earnsStar(STAR_EVERY_SOLVES)).toBe(true)
    expect(earnsStar(STAR_EVERY_SOLVES + 1)).toBe(false)
    expect(earnsStar(STAR_EVERY_SOLVES * 3)).toBe(true)
  })
})
