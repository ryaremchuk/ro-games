import { BIRDS } from './logic'
import type { BirdKind } from './logic'

/**
 * The player's currently active bird — the one that flies in every normal-play
 * launch. Persisted so the promotion survives reloads and PWA relaunches. The
 * game starts on `green`; a reward (Feature 2) calls `setActiveBird` to promote
 * the child to a heavier / bouncier bird.
 *
 * Not a per-level concept: the level generator emits `['green']` and the scene
 * substitutes the active bird at load time (the editor is the only place the
 * authored `LevelSpec.birds` queue still matters).
 */

const ACTIVE_BIRD_KEY = 'ro-games:slingshot-bird'
const DEFAULT_BIRD: BirdKind = 'green'

/** True for exactly the five known bird kinds (rejects junk from storage). */
function isBirdKind(value: unknown): value is BirdKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BIRDS, value)
}

/** The active bird, defaulting to green if unset, invalid, or storage is blocked. */
export function getActiveBird(): BirdKind {
  try {
    const raw = localStorage.getItem(ACTIVE_BIRD_KEY)
    if (isBirdKind(raw)) return raw
  } catch {
    // Private mode / storage disabled — fall through to the default.
  }
  return DEFAULT_BIRD
}

/** Persist the active bird (best-effort; a blocked write just isn't saved). */
export function setActiveBird(kind: BirdKind): void {
  try {
    localStorage.setItem(ACTIVE_BIRD_KEY, kind)
  } catch {
    // Private mode / quota — the promotion just doesn't persist across reloads.
  }
}
