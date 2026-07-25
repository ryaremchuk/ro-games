/**
 * The single source of truth for a game's visible "level".
 *
 * ONE formula, ONE store, read by BOTH surfaces — the in-game badge (GameFrame)
 * and the launcher tile (HomePage) — so the number can never disagree:
 *
 *     level(gameId) = stars(gameId) + 1
 *
 * Every game banks exactly one reward star per level passed (shared/progress.ts
 * — addStars on each celebration beat), so `stars` is "levels completed" and
 * the level is the one the child is CURRENTLY on: a fresh game is level 1, and
 * the number climbs by one the instant a level is passed. It is derived live
 * from the observable star store (subscribeProgress), so both surfaces update
 * together with no per-game reporting — a game just plays and banks stars.
 *
 * Pure module state + subscribers — no DOM, no React — so it is unit-testable
 * and callable from React components and Phaser scenes alike.
 */

import { getStars, subscribeProgress } from './progress'

/**
 * The level a game is currently on: levels completed (banked stars) + 1. Fresh
 * game → 1. This is the ONLY definition of "level"; every surface reads it.
 */
export function levelFor(gameId: string): number {
  return getStars(gameId) + 1
}

/**
 * Badge suppression for special non-play modes (e.g. slingshot's authoring
 * editor). Global, reset to visible whenever a game mounts (see GameFrame), so
 * one game leaving it hidden can never leak the badge state into the next.
 */
let hidden = false
const hiddenListeners = new Set<() => void>()

/** Hide/show the badge for the current game. Emits only on an actual change. */
export function setLevelHidden(value: boolean): void {
  if (value === hidden) return
  hidden = value
  for (const listener of hiddenListeners) listener()
}

/**
 * The number to render on the badge for a game, or null when the badge should
 * be hidden (suppressed mode). Both inputs — the star count and the hidden flag
 * — are covered by subscribeLevel below.
 */
export function visibleLevel(gameId: string): number | null {
  return hidden ? null : levelFor(gameId)
}

/**
 * Subscribe to everything the badge depends on for a game: its star count and
 * the hidden flag. Returns the unsubscribe function. Shaped for
 * useSyncExternalStore (the callback takes no args; the consumer re-reads
 * visibleLevel()).
 */
export function subscribeLevel(gameId: string, listener: () => void): () => void {
  const unsubscribeProgress = subscribeProgress(gameId, listener)
  hiddenListeners.add(listener)
  return () => {
    unsubscribeProgress()
    hiddenListeners.delete(listener)
  }
}
