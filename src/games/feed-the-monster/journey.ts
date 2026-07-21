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
import type { Food } from './logic'

// ─── Growth ──────────────────────────────────────────────────────────────────

/** Fed rounds to fully grow one friend. */
export const GROW_STEPS = 6
/** Grown friends that complete an episode (the dance party). */
export const FRIENDS_PER_EPISODE = 5

/** A friend starts small… */
export const BASE_SCALE = 0.7
/** …and visibly outgrows the old monster's fixed 1.0 by the last step. */
export const FULL_SCALE = 1.45

/** Monster container scale for a growth step — ~12.5% bigger per step. */
export function scaleForStep(step: number): number {
  const clamped = Math.min(Math.max(step, 0), GROW_STEPS)
  return BASE_SCALE + ((FULL_SCALE - BASE_SCALE) * clamped) / GROW_STEPS
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

/** Advance the journey by one fed round. */
export function feedStep(journey: JourneyState): { next: JourneyState; outcome: FeedOutcome } {
  const grownTo = journey.growthStep + 1
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
export function auraIntensity(step: number): number {
  const clamped = Math.min(Math.max(step, 0), GROW_STEPS)
  return AURA_FLOOR + (1 - AURA_FLOOR) * (clamped / GROW_STEPS)
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
