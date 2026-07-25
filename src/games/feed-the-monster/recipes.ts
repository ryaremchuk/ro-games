/**
 * KITCHEN recipes — pure registry, no Phaser.
 *
 * A kitchen round asks for something that DOES NOT EXIST on the tray yet: the
 * friend wants a burger, and a burger has to be assembled from bread, cheese and
 * tomato in a pot before it can be fed. That is the first time the game asks the
 * child to hold a goal made of sub-goals, which is the seed of sequencing and the
 * biggest conceptual step available in this game.
 *
 * Adding a dish is one row plus (maybe) one sprite. Phase one deliberately adds
 * NO sprites at all: four foods already in the catalog are themselves composed
 * dishes, so they can be recipe RESULTS for free — which is how the mechanic gets
 * proved before a dish sheet is generated.
 *
 * Ingredient counts ladder 2 → 3 → 4 with the cognitive meter, and every tier has
 * more than one recipe so a round is never predictable. The 3- and 4-part rows are
 * richer versions of the same dish (a waffle with honey, a burger with lettuce)
 * rather than new art.
 */

// Type-only import: logic.ts imports the functions BELOW, so a value import here
// would close a runtime cycle. Nothing in this module needs the catalog at
// runtime — recipes.test.ts checks every id against it instead.
import type { Food } from './logic'

export interface Recipe {
  id: string
  /** The food that comes out of the pot — must exist in ALL_FOODS. */
  resultFoodId: string
  /** What goes in, in the order an `ordered` round demands. 2–4 of them. */
  ingredients: string[]
}

/**
 * Every dish the kitchen can make. All four results (burger / hotdog / waffle /
 * custard) are existing catalog foods, so phase one ships with the pot as its
 * only new art — and each of them immediately doubles as an ordinary food in
 * later episodes, which is a nice side benefit.
 */
export const RECIPES: readonly Recipe[] = [
  // Two parts — the entry tier.
  { id: 'hotdog', resultFoodId: 'hotdog', ingredients: ['bread', 'bacon'] },
  { id: 'custard', resultFoodId: 'custard', ingredients: ['egg', 'honey'] },
  { id: 'waffle', resultFoodId: 'waffle', ingredients: ['egg', 'butter'] },
  // Three parts.
  { id: 'burger', resultFoodId: 'burger', ingredients: ['bread', 'cheese', 'tomato'] },
  { id: 'waffle-honey', resultFoodId: 'waffle', ingredients: ['egg', 'butter', 'honey'] },
  // Four parts — the top of the range. Four ingredients means FIVE drags in one
  // round, and drag-and-drop is the expensive gesture at this age, so this tier
  // sits at the very top of the meter on purpose.
  {
    id: 'burger-deluxe',
    resultFoodId: 'burger',
    ingredients: ['bread', 'cheese', 'tomato', 'lettuce'],
  },
]

export function recipeById(id: string): Recipe {
  const recipe = RECIPES.find((r) => r.id === id)
  if (!recipe) throw new Error(`Unknown recipe id: ${id}`)
  return recipe
}

/** The recipes whose ingredient count fits inside a limit. */
export function recipesUpTo(maxIngredients: number): Recipe[] {
  return RECIPES.filter((r) => r.ingredients.length <= Math.max(2, maxIngredients))
}

/**
 * Every food a recipe touches — used to keep a kitchen round's distractors clear
 * of both the parts and the result (a spare burger on the tray would let the
 * child skip the pot entirely, which is the one way this round can be cheated).
 */
export function recipeFoods(recipe: Recipe): string[] {
  return [recipe.resultFoodId, ...recipe.ingredients]
}

/**
 * Ingredients belonging to OTHER recipes — the hard distractors. At the top of
 * the meter the tray pads with these instead of unrelated foods, so the child has
 * to read the recipe rather than pick "the odd-looking ones".
 */
export function rivalIngredients(recipe: Recipe, pool: readonly Food[]): string[] {
  const own = new Set(recipeFoods(recipe))
  const rivals = new Set<string>()
  for (const other of RECIPES) {
    if (other.id === recipe.id) continue
    for (const id of other.ingredients) if (!own.has(id)) rivals.add(id)
  }
  // Only ones the current pool could plausibly show — a tray is still an episode.
  const inPool = pool.filter((f) => rivals.has(f.id)).map((f) => f.id)
  return inPool.length > 0 ? inPool : [...rivals]
}

/** Every food id this registry names, results and parts alike. */
export function allRecipeFoods(): string[] {
  return [...new Set(RECIPES.flatMap(recipeFoods))]
}
