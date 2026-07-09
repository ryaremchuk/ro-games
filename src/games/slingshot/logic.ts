/**
 * Pure level-generation and physics-tuning logic for Slingshot Birds. No
 * Phaser imports — everything here is deterministic given an injected RNG and
 * is unit-tested in plain jsdom (see logic.test.ts). The scene maps the
 * normalized 0..1 coordinates and the `*_NORM` tuning constants onto backing
 * pixels via a single resolution unit, so the game feels identical at any dpr
 * and in portrait or landscape.
 *
 * Coordinate system: x grows right, y grows DOWN, both in [0, 1] over a square
 * play field. The slingshot sits bottom-left; block structures live in the
 * right ~45% of the field. Physics tuning (`*_NORM`) is expressed in the same
 * unit space: a velocity of 1.0 crosses the whole field per second, gravity of
 * 1.0 is 1 field-unit/s² downward. Because the scene scales positions AND
 * tuning by the same unit, a ballistic arc that clears a tower in this
 * normalized space clears it on every device.
 */

/** Injectable random source, [0, 1). Defaults to Math.random in the game. */
export type Rng = () => number

/** Small, fast, seedable PRNG so levels are reproducible (seed = level). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Materials (physics + look) ──────────────────────────────────────────────
//
// Densities/friction/restitution are the Matter body properties; color is the
// texture base (ART SPEC palette). Asserted by tests so the scene and doc stay
// in sync.

export interface Material {
  /** Texture base color, 0xRRGGBB. */
  color: number
  /** Matter density (mass per unit area). */
  density: number
  /** Matter friction (0..1). */
  friction: number
  /** Matter restitution / bounciness (0..1). */
  restitution: number
}

export type BlockMaterial = 'wood' | 'stone' | 'ice'

/** Block materials — wood tumbles, stone barely budges, ice slides. */
export const MATERIALS: Readonly<Record<BlockMaterial, Material>> = {
  wood: { color: 0xffa94d, density: 1.0, friction: 0.6, restitution: 0.1 },
  // Ink-gray, lightened from #3D3A4B so speckles read on the dark base.
  stone: { color: 0x5b5770, density: 3.0, friction: 0.8, restitution: 0.05 },
  ice: { color: 0x4ecdc4, density: 0.7, friction: 0.05, restitution: 0.15 },
}

/** The hero bird: coral blob, launched by the sling. */
export const BIRD: Material & { radius: number } = {
  color: 0xff6b6b,
  density: 1.5,
  friction: 0.5,
  restitution: 0.35,
  radius: 0.033,
}

/** Big Bird (from level 5): heavier, larger, smashes stone. */
export const BIG_BIRD: Material & { radiusScale: number } = {
  color: 0x9b5de5,
  density: 4.5,
  friction: 0.5,
  restitution: 0.25,
  radiusScale: 1.8,
}

/** Sleeping piggy — freed on any generous contact. */
export const PIGGY: Material & { radius: number } = {
  color: 0x6bcb77,
  density: 0.8,
  friction: 0.6,
  restitution: 0.2,
  radius: 0.036,
}

/** Loose ball — rolls momentum into towers. */
export const BALL: Material & { radius: number } = {
  color: 0x4d96ff,
  density: 1.2,
  friction: 0.4,
  restitution: 0.4,
  radius: 0.05,
}

/** Trampoline (bouncy mushroom): static, high restitution on the bird. */
export const TRAMPOLINE = {
  color: 0xff8fab,
  friction: 0.5,
  restitution: 1.4,
} as const

/** Seesaw plank + pivot color. */
export const SEESAW = {
  plankColor: MATERIALS.wood.color,
  pivotColor: 0x9b5de5,
  density: 1.0,
  friction: 0.6,
  restitution: 0.1,
} as const

// ─── Layout constants (normalized field) ─────────────────────────────────────

/** Ground surface line (structures rest here; y grows down). */
export const GROUND_Y = 0.88
/** Slingshot fork / bird launch origin. */
export const SLING = { x: 0.13, y: 0.56 } as const
/** Structures (blocks + piggies) never reach left of this. */
export const RIGHT_ZONE_MIN = 0.5

/** Default block footprint (a chunky, tumble-able cube). */
const WOOD_W = 0.078
const WOOD_H = 0.078
/** Tall skinny domino footprint. */
const DOMINO_W = 0.03
const DOMINO_H = 0.115
/** Column anchor x positions, left (closest, reachable) to right. */
const COLUMN_X = [0.6, 0.735, 0.865] as const
/** Tallest single column before blocks spill into the next column. */
const MAX_COLUMN_HEIGHT = 4

// ─── Physics tuning (normalized units) ───────────────────────────────────────

/** Base downward gravity, field-units/s². Moon themes scale this down. */
export const BASE_GRAVITY_NORM = 2.0
/** Gravity multiplier on moon levels (floaty, slow, high bounces). */
export const MOON_GRAVITY_SCALE = 0.4
/** Launch speed at full pull, field-units/s (variable pull scales 0..this). */
export const MAX_LAUNCH_SPEED_NORM = 2.0
/** Max drag distance (field-units) that maps to full launch power. */
export const MAX_PULL_NORM = 0.26
/** Pull shorter than this (≈40 css px) hops the bird back — no dud flights. */
export const MIN_PULL_NORM = 0.05
/** Upward speed a mid-flight tap adds (field-units/s). */
export const FLAP_NORM = 0.85
/** From level 15, non-moon levels occasionally borrow moon gravity (combos). */
export const MOON_COMBO_PROBABILITY = 0.22

// ─── Contact-speed thresholds (normalized, field-units/s) ────────────────────
//
// Like every other *_NORM constant these are scaled by the resolution unit L
// in the scene (px/step = norm · L / 60). A raw-pixel threshold here is a bug
// class: the same physical nudge crosses it on one screen size and not on
// another — and the level-entrance drop crossed the old raw threshold on
// EVERY device, self-freeing piggies with zero input.

/**
 * Non-bird contact above this speed frees a piggy (once freeing is armed).
 * Sized between the level-entrance landing bump (√(2·g·spawn gap) = 0.12,
 * see PIGGY_BODY_SCALE) and a block toppling from one block height (≈ 0.56),
 * so settling can never free but a real knock always does.
 */
export const FREE_SPEED_NORM = 0.25
/** Impact speed above which block knocks / ground thuds sound. */
export const KNOCK_SPEED_NORM = 0.15
/** Below this speed the flying bird counts as settling (then it lands). */
export const SETTLE_SPEED_NORM = 0.01

/**
 * Physics circle of a piggy as a fraction of its visual radius (forgiving
 * hull). Consequence: a spawned piggy rests its VISUAL radius above the perch
 * and free-falls the remaining (1 − scale)·radius gap when the level wakes —
 * that landing speed must stay below FREE_SPEED_NORM (tested).
 */
export const PIGGY_BODY_SCALE = 0.9

/**
 * May this contact free a piggy? Freeing is DISARMED until the first bird
 * launch of the current level, so build/entrance/settle collisions can never
 * free a piggy with zero player input (e.g. the spawn-gap landing, or a
 * seesaw tipping its far-end piggy off at wake — the latter exceeds any sane
 * speed threshold, which is why arming is the load-bearing guard). Once
 * armed: a bird frees at any speed — generous; anything else (falling block,
 * shoved piggy) frees above the threshold. Speeds and threshold must share
 * one unit (the scene passes px/step).
 */
export function canFreePiggy(
  armed: boolean,
  hitterLabel: string,
  hitterSpeed: number,
  piggySpeed: number,
  threshold: number,
): boolean {
  if (!armed) return false
  return hitterLabel === 'bird' || hitterSpeed > threshold || piggySpeed > threshold
}

// ─── Themes / schedule ───────────────────────────────────────────────────────

/**
 * Theme cycle in schedule order. Levels 1..14 walk this table two levels each;
 * levels 15+ rotate through it with a ramp (see themeFor / generateLevel).
 */
export const THEME_CYCLE = [
  'towers',
  'dominos',
  'materials',
  'trampoline',
  'balls',
  'seesaw',
  'moon',
] as const
export type Theme = (typeof THEME_CYCLE)[number]

/** Levels 1..14 introduce one concept per two levels; 15+ rotate the cycle. */
export function themeFor(level: number): Theme {
  const l = Math.max(1, Math.floor(level))
  if (l <= 14) return THEME_CYCLE[Math.floor((l - 1) / 2)]
  return THEME_CYCLE[(l - 15) % THEME_CYCLE.length]
}

/** Moon levels float; from level 15 other themes may borrow moon gravity. */
export function gravityScaleFor(level: number, theme: Theme, rng: Rng): number {
  if (theme === 'moon') return MOON_GRAVITY_SCALE
  if (level >= 15 && rng() < MOON_COMBO_PROBABILITY) return MOON_GRAVITY_SCALE
  return 1
}

// ─── Difficulty ramp (4yo caps) ──────────────────────────────────────────────

/** Blocks in a structure: 2 → 10, monotone non-decreasing, capped. */
export function targetBlockCount(level: number): number {
  const base = 2 + Math.floor((Math.max(1, level) - 1) / 2)
  return Math.max(2, Math.min(10, base))
}

/** Piggies: 1 (early) → 2 → 3 max, monotone non-decreasing. */
export function piggyCountFor(level: number): number {
  const l = Math.max(1, Math.floor(level))
  if (l <= 6) return 1
  if (l <= 14) return 2
  return 3
}

// ─── Bird queue (unlimited, auto-reloading; Big Bird from level 5) ───────────

export type BirdKind = 'normal' | 'big'
/** From this level the queue serves a Big Bird every 3rd launch. */
export const BIG_BIRD_FROM_LEVEL = 5
/** Big Bird cadence within the queue cycle. */
export const BIG_BIRD_EVERY = 3

/** The repeating bird queue for a level (scene cycles it forever). */
export function birdCycleFor(level: number): BirdKind[] {
  if (level < BIG_BIRD_FROM_LEVEL) return ['normal']
  const cycle: BirdKind[] = []
  for (let i = 0; i < BIG_BIRD_EVERY; i++) {
    cycle.push((i + 1) % BIG_BIRD_EVERY === 0 ? 'big' : 'normal')
  }
  return cycle
}

// ─── Invisible aim assist ────────────────────────────────────────────────────

/** Consecutive piggy-less launches before assist kicks in. */
export const ASSIST_AFTER_MISSES = 5
/** Assist strength added per miss beyond the threshold. */
export const ASSIST_STEP = 0.25

/**
 * Mid-air homing strength (0..1) for the given streak of piggy-less launches.
 * 0 below the threshold, then ramps to a full 1.0 — never shown, resets on any
 * freed piggy. Guarantees eventual success.
 */
export function assistStrength(consecutiveMisses: number): number {
  if (consecutiveMisses < ASSIST_AFTER_MISSES) return 0
  return Math.min(1, (consecutiveMisses - ASSIST_AFTER_MISSES + 1) * ASSIST_STEP)
}

// ─── Ballistic reachability (closed-form) ────────────────────────────────────

/**
 * Is the point reachable by a full-power launch from the sling under this
 * gravity? Uses the projectile "envelope of safety": a target at horizontal
 * distance dx and height dy above the launch is reachable iff
 *   dy ≤ v0²/(2g) − g·dx²/(2·v0²).
 * Targets at or below launch height (dy ≤ 0) are always reachable within range.
 */
export function isReachable(
  targetX: number,
  targetY: number,
  gravityScale = 1,
  v0 = MAX_LAUNCH_SPEED_NORM,
): boolean {
  const g = BASE_GRAVITY_NORM * gravityScale
  const dx = Math.abs(targetX - SLING.x)
  const dy = SLING.y - targetY // upward positive
  const envelope = (v0 * v0) / (2 * g) - (g * dx * dx) / (2 * v0 * v0)
  return dy <= envelope + 1e-9
}

/** The generator guarantees at least one exposed, reachable piggy per level. */
export function hasReachablePiggy(spec: LevelSpec): boolean {
  return spec.piggies.some((p) => isReachable(p.x, p.y, spec.gravityScale))
}

// ─── Level spec ──────────────────────────────────────────────────────────────

export interface BlockSpec {
  material: BlockMaterial
  x: number
  y: number
  w: number
  h: number
  angle: number
}

export interface PiggySpec {
  x: number
  y: number
}

export type PropKind = 'trampoline' | 'ball' | 'seesaw'

export interface PropSpec {
  kind: PropKind
  x: number
  y: number
  /** Width (trampoline cap / seesaw plank), field-units. */
  w?: number
  /** Height (seesaw plank), field-units. */
  h?: number
  /** Circle radius (ball), field-units. */
  r?: number
}

export interface LevelSpec {
  level: number
  theme: Theme
  gravityScale: number
  /** Repeating bird queue — scene cycles it, auto-reloading forever. */
  birds: BirdKind[]
  blocks: BlockSpec[]
  piggies: PiggySpec[]
  props: PropSpec[]
}

// ─── Structure builders ──────────────────────────────────────────────────────

interface Accumulator {
  blocks: BlockSpec[]
  piggies: PiggySpec[]
  props: PropSpec[]
}

function clampBlockX(x: number, w: number): number {
  return Math.min(1 - w / 2, Math.max(RIGHT_ZONE_MIN + w / 2, x))
}

/**
 * Stack `count` blocks of the given material at column x, from the ground up.
 * Returns the y of the top surface (where a piggy may perch).
 */
function stackColumn(
  out: Accumulator,
  x: number,
  count: number,
  material: BlockMaterial,
  w: number,
  h: number,
): number {
  const cx = clampBlockX(x, w)
  let bottom = GROUND_Y
  for (let i = 0; i < count; i++) {
    out.blocks.push({ material, x: cx, y: bottom - h / 2, w, h, angle: 0 })
    bottom -= h
  }
  return bottom
}

/** Split `n` blocks across up to `maxCols` columns, each ≤ MAX_COLUMN_HEIGHT. */
function distributeColumns(n: number, maxCols: number): number[] {
  const cols: number[] = []
  let remaining = n
  for (let c = 0; c < maxCols && remaining > 0; c++) {
    const h = Math.min(MAX_COLUMN_HEIGHT, Math.ceil(remaining / (maxCols - c)))
    cols.push(h)
    remaining -= h
  }
  // Overflow (n > maxCols * MAX_COLUMN_HEIGHT) never happens for n ≤ 10, but be safe.
  while (remaining > 0 && cols.length > 0) {
    cols[cols.length - 1] += 1
    remaining -= 1
  }
  return cols
}

/** Piggy perched on a surface at height `topY`. */
function piggyOn(x: number, topY: number): PiggySpec {
  return { x: Math.min(1 - PIGGY.radius, x), y: topY - PIGGY.radius }
}

/**
 * Build columns + piggies for the given block/piggy budget. The first column is
 * closest (reachable) and always carries the first, exposed piggy. Materials
 * come from `materialFor(columnIndex)`. Returns nothing; mutates `out`.
 */
function buildColumns(
  out: Accumulator,
  nBlocks: number,
  nPiggies: number,
  materialFor: (col: number) => BlockMaterial,
  w: number,
  h: number,
): void {
  const heights = distributeColumns(nBlocks, COLUMN_X.length)
  const tops: number[] = []
  heights.forEach((count, col) => {
    tops[col] = stackColumn(out, COLUMN_X[col], count, materialFor(col), w, h)
  })

  // Piggy 1: exposed, on the closest column (guaranteed reachable).
  out.piggies.push(piggyOn(COLUMN_X[0], tops[0]))

  // Piggy 2: on the next tallest exposed column, else on the ground beside it.
  if (nPiggies >= 2) {
    const col = tops.length > 1 ? 1 : 0
    out.piggies.push(piggyOn(COLUMN_X[col] + w * 0.1, tops[col] - (col === 0 ? h : 0)))
  }
  // Piggy 3: tucked low behind the rightmost column (harder, still present).
  if (nPiggies >= 3) {
    const col = Math.min(tops.length - 1, 2)
    out.piggies.push(piggyOn(COLUMN_X[col] + w * 1.2, GROUND_Y))
  }
}

/** Fill `out` with the structure for one themed level. */
function buildStructures(level: number, theme: Theme, out: Accumulator): void {
  const nBlocks = targetBlockCount(level)
  const nPiggies = piggyCountFor(level)

  switch (theme) {
    case 'towers': {
      buildColumns(out, nBlocks, nPiggies, () => 'wood', WOOD_W, WOOD_H)
      break
    }
    case 'dominos': {
      // A short reachable tower, then a toppling row of tall skinny dominoes.
      const towerTop = stackColumn(out, COLUMN_X[0], 2, 'wood', WOOD_W, WOOD_H)
      out.piggies.push(piggyOn(COLUMN_X[0], towerTop))
      // Cap the row so it always fits inside the right zone (no clamp overlap).
      const dominoes = Math.min(5, Math.max(2, nBlocks - 2))
      const dominoStep = DOMINO_W + 0.028
      for (let i = 0; i < dominoes; i++) {
        stackColumn(out, 0.7 + i * dominoStep, 1, 'wood', DOMINO_W, DOMINO_H)
      }
      if (nPiggies >= 2) out.piggies.push(piggyOn(0.7 + dominoes * dominoStep, GROUND_Y))
      break
    }
    case 'materials': {
      // Wood tumbles, stone anchors, ice slides — one of each guaranteed.
      const mats: BlockMaterial[] = ['wood', 'stone', 'ice']
      buildColumns(out, nBlocks, nPiggies, (col) => mats[col % mats.length], WOOD_W, WOOD_H)
      break
    }
    case 'trampoline': {
      buildColumns(out, nBlocks, nPiggies, () => 'wood', WOOD_W, WOOD_H)
      // Bouncy mushroom in front of the towers so the bird can bounce in/over.
      out.props.push({ kind: 'trampoline', x: 0.44, y: GROUND_Y, w: 0.12 })
      break
    }
    case 'balls': {
      buildColumns(out, Math.max(2, nBlocks - 1), nPiggies, () => 'wood', WOOD_W, WOOD_H)
      // A loose ball resting just left of the tower — hit it, it rolls in.
      out.props.push({
        kind: 'ball',
        x: COLUMN_X[0] - 0.12,
        y: GROUND_Y - BALL.radius,
        r: BALL.radius,
      })
      break
    }
    case 'seesaw': {
      // Reachable tower for piggy 1, plus a lever: hit the near end, far piggy pops.
      const towerTop = stackColumn(out, COLUMN_X[0], 2, 'wood', WOOD_W, WOOD_H)
      out.piggies.push(piggyOn(COLUMN_X[0], towerTop))
      const plankX = 0.78
      const plankW = 0.22
      const plankY = GROUND_Y - 0.06
      out.props.push({ kind: 'seesaw', x: plankX, y: plankY, w: plankW, h: 0.026 })
      // A weight on the near end, a piggy on the far (right) end.
      stackColumn(out, plankX - plankW * 0.4, 1, 'wood', WOOD_W, WOOD_H)
      if (nPiggies >= 2) {
        out.piggies.push(piggyOn(plankX + plankW * 0.4, plankY - 0.02))
      }
      break
    }
    case 'moon': {
      // Ordinary towers, but gravity is set to MOON_GRAVITY_SCALE by the caller.
      buildColumns(out, nBlocks, nPiggies, () => 'wood', WOOD_W, WOOD_H)
      break
    }
  }

  // Guarantee the piggy budget across every theme (prop-heavy themes may not
  // place enough on their own). Extras snooze on the ground, well spread.
  for (let guard = 0; out.piggies.length < nPiggies && guard < 3; guard++) {
    out.piggies.push(piggyOn(0.66 + guard * 0.09, GROUND_Y))
  }
}

/**
 * Generate a full, deterministic level. Seed the RNG with the level number for
 * replayable, testable levels (the scene passes `mulberry32(level)`).
 */
export function generateLevel(level: number, rng: Rng = Math.random): LevelSpec {
  const lvl = Math.max(1, Math.floor(level))
  const theme = themeFor(lvl)
  const gravityScale = gravityScaleFor(lvl, theme, rng)
  const birds = birdCycleFor(lvl)

  const out: Accumulator = { blocks: [], piggies: [], props: [] }
  buildStructures(lvl, theme, out)

  return {
    level: lvl,
    theme,
    gravityScale,
    birds,
    blocks: out.blocks,
    piggies: out.piggies,
    props: out.props,
  }
}
