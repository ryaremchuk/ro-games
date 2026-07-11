/**
 * E2E test hook for the Memory scene.
 *
 * Phaser draws to an opaque canvas, so Playwright cannot see cards in the DOM.
 * The scene installs `window.__memory` (dev/e2e only, tree-shaken from
 * production) so a spec can read deterministic state — which subjects are where,
 * whether the board is busy/dealing/celebrating — and drive real pointer taps at
 * each card's css-px center. Mirrors whack-a-silly's testHook.
 */

export interface MemoryCardState {
  /** Logically face-up (set the instant it is tapped, before the flip lands). */
  faceUp: boolean
  /** Matched pair — stays up, receded, non-interactive. */
  matched: boolean
  /** Stable subject id; exposed even while face-down so a spec can find pairs. */
  subjectKey: string
  /** Card center in css px (backing px ÷ dpr), for real-pointer taps. */
  xCss: number
  yCss: number
  /** Card side length in css px. */
  sizeCss: number
}

export interface MemoryTestState {
  /** 1-based level (drives the shared badge). */
  level: number
  /** Cards currently on the board (4, 6, 8, or 10). */
  cardCount: number
  /** Pairs matched so far in the current level. */
  matchesInLevel: number
  /** Input locked while a mismatch pair resolves. */
  busy: boolean
  /** Level-complete celebration is playing (board non-interactive). */
  celebrating: boolean
  /** Deal-in animation is playing (board non-interactive). */
  dealing: boolean
  cards: MemoryCardState[]
}

export interface MemoryTestApi {
  /** Snapshot of the scene's play state. */
  state: () => MemoryTestState
}

declare global {
  interface Window {
    /** Dev/e2e-only handle to the Memory scene. */
    __memory?: MemoryTestApi
  }
}
