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
 * Duration of the glide in, at every skill.
 *
 * DOUBLED from the 620 ms it shipped at, after watching the game played on the
 * iPad: the bird was on the plate before the child had finished turning their head,
 * so the only real chance to act came *after* it had landed. The glide is the
 * "here it comes — catch it" beat, and the visitor is tappable throughout it, so
 * halving its speed hands back the in-flight catch the mechanic was always meant
 * to offer.
 *
 * It stays FLAT across the ladder on purpose: the glide is the fair-warning half
 * of a visit, and difficulty rides the peck window and the telegraph instead. The
 * total tappable window still shrinks with skill (see MIN_TAPPABLE_MS).
 */
export const APPROACH_MS = 1_240

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
 * Dials for a thief-meter value. The peck window shrinks 3.0 s → 1.5 s and the
 * telegraph 1.5 s → 1.0 s. The glide is the same generous length at every skill
 * (see APPROACH_MS), so the whole ladder is "how long you have once it is there".
 */
export function thiefDials(thiefSkill: number): ThiefDials {
  const clamped = Math.min(Math.max(thiefSkill, 0), THIEF_SKILL_MAX)
  const t = clamped / THIEF_SKILL_MAX
  return {
    approachMs: APPROACH_MS,
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

/** Below this COGNITIVE meter value the child is not fluent with the basic loop. */
export const THIEF_MIN_SKILL = 3
/** Never two visits within this many rounds. */
export const THIEF_MIN_GAP = 2
/** Base chance once eligible… */
export const THIEF_BASE_CHANCE = 0.3
/** …rising each further round since the last visit… */
export const THIEF_RAMP = 0.12
/** …capped here (≈ 1 visit in 2 rounds at the top). */
export const THIEF_MAX_CHANCE = 0.5

export interface ThiefContext {
  /** Cognitive meter — the competence gate. */
  skill: number
  /** Rounds since the last visit (large if never) — the anti-drought ramp. */
  roundsSinceLastVisit: number
  /** Did the last round ease the meter? Then don't pile on. */
  struggling: boolean
  /** A duo, a commission or a belt round owns the stage — no visitors. */
  busy: boolean
}

/**
 * Should the bird drop in during the next round? Gated so it never lands on a
 * struggling child and never two rounds in a row, then a chance that ramps. It is
 * rare and telegraphed on purpose: the risk of this feature is hijacking attention
 * from the actual learning task and turning a thinking game into a reflex game.
 */
export function shouldVisit(ctx: ThiefContext, rng: Rng): boolean {
  if (ctx.busy) return false
  if (Math.round(ctx.skill) < THIEF_MIN_SKILL) return false
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
