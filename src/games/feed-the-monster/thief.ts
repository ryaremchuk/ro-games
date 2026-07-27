/**
 * The THIEF — pure visit logic. No Phaser: whether a visit happens, which plate
 * it lands on, whether it is a thief or the go/no-go butterfly, and every timing
 * curve live here and are unit-tested (thief.test.ts).
 *
 * The mechanic: every now and then a cheeky magpie glides in, lands on a plate and
 * starts pecking. A tap sends it flapping off empty-clawed — and it counts from the
 * moment the bird is on screen, so the glide in is a catch opportunity, not a wait.
 * Ignore it long enough and it flies away WITH the food — at which point a fresh
 * one drops onto the plate, because nothing in this game is ever lost.
 *
 * This is the game's first INTERRUPTION: something that demands a response while
 * the real job (feed the friend) is still open. That is a different muscle from
 * anything in TASK_REGISTRY, and it is the precursor to the butterfly — a validated
 * go/no-go paradigm for exactly this age, dressed as a concrete fantasy ("tap the
 * thief, leave the butterfly alone") rather than an abstract rule.
 *
 * Two design constraints that are NOT negotiable and are enforced here:
 *  • Catching the thief pays JOY, never growth or stars. HCI work on children's
 *    games finds reward/penalty framing pulls children away from the intended
 *    thinking behaviour, and the journey stays tied to care performed.
 *  • Tapping the butterfly is not punished. It simply flies away and the friend
 *    does not giggle — the reward is withheld, nothing is deducted.
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
  /** Share of visits that are the no-go butterfly. */
  noGoRate: number
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
 * of a visit, and difficulty rides the peck window and the no-go rate instead. The
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
 * The meter value at which the butterfly starts appearing. It only unlocks once
 * the child reliably catches thieves — a no-go trial the child cannot yet pass the
 * GO half of teaches nothing.
 */
export const BUTTERFLY_MIN_SKILL = 3

/**
 * Dials for a thief-meter value. The peck window shrinks 3.0 s → 1.5 s and the
 * telegraph 1.5 s → 1.0 s, while the butterfly ramps in from nothing to ~30 % of
 * visits — the standard no-go ratio that makes withholding genuinely hard. The
 * glide is the same generous length at every skill (see APPROACH_MS).
 */
export function thiefDials(thiefSkill: number): ThiefDials {
  const clamped = Math.min(Math.max(thiefSkill, 0), THIEF_SKILL_MAX)
  const t = clamped / THIEF_SKILL_MAX
  const unlocked = clamped >= BUTTERFLY_MIN_SKILL
  const noGoT = unlocked
    ? (clamped - BUTTERFLY_MIN_SKILL) / Math.max(1, THIEF_SKILL_MAX - BUTTERFLY_MIN_SKILL)
    : 0
  return {
    approachMs: APPROACH_MS,
    peckWindowMs: Math.round(lerp(3_000, 1_500, t)),
    telegraphMs: Math.round(lerp(1_500, 1_000, t)),
    noGoRate: unlocked ? lerp(0.12, 0.3, noGoT) : 0,
  }
}

export type VisitorKind = 'thief' | 'butterfly'

/** What a finished visit taught us about the child's inhibitory control. */
export interface VisitOutcome {
  kind: VisitorKind
  /** Did the child tap it inside the window? */
  tapped: boolean
}

/**
 * One adaptive step on the thief axis. A caught thief and a correctly-ignored
 * butterfly both advance it (both are the right response); a missed thief eases
 * it. Tapping a butterfly is a false alarm — it holds the meter rather than
 * dropping it, because the reward was already withheld and this game never
 * punishes twice for one slip.
 */
export function updateThiefSkill(thiefSkill: number, outcome: VisitOutcome): number {
  const clamped = Math.min(Math.max(Math.round(thiefSkill), 0), THIEF_SKILL_MAX)
  if (outcome.kind === 'thief') {
    return outcome.tapped ? Math.min(clamped + 1, THIEF_SKILL_MAX) : Math.max(clamped - 1, 0)
  }
  return outcome.tapped ? clamped : Math.min(clamped + 1, THIEF_SKILL_MAX)
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
 * Should a visitor drop in during the next round? Gated so it never lands on a
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

/** Thief or butterfly, at this meter value. */
export function pickVisitor(thiefSkill: number, rng: Rng): VisitorKind {
  return rng() < thiefDials(thiefSkill).noGoRate ? 'butterfly' : 'thief'
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
