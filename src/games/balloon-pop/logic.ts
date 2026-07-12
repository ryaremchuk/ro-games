/**
 * Pure round-generation and balloon-spawn logic for Balloon Pop. No Phaser
 * imports — everything here is deterministic given an injected RNG and is
 * unit-tested in plain jsdom (see logic.test.ts).
 *
 * ── Curriculum (adaptive) ────────────────────────────────────────────────────
 *
 * Numbers come from the subitizing research brief: targets 1-3 first (the
 * instant-subitizing range at age 4), then 4, then 5 as a late stretch;
 * dice/line dot layouts are easy, scatter is hard (late only); distractors
 * start ±2 away (easy discrimination) and tighten to ±1 (the real subitizing
 * test); numeral balloons appear later to build the numeral↔quantity link.
 *
 * Progression is driven by an adaptive DIFFICULTY meter (0..12), not by raw
 * round count: a clean, quick round nudges it up one step, a round that
 * needed the glow hint eases it down one step, everything else holds. The
 * child therefore always plays at the edge of their ability — a struggling
 * player stays in the friendly zone, a flying one reaches variety sooner.
 * Difficulty maps onto every knob: target range, distractor tightness, dot
 * layouts, rise speed, concurrent balloons, and which TASK TYPES are in the
 * rotation.
 *
 * Task types live in a small registry (TASKS). Each unlocks at a difficulty
 * threshold and is picked per-round by weight, never repeating more than
 * MAX_TASK_REPEAT times in a row once alternatives exist — so long sessions
 * keep alternating between counting dots, reading numerals, translating
 * between the two, and matching quantity+color.
 *
 * Rhythm: the first three rounds scaffold 1 → 2 → 3 on plain dots, and every
 * CELEBRATION_EVERY_ROUNDS correct rounds a rainbow celebration marks a new
 * HUD level — a steady reward beat independent of the adaptive meter.
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

// ─── Balloon shapes (cosmetic container variety) ─────────────────────────────

/**
 * The balloon silhouette that carries the counting disc. PURELY cosmetic: the
 * white dot-disc, its dots/numeral, and the hit target are identical on every
 * shape, so counting readability is untouched. This only keeps the container
 * from going stale over a long session (the "20 rounds and the balloon is
 * boring" problem) — variety comes from shape × color, not from the number art.
 */
export type BalloonShapeKind = 'classic' | 'round' | 'wide' | 'squircle' | 'egg' | 'star'

export const BALLOON_SHAPES: readonly BalloonShapeKind[] = [
  'classic',
  'round',
  'wide',
  'squircle',
  'egg',
  'star',
]

// ─── Adaptive difficulty meter ───────────────────────────────────────────────

export const DIFFICULTY_START = 0
export const DIFFICULTY_MAX = 12

/**
 * A correct round faster than this (and with no wrong taps) counts as "clean"
 * and nudges difficulty up. Generous on purpose: the timer starts when the
 * sign appears, and a matching balloon may take a while to float within reach.
 */
export const FAST_ROUND_MS = 20_000

/** What the scene reports after every completed round. */
export interface RoundResult {
  /** Wrong balloons tapped before the match was popped. */
  wrongTaps: number
  /** Time from round start to the correct pop, ms. */
  ms: number
}

/**
 * One adaptive step per round, never more (|Δ| ≤ 1, clamped to 0..MAX):
 * clean & quick → +1; needed the glow hint (≥ WRONG_TAPS_BEFORE_HINT wrong
 * taps) → −1; everything else (one slip, or correct but slow) holds steady.
 * Asymmetry is deliberate — no-fail design means struggling eases the game
 * gently rather than punishing.
 */
export function updateDifficulty(difficulty: number, result: RoundResult): number {
  const d = Math.min(Math.max(Math.round(difficulty), 0), DIFFICULTY_MAX)
  if (result.wrongTaps >= WRONG_TAPS_BEFORE_HINT) return Math.max(0, d - 1)
  if (result.wrongTaps > 0) return d
  if (result.ms > FAST_ROUND_MS) return d
  return Math.min(DIFFICULTY_MAX, d + 1)
}

// ─── Stage bands (difficulty → knob presets) ─────────────────────────────────

export type Stage = 1 | 2 | 3 | 4

/** Difficulty at which 4 joins the target pool. */
export const STAGE2_DIFFICULTY = 3
/** Difficulty at which 5 (stretch) and scatter layouts join. */
export const STAGE3_DIFFICULTY = 6
/** Difficulty of the hardest band. */
export const STAGE4_DIFFICULTY = 9

/**
 * S1: targets 1-3, dice/line layouts, distractors ±2..3 →
 * S2: 4 joins, 4 concurrent balloons → S3: 5 (stretch) + scatter layouts +
 * distractors tighten to ±1..2 → S4: everything at full stretch. Monotonic
 * in difficulty; difficulty itself moves both ways (adaptive).
 */
export function stageFor(difficulty: number): Stage {
  if (difficulty >= STAGE4_DIFFICULTY) return 4
  if (difficulty >= STAGE3_DIFFICULTY) return 3
  if (difficulty >= STAGE2_DIFFICULTY) return 2
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

// ─── Levels (one per rainbow — steady reward rhythm) ─────────────────────────

/** Every 5 correct rounds: rainbow-and-stars sky celebration. */
export const CELEBRATION_EVERY_ROUNDS = 5

/**
 * 1-based level shown on the HUD badge. A level is passed exactly when its
 * rainbow celebration has flown — every CELEBRATION_EVERY_ROUNDS rounds.
 * Levels are a REWARD rhythm (rounds completed), deliberately independent of
 * the adaptive difficulty meter: the badge always moves forward.
 */
export function levelFor(roundsCompleted: number): number {
  return Math.floor(roundsCompleted / CELEBRATION_EVERY_ROUNDS) + 1
}

// ─── Task registry ───────────────────────────────────────────────────────────

export type BalloonKind = 'dots' | 'numeral'

export type TaskId = 'count-dots' | 'count-numerals' | 'cross-rep' | 'color-count'

export interface TaskDef {
  id: TaskId
  /** Difficulty at which this task joins the rotation. */
  minDifficulty: number
  /** Relative pick weight once unlocked. */
  weight: number
}

/**
 * The task rotation. Order = unlock order:
 * - count-dots: sign shows dots, balloons carry dots (the baseline skill).
 * - count-numerals: numerals on both — builds numeral recognition.
 * - cross-rep: sign asks in one representation, balloons answer in the other —
 *   the child translates dots ↔ numeral.
 * - color-count: the match must show the right quantity AND wear the asked-for
 *   color (two constraints at once; stays on dots for readability).
 * Adding a task type = one entry here + a branch in planRound.
 */
export const TASKS: readonly TaskDef[] = [
  { id: 'count-dots', minDifficulty: 0, weight: 4 },
  { id: 'count-numerals', minDifficulty: 5, weight: 2 },
  { id: 'cross-rep', minDifficulty: 8, weight: 2 },
  { id: 'color-count', minDifficulty: 10, weight: 2 },
]

/** A task never runs more than this many rounds in a row (once others exist). */
export const MAX_TASK_REPEAT = 2

/** First rounds scaffold 1 → 2 → 3 on plain dots regardless of the picker. */
export const SCAFFOLD_ROUNDS = 3

/** Tasks available at a difficulty, in registry order. */
export function unlockedTasks(difficulty: number): TaskDef[] {
  return TASKS.filter((task) => difficulty >= task.minDifficulty)
}

/**
 * Pick the next round's task: weighted draw from the unlocked pool, excluding
 * a task that has already run MAX_TASK_REPEAT times in a row — variety is the
 * point of the registry. With only one task unlocked, repeats are allowed.
 */
export function pickTask(difficulty: number, recent: readonly TaskId[], rng: Rng): TaskId {
  let pool = unlockedTasks(difficulty)
  if (pool.length > 1 && recent.length >= MAX_TASK_REPEAT) {
    const last = recent[recent.length - 1]
    const ranOut = recent.slice(-MAX_TASK_REPEAT).every((id) => id === last)
    if (ranOut) pool = pool.filter((task) => task.id !== last)
  }
  const total = pool.reduce((sum, task) => sum + task.weight, 0)
  let roll = rng() * total
  for (const task of pool) {
    roll -= task.weight
    if (roll < 0) return task.id
  }
  return pool[pool.length - 1].id
}

// ─── Round planning ──────────────────────────────────────────────────────────

export interface RoundPlan {
  /** Which registry task this round runs. */
  taskId: TaskId
  /** Quantity the crab's sign asks for (1..5). */
  target: number
  /** The ONE representation the sign shows (dots-only or numeral-only). */
  promptKind: BalloonKind
  /** Representation balloons carry — differs from promptKind in cross rounds. */
  balloonKind: BalloonKind
  /** Color the match must also have (color-count rounds), else null. */
  targetColorIndex: number | null
  /** How many balloons float at once this round (3-4). */
  concurrent: number
  /** Quantities wrong balloons may carry this round. */
  distractors: readonly number[]
}

export interface PlanRoundInput {
  /** Adaptive difficulty meter, 0..DIFFICULTY_MAX. */
  difficulty: number
  /** Total correct rounds so far — drives the scaffold and celebrations. */
  roundsCompleted: number
  /** Previous round's target (never repeated back-to-back). */
  prevTarget: number | null
  /** Task chosen by pickTask (overridden to count-dots during the scaffold). */
  taskId: TaskId
}

/**
 * Plan the next round. The first SCAFFOLD_ROUNDS rounds scaffold 1 → 2 → 3 on
 * plain dots; afterwards the target is drawn from the stage's range, never
 * repeating the previous round's target back-to-back, and the task shapes the
 * representations.
 */
export function planRound(input: PlanRoundInput, rng: Rng = Math.random): RoundPlan {
  const { difficulty, roundsCompleted, prevTarget } = input
  const stage = stageFor(difficulty)
  const scaffolding = roundsCompleted < SCAFFOLD_ROUNDS
  const taskId: TaskId = scaffolding ? 'count-dots' : input.taskId

  let target: number
  if (scaffolding) {
    target = roundsCompleted + 1 // scaffold: 1, 2, 3
  } else {
    const pool: number[] = []
    for (let value = MIN_TARGET; value <= maxTargetFor(stage); value++) {
      if (value !== prevTarget) pool.push(value)
    }
    target = pool[Math.floor(rng() * pool.length)]
  }

  let promptKind: BalloonKind = 'dots'
  let balloonKind: BalloonKind = 'dots'
  let targetColorIndex: number | null = null
  switch (taskId) {
    case 'count-numerals':
      promptKind = 'numeral'
      balloonKind = 'numeral'
      break
    case 'cross-rep':
      balloonKind = rng() < 0.5 ? 'numeral' : 'dots'
      promptKind = balloonKind === 'numeral' ? 'dots' : 'numeral'
      break
    case 'color-count':
      // Dots on both sides — the color constraint is the added load here.
      targetColorIndex = Math.floor(rng() * BALLOON_COLORS.length)
      break
    case 'count-dots':
      break
  }

  return {
    taskId,
    target,
    promptKind,
    balloonKind,
    targetColorIndex,
    concurrent: concurrentBalloonsFor(stage),
    distractors: distractorValues(target, stage),
  }
}

/** Concurrent balloons afloat: 3 during warm-up, 4 afterwards. */
export function concurrentBalloonsFor(stage: Stage): number {
  return stage === 1 ? 3 : 4
}

// ─── Speed ramp (slow floats, gentle increase) ───────────────────────────────

/** Rise speed at difficulty 0, css px per second. */
export const RISE_SPEED_START = 30
/** Speed ceiling — still a lazy float, never frantic. */
export const RISE_SPEED_MAX = 55

/** Per-balloon speed jitter, ±fraction of the base speed. */
export const RISE_JITTER = 0.15

/**
 * Base rise speed for a difficulty — monotonic, clamped. Rides the adaptive
 * meter, so a struggling player's sky literally slows back down.
 */
export function baseRiseSpeed(difficulty: number): number {
  const t = Math.min(Math.max(difficulty, 0) / DIFFICULTY_MAX, 1)
  return RISE_SPEED_START + (RISE_SPEED_MAX - RISE_SPEED_START) * t
}

// ─── Balloon spawn planning ──────────────────────────────────────────────────

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
  /** Index into BALLOON_SHAPES — cosmetic silhouette, no gameplay effect. */
  shapeIndex: number
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
/** Chance a wrong balloon in a color round shows the right number in a wrong color. */
export const WRONG_COLOR_DECOY_PROBABILITY = 0.5

/** Any palette color except the target's, for right-number-wrong-color decoys. */
export function wrongColorIndex(targetColorIndex: number, rng: Rng): number {
  const step = 1 + Math.floor(rng() * (BALLOON_COLORS.length - 1))
  return (targetColorIndex + step) % BALLOON_COLORS.length
}
/** Chance a stage-3+ dots balloon uses the hard scatter layout. */
export const SCATTER_PROBABILITY = 0.35
/** Chance a dots balloon uses a line layout instead of dice. */
export const LINE_PROBABILITY = 0.35

export interface SpawnContext {
  round: RoundPlan
  /** Adaptive difficulty meter (drives layouts and speed). */
  difficulty: number
  /** Matching balloons currently afloat (or already planned). */
  activeMatchCount: number
  /** x fractions of balloons currently afloat, for horizontal spacing. */
  activeXFracs: readonly number[]
  /** Color of the most recently spawned balloon (no immediate repeats). */
  lastColorIndex: number | null
  /** A match is already scheduled to spawn later this wave — don't force one. */
  matchPlanned?: boolean
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
 * Plan one balloon. CRITICAL invariant: if no matching balloon is afloat
 * (and none is scheduled via matchPlanned), the planned balloon IS a match —
 * so the target is always reachable.
 */
export function planBalloon(ctx: SpawnContext, rng: Rng = Math.random): BalloonSpec {
  const stage = stageFor(ctx.difficulty)
  const { round } = ctx

  const mustMatch = ctx.activeMatchCount === 0 && !ctx.matchPlanned
  const isMatch =
    mustMatch ||
    round.distractors.length === 0 ||
    (ctx.activeMatchCount < MAX_MATCHES_ON_SCREEN && rng() < MATCH_PROBABILITY)

  let value: number
  let colorIndex: number
  if (isMatch) {
    value = round.target
    // Color rounds pin the match to the asked-for color (may repeat the
    // previous balloon's color — correctness beats variety here).
    colorIndex = round.targetColorIndex ?? nextColorIndex(ctx.lastColorIndex, rng)
  } else if (round.targetColorIndex !== null && rng() < WRONG_COLOR_DECOY_PROBABILITY) {
    // Right quantity, wrong color — makes the color half of the task real.
    value = round.target
    colorIndex = wrongColorIndex(round.targetColorIndex, rng)
  } else {
    value = round.distractors[Math.floor(rng() * round.distractors.length)]
    colorIndex = nextColorIndex(ctx.lastColorIndex, rng)
  }

  const jitter = 1 - RISE_JITTER + rng() * 2 * RISE_JITTER
  return {
    value,
    isMatch,
    kind: round.balloonKind,
    layout: pickLayout(stage, rng),
    colorIndex,
    speedCss: baseRiseSpeed(ctx.difficulty) * jitter,
    swayAmpCss: 10 + rng() * 14,
    swayPeriodMs: 1800 + rng() * 1400,
    xFrac: pickXFrac(ctx.activeXFracs, rng),
    // Cosmetic only, and drawn LAST so it doesn't perturb the rng stream that
    // the fields above (and the invariant tests) depend on.
    shapeIndex: Math.floor(rng() * BALLOON_SHAPES.length),
  }
}

/**
 * Plan a round's opening wave — always contains at least one match, but at a
 * random position, so the first balloon isn't reliably the answer.
 */
export function planInitialWave(
  round: RoundPlan,
  difficulty: number,
  rng: Rng = Math.random,
  lastColorIndex: number | null = null,
): BalloonSpec[] {
  const specs: BalloonSpec[] = []
  let matches = 0
  let lastColor = lastColorIndex
  const xs: number[] = []
  const forcedMatchIndex = Math.floor(rng() * round.concurrent)
  for (let i = 0; i < round.concurrent; i++) {
    const spec = planBalloon(
      {
        round,
        difficulty,
        activeMatchCount: matches,
        activeXFracs: xs,
        lastColorIndex: lastColor,
        matchPlanned: i < forcedMatchIndex,
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

/** Rainbow-and-stars sky celebration — fires exactly when a level is passed. */
export function isSkyCelebration(roundsCompleted: number): boolean {
  return roundsCompleted > 0 && roundsCompleted % CELEBRATION_EVERY_ROUNDS === 0
}
