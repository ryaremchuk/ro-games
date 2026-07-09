import { describe, expect, it } from 'vitest'
import {
  ACTIVE_POOL_SIZE,
  COLOR_HEX,
  FOODS,
  ROUNDS_PER_LEVEL,
  TRAY_SIZE,
  activePoolForRound,
  bubbleItems,
  foodById,
  generateRound,
  grayedBubbleItems,
  isRoundComplete,
  levelForRound,
  requestTotal,
  stageForRound,
  wantsFood,
} from './logic'
import type { FoodRequest, Rng } from './logic'

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

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1)
const ROUNDS = Array.from({ length: 30 }, (_, i) => i + 1)

describe('food pool', () => {
  it('has at least 12 foods with unique ids and emoji', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(FOODS.map((f) => f.id)).size).toBe(FOODS.length)
    expect(new Set(FOODS.map((f) => f.emoji)).size).toBe(FOODS.length)
  })

  it('gives every food color a palette hex', () => {
    for (const food of FOODS) {
      expect(COLOR_HEX[food.color]).toBeTypeOf('number')
    }
  })

  it('foodById throws on unknown ids', () => {
    expect(() => foodById('pizza-galaxy')).toThrow()
  })
})

describe('ramp state machine', () => {
  it('follows the briefed order exactly', () => {
    const stages = Array.from({ length: 14 }, (_, i) => stageForRound(i + 1))
    expect(stages).toEqual([
      'single',
      'single',
      'count-small',
      'count-small',
      'count-small',
      'color',
      'color',
      'color',
      'count-large',
      'count-large',
      'count-large',
      'combo',
      'combo',
      'combo',
    ])
  })

  it('never regresses and stays at combo for late rounds', () => {
    const order = ['single', 'count-small', 'color', 'count-large', 'combo']
    let last = -1
    for (const round of ROUNDS) {
      const index = order.indexOf(stageForRound(round))
      expect(index).toBeGreaterThanOrEqual(last)
      last = index
    }
    expect(stageForRound(100)).toBe('combo')
  })
})

describe('request validity', () => {
  it('matches stage difficulty bounds and draws from the active pool', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const round of ROUNDS) {
        const { stage, request } = generateRound(round, undefined, rng)
        const poolIds = new Set(activePoolForRound(round).map((f) => f.id))
        const poolColors = new Set(activePoolForRound(round).map((f) => f.color))

        if (request.kind === 'color') {
          expect(stage).toBe('color')
          expect(request.count).toBeGreaterThanOrEqual(2)
          expect(request.count).toBeLessThanOrEqual(3)
          expect(poolColors.has(request.color)).toBe(true)
          continue
        }

        for (const entry of request.entries) {
          expect(poolIds.has(entry.foodId)).toBe(true)
        }
        switch (stage) {
          case 'single':
            expect(request.entries).toHaveLength(1)
            expect(request.entries[0].count).toBe(1)
            break
          case 'count-small':
            expect(request.entries).toHaveLength(1)
            expect(request.entries[0].count).toBeGreaterThanOrEqual(2)
            expect(request.entries[0].count).toBeLessThanOrEqual(3)
            break
          case 'count-large':
            expect(request.entries).toHaveLength(1)
            expect(request.entries[0].count).toBeGreaterThanOrEqual(4)
            expect(request.entries[0].count).toBeLessThanOrEqual(5)
            break
          case 'combo': {
            expect(request.entries).toHaveLength(2)
            const [a, b] = request.entries
            expect(a.foodId).not.toBe(b.foodId)
            expect(a.count).toBeGreaterThanOrEqual(2)
            expect(a.count).toBeLessThanOrEqual(3)
            expect(b.count).toBeGreaterThanOrEqual(1)
            expect(b.count).toBeLessThanOrEqual(2)
            break
          }
          default:
            throw new Error(`count request in unexpected stage ${stage}`)
        }
      }
    }
  })
})

describe('tray composition', () => {
  it('is always satisfiable, sized, and padded with plausible distractors', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const round of ROUNDS) {
        const { request, tray } = generateRound(round, undefined, rng)
        expect(tray).toHaveLength(TRAY_SIZE)
        for (const id of tray) {
          expect(() => foodById(id)).not.toThrow()
        }

        if (request.kind === 'color') {
          const matching = tray.filter((id) => foodById(id).color === request.color)
          // Exactly the requested number of matching foods; the rest are
          // other-colored distractors so "only <color>" stays unambiguous.
          expect(matching).toHaveLength(request.count)
        } else {
          const requestedIds = new Set(request.entries.map((e) => e.foodId))
          for (const entry of request.entries) {
            expect(tray.filter((id) => id === entry.foodId)).toHaveLength(entry.count)
          }
          const distractors = tray.filter((id) => !requestedIds.has(id))
          expect(distractors.length).toBe(TRAY_SIZE - requestTotal(request))
        }

        // At least a few distractors every round (request total caps at 5).
        expect(TRAY_SIZE - requestTotal(request)).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('variety', () => {
  it('never repeats the previous primary target back-to-back', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      let previous: FoodRequest | undefined
      for (const round of ROUNDS) {
        const { request } = generateRound(round, previous, rng)
        if (previous) {
          if (previous.kind === 'color' && request.kind === 'color') {
            expect(request.color).not.toBe(previous.color)
          }
          if (previous.kind === 'count' && request.kind === 'count') {
            expect(request.entries[0].foodId).not.toBe(previous.entries[0].foodId)
          }
        }
        previous = request
      }
    }
  })

  it('rotates new foods into the active pool every 3 rounds', () => {
    const ids = (round: number) => activePoolForRound(round).map((f) => f.id)
    expect(ids(1)).toEqual(ids(2))
    expect(ids(1)).toEqual(ids(3))
    expect(ids(4)).not.toEqual(ids(3))
    // Rotation is a slide, not a reshuffle: pools overlap but differ.
    expect(ids(4).filter((id) => ids(1).includes(id)).length).toBeGreaterThan(0)
    for (const round of [1, 10, 50, 200]) {
      const pool = activePoolForRound(round)
      expect(pool).toHaveLength(ACTIVE_POOL_SIZE)
      for (const food of pool) {
        expect(FOODS).toContain(food)
      }
    }
  })
})

describe('feeding rules', () => {
  const combo: FoodRequest = {
    kind: 'count',
    entries: [
      { foodId: 'apple', count: 2 },
      { foodId: 'banana', count: 1 },
    ],
  }

  it('accepts requested foods until their count is met', () => {
    expect(wantsFood(combo, [], 'apple')).toBe(true)
    expect(wantsFood(combo, [], 'banana')).toBe(true)
    expect(wantsFood(combo, [], 'cookie')).toBe(false)
    expect(wantsFood(combo, ['apple', 'apple'], 'apple')).toBe(false)
    expect(wantsFood(combo, ['apple', 'apple'], 'banana')).toBe(true)
  })

  it('accepts any food of the requested color, up to the count', () => {
    const request: FoodRequest = { kind: 'color', color: 'red', count: 2 }
    expect(wantsFood(request, [], 'apple')).toBe(true)
    expect(wantsFood(request, [], 'strawberry')).toBe(true)
    expect(wantsFood(request, [], 'banana')).toBe(false)
    expect(wantsFood(request, ['apple', 'tomato'], 'strawberry')).toBe(false)
  })

  it('completes exactly when every requested item is eaten', () => {
    expect(isRoundComplete(combo, [])).toBe(false)
    expect(isRoundComplete(combo, ['apple', 'banana'])).toBe(false)
    expect(isRoundComplete(combo, ['apple', 'banana', 'apple'])).toBe(true)
    expect(requestTotal(combo)).toBe(3)
  })
})

describe('thought bubble pictures', () => {
  it('repeats emoji per requested count, in entry order', () => {
    const combo: FoodRequest = {
      kind: 'count',
      entries: [
        { foodId: 'apple', count: 2 },
        { foodId: 'banana', count: 1 },
      ],
    }
    expect(bubbleItems(combo).map((item) => item.emoji)).toEqual(['🍎', '🍎', '🍌'])
  })

  it('shows N color splashes for color requests', () => {
    const request: FoodRequest = { kind: 'color', color: 'green', count: 3 }
    expect(bubbleItems(request)).toEqual([
      { color: 'green' },
      { color: 'green' },
      { color: 'green' },
    ])
  })

  it('grays out the right pictures even when a combo is fed out of order', () => {
    const combo: FoodRequest = {
      kind: 'count',
      entries: [
        { foodId: 'apple', count: 2 },
        { foodId: 'banana', count: 1 },
      ],
    }
    expect(grayedBubbleItems(combo, [])).toEqual([false, false, false])
    // Banana eaten first: the banana slot grays, not the first apple slot.
    expect(grayedBubbleItems(combo, ['banana'])).toEqual([false, false, true])
    expect(grayedBubbleItems(combo, ['banana', 'apple'])).toEqual([true, false, true])
    expect(grayedBubbleItems(combo, ['banana', 'apple', 'apple'])).toEqual([true, true, true])
  })

  it('always matches the request total in length', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const rng = mulberry32(seed)
      for (const round of ROUNDS) {
        const { request } = generateRound(round, undefined, rng)
        expect(bubbleItems(request)).toHaveLength(requestTotal(request))
        expect(grayedBubbleItems(request, [])).toHaveLength(requestTotal(request))
      }
    }
  })
})

describe('levels', () => {
  it('advances one level per 3 rounds, aligned with the big celebration', () => {
    expect(levelForRound(1)).toBe(1)
    expect(levelForRound(ROUNDS_PER_LEVEL)).toBe(1)
    expect(levelForRound(ROUNDS_PER_LEVEL + 1)).toBe(2)
    expect(levelForRound(2 * ROUNDS_PER_LEVEL)).toBe(2)
    expect(levelForRound(2 * ROUNDS_PER_LEVEL + 1)).toBe(3)
    expect(levelForRound(0)).toBe(1) // defensive: never below level 1
  })

  it('is monotonic in round number', () => {
    let last = 0
    for (let round = 1; round <= 40; round++) {
      const level = levelForRound(round)
      expect(level).toBeGreaterThanOrEqual(last)
      last = level
    }
  })
})
