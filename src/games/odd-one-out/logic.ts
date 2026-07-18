/**
 * Pure puzzle-generation and difficulty logic for Odd One Out. No DOM, no
 * audio, no timers — everything is deterministic given an injected RNG and is
 * unit-tested in logic.test.ts. The component consumes these transitions at
 * event granularity (tap / round boundaries) only.
 *
 * Level ladder (from the categorization research brief — rule switches only
 * BETWEEN rounds, never within):
 *   L1 color odd · L2 shape/size odd · L3 basic category ·
 *   L4 superordinate category · L5 concept stretch (flies/swims, hot/cold).
 *
 * The ladder is this game's cognitive skill meter and persists across
 * sessions (shared/progress.ts): a session starts one level below the saved
 * one (minus break decay), and while below the session PEAK the climb needs
 * fewer solves — a short warm-up, not a full re-grind.
 */

/** Injectable random source, [0, 1). Defaults to Math.random in the game. */
export type Rng = () => number

export type ColorFamily =
  'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'brown' | 'white' | 'gray'

export type SizeClass = 'small' | 'big'
export type Shape = 'round' | 'square' | 'heart' | 'star' | 'long'
export type Superordinate =
  'animal' | 'vehicle' | 'food' | 'clothing' | 'nature' | 'shape' | 'object' | 'toy'
export type Concept = 'flies' | 'swims' | 'hot' | 'cold'
/** How the solved odd item leaves the screen: vehicles drive, birds fly, rest hop. */
export type ExitMotion = 'drive' | 'fly' | 'hop'

export interface BankItem {
  id: string
  /** Accessibility label only — the child never reads text. */
  name: string
  emoji: string
  /** Rotation pool (fruits, animals, vehicles, clothes, weather, …). */
  theme: string
  color: ColorFamily
  size: SizeClass
  /** Basic-level category (fish/bird/fruit/car…); singletons only serve as odd items. */
  basic: string
  superordinate: Superordinate
  concepts: readonly Concept[]
  exit: ExitMotion
  /** Simple geometric silhouette, only for shape puzzles. */
  shape?: Shape
  /** Same-thing-different-color family (hearts, circles, books, apples…) for L1. */
  variantGroup?: string
}

interface ItemExtras {
  shape?: Shape
  variantGroup?: string
  concepts?: readonly Concept[]
}

function def(
  id: string,
  name: string,
  emoji: string,
  theme: string,
  color: ColorFamily,
  size: SizeClass,
  basic: string,
  superordinate: Superordinate,
  exit: ExitMotion,
  extras: ItemExtras = {},
): BankItem {
  return {
    id,
    name,
    emoji,
    theme,
    color,
    size,
    basic,
    superordinate,
    concepts: extras.concepts ?? [],
    exit,
    shape: extras.shape,
    variantGroup: extras.variantGroup,
  }
}

/** Same object in several colors — the raw material for L1 color puzzles. */
function variants(
  group: string,
  label: string,
  theme: string,
  basic: string,
  superordinate: Superordinate,
  shape: Shape | undefined,
  entries: ReadonlyArray<readonly [ColorFamily, string]>,
): BankItem[] {
  return entries.map(([color, emoji]) => {
    const name = `${color.charAt(0).toUpperCase()}${color.slice(1)} ${label}`
    return def(
      `${group}-${color}`,
      name,
      emoji,
      theme,
      color,
      'small',
      basic,
      superordinate,
      'hop',
      {
        shape,
        variantGroup: group,
      },
    )
  })
}

/**
 * The item bank (≥ 40 items across rotating theme pools so ~5 minutes of play
 * never repeats a puzzle). Metadata drives every level's discrimination.
 */
export const BANK: readonly BankItem[] = [
  // ── shapes (L1 color + L2 shape material) ─────────────────────────────────
  ...variants('heart', 'heart', 'shapes', 'heart', 'shape', 'heart', [
    ['red', '❤️'],
    ['yellow', '💛'],
    ['green', '💚'],
    ['blue', '💙'],
  ]),
  ...variants('circle', 'circle', 'shapes', 'circle', 'shape', 'round', [
    ['red', '🔴'],
    ['yellow', '🟡'],
    ['green', '🟢'],
    ['blue', '🔵'],
  ]),
  ...variants('square', 'square', 'shapes', 'square', 'shape', 'square', [
    ['red', '🟥'],
    ['yellow', '🟨'],
    ['green', '🟩'],
    ['blue', '🟦'],
  ]),
  def('star', 'Star', '⭐', 'shapes', 'yellow', 'small', 'star', 'shape', 'hop', {
    shape: 'star',
  }),
  ...variants('book', 'book', 'books', 'book', 'object', undefined, [
    ['red', '📕'],
    ['green', '📗'],
    ['blue', '📘'],
    ['orange', '📙'],
  ]),
  // ── fruits ────────────────────────────────────────────────────────────────
  ...variants('apple', 'apple', 'fruits', 'fruit', 'food', 'round', [
    ['red', '🍎'],
    ['green', '🍏'],
  ]),
  def('banana', 'Banana', '🍌', 'fruits', 'yellow', 'small', 'fruit', 'food', 'hop', {
    shape: 'long',
  }),
  def('orange', 'Orange', '🍊', 'fruits', 'orange', 'small', 'fruit', 'food', 'hop', {
    shape: 'round',
  }),
  def('grapes', 'Grapes', '🍇', 'fruits', 'purple', 'small', 'fruit', 'food', 'hop'),
  def('strawberry', 'Strawberry', '🍓', 'fruits', 'red', 'small', 'fruit', 'food', 'hop'),
  def('watermelon', 'Watermelon', '🍉', 'fruits', 'green', 'big', 'fruit', 'food', 'hop'),
  def('lemon', 'Lemon', '🍋', 'fruits', 'yellow', 'small', 'fruit', 'food', 'hop', {
    shape: 'round',
  }),
  // ── animals ───────────────────────────────────────────────────────────────
  def('dog', 'Dog', '🐶', 'animals', 'brown', 'small', 'dog', 'animal', 'hop'),
  def('cat', 'Cat', '🐱', 'animals', 'orange', 'small', 'cat', 'animal', 'hop'),
  def('bear', 'Bear', '🐻', 'animals', 'brown', 'big', 'bear', 'animal', 'hop'),
  def('elephant', 'Elephant', '🐘', 'animals', 'gray', 'big', 'elephant', 'animal', 'hop'),
  def('giraffe', 'Giraffe', '🦒', 'animals', 'yellow', 'big', 'giraffe', 'animal', 'hop'),
  def('mouse', 'Mouse', '🐭', 'animals', 'gray', 'small', 'mouse', 'animal', 'hop'),
  def('frog', 'Frog', '🐸', 'animals', 'green', 'small', 'frog', 'animal', 'hop'),
  def('fish', 'Fish', '🐟', 'animals', 'blue', 'small', 'sea', 'animal', 'hop', {
    concepts: ['swims'],
  }),
  def(
    'tropical-fish',
    'Tropical fish',
    '🐠',
    'animals',
    'orange',
    'small',
    'sea',
    'animal',
    'hop',
    {
      concepts: ['swims'],
    },
  ),
  def('shark', 'Shark', '🦈', 'animals', 'gray', 'big', 'sea', 'animal', 'hop', {
    concepts: ['swims'],
  }),
  def('dolphin', 'Dolphin', '🐬', 'animals', 'blue', 'big', 'sea', 'animal', 'hop', {
    concepts: ['swims'],
  }),
  def('whale', 'Whale', '🐳', 'animals', 'blue', 'big', 'sea', 'animal', 'hop', {
    concepts: ['swims'],
  }),
  def('octopus', 'Octopus', '🐙', 'animals', 'orange', 'small', 'sea', 'animal', 'hop', {
    concepts: ['swims'],
  }),
  def('duck', 'Duck', '🦆', 'animals', 'brown', 'small', 'bird', 'animal', 'fly', {
    concepts: ['swims'],
  }),
  def('bird', 'Bird', '🐦', 'animals', 'blue', 'small', 'bird', 'animal', 'fly', {
    concepts: ['flies'],
  }),
  def('owl', 'Owl', '🦉', 'animals', 'brown', 'small', 'bird', 'animal', 'fly', {
    concepts: ['flies'],
  }),
  def('chick', 'Chick', '🐥', 'animals', 'yellow', 'small', 'bird', 'animal', 'hop'),
  def('butterfly', 'Butterfly', '🦋', 'animals', 'blue', 'small', 'bug', 'animal', 'fly', {
    concepts: ['flies'],
  }),
  def('bee', 'Bee', '🐝', 'animals', 'yellow', 'small', 'bug', 'animal', 'fly', {
    concepts: ['flies'],
  }),
  def('ladybug', 'Ladybug', '🐞', 'animals', 'red', 'small', 'bug', 'animal', 'fly', {
    concepts: ['flies'],
  }),
  // ── vehicles ──────────────────────────────────────────────────────────────
  def('car', 'Car', '🚗', 'vehicles', 'red', 'big', 'car', 'vehicle', 'drive'),
  def('taxi', 'Taxi', '🚕', 'vehicles', 'yellow', 'big', 'car', 'vehicle', 'drive'),
  def('bus', 'Bus', '🚌', 'vehicles', 'yellow', 'big', 'car', 'vehicle', 'drive'),
  def('fire-truck', 'Fire truck', '🚒', 'vehicles', 'red', 'big', 'car', 'vehicle', 'drive'),
  def('tractor', 'Tractor', '🚜', 'vehicles', 'red', 'big', 'car', 'vehicle', 'drive'),
  def('train', 'Train', '🚂', 'vehicles', 'gray', 'big', 'train', 'vehicle', 'drive'),
  def('airplane', 'Airplane', '✈️', 'vehicles', 'white', 'big', 'aircraft', 'vehicle', 'fly', {
    concepts: ['flies'],
  }),
  def('helicopter', 'Helicopter', '🚁', 'vehicles', 'red', 'big', 'aircraft', 'vehicle', 'fly', {
    concepts: ['flies'],
  }),
  def('rocket', 'Rocket', '🚀', 'vehicles', 'white', 'big', 'aircraft', 'vehicle', 'fly', {
    concepts: ['flies'],
  }),
  def('boat', 'Boat', '⛵', 'vehicles', 'white', 'big', 'boat', 'vehicle', 'drive', {
    concepts: ['swims'],
  }),
  // ── clothes ───────────────────────────────────────────────────────────────
  def('shirt', 'Shirt', '👕', 'clothes', 'blue', 'small', 'shirt', 'clothing', 'hop'),
  def('pants', 'Pants', '👖', 'clothes', 'blue', 'small', 'pants', 'clothing', 'hop'),
  def('socks', 'Socks', '🧦', 'clothes', 'red', 'small', 'socks', 'clothing', 'hop'),
  def('shoe', 'Shoe', '👟', 'clothes', 'white', 'small', 'shoe', 'clothing', 'hop'),
  def('cap', 'Cap', '🧢', 'clothes', 'blue', 'small', 'cap', 'clothing', 'hop'),
  def('mittens', 'Mittens', '🧤', 'clothes', 'green', 'small', 'mittens', 'clothing', 'hop', {
    concepts: ['cold'],
  }),
  def('scarf', 'Scarf', '🧣', 'clothes', 'red', 'small', 'scarf', 'clothing', 'hop', {
    concepts: ['cold'],
  }),
  def('dress', 'Dress', '👗', 'clothes', 'green', 'small', 'dress', 'clothing', 'hop'),
  // ── weather & nature ──────────────────────────────────────────────────────
  def('sun', 'Sun', '☀️', 'weather', 'yellow', 'big', 'sun', 'nature', 'fly', {
    concepts: ['hot'],
    shape: 'round',
  }),
  def('moon', 'Moon', '🌙', 'weather', 'yellow', 'big', 'moon', 'nature', 'fly'),
  def('cloud', 'Cloud', '☁️', 'weather', 'white', 'big', 'cloud', 'nature', 'fly'),
  def('snowman', 'Snowman', '⛄', 'weather', 'white', 'big', 'snowman', 'nature', 'hop', {
    concepts: ['cold'],
  }),
  def('snowflake', 'Snowflake', '❄️', 'weather', 'blue', 'small', 'snowflake', 'nature', 'fly', {
    concepts: ['cold'],
  }),
  def('fire', 'Fire', '🔥', 'weather', 'orange', 'small', 'fire', 'nature', 'hop', {
    concepts: ['hot'],
  }),
  def('ice-cube', 'Ice cube', '🧊', 'weather', 'blue', 'small', 'ice', 'nature', 'hop', {
    concepts: ['cold'],
  }),
  // ── more food ─────────────────────────────────────────────────────────────
  def('ice-cream', 'Ice cream', '🍦', 'food', 'white', 'small', 'ice-cream', 'food', 'hop', {
    concepts: ['cold'],
  }),
  def('hot-drink', 'Hot drink', '☕', 'food', 'brown', 'small', 'drink', 'food', 'hop', {
    concepts: ['hot'],
  }),
  def('hot-pepper', 'Hot pepper', '🌶️', 'food', 'red', 'small', 'pepper', 'food', 'hop', {
    concepts: ['hot'],
  }),
  def('pizza', 'Pizza', '🍕', 'food', 'yellow', 'small', 'pizza', 'food', 'hop', {
    concepts: ['hot'],
  }),
  def('cookie', 'Cookie', '🍪', 'food', 'brown', 'small', 'cookie', 'food', 'hop', {
    shape: 'round',
  }),
  def('carrot', 'Carrot', '🥕', 'food', 'orange', 'small', 'carrot', 'food', 'hop', {
    shape: 'long',
  }),
  // ── flowers ───────────────────────────────────────────────────────────────
  def('blossom', 'Blossom', '🌸', 'flowers', 'pink', 'small', 'flower', 'nature', 'hop'),
  def('daisy', 'Daisy', '🌼', 'flowers', 'yellow', 'small', 'flower', 'nature', 'hop'),
  def('tulip', 'Tulip', '🌷', 'flowers', 'pink', 'small', 'flower', 'nature', 'hop'),
  def('sunflower', 'Sunflower', '🌻', 'flowers', 'yellow', 'small', 'flower', 'nature', 'hop'),
  // ── toys & objects ────────────────────────────────────────────────────────
  def('soccer-ball', 'Soccer ball', '⚽', 'toys', 'white', 'small', 'ball', 'toy', 'hop', {
    shape: 'round',
  }),
  def('basketball', 'Basketball', '🏀', 'toys', 'orange', 'small', 'ball', 'toy', 'hop', {
    shape: 'round',
  }),
  def('tennis-ball', 'Tennis ball', '🎾', 'toys', 'green', 'small', 'ball', 'toy', 'hop', {
    shape: 'round',
  }),
  def('baseball', 'Baseball', '⚾', 'toys', 'white', 'small', 'ball', 'toy', 'hop', {
    shape: 'round',
  }),
  def('pencil', 'Pencil', '✏️', 'toys', 'yellow', 'small', 'pencil', 'object', 'hop', {
    shape: 'long',
  }),
]

// ─── Derived groupings (computed once, exported for the integrity tests) ─────

function groupBy(items: readonly BankItem[], key: (i: BankItem) => string | undefined) {
  const map = new Map<string, BankItem[]>()
  for (const item of items) {
    const k = key(item)
    if (k === undefined) continue
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

/** Same-thing-different-color families with ≥ 2 colors (L1 material). */
export const COLOR_GROUPS: ReadonlyMap<string, readonly BankItem[]> = (() => {
  const all = groupBy(BANK, (i) => i.variantGroup)
  const eligible = new Map<string, BankItem[]>()
  for (const [key, items] of all) {
    if (new Set(items.map((i) => i.color)).size >= 2) eligible.set(key, items)
  }
  return eligible
})()

/** Items by geometric shape (L2 material). */
export const SHAPE_GROUPS: ReadonlyMap<string, readonly BankItem[]> = groupBy(BANK, (i) => i.shape)

/** Shapes with enough members to form the matching trio. */
export const TRIO_SHAPES: readonly string[] = [...SHAPE_GROUPS.entries()]
  .filter(([, items]) => items.length >= 3)
  .map(([shape]) => shape)

/** Basic-level categories with ≥ 3 members (L3 trio material). */
export const BASIC_GROUPS: ReadonlyMap<string, readonly BankItem[]> = (() => {
  const all = groupBy(BANK, (i) => (i.superordinate === 'shape' ? undefined : i.basic))
  const eligible = new Map<string, BankItem[]>()
  for (const [key, items] of all) {
    if (items.length >= 3) eligible.set(key, items)
  }
  return eligible
})()

/** Superordinate categories rich enough to form mixed-basic trios (L4). */
export const TRIO_SUPERORDINATES: readonly Superordinate[] = [
  'animal',
  'vehicle',
  'food',
  'clothing',
]

/** Concept contrasts: trio shares the first, the odd one carries the second. */
export const CONCEPT_PAIRS: ReadonlyArray<readonly [Concept, Concept]> = [
  ['flies', 'swims'],
  ['swims', 'flies'],
  ['hot', 'cold'],
  ['cold', 'hot'],
]

// ─── Puzzle generation ────────────────────────────────────────────────────────

export type Level = 1 | 2 | 3 | 4 | 5
export type Dimension = 'color' | 'shape' | 'size' | 'basic' | 'superordinate' | 'concept'

export const PUZZLE_SIZE = 4
export const TRIO_SIZE = 3
/** How many recent puzzle signatures are banned from reappearing. */
export const SIGNATURE_WINDOW = 8
const GENERATION_ATTEMPTS = 40

export interface Puzzle {
  level: Level
  dimension: Dimension
  /** The value the matching trio shares on the dimension (e.g. 'red', 'sea'). */
  attribute: string
  /** Exactly 4 cards in display order (the odd one included). */
  items: BankItem[]
  oddIndex: number
  /** Rotation key — consecutive rounds avoid reusing it (theme variety). */
  groupKey: string
  /** Content identity — recent signatures never repeat within the window. */
  signature: string
}

function pickIndex(rng: Rng, length: number): number {
  return Math.min(length - 1, Math.floor(rng() * length))
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[pickIndex(rng, items.length)]
}

function pickDistinct<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items]
  const out: T[] = []
  for (let i = 0; i < count; i++) {
    out.push(pool.splice(pickIndex(rng, pool.length), 1)[0])
  }
  return out
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = pickIndex(rng, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function puzzleSignature(items: readonly BankItem[], odd: BankItem): string {
  const ids = items
    .map((i) => i.id)
    .sort()
    .join(',')
  return `${ids}>${odd.id}`
}

/** L2 alternates shape and size rounds; other levels have one dimension. */
export function dimensionForLevel(level: Level, rng: Rng): Dimension {
  if (level === 1) return 'color'
  if (level === 2) return rng() < 0.5 ? 'shape' : 'size'
  if (level === 3) return 'basic'
  if (level === 4) return 'superordinate'
  return 'concept'
}

interface Candidate {
  trio: BankItem[]
  odd: BankItem
  attribute: string
  groupKey: string
}

/** L1: three identical items + the same thing in another color (🍎🍎🍎 + 🍏). */
function buildColor(rng: Rng): Candidate {
  const groups = [...COLOR_GROUPS.values()]
  const group = pick(rng, groups)
  const colors = [...new Set(group.map((i) => i.color))]
  const [trioColor, oddColor] = pickDistinct(rng, colors, 2)
  const base = pick(
    rng,
    group.filter((i) => i.color === trioColor),
  )
  const odd = pick(
    rng,
    group.filter((i) => i.color === oddColor),
  )
  return {
    trio: [base, base, base],
    odd,
    attribute: trioColor,
    groupKey: `color:${base.variantGroup}`,
  }
}

/** L2a: three items of one silhouette + one different silhouette. */
function buildShape(rng: Rng): Candidate {
  const shape = pick(rng, TRIO_SHAPES)
  const trio = pickDistinct(rng, SHAPE_GROUPS.get(shape) ?? [], TRIO_SIZE)
  const odd = pick(
    rng,
    BANK.filter((i) => i.shape !== undefined && i.shape !== shape),
  )
  return { trio, odd, attribute: shape, groupKey: `shape:${shape}` }
}

/** L2b: three big animals + one tiny (or the reverse); rendered to scale. */
function buildSize(rng: Rng): Candidate {
  const animals = BANK.filter((i) => i.theme === 'animals')
  const size: SizeClass = rng() < 0.5 ? 'big' : 'small'
  const trio = pickDistinct(
    rng,
    animals.filter((i) => i.size === size),
    TRIO_SIZE,
  )
  const odd = pick(
    rng,
    animals.filter((i) => i.size !== size),
  )
  return { trio, odd, attribute: size, groupKey: `size:${size}` }
}

/** L3: three of a basic kind (3 fish) + a cross-superordinate odd (1 tractor). */
function buildBasic(rng: Rng): Candidate {
  const basic = pick(rng, [...BASIC_GROUPS.keys()])
  const group = BASIC_GROUPS.get(basic) ?? []
  const trio = pickDistinct(rng, group, TRIO_SIZE)
  const odd = pick(
    rng,
    BANK.filter(
      (i) =>
        i.basic !== basic &&
        i.superordinate !== trio[0].superordinate &&
        i.superordinate !== 'shape',
    ),
  )
  return { trio, odd, attribute: basic, groupKey: `basic:${basic}` }
}

/** L4: three different animals (dog + fish + bird) + one vehicle — stretch. */
function buildSuperordinate(rng: Rng): Candidate {
  const superordinate = pick(rng, TRIO_SUPERORDINATES)
  const group = BANK.filter((i) => i.superordinate === superordinate)
  let trio = pickDistinct(rng, group, TRIO_SIZE)
  if (new Set(trio.map((i) => i.basic)).size < 2) {
    // A same-basic trio would read as a basic-level puzzle — swap one member.
    const other = group.filter((i) => i.basic !== trio[0].basic && i !== trio[1])
    trio = [trio[0], trio[1], pick(rng, other)]
  }
  const odd = pick(
    rng,
    BANK.filter((i) => i.superordinate !== superordinate && i.superordinate !== 'shape'),
  )
  return { trio, odd, attribute: superordinate, groupKey: `super:${superordinate}` }
}

/** L5: three fliers + one swimmer (or hot vs cold) — concept stretch. */
function buildConcept(rng: Rng): Candidate {
  const [shared, opposite] = pick(rng, CONCEPT_PAIRS)
  const trio = pickDistinct(
    rng,
    BANK.filter((i) => i.concepts.includes(shared)),
    TRIO_SIZE,
  )
  const odd = pick(
    rng,
    BANK.filter((i) => i.concepts.includes(opposite) && !i.concepts.includes(shared)),
  )
  return { trio, odd, attribute: shared, groupKey: `concept:${shared}` }
}

const BUILDERS: Record<Dimension, (rng: Rng) => Candidate> = {
  color: buildColor,
  shape: buildShape,
  size: buildSize,
  basic: buildBasic,
  superordinate: buildSuperordinate,
  concept: buildConcept,
}

function buildPuzzle(level: Level, rng: Rng): Puzzle {
  const dimension = dimensionForLevel(level, rng)
  const candidate = BUILDERS[dimension](rng)
  const items = shuffle(rng, [...candidate.trio, candidate.odd])
  return {
    level,
    dimension,
    attribute: candidate.attribute,
    items,
    oddIndex: items.indexOf(candidate.odd),
    groupKey: candidate.groupKey,
    signature: puzzleSignature(items, candidate.odd),
  }
}

export interface PuzzleHistory {
  /** Signatures that must not reappear (session no-repeat window). */
  recentSignatures?: readonly string[]
  /** Previous round's groupKey — themes rotate between rounds. */
  lastGroupKey?: string | null
}

/**
 * Generate a puzzle for the level: 4 items, exactly one odd. Retries until it
 * finds one whose signature is outside the recent window AND whose theme group
 * differs from the previous round; degrades gracefully (fresh-but-same-group,
 * then anything) so it always returns a valid puzzle.
 */
export function generatePuzzle(level: Level, rng: Rng, history: PuzzleHistory = {}): Puzzle {
  const recent = history.recentSignatures ?? []
  const lastGroupKey = history.lastGroupKey ?? null
  let candidate = buildPuzzle(level, rng)
  let fresh: Puzzle | null = null
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt++) {
    if (!recent.includes(candidate.signature)) {
      if (candidate.groupKey !== lastGroupKey) return candidate
      fresh ??= candidate
    }
    candidate = buildPuzzle(level, rng)
  }
  return fresh ?? candidate
}

// ─── Session state machine ────────────────────────────────────────────────────

export const MIN_LEVEL: Level = 1
export const MAX_LEVEL: Level = 5
/** Solves at a level before moving up… */
export const CORRECT_TO_ADVANCE = 3
/** …or sooner when the child is cruising (consecutive no-miss rounds). */
export const FLAWLESS_TO_ADVANCE = 2
/** Below the session peak (warm-up), the climb is quicker on both counts. */
export const WARMUP_CORRECT_TO_ADVANCE = 2
export const WARMUP_FLAWLESS_TO_ADVANCE = 1
/** Misses within a single round that trigger a gentle drop (BETWEEN rounds). */
export const MISSES_TO_DROP = 2

/** Every this many solved rounds: the sparkle-wave celebration (animation). */
export const CELEBRATION_EVERY_SOLVES = 5

/** The celebration fires exactly when a solve total crosses the beat. */
export function isCelebrationSolve(roundsCompleted: number): boolean {
  return roundsCompleted > 0 && roundsCompleted % CELEBRATION_EVERY_SOLVES === 0
}

export interface SessionState {
  level: Level
  /** Best level seen (seeded from the save) — below it the climb is faster. */
  peakLevel: Level
  /** Rounds solved at the current level (with fewer than MISSES_TO_DROP misses). */
  correctAtLevel: number
  /** Consecutive no-miss rounds at the current level (fast-track). */
  flawlessStreak: number
  /** Wrong taps in the round being played right now. */
  missesThisRound: number
  roundsCompleted: number
  recentSignatures: string[]
  lastGroupKey: string | null
}

export function initialSessionState(
  startLevel: Level = MIN_LEVEL,
  peakLevel: Level = startLevel,
): SessionState {
  const level = clampLevel(startLevel)
  return {
    level,
    peakLevel: clampLevel(Math.max(level, peakLevel)),
    correctAtLevel: 0,
    flawlessStreak: 0,
    missesThisRound: 0,
    roundsCompleted: 0,
    recentSignatures: [],
    lastGroupKey: null,
  }
}

export function clampLevel(level: number): Level {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level))) as Level
}

/** Wrong tap: only counts — the round (and its rule) continues unchanged. */
export function registerMiss(state: SessionState): SessionState {
  return { ...state, missesThisRound: state.missesThisRound + 1 }
}

/** From the very first miss in a round the matching trio pulse-glows softly. */
export function showHint(state: SessionState): boolean {
  return state.missesThisRound >= 1
}

/**
 * Odd one found — the only moment level can change (rules switch strictly
 * BETWEEN rounds): a rough round (2+ misses) drops one level, three solves
 * (or two flawless in a row) climb one. Never below L1, never above L5.
 * While the level sits below the session peak (a warm-up after a persisted
 * session start), the climb needs one solve fewer on both counts.
 */
export function registerSolve(state: SessionState, puzzle: Puzzle): SessionState {
  const base = {
    peakLevel: state.peakLevel,
    recentSignatures: [...state.recentSignatures, puzzle.signature].slice(-SIGNATURE_WINDOW),
    lastGroupKey: puzzle.groupKey,
    roundsCompleted: state.roundsCompleted + 1,
    missesThisRound: 0,
  }
  if (state.missesThisRound >= MISSES_TO_DROP) {
    return { ...base, level: clampLevel(state.level - 1), correctAtLevel: 0, flawlessStreak: 0 }
  }
  const warmingUp = state.level < state.peakLevel
  const needCorrect = warmingUp ? WARMUP_CORRECT_TO_ADVANCE : CORRECT_TO_ADVANCE
  const needFlawless = warmingUp ? WARMUP_FLAWLESS_TO_ADVANCE : FLAWLESS_TO_ADVANCE
  const correctAtLevel = state.correctAtLevel + 1
  const flawlessStreak = state.missesThisRound === 0 ? state.flawlessStreak + 1 : 0
  if (correctAtLevel >= needCorrect || flawlessStreak >= needFlawless) {
    const level = clampLevel(state.level + 1)
    return {
      ...base,
      level,
      peakLevel: clampLevel(Math.max(state.peakLevel, level)),
      correctAtLevel: 0,
      flawlessStreak: 0,
    }
  }
  return { ...base, level: state.level, correctAtLevel, flawlessStreak }
}

/** The next round's puzzle, honouring the no-repeat window + theme rotation. */
export function nextPuzzle(state: SessionState, rng: Rng): Puzzle {
  return generatePuzzle(state.level, rng, {
    recentSignatures: state.recentSignatures,
    lastGroupKey: state.lastGroupKey,
  })
}
