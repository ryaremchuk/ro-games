/**
 * Pure round/request generation for Feed the Monster. No Phaser imports —
 * everything in this module is deterministic given an injected RNG and is
 * unit-tested in plain jsdom (see logic.test.ts).
 *
 * Difficulty is DYNAMIC: one adaptive cognitive meter (0..12, persisted via
 * shared/progress.ts) drives which task kinds are in rotation and how hard
 * their parameters run. The meter moves on a formula over the child's play —
 * spit-backs (wrong feeds) and round time — never on the round number:
 * clean & quick → up (double speed below the saved peak), two or more
 * spit-backs → gently down, anything else → hold. See updateSkill().
 */

import { recipeById, recipeFoods, recipesUpTo, rivalIngredients } from './recipes'

export type FoodColor = 'red' | 'yellow' | 'green' | 'orange' | 'purple' | 'brown'

/** Canonical colour order — the order commissions ask for missing colours in. */
export const FOOD_COLORS: readonly FoodColor[] = [
  'red',
  'yellow',
  'green',
  'orange',
  'purple',
  'brown',
]

export interface Food {
  id: string
  emoji: string
  color: FoodColor
  /**
   * Set only on a food the CHILD drew (a commission — see the drawn-food
   * design). Renderers prefer the drawing's texture; `emoji` stays required and
   * becomes the graceful fallback, exactly the philosophy art.ts already
   * follows, so a drawing whose texture failed to register still plays as a
   * food rather than crashing a round.
   */
  drawingId?: string
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
 * Food pool: exactly three full 6-color cycles (18 foods), so that any
 * ACTIVE_POOL_SIZE-wide window — at any even rotation shift — contains every
 * color. Color/mix/not rounds stay satisfiable no matter how far the window
 * has rotated (logic.test.ts sweeps every shift to hold this true).
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
  { id: 'blueberries', emoji: '🫐', color: 'purple' },
  { id: 'pretzel', emoji: '🥨', color: 'brown' },
]

/**
 * Foods that only appear in later journey episodes (journey.ts composes
 * per-episode pools out of the full catalog below).
 */
export const EXTRA_FOODS: readonly Food[] = [
  { id: 'bacon', emoji: '🥓', color: 'red' },
  { id: 'egg', emoji: '🍳', color: 'yellow' },
  { id: 'butter', emoji: '🧈', color: 'yellow' },
  { id: 'avocado', emoji: '🥑', color: 'green' },
  { id: 'lettuce', emoji: '🥬', color: 'green' },
  { id: 'pumpkin', emoji: '🎃', color: 'orange' },
  { id: 'sweet-potato', emoji: '🍠', color: 'purple' },
  { id: 'bread', emoji: '🍞', color: 'brown' },
  { id: 'waffle', emoji: '🧇', color: 'brown' },
  { id: 'watermelon', emoji: '🍉', color: 'red' },
  { id: 'cherries', emoji: '🍒', color: 'red' },
  { id: 'corn', emoji: '🌽', color: 'yellow' },
  { id: 'green-apple', emoji: '🍏', color: 'green' },
  { id: 'peach', emoji: '🍑', color: 'orange' },
  { id: 'burger', emoji: '🍔', color: 'brown' },
  { id: 'hotdog', emoji: '🌭', color: 'brown' },
  { id: 'custard', emoji: '🍮', color: 'yellow' },
  { id: 'honey', emoji: '🍯', color: 'yellow' },
  { id: 'kiwi', emoji: '🥝', color: 'green' },
  { id: 'melon', emoji: '🍈', color: 'green' },
  { id: 'chocolate', emoji: '🍫', color: 'brown' },
]

/** Every food the game knows, across all episodes. */
export const ALL_FOODS: readonly Food[] = [...FOODS, ...EXTRA_FOODS]

/**
 * Foods that exist only at RUNTIME because the child made them (commissioned
 * drawings). The catalog above is authored and constant; this is the one place it
 * genuinely grows while the game is running, so `foodById` — which a dozen pure
 * rules already call as a plain lookup — consults it too. Threading a catalog
 * argument through every rule instead would be far more invasive for no gain:
 * every DECISION here stays pure, only the id→Food lookup is extensible.
 */
const runtimeFoods = new Map<string, Food>()

/** Make a child-drawn food resolvable by id (call before it enters a pool). */
export function registerRuntimeFood(food: Food): void {
  runtimeFoods.set(food.id, food)
}

/** Drop every runtime food (dev "wipe drawn foods", and test isolation). */
export function clearRuntimeFoods(): void {
  runtimeFoods.clear()
}

export function foodById(id: string): Food {
  const food = ALL_FOODS.find((f) => f.id === id) ?? runtimeFoods.get(id)
  if (!food) throw new Error(`Unknown food id: ${id}`)
  return food
}

// ─── Foods the child drew ────────────────────────────────────────────────────

export const DRAWN_FOOD_PREFIX = 'drawn-'

/** A commissioned drawing as a food. `✏️` is the fallback glyph, never the look. */
export function drawnFood(drawingId: string, color: FoodColor): Food {
  return { id: `${DRAWN_FOOD_PREFIX}${drawingId}`, emoji: '✏️', color, drawingId }
}

/**
 * The drawing behind a food id, or null for an authored food. Parsed from the id
 * rather than looked up, so a renderer can ask about a food whose catalog entry
 * has not been registered yet (or was wiped) without risking a throw.
 */
export function drawingIdOf(foodId: string): string | null {
  return foodId.startsWith(DRAWN_FOOD_PREFIX) ? foodId.slice(DRAWN_FOOD_PREFIX.length) : null
}

/**
 * Splice drawn foods into an episode pool by SUBSTITUTION, never by appending.
 *
 * Every pool is deliberately three full six-colour cycles (18 foods) so that any
 * ACTIVE_POOL_SIZE-wide window, at any rotation shift, contains every colour —
 * that is what keeps colour / mix / not rounds satisfiable, and logic.test.ts
 * sweeps every shift to prove it. A 19th food would break the invariant by
 * construction; replacing the FIRST food of the same colour keeps it exactly.
 * The child's red thing simply takes the apple's seat.
 */
export function withDrawnFoods(pool: readonly Food[], drawn: readonly Food[]): Food[] {
  const next = [...pool]
  for (const food of drawn) {
    const at = next.findIndex((f) => f.color === food.color && f.drawingId === undefined)
    if (at >= 0) next[at] = food
  }
  return next
}

/**
 * The colour a drawing reads as: every painted cell snapped to the nearest of
 * the six food accents, most common bucket wins, paper ignored. Ties break on
 * FOOD_COLORS order so the answer is deterministic.
 *
 * Only used BELOW the colour-round unlock, where the ask is simply "draw
 * anything" and nothing depends on the answer being right. Once colour rounds
 * are in rotation every commission names its colour, so a drawn food's colour is
 * true by construction rather than by guesswork.
 */
export function dominantColor(
  cells: Iterable<number>,
  palette: readonly string[],
): FoodColor | null {
  const tally = new Map<FoodColor, number>()
  for (const index of cells) {
    if (index === 0) continue // paper
    const hex = palette[index]
    if (typeof hex !== 'string') continue
    const nearest = nearestFoodColor(parseInt(hex.slice(1), 16))
    tally.set(nearest, (tally.get(nearest) ?? 0) + 1)
  }
  let best: FoodColor | null = null
  let bestCount = 0
  for (const color of FOOD_COLORS) {
    const count = tally.get(color) ?? 0
    if (count > bestCount) {
      best = color
      bestCount = count
    }
  }
  return best
}

/** Nearest food accent to an RGB value, by squared channel distance. */
function nearestFoodColor(rgb: number): FoodColor {
  const r = (rgb >> 16) & 0xff
  const g = (rgb >> 8) & 0xff
  const b = rgb & 0xff
  let best: FoodColor = FOOD_COLORS[0]
  let bestDist = Infinity
  for (const color of FOOD_COLORS) {
    const accent = COLOR_HEX[color]
    const dr = r - ((accent >> 16) & 0xff)
    const dg = g - ((accent >> 8) & 0xff)
    const db = b - (accent & 0xff)
    const dist = dr * dr + dg * dg + db * db
    if (dist < bestDist) {
      bestDist = dist
      best = color
    }
  }
  return best
}

// ─── Adaptive cognitive meter ────────────────────────────────────────────────

export const SKILL_START = 0
export const SKILL_MAX = 12

/**
 * A round finished faster than this with no spit-backs counts as "clean" and
 * nudges the meter up. Generous on purpose: dragging several foods takes a
 * while, and the timer starts when the bubble appears.
 */
export const FAST_ROUND_MS = 25_000

/** Spitting back this many wrong foods in one round eases the meter. */
export const SPIT_BACKS_BEFORE_EASE = 2

/** What the scene reports after every completed round. */
export interface RoundResult {
  /** Wrong foods the monster spat back this round (cognitive errors). */
  spitBacks: number
  /** Time from bubble shown to round complete, ms. */
  ms: number
}

function clampSkill(value: number): number {
  return Math.min(Math.max(Math.round(value), SKILL_START), SKILL_MAX)
}

/**
 * One adaptive step per completed round, asymmetric by design — no-fail means
 * struggling eases the game gently, never punishes: two or more spit-backs →
 * −1; one slip or a slow round → hold; clean & quick → +1. Up-steps double
 * (+2) while the meter sits below its saved PEAK, so the session warm-up
 * (shared/progress.sessionStart) lasts a couple of rounds, not half a session.
 */
export function updateSkill(skill: number, result: RoundResult, peak = SKILL_START): number {
  const current = clampSkill(skill)
  if (result.spitBacks >= SPIT_BACKS_BEFORE_EASE) return clampSkill(current - 1)
  const clean = result.spitBacks === 0 && result.ms <= FAST_ROUND_MS
  if (!clean) return current
  return clampSkill(current + (current < peak ? 2 : 1))
}

// ─── Task-kind registry ──────────────────────────────────────────────────────

/**
 * Every request the generator can produce. `single`/`count`/`combo` share the
 * CountRequest shape but are separate registry rows so rotation, unlocks and
 * weights treat them as distinct experiences.
 */
export type TaskKind =
  | 'single' // one specific food
  | 'count' // N of one food, counted as repeated pictures
  | 'color' // N foods of a color (any type)
  | 'combo' // two different foods at once
  | 'dots' // the count shown as dot pips, not repeated pictures (subitizing)
  | 'mix' // a specific food AND a color together (two attributes at once)
  | 'not' // anything EXCEPT the crossed-out food/color (negation)
  | 'pattern' // continue the AB/ABB/ABC sequence
  | 'dish' // COOK it: put the recipe's parts in the pot, feed what comes out
  | 'dish-ordered' // …and the parts must go in left-to-right (sequencing)

export interface TaskKindDef {
  kind: TaskKind
  /** Meter value at which this kind joins the rotation. */
  minSkill: number
  /** Meter value after which it retires (trivial kinds fade out). */
  maxSkill: number
  /** Relative pick weight once unlocked. */
  weight: number
}

/**
 * Unlock ladder over the 0..12 meter — medium progression speed: one new
 * kind roughly every 1-2 clean rounds at first, slowing toward the top.
 * `single` retires once real counting starts so it never bores.
 */
export const TASK_REGISTRY: readonly TaskKindDef[] = [
  { kind: 'single', minSkill: 0, maxSkill: 2, weight: 3 },
  { kind: 'count', minSkill: 1, maxSkill: 12, weight: 3 },
  { kind: 'color', minSkill: 2, maxSkill: 12, weight: 3 },
  { kind: 'dots', minSkill: 3, maxSkill: 12, weight: 3 },
  { kind: 'combo', minSkill: 4, maxSkill: 12, weight: 3 },
  { kind: 'not', minSkill: 5, maxSkill: 12, weight: 2 },
  // Composition lands just after `combo` (two things at once) and around `not`:
  // the child is comfortable with multi-item requests before being asked to
  // assemble one. Ordered cooking is the actual sequencing trainer and only
  // appears high up.
  { kind: 'dish', minSkill: 5, maxSkill: 12, weight: 3 },
  { kind: 'pattern', minSkill: 6, maxSkill: 12, weight: 2 },
  { kind: 'mix', minSkill: 7, maxSkill: 12, weight: 3 },
  { kind: 'dish-ordered', minSkill: 10, maxSkill: 12, weight: 2 },
]

/** Kinds currently in rotation for a meter value. */
export function unlockedKinds(skill: number): TaskKind[] {
  const s = clampSkill(skill)
  return TASK_REGISTRY.filter((def) => s >= def.minSkill && s <= def.maxSkill).map(
    (def) => def.kind,
  )
}

/** How many recent kinds the generator avoids repeating (variety window). */
export const KIND_HISTORY = 2

/**
 * Weighted pick of the next task kind, skipping recently played kinds so
 * tasks rotate visibly. Falls back to shorter memory (then to everything
 * unlocked) when few kinds are available yet.
 */
export function pickTaskKind(
  skill: number,
  recent: readonly TaskKind[],
  rng: Rng,
  avoid: readonly TaskKind[] = [],
): TaskKind {
  const banned = new Set(avoid)
  const eligible = TASK_REGISTRY.filter(
    (def) => clampSkill(skill) >= def.minSkill && clampSkill(skill) <= def.maxSkill,
  )
  // A mode that can't host some kinds still has to get a playable round: fall
  // back to the full unlocked set only if excluding leaves nothing at all.
  const allowed = eligible.filter((def) => !banned.has(def.kind))
  const unlocked = allowed.length > 0 ? allowed : eligible
  for (let memory = Math.min(KIND_HISTORY, recent.length); memory >= 0; memory--) {
    const avoid = new Set(recent.slice(recent.length - memory))
    const candidates = unlocked.filter((def) => !avoid.has(def.kind))
    if (candidates.length === 0) continue
    const total = candidates.reduce((sum, def) => sum + def.weight, 0)
    let roll = rng() * total
    for (const def of candidates) {
      roll -= def.weight
      if (roll < 0) return def.kind
    }
    return candidates[candidates.length - 1].kind
  }
  return unlocked[0].kind
}

// ─── Requests ────────────────────────────────────────────────────────────────

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

/**
 * Two attributes at once: N of a specific food AND M things of a color. The
 * color is always different from the food's own color, so every tray item
 * matches at most one half of the request — no ambiguity.
 */
export interface MixRequest {
  kind: 'mix'
  food: CountEntry
  color: FoodColor
  colorCount: number
}

/** "Eat as many of this food as the pips show" — count carried by dots only. */
export interface DotsRequest {
  kind: 'dots'
  foodId: string
  count: number
}

/** "Eat N things that are NOT this" — a crossed-out food or color. */
export interface NotRequest {
  kind: 'not'
  bannedFoodId?: string
  bannedColor?: FoodColor
  count: number
}

/** "What comes next?" — feed the food that continues the shown sequence. */
export interface PatternRequest {
  kind: 'pattern'
  /** The visible part of the sequence, in order. */
  sequence: string[]
  /** The one food that correctly fills the pulsing slot. */
  answerId: string
}

/**
 * "Cook me this." The pot's contents live in the scene (kitchenMode) rather than
 * in `eaten`, because the parts are never EATEN — only the finished dish is, which
 * is why `requestTotal` is 1 and `wantsFood` accepts nothing but the result. The
 * friend refuses raw ingredients with the familiar spit-back, so there is exactly
 * one right thing to do at every moment of the round.
 */
export interface DishRequest {
  kind: 'dish'
  recipeId: string
  /** Parts must go in left-to-right; an out-of-order part is spat back. */
  ordered: boolean
}

export type FoodRequest =
  CountRequest | ColorRequest | MixRequest | DotsRequest | NotRequest | PatternRequest | DishRequest

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
export function activePoolForRound(round: number, foods: readonly Food[] = FOODS): Food[] {
  const shift = (Math.floor((round - 1) / 3) * 2) % foods.length
  return Array.from({ length: ACTIVE_POOL_SIZE }, (_, i) => foods[(shift + i) % foods.length])
}

/**
 * Guarantee a specific food is in this round's window, by SUBSTITUTING a member
 * of the SAME COLOUR. Rotation means a food sitting at index 0 of the catalog is
 * only inside the 8-wide window a third of the time, so a round that must be
 * about one particular food (the drawn-food callback) cannot just hope. Swapping
 * same-for-same colour is what keeps the "every window has every colour"
 * invariant intact while doing it.
 */
export function poolWithFood(
  pool: readonly Food[],
  foodId: string | undefined,
  catalog: readonly Food[],
): Food[] {
  const next = [...pool]
  if (foodId === undefined || next.some((f) => f.id === foodId)) return next
  const wanted = catalog.find((f) => f.id === foodId)
  if (!wanted) return next
  const at = next.findIndex((f) => f.color === wanted.color)
  next[at >= 0 ? at : 0] = wanted
  return next
}

// ─── Per-kind difficulty dials (all scale with the meter) ────────────────────

/** How many of one food a count round asks for. */
export function countTargetRange(skill: number): { min: number; max: number } {
  if (skill < 4) return { min: 2, max: 3 }
  if (skill < 8) return { min: 2, max: 4 }
  return { min: 3, max: 5 }
}

/** How many pips a dots round shows (subitizing range grows with skill). */
export function dotsTargetRange(skill: number): { min: number; max: number } {
  if (skill < 6) return { min: 2, max: 3 }
  if (skill < 9) return { min: 3, max: 4 }
  return { min: 3, max: 5 }
}

/** How many color-matching foods a color round asks for. */
export function colorTargetRange(skill: number): { min: number; max: number } {
  return skill < 8 ? { min: 2, max: 3 } : { min: 2, max: 4 }
}

/** Whether "not" rounds may ban a whole color (harder than one food). */
export const NOT_COLOR_MIN_SKILL = 9

/**
 * How many parts a kitchen recipe may have. Kids' cooking games settle on 3–4
 * steps per dish, but those target 6+; for a 3–4-year-old the entry point is TWO,
 * and four ingredients (five drags in one round) belongs at the very top.
 */
export function dishMaxIngredients(skill: number): number {
  if (skill < 8) return 2
  if (skill < 11) return 3
  return 4
}

// ─── Kitchen: the pot ─────────────────────────────────────────────────────────

/**
 * Which ingredients the pot will accept right now. In an ordered round that is
 * exactly one — the next part left-to-right, which is what makes it a sequencing
 * exercise. In a free round it is every part not yet in, as a multiset (so a
 * recipe naming the same food twice would need it twice).
 */
export function potWants(request: DishRequest, pot: readonly string[]): string[] {
  const { ingredients } = recipeById(request.recipeId)
  if (request.ordered) {
    const next = ingredients[pot.length]
    return next === undefined ? [] : [next]
  }
  return potRemaining(request, pot)
}

/**
 * Every part the pot is still missing, whatever the order — the multiset of the
 * recipe minus what is already in.
 *
 * Distinct from `potWants`, which answers "what may go in NEXT" and in an ordered
 * round names exactly one part. Anything that must not remove a part the round
 * still needs has to ask THIS: an ordered recipe's third ingredient is not
 * acceptable yet, but it is every bit as required. (The thief stole one and left
 * the round uncookable — see FeedTheMonsterScene.wantsNow.)
 */
export function potRemaining(request: DishRequest, pot: readonly string[]): string[] {
  const remaining = [...recipeById(request.recipeId).ingredients]
  for (const inside of pot) {
    const at = remaining.indexOf(inside)
    if (at >= 0) remaining.splice(at, 1)
  }
  return remaining
}

/** Would dropping this food in the pot be right? (else the pot spits it back) */
export function potAccepts(request: DishRequest, pot: readonly string[], foodId: string): boolean {
  return potWants(request, pot).includes(foodId)
}

/** Are all the parts in? Then the finished dish pops out, draggable. */
export function isDishCooked(request: DishRequest, pot: readonly string[]): boolean {
  return potWants(request, pot).length === 0
}

/** The food a cooked pot produces — the ONE thing this round feeds. */
export function dishResult(request: DishRequest): string {
  return recipeById(request.recipeId).resultFoodId
}

/** Pattern blocks by skill: AB first, then ABB, then ABC joins. */
export function patternShapes(skill: number): string[][] {
  const shapes: string[][] = [['A', 'B']]
  if (skill >= 8) shapes.push(['A', 'B', 'B'])
  if (skill >= 10) shapes.push(['A', 'B', 'C'])
  return shapes
}

/**
 * Whole pattern blocks laid out before the missing slot — sized so the bubble
 * always shows exactly 5 pictures + 1 slot, whatever the block length.
 */
export function patternBlockCount(shape: readonly string[]): number {
  return shape.length === 2 ? 3 : 2
}

// ─── Request generation ──────────────────────────────────────────────────────

/** The previous round's primary food target, to avoid a back-to-back repeat. */
function primaryFoodOf(request: FoodRequest | undefined): string | undefined {
  if (!request) return undefined
  switch (request.kind) {
    case 'count':
      return request.entries[0].foodId
    case 'mix':
      return request.food.foodId
    case 'dots':
      return request.foodId
    case 'not':
      return request.bannedFoodId
    case 'pattern':
      return request.answerId
    case 'dish':
      return dishResult(request)
    case 'color':
      return undefined
  }
}

/** The previous round's primary color target, to avoid a back-to-back repeat. */
function primaryColorOf(request: FoodRequest | undefined): FoodColor | undefined {
  if (!request) return undefined
  switch (request.kind) {
    case 'color':
      return request.color
    case 'mix':
      return request.color
    case 'not':
      return request.bannedColor
    default:
      return undefined
  }
}

function withoutFood(pool: Food[], foodId: string | undefined): Food[] {
  const filtered = pool.filter((f) => f.id !== foodId)
  return filtered.length > 0 ? filtered : pool
}

function poolColors(pool: Food[]): FoodColor[] {
  return [...new Set(pool.map((f) => f.color))]
}

function pickColor(pool: Food[], avoid: FoodColor | undefined, rng: Rng): FoodColor {
  const all = poolColors(pool)
  const colors = all.filter((c) => c !== avoid)
  return pickOne(rng, colors.length > 0 ? colors : all)
}

/**
 * Does naming one food for this kind mean "I WANT this one"?
 *
 * The drawn-food callback nudge is honoured only for these kinds. It must never
 * reach `not` — which would BAN the child's drawing, the exact opposite of the
 * callback — nor `pattern` / `color`, where a named food is context, not the ask.
 */
export function kindWantsNamedFood(kind: TaskKind): boolean {
  return kind === 'single' || kind === 'count' || kind === 'dots'
}

/** Build a request for the picked kind at the current meter value. */
function generateRequest(
  kind: TaskKind,
  skill: number,
  pool: Food[],
  rng: Rng,
  previous?: FoodRequest,
  preferFoodId?: string,
): FoodRequest {
  const preferred = kindWantsNamedFood(kind) ? pool.find((f) => f.id === preferFoodId) : undefined
  const foodPool = preferred ? [preferred] : withoutFood(pool, primaryFoodOf(previous))
  const avoidColor = primaryColorOf(previous)

  switch (kind) {
    case 'single':
      return { kind: 'count', entries: [{ foodId: pickOne(rng, foodPool).id, count: 1 }] }
    case 'count': {
      const { min, max } = countTargetRange(skill)
      return {
        kind: 'count',
        entries: [{ foodId: pickOne(rng, foodPool).id, count: randInt(rng, min, max) }],
      }
    }
    case 'color': {
      const { min, max } = colorTargetRange(skill)
      return {
        kind: 'color',
        color: pickColor(pool, avoidColor, rng),
        count: randInt(rng, min, max),
      }
    }
    case 'combo': {
      const first = pickOne(rng, foodPool)
      const second = pickOne(
        rng,
        pool.filter((f) => f.id !== first.id),
      )
      const big = skill >= 8
      return {
        kind: 'count',
        entries: [
          { foodId: first.id, count: randInt(rng, 2, 3) },
          { foodId: second.id, count: randInt(rng, 1, big ? 3 : 2) },
        ],
      }
    }
    case 'dots': {
      const { min, max } = dotsTargetRange(skill)
      return { kind: 'dots', foodId: pickOne(rng, foodPool).id, count: randInt(rng, min, max) }
    }
    case 'mix': {
      const food = pickOne(rng, foodPool)
      // The color half must have at least one non-`food` match in the pool
      // (satisfiable) and must differ from the food's own color (no
      // ambiguity). The pool's full-color-cycle guarantee means the preferred
      // set is never empty; `candidates` alone still keeps the tray builder
      // safe if that guarantee ever weakens.
      const candidates = poolColors(pool).filter((c) =>
        pool.some((f) => f.color === c && f.id !== food.id),
      )
      const preferred = candidates.filter((c) => c !== food.color)
      const color = pickOne(rng, preferred.length > 0 ? preferred : candidates)
      return {
        kind: 'mix',
        food: { foodId: food.id, count: randInt(rng, 1, 2) },
        color,
        colorCount: randInt(rng, 1, 2),
      }
    }
    case 'not': {
      const count = randInt(rng, 2, 3)
      if (skill >= NOT_COLOR_MIN_SKILL && rng() < 0.5) {
        return { kind: 'not', bannedColor: pickColor(pool, avoidColor, rng), count }
      }
      return { kind: 'not', bannedFoodId: pickOne(rng, foodPool).id, count }
    }
    case 'dish':
    case 'dish-ordered': {
      const options = recipesUpTo(dishMaxIngredients(skill))
      // Don't cook the same dish twice in a row when there is a choice.
      const previousRecipe = previous?.kind === 'dish' ? previous.recipeId : undefined
      const fresh = options.filter((r) => r.id !== previousRecipe)
      const recipe = pickOne(rng, fresh.length > 0 ? fresh : options)
      return { kind: 'dish', recipeId: recipe.id, ordered: kind === 'dish-ordered' }
    }
    case 'pattern': {
      const shape = pickOne(rng, patternShapes(skill))
      const roles = [...new Set(shape)]
      const picks: Record<string, string> = {}
      let candidates = foodPool
      for (const role of roles) {
        const food = pickOne(rng, candidates)
        picks[role] = food.id
        candidates = candidates.filter((f) => f.id !== food.id)
        if (candidates.length === 0) candidates = pool
      }
      const full: string[] = []
      for (let block = 0; block < patternBlockCount(shape); block++) {
        for (const role of shape) full.push(picks[role])
      }
      // Show everything up to the last item; the last item is the answer.
      const answerId = full[full.length - 1]
      return { kind: 'pattern', sequence: full.slice(0, -1), answerId }
    }
  }
}

/** Total number of foods the monster wants this round (also the beep count). */
export function requestTotal(request: FoodRequest): number {
  switch (request.kind) {
    case 'count':
      return request.entries.reduce((sum, entry) => sum + entry.count, 0)
    case 'color':
    case 'dots':
    case 'not':
      return request.count
    case 'mix':
      return request.food.count + request.colorCount
    case 'pattern':
      return 1
    case 'dish':
      // ONE thing is fed: the dish that comes out of the pot. The parts are
      // cooked, never eaten.
      return 1
  }
}

/** Is this food forbidden by a `not` request? */
function isBanned(request: NotRequest, foodId: string): boolean {
  if (request.bannedFoodId !== undefined) return foodId === request.bannedFoodId
  return foodById(foodId).color === request.bannedColor
}

/**
 * Compose the tray: exactly the requested items (so clearing the request is
 * always possible) plus plausible distractors chosen so the discrimination
 * the task trains stays unambiguous (e.g. color rounds pad with strictly
 * other-colored foods, `not` rounds plant real banned temptations).
 */
export function generateTray(
  request: FoodRequest,
  pool: Food[],
  rng: Rng,
  skill = SKILL_START,
): string[] {
  const tray: string[] = []
  let distractors: Food[]

  switch (request.kind) {
    case 'color': {
      const matching = pool.filter((f) => f.color === request.color)
      for (let i = 0; i < request.count; i++) tray.push(pickOne(rng, matching).id)
      distractors = pool.filter((f) => f.color !== request.color)
      break
    }
    case 'count': {
      for (const entry of request.entries) {
        for (let i = 0; i < entry.count; i++) tray.push(entry.foodId)
      }
      const requested = new Set(request.entries.map((entry) => entry.foodId))
      distractors = pool.filter((f) => !requested.has(f.id))
      break
    }
    case 'mix': {
      for (let i = 0; i < request.food.count; i++) tray.push(request.food.foodId)
      const matching = pool.filter((f) => f.color === request.color && f.id !== request.food.foodId)
      for (let i = 0; i < request.colorCount; i++) tray.push(pickOne(rng, matching).id)
      distractors = pool.filter((f) => f.id !== request.food.foodId && f.color !== request.color)
      break
    }
    case 'dots': {
      for (let i = 0; i < request.count; i++) tray.push(request.foodId)
      distractors = pool.filter((f) => f.id !== request.foodId)
      break
    }
    case 'not': {
      const allowed = pool.filter((f) => !isBanned(request, f.id))
      const banned = pool.filter((f) => isBanned(request, f.id))
      for (let i = 0; i < request.count; i++) tray.push(pickOne(rng, allowed).id)
      // Plant real temptations — the negation is only tested if the banned
      // thing is actually on the table.
      const temptations = Math.min(randInt(rng, 2, 3), TRAY_SIZE - tray.length)
      for (let i = 0; i < temptations; i++) tray.push(pickOne(rng, banned).id)
      distractors = allowed
      break
    }
    case 'pattern': {
      tray.push(request.answerId)
      // The other sequence members are the tempting near-misses.
      const members = [...new Set(request.sequence)].filter((id) => id !== request.answerId)
      for (const id of members) tray.push(id)
      distractors = pool
      break
    }
    case 'dish': {
      const recipe = recipeById(request.recipeId)
      // Every part the recipe needs is always present — the same guarantee the
      // tray gives every other kind.
      for (const id of recipe.ingredients) tray.push(id)
      // The RESULT is never a distractor: a spare burger on the tray would let
      // the child skip the pot entirely, which is the one way to cheat this round.
      const off = new Set(recipeFoods(recipe))
      const rivals = rivalIngredients(recipe, pool).filter((id) => !off.has(id))
      const unrelated = pool.filter((f) => !off.has(f.id)).map((f) => f.id)
      // Hard distractors (parts of OTHER dishes) at the top of the range, so the
      // child has to read the recipe rather than pick the odd-looking ones.
      const hard = skill >= 10 && rivals.length > 0
      const source = hard ? rivals : unrelated.length > 0 ? unrelated : rivals
      distractors = (source.length > 0 ? source : recipe.ingredients).map(foodById)
      break
    }
  }

  while (tray.length < TRAY_SIZE) {
    tray.push(pickOne(rng, distractors).id)
  }
  return shuffle(rng, tray)
}

export interface Round {
  round: number
  /** The registry row this round plays (single/combo report as themselves). */
  taskKind: TaskKind
  request: FoodRequest
  tray: string[]
}

/** Everything the generator needs to compute the next round dynamically. */
export interface RoundContext {
  round: number
  /** Adaptive cognitive meter, 0..12. */
  skill: number
  /** Most recent task kinds, oldest first (variety window). */
  recentKinds?: readonly TaskKind[]
  /** The previous request, to avoid a back-to-back primary-target repeat. */
  previous?: FoodRequest
  /**
   * The rotating food list (an episode pool; defaults to episode 1's FOODS).
   * Must be full 6-color cycles — see journey.EPISODES.
   */
  foods?: readonly Food[]
  /** Test/e2e override: force a specific kind regardless of the meter. */
  forceKind?: TaskKind
  /**
   * Kinds the round must NOT be, whatever the meter says. Used by round MODES
   * that can't host every task — a conveyor round can't also be a kitchen round,
   * because the belt replaces the very tray the pot is filled from.
   */
  avoidKinds?: readonly TaskKind[]
  /**
   * Nudge the round to be ABOUT this food when the picked kind is one that names
   * a single food. This is the drawn-food callback — "a few rounds later the
   * friend asks for the thing you drew, by name" — and it is deliberately a
   * one-line nudge rather than a new task kind: the emotional payoff costs
   * nothing mechanically.
   */
  preferFoodId?: string
}

/** Generate one full round: formula-picked kind + always-satisfiable tray. */
export function generateRound(context: RoundContext, rng: Rng = Math.random): Round {
  const skill = clampSkill(context.skill)
  const taskKind =
    context.forceKind ??
    pickTaskKind(skill, context.recentKinds ?? [], rng, context.avoidKinds ?? [])
  const catalog = context.foods ?? FOODS
  // The nudge is a total no-op — request AND pool — for a kind that would not
  // treat the named food as the ask.
  const nudge = kindWantsNamedFood(taskKind) ? context.preferFoodId : undefined
  const pool = poolWithFood(activePoolForRound(context.round, catalog), nudge, catalog)
  const request = generateRequest(
    taskKind,
    skill,
    pool,
    rng,
    context.previous,
    context.preferFoodId,
  )
  return {
    round: context.round,
    taskKind,
    request,
    tray: generateTray(request, pool, rng, skill),
  }
}

// ─── Duo bonus round (the second axis: data + chance) ─────────────────────────
//
// A duo round stands TWO little friends side by side, each wanting its own food,
// fed from ONE shared tray (see journey.DUO_GROW_STEPS). It is picked by its own
// axis — data (skill / struggle / episode slots left) + chance — layered on top
// of the meter-driven single-monster rounds, never by the meter itself.

/** One duo friend's request: a count of a single, distinct food (feed THIS to
 * the bunny, THAT to the frog). Kept simple on purpose — the challenge of a duo
 * is SORTING between two mouths, not a compound task per mouth. */
export interface DuoRound {
  round: number
  kind: 'duo'
  left: CountRequest
  right: CountRequest
  /** One shared tray that satisfies both sides, plus distractors. */
  tray: string[]
}

/** Per-side count for a duo — small (the duo is only three rounds, and the
 * sorting between two mouths is the point, not big numbers). */
export function duoSideCount(skill: number): { min: number; max: number } {
  return clampSkill(skill) < 6 ? { min: 1, max: 2 } : { min: 2, max: 3 }
}

function duoSideRequest(foodId: string, skill: number, rng: Rng): CountRequest {
  const { min, max } = duoSideCount(skill)
  return { kind: 'count', entries: [{ foodId, count: randInt(rng, min, max) }] }
}

/**
 * Build a duo round: two DISTINCT foods (one per friend) so every tray item
 * belongs unambiguously to one mouth, small counts, and a shared tray that holds
 * exactly both requests plus other-food distractors (never either wanted food).
 */
export function generateDuoRound(
  context: { round: number; skill: number; foods?: readonly Food[] },
  rng: Rng = Math.random,
): DuoRound {
  const skill = clampSkill(context.skill)
  const pool = activePoolForRound(context.round, context.foods ?? FOODS)
  const leftFood = pickOne(rng, pool)
  const rightFood = pickOne(
    rng,
    pool.filter((f) => f.id !== leftFood.id),
  )
  const left = duoSideRequest(leftFood.id, skill, rng)
  const right = duoSideRequest(rightFood.id, skill, rng)

  const tray: string[] = []
  for (const entry of [...left.entries, ...right.entries]) {
    for (let i = 0; i < entry.count; i++) tray.push(entry.foodId)
  }
  const wanted = new Set([leftFood.id, rightFood.id])
  const distractors = pool.filter((f) => !wanted.has(f.id))
  while (tray.length < TRAY_SIZE) tray.push(pickOne(rng, distractors).id)
  return { round: context.round, kind: 'duo', left, right, tray: shuffle(rng, tray) }
}

// Injection axis dials — tuned so a duo lands roughly once an episode, sooner
// and more often for a child who is cruising, never for one who is struggling.
/** Below this meter value the child is still learning the basics — no duos yet. */
export const DUO_MIN_SKILL = 2
/** Never two duos within this many rounds (no back-to-back bonus). */
export const DUO_MIN_GAP = 3
/** Base injection chance once eligible… */
export const DUO_BASE_CHANCE = 0.18
/** …rising each further round since the last duo (anti-drought)… */
export const DUO_RAMP = 0.09
/** …capped here. */
export const DUO_MAX_CHANCE = 0.7

/** Everything the duo axis weighs — the game's DATA, not the round number. */
export interface DuoContext {
  /** Adaptive meter (competence gate). */
  skill: number
  /** Rounds since the last duo (large if never) — drives the anti-drought ramp. */
  roundsSinceLastDuo: number
  /** Did the last round ease the meter (≥2 spit-backs)? Then don't pile on. */
  struggling: boolean
  /** Episode slots left (FRIENDS_PER_EPISODE − friendsFed); a duo fills two. */
  slotsLeft: number
}

/**
 * The new axis: should the NEXT round be a two-friend duo bonus? Gated on
 * competence (skill up, not currently struggling) and pacing (≥2 slots left,
 * never back-to-back), then a chance that ramps the longer it's been — so a duo
 * reads as an earned, well-spaced treat, not a random difficulty spike. Pure +
 * seedable; the scene feeds it live data and Math.random.
 */
export function shouldInjectDuo(ctx: DuoContext, rng: Rng): boolean {
  if (ctx.slotsLeft < 2) return false
  if (clampSkill(ctx.skill) < DUO_MIN_SKILL) return false
  if (ctx.struggling) return false
  if (ctx.roundsSinceLastDuo < DUO_MIN_GAP) return false
  const chance = Math.min(
    DUO_MAX_CHANCE,
    DUO_BASE_CHANCE + DUO_RAMP * (ctx.roundsSinceLastDuo - DUO_MIN_GAP),
  )
  return rng() < chance
}

// ─── Feeding rules ───────────────────────────────────────────────────────────

function eatenCountOf(eaten: readonly string[], foodId: string): number {
  return eaten.filter((id) => id === foodId).length
}

function eatenColorCount(eaten: readonly string[], color: FoodColor): number {
  return eaten.filter((id) => foodById(id).color === color).length
}

/** Would dropping this food in the mouth be a correct feed right now? */
export function wantsFood(request: FoodRequest, eaten: readonly string[], foodId: string): boolean {
  switch (request.kind) {
    case 'count': {
      const entry = request.entries.find((e) => e.foodId === foodId)
      return entry !== undefined && eatenCountOf(eaten, foodId) < entry.count
    }
    case 'color':
      return eaten.length < request.count && foodById(foodId).color === request.color
    case 'mix': {
      if (foodId === request.food.foodId) {
        return eatenCountOf(eaten, foodId) < request.food.count
      }
      // The food half's color never equals the request color (generator
      // guarantee), so color-half accounting can count colors directly.
      return (
        foodById(foodId).color === request.color &&
        eatenColorCount(eaten, request.color) < request.colorCount
      )
    }
    case 'dots':
      return foodId === request.foodId && eaten.length < request.count
    case 'not':
      return eaten.length < request.count && !isBanned(request, foodId)
    case 'pattern':
      return eaten.length < 1 && foodId === request.answerId
    case 'dish':
      // Only the cooked dish. A raw part offered to the mouth is refused with the
      // familiar spit-back — consistency matters more than novelty here, the
      // child already knows what that means.
      return eaten.length < 1 && foodId === dishResult(request)
  }
}

/** `eaten` only ever accumulates correct feeds, so length equality is completeness. */
export function isRoundComplete(request: FoodRequest, eaten: readonly string[]): boolean {
  return eaten.length >= requestTotal(request)
}

// ─── Thought-bubble pictures ─────────────────────────────────────────────────

/**
 * One picture inside the thought bubble: a food, a color splash, a dot-pip
 * cluster (subitizing), a crossed-out (banned) tile, or the pattern's pulsing
 * empty slot.
 *
 * A food tile carries its `foodId`, not its glyph: the renderer resolves the id
 * to whatever that food actually looks like — a reskin sprite, an emoji strike,
 * or the child's own drawing. (It used to carry the emoji and the bubble mapped
 * it back to an id, which every drawn food would have collided on: they all show
 * the same ✏️ fallback glyph.)
 */
export interface BubbleItem {
  foodId?: string
  color?: FoodColor
  /** Pip count — the tile shows this many dots (dots rounds). */
  dots?: number
  /** Crossed out — the monster does NOT want this (not rounds). */
  banned?: boolean
  /** Empty pulsing slot: pattern answer, or a not-round progress placeholder. */
  slot?: boolean
}

/** The request rendered as pictures. */
export function bubbleItems(request: FoodRequest): BubbleItem[] {
  switch (request.kind) {
    case 'count':
      return request.entries.flatMap((entry) =>
        Array.from({ length: entry.count }, () => ({ foodId: entry.foodId })),
      )
    case 'color':
      return Array.from({ length: request.count }, () => ({ color: request.color }))
    case 'mix':
      return [
        ...Array.from({ length: request.food.count }, () => ({ foodId: request.food.foodId })),
        ...Array.from({ length: request.colorCount }, () => ({ color: request.color })),
      ]
    case 'dots':
      return [{ foodId: request.foodId }, { dots: request.count }]
    case 'not': {
      const bannedTile: BubbleItem =
        request.bannedFoodId !== undefined
          ? { foodId: request.bannedFoodId, banned: true }
          : { color: request.bannedColor, banned: true }
      return [bannedTile, ...Array.from({ length: request.count }, () => ({ slot: true }))]
    }
    case 'pattern':
      return [...request.sequence.map((id) => ({ foodId: id })), { slot: true }]
    case 'dish':
      // ONE tile: the finished dish the friend wants. The RECIPE that makes it is
      // not the friend's business — it hangs over the POT on its own panel
      // (recipePanel.ts), so each of the round's two asks sits on the thing it is
      // about instead of both being crammed into the friend's bubble.
      return [{ foodId: dishResult(request) }]
  }
}

/**
 * Which bubble pictures are grayed out (or, for slots, filled), aligned
 * index-for-index with bubbleItems(). Handles out-of-order mix/combo feeding.
 * Dots tiles never gray — the scene lights individual pips via eaten.length.
 */
export function grayedBubbleItems(request: FoodRequest, eaten: readonly string[]): boolean[] {
  switch (request.kind) {
    case 'count': {
      const flags: boolean[] = []
      for (const entry of request.entries) {
        const eatenOfFood = eatenCountOf(eaten, entry.foodId)
        for (let i = 0; i < entry.count; i++) flags.push(i < eatenOfFood)
      }
      return flags
    }
    case 'color':
      return Array.from({ length: request.count }, (_, i) => i < eaten.length)
    case 'mix': {
      const foodEaten = eatenCountOf(eaten, request.food.foodId)
      const colorEaten = eatenColorCount(eaten, request.color)
      return [
        ...Array.from({ length: request.food.count }, (_, i) => i < foodEaten),
        ...Array.from({ length: request.colorCount }, (_, i) => i < colorEaten),
      ]
    }
    case 'dots':
      return [isRoundComplete(request, eaten), false]
    case 'not':
      return [false, ...Array.from({ length: request.count }, (_, i) => i < eaten.length)]
    case 'pattern':
      return [...request.sequence.map(() => false), isRoundComplete(request, eaten)]
    case 'dish':
      // Only the finished dish lives in the friend's bubble, and it is answerable
      // from `eaten`. The recipe's parts are never EATEN (they are cooked), so their
      // progress is driven straight from the pot onto the pot's own panel — the same
      // way dots drives its pips and `not` its sockets.
      return [isRoundComplete(request, eaten)]
  }
}
