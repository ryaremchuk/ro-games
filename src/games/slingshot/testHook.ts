import type { BirdKind } from './logic'
import type { EditorApi } from './editor/bridge'

/**
 * E2E test hook for the Slingshot scene.
 *
 * Phaser draws to an opaque canvas, so Playwright cannot see sprites in the DOM.
 * The scene installs `window.__slingshot` (dev-only, tree-shaken from production)
 * so an e2e test can read deterministic state and drive the real physics path
 * instead of guessing pixels. See `SlingshotScene.exposeTestApi`.
 */

export interface SlingshotTestState {
  level: number
  canAim: boolean
  aiming: boolean
  levelClearing: boolean
  birdState: 'loaded' | 'flying' | 'spent' | null
  birdKind: BirdKind | null
  /** The player's persisted active bird (green until a reward promotes it). */
  activeBirdKind: BirdKind
  /** Bird body position in backing px (null once the body is destroyed). */
  birdX: number | null
  birdY: number | null
  /**
   * True if Matter has put the bird's body to sleep. A launched bird must
   * never be asleep — sleeping bodies are skipped by gravity and integration,
   * so a slept "launch" freezes mid-air (the regression this flag guards).
   */
  birdAsleep: boolean | null
  /** Fired birds resting on the field (they persist until the level ends). */
  spentBirds: number
  piggiesTotal: number
  piggiesFreed: number
  consecutiveMisses: number
  /** True while the victory-star reward overlay is up (Feature 2). */
  starDropActive: boolean
  /** The tier (bird kind) the star currently shows, or null when no drop. */
  starDropTier: BirdKind | null
  /** Taps left including the closing 'open' (null when no drop is active). */
  starDropTapsRemaining: number | null
}

export interface SlingshotTestApi {
  /** Snapshot of the scene's play state. */
  state: () => SlingshotTestState
  /**
   * Simulate an aim-drag of (dxN, dyN) field-units from the fork, then release —
   * runs the exact aim/release code path the real pointer would. The bird
   * launches opposite the drag, so drag down-left (dxN<0, dyN>0) to fling it
   * up-right at the towers. Returns false if the bird can't be launched now.
   */
  flick: (dxN: number, dyN: number) => boolean
  /** Flap a bird that is mid-flight (no-op otherwise). */
  flap: () => void
  /**
   * Pin the reward of the NEXT star drop to `kind`, bypassing the weighted roll.
   * Call before clearing the level that triggers the drop (every 3rd level) so
   * the e2e outcome is deterministic.
   */
  forceStarDrop: (kind: BirdKind) => void
  /**
   * Jump straight to `level`, skipping the slow physics playthrough of the
   * levels before it — so a spec can reach a star-drop level (multiple of 3)
   * quickly. Dev/e2e only; no-op in the editor.
   */
  skipToLevel: (level: number) => void
}

declare global {
  interface Window {
    __slingshot?: SlingshotTestApi
    /** Dev/e2e-only handle to the hidden level editor (`#/slingshot?edit`). */
    __slingshotEditor?: EditorApi
  }
}
