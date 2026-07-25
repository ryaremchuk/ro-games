/**
 * The visible long-term journey of Feed the Monster — pure logic, no Phaser.
 *
 * The child feeds a small friend; every fed round grows it one visible step
 * (bigger + a brighter growth aura), a wrong feed deflates it one step (never
 * below the start — no-fail). A fully grown friend celebrates, walks aside to the
 * fed-friends lineup, and a new small friend hops in. Five grown friends =
 * dance party, then the next EPISODE begins: new food pool, new palette, new
 * friend colors. The journey persists via shared/progress.ts `data`, so the
 * progression is genuinely long-term (days, not sessions).
 *
 * Deliberately decoupled from the adaptive skill meter: the journey advances
 * on care performed (rounds fed), never on how hard the tasks were — the
 * meter owns difficulty, the journey owns visible progress.
 */

import { foodById } from './logic'
import type { Food, Rng } from './logic'

// ─── Growth ──────────────────────────────────────────────────────────────────

/**
 * Fed rounds to fully grow one friend: base → +1 → +2 → +3 (ready) → +4 (max,
 * graduates). Deliberately short so the "he grew!" payoff and the walk-aside
 * celebration come round after round — a faster pace than the old six-step
 * grind, tuned for a 3–4-year-old's attention span.
 */
export const GROW_STEPS = 4
/** Grown friends that complete an episode (the dance party). */
export const FRIENDS_PER_EPISODE = 5

/** A friend starts small… */
export const BASE_SCALE = 0.7
/** …and visibly outgrows the old monster's fixed 1.0 by the last step. */
export const FULL_SCALE = 1.45

/**
 * Monster container scale for a growth step, BASE_SCALE (newborn) → FULL_SCALE
 * (grown). `steps` is how many feeds reach full — GROW_STEPS for a solo friend,
 * DUO_GROW_STEPS for a duo pair — so both curves start small and end the same
 * size, just over a different number of feeds.
 */
export function scaleForStep(step: number, steps: number = GROW_STEPS): number {
  const clamped = Math.min(Math.max(step, 0), steps)
  return BASE_SCALE + ((FULL_SCALE - BASE_SCALE) * clamped) / steps
}

export interface JourneyState {
  /** 0-based episode counter (theme wraps modulo EPISODES.length). */
  episode: number
  /** Fully grown friends this episode, 0..FRIENDS_PER_EPISODE-1. */
  friendsFed: number
  /** Current friend's growth, 0..GROW_STEPS. */
  growthStep: number
}

export function initialJourney(): JourneyState {
  return { episode: 0, friendsFed: 0, growthStep: 0 }
}

/** Restore a journey from the persisted numeric bag, tolerating garbage. */
export function journeyFromData(data: Record<string, number>): JourneyState {
  const clamp = (value: unknown, max: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(Math.floor(value), 0), max)
      : 0
  return {
    episode: clamp(data.episode, Number.MAX_SAFE_INTEGER),
    friendsFed: clamp(data.friendsFed, FRIENDS_PER_EPISODE - 1),
    growthStep: clamp(data.growthStep, GROW_STEPS - 1),
  }
}

/** The persisted shape of a journey (progress.ts data bag). */
export function journeyToData(journey: JourneyState): Record<string, number> {
  return {
    episode: journey.episode,
    friendsFed: journey.friendsFed,
    growthStep: journey.growthStep,
  }
}

export type FeedOutcome =
  /** The friend grew one step (maybe gaining a detail). */
  | 'grew'
  /** The friend reached full size — celebrate, walk aside, next friend. */
  | 'friend-grown'
  /** The 5th friend finished — dance party, then the next episode. */
  | 'episode-complete'

// ─── Big bite: a catch-up that grows the friend TWO steps at once ─────────────

/** A single fed round that is NOT a big bite grows one step; a big bite, two. */
export const NORMAL_BITE = 1
export const BIG_BITE = 2

/**
 * Wrong feeds on the current friend (accumulated over its whole tenure, reset
 * when a fresh friend hops in) at or above this count mean the child is stuck —
 * the next correct round becomes a big bite to recover the lost ground. Mirrors
 * logic.SPIT_BACKS_BEFORE_EASE, the same "two slips = struggling" read.
 */
export const BIG_BITE_STUCK_SPITS = 2

/**
 * A small chance every fed round becomes a big bite even when nothing is wrong —
 * an occasional delightful "double" that keeps growth from feeling metronomic.
 */
export const BIG_BITE_CHANCE = 0.12

/**
 * How many steps this fed round grows the friend. A big bite (+2) fires as an
 * INVISIBLE catch-up once the child has spat back enough on this friend that it
 * has fallen behind — so a struggling toddler can never get stuck on the
 * +1/−1 treadmill a pure size threshold would allow — plus a rare random
 * sprinkle for joy even when they're cruising. Pure + seedable (see rng).
 */
export function growAmount(opts: { friendSpitBacks: number; rng: Rng }): 1 | 2 {
  if (opts.friendSpitBacks >= BIG_BITE_STUCK_SPITS) return BIG_BITE
  return opts.rng() < BIG_BITE_CHANCE ? BIG_BITE : NORMAL_BITE
}

/** Advance the journey by one fed round (grows `amount` steps — big bite = 2). */
export function feedStep(
  journey: JourneyState,
  amount: number = NORMAL_BITE,
): { next: JourneyState; outcome: FeedOutcome } {
  const grownTo = journey.growthStep + Math.max(1, Math.floor(amount))
  if (grownTo < GROW_STEPS) {
    return { next: { ...journey, growthStep: grownTo }, outcome: 'grew' }
  }
  const friendsFed = journey.friendsFed + 1
  if (friendsFed < FRIENDS_PER_EPISODE) {
    return {
      next: { episode: journey.episode, friendsFed, growthStep: 0 },
      outcome: 'friend-grown',
    }
  }
  return {
    next: { episode: journey.episode + 1, friendsFed: 0, growthStep: 0 },
    outcome: 'episode-complete',
  }
}

/** A wrong feed deflates one step — never below the start (no-fail). */
export function shrinkStep(journey: JourneyState): JourneyState {
  return { ...journey, growthStep: Math.max(journey.growthStep - 1, 0) }
}

// ─── Duo bonus: two little friends fed at once, grown together ────────────────

/**
 * A duo BONUS round stands two small friends side by side and feeds both from
 * one shared tray — each wants its own food (logic.generateDuoRound). Clearing
 * the round grows BOTH one synchronized step; after DUO_GROW_STEPS they are full
 * and walk to the lineup together as a pair. Two friends grown in three rounds
 * (vs 2×GROW_STEPS solo) — a deliberate pace + variety burst, injected on its
 * own data+chance axis (logic.shouldInjectDuo), NOT the difficulty meter.
 */
export const DUO_GROW_STEPS = 3

/** How many episode slots a completed duo fills (it graduates two friends). */
export const DUO_FRIENDS = 2

/**
 * Two friends share the stage, so a duo pair tops out a touch smaller than a
 * solo friend's FULL_SCALE — big enough to read as "all grown up", small enough
 * that the pair never crowds on a 4:3 iPad.
 */
export const DUO_FULL_SCALE = 1.2

/** Duo pair container scale for a growth step (BASE → DUO_FULL over 3 feeds). */
export function duoScaleForStep(step: number): number {
  const clamped = Math.min(Math.max(step, 0), DUO_GROW_STEPS)
  return BASE_SCALE + ((DUO_FULL_SCALE - BASE_SCALE) * clamped) / DUO_GROW_STEPS
}

/** Grow the duo pair one synchronized step; `done` once both are fully grown. */
export function duoFeedStep(growthStep: number): { next: number; done: boolean } {
  const grownTo = growthStep + 1
  return { next: Math.min(grownTo, DUO_GROW_STEPS), done: grownTo >= DUO_GROW_STEPS }
}

/**
 * A completed duo graduates BOTH friends: friendsFed advances by two. If that
 * fills the episode's quota the episode completes (grand dance + next theme);
 * otherwise the next (solo or duo) friend arrives. A duo is only ever injected
 * with ≥2 slots left (logic.shouldInjectDuo), so friendsFed never overshoots.
 */
export function duoComplete(journey: JourneyState): { next: JourneyState; outcome: FeedOutcome } {
  const friendsFed = journey.friendsFed + DUO_FRIENDS
  if (friendsFed < FRIENDS_PER_EPISODE) {
    return {
      next: { episode: journey.episode, friendsFed, growthStep: 0 },
      outcome: 'friend-grown',
    }
  }
  return {
    next: { episode: journey.episode + 1, friendsFed: 0, growthStep: 0 },
    outcome: 'episode-complete',
  }
}

// ─── Friend looks: colors + growth details ───────────────────────────────────

/** Distinct friendly body hues; friends cycle through, never twins in a row. */
export const FRIEND_COLORS: readonly number[] = [
  0x9b5de5, // purple (the original monster)
  0x2ec4b6, // teal
  0x4d96ff, // blue
  0xff8fab, // pink
  0x6bcb77, // green
  0xf4a259, // amber
  0x5f6caf, // indigo
  0x00b4d8, // cyan
  0xb388eb, // lilac
  0xef767a, // salmon
]

/** Stable body color for a friend across sessions. */
export function friendColor(episode: number, friendIndex: number): number {
  return FRIEND_COLORS[(episode * FRIENDS_PER_EPISODE + friendIndex) % FRIEND_COLORS.length]
}

/** Same-hue darker shade for the belly patch / nose (simple channel scale). */
export function darken(color: number, factor = 0.86): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor)
  const g = Math.floor(((color >> 8) & 0xff) * factor)
  const b = Math.floor((color & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}

/** A brand-new (or freshly deflated) friend still glows faintly, not flat. */
export const AURA_FLOOR = 0.12

/**
 * The friend's growth AURA, AURA_FLOOR (newborn) → 1 (fully grown). This is how
 * growth reads visually now: a soft halo, a glowing rim and orbiting sparkles
 * all scale with this single number, so every friend shows progress the same
 * way with zero per-friend tuning.
 *
 * It replaced the old worn-accessory system (hat / glasses / scarf / bowtie /
 * flower / crown). Those hung on face-derived sockets, so each one had to sit
 * correctly across ten different animals, at every growth scale, on the walker
 * AND on every lineup mini — a persistent, fiddly source of layout bugs. An
 * aura is centered on the body: nothing to anchor, nothing to collide.
 */
export function auraIntensity(step: number, steps: number = GROW_STEPS): number {
  const clamped = Math.min(Math.max(step, 0), steps)
  return AURA_FLOOR + (1 - AURA_FLOOR) * (clamped / steps)
}

// ─── Episodes: food pool + visual theme ──────────────────────────────────────

export interface EpisodePalette {
  bgTop: number
  bgBottom: number
  table: number
  tableEdge: number
}

export interface Episode {
  id: string
  /** For aria labels / debugging only — the child never reads text. */
  title: string
  /** 18 foods = three full 6-color cycles (same invariant as logic.FOODS). */
  foods: readonly Food[]
  palette: EpisodePalette
}

const foods = (ids: string[]): Food[] => ids.map(foodById)

/**
 * Episode themes. Each pool is listed as three interleaved
 * red-yellow-green-orange-purple-brown cycles so any 8-wide rotation window
 * keeps every color (journey.test.ts enforces it per episode).
 */
export const EPISODES: readonly Episode[] = [
  {
    id: 'garden',
    title: 'Garden',
    // Episode 1 = logic.FOODS order exactly (the original game).
    foods: foods([
      'apple',
      'banana',
      'broccoli',
      'carrot',
      'grapes',
      'cookie',
      'strawberry',
      'cheese',
      'pear',
      'orange',
      'eggplant',
      'donut',
      'tomato',
      'lemon',
      'cucumber',
      'mango',
      'blueberries',
      'pretzel',
    ]),
    palette: { bgTop: 0xffe8cc, bgBottom: 0xffd8a8, table: 0xf4bc8c, tableEdge: 0xe0a878 },
  },
  {
    id: 'breakfast',
    title: 'Breakfast',
    foods: foods([
      'tomato',
      'egg',
      'avocado',
      'carrot',
      'grapes',
      'bread',
      'apple',
      'cheese',
      'cucumber',
      'orange',
      'blueberries',
      'pretzel',
      'bacon',
      'butter',
      'lettuce',
      'pumpkin',
      'sweet-potato',
      'waffle',
    ]),
    palette: { bgTop: 0xdcefff, bgBottom: 0xbfe0f8, table: 0xd9b38c, tableEdge: 0xc79d76 },
  },
  {
    id: 'picnic',
    title: 'Picnic',
    foods: foods([
      'watermelon',
      'corn',
      'broccoli',
      'mango',
      'eggplant',
      'burger',
      'strawberry',
      'lemon',
      'green-apple',
      'peach',
      'grapes',
      'hotdog',
      'cherries',
      'cheese',
      'pear',
      'orange',
      'blueberries',
      'cookie',
    ]),
    palette: { bgTop: 0xe4f7d9, bgBottom: 0xccecbd, table: 0xe8d5a3, tableEdge: 0xd2bc84 },
  },
  {
    id: 'sweets',
    title: 'Sweets',
    foods: foods([
      'cherries',
      'custard',
      'kiwi',
      'peach',
      'blueberries',
      'chocolate',
      'strawberry',
      'banana',
      'melon',
      'mango',
      'grapes',
      'donut',
      'apple',
      'honey',
      'green-apple',
      'orange',
      'sweet-potato',
      'cookie',
    ]),
    palette: { bgTop: 0xffe4ef, bgBottom: 0xffd0e4, table: 0xf3b8cf, tableEdge: 0xe09fbb },
  },
]

/** The active episode theme (themes wrap forever — the journey never ends). */
export function episodeFor(journey: JourneyState): Episode {
  return EPISODES[journey.episode % EPISODES.length]
}
