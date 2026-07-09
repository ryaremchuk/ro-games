/**
 * Shared game-level store. Every game reports its current 1-based level here;
 * GameFrame renders the standardized level badge next to the home button.
 *
 * Games own their level RULES (what counts as leveling up lives in each
 * game's logic.ts); this module only carries the current value to the badge.
 * Pure module state + subscribers — no DOM, no React — so it is unit-testable
 * and callable from React components and Phaser scenes alike.
 */

export type LevelListener = (level: number | null) => void

let currentLevel: number | null = null
const listeners = new Set<LevelListener>()

function emit(): void {
  for (const listener of listeners) listener(currentLevel)
}

/** Current level, or null when no game has reported one (badge hidden). */
export function getLevel(): number | null {
  return currentLevel
}

/** Report the game's current level (1-based). No-op if unchanged. */
export function reportLevel(level: number): void {
  const next = Math.max(1, Math.floor(level))
  if (next === currentLevel) return
  currentLevel = next
  emit()
}

/** Hide the badge — called when a game unmounts. */
export function clearLevel(): void {
  if (currentLevel === null) return
  currentLevel = null
  emit()
}

/** Subscribe to level changes; returns the unsubscribe function. */
export function subscribeLevel(listener: LevelListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
