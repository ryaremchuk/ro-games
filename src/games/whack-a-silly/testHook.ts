/**
 * E2E test hook for the Whack-a-Silly scene.
 *
 * Phaser draws to an opaque canvas, so Playwright cannot see critters in the
 * DOM. The scene installs `window.__whackASilly` (dev/e2e only, tree-shaken
 * from production) so a spec can read deterministic state and force a specific
 * spawn — instead of waiting ~45s for phase 2 so a sleeper appears, or guessing
 * pixels. See `WhackASillyScene.exposeTestApi`. Mirrors slingshot's testHook.
 */

export interface WhackHoleState {
  state: 'down' | 'waking' | 'rising' | 'up' | 'leaving'
  /** True once the critter rig is visible — never true while the hole is down. */
  critterVisible: boolean
  /** True if the current critter is a sleeper (the no-go stimulus). */
  sleepy: boolean
  /** Species id of the current critter (simultaneous ones are never twins). */
  critterId: string | null
  /** Hole opening center in css px (backing px ÷ dpr), for real-pointer taps. */
  xCss: number
  yCss: number
}

export interface WhackTestState {
  /** Successful go-critter bops (the score that drives the level). */
  bops: number
  /** 1-based HUD level = levelForBops(bops). */
  level: number
  /** Sleepers left to nap in peace (the go/no-go win). */
  spared: number
  /** Adaptive motor meter 0..12 (speed + concurrency). */
  skill: number
  /** How many holes are currently occupied (waking / rising / up / leaving). */
  activeCritters: number
  holes: WhackHoleState[]
}

export interface WhackTestApi {
  /** Snapshot of the scene's play state. */
  state: () => WhackTestState
  /**
   * Force a critter to pop in `hole` right now with the given flags, bypassing
   * the phase gate and the random scheduler — so a spec need not wait ~45s for
   * a sleeper. Returns false if the hole is not currently free (down).
   */
  forceSpawn: (hole: number, opts?: { sleepy?: boolean; golden?: boolean }) => boolean
}

declare global {
  interface Window {
    /** Dev/e2e-only handle to the Whack-a-Silly scene. */
    __whackASilly?: WhackTestApi
  }
}
