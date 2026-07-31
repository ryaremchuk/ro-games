/**
 * The THIEF — pure visit logic. No Phaser: whether a visit happens, which plate
 * it lands on, and every timing curve live here and are unit-tested
 * (thief.test.ts).
 *
 * The mechanic: every now and then a cheeky magpie glides in, lands on a plate and
 * starts pecking. A tap sends it flapping off empty-clawed — and it counts from the
 * moment the bird is on screen, so the glide in is a catch opportunity, not a wait.
 * Ignore it long enough and it flies away WITH the food — at which point a fresh
 * one drops onto the plate, because nothing in this game is ever lost.
 *
 * This is the game's first INTERRUPTION: something that demands a response while
 * the real job (feed the friend) is still open. That is a different muscle from
 * anything in TASK_REGISTRY, and the bird is the only visitor there is. A second
 * "do NOT tap this one" creature (a go/no-go butterfly) shipped here and was cut
 * on the device: watching it play, the rule read as an odd extra mechanic rather
 * than part of the fantasy — one visitor, one response, is what a 3–4yo can hold.
 *
 * One design constraint that is NOT negotiable and is enforced here: catching the
 * thief pays JOY, never growth or stars. HCI work on children's games finds
 * reward/penalty framing pulls children away from the intended thinking behaviour,
 * and the journey stays tied to care performed.
 */

import type { Rng } from './logic'

// ─── The thief's own meter ────────────────────────────────────────────────────

/** Ceiling of the thief axis — a short ladder, like the belt's. */
export const THIEF_SKILL_MAX = 6

export interface ThiefDials {
  /**
   * The glide: how long the visitor is in the air, from its first frame on screen
   * to touching down on the plate. It is tappable for every one of those ms.
   */
  approachMs: number
  /** How long the child has to react once the bird has landed. */
  peckWindowMs: number
  /** Warning before the bird is on screen (shadow + a distant caw). */
  telegraphMs: number
}

/**
 * Duration of the glide in — how long the bird is in the air before it lands, and
 * therefore how fast it FLIES. It is tappable for every one of those ms, so this is
 * the mechanic's most legible difficulty dial: a slow drifting bird is an easy
 * catch, a fast one is a real one.
 *
 * The easy end is double the 620 ms the feature shipped at, after watching it on
 * the iPad: the bird was on the plate before the child had finished turning their
 * head, so the only real chance to act came *after* it had landed. The hard end is
 * still slower than that original, because the tappable window as a whole is
 * floored (see MIN_TAPPABLE_MS) — the ladder makes the catch sharper, never a
 * coin flip.
 */
export const APPROACH_MS_EASY = 1_800
export const APPROACH_MS_HARD = 900

/**
 * Floor on the WHOLE tappable window (glide + peck) at any skill. A four-year-old
 * has to notice the bird, decide, and land a finger on a moving target; below this
 * the visit stops measuring attention and starts measuring reflexes.
 */
export const MIN_TAPPABLE_MS = 2_000

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/**
 * Dials for a thief-meter value: the bird flies in faster (1.8 s → 0.9 s), pecks
 * for less time (3.0 s → 1.5 s) and warns for less time (1.5 s → 1.0 s). All three
 * monotone, all three easiest at 0, and the whole tappable window stays above
 * MIN_TAPPABLE_MS at every rung (asserted in thief.test.ts).
 */
export function thiefDials(thiefSkill: number): ThiefDials {
  const clamped = Math.min(Math.max(thiefSkill, 0), THIEF_SKILL_MAX)
  const t = clamped / THIEF_SKILL_MAX
  return {
    approachMs: Math.round(lerp(APPROACH_MS_EASY, APPROACH_MS_HARD, t)),
    peckWindowMs: Math.round(lerp(3_000, 1_500, t)),
    telegraphMs: Math.round(lerp(1_500, 1_000, t)),
  }
}

/** What a finished visit taught us about the child's alertness. */
export interface VisitOutcome {
  /** Did the child tap the bird inside the window? */
  tapped: boolean
}

/**
 * One adaptive step on the thief axis: a caught thief advances it, a missed one
 * eases it, both by one and both clamped to the ladder.
 */
export function updateThiefSkill(thiefSkill: number, outcome: VisitOutcome): number {
  const clamped = Math.min(Math.max(Math.round(thiefSkill), 0), THIEF_SKILL_MAX)
  return outcome.tapped ? Math.min(clamped + 1, THIEF_SKILL_MAX) : Math.max(clamped - 1, 0)
}

// ─── Should a visit happen? ───────────────────────────────────────────────────

/**
 * The smallest `roundsSinceLastVisit` that may host a visit. TWO, which is one
 * clear round in between — the bird is punctuation, and two visits running would
 * make it the game. (The counter is 0 on the round a bird visited and 1 on the next
 * one, so this is the value that bars back-to-back rather than 1.)
 *
 * Frequency is raised on the CHANCE, not by shortening this: birds that arrive in
 * consecutive rounds are the exact failure mode this feature was gated against.
 */
export const THIEF_MIN_GAP = 2
/**
 * Base chance once eligible…
 *
 * Raised from 0.30 on the strength of watching it played: the bird is the funniest
 * thing in the game, it costs the child nothing (the food is always replaced) and it
 * pays joy rather than progress, so it is the cheapest variety the game has. It is
 * also no longer gated on the cognitive meter at all — that made the funniest thing
 * in the game a reward for being good at counting. The gate is the EPISODE now
 * (session.THIEF_UNLOCK_EPISODE), like the belt and the pot.
 */
export const THIEF_BASE_CHANCE = 0.45
/** …rising each further round since the last visit… */
export const THIEF_RAMP = 0.14
/** …capped here (≈ 3 visits in 4 eligible rounds at the top of the ramp). */
export const THIEF_MAX_CHANCE = 0.72

export interface ThiefContext {
  /** Has the journey reached the episode where the bird exists? */
  unlocked: boolean
  /** Rounds since the last visit (large if never) — the anti-drought ramp. */
  roundsSinceLastVisit: number
  /** Did the last round ease the meter? Then don't pile on. */
  struggling: boolean
  /** A kitchen round or a commission owns the stage — no visitors. */
  busy: boolean
}

/**
 * Should the bird drop in during the next round? Gated on the episode, on not
 * landing two rounds running, and on not piling onto a child who has just had a
 * rough round; then a chance that ramps with the wait.
 *
 * It stays telegraphed and never back-to-back on purpose: the risk of this feature
 * was always hijacking attention from the actual learning task and turning a
 * thinking game into a reflex game. What changed is the FREQUENCY, not the fairness.
 */
export function shouldVisit(ctx: ThiefContext, rng: Rng): boolean {
  if (ctx.busy) return false
  if (!ctx.unlocked) return false
  if (ctx.struggling) return false
  if (ctx.roundsSinceLastVisit < THIEF_MIN_GAP) return false
  const chance = Math.min(
    THIEF_MAX_CHANCE,
    THIEF_BASE_CHANCE + THIEF_RAMP * (ctx.roundsSinceLastVisit - THIEF_MIN_GAP),
  )
  return rng() < chance
}

// ─── Which plate? ─────────────────────────────────────────────────────────────

export interface PlateCandidate {
  /** Tray slot index. */
  slot: number
  foodId: string
  /** Would feeding this food be correct right now? (logic.wantsFood) */
  wanted: boolean
}

export interface VisitTarget {
  slot: number
  foodId: string
  /**
   * True when the only plates available held food the request wants. The scene
   * must then guarantee the replacement dropped in is the SAME food, so the round
   * cannot become unclearable.
   */
  mustReplaceSame: boolean
}

/**
 * Pick the plate a visitor lands on.
 *
 * The thief PREFERS a distractor: stealing a food the child still needs would be
 * the game taking work away from them. It only ever targets a wanted food when the
 * tray holds nothing else — and in that case `mustReplaceSame` tells the scene to
 * drop the identical food back, so the round stays completable at all times.
 *
 * Returns null when there is nothing on the tray to peck at.
 */
export function pickTarget(plates: readonly PlateCandidate[], rng: Rng): VisitTarget | null {
  if (plates.length === 0) return null
  const distractors = plates.filter((p) => !p.wanted)
  const from = distractors.length > 0 ? distractors : plates
  const chosen = from[Math.min(from.length - 1, Math.floor(rng() * from.length))]
  return {
    slot: chosen.slot,
    foodId: chosen.foodId,
    mustReplaceSame: distractors.length === 0,
  }
}
