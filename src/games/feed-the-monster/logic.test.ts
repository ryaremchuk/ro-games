import { describe, expect, it } from 'vitest'
import {
  ACTIVE_POOL_SIZE,
  COLOR_HEX,
  DUO_MIN_GAP,
  DUO_MIN_SKILL,
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
  dishResult,
  colorTargetRange,
  countTargetRange,
  dotsTargetRange,
  foodById,
  generateDuoRound,
  generateRound,
  grayedBubbleItems,
  isDishCooked,
  isRoundComplete,
  pickTaskKind,
  potAccepts,
  requestTotal,
  shouldInjectDuo,
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

/**
 * Greedily play a round to completion; true if it can be cleared at all.
 *
 * A KITCHEN round has a different completion path from every other kind: the
 * tray holds the PARTS, and the only feedable thing is the dish that comes out of
 * the pot once they are all in. So model the pot, then feed the result.
 */
function simulateFeed(request: FoodRequest, tray: readonly string[]): boolean {
  const remaining = [...tray]
  if (request.kind === 'dish') {
    const pot: string[] = []
    while (!isDishCooked(request, pot)) {
      const at = remaining.findIndex((id) => potAccepts(request, pot, id))
      if (at < 0) return false
      pot.push(remaining[at])
      remaining.splice(at, 1)
    }
    return wantsFood(request, [], dishResult(request))
  }
  const eaten: string[] = []
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

  // Regression for the "fed one pear, six pictures shown, instant win"
  // report: a 3+3 combo shows six tiles and NEVER completes early — the only
  // six-tile request that completes on one feed is pattern (by design: the
  // ask is the single continuation of the row, and the panel must render it
  // as context + one answer socket, not as "feed all of these").
  it('a six-picture 3+3 combo completes only after all six feeds', () => {
    const combo: FoodRequest = {
      kind: 'count',
      entries: [
        { foodId: 'carrot', count: 3 },
        { foodId: 'pear', count: 3 },
      ],
    }
    expect(bubbleItems(combo)).toHaveLength(6)
    expect(requestTotal(combo)).toBe(6)
    expect(isRoundComplete(combo, ['pear'])).toBe(false)
    expect(isRoundComplete(combo, ['pear', 'pear', 'pear', 'carrot', 'carrot'])).toBe(false)
    expect(isRoundComplete(combo, ['pear', 'pear', 'pear', 'carrot', 'carrot', 'carrot'])).toBe(
      true,
    )
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
    expect(bubbleItems(request)).toEqual([
      { foodId: 'apple' },
      { foodId: 'apple' },
      { color: 'green' },
    ])
    // Green pear eaten first: the splash grays, not the first apple tile.
    expect(grayedBubbleItems(request, ['pear'])).toEqual([false, false, true])
    expect(grayedBubbleItems(request, ['pear', 'apple'])).toEqual([true, false, true])
  })

  it('dots renders one food tile and one pip tile', () => {
    const request: FoodRequest = { kind: 'dots', foodId: 'banana', count: 4 }
    expect(bubbleItems(request)).toEqual([{ foodId: 'banana' }, { dots: 4 }])
    expect(grayedBubbleItems(request, [])).toEqual([false, false])
    expect(grayedBubbleItems(request, ['banana', 'banana', 'banana', 'banana'])).toEqual([
      true,
      false,
    ])
  })

  it('not renders the crossed tile then one slot per wanted food', () => {
    const request: FoodRequest = { kind: 'not', bannedFoodId: 'apple', count: 2 }
    expect(bubbleItems(request)).toEqual([
      { foodId: 'apple', banned: true },
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

  it('a kitchen round asks the friend for ONE thing: the finished dish', () => {
    // The recipe is NOT in here — it hangs over the pot on its own panel
    // (recipePanel.ts), which is the whole point of splitting the two asks: the
    // friend's bubble says "bring me this", the pot's panel says "cook this".
    const request: FoodRequest = { kind: 'dish', recipeId: 'burger', ordered: false }
    expect(bubbleItems(request)).toEqual([{ foodId: 'burger' }])
    expect(grayedBubbleItems(request, [])).toEqual([false])
    expect(grayedBubbleItems(request, ['burger'])).toEqual([true])
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

describe('duo bonus round', () => {
  it('builds two distinct foods and a shared tray that satisfies both mouths', () => {
    for (const seed of SEEDS) {
      for (const skill of SKILLS) {
        const rng = mulberry32(seed * 31 + skill)
        const duo = generateDuoRound({ round: seed, skill }, rng)
        const leftFood = duo.left.entries[0].foodId
        const rightFood = duo.right.entries[0].foodId

        // Distinct foods → every tray item belongs to at most one mouth.
        expect(leftFood).not.toBe(rightFood)
        expect(duo.tray).toHaveLength(TRAY_SIZE)

        // Each side is independently satisfiable from the shared tray, and no
        // tray food is wanted by BOTH mouths (no ambiguous drop).
        expect(simulateFeed(duo.left, duo.tray)).toBe(true)
        expect(simulateFeed(duo.right, duo.tray)).toBe(true)
        for (const id of duo.tray) {
          const wantedByLeft = wantsFood(duo.left, [], id)
          const wantedByRight = wantsFood(duo.right, [], id)
          expect(wantedByLeft && wantedByRight).toBe(false)
        }
      }
    }
  })

  it('keeps duo counts small (the sorting is the challenge, not big numbers)', () => {
    for (const seed of SEEDS) {
      for (const skill of SKILLS) {
        const duo = generateDuoRound({ round: seed, skill }, mulberry32(seed + skill * 7))
        for (const side of [duo.left, duo.right]) {
          expect(side.entries[0].count).toBeGreaterThanOrEqual(1)
          expect(side.entries[0].count).toBeLessThanOrEqual(3)
        }
      }
    }
  })

  describe('injection axis (data + chance)', () => {
    const base = { skill: SKILL_MAX, roundsSinceLastDuo: 99, struggling: false, slotsLeft: 5 }
    const never = () => 0.99
    const always = () => 0

    it('gates on episode slots, competence, struggle and spacing', () => {
      // Eligible + a winning roll → yes.
      expect(shouldInjectDuo(base, always)).toBe(true)
      // A duo needs two free slots.
      expect(shouldInjectDuo({ ...base, slotsLeft: 1 }, always)).toBe(false)
      // Too early on the meter — let the basics land first.
      expect(shouldInjectDuo({ ...base, skill: DUO_MIN_SKILL - 1 }, always)).toBe(false)
      // Don't pile two goals on a struggling child.
      expect(shouldInjectDuo({ ...base, struggling: true }, always)).toBe(false)
      // Never back-to-back.
      expect(shouldInjectDuo({ ...base, roundsSinceLastDuo: DUO_MIN_GAP - 1 }, always)).toBe(false)
    })

    it('is chance-gated even when fully eligible (anti-drought ramp)', () => {
      expect(shouldInjectDuo(base, never)).toBe(false) // eligible, but the roll loses
      // Just past the gap the chance is low; far past it, high — so a losing
      // roll at the gap can still be a winning roll much later.
      const nearGap = { ...base, roundsSinceLastDuo: DUO_MIN_GAP }
      const roll = () => 0.5
      expect(shouldInjectDuo(nearGap, roll)).toBe(false)
      expect(shouldInjectDuo({ ...base, roundsSinceLastDuo: 99 }, roll)).toBe(true)
    })
  })
})
