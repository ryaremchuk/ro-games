/**
 * Pure board logic for the Memory (card-matching) game. No Phaser imports —
 * everything here is deterministic given an injected RNG and unit-tested in
 * plain jsdom (see logic.test.ts).
 *
 * The level → card-count table is a fixed user requirement; every deal picks
 * fresh random subjects, duplicates each into a pair, and shuffles positions.
 */

/** Injectable random source, [0, 1). Defaults to Math.random in the game. */
export type Rng = () => number

/** One placed card: which subject it shows and which pair it belongs to. */
export interface BoardCard {
  subjectKey: string
  /** 0-based index of the pair on this board (both cards of a pair share it). */
  pairId: number
}

/**
 * Cards on the board for a 1-based level. Fixed table (a user requirement):
 * L1–2 → 4, L3–4 → 6, L5–6 → 8, L7+ → 10. Defensive: level < 1 → 4.
 */
export function cardsForLevel(level: number): number {
  if (!Number.isFinite(level) || level < 1) return 4
  if (level <= 2) return 4
  if (level <= 4) return 6
  if (level <= 6) return 8
  return 10
}

/** In-place Fisher–Yates shuffle driven by the injected RNG. Returns `arr`. */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/**
 * Deal a board of `cardCount` cards: pick `cardCount / 2` distinct subjects
 * from `subjectKeys`, duplicate each into a pair, then shuffle positions.
 * Throws if there are not enough distinct subjects to fill the board.
 */
export function dealBoard(
  cardCount: number,
  subjectKeys: readonly string[],
  rng: Rng,
): BoardCard[] {
  const pairCount = Math.floor(cardCount / 2)
  if (subjectKeys.length < pairCount) {
    throw new Error(`Need ${pairCount} distinct subjects, got ${subjectKeys.length}`)
  }
  const chosen = shuffle([...subjectKeys], rng).slice(0, pairCount)
  const cards: BoardCard[] = []
  chosen.forEach((subjectKey, pairId) => {
    cards.push({ subjectKey, pairId })
    cards.push({ subjectKey, pairId })
  })
  return shuffle(cards, rng)
}

/** Two cards match when they show the same subject. */
export function isMatch(a: BoardCard, b: BoardCard): boolean {
  return a.subjectKey === b.subjectKey
}

/**
 * Row lengths for a board of `cardCount` cards, per orientation:
 *   4  → 2×2
 *   6  → 3×3 landscape / 2×2×2 portrait
 *   8  → 4×4 landscape / 3-2-3 centered rows portrait
 *   10 → 5×5 landscape / 3-4-3 portrait
 * The returned array always sums to `cardCount`.
 */
export function rowsFor(cardCount: number, portrait: boolean): number[] {
  switch (cardCount) {
    case 4:
      return [2, 2]
    case 6:
      return portrait ? [2, 2, 2] : [3, 3]
    case 8:
      return portrait ? [3, 2, 3] : [4, 4]
    case 10:
      return portrait ? [3, 4, 3] : [5, 5]
    default:
      return [2, 2]
  }
}
