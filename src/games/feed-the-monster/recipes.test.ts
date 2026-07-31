import { describe, expect, it } from 'vitest'
import {
  RECIPES,
  allRecipeFoods,
  recipeById,
  recipeFoods,
  recipesUpTo,
  rivalIngredients,
} from './recipes'
import {
  ACTIVE_POOL_SIZE,
  ALL_FOODS,
  ALL_TASK_KINDS,
  DISH_ORDERED_MIN_SKILL,
  SKILL_MAX,
  TASK_REGISTRY,
  TRAY_SIZE,
  activePoolForRound,
  dishMaxIngredients,
  kitchenKind,
  dishResult,
  generateRound,
  isDishCooked,
  isRoundComplete,
  potAccepts,
  potRemaining,
  potWants,
  requestTotal,
  wantsFood,
} from './logic'
import type { DishRequest, Rng } from './logic'
import { EPISODES } from './journey'

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dish = (recipeId: string, ordered = false): DishRequest => ({
  kind: 'dish',
  recipeId,
  ordered,
})

/** Fill the pot greedily from a tray; returns the pot, or null if it can't be filled. */
function cook(request: DishRequest, tray: readonly string[]): string[] | null {
  const pot: string[] = []
  const remaining = [...tray]
  while (!isDishCooked(request, pot)) {
    const at = remaining.findIndex((id) => potAccepts(request, pot, id))
    if (at < 0) return null
    pot.push(remaining[at])
    remaining.splice(at, 1)
  }
  return pot
}

describe('the registry', () => {
  it('names only foods that exist in the catalog', () => {
    const known = new Set(ALL_FOODS.map((f) => f.id))
    for (const id of allRecipeFoods()) {
      expect(known.has(id), `recipes name unknown food "${id}"`).toBe(true)
    }
  })

  it('has unique ids', () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length)
  })

  it('never lists a recipe’s own result among its parts', () => {
    for (const recipe of RECIPES) {
      expect(recipe.ingredients, `${recipe.id} cooks itself`).not.toContain(recipe.resultFoodId)
    }
  })

  it('keeps every recipe inside the 2–4 part range the age can hold', () => {
    for (const recipe of RECIPES) {
      expect(recipe.ingredients.length).toBeGreaterThanOrEqual(2)
      expect(recipe.ingredients.length).toBeLessThanOrEqual(4)
      // …and a part list short enough to fit the tray alongside distractors.
      expect(recipe.ingredients.length).toBeLessThan(TRAY_SIZE)
    }
  })

  it('ships phase one with NO new art: every result is already a catalog food', () => {
    for (const recipe of RECIPES) {
      expect(ALL_FOODS.some((f) => f.id === recipe.resultFoodId)).toBe(true)
    }
  })

  it('offers more than one choice at every ingredient tier', () => {
    for (const skill of [5, 8, 11, SKILL_MAX]) {
      const options = recipesUpTo(dishMaxIngredients(skill))
      expect(options.length, `only one dish at skill ${skill}`).toBeGreaterThan(1)
    }
  })

  it('recipeById throws loudly on an unknown id rather than returning junk', () => {
    expect(() => recipeById('nope')).toThrow(/nope/)
    expect(recipeById('burger').resultFoodId).toBe('burger')
  })

  it('recipeFoods is the result plus every part', () => {
    const recipe = recipeById('burger')
    expect(recipeFoods(recipe)).toEqual(['burger', 'bread', 'cheese', 'tomato'])
  })
})

describe('ingredient count ladders with the meter', () => {
  it('starts at two and grows to four, monotonically', () => {
    let previous = 0
    for (let skill = 0; skill <= SKILL_MAX; skill++) {
      const max = dishMaxIngredients(skill)
      expect(max).toBeGreaterThanOrEqual(previous)
      previous = max
    }
    expect(dishMaxIngredients(5)).toBe(2)
    expect(dishMaxIngredients(8)).toBe(3)
    expect(dishMaxIngredients(SKILL_MAX)).toBe(4)
  })

  it('never offers a recipe longer than the tier allows', () => {
    for (let skill = 0; skill <= SKILL_MAX; skill++) {
      for (const recipe of recipesUpTo(dishMaxIngredients(skill))) {
        expect(recipe.ingredients.length).toBeLessThanOrEqual(dishMaxIngredients(skill))
      }
    }
  })

  it('puts the four-part tier at the very top — five drags is a lot of round', () => {
    const fourPart = RECIPES.filter((r) => r.ingredients.length === 4)
    expect(fourPart.length).toBeGreaterThan(0)
    for (let skill = 0; skill < 11; skill++) {
      expect(recipesUpTo(dishMaxIngredients(skill)).some((r) => r.ingredients.length === 4)).toBe(
        false,
      )
    }
  })
})

describe('the pot', () => {
  it('accepts any missing part in a free round', () => {
    const request = dish('burger')
    expect(potWants(request, [])).toEqual(['bread', 'cheese', 'tomato'])
    expect(potAccepts(request, [], 'tomato')).toBe(true)
    expect(potAccepts(request, [], 'bread')).toBe(true)
    expect(potAccepts(request, [], 'burger'), 'the result is not a part').toBe(false)
    expect(potAccepts(request, [], 'apple')).toBe(false)
  })

  it('accepts only the NEXT part in an ordered round — that is the sequencing', () => {
    const request = dish('burger', true)
    expect(potWants(request, [])).toEqual(['bread'])
    expect(potAccepts(request, [], 'bread')).toBe(true)
    expect(potAccepts(request, [], 'cheese')).toBe(false)
    expect(potWants(request, ['bread'])).toEqual(['cheese'])
    expect(potWants(request, ['bread', 'cheese'])).toEqual(['tomato'])
    expect(potWants(request, ['bread', 'cheese', 'tomato'])).toEqual([])
  })

  it('stops accepting a part once it is in (free round)', () => {
    const request = dish('burger')
    expect(potAccepts(request, ['bread'], 'bread')).toBe(false)
    expect(potWants(request, ['bread'])).toEqual(['cheese', 'tomato'])
  })

  it('is cooked exactly when nothing is missing', () => {
    const request = dish('hotdog')
    expect(isDishCooked(request, [])).toBe(false)
    expect(isDishCooked(request, ['bread'])).toBe(false)
    expect(isDishCooked(request, ['bread', 'bacon'])).toBe(true)
  })

  it('produces the recipe’s result', () => {
    expect(dishResult(dish('waffle-honey'))).toBe('waffle')
    expect(dishResult(dish('burger-deluxe'))).toBe('burger')
  })

  it('still counts a later part as NEEDED in an ordered round', () => {
    // The thief asks "may this go?", not "may this go in NEXT?". potWants answers
    // the second question and named one part, so the bird carried off an ingredient
    // the recipe could not be finished without.
    const request = dish('burger', true)
    expect(potWants(request, [])).toEqual(['bread'])
    expect(potRemaining(request, [])).toEqual(['bread', 'cheese', 'tomato'])
    expect(potRemaining(request, ['bread'])).toEqual(['cheese', 'tomato'])
    expect(potRemaining(request, ['bread', 'cheese', 'tomato'])).toEqual([])
  })

  it('counts a repeated ingredient once per copy still missing', () => {
    const twice: DishRequest = { kind: 'dish', recipeId: 'burger', ordered: false }
    // A pot fed a part it does not contain twice must not clear both.
    expect(potRemaining(twice, ['bread'])).toEqual(['cheese', 'tomato'])
    expect(potRemaining(twice, ['apple'])).toEqual(['bread', 'cheese', 'tomato'])
  })
})

describe('feeding a kitchen round', () => {
  it('wants ONE thing — the cooked dish, never a raw part', () => {
    const request = dish('burger')
    expect(requestTotal(request)).toBe(1)
    expect(wantsFood(request, [], 'burger')).toBe(true)
    for (const part of ['bread', 'cheese', 'tomato']) {
      expect(wantsFood(request, [], part), `${part} must be spat back`).toBe(false)
    }
  })

  it('completes on the made dish and refuses a second helping', () => {
    const request = dish('hotdog')
    expect(isRoundComplete(request, [])).toBe(false)
    expect(isRoundComplete(request, ['hotdog'])).toBe(true)
    expect(wantsFood(request, ['hotdog'], 'hotdog')).toBe(false)
  })
})

describe('kitchen round generation', () => {
  it('is a MODE, not a registry row — the meter never rotates cooking in', () => {
    // The pot has its own furniture and a two-step goal, so how OFTEN it comes out
    // is the variety axis's call (session.ts's deck). Leaving it in the registry
    // made the two axes fight: more cooking could only mean less counting.
    for (const kind of ['dish', 'dish-ordered'] as const) {
      expect(TASK_REGISTRY.some((def) => def.kind === kind)).toBe(false)
      expect(ALL_TASK_KINDS).toContain(kind)
    }
  })

  it('keeps its DIFFICULTY on the meter: free cooking first, ordered much later', () => {
    const always = () => 0
    // Below the unlock the pot never demands an order, however the dice fall.
    for (let skill = 0; skill < DISH_ORDERED_MIN_SKILL; skill++) {
      expect(kitchenKind(skill, always)).toBe('dish')
    }
    // At and above it, ordered rounds appear — but only some of the time, so the
    // pot keeps both variants in rotation instead of switching over for good.
    expect(kitchenKind(DISH_ORDERED_MIN_SKILL, always)).toBe('dish-ordered')
    expect(kitchenKind(SKILL_MAX, () => 0.99)).toBe('dish')
    // Ordered lands well above the last cognitive kind to unlock (`mix`, 7): it is
    // the sequencing trainer, and sequencing is the hardest thing the pot asks.
    const lastKind = Math.max(...TASK_REGISTRY.map((def) => def.minSkill))
    expect(DISH_ORDERED_MIN_SKILL).toBeGreaterThan(lastKind)
  })

  it('always deals a tray holding every part, and never the result', () => {
    for (const episode of EPISODES) {
      for (const kind of ['dish', 'dish-ordered'] as const) {
        for (const skill of [5, 8, 10, SKILL_MAX]) {
          for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
            const round = generateRound(
              { round: seed, skill, foods: episode.foods, forceKind: kind },
              mulberry32(seed * 17 + skill),
            )
            expect(round.request.kind).toBe('dish')
            if (round.request.kind !== 'dish') continue
            const recipe = recipeById(round.request.recipeId)
            expect(round.tray).toHaveLength(TRAY_SIZE)
            for (const part of recipe.ingredients) {
              expect(round.tray, `${recipe.id} missing ${part}`).toContain(part)
            }
            expect(
              round.tray,
              'a spare result would let the child skip the pot entirely',
            ).not.toContain(recipe.resultFoodId)
            expect(round.request.ordered).toBe(kind === 'dish-ordered')
            // And it can actually be cooked and fed.
            const pot = cook(round.request, round.tray)
            expect(pot, `${recipe.id} could not be cooked`).not.toBeNull()
            expect(wantsFood(round.request, [], dishResult(round.request))).toBe(true)
          }
        }
      }
    }
  })

  it('respects the meter’s ingredient ceiling', () => {
    for (const skill of [5, 6, 7, 8, 9, 10, 11, SKILL_MAX]) {
      for (const seed of [1, 4, 9, 16, 25]) {
        const round = generateRound(
          { round: seed, skill, forceKind: 'dish' },
          mulberry32(seed + skill),
        )
        if (round.request.kind !== 'dish') continue
        expect(recipeById(round.request.recipeId).ingredients.length).toBeLessThanOrEqual(
          dishMaxIngredients(skill),
        )
      }
    }
  })

  it('does not cook the same dish twice in a row when there is a choice', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const previous = dish('burger')
      const round = generateRound(
        { round: seed, skill: SKILL_MAX, forceKind: 'dish', previous },
        mulberry32(seed * 3),
      )
      if (round.request.kind !== 'dish') continue
      expect(round.request.recipeId).not.toBe('burger')
    }
  })

  it('pads with parts of OTHER dishes at the top of the meter (the hard distractors)', () => {
    // At skill 10+ the child has to read the recipe rather than pick the
    // odd-looking ones, so the padding is drawn from rival recipes.
    let sawRival = false
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const round = generateRound(
        { round: seed, skill: SKILL_MAX, forceKind: 'dish', foods: EPISODES[1].foods },
        mulberry32(seed * 11),
      )
      if (round.request.kind !== 'dish') continue
      const recipe = recipeById(round.request.recipeId)
      const rivals = new Set(rivalIngredients(recipe, activePoolForRound(seed, EPISODES[1].foods)))
      const padding = round.tray.filter((id) => !recipe.ingredients.includes(id))
      if (padding.some((id) => rivals.has(id))) sawRival = true
    }
    expect(sawRival).toBe(true)
  })

  it('never pads with the parts of the dish being cooked (no double-counting)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const round = generateRound(
        { round: seed, skill: SKILL_MAX, forceKind: 'dish' },
        mulberry32(seed * 7),
      )
      if (round.request.kind !== 'dish') continue
      const recipe = recipeById(round.request.recipeId)
      for (const part of recipe.ingredients) {
        expect(
          round.tray.filter((id) => id === part).length,
          `${part} appears more than once, so the pot could reject a correct drag`,
        ).toBe(1)
      }
    }
  })

  it('keeps the active pool the usual width — a dish round is still an episode', () => {
    const pool = activePoolForRound(4, EPISODES[2].foods)
    expect(pool).toHaveLength(ACTIVE_POOL_SIZE)
  })

  it('rivalIngredients never returns the dish’s own foods', () => {
    for (const recipe of RECIPES) {
      const rivals = rivalIngredients(recipe, [...EPISODES[1].foods])
      for (const own of recipeFoods(recipe)) expect(rivals).not.toContain(own)
    }
  })
})
