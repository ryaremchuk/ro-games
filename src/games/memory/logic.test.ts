import { describe, expect, it } from 'vitest'
import { cardsForLevel, dealBoard, isMatch, rowsFor } from './logic'
import type { BoardCard, Rng } from './logic'

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

/** A 16-subject pool mirroring art.ts (only the keys matter here). */
const SUBJECTS = [
  'chase',
  'marshall',
  'skye',
  'rubble',
  'rocky',
  'zuma',
  'everest',
  'police-truck',
  'fire-truck',
  'helicopter',
  'bulldozer',
  'hovercraft',
  'snowplow',
  'badge',
  'bone',
  'lookout-tower',
] as const

const COUNTS = [4, 6, 8, 10] as const

function counts<T>(items: readonly T[], key: (t: T) => string): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return map
}

function boardKey(board: BoardCard[]): string {
  return board.map((c) => c.subjectKey).join(',')
}

describe('cardsForLevel', () => {
  it('follows the fixed level table', () => {
    expect(cardsForLevel(1)).toBe(4)
    expect(cardsForLevel(2)).toBe(4)
    expect(cardsForLevel(3)).toBe(6)
    expect(cardsForLevel(4)).toBe(6)
    expect(cardsForLevel(5)).toBe(8)
    expect(cardsForLevel(6)).toBe(8)
    expect(cardsForLevel(7)).toBe(10)
    expect(cardsForLevel(8)).toBe(10)
    expect(cardsForLevel(50)).toBe(10)
  })

  it('is defensive about junk input (level < 1 → 4)', () => {
    expect(cardsForLevel(0)).toBe(4)
    expect(cardsForLevel(-3)).toBe(4)
    expect(cardsForLevel(Number.NaN)).toBe(4)
  })

  it('is monotonic in level', () => {
    let last = 0
    for (let level = 1; level <= 20; level++) {
      const n = cardsForLevel(level)
      expect(n).toBeGreaterThanOrEqual(last)
      last = n
    }
    expect(last).toBe(10)
  })
})

describe('dealBoard', () => {
  it('deals exactly cardCount cards for every count and seed', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const count of COUNTS) {
        const board = dealBoard(count, SUBJECTS, rng)
        expect(board.length).toBe(count)
      }
    }
  })

  it('gives every subject exactly two cards (pair integrity)', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const count of COUNTS) {
        const board = dealBoard(count, SUBJECTS, rng)
        for (const n of counts(board, (c) => c.subjectKey).values()) expect(n).toBe(2)
        for (const n of counts(board, (c) => String(c.pairId)).values()) expect(n).toBe(2)
      }
    }
  })

  it('uses cardCount/2 distinct subjects with no repeats within a board', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const count of COUNTS) {
        const board = dealBoard(count, SUBJECTS, rng)
        const distinct = new Set(board.map((c) => c.subjectKey))
        expect(distinct.size).toBe(count / 2)
      }
    }
  })

  it('pairs a subjectKey with a single stable pairId', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const board = dealBoard(10, SUBJECTS, rng)
      const byKey = new Map<string, number>()
      for (const card of board) {
        const seen = byKey.get(card.subjectKey)
        if (seen === undefined) byKey.set(card.subjectKey, card.pairId)
        else expect(card.pairId).toBe(seen)
      }
    }
  })

  it('actually permutes — boards differ across seeds', () => {
    const boards = SEEDS.map((seed) => boardKey(dealBoard(10, SUBJECTS, mulberry32(seed))))
    // Not all ten seeded 10-card boards should be identical strings.
    expect(new Set(boards).size).toBeGreaterThan(1)
  })

  it('picks fresh random subject sets across seeds (level-1 replays vary)', () => {
    const sets = SEEDS.map((seed) => {
      const board = dealBoard(4, SUBJECTS, mulberry32(seed))
      return [...new Set(board.map((c) => c.subjectKey))].sort().join(',')
    })
    expect(new Set(sets).size).toBeGreaterThan(1)
  })

  it('throws when there are not enough distinct subjects', () => {
    expect(() => dealBoard(10, ['a', 'b', 'c'], mulberry32(1))).toThrow()
  })
})

describe('isMatch', () => {
  it('matches same subject, rejects different subjects', () => {
    expect(isMatch({ subjectKey: 'chase', pairId: 0 }, { subjectKey: 'chase', pairId: 0 })).toBe(
      true,
    )
    expect(isMatch({ subjectKey: 'chase', pairId: 0 }, { subjectKey: 'skye', pairId: 1 })).toBe(
      false,
    )
  })
})

describe('rowsFor', () => {
  it('always sums to cardCount in both orientations', () => {
    for (const count of COUNTS) {
      for (const portrait of [true, false]) {
        const rows = rowsFor(count, portrait)
        expect(rows.reduce((a, b) => a + b, 0)).toBe(count)
      }
    }
  })

  it('uses the briefed grid shapes', () => {
    expect(rowsFor(4, true)).toEqual([2, 2])
    expect(rowsFor(4, false)).toEqual([2, 2])
    expect(rowsFor(6, false)).toEqual([3, 3])
    expect(rowsFor(6, true)).toEqual([2, 2, 2])
    expect(rowsFor(8, false)).toEqual([4, 4])
    expect(rowsFor(8, true)).toEqual([3, 2, 3])
    expect(rowsFor(10, false)).toEqual([5, 5])
    expect(rowsFor(10, true)).toEqual([3, 4, 3])
  })
})
