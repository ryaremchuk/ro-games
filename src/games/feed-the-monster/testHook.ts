/**
 * E2E test hook for the Feed the Monster scene.
 *
 * Phaser draws to an opaque canvas, so Playwright cannot see foods or the
 * monster in the DOM. The scene installs `window.__feedTheMonster` (dev
 * builds, or prod behind a `?e2e` query — never in normal play) so a spec can
 * read deterministic state, find real-pointer drag coordinates, and force a
 * specific task kind instead of grinding the adaptive meter until it unlocks.
 * Mirrors whack's testHook.
 */

import type { TaskKind } from './logic'

export interface FeedTrayFood {
  foodId: string
  /** Would the monster accept this food right now? (wantsFood) */
  correct: boolean
  /** Tray position in css px (backing px ÷ dpr), for real-pointer drags. */
  xCss: number
  yCss: number
}

export interface FeedTestState {
  /** 1-based current round. */
  round: number
  /** Registry row this round plays (single/count/color/combo/dots/mix/not/pattern). */
  taskKind: TaskKind | null
  /** Adaptive cognitive meter 0..12. */
  skill: number
  /** Correct feeds so far this round. */
  eaten: string[]
  /** Foods the request wants in total. */
  requestTotal: number
  /** Wrong feeds the monster spat back this round. */
  spitBacks: number
  /** True during the between-rounds celebration. */
  transitioning: boolean
  /** Draggable tray foods with css coords. */
  foods: FeedTrayFood[]
  /** Mouth drop-target center in css px. */
  mouth: { xCss: number; yCss: number }
  /** How many picture tiles the thought bubble shows. */
  bubbleTiles: number
}

export interface FeedTestApi {
  /** Snapshot of the scene's play state. */
  state: () => FeedTestState
  /**
   * Rebuild the current round with a forced task kind, bypassing the meter
   * and rotation — so a spec can exercise `pattern` without earning skill 6.
   * Returns false while a round transition is in flight.
   */
  forceKind: (kind: TaskKind) => boolean
}

declare global {
  interface Window {
    /** Dev/e2e-only handle to the Feed the Monster scene. */
    __feedTheMonster?: FeedTestApi
  }
}
