import { describe, expect, it } from 'vitest'
import {
  ACTIVE_POOL_SIZE,
  BIG_CELEBRATION_EVERY_ROUNDS,
  COLOR_HEX,
  FAST_ROUND_MS,
  FOODS,
  KIND_HISTORY,
  NOT_COLOR_MIN_SKILL,
  SKILL_MAX,
  SKILL_START,
  SPIT_BACKS_BEFORE_EASE,
  TASK_REGISTRY,
  TRAY_SIZE,
  activePoolForRound,
  bubbleItems,
  colorTargetRange,
  countTargetRange,
  dotsTargetRange,
  foodById,
  generateRound,
  grayedBubbleItems,
  isBigCelebrationRound,
  isRoundComplete,
  levelForRound,
  pickTaskKind,
  requestTotal,
  unlockedKinds,
  updateSkill,
  wantsFood,
} from './logic'
import type { FoodRequest, Rng, TaskKind } from './logic'

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
const SKILLS = Array.from({ length: SKILL_MAX + 1 }, (_, i) => i)
const ALL_KINDS = TASK_REGISTRY.map((def) => def.kind)

/** Greedily feed the monster from the tray; true if the round can complete. */
function simulateFeed(request: FoodRequest, tray: readonly string[]): boolean {
  const eaten: string[] = []
  const remaining = [...tray]
  while (!isRoundComplete(request, eaten)) {
    const index = remaining.findIndex((id) => wantsFood(request, eaten, id))
    if (index < 0) return false
    eaten.push(remaining[index])
    remaining.splice(index, 1)
  }
  return true
}

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

  it('keeps every color inside every active-pool window (color rounds satisfiable)', () => {
    // ROUNDS spans every rotation shift of the 18-food cycle (shift repeats
    // every 27 rounds), so this genuinely sweeps all windows.
    for (const round of [...ROUNDS, 100, 1000]) {
      const colors = new Set(activePoolForRound(round).map((f) => f.color))
      expect(colors.size).toBe(Object.keys(COLOR_HEX).length)
    }
  })
})

describe('adaptive meter formula', () => {
  it('steps up on a clean quick round', () => {
    expect(updateSkill(4, { spitBacks: 0, ms: FAST_ROUND_MS - 1 })).toBe(5)
  })

  it('climbs at double speed below the saved peak', () => {
    expect(updateSkill(4, { spitBacks: 0, ms: 1000 }, 8)).toBe(6)
    expect(updateSkill(8, { spitBacks: 0, ms: 1000 }, 8)).toBe(9)
  })

  it('holds on a single slip or a slow round', () => {
    expect(updateSkill(4, { spitBacks: 1, ms: 1000 })).toBe(4)
    expect(updateSkill(4, { spitBacks: 0, ms: FAST_ROUND_MS + 1 })).toBe(4)
  })

  it('eases down after repeated spit-backs, never punishing hard', () => {
    expect(updateSkill(4, { spitBacks: SPIT_BACKS_BEFORE_EASE, ms: 1000 })).toBe(3)
    expect(updateSkill(4, { spitBacks: 9, ms: 1000 })).toBe(3)
  })

  it('clamps to the meter range', () => {
    expect(updateSkill(SKILL_START, { spitBacks: 5, ms: 1000 })).toBe(SKILL_START)
    expect(updateSkill(SKILL_MAX, { spitBacks: 0, ms: 1000 })).toBe(SKILL_MAX)
    expect(updateSkill(SKILL_MAX - 1, { spitBacks: 0, ms: 1000 }, SKILL_MAX)).toBe(SKILL_MAX)
  })
})

describe('task registry', () => {
  it('starts with single only and retires it once counting is on', () => {
    expect(unlockedKinds(0)).toEqual(['single'])
    expect(unlockedKinds(2)).toContain('single')
    expect(unlockedKinds(3)).not.toContain('single')
  })

  it('unlocks every kind by the top of the meter', () => {
    const atMax = unlockedKinds(SKILL_MAX)
    for (const def of TASK_REGISTRY) {
      if (def.maxSkill >= SKILL_MAX) expect(atMax).toContain(def.kind)
    }
    expect(atMax).toContain('mix')
    expect(atMax).toContain('not')
    expect(atMax).toContain('pattern')
  })

  it('picks only unlocked kinds', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const skill of SKILLS) {
        const kind = pickTaskKind(skill, [], rng)
        expect(unlockedKinds(skill)).toContain(kind)
      }
    }
  })

  it('avoids the recent kinds whenever alternatives exist', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const recent: TaskKind[] = []
      for (let i = 0; i < 40; i++) {
        const kind = pickTaskKind(SKILL_MAX, recent, rng)
        const avoid = recent.slice(-KIND_HISTORY)
        expect(avoid).not.toContain(kind)
        recent.push(kind)
      }
    }
  })
})

describe('request validity per kind', () => {
  it('respects each kind difficulty dial at every skill', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const rng = mulberry32(seed)
      for (const skill of SKILLS) {
        for (const kind of ALL_KINDS) {
          const round = 1 + ((seed + skill) % 30)
          const { request, taskKind } = generateRound({ round, skill, forceKind: kind }, rng)
          expect(taskKind).toBe(kind)
          const poolIds = new Set(activePoolForRound(round).map((f) => f.id))
          const poolColors = new Set(activePoolForRound(round).map((f) => f.color))

          switch (request.kind) {
            case 'count': {
              for (const entry of request.entries) expect(poolIds.has(entry.foodId)).toBe(true)
              if (kind === 'single') {
                expect(request.entries).toHaveLength(1)
                expect(request.entries[0].count).toBe(1)
              } else if (kind === 'count') {
                const { min, max } = countTargetRange(skill)
                expect(request.entries).toHaveLength(1)
                expect(request.entries[0].count).toBeGreaterThanOrEqual(min)
                expect(request.entries[0].count).toBeLessThanOrEqual(max)
              } else {
                expect(request.entries).toHaveLength(2)
                expect(request.entries[0].foodId).not.toBe(request.entries[1].foodId)
              }
              break
            }
            case 'color': {
              const { min, max } = colorTargetRange(skill)
              expect(poolColors.has(request.color)).toBe(true)
              expect(request.count).toBeGreaterThanOrEqual(min)
              expect(request.count).toBeLessThanOrEqual(max)
              break
            }
            case 'dots': {
              const { min, max } = dotsTargetRange(skill)
              expect(poolIds.has(request.foodId)).toBe(true)
              expect(request.count).toBeGreaterThanOrEqual(min)
              expect(request.count).toBeLessThanOrEqual(max)
              break
            }
            case 'mix': {
              expect(poolIds.has(request.food.foodId)).toBe(true)
              // Two attributes must never collide: the color half differs
              // from the food half's own color.
              expect(foodById(request.food.foodId).color).not.toBe(request.color)
              expect(request.food.count).toBeGreaterThanOrEqual(1)
              expect(request.food.count).toBeLessThanOrEqual(2)
              expect(request.colorCount).toBeGreaterThanOrEqual(1)
              expect(request.colorCount).toBeLessThanOrEqual(2)
              break
            }
            case 'not': {
              expect(request.count).toBeGreaterThanOrEqual(2)
              expect(request.count).toBeLessThanOrEqual(3)
              if (request.bannedColor !== undefined) {
                expect(skill).toBeGreaterThanOrEqual(NOT_COLOR_MIN_SKILL)
                expect(poolColors.has(request.bannedColor)).toBe(true)
              } else {
                expect(request.bannedFoodId).toBeDefined()
                expect(poolIds.has(request.bannedFoodId!)).toBe(true)
              }
              break
            }
            case 'pattern': {
              const full = [...request.sequence, request.answerId]
              // The answer must genuinely continue a periodic AB/ABB/ABC run.
              const periodic = [2, 3].some((p) =>
                full.every((id, i) => i < p || id === full[i - p]),
              )
              expect(periodic).toBe(true)
              expect(request.sequence.length).toBe(5)
              expect(request.sequence).toContain(request.answerId)
              break
            }
          }
        }
      }
    }
  })
})

describe('tray composition', () => {
  it('is always satisfiable for every kind, skill and seed', { timeout: 20_000 }, () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const rng = mulberry32(seed)
      for (const skill of SKILLS) {
        for (const kind of ALL_KINDS) {
          const { request, tray } = generateRound(
            { round: 1 + ((seed * 7 + skill) % 30), skill, forceKind: kind },
            rng,
          )
          expect(tray).toHaveLength(TRAY_SIZE)
          for (const id of tray) expect(() => foodById(id)).not.toThrow()
          expect(simulateFeed(request, tray), `${kind} tray must satisfy its request`).toBe(true)
        }
      }
    }
  })

  it('keeps color rounds unambiguous: exactly the requested number match', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const { request, tray } = generateRound({ round: 5, skill: 4, forceKind: 'color' }, rng)
      if (request.kind !== 'color') throw new Error('forced color round expected')
      const matching = tray.filter((id) => foodById(id).color === request.color)
      expect(matching).toHaveLength(request.count)
    }
  })

  it('plants real banned temptations in not rounds', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const { request, tray } = generateRound({ round: 3, skill: 6, forceKind: 'not' }, rng)
      if (request.kind !== 'not') throw new Error('forced not round expected')
      const banned = tray.filter((id) =>
        request.bannedFoodId !== undefined
          ? id === request.bannedFoodId
          : foodById(id).color === request.bannedColor,
      )
      expect(banned.length).toBeGreaterThanOrEqual(2)
      const allowed = tray.length - banned.length
      expect(allowed).toBeGreaterThanOrEqual(request.count)
    }
  })

  it('keeps the pattern answer and its tempting near-misses on the table', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const { request, tray } = generateRound({ round: 8, skill: 10, forceKind: 'pattern' }, rng)
      if (request.kind !== 'pattern') throw new Error('forced pattern round expected')
      expect(tray).toContain(request.answerId)
      for (const member of new Set(request.sequence)) {
        expect(tray).toContain(member)
      }
    }
  })
})

describe('feeding rules', () => {
  it('mix: each half is tracked independently and never collides', () => {
    const request: FoodRequest = {
      kind: 'mix',
      food: { foodId: 'apple', count: 1 },
      color: 'green',
      colorCount: 1,
    }
    expect(wantsFood(request, [], 'apple')).toBe(true)
    expect(wantsFood(request, [], 'pear')).toBe(true) // green
    expect(wantsFood(request, [], 'banana')).toBe(false)
    expect(wantsFood(request, ['apple'], 'apple')).toBe(false)
    expect(wantsFood(request, ['apple'], 'cucumber')).toBe(true)
    expect(wantsFood(request, ['apple', 'pear'], 'cucumber')).toBe(false)
    expect(requestTotal(request)).toBe(2)
    expect(isRoundComplete(request, ['pear', 'apple'])).toBe(true)
  })

  it('dots: only the pictured food counts, up to the pip count', () => {
    const request: FoodRequest = { kind: 'dots', foodId: 'banana', count: 3 }
    expect(wantsFood(request, [], 'banana')).toBe(true)
    expect(wantsFood(request, [], 'apple')).toBe(false)
    expect(wantsFood(request, ['banana', 'banana', 'banana'], 'banana')).toBe(false)
    expect(requestTotal(request)).toBe(3)
  })

  it('not (food): the banned food is refused, everything else feeds', () => {
    const request: FoodRequest = { kind: 'not', bannedFoodId: 'apple', count: 2 }
    expect(wantsFood(request, [], 'apple')).toBe(false)
    expect(wantsFood(request, [], 'banana')).toBe(true)
    expect(wantsFood(request, [], 'strawberry')).toBe(true) // same color is fine
    expect(wantsFood(request, ['banana', 'pear'], 'cookie')).toBe(false) // full
  })

  it('not (color): the whole banned color is refused', () => {
    const request: FoodRequest = { kind: 'not', bannedColor: 'red', count: 2 }
    expect(wantsFood(request, [], 'apple')).toBe(false)
    expect(wantsFood(request, [], 'tomato')).toBe(false)
    expect(wantsFood(request, [], 'banana')).toBe(true)
  })

  it('pattern: only the continuing food, exactly once', () => {
    const request: FoodRequest = {
      kind: 'pattern',
      sequence: ['apple', 'banana', 'apple', 'banana', 'apple'],
      answerId: 'banana',
    }
    expect(wantsFood(request, [], 'banana')).toBe(true)
    expect(wantsFood(request, [], 'apple')).toBe(false)
    expect(wantsFood(request, ['banana'], 'banana')).toBe(false)
    expect(requestTotal(request)).toBe(1)
    expect(isRoundComplete(request, ['banana'])).toBe(true)
  })

  it('count combos accept requested foods until their count is met', () => {
    const combo: FoodRequest = {
      kind: 'count',
      entries: [
        { foodId: 'apple', count: 2 },
        { foodId: 'banana', count: 1 },
      ],
    }
    expect(wantsFood(combo, [], 'apple')).toBe(true)
    expect(wantsFood(combo, [], 'cookie')).toBe(false)
    expect(wantsFood(combo, ['apple', 'apple'], 'apple')).toBe(false)
    expect(wantsFood(combo, ['apple', 'apple'], 'banana')).toBe(true)
    expect(isRoundComplete(combo, ['apple', 'banana', 'apple'])).toBe(true)
  })
})

describe('thought bubble pictures', () => {
  it('mix shows the food half then the color half, graying independently', () => {
    const request: FoodRequest = {
      kind: 'mix',
      food: { foodId: 'apple', count: 2 },
      color: 'green',
      colorCount: 1,
    }
    expect(bubbleItems(request)).toEqual([{ emoji: '🍎' }, { emoji: '🍎' }, { color: 'green' }])
    // Green pear eaten first: the splash grays, not the first apple tile.
    expect(grayedBubbleItems(request, ['pear'])).toEqual([false, false, true])
    expect(grayedBubbleItems(request, ['pear', 'apple'])).toEqual([true, false, true])
  })

  it('dots renders one food tile and one pip tile', () => {
    const request: FoodRequest = { kind: 'dots', foodId: 'banana', count: 4 }
    expect(bubbleItems(request)).toEqual([{ emoji: '🍌' }, { dots: 4 }])
    expect(grayedBubbleItems(request, [])).toEqual([false, false])
    expect(grayedBubbleItems(request, ['banana', 'banana', 'banana', 'banana'])).toEqual([
      true,
      false,
    ])
  })

  it('not renders the crossed tile then one slot per wanted food', () => {
    const request: FoodRequest = { kind: 'not', bannedFoodId: 'apple', count: 2 }
    expect(bubbleItems(request)).toEqual([
      { emoji: '🍎', banned: true },
      { slot: true },
      { slot: true },
    ])
    expect(grayedBubbleItems(request, ['banana'])).toEqual([false, true, false])
    const colorBan: FoodRequest = { kind: 'not', bannedColor: 'red', count: 2 }
    expect(bubbleItems(colorBan)[0]).toEqual({ color: 'red', banned: true })
  })

  it('pattern renders the sequence plus a slot that fills on completion', () => {
    const request: FoodRequest = {
      kind: 'pattern',
      sequence: ['apple', 'banana', 'apple', 'banana', 'apple'],
      answerId: 'banana',
    }
    const items = bubbleItems(request)
    expect(items).toHaveLength(6)
    expect(items[5]).toEqual({ slot: true })
    expect(grayedBubbleItems(request, [])[5]).toBe(false)
    expect(grayedBubbleItems(request, ['banana'])[5]).toBe(true)
  })

  it('never overflows the bubble: at most 6 tiles for any generated request', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const rng = mulberry32(seed)
      for (const skill of SKILLS) {
        for (const kind of ALL_KINDS) {
          const { request } = generateRound({ round: 4, skill, forceKind: kind }, rng)
          expect(bubbleItems(request).length).toBeLessThanOrEqual(6)
          expect(grayedBubbleItems(request, [])).toHaveLength(bubbleItems(request).length)
        }
      }
    }
  })
})

describe('dynamic generation', () => {
  it('grows the experienced variety with the meter', () => {
    const seenAtSkill = (skill: number): Set<TaskKind> => {
      const seen = new Set<TaskKind>()
      for (const seed of SEEDS) {
        const rng = mulberry32(seed)
        const recent: TaskKind[] = []
        for (const round of ROUNDS.slice(0, 10)) {
          const { taskKind } = generateRound({ round, skill, recentKinds: recent }, rng)
          seen.add(taskKind)
          recent.push(taskKind)
        }
      }
      return seen
    }
    expect([...seenAtSkill(0)]).toEqual(['single'])
    expect(seenAtSkill(SKILL_MAX).size).toBe(unlockedKinds(SKILL_MAX).length)
  })

  it('never repeats the previous primary food target back-to-back', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      let previous: FoodRequest | undefined
      for (const round of ROUNDS) {
        const { request } = generateRound({ round, skill: 5, previous, forceKind: 'count' }, rng)
        if (previous?.kind === 'count' && request.kind === 'count') {
          expect(request.entries[0].foodId).not.toBe(previous.entries[0].foodId)
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
    expect(ids(4).filter((id) => ids(1).includes(id)).length).toBeGreaterThan(0)
    for (const round of [1, 10, 50, 200]) {
      const pool = activePoolForRound(round)
      expect(pool).toHaveLength(ACTIVE_POOL_SIZE)
      for (const food of pool) expect(FOODS).toContain(food)
    }
  })
})

describe('levels', () => {
  it('passes one level per fed round', () => {
    expect(levelForRound(1)).toBe(1)
    expect(levelForRound(7)).toBe(7)
    expect(levelForRound(0)).toBe(1) // defensive: never below level 1
  })

  it('fires the big celebration exactly on its every-N beat', () => {
    expect(isBigCelebrationRound(0)).toBe(false)
    expect(isBigCelebrationRound(BIG_CELEBRATION_EVERY_ROUNDS - 1)).toBe(false)
    expect(isBigCelebrationRound(BIG_CELEBRATION_EVERY_ROUNDS)).toBe(true)
    expect(isBigCelebrationRound(BIG_CELEBRATION_EVERY_ROUNDS + 1)).toBe(false)
  })
})
