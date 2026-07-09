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
  /** Bird body position in backing px (null once the body is destroyed). */
  birdX: number | null
  birdY: number | null
  /**
   * True if Matter has put the bird's body to sleep. A launched bird must
   * never be asleep — sleeping bodies are skipped by gravity and integration,
   * so a slept "launch" freezes mid-air (the regression this flag guards).
   */
  birdAsleep: boolean | null
  piggiesTotal: number
  piggiesFreed: number
  consecutiveMisses: number
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
}

declare global {
  interface Window {
    __slingshot?: SlingshotTestApi
    /** Dev/e2e-only handle to the hidden level editor (`#/slingshot?edit`). */
    __slingshotEditor?: EditorApi
  }
}
