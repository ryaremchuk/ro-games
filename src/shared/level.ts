/**
 * Shared game-level store. Every game reports its current SESSION level here
 * (1-based, resets each visit); GameFrame renders the standardized level badge
 * (the ⭐ next to the home button).
 *
 * Games own their level RULES (what counts as leveling up lives in each game's
 * logic.ts); this module only carries the current value to the badge — and
 * adds the persisted baseline so the number the child sees survives restarts.
 *
 * PERSISTENCE. Every level a child passes banks exactly one reward star (see
 * each game's logic.ts + shared/progress.ts), so the total stars ever earned
 * equals the levels passed in prior sessions. A game calls initLevel(gameId)
 * at startup to load that total as the baseline; the badge then shows
 * `baseline + sessionLevel`, i.e. the count keeps climbing across sessions
 * instead of restarting at 1. The baseline is a snapshot taken at startup, so
 * stars banked mid-session grow the trophy without double-counting the badge.
 *
 * Pure module state + subscribers — no DOM, no React — so it is unit-testable
 * and callable from React components and Phaser scenes alike.
 */

import { getStars } from './progress'

export type LevelListener = (level: number | null) => void

let currentLevel: number | null = null
/**
 * Levels passed in PRIOR sessions, snapshotted from the persistent star
 * trophy at startup (initLevel). 0 until a game calls initLevel().
 */
let baseline = 0
const listeners = new Set<LevelListener>()

function emit(): void {
  for (const listener of listeners) listener(currentLevel)
}

/** Current level (baseline + session level), or null when no game reported one. */
export function getLevel(): number | null {
  return currentLevel
}

/**
 * Seed the badge from a game's saved progress so a returning child continues
 * their level count instead of restarting at 1. Call once at game startup,
 * BEFORE the first reportLevel(). The baseline is snapshotted here (not read
 * live), so stars banked later this session grow the trophy without inflating
 * the badge twice.
 */
export function initLevel(gameId: string): void {
  baseline = getStars(gameId)
}

/** Report the game's current SESSION level (1-based). No-op if unchanged. */
export function reportLevel(level: number): void {
  const next = baseline + Math.max(1, Math.floor(level))
  if (next === currentLevel) return
  currentLevel = next
  emit()
}

/** Hide the badge and drop the baseline — called when a game unmounts. */
export function clearLevel(): void {
  baseline = 0
  if (currentLevel === null) return
  currentLevel = null
  emit()
}

/** Subscribe to level changes; returns the unsubscribe function. */
export function subscribeLevel(listener: LevelListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
