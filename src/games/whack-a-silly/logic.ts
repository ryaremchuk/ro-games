/**
 * Pure spawn-scheduling and difficulty-ramp logic for Whack-a-Silly. No
 * Phaser imports — everything here is deterministic given an injected RNG
 * and is unit-tested in plain jsdom (see logic.test.ts).
 *
 * Numbers come from the go/no-go research brief: 75:25 go:no-go once hats
 * appear, stimulus up-time 2000ms ramping to a 1400ms floor (hard floor
 * 1200ms — never clip a legit 4yo reaction), inter-pop gap 1000ms → 600ms.
 */

/** Injectable random source, [0, 1). Defaults to Math.random in the game. */
export type Rng = () => number

export interface Critter {
  id: string
  emoji: string
}

/** Critter pool (≥ 6 designs) so the garden never looks the same for long. */
export const CRITTERS: readonly Critter[] = [
  { id: 'hamster', emoji: '🐹' },
  { id: 'rabbit', emoji: '🐰' },
  { id: 'hedgehog', emoji: '🦔' },
  { id: 'frog', emoji: '🐸' },
  { id: 'mouse', emoji: '🐭' },
  { id: 'chick', emoji: '🐥' },
  { id: 'fox', emoji: '🦊' },
]

export function critterById(id: string): Critter {
  const critter = CRITTERS.find((c) => c.id === id)
  if (!critter) throw new Error(`Unknown critter id: ${id}`)
  return critter
}

/** 3×3 garden grid. */
export const GRID_SIZE = 3
export const HOLE_COUNT = GRID_SIZE * GRID_SIZE

// ─── Timing rules (from the brief) ───────────────────────────────────────────

/** Critter up-time starts here… */
export const UP_TIME_START_MS = 2000
/** …and ramps down to this soft floor… */
export const UP_TIME_FLOOR_MS = 1400
/** …but NEVER below this (clips legit 4yo reaction time). */
export const UP_TIME_HARD_FLOOR_MS = 1200
/** Gap between one critter leaving and the next popping up. */
export const GAP_START_MS = 1000
export const GAP_FLOOR_MS = 600

/** Go:no-go 75:25 once party hats appear (phase 2+). */
export const HAT_PROBABILITY = 0.25
/** Golden critter — rare celebration spawn, phase 4 only. */
export const GOLDEN_PROBABILITY = 0.05
/** Chance a second critter pops at the same time, phase 3+ only. */
export const DOUBLE_PROBABILITY = 0.2
/** Chance a critter peeks sideways from the hole edge, phase 4 only. */
export const PEEK_PROBABILITY = 0.12

/** Every ~10 successful bops: a quick confetti burst (spawning never pauses). */
export const CONFETTI_EVERY_BOPS = 10

export function isConfettiBop(bops: number): boolean {
  return bops > 0 && bops % CONFETTI_EVERY_BOPS === 0
}

// ─── Phase / ramp state machine ──────────────────────────────────────────────

export type Phase = 1 | 2 | 3 | 4

/** Everything the ramp needs: elapsed play time + successful (go) bops. */
export interface RampState {
  elapsedMs: number
  bops: number
}

/** Warm-up ends after ~45s of play OR the first 12 bops, whichever first. */
export const PHASE2_TIME_MS = 45_000
export const PHASE2_BOPS = 12
export const PHASE3_TIME_MS = 100_000
export const PHASE3_BOPS = 26
export const PHASE4_TIME_MS = 160_000
export const PHASE4_BOPS = 40

const PHASE_GATES: readonly { phase: Phase; timeMs: number; bops: number }[] = [
  { phase: 4, timeMs: PHASE4_TIME_MS, bops: PHASE4_BOPS },
  { phase: 3, timeMs: PHASE3_TIME_MS, bops: PHASE3_BOPS },
  { phase: 2, timeMs: PHASE2_TIME_MS, bops: PHASE2_BOPS },
]

/**
 * P1 warm-up (all go, slow) → P2 hats appear (25% no-go) → P3 faster +
 * occasional double-pop → P4 variety (golden critter, sideways peeker).
 * Monotonic: elapsedMs and bops only ever grow, so the phase never regresses.
 */
export function phaseFor(state: RampState): Phase {
  for (const gate of PHASE_GATES) {
    if (state.elapsedMs >= gate.timeMs || state.bops >= gate.bops) return gate.phase
  }
  return 1
}

/** Full speed is reached after this much play time… */
export const RAMP_TIME_MS = 180_000
/** …or this many bops, whichever comes first (fast kids ramp faster). */
export const RAMP_BOPS = 45

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/** 0 → 1 ramp progress; driven by whichever of time / bops is further along. */
function rampProgress(state: RampState): number {
  return clamp01(Math.max(state.elapsedMs / RAMP_TIME_MS, state.bops / RAMP_BOPS))
}

/**
 * How long a critter stays up. Ramps 2000ms → 1400ms; phases 3 and 4 shave a
 * little extra for challenge but the hard floor of 1200ms always holds.
 */
export function upTimeMs(state: RampState): number {
  const base = UP_TIME_START_MS - (UP_TIME_START_MS - UP_TIME_FLOOR_MS) * rampProgress(state)
  const phase = phaseFor(state)
  const phaseBonus = phase >= 3 ? (phase - 2) * 100 : 0
  return Math.max(base - phaseBonus, UP_TIME_HARD_FLOOR_MS)
}

/** Gap before the next pop, 1000ms → 600ms. */
export function gapMs(state: RampState): number {
  return GAP_START_MS - (GAP_START_MS - GAP_FLOOR_MS) * rampProgress(state)
}

// ─── Spawn planning ──────────────────────────────────────────────────────────

export interface CritterSpawn {
  /** Hole index 0..HOLE_COUNT-1. */
  hole: number
  critterId: string
  /** Party hat = NO-GO: the child is celebrated for NOT bopping it. */
  hat: boolean
  /** Rare golden celebration critter (always a go — never wears a hat). */
  golden: boolean
  /** Peeks sideways from the hole edge (visual variety, phase 4). */
  peek: boolean
}

export interface SpawnPlan {
  primary: CritterSpawn
  /** Second simultaneous critter — occasional, phase 3+ only. */
  double: CritterSpawn | null
  /** How long these critters stay up. */
  upTimeMs: number
  /** Gap to schedule before the following spawn. */
  gapMs: number
}

function pickOne<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

/** Pick a hole avoiding the blocked set, or null if none are free. */
function pickHole(rng: Rng, blocked: ReadonlySet<number>): number | null {
  const open: number[] = []
  for (let i = 0; i < HOLE_COUNT; i++) {
    if (!blocked.has(i)) open.push(i)
  }
  if (open.length === 0) return null
  return pickOne(rng, open)
}

function rollCritter(phase: Phase, hole: number, rng: Rng): CritterSpawn {
  const golden = phase >= 4 && rng() < GOLDEN_PROBABILITY
  const hat = !golden && phase >= 2 && rng() < HAT_PROBABILITY
  const peek = !golden && phase >= 4 && rng() < PEEK_PROBABILITY
  return { hole, critterId: pickOne(rng, CRITTERS).id, hat, golden, peek }
}

/**
 * Plan the next spawn: which hole(s), which critter(s), hat or not, and the
 * current up-time/gap. Never reuses the previous spawn's hole (no same-hole
 * back-to-back) nor any currently-occupied hole.
 */
export function planSpawn(
  state: RampState,
  occupiedHoles: readonly number[],
  lastHole: number | null,
  rng: Rng = Math.random,
): SpawnPlan {
  const phase = phaseFor(state)
  const blocked = new Set(occupiedHoles)
  if (lastHole !== null) blocked.add(lastHole)

  // If everything is somehow blocked, relax constraints rather than stall.
  const primaryHole =
    pickHole(rng, blocked) ??
    pickHole(rng, new Set(occupiedHoles)) ??
    Math.floor(rng() * HOLE_COUNT)
  const primary = rollCritter(phase, primaryHole, rng)

  let double: CritterSpawn | null = null
  if (phase >= 3 && rng() < DOUBLE_PROBABILITY) {
    blocked.add(primary.hole)
    const doubleHole = pickHole(rng, blocked)
    if (doubleHole !== null) double = rollCritter(phase, doubleHole, rng)
  }

  return { primary, double, upTimeMs: upTimeMs(state), gapMs: gapMs(state) }
}
