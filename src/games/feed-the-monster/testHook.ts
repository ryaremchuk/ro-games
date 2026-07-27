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
  /**
   * Is the round being played a "big bite" (+2 growth)? Decided at round start
   * and announced to the child (lip smack, glowing tray, bigger food), or
   * upgraded mid-round once the child has struggled enough on this friend.
   */
  bigBite: boolean
  /**
   * Scale multiplier on every tray food: 1 normally, journey.BIG_BITE_FOOD_BOOST
   * while a big-bite round is dressed. Asserts the INDICATION is really up, not
   * just the flag (the glow + lip smack are canvas-only, this one is readable).
   */
  foodBoost: number
  /** True while a two-friend duo bonus round is on stage. */
  duoActive: boolean
  /** Per-friend duo state while a duo is live (else null) — lets a spec feed
   * each mouth the food it wants. */
  duo: DuoState | null
  /**
   * The live commission while the pixel pad is open over the scene (else null):
   * which colour was asked, and whether the ask NAMES the colour (it does not
   * below the colour-round unlock, where it is simply "draw anything").
   */
  commission: { color: string; askColor: boolean } | null
  /** Food ids of the child's drawings currently in the rotation (max 6). */
  drawnFoodIds: string[]
  /** True while this round's food rides the conveyor belt instead of the tray. */
  conveyorActive: boolean
  /** Live belt state while a conveyor round is on stage (else null). */
  conveyor: ConveyorState | null
  /** The belt's own adaptive meter, 0..BELT_SKILL_MAX. */
  beltSkill: number
  /** Live kitchen state while a `dish` round is on stage (else null). */
  kitchen: KitchenState | null
  /** The visitor on stage right now (else null). */
  visitor: VisitorState | null
  /** The thief axis's own adaptive meter, 0..THIEF_SKILL_MAX. */
  thiefSkill: number
}

/** The thief (or the no-go butterfly), mid-visit. */
export interface VisitorState {
  kind: 'thief' | 'butterfly'
  /** telegraph → approach → peck → leaving. */
  phase: 'telegraph' | 'approach' | 'peck' | 'leaving'
  /** Tray slot it is after. */
  slot: number
  /** The food on that plate. */
  foodId: string
  /** ms left in the peck window (0 outside it). */
  msLeft: number
  /** Where to tap, in css px — live, so it tracks the bird through the glide. */
  xCss: number
  yCss: number
  /**
   * Radius of the tap circle around (xCss, yCss), in css px. Carried from the
   * visitor's first frame on screen: a tap lands whether it is flying or perched.
   */
  tapRadiusCss: number
}

/** The pot, mid-cook. */
export interface KitchenState {
  recipeId: string
  /** The food the pot will produce — the ONE thing this round feeds. */
  result: string
  /** Do the parts have to go in left-to-right? */
  ordered: boolean
  /** The recipe's parts, in order. */
  ingredients: string[]
  /** What is in the pot already, in the order it went in. */
  contents: string[]
  /** What the pot will accept right now (one entry in an ordered round). */
  wants: string[]
  /** The cooked dish sitting on the pot, once every part is in (else null). */
  madeDish: string | null
  /** Pot centre in css px, for real-pointer drags. */
  potCss: { x: number; y: number }
  /** The pot's drop radius in css px. */
  snapCss: number
}

/**
 * One PLATE on the belt — every lane, in lane order, whether it carries a dish or
 * not. Empty plates are first-class: they keep riding after their dish is eaten or
 * lifted, so a spec can assert the plate survived the feed.
 */
export interface ConveyorLaneState {
  /** The dish on this plate, or null when the plate is riding empty. */
  foodId: string | null
  /** Would feeding this dish be correct right now? (logic.wantsFood) */
  wanted: boolean
  /** Is the plate past the hatch and on screen? */
  visible: boolean
  /** ms until the child could actually take it (0 = right now). */
  msUntilReachable: number
  /** Plate centre in css px, for real-pointer drags. */
  xCss: number
  yCss: number
}

export interface ConveyorState {
  /** How fast a dish travels, css px per second (the belt-skill speed dial). */
  dishSpeedCss: number
  /** ms for one dish to cross the visible belt — derived from the speed. */
  traverseMs: number
  /** The anti-drought budget: the longest wait the child may ever face. */
  maxWaitMs: number
  /** Is the belt advancing? It never stops while a belt round is on stage. */
  moving: boolean
  /** Position along the loop in pitches — grows forever while the belt runs. */
  offset: number
  /** The dish in the child's hand right now, lifted off its plate (else null). */
  lifted: string | null
  /** Wanted dishes that rode the visible span un-taken this round. */
  misses: number
  lanes: ConveyorLaneState[]
}

/** One duo friend's live ask + where to drop its food (css px). */
export interface DuoSideState {
  foodId: string
  count: number
  eaten: number
  mouthCss: { x: number; y: number }
}

export interface DuoState {
  /** Shared growth step of the pair, 0..DUO_GROW_STEPS. */
  step: number
  /** Left friend then right friend. */
  sides: DuoSideState[]
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
   * is stuck) so a spec can assert an exact growthStep after a feed, and also
   * takes back a big bite the LIVE round already won — the dice are rolled at
   * round start, so by the time a spec speaks the round may already be golden.
   * The adaptive stuck-catch-up is unaffected — only the dice are silenced.
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
  /**
   * Dress/undress the CURRENT round as a big bite (lip smack, glowing tray,
   * bigger food) without waiting on the 12% dice — so an adult can eyeball the
   * announcement on the device. No-ops mid-transition or during a duo.
   */
  devBigBite: (on: boolean) => void
  /**
   * Start a two-friend duo bonus round now (dev/e2e), if ≥2 episode slots are
   * free and no duo/transition is already running. Bypasses the data+chance
   * axis so a spec (or a curious adult) can see a duo on demand.
   * Returns false when a duo can't start right now.
   */
  forceDuo: () => boolean

  // ─── Commissions (the food the child draws) ───────────────────────────────
  /**
   * Open the pixel pad with a commission at the next round start, bypassing the
   * once-per-episode / episode-≥2 journey gate. Returns false while a
   * transition or a duo owns the stage.
   */
  forceCommission: () => boolean
  /**
   * Submit a synthetic drawing for the open commission so a spec need not paint
   * 40 cells by hand: `cells` are `{x, y, color}` palette entries on a 16×16
   * grid, or an empty array to close the pad blank. Returns false when no
   * commission is open.
   */
  submitDrawing: (cells: Array<{ x: number; y: number; color: number }>) => boolean
  /** Dev: retire every drawn food from the game (the gallery keeps the art). */
  wipeDrawnFoods: () => void

  // ─── Conveyor ─────────────────────────────────────────────────────────────
  /**
   * Re-deal the current round on the belt, bypassing the data+chance axis.
   * Returns false while a transition, a duo or the pad owns the stage.
   */
  forceConveyor: () => boolean

  // ─── The thief ────────────────────────────────────────────────────────────
  /**
   * Send a visitor in right now, bypassing the data+chance axis. Returns false
   * when one is already on stage, the tray is empty, or a celebration owns the
   * screen.
   */
  forceVisitor: (kind: 'thief' | 'butterfly') => boolean
}

declare global {
  interface Window {
    /** Dev/e2e-only handle to the Feed the Monster scene. */
    __feedTheMonster?: FeedTestApi
  }
}
