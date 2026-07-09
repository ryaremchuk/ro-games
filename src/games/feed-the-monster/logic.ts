/**
 * Pure round/request generation for Feed the Monster. No Phaser imports —
 * everything in this module is deterministic given an injected RNG and is
 * unit-tested in plain jsdom (see logic.test.ts).
 */

export type FoodColor = 'red' | 'yellow' | 'green' | 'orange' | 'purple' | 'brown'

export interface Food {
  id: string
  emoji: string
  color: FoodColor
}

/** Palette accent hex per food color (ART SPEC) — splash art + tints. */
export const COLOR_HEX: Record<FoodColor, number> = {
  red: 0xff6b6b,
  yellow: 0xffd93d,
  green: 0x6bcb77,
  orange: 0xffa94d,
  purple: 0x9b5de5,
  brown: 0xb08968,
}

/**
 * Food pool (≥ 12). Ordered as a repeating 6-color cycle so that any
 * ACTIVE_POOL_SIZE-wide window contains every color — color rounds are always
 * satisfiable no matter how far the window has rotated.
 */
export const FOODS: readonly Food[] = [
  { id: 'apple', emoji: '🍎', color: 'red' },
  { id: 'banana', emoji: '🍌', color: 'yellow' },
  { id: 'broccoli', emoji: '🥦', color: 'green' },
  { id: 'carrot', emoji: '🥕', color: 'orange' },
  { id: 'grapes', emoji: '🍇', color: 'purple' },
  { id: 'cookie', emoji: '🍪', color: 'brown' },
  { id: 'strawberry', emoji: '🍓', color: 'red' },
  { id: 'cheese', emoji: '🧀', color: 'yellow' },
  { id: 'pear', emoji: '🍐', color: 'green' },
  { id: 'orange', emoji: '🍊', color: 'orange' },
  { id: 'eggplant', emoji: '🍆', color: 'purple' },
  { id: 'donut', emoji: '🍩', color: 'brown' },
  { id: 'tomato', emoji: '🍅', color: 'red' },
  { id: 'lemon', emoji: '🍋', color: 'yellow' },
  { id: 'cucumber', emoji: '🥒', color: 'green' },
  { id: 'mango', emoji: '🥭', color: 'orange' },
]

export function foodById(id: string): Food {
  const food = FOODS.find((f) => f.id === id)
  if (!food) throw new Error(`Unknown food id: ${id}`)
  return food
}

/** Scaffolded difficulty ramp, in order. */
export const STAGES = ['single', 'count-small', 'color', 'count-large', 'combo'] as const
export type Stage = (typeof STAGES)[number]

/**
 * R1-2 single item → R3-5 counts of 2-3 → R6-8 color requests →
 * R9-11 counts of 4-5 → R12+ two-item combos (smart-kid stretch).
 */
export function stageForRound(round: number): Stage {
  if (round <= 2) return 'single'
  if (round <= 5) return 'count-small'
  if (round <= 8) return 'color'
  if (round <= 11) return 'count-large'
  return 'combo'
}

/** Rounds per HUD level — matches the every-3-rounds big celebration. */
export const ROUNDS_PER_LEVEL = 3

/** 1-based level for the CURRENT round number (rounds 1-3 → L1, 4-6 → L2, …). */
export function levelForRound(round: number): number {
  return Math.floor(Math.max(round - 1, 0) / ROUNDS_PER_LEVEL) + 1
}

export interface CountEntry {
  foodId: string
  count: number
}

/** "Eat N of this food" (one entry) or a two-item combo (two entries). */
export interface CountRequest {
  kind: 'count'
  entries: CountEntry[]
}

/** "Eat N things of this color." */
export interface ColorRequest {
  kind: 'color'
  color: FoodColor
  count: number
}

export type FoodRequest = CountRequest | ColorRequest

/** Injectable random source, [0, 1). Defaults to Math.random in the game. */
export type Rng = () => number

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

function pickOne<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/** How many foods are draggable in the tray at once. */
export const TRAY_SIZE = 8

/** How many food types are in rotation for a given round. */
export const ACTIVE_POOL_SIZE = 8

/** Every 3 rounds, 2 new foods rotate in (wrapping) so the tray never looks the same. */
export function activePoolForRound(round: number): Food[] {
  const shift = (Math.floor((round - 1) / 3) * 2) % FOODS.length
  return Array.from({ length: ACTIVE_POOL_SIZE }, (_, i) => FOODS[(shift + i) % FOODS.length])
}

/**
 * Build a request for the stage, structurally avoiding an immediate repeat of
 * the previous round's target (same primary food, or same color).
 */
function generateRequest(
  stage: Stage,
  pool: Food[],
  rng: Rng,
  previous?: FoodRequest,
): FoodRequest {
  const avoidFood = previous?.kind === 'count' ? previous.entries[0].foodId : undefined
  const filtered = pool.filter((f) => f.id !== avoidFood)
  const foodPool = filtered.length > 0 ? filtered : pool

  switch (stage) {
    case 'single':
      return { kind: 'count', entries: [{ foodId: pickOne(rng, foodPool).id, count: 1 }] }
    case 'count-small':
      return {
        kind: 'count',
        entries: [{ foodId: pickOne(rng, foodPool).id, count: randInt(rng, 2, 3) }],
      }
    case 'color': {
      const avoidColor = previous?.kind === 'color' ? previous.color : undefined
      const allColors = [...new Set(pool.map((f) => f.color))]
      const colors = allColors.filter((c) => c !== avoidColor)
      const colorPool = colors.length > 0 ? colors : allColors
      return { kind: 'color', color: pickOne(rng, colorPool), count: randInt(rng, 2, 3) }
    }
    case 'count-large':
      return {
        kind: 'count',
        entries: [{ foodId: pickOne(rng, foodPool).id, count: randInt(rng, 4, 5) }],
      }
    case 'combo': {
      const first = pickOne(rng, foodPool)
      const second = pickOne(
        rng,
        pool.filter((f) => f.id !== first.id),
      )
      return {
        kind: 'count',
        entries: [
          { foodId: first.id, count: randInt(rng, 2, 3) },
          { foodId: second.id, count: randInt(rng, 1, 2) },
        ],
      }
    }
  }
}

/** Total number of foods the monster wants this round (also the beep count). */
export function requestTotal(request: FoodRequest): number {
  return request.kind === 'color'
    ? request.count
    : request.entries.reduce((sum, entry) => sum + entry.count, 0)
}

/**
 * Compose the tray: exactly the requested items (so clearing the request is
 * always possible) plus plausible distractors — other foods from the active
 * pool, and for color rounds strictly other-colored foods so "only red
 * things" stays unambiguous.
 */
export function generateTray(request: FoodRequest, pool: Food[], rng: Rng): string[] {
  const tray: string[] = []
  let distractors: Food[]

  if (request.kind === 'color') {
    const matching = pool.filter((f) => f.color === request.color)
    for (let i = 0; i < request.count; i++) {
      tray.push(pickOne(rng, matching).id)
    }
    distractors = pool.filter((f) => f.color !== request.color)
  } else {
    for (const entry of request.entries) {
      for (let i = 0; i < entry.count; i++) {
        tray.push(entry.foodId)
      }
    }
    const requested = new Set(request.entries.map((entry) => entry.foodId))
    distractors = pool.filter((f) => !requested.has(f.id))
  }

  while (tray.length < TRAY_SIZE) {
    tray.push(pickOne(rng, distractors).id)
  }
  return shuffle(rng, tray)
}

export interface Round {
  round: number
  stage: Stage
  request: FoodRequest
  tray: string[]
}

/** Generate one full round: ramped request + always-satisfiable tray. */
export function generateRound(
  round: number,
  previous?: FoodRequest,
  rng: Rng = Math.random,
): Round {
  const stage = stageForRound(round)
  const pool = activePoolForRound(round)
  const request = generateRequest(stage, pool, rng, previous)
  return { round, stage, request, tray: generateTray(request, pool, rng) }
}

function eatenCountOf(eaten: readonly string[], foodId: string): number {
  return eaten.filter((id) => id === foodId).length
}

/** Would dropping this food in the mouth be a correct feed right now? */
export function wantsFood(request: FoodRequest, eaten: readonly string[], foodId: string): boolean {
  if (request.kind === 'color') {
    return eaten.length < request.count && foodById(foodId).color === request.color
  }
  const entry = request.entries.find((e) => e.foodId === foodId)
  return entry !== undefined && eatenCountOf(eaten, foodId) < entry.count
}

/** `eaten` only ever accumulates correct feeds, so length equality is completeness. */
export function isRoundComplete(request: FoodRequest, eaten: readonly string[]): boolean {
  return eaten.length >= requestTotal(request)
}

/** One picture inside the thought bubble: an emoji, or a color splash. */
export interface BubbleItem {
  emoji?: string
  color?: FoodColor
}

/** The request rendered as pictures (emoji repeated N times, or N color splashes). */
export function bubbleItems(request: FoodRequest): BubbleItem[] {
  if (request.kind === 'color') {
    return Array.from({ length: request.count }, () => ({ color: request.color }))
  }
  return request.entries.flatMap((entry) =>
    Array.from({ length: entry.count }, () => ({ emoji: foodById(entry.foodId).emoji })),
  )
}

/**
 * Which bubble pictures are grayed out, aligned index-for-index with
 * bubbleItems(). Handles out-of-order combo feeding (banana before apples).
 */
export function grayedBubbleItems(request: FoodRequest, eaten: readonly string[]): boolean[] {
  if (request.kind === 'color') {
    return Array.from({ length: request.count }, (_, i) => i < eaten.length)
  }
  const flags: boolean[] = []
  for (const entry of request.entries) {
    const eatenOfFood = eatenCountOf(eaten, entry.foodId)
    for (let i = 0; i < entry.count; i++) {
      flags.push(i < eatenOfFood)
    }
  }
  return flags
}
