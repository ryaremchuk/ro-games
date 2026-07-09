/**
 * Pure round-generation and balloon-spawn logic for Balloon Pop. No Phaser
 * imports — everything here is deterministic given an injected RNG and is
 * unit-tested in plain jsdom (see logic.test.ts).
 *
 * Numbers come from the subitizing research brief: targets 1-3 first (the
 * instant-subitizing range at age 4), then 4, then 5 as a late stretch;
 * dice/line dot layouts are easy, scatter is hard (late only); distractors
 * start ±2 away (easy discrimination) and tighten to ±1 (the real
 * subitizing test); numeral-only balloons appear late to build the
 * numeral↔quantity link. 3-4 balloons concurrent, never clutter, and at
 * least one matching balloon is planned on screen at all times.
 */

/** Injectable random source, [0, 1). Defaults to Math.random in the game. */
export type Rng = () => number

// ─── Balloon colors (ART SPEC palette) ───────────────────────────────────────

/** Coral, sunshine, mint, purple, pink, teal — dots stay ink-on-white. */
export const BALLOON_COLORS = [
  '#FF6B6B',
  '#FFD93D',
  '#6BCB77',
  '#9B5DE5',
  '#FF8FAB',
  '#4ECDC4',
] as const

/** Cycle balloon colors without ever repeating the previous balloon's color. */
export function nextColorIndex(lastIndex: number | null, rng: Rng): number {
  if (lastIndex === null) return Math.floor(rng() * BALLOON_COLORS.length)
  const step = 1 + Math.floor(rng() * (BALLOON_COLORS.length - 1))
  return (lastIndex + step) % BALLOON_COLORS.length
}

// ─── Stage / difficulty progression ──────────────────────────────────────────

export type Stage = 1 | 2 | 3 | 4

/** Rounds completed before 4 joins the target pool. */
export const STAGE2_ROUNDS = 3
/** Rounds completed before 5 (stretch) and scatter layouts join. */
export const STAGE3_ROUNDS = 7
/** Rounds completed before numeral-only balloon rounds may appear. */
export const STAGE4_ROUNDS = 11

/**
 * S1: targets 1-3, dice/line layouts, distractors ±2 →
 * S2: 4 joins → S3: 5 (stretch) + scatter layouts + distractors tighten
 * to ±1 → S4: numeral-only balloon rounds mix in. Monotonic in rounds.
 */
export function stageFor(roundsCompleted: number): Stage {
  if (roundsCompleted >= STAGE4_ROUNDS) return 4
  if (roundsCompleted >= STAGE3_ROUNDS) return 3
  if (roundsCompleted >= STAGE2_ROUNDS) return 2
  return 1
}

export const MIN_TARGET = 1

/** Largest quantity the crab may ask for at a given stage. */
export function maxTargetFor(stage: Stage): number {
  if (stage === 1) return 3
  if (stage === 2) return 4
  return 5
}

/** Dot layouts exist for 1..6, so distractor values never exceed 6. */
export const MAX_BALLOON_VALUE = 6

/**
 * How far distractor quantities sit from the target: early stages ±2..3
 * (easy discrimination), later ±1..2 (off-by-one is the real test).
 */
export function distractorDistanceRange(stage: Stage): { min: number; max: number } {
  return stage <= 2 ? { min: 2, max: 3 } : { min: 1, max: 2 }
}

/** All quantities a wrong balloon may carry for this target and stage. */
export function distractorValues(target: number, stage: Stage): number[] {
  const { min, max } = distractorDistanceRange(stage)
  const values: number[] = []
  for (let value = 1; value <= MAX_BALLOON_VALUE; value++) {
    const distance = Math.abs(value - target)
    if (distance >= min && distance <= max) values.push(value)
  }
  return values
}

// ─── Round planning ──────────────────────────────────────────────────────────

/** Chance a stage-4 round shows numerals on balloons instead of dots. */
export const NUMERAL_ROUND_PROBABILITY = 0.5

/** Concurrent balloons afloat: 3 during warm-up, 4 afterwards. */
export function concurrentBalloonsFor(stage: Stage): number {
  return stage === 1 ? 3 : 4
}

export interface RoundPlan {
  /** Quantity the crab's sign asks for (1..5). */
  target: number
  /** Balloons carry numerals instead of dot patterns (stage 4 only). */
  numeralRound: boolean
  /** How many balloons float at once this round (3-4). */
  concurrent: number
  /** Quantities wrong balloons may carry this round. */
  distractors: readonly number[]
}

/**
 * Plan the next round. The first three rounds scaffold 1 → 2 → 3 in order;
 * afterwards the target is drawn from the stage's range, never repeating
 * the previous round's target back-to-back.
 */
export function planRound(
  roundsCompleted: number,
  prevTarget: number | null,
  rng: Rng = Math.random,
): RoundPlan {
  const stage = stageFor(roundsCompleted)

  let target: number
  if (roundsCompleted < STAGE2_ROUNDS) {
    target = roundsCompleted + 1 // scaffold: 1, 2, 3
  } else {
    const pool: number[] = []
    for (let value = MIN_TARGET; value <= maxTargetFor(stage); value++) {
      if (value !== prevTarget) pool.push(value)
    }
    target = pool[Math.floor(rng() * pool.length)]
  }

  return {
    target,
    numeralRound: stage >= 4 && rng() < NUMERAL_ROUND_PROBABILITY,
    concurrent: concurrentBalloonsFor(stage),
    distractors: distractorValues(target, stage),
  }
}

// ─── Speed ramp (slow floats, gentle increase) ───────────────────────────────

/** Rise speed of a fresh player's balloons, css px per second. */
export const RISE_SPEED_START = 30
/** Speed ceiling — still a lazy float, never frantic. */
export const RISE_SPEED_MAX = 55
/** Rounds until the ceiling is reached. */
export const RISE_RAMP_ROUNDS = 14
/** Per-balloon speed jitter, ±fraction of the base speed. */
export const RISE_JITTER = 0.15

/** Base rise speed for a given progress point — monotonic, clamped. */
export function baseRiseSpeed(roundsCompleted: number): number {
  const t = Math.min(Math.max(roundsCompleted, 0) / RISE_RAMP_ROUNDS, 1)
  return RISE_SPEED_START + (RISE_SPEED_MAX - RISE_SPEED_START) * t
}

// ─── Balloon spawn planning ──────────────────────────────────────────────────

export type BalloonKind = 'dots' | 'numeral'
export type DotLayoutKind = 'dice' | 'line' | 'scatter'

export interface BalloonSpec {
  /** Quantity (dot count) or numeral this balloon carries. */
  value: number
  /** True if popping this balloon completes the round. */
  isMatch: boolean
  kind: BalloonKind
  /** Dot arrangement (ignored for numeral balloons). */
  layout: DotLayoutKind
  /** Index into BALLOON_COLORS. */
  colorIndex: number
  /** Rise speed, css px per second. */
  speedCss: number
  /** Horizontal sway amplitude, css px. */
  swayAmpCss: number
  /** Sway period, ms. */
  swayPeriodMs: number
  /** Spawn x as a fraction of screen width. */
  xFrac: number
}

/** Cap on simultaneous matching balloons (keeps the search meaningful). */
export const MAX_MATCHES_ON_SCREEN = 2
/** Chance a non-forced spawn is a match. */
export const MATCH_PROBABILITY = 0.35
/** Chance a stage-3+ dots balloon uses the hard scatter layout. */
export const SCATTER_PROBABILITY = 0.35
/** Chance a dots balloon uses a line layout instead of dice. */
export const LINE_PROBABILITY = 0.35

export interface SpawnContext {
  round: RoundPlan
  roundsCompleted: number
  /** Matching balloons currently afloat (or already planned). */
  activeMatchCount: number
  /** x fractions of balloons currently afloat, for horizontal spacing. */
  activeXFracs: readonly number[]
  /** Color of the most recently spawned balloon (no immediate repeats). */
  lastColorIndex: number | null
}

function pickLayout(stage: Stage, rng: Rng): DotLayoutKind {
  if (stage >= 3 && rng() < SCATTER_PROBABILITY) return 'scatter'
  return rng() < LINE_PROBABILITY ? 'line' : 'dice'
}

/** Try to keep new balloons horizontally clear of the ones already afloat. */
function pickXFrac(activeXFracs: readonly number[], rng: Rng): number {
  let candidate = 0.5
  for (let attempt = 0; attempt < 8; attempt++) {
    candidate = 0.12 + rng() * 0.76
    if (activeXFracs.every((x) => Math.abs(x - candidate) >= 0.16)) return candidate
  }
  return candidate
}

/**
 * Plan one balloon. CRITICAL invariant: if no matching balloon is afloat,
 * the planned balloon IS a match — so the target is always reachable.
 */
export function planBalloon(ctx: SpawnContext, rng: Rng = Math.random): BalloonSpec {
  const stage = stageFor(ctx.roundsCompleted)
  const { round } = ctx

  const isMatch =
    ctx.activeMatchCount === 0 ||
    round.distractors.length === 0 ||
    (ctx.activeMatchCount < MAX_MATCHES_ON_SCREEN && rng() < MATCH_PROBABILITY)
  const value = isMatch
    ? round.target
    : round.distractors[Math.floor(rng() * round.distractors.length)]

  const jitter = 1 - RISE_JITTER + rng() * 2 * RISE_JITTER
  return {
    value,
    isMatch,
    kind: round.numeralRound ? 'numeral' : 'dots',
    layout: pickLayout(stage, rng),
    colorIndex: nextColorIndex(ctx.lastColorIndex, rng),
    speedCss: baseRiseSpeed(ctx.roundsCompleted) * jitter,
    swayAmpCss: 10 + rng() * 14,
    swayPeriodMs: 1800 + rng() * 1400,
    xFrac: pickXFrac(ctx.activeXFracs, rng),
  }
}

/** Plan a round's opening wave — always contains at least one match. */
export function planInitialWave(
  round: RoundPlan,
  roundsCompleted: number,
  rng: Rng = Math.random,
  lastColorIndex: number | null = null,
): BalloonSpec[] {
  const specs: BalloonSpec[] = []
  let matches = 0
  let lastColor = lastColorIndex
  const xs: number[] = []
  for (let i = 0; i < round.concurrent; i++) {
    const spec = planBalloon(
      {
        round,
        roundsCompleted,
        activeMatchCount: matches,
        activeXFracs: xs,
        lastColorIndex: lastColor,
      },
      rng,
    )
    specs.push(spec)
    if (spec.isMatch) matches++
    xs.push(spec.xFrac)
    lastColor = spec.colorIndex
  }
  return specs
}

// ─── Dot layouts (unit coordinates, disc radius = 1) ─────────────────────────

export interface DotPoint {
  x: number
  y: number
}

/**
 * Canonical dice patterns for 1-6. Unit coordinates: every dot center fits
 * within radius ~0.75 so dots (radius ~0.15) stay inside the white disc.
 */
export const DICE_LAYOUTS: Readonly<Record<number, readonly DotPoint[]>> = {
  1: [{ x: 0, y: 0 }],
  2: [
    { x: -0.42, y: 0.42 },
    { x: 0.42, y: -0.42 },
  ],
  3: [
    { x: -0.5, y: 0.5 },
    { x: 0, y: 0 },
    { x: 0.5, y: -0.5 },
  ],
  4: [
    { x: -0.42, y: -0.42 },
    { x: 0.42, y: -0.42 },
    { x: -0.42, y: 0.42 },
    { x: 0.42, y: 0.42 },
  ],
  5: [
    { x: -0.42, y: -0.42 },
    { x: 0.42, y: -0.42 },
    { x: 0, y: 0 },
    { x: -0.42, y: 0.42 },
    { x: 0.42, y: 0.42 },
  ],
  6: [
    { x: -0.42, y: -0.52 },
    { x: -0.42, y: 0 },
    { x: -0.42, y: 0.52 },
    { x: 0.42, y: -0.52 },
    { x: 0.42, y: 0 },
    { x: 0.42, y: 0.52 },
  ],
}

function linePositions(count: number): DotPoint[] {
  if (count === 1) return [{ x: 0, y: 0 }]
  const span = 1.3
  const step = span / (count - 1)
  return Array.from({ length: count }, (_, i) => ({ x: -span / 2 + step * i, y: 0 }))
}

function scatterPositions(count: number, rng: Rng): DotPoint[] {
  let minDist = 0.55
  for (let relax = 0; relax < 14; relax++) {
    const points: DotPoint[] = []
    let failed = false
    for (let i = 0; i < count && !failed; i++) {
      let placed = false
      for (let attempt = 0; attempt < 40; attempt++) {
        const angle = rng() * Math.PI * 2
        const radius = Math.sqrt(rng()) * 0.68
        const p = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
        if (points.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= minDist)) {
          points.push(p)
          placed = true
          break
        }
      }
      if (!placed) failed = true
    }
    if (!failed) return points
    minDist *= 0.85
  }
  // Pathological RNG fallback: a nudged dice layout still reads as scattered.
  return DICE_LAYOUTS[count].map((p) => ({ x: p.x * 0.9, y: p.y * 0.9 }))
}

/**
 * Dot centers for a count and layout, in unit disc coordinates. Dice and
 * line are deterministic; scatter uses the injected RNG.
 */
export function dotPositions(
  count: number,
  layout: DotLayoutKind,
  rng: Rng = Math.random,
): DotPoint[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_BALLOON_VALUE) {
    throw new Error(`No dot layout for count ${count}`)
  }
  if (layout === 'dice') return [...DICE_LAYOUTS[count]]
  if (layout === 'line') return linePositions(count)
  return scatterPositions(count, rng)
}

// ─── Hints & celebrations ────────────────────────────────────────────────────

/** After this many wrong taps in a round, matching balloons start to glow. */
export const WRONG_TAPS_BEFORE_HINT = 2

export function shouldShowHint(wrongTaps: number): boolean {
  return wrongTaps >= WRONG_TAPS_BEFORE_HINT
}

/** Every 5 correct rounds: rainbow-and-stars sky celebration. */
export const CELEBRATION_EVERY_ROUNDS = 5

export function isSkyCelebration(roundsCompleted: number): boolean {
  return roundsCompleted > 0 && roundsCompleted % CELEBRATION_EVERY_ROUNDS === 0
}
