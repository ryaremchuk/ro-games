/**
 * The food CONVEYOR — pure belt mechanics. No Phaser: the loop, the spawn
 * scheduler and every difficulty curve live here and are unit-tested
 * (belt.test.ts); conveyorMode.ts only draws what this decides.
 *
 * The mechanic in one line: the still row of plates is replaced, for that round,
 * by a slow kaiten-sushi loop. Dishes ride past; the child waits for the one the
 * friend asked for, lifts it off and feeds it. Nothing is ever lost — the belt is
 * a CLOSED LOOP, so a dish that leaves one edge comes back from the other, and
 * "I missed it" is a few seconds of waiting rather than a failure.
 *
 * Two guarantees make waiting safe rather than boring:
 *
 *  1. **The anti-drought guarantee.** A dish the request currently wants must stay
 *     reachable within `maxWaitMs` (plus at most one dish-pitch of scheduling
 *     latency — the belt only makes decisions when a lane reaches the hatch, and a
 *     pitch is the granularity a belt HAS). Every spawn decision checks how long
 *     until a wanted dish next reaches the grab zone and, if that exceeds the
 *     budget, forces the next dish to be a wanted one. Same shape as
 *     logic.shouldInjectDuo's anti-drought ramp: live data in, deterministic
 *     decision out, seedable, tested.
 *  2. **Motion is only in the SCAN.** Touching a dish lifts it off the belt and
 *     the belt eases to a stop — so the grab, the drag and the drop are exactly
 *     as static as they are today. Children's touchscreen accuracy collapses on
 *     the final approach to a target, and drag-and-drop is already the expensive
 *     gesture at this age; a MOVING drag source would stack the two hardest
 *     things on top of each other. (That rule is enforced in conveyorMode.)
 *
 * The belt rides its own persisted meter (`belt`), separate from the cognitive
 * one: a child can be great at colours and bad at timing, and measuring that
 * separately is the whole point of the axis.
 */

import type { Rng, TaskKind } from './logic'

// ─── Geometry of the loop ─────────────────────────────────────────────────────

/**
 * Lanes that sit off-screen behind the kitchen hatch. This is what makes the belt
 * a STREAM rather than a carousel: a dish can be genuinely "not here yet", which
 * is the only way waiting can mean anything.
 *
 * Exactly ONE, and that is a correctness constraint rather than a visual choice: a
 * dish scheduled at the hatch still has to RIDE to the grab zone, so every hidden
 * lane adds a full pitch of latency between "the scheduler decided to rescue the
 * child" and "the child can act". At the easiest belt setting a pitch is ~3 s
 * against a 4 s budget, so a two-lane pipeline could not honour the budget at all.
 * One hidden lane is still enough to hide the spawn behind the hatch sprite, which
 * is the whole visual job.
 */
export const BELT_HIDDEN_LANES = 1

/**
 * A visible dish counts as reachable only while it will stay on screen at least
 * this long. A wanted dish two centimetres from the right edge is not an
 * opportunity, it is a tease.
 */
export const BELT_GRAB_GRACE_MS = 1200

/** Total lanes on the loop for a given visible dish count. */
export function laneCount(visibleDishes: number): number {
  return Math.max(1, Math.floor(visibleDishes)) + BELT_HIDDEN_LANES
}

/**
 * Where lane `index` sits right now, in "slots from the hatch": 0 … lanes, where
 * slots below BELT_HIDDEN_LANES are still behind the hatch and the rest are on
 * screen. `offset` grows by one per pitch the belt travels.
 */
export function laneSlot(index: number, offset: number, lanes: number): number {
  const slot = (index + offset) % lanes
  return slot < 0 ? slot + lanes : slot
}

/**
 * The first slot whose dish is FULLY on screen. A dish is drawn centred on its
 * slot, so "off screen" has to account for its own half-width: the visible span
 * is pushed one pitch to the right of the hatch lane, which is what makes
 * `isSlotHidden` mean *actually invisible* rather than merely *flagged hidden*.
 * (It did not, and the dry-belt rescue could then visibly swap a dish that was
 * half past the hatch.)
 */
export const FIRST_VISIBLE_SLOT = BELT_HIDDEN_LANES + 1

/** Is this slot's dish entirely off screen, behind the hatch? */
export function isSlotHidden(slot: number): boolean {
  return slot <= BELT_HIDDEN_LANES
}

/** Is this slot's dish fully on screen (past the hatch, before the right edge)? */
export function isSlotVisible(slot: number, lanes: number): boolean {
  return slot >= FIRST_VISIBLE_SLOT && slot <= lanes
}

/**
 * Slot → x offset in pitches from the left screen edge (negative behind the
 * hatch). Slot `FIRST_VISIBLE_SLOT` lands its LEFT edge exactly at x = 0 and the
 * last lane its right edge at the far edge, so the loop fills the width.
 */
export function slotPitchX(slot: number): number {
  return slot - BELT_HIDDEN_LANES - 0.5
}

/** ms for a dish to advance one pitch, from the visible-traverse time. */
export function stepMs(traverseMs: number, visibleDishes: number): number {
  return traverseMs / Math.max(1, Math.floor(visibleDishes))
}

/**
 * How long until the dish in this slot can actually be taken. Zero when it is on
 * screen with grabbing room to spare; otherwise the time until it (re-)enters
 * from the hatch — which is why the closed loop means a miss is never a loss.
 */
export function msUntilReachable(slot: number, lanes: number, step: number): number {
  const exitIn = (lanes - slot) * step
  if (isSlotVisible(slot, lanes)) {
    return exitIn >= BELT_GRAB_GRACE_MS ? 0 : exitIn + FIRST_VISIBLE_SLOT * step
  }
  return Math.max(0, (FIRST_VISIBLE_SLOT - slot) * step)
}

// ─── Difficulty dials (the belt's own axis) ───────────────────────────────────

/** The belt meter's ceiling — a shorter ladder than the cognitive 0..12. */
export const BELT_SKILL_MAX = 8

export interface BeltDials {
  /** ms for one dish to cross the whole visible belt. */
  traverseMs: number
  /** The anti-drought budget: the longest wait the child may ever face. */
  maxWaitMs: number
  /** Roughly one dish in this many is one the request wants. */
  wantedEvery: number
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/**
 * Belt dials for a meter value — all three monotone in skill, all three easiest
 * at 0. The easiest belt is genuinely slow (18 s to cross) with a wanted dish
 * every third plate and never more than 4 s of waiting; the hardest halves the
 * traverse, thins the wanted dishes to one in six and stretches the wait to 9 s.
 */
export function beltDials(beltSkill: number): BeltDials {
  const t = Math.min(Math.max(beltSkill, 0), BELT_SKILL_MAX) / BELT_SKILL_MAX
  return {
    traverseMs: Math.round(lerp(18_000, 9_000, t)),
    maxWaitMs: Math.round(lerp(4_000, 9_000, t)),
    wantedEvery: lerp(3, 6, t),
  }
}

/**
 * What a finished conveyor round did to the belt meter.
 *
 * `missedPasses` is the belt-specific signal — wanted dishes that rode the whole
 * visible span un-taken. That is timing and sustained scanning, which is exactly
 * what this axis exists to measure; `spitBacks` (a cognitive slip) is counted too
 * but only as a brake, never as the reason to advance.
 */
export interface BeltRoundResult {
  missedPasses: number
  spitBacks: number
}

/** Misses this many times in one round and the belt eases off. */
export const BELT_MISSES_BEFORE_EASE = 2

/** One adaptive step on the belt axis — asymmetric, no-fail, same as the meter. */
export function updateBeltSkill(beltSkill: number, result: BeltRoundResult): number {
  const clamped = Math.min(Math.max(Math.round(beltSkill), 0), BELT_SKILL_MAX)
  if (result.missedPasses >= BELT_MISSES_BEFORE_EASE) return Math.max(clamped - 1, 0)
  if (result.missedPasses === 0 && result.spitBacks === 0) {
    return Math.min(clamped + 1, BELT_SKILL_MAX)
  }
  return clamped
}

// ─── The spawn scheduler (the anti-drought guarantee) ─────────────────────────

export interface BeltLaneSnapshot {
  /** Slots from the hatch (see laneSlot). */
  slot: number
  /** What rides this lane, or null for a gap (an eaten dish leaves one). */
  foodId: string | null
}

export interface BeltRefillContext {
  /** Every lane EXCEPT the one being refilled. */
  others: readonly BeltLaneSnapshot[]
  lanes: number
  /** ms per pitch (see stepMs). */
  step: number
  maxWaitMs: number
  wantedEvery: number
  /** Foods this round can put on the belt (the round's tray composition). */
  pool: readonly string[]
  /** Would feeding this food be correct right now? (logic.wantsFood) */
  wanted: (foodId: string) => boolean
}

/**
 * How long until the child could next take a wanted dish, given what is already
 * on the belt. Infinity when nothing on the belt is wanted at all.
 */
export function soonestWantedMs(ctx: BeltRefillContext): number {
  let soonest = Infinity
  for (const lane of ctx.others) {
    if (lane.foodId === null || !ctx.wanted(lane.foodId)) continue
    soonest = Math.min(soonest, msUntilReachable(lane.slot, ctx.lanes, ctx.step))
  }
  return soonest
}

/** How long a dish spawned at the hatch takes to become grabbable. */
export function hatchDelayMs(step: number): number {
  return FIRST_VISIBLE_SLOT * step
}

/**
 * Has the wait for a wanted dish grown past what the budget allows?
 *
 * This is the anti-drought guarantee's CONTINUOUS check, and it is the one the
 * child actually experiences. The spawn decision in `nextDishFood` only runs when
 * a lane reaches the hatch — once per pitch — so on its own it leaves up to a
 * pitch of latency on top of the ride out of the hatch. Polling this every frame
 * and re-dressing the emerging lane (`rescueLane`) removes that latency.
 *
 * What remains is physical and cannot be removed: a dish still has to RIDE from
 * the hatch into reach, which takes `hatchDelayMs`. On the slowest belt a pitch is
 * ~3 s, so the honest worst case there is the larger of the budget and the hatch
 * delay — the belt keeps its promise by making wanted dishes DENSE when it is slow
 * (one in three at the easiest setting), so the typical wait is a fraction of it.
 */
export function needsRescue(ctx: BeltRefillContext): boolean {
  return soonestWantedMs(ctx) > refillThresholdMs(ctx.maxWaitMs, ctx.step)
}

/** Is there nothing wanted anywhere on the loop at all? */
export function beltIsDry(ctx: BeltRefillContext): boolean {
  return soonestWantedMs(ctx) === Infinity
}

/**
 * The lane to re-dress when the belt has gone dry: the hidden lane CLOSEST TO
 * EMERGING.
 *
 * The trick is that a hidden lane's dish is, by definition, not on screen — so it
 * can be swapped for a wanted one with nothing visibly materialising or changing.
 * And because the lanes are one pitch apart and the hidden span is one pitch wide,
 * there is ALWAYS exactly one such lane, so the rescue can always act.
 *
 * Closest to emerging, not furthest: the child is waiting, and the lane about to
 * come out of the hatch reaches them in a single pitch instead of a whole loop.
 *
 * Returns the lane's index into the array passed in, or null if none is hidden.
 */
export function rescueLane(lanes: readonly BeltLaneSnapshot[]): number | null {
  let best: number | null = null
  let bestSlot = -Infinity
  lanes.forEach((lane, index) => {
    if (!isSlotHidden(lane.slot)) return
    if (lane.slot > bestSlot) {
      bestSlot = lane.slot
      best = index
    }
  })
  return best
}

/** A food this round wants, or null when nothing in the pool is wanted. */
export function pickWantedFood(
  pool: readonly string[],
  wanted: (foodId: string) => boolean,
  rng: Rng,
): string | null {
  const candidates = pool.filter(wanted)
  return candidates.length === 0 ? null : pick(candidates, rng)
}

/**
 * The wait at which the scheduler must intervene. NOT the budget itself: a rescue
 * dish still has to ride out of the hatch, so the trigger has to fire a hatch
 * delay early or the rescue lands after the budget it was meant to protect.
 */
export function refillThresholdMs(maxWaitMs: number, step: number): number {
  return Math.max(0, maxWaitMs - hatchDelayMs(step))
}

/**
 * What the next dish out of the hatch carries.
 *
 * THE rule that makes waiting safe: if no wanted dish is reachable inside the
 * budget (minus the hatch delay — see refillThresholdMs), this one is forced to be
 * a wanted one. Otherwise it is wanted with probability 1/wantedEvery, so the belt
 * keeps its scanning challenge without ever running dry.
 */
export function nextDishFood(ctx: BeltRefillContext, rng: Rng): string {
  const wantedPool = ctx.pool.filter((id) => ctx.wanted(id))
  const otherPool = ctx.pool.filter((id) => !ctx.wanted(id))
  // Round essentially over (nothing is wanted any more): dress the belt with
  // anything rather than stall — the celebration is already running.
  if (wantedPool.length === 0) return pick(ctx.pool, rng)
  if (otherPool.length === 0) return pick(wantedPool, rng)

  const forced = soonestWantedMs(ctx) > refillThresholdMs(ctx.maxWaitMs, ctx.step)
  const byChance = rng() < 1 / Math.max(1, ctx.wantedEvery)
  return forced || byChance ? pick(wantedPool, rng) : pick(otherPool, rng)
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]
}

// ─── Injection axis (data + chance, exactly like the duo) ─────────────────────

/** Below this COGNITIVE meter value the child is still learning the basics. */
export const CONVEYOR_MIN_SKILL = 4
/** Never two belt rounds within this many rounds. */
export const CONVEYOR_MIN_GAP = 3
/** Base injection chance once eligible… */
export const CONVEYOR_BASE_CHANCE = 0.16
/** …rising each further round since the last belt (anti-drought)… */
export const CONVEYOR_RAMP = 0.08
/** …capped here. */
export const CONVEYOR_MAX_CHANCE = 0.6

/**
 * Task kinds a belt round cannot host. A kitchen round fills a pot FROM the
 * tray, and the belt is what replaced the tray — mixing the two would muddy both.
 */
export const CONVEYOR_EXCLUDED_KINDS: readonly TaskKind[] = ['dish', 'dish-ordered']

export interface ConveyorContext {
  /** Cognitive meter — the competence gate (belt practice needs a fluent child). */
  skill: number
  /** Rounds since the last belt round (large if never) — the anti-drought ramp. */
  roundsSinceLastConveyor: number
  /** Did the last round ease the meter? Then don't pile a new mechanic on. */
  struggling: boolean
}

/**
 * Should the next round ride the belt? Gated on competence and pacing, then a
 * chance that ramps the longer it has been — so the belt reads as a change of
 * scene, not a random difficulty spike. Pure + seedable; the scene feeds it live
 * data and Math.random.
 */
export function shouldInjectConveyor(ctx: ConveyorContext, rng: Rng): boolean {
  if (Math.round(ctx.skill) < CONVEYOR_MIN_SKILL) return false
  if (ctx.struggling) return false
  if (ctx.roundsSinceLastConveyor < CONVEYOR_MIN_GAP) return false
  const chance = Math.min(
    CONVEYOR_MAX_CHANCE,
    CONVEYOR_BASE_CHANCE + CONVEYOR_RAMP * (ctx.roundsSinceLastConveyor - CONVEYOR_MIN_GAP),
  )
  return rng() < chance
}
