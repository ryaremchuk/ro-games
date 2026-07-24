/**
 * Pure spawn-scheduling and adaptive-difficulty logic for Whack-a-Silly. No
 * Phaser imports — everything here is deterministic given an injected RNG
 * and is unit-tested in plain jsdom (see logic.test.ts).
 *
 * Difficulty rides an adaptive MOTOR skill meter (0..12), persisted across
 * sessions via shared/progress.ts (warm-up start below the save, doubled
 * climbs below the peak):
 * - catches (bops) in a row climb the meter; go critters escaping unbopped
 *   ease it back — no-fail, the garden slows before the child gets stuck.
 * - the meter drives HOW FAST critters pop and hide (up-time 2000ms at
 *   skill 0 down to the 1200ms hard floor — never clip a legit 4yo
 *   reaction; gap 1000ms → 600ms) and HOW MANY are up at once (1 → 2 → 3,
 *   always different species so simultaneous critters read as distinct).
 *
 * The session PHASE machine stays purely about variety unlocks: sleepers
 * (75:25 go:no-go, never two asleep at once), the golden critter, and the
 * sideways peeker.
 */

/** Injectable random source, [0, 1). Defaults to Math.random in the game. */
export type Rng = () => number

export interface Critter {
  id: string
  emoji: string
}

/**
 * Critter pool (≥ 6 designs) so the garden never looks the same for long. Each
 * id maps to a hand-picked full-body sprite (`src/games/whack-a-silly/critters/
 * <id>.png`, loaded in the scene's preload); the emoji is only a fallback/label.
 */
export const CRITTERS: readonly Critter[] = [
  { id: 'rabbit', emoji: '🐰' },
  { id: 'frog', emoji: '🐸' },
  { id: 'chick', emoji: '🐥' },
  { id: 'panda', emoji: '🐼' },
  { id: 'penguin', emoji: '🐧' },
  { id: 'owl', emoji: '🦉' },
  { id: 'pig', emoji: '🐷' },
]

export function critterById(id: string): Critter {
  const critter = CRITTERS.find((c) => c.id === id)
  if (!critter) throw new Error(`Unknown critter id: ${id}`)
  return critter
}

// The board is no longer a fixed grid: the count and positions of holes are a
// per-EPISODE variable (4..9), owned by the spatial track in episode.ts. Spawn
// planning takes the live hole count from the SpawnContext, so this module never
// assumes a shape. See episode.ts (MIN_HOLES / MAX_HOLES / generateBoard).

// ─── Timing rules (from the brief) ───────────────────────────────────────────

/** Critter up-time at skill 0… */
export const UP_TIME_START_MS = 2000
/** …and NEVER below this (clips legit 4yo reaction time). */
export const UP_TIME_HARD_FLOOR_MS = 1200
/** Gap before the next critter tops the garden up. */
export const GAP_START_MS = 1000
export const GAP_FLOOR_MS = 600

/** Go:no-go 75:25 once sleeping critters appear (phase 2+). */
export const SLEEPY_PROBABILITY = 0.25
/** Golden critter — rare celebration spawn, phase 4 only. */
export const GOLDEN_PROBABILITY = 0.05
/** Chance a critter peeks sideways from the hole edge, phase 4 only. */
export const PEEK_PROBABILITY = 0.12

// ─── Adaptive motor skill meter ──────────────────────────────────────────────

export const WHACK_SKILL_START = 0
export const WHACK_SKILL_MAX = 12

/** Consecutive catches (no escape in between) that climb the meter a step. */
export const CATCHES_TO_CLIMB = 3
/** Consecutive go-critter escapes that ease the meter a step (no-fail). */
export const ESCAPES_TO_EASE = 2

function clampSkill(value: number): number {
  return Math.min(Math.max(Math.round(value), WHACK_SKILL_START), WHACK_SKILL_MAX)
}

export interface WhackSkill {
  /** The meter 0..WHACK_SKILL_MAX — drives up-time, gap and concurrency. */
  skill: number
  /** Consecutive bops since the last escape. */
  catchStreak: number
  /** Consecutive go-critter escapes since the last bop. */
  escapeStreak: number
}

/** Fresh meter state; `skill` resumes a persisted save (clamped). */
export function initialWhackSkill(skill: number = WHACK_SKILL_START): WhackSkill {
  return { skill: clampSkill(skill), catchStreak: 0, escapeStreak: 0 }
}

/**
 * A go critter was bopped. CATCHES_TO_CLIMB in a row climb the meter one
 * step — two steps while below the saved `peak` (session warm-up, see
 * shared/progress.sessionStart).
 */
export function registerCatch(state: WhackSkill, peak: number = WHACK_SKILL_START): WhackSkill {
  const catchStreak = state.catchStreak + 1
  if (catchStreak < CATCHES_TO_CLIMB) return { ...state, catchStreak, escapeStreak: 0 }
  const step = state.skill < peak ? 2 : 1
  return { skill: clampSkill(state.skill + step), catchStreak: 0, escapeStreak: 0 }
}

/**
 * A go critter got away unbopped. ESCAPES_TO_EASE in a row ease the meter
 * one step — asymmetric by design: struggling slows the garden gently.
 */
export function registerEscape(state: WhackSkill): WhackSkill {
  const escapeStreak = state.escapeStreak + 1
  if (escapeStreak < ESCAPES_TO_EASE) return { ...state, escapeStreak, catchStreak: 0 }
  return { skill: clampSkill(state.skill - 1), catchStreak: 0, escapeStreak: 0 }
}

/** How long a critter stays up: 2000ms at skill 0 → the 1200ms hard floor. */
export function upTimeForSkill(skill: number): number {
  const t = clampSkill(skill) / WHACK_SKILL_MAX
  return Math.round(UP_TIME_START_MS - (UP_TIME_START_MS - UP_TIME_HARD_FLOOR_MS) * t)
}

/** Gap before the next pop tops the garden up, 1000ms → 600ms. */
export function gapForSkill(skill: number): number {
  const t = clampSkill(skill) / WHACK_SKILL_MAX
  return Math.round(GAP_START_MS - (GAP_START_MS - GAP_FLOOR_MS) * t)
}

/** Skill at which a second simultaneous critter joins the garden… */
export const CONCURRENT2_SKILL = 4
/** …and a third. */
export const CONCURRENT3_SKILL = 9

/** How many critters may be up at once — always different species. */
export function concurrentFor(skill: number): number {
  if (clampSkill(skill) >= CONCURRENT3_SKILL) return 3
  if (clampSkill(skill) >= CONCURRENT2_SKILL) return 2
  return 1
}

/** Every ~10 successful bops: a quick confetti burst (spawning never pauses). */
export const CONFETTI_EVERY_BOPS = 10

export function isConfettiBop(bops: number): boolean {
  return bops > 0 && bops % CONFETTI_EVERY_BOPS === 0
}

// ─── Celebration variety (pure, so the scene stays dumb) ─────────────────────

/**
 * Which of the three bop celebrations to play for the (1-based) count of the
 * bop just scored. Rotates 0 → 1 → 2 → 0 so back-to-back bops feel different;
 * golden critters override this to always launch (variant 0).
 */
export function bopVariantFor(bops: number): 0 | 1 | 2 {
  const n = Math.max(Math.floor(bops), 1)
  return ((((n - 1) % 3) + 3) % 3) as 0 | 1 | 2
}

/**
 * Rising thwack-pitch step 0..7 for the (1-based) bop count. Climbs one step per
 * bop, caps at 7, and resets every CONFETTI_EVERY_BOPS bops (aligned with the
 * confetti/level cadence) so a streak audibly builds and then restarts.
 */
export function comboStep(bops: number): number {
  const cycle = CONFETTI_EVERY_BOPS
  const inCycle = (((Math.floor(bops) - 1) % cycle) + cycle) % cycle
  return Math.min(Math.max(inCycle, 0), 7)
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
 * P1 warm-up (all go, slow) → P2 sleepers appear (25% no-go) → P3 faster +
 * occasional double-pop → P4 variety (golden critter, sideways peeker).
 * Monotonic: elapsedMs and bops only ever grow, so the phase never regresses.
 */
export function phaseFor(state: RampState): Phase {
  for (const gate of PHASE_GATES) {
    if (state.elapsedMs >= gate.timeMs || state.bops >= gate.bops) return gate.phase
  }
  return 1
}

// ─── Spawn planning ──────────────────────────────────────────────────────────

export interface CritterSpawn {
  /** Hole index 0..holeCount-1 (holeCount is the episode's live board size). */
  hole: number
  critterId: string
  /** Sleeping critter = NO-GO: the child is celebrated for NOT waking it. */
  sleepy: boolean
  /** Rare golden celebration critter (always a go — never sleeps). */
  golden: boolean
  /** Peeks sideways from the hole edge (visual variety, phase 4). */
  peek: boolean
}

export interface SpawnContext {
  /** Session phase input — variety unlocks (sleepers, golden, peeker). */
  ramp: RampState
  /** Adaptive motor meter — drives up-time, gap and concurrency. */
  skill: number
  /** The episode's live board size — holes are indexed 0..holeCount-1. */
  holeCount: number
  /** Holes currently occupied (any non-down state). */
  occupiedHoles: readonly number[]
  /** Species currently on stage — simultaneous critters are never twins. */
  activeCritterIds: readonly string[]
  /** True if a sleeper is already up — never two no-gos at once. */
  sleeperActive: boolean
  /** Previous spawn's hole (no same-hole back-to-back). */
  lastHole: number | null
}

export interface SpawnPlan {
  spawn: CritterSpawn
  /** How long this critter stays up. */
  upTimeMs: number
  /** Gap to schedule before the next top-up spawn. */
  gapMs: number
}

function pickOne<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

/** Pick a hole in [0, holeCount) avoiding the blocked set, or null if none are
 *  free. */
function pickHole(rng: Rng, blocked: ReadonlySet<number>, holeCount: number): number | null {
  const open: number[] = []
  for (let i = 0; i < holeCount; i++) {
    if (!blocked.has(i)) open.push(i)
  }
  if (open.length === 0) return null
  return pickOne(rng, open)
}

function rollCritter(phase: Phase, hole: number, ctx: SpawnContext, rng: Rng): CritterSpawn {
  const golden = phase >= 4 && rng() < GOLDEN_PROBABILITY
  const sleepy = !golden && !ctx.sleeperActive && phase >= 2 && rng() < SLEEPY_PROBABILITY
  const peek = !golden && phase >= 4 && rng() < PEEK_PROBABILITY
  // Simultaneous critters are always different species; with the full pool
  // somehow on stage (impossible today: 7 species vs 3 concurrent), relax.
  const pool = CRITTERS.filter((c) => !ctx.activeCritterIds.includes(c.id))
  const critter = pool.length > 0 ? pickOne(rng, pool) : pickOne(rng, CRITTERS)
  return { hole, critterId: critter.id, sleepy, golden, peek }
}

/**
 * Plan the next spawn: which hole, which critter, sleepy or not, and the
 * skill-driven up-time/gap. Never reuses the previous spawn's hole (no
 * same-hole back-to-back), any occupied hole, or any on-stage species.
 */
export function planSpawn(ctx: SpawnContext, rng: Rng = Math.random): SpawnPlan {
  const phase = phaseFor(ctx.ramp)
  const blocked = new Set(ctx.occupiedHoles)
  // Avoiding the last hole only makes sense when there's somewhere else to go —
  // on a tiny board (4 holes, most occupied) it would over-constrain.
  if (ctx.lastHole !== null && ctx.holeCount > 1) blocked.add(ctx.lastHole)

  // If everything is somehow blocked, relax constraints rather than stall.
  const hole =
    pickHole(rng, blocked, ctx.holeCount) ??
    pickHole(rng, new Set(ctx.occupiedHoles), ctx.holeCount) ??
    Math.floor(rng() * ctx.holeCount)

  return {
    spawn: rollCritter(phase, hole, ctx, rng),
    upTimeMs: upTimeForSkill(ctx.skill),
    gapMs: gapForSkill(ctx.skill),
  }
}
