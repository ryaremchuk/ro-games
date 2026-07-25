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
import type { JourneyState } from './journey'

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
  /** The visible long-term journey (episode / friends fed / growth step). */
  journey: JourneyState
  /** Active episode theme id (drives the food pool + palette). */
  episodeId: string
  /** Current monster container scale (visible growth). */
  growthScale: number
  /** Growth-aura intensity 0..1 (how "grown up" the friend glows). */
  aura: number
  /** Fed friends standing in the lineup. */
  miniCount: number
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
  /**
   * Jump the journey to a given point (persisted, visuals rebuilt, round
   * regenerated from the episode's pool) — so a spec can reach the
   * friend-grown / dance-party moments without feeding 6/30 rounds.
   * Returns false while a round transition is in flight.
   */
  forceJourney: (journey: Partial<JourneyState>) => boolean
  /**
   * Toggle the random "big bite" sprinkle (a fed round occasionally growing two
   * steps instead of one). Off makes growth deterministic (+1, unless the child
   * is stuck) so a spec can assert an exact growthStep after a feed. The
   * adaptive stuck-catch-up is unaffected — only the dice are silenced.
   */
  setRandomBigBite: (enabled: boolean) => void

  // ─── `?dev` cheat overlay (FeedDevPanel) ─────────────────────────────────
  // Incremental nudges for manual testing; each rebuilds the world + round
  // and no-ops while a transition is in flight.
  /** Grow/shrink the current friend by delta steps (clamped 0..GROW_STEPS-1). */
  devHeroLevel: (delta: number) => void
  /** Add/remove grown friends by delta (clamped 0..FRIENDS_PER_EPISODE-1). */
  devFriends: (delta: number) => void
  /** Step the episode by delta (never below 0; themes wrap). */
  devEpisode: (delta: number) => void
  /** Re-deal the current round as a fresh task, leaving the journey untouched. */
  devRegenerate: () => void
}

declare global {
  interface Window {
    /** Dev/e2e-only handle to the Feed the Monster scene. */
    __feedTheMonster?: FeedTestApi
  }
}
