/**
 * Whack-a-Silly's SECOND difficulty track — the board / spatial axis — as pure
 * logic (no Phaser). Runs parallel to the motor meter in logic.ts:
 *
 * - MOTOR track (logic.ts): how FAST critters pop/hide and HOW MANY are up at
 *   once. Continuous, adapts every catch/escape.
 * - SPATIAL track (here): how MANY holes there are (4..9) and WHERE they sit.
 *   Chunky + visible; re-rolled once per EPISODE. Every episode is a fresh
 *   pseudo-random, non-grid arrangement — killing the positional habit a fixed
 *   grid teaches and training the child to scan a wider field.
 *
 * An EPISODE lasts a pseudo-random 5..10 bops (= stars). At its boundary the
 * SPATIAL meter advances GENTLY (at most +1 per episode) driven by how many
 * go-critters escaped during the episode (the miss signal): a clean run adds one
 * hole, a rough one eases back — no-fail, never below the 4-hole floor. The
 * meter is a CENTER, not the literal count: each episode samples its hole count
 * from a ±1 jitter around the meter (leaning down at the ceiling) and never
 * repeats the previous episode's count, so consecutive boards never feel
 * identical — not even once the child has maxed the meter (see
 * episodeHoleCount). The meter persists via shared/progress.ts `skill.spatial`;
 * the episode counter via `data.episode`.
 *
 * The hole SIZE is deliberately NOT a variable here — the scene keeps one fixed
 * mound scale (the 3×3 size) so the child's touch target never moves; only the
 * count and the positions change between episodes.
 */

import type { Rng } from './logic'

// ─── Hole-count range ─────────────────────────────────────────────────────────

/** Easiest episode: four fat holes. */
export const MIN_HOLES = 4
/** Hardest: nine — the densest the field packs at the fixed mound size. */
export const MAX_HOLES = 9
/** Spatial meter span: 0 → MIN_HOLES, MAX_SPATIAL → MAX_HOLES. */
export const MAX_SPATIAL = MAX_HOLES - MIN_HOLES

export const SPATIAL_START = 0

export function clampSpatial(value: number): number {
  return Math.min(Math.max(Math.round(value), SPATIAL_START), MAX_SPATIAL)
}

/** Hole count for a spatial meter value — clamped to [MIN_HOLES, MAX_HOLES]. */
export function holeCountFor(spatial: number): number {
  return MIN_HOLES + clampSpatial(spatial)
}

// ─── Spatial adaptive step (gentle climb) ─────────────────────────────────────

/**
 * How the spatial meter (the hole-count CENTER) moves at an episode boundary,
 * from the go-critter escapes counted during that episode. Deliberately GENTLE:
 * a clean-ish episode nudges the center up ONE hole, and it can only ever climb
 * +1 at a time — so the board grows over many episodes (minutes of play), not
 * the ~2 it used to take. Easing is a touch faster than climbing (asymmetric,
 * no-fail): a struggling child gets the field thinned promptly.
 *
 *   0 escapes → +1   (clean — nudge the center up one)
 *   1 escape  → +1
 *   2 escapes →  0   (holding the edge)
 *   3 escapes →  0
 *   4 escapes → −1
 *   5+escapes → −2   (struggling — thin the field, no-fail)
 */
export const SPATIAL_STEP_BY_ESCAPES: readonly number[] = [1, 1, 0, 0, -1]

export function spatialDelta(escapes: number): number {
  const e = Math.max(0, Math.floor(escapes))
  return e < SPATIAL_STEP_BY_ESCAPES.length ? SPATIAL_STEP_BY_ESCAPES[e] : -2
}

/** Advance the spatial meter one episode; clamped, no-fail. */
export function advanceSpatial(spatial: number, escapes: number): number {
  return clampSpatial(clampSpatial(spatial) + spatialDelta(escapes))
}

// ─── Per-episode hole count (center + jitter) ─────────────────────────────────

/** Clamp a raw hole count into the legal [MIN_HOLES, MAX_HOLES] band. */
function clampHoles(count: number): number {
  return Math.min(MAX_HOLES, Math.max(MIN_HOLES, Math.round(count)))
}

/**
 * The number of holes THIS episode actually shows. The spatial meter is only
 * the adaptive CENTER; the real count breathes ±1 around it so consecutive
 * episodes never feel identical — the fix for the old "climb to nine then hold
 * at nine forever" monotony.
 *
 * - `0` is weighted (twice in the offset bag) so the meter's own value stays the
 *   most likely count — the board still tracks the child's edge.
 * - Near the ceiling the jitter leans DOWN (−2/−1/0), so the densest board is an
 *   occasional spike, not the steady state.
 * - `prevCount` (the previous episode's count) is dropped from the pool whenever
 *   an alternative exists, guaranteeing "never the same count twice in a row".
 *
 * Deterministic for a given RNG, so a seeded test can pin the sequence.
 */
export function episodeHoleCount(
  spatial: number,
  prevCount: number | null = null,
  rng: Rng = Math.random,
): number {
  const center = holeCountFor(spatial)
  const offsets = center >= MAX_HOLES ? [0, 0, -1, -2] : [0, 0, -1, 1]
  const counts = offsets.map((o) => clampHoles(center + o))
  // Weighting is preserved among the survivors when we drop the repeat.
  const pool =
    prevCount !== null && counts.some((c) => c !== prevCount)
      ? counts.filter((c) => c !== prevCount)
      : counts
  return pool[Math.floor(rng() * pool.length)]
}

// ─── Episode length ────────────────────────────────────────────────────────────

/** An episode runs this many bops (= stars) before the board re-rolls. */
export const EPISODE_MIN_BOPS = 5
export const EPISODE_MAX_BOPS = 10

/** Pseudo-random episode length in [EPISODE_MIN_BOPS, EPISODE_MAX_BOPS]. */
export function episodeLength(rng: Rng = Math.random): number {
  const span = EPISODE_MAX_BOPS - EPISODE_MIN_BOPS + 1
  return EPISODE_MIN_BOPS + Math.floor(rng() * span)
}

// ─── Board generation (non-grid, non-overlapping) ─────────────────────────────

/** A hole position, normalized to the safe play region ([0,1] on each axis;
 *  the scene has already inset the region by the mound's margins, so a center
 *  anywhere in the unit square keeps the whole mound on-screen). */
export interface Spot {
  x: number
  y: number
}

export interface BoardOptions {
  /**
   * Minimum center-to-center separation, normalized per axis — the mound's
   * footprint (width for X, height for Y) as a fraction of the region. Two
   * holes clear each other when they differ by at least this on EITHER axis
   * (axis-aligned footprint test), so the mounds never visually overlap.
   */
  minDistX: number
  minDistY: number
  /** Dart-throwing attempts per hole before falling back to the lattice. */
  maxTries?: number
}

/** True if `p` clears every already-placed hole (footprint-rectangle test). */
function fits(p: Spot, placed: readonly Spot[], minDistX: number, minDistY: number): boolean {
  for (const q of placed) {
    if (Math.abs(p.x - q.x) < minDistX && Math.abs(p.y - q.y) < minDistY) return false
  }
  return true
}

/**
 * Scatter `count` holes freely by dart-throwing (reject-if-too-close). Returns
 * null if it can't place them all within the try budget — the caller then uses
 * the guaranteed lattice. Great for the common sparse boards (4–6 holes), where
 * it reads as genuinely random rather than a jittered grid.
 */
function dartThrow(
  count: number,
  minDistX: number,
  minDistY: number,
  maxTries: number,
  rng: Rng,
): Spot[] | null {
  const placed: Spot[] = []
  for (let i = 0; i < count; i++) {
    let ok = false
    for (let t = 0; t < maxTries; t++) {
      const p = { x: rng(), y: rng() }
      if (fits(p, placed, minDistX, minDistY)) {
        placed.push(p)
        ok = true
        break
      }
    }
    if (!ok) return null
  }
  return placed
}

/** Fisher–Yates over [0, n) using the injected RNG (deterministic). */
function shuffledIndices(n: number, rng: Rng): number[] {
  const a = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const JITTER_SAFETY = 0.9

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Guaranteed placement: the densest grid the footprints allow, spread edge-to
 * -edge across the region (rows/cols at r/(rows-1), so `floor(1/minDist)+1` fit
 * per axis — matching what dart-throwing could reach, not the more timid
 * even-slot count). `count` holes drop into distinct RANDOM cells and jitter
 * within the slack; random choice + jitter keep it from reading as a rigid grid
 * whenever the count is below capacity (the common case). Only a maxed board
 * (e.g. 9 into a 3×3) is forced grid-like — where no non-overlapping arrangement
 * could look otherwise. Runs only when free dart-throwing gives up.
 */
function jitteredLattice(count: number, minDistX: number, minDistY: number, rng: Rng): Spot[] {
  let mx = Math.max(minDistX, 1e-4)
  let my = Math.max(minDistY, 1e-4)
  let cols = Math.max(1, Math.floor(1 / mx) + 1)
  let rows = Math.max(1, Math.floor(1 / my) + 1)
  // Defensive: if the footprints genuinely can't hold `count`, shrink them just
  // enough to fit (the scene sizes them so this never triggers in practice).
  while (cols * rows < count) {
    mx *= 0.9
    my *= 0.9
    cols = Math.max(1, Math.floor(1 / mx) + 1)
    rows = Math.max(1, Math.floor(1 / my) + 1)
  }

  const spanX = cols > 1 ? 1 / (cols - 1) : 0
  const spanY = rows > 1 ? 1 / (rows - 1) : 0
  // Slack between the row/col spacing and the footprint — the jitter budget.
  // JITTER_SAFETY holds a hair back so neighbours keep a visible gap (and never
  // graze the minDist boundary through floating-point rounding). clamp01 keeps
  // edge holes on-region (only ever shrinking an outward push, never a gap).
  const jitterX = Math.max(0, (spanX - mx) / 2) * JITTER_SAFETY
  const jitterY = Math.max(0, (spanY - my) / 2) * JITTER_SAFETY

  const cells = shuffledIndices(cols * rows, rng).slice(0, count)
  return cells.map((cell) => {
    const c = cell % cols
    const r = Math.floor(cell / cols)
    const baseX = cols > 1 ? c / (cols - 1) : 0.5
    const baseY = rows > 1 ? r / (rows - 1) : 0.5
    return {
      x: clamp01(baseX + (rng() * 2 - 1) * jitterX),
      y: clamp01(baseY + (rng() * 2 - 1) * jitterY),
    }
  })
}

/**
 * Generate an episode's board: `count` non-overlapping hole positions in the
 * normalized safe region. Tries free dart-throwing first (organic scatter),
 * then falls back to a jittered lattice that ALWAYS succeeds. Deterministic for
 * a given RNG, so a seeded test can pin an exact board.
 */
export function generateBoard(
  count: number,
  options: BoardOptions,
  rng: Rng = Math.random,
): Spot[] {
  const { minDistX, minDistY, maxTries = 30 } = options
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []
  const scattered = dartThrow(n, minDistX, minDistY, maxTries, rng)
  return scattered ?? jitteredLattice(n, minDistX, minDistY, rng)
}
