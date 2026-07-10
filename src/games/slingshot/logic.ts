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

// ─── Birds (five kinds; one is active at a time — see activeBird.ts) ──────────
//
// One bird flies per game; a reward (Feature 2) can promote the child to a
// heavier, bouncier one. The five form a SEMANTIC progression (asserted by a
// table test):
//   green  = baseline
//   blue   = +1 size, +1 weight vs green
//   purple = +1 size vs blue, same weight, +1 bounce
//   red    = same size/weight as purple, +2 bounce
//   yellow = +1 size vs red, +2 weight, +1 bounce
// Steps: size 0.25–0.3 (radiusScale), weight 1.0 (density), bounce 0.1
// (restitution). Colors are the ART SPEC palette; the scene keys per-kind
// textures + personalities off `kind`.

export type BirdKind = 'green' | 'blue' | 'purple' | 'red' | 'yellow'

/** Base bird radius (normalized). Effective radius = BIRD_RADIUS × radiusScale. */
export const BIRD_RADIUS = 0.033

export interface Bird {
  /** Texture base color, 0xRRGGBB. */
  color: number
  /** Matter density (mass per unit area). */
  density: number
  /** Matter friction (0..1). */
  friction: number
  /** Matter restitution / bounciness (0..1). */
  restitution: number
  /** Radius multiplier over BIRD_RADIUS (size step of the progression). */
  radiusScale: number
}

/** The five launchable birds. Physics + look in one table, asserted by tests. */
export const BIRDS: Readonly<Record<BirdKind, Bird>> = {
  // Lime green — clearly distinct from the mint piggy (0x6bcb77).
  green: { color: 0x8ac926, density: 1.5, friction: 0.5, restitution: 0.35, radiusScale: 1.0 },
  blue: { color: 0x4d96ff, density: 2.5, friction: 0.5, restitution: 0.35, radiusScale: 1.25 },
  purple: { color: 0x9b5de5, density: 2.5, friction: 0.5, restitution: 0.45, radiusScale: 1.5 },
  red: { color: 0xff6b6b, density: 2.5, friction: 0.5, restitution: 0.65, radiusScale: 1.5 },
  // Yellow gets an ORANGE beak in the scene (a yellow beak would vanish).
  yellow: { color: 0xffd93d, density: 4.5, friction: 0.5, restitution: 0.75, radiusScale: 1.8 },
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
export const WOOD_W = 0.078
export const WOOD_H = 0.078
/** Tall skinny domino footprint. */
const DOMINO_W = 0.03
const DOMINO_H = 0.115
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
// another.

/** Impact speed above which block knocks / ground thuds sound. */
export const KNOCK_SPEED_NORM = 0.15
/** Below this speed the flying bird counts as settling (then it lands). */
export const SETTLE_SPEED_NORM = 0.01

/**
 * Physics circle of a piggy as a fraction of its visual radius (forgiving
 * hull). Consequence: a spawned piggy rests its VISUAL radius above the perch
 * and free-falls the remaining (1 − scale)·radius gap when the level wakes.
 */
export const PIGGY_BODY_SCALE = 0.9

/**
 * May this contact free a piggy? ONLY a direct hit from the flying bird frees.
 * Blocks, props, the ground, or another shoved piggy never do, no matter how
 * fast — a toppling box brushing a piggy must not count as a rescue. Spent
 * birds lying on the field are relabeled 'spentBird' by the scene, so they
 * cannot free either. Freeing is additionally DISARMED until the first bird
 * launch of the current level, so no build/entrance/settle collision can ever
 * free a piggy with zero player input.
 */
export function canFreePiggy(armed: boolean, hitterLabel: string): boolean {
  return armed && hitterLabel === 'bird'
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
  /**
   * Authored bird queue. Normal play IGNORES this and flies the player's active
   * bird (see activeBird.ts); the editor honours it so a hand-tuned level can
   * still exercise a specific bird. The generator emits `['green']`.
   */
  birds: BirdKind[]
  blocks: BlockSpec[]
  piggies: PiggySpec[]
  props: PropSpec[]
}

// ─── Structure builders (seeded archetypes) ──────────────────────────────────
//
// Layout is archetype-based (towers / pyramid / pen), picked per level from a
// hashed side-stream and jittered by the injected RNG. Design rules distilled
// from the Angry-Birds PCG literature (Stephenson & Renz, CIG16/17) and the
// old generator's failure mode:
//   1. Consecutive levels must differ CATEGORICALLY (archetype, column count,
//      silhouette), not just by positional jitter — jitter alone reads as "the
//      same level again". Same-theme neighbours never repeat an archetype.
//   2. Blocks always MATTER: piggies perch on structure tops, hide penned
//      behind walls, or ride the apex — never scenery placed behind the pig.
//   3. Stability by construction: blocks stack in exactly-aligned columns and
//      centered pyramid rows (both edges supported), so nothing self-collapses
//      when the level wakes.
//   4. Nothing overlaps at spawn (Matter ejects interpenetrating bodies):
//      ground piggies search for clear ground, props keep clearance from the
//      structure.

interface Accumulator {
  blocks: BlockSpec[]
  piggies: PiggySpec[]
  props: PropSpec[]
}

interface BuildCtx {
  level: number
  rng: Rng
  /** Block budget for the level (2..10). */
  nBlocks: number
  /** Piggy budget for the level (1..3). */
  nPiggies: number
  /** Forced tower-column count (theme pairs alternate it for variety). */
  colsHint?: number
}

/** Material for the i-th column (towers/pen) or row (pyramid). */
type MaterialFn = (i: number) => BlockMaterial

/** A structure builder mutating the accumulator; towers reports its column
 *  xs/tops so prop themes (balls) can place relative to the front column. */
type Archetype = (out: Accumulator, ctx: BuildCtx, matFor: MaterialFn) => ColumnInfo | void
interface ColumnInfo {
  xs: number[]
  tops: number[]
}

// ─── Seeded random helpers ───────────────────────────────────────────────────

const rand = (rng: Rng, min: number, max: number): number => min + (max - min) * rng()
const randInt = (rng: Rng, min: number, max: number): number =>
  min + Math.floor((max - min + 1) * rng())

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

/** Piggy perched on a surface at height `topY`, clamped into the right zone. */
function piggyOn(x: number, topY: number): PiggySpec {
  return {
    x: Math.min(1 - PIGGY.radius, Math.max(RIGHT_ZONE_MIN + PIGGY.radius, x)),
    y: topY - PIGGY.radius,
  }
}

/** Would a piggy body at (x, y) sit clear of every block and piggy?
 *  A perched piggy touches its support at exactly its visual radius, so the
 *  block margin must stay below r − bodyR (= 0.0036). */
function circleFits(out: Accumulator, x: number, y: number): boolean {
  const bodyR = PIGGY.radius * PIGGY_BODY_SCALE
  return (
    out.blocks.every((b) => {
      const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2))
      const cy = Math.max(b.y - b.h / 2, Math.min(y, b.y + b.h / 2))
      return Math.hypot(x - cx, y - cy) > bodyR + 0.003
    }) && out.piggies.every((p) => Math.hypot(x - p.x, y - p.y) > PIGGY.radius * 2 + 0.004)
  )
}

/** Is this block's top face open sky (no block resting on it)? */
function topIsFree(out: Accumulator, b: BlockSpec): boolean {
  const topY = b.y - b.h / 2
  return !out.blocks.some(
    (s) =>
      s !== b &&
      Math.abs(s.y + s.h / 2 - topY) < 1e-9 &&
      Math.abs(s.x - b.x) < (s.w + b.w) / 2 - 1e-9,
  )
}

/**
 * Drop a piggy near `startX` without interpenetrating anything (Matter ejects
 * overlapping bodies). Three tiers, all deterministic:
 *   1. clear ground, scanning outward from startX;
 *   2. a free block top (nearest first) — piggies riding the structure are
 *      the point of the game, so this is a feature, not a compromise;
 *   3. stacked on another piggy (a snoozing totem) — crowded boards only.
 */
function placePiggy(out: Accumulator, startX: number): void {
  const r = PIGGY.radius
  const lo = RIGHT_ZONE_MIN + r
  const hi = 1 - r
  // Tier 1: clear ground. Props are ground-level, so keep clear of them here.
  const groundClear = (x: number): boolean =>
    x >= lo &&
    x <= hi &&
    out.blocks.every((b) => Math.abs(x - b.x) > b.w / 2 + r + 0.008) &&
    out.piggies.every((p) => Math.abs(x - p.x) > r * 2 + 0.006) &&
    out.props.every((p) => {
      const half =
        p.kind === 'seesaw'
          ? (p.w ?? 0.22) / 2
          : p.kind === 'ball'
            ? (p.r ?? BALL.radius)
            : (p.w ?? 0.12) / 2
      return Math.abs(x - p.x) > half + r + 0.01
    })
  for (let k = 0; k < 60; k++) {
    const x = startX + Math.ceil(k / 2) * 0.024 * (k % 2 === 0 ? 1 : -1)
    if (groundClear(x)) {
      out.piggies.push({ x, y: GROUND_Y - r })
      return
    }
  }
  // Tier 2: nearest free block top that the piggy body actually fits on.
  const perches = out.blocks
    .filter((b) => topIsFree(out, b))
    .sort((a, b) => Math.abs(a.x - startX) - Math.abs(b.x - startX))
  for (const b of perches) {
    const spot = piggyOn(b.x, b.y - b.h / 2)
    if (circleFits(out, spot.x, spot.y)) {
      out.piggies.push(spot)
      return
    }
  }
  // Tier 3: stack on the nearest piggy (never overlaps: exact 2r + gap).
  const below = [...out.piggies].sort((a, b) => Math.abs(a.x - startX) - Math.abs(b.x - startX))
  for (const p of below) {
    const spot = { x: p.x, y: p.y - r * 2 - 0.006 }
    if (circleFits(out, spot.x, spot.y)) {
      out.piggies.push(spot)
      return
    }
  }
  out.piggies.push({ x: below[0].x, y: below[0].y - r * 2 - 0.006 })
}

/**
 * Split `n` blocks into `k` columns, each 1..MAX_COLUMN_HEIGHT, deliberately
 * uneven — equal columns read as a flat wall, a staggered skyline reads as a
 * structure worth toppling.
 */
function splitUneven(rng: Rng, n: number, k: number): number[] {
  const parts = new Array(Math.max(1, k)).fill(1)
  let remaining = n - parts.length
  let guard = 0
  while (remaining > 0 && guard++ < 400) {
    if (parts.every((p) => p >= MAX_COLUMN_HEIGHT)) break
    const i = randInt(rng, 0, parts.length - 1)
    if (parts[i] < MAX_COLUMN_HEIGHT) {
      parts[i]++
      remaining--
    }
  }
  return parts
}

/**
 * `n` column center xs spread across the reachable right zone, jittered and
 * min-spaced by `gap`, sorted left→right so index 0 is the closest (front)
 * column — the one the guaranteed-reachable piggy rides.
 */
function columnXs(rng: Rng, n: number, gap: number): number[] {
  const lo = RIGHT_ZONE_MIN + 0.07
  const hi = 0.92
  if (n <= 1) return [rand(rng, lo, lo + 0.16)]
  const xs: number[] = []
  for (let i = 0; i < n; i++) {
    const slot = lo + ((hi - lo) * i) / (n - 1)
    xs.push(slot + rand(rng, -gap * 0.3, gap * 0.3))
  }
  xs.sort((a, b) => a - b)
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] < gap) xs[i] = xs[i - 1] + gap
  }
  return xs
}

/**
 * Primary piggy on the front (closest) column top — always reachable. A second
 * rides the tallest remaining column. Extras come from the ground filler.
 */
function piggiesOnColumns(out: Accumulator, ctx: BuildCtx, xs: number[], tops: number[]): void {
  out.piggies.push(piggyOn(xs[0], tops[0]))
  if (ctx.nPiggies >= 2 && xs.length >= 2) {
    let best = 1
    for (let i = 2; i < tops.length; i++) if (tops[i] < tops[best]) best = i
    out.piggies.push(piggyOn(xs[best], tops[best]))
  }
}

/** A skyline of 1..3 uneven towers; piggies ride the tops. */
const buildTowers = (out: Accumulator, ctx: BuildCtx, matFor: MaterialFn): ColumnInfo => {
  const { rng, nBlocks } = ctx
  const maxCols = Math.min(3, nBlocks)
  const minCols = Math.min(maxCols, Math.ceil(nBlocks / MAX_COLUMN_HEIGHT))
  // Tiny budgets build ONE vertical column — it reads as "a tower", instantly
  // distinct from the pyramid's and pen's flat early-level shapes.
  let cols = ctx.colsHint ?? (nBlocks <= 3 ? 1 : randInt(rng, 2, maxCols))
  cols = Math.max(minCols, Math.min(maxCols, cols))
  const heights = splitUneven(rng, nBlocks, cols)
  const xs = columnXs(rng, heights.length, WOOD_W * 1.2)
  const tops = heights.map((h, i) => stackColumn(out, xs[i], h, matFor(i), WOOD_W, WOOD_H))
  piggiesOnColumns(out, ctx, xs, tops)
  return { xs, tops }
}

/** A stepped pyramid; the primary piggy rides the apex. */
const buildPyramid: Archetype = (out, ctx, matFor): void => {
  const { rng, nBlocks, nPiggies } = ctx
  // Base capped at 4 and centered so a full base never clamps onto the zone edge.
  const base = Math.max(2, Math.min(4, Math.round(Math.sqrt(nBlocks * 1.6))))
  const cx = rand(rng, 0.66, 0.8)
  let placed = 0
  let bottom = GROUND_Y
  let row = 0
  for (; row < base && placed < nBlocks; row++) {
    const count = base - row
    const startX = cx - ((count - 1) * WOOD_W) / 2
    for (let i = 0; i < count && placed < nBlocks; i++) {
      out.blocks.push({
        material: matFor(row),
        x: clampBlockX(startX + i * WOOD_W, WOOD_W),
        y: bottom - WOOD_H / 2,
        w: WOOD_W,
        h: WOOD_H,
        angle: 0,
      })
      placed++
    }
    bottom -= WOOD_H
  }
  out.piggies.push(piggyOn(cx, bottom))
  // Second piggy on the ground at the pyramid's front-left foot (clear side).
  if (nPiggies >= 2) placePiggy(out, cx - (base * WOOD_W) / 2 - PIGGY.radius - 0.02)
}

/**
 * A low front wall with the primary piggy penned just behind it — arc over the
 * wall (or knock it onto the piggy) to free it. A taller back wall carries the
 * second piggy on top.
 */
const buildPen: Archetype = (out, ctx, matFor): void => {
  const { rng, nBlocks, nPiggies } = ctx
  const cx = rand(rng, 0.68, 0.8)
  const gap = WOOD_W * 1.7
  const front = Math.min(randInt(rng, 1, 2), Math.max(1, nBlocks - 1))
  stackColumn(out, cx - gap, front, matFor(0), WOOD_W, WOOD_H)
  const back = Math.max(1, Math.min(MAX_COLUMN_HEIGHT, nBlocks - front))
  const backTop = stackColumn(out, cx + gap, back, matFor(1), WOOD_W, WOOD_H)
  out.piggies.push(piggyOn(cx, GROUND_Y))
  if (nPiggies >= 2) out.piggies.push(piggyOn(cx + gap, backTop))
}

/** Short reachable tower + a toppling row of tall dominoes. */
function buildDominos(out: Accumulator, ctx: BuildCtx): void {
  const { level, rng, nBlocks, nPiggies } = ctx
  const tx = rand(rng, 0.56, 0.64)
  // Level parity alternates the tower height so the two dominos levels of a
  // theme pair differ categorically, not just by jitter.
  const towerH = 2 + (level % 2)
  const towerTop = stackColumn(out, tx, towerH, 'wood', WOOD_W, WOOD_H)
  out.piggies.push(piggyOn(tx, towerTop))
  const dominoes = Math.min(5, Math.max(2, nBlocks - towerH + 1))
  const startX = tx + 0.09
  // Fit the whole row inside the field so no domino clamps onto its neighbour.
  const maxX = 1 - DOMINO_W / 2
  const step = Math.min(DOMINO_W + rand(rng, 0.024, 0.036), (maxX - startX) / dominoes)
  for (let i = 0; i < dominoes; i++) {
    stackColumn(out, startX + i * step, 1, 'wood', DOMINO_W, DOMINO_H)
  }
  if (nPiggies >= 2) placePiggy(out, startX + dominoes * step + 0.012)
}

/** Reachable tower for piggy 1 + a lever: hit the near end, the far piggy pops. */
function buildSeesaw(out: Accumulator, ctx: BuildCtx): void {
  const { level, rng, nPiggies } = ctx
  const tx = rand(rng, 0.55, 0.6)
  // Same parity trick as dominos: the pair's towers are 2 vs 3 blocks tall.
  const towerTop = stackColumn(out, tx, 2 + (level % 2), 'wood', WOOD_W, WOOD_H)
  out.piggies.push(piggyOn(tx, towerTop))
  const plankW = 0.22
  // Plank keeps clear of the tower's right edge and of the field's right wall.
  const plankX = Math.min(
    0.98 - plankW / 2,
    Math.max(tx + WOOD_W / 2 + plankW / 2 + 0.03, rand(rng, 0.74, 0.8)),
  )
  const plankY = GROUND_Y - 0.06
  const plankH = 0.026
  out.props.push({ kind: 'seesaw', x: plankX, y: plankY, w: plankW, h: plankH })
  // A weight resting ON the plank's near end (small spawn gap so nothing
  // interpenetrates), a piggy on the far (right) end. The old ground-stacked
  // weight clipped straight through the plank and Matter ejected it at wake.
  out.blocks.push({
    material: 'wood',
    x: plankX - plankW * 0.4,
    y: plankY - plankH / 2 - WOOD_H / 2 - 0.004,
    w: WOOD_W,
    h: WOOD_H,
    angle: 0,
  })
  if (nPiggies >= 2) {
    out.piggies.push(piggyOn(plankX + plankW * 0.4, plankY - 0.02))
  }
}

// ─── Archetype selection (categorical variety) ───────────────────────────────

const TOWER_FAMILY: Archetype[] = [buildTowers, buildPyramid, buildPen]
/** Materials theme skips the pen — its walls are too small to show 3 materials. */
const MATERIALS_FAMILY: Archetype[] = [buildTowers, buildPyramid]

function familyFor(theme: Theme): Archetype[] | null {
  if (theme === 'towers' || theme === 'moon') return TOWER_FAMILY
  if (theme === 'materials' || theme === 'trampoline') return MATERIALS_FAMILY
  return null
}

/**
 * Pick the archetype index for a level from a hashed side-stream (decoupled
 * from the injected RNG so layout jitter can evolve without reshuffling the
 * archetype schedule). Same-theme neighbours never repeat: theme pairs
 * (levels 1–14 run each theme twice back-to-back) get two DIFFERENT shapes —
 * the old generator's sameness came exactly from repeating one template.
 */
function archetypeIndexFor(level: number, theme: Theme, familySize: number): number {
  const draw = mulberry32(level * 0x9e3779b9 + 0x5f356495)()
  let idx = Math.min(familySize - 1, Math.floor(draw * familySize))
  if (level > 1 && familySize > 1 && themeFor(level - 1) === theme) {
    const prev = archetypeIndexFor(level - 1, theme, familySize)
    if (prev === idx) idx = (idx + 1) % familySize
  }
  return idx
}

/** Rotated material cycle for the materials theme (columns differ per level). */
const ALL_MATERIALS: readonly BlockMaterial[] = ['wood', 'stone', 'ice']
/** Densest-first for pyramids: stone base, wood middle, ice top — stable AND colorful. */
const PYRAMID_MATERIALS: readonly BlockMaterial[] = ['stone', 'wood', 'ice']

/**
 * Force at least one stone and one ice block into a materials-theme structure —
 * the wood/stone/ice contrast is the whole point of that theme (tiny builds
 * may cycle through fewer than 3 columns).
 */
function ensureMaterialMix(out: Accumulator): void {
  if (out.blocks.length === 0) return
  const has = (m: BlockMaterial) => out.blocks.some((b) => b.material === m)
  if (!has('stone')) out.blocks[0].material = 'stone'
  if (!has('ice')) out.blocks[out.blocks.length - 1].material = 'ice'
}

/** Fill `out` with the structure for one themed level. */
function buildStructures(level: number, theme: Theme, out: Accumulator, ctx: BuildCtx): void {
  const { rng } = ctx
  const family = familyFor(theme)
  const archetype = family ? family[archetypeIndexFor(level, theme, family.length)] : null

  switch (theme) {
    case 'towers':
    case 'moon': {
      archetype?.(out, ctx, () => 'wood')
      break
    }
    case 'materials': {
      // Wood tumbles, stone anchors, ice slides — one of each guaranteed.
      const rot = randInt(rng, 0, 2)
      const isPyramid = archetype === buildPyramid
      archetype?.(out, ctx, (i) =>
        isPyramid
          ? PYRAMID_MATERIALS[Math.min(i, PYRAMID_MATERIALS.length - 1)]
          : ALL_MATERIALS[(i + rot) % ALL_MATERIALS.length],
      )
      ensureMaterialMix(out)
      break
    }
    case 'trampoline': {
      archetype?.(out, ctx, () => 'wood')
      // Bouncy mushroom in front, kept clear of the structure AND any ground
      // piggy the archetype dropped at its left foot.
      const leftMost = Math.min(
        ...out.blocks.map((b) => b.x - b.w / 2),
        ...out.piggies.map((p) => p.x - PIGGY.radius),
      )
      out.props.push({
        kind: 'trampoline',
        x: Math.min(rand(rng, 0.4, 0.47), leftMost - 0.08),
        y: GROUND_Y,
        w: 0.12,
      })
      break
    }
    case 'balls': {
      // One fewer block leaves room for the loose ball to roll into the tower.
      // Column-count parity keeps the theme pair categorically different.
      const info = buildTowers(
        out,
        { ...ctx, nBlocks: Math.max(2, ctx.nBlocks - 1), colsHint: 2 + (level % 2) },
        () => 'wood',
      )
      // Resting just left of the front column — hit it, it rolls in.
      out.props.push({
        kind: 'ball',
        x: info.xs[0] - 0.12,
        y: GROUND_Y - BALL.radius,
        r: BALL.radius,
      })
      break
    }
    case 'dominos': {
      buildDominos(out, ctx)
      break
    }
    case 'seesaw': {
      buildSeesaw(out, ctx)
      break
    }
  }
}

/**
 * Land the piggy list on exactly `nPiggies`: trim extras from the end (the
 * front, reachable piggy is always index 0), pad shortfalls with snoozers on
 * clear ground near the structure.
 */
function balancePiggies(out: Accumulator, ctx: BuildCtx): void {
  if (out.piggies.length > ctx.nPiggies) out.piggies.length = ctx.nPiggies
  let guard = 0
  while (out.piggies.length < ctx.nPiggies && guard++ < 4) {
    placePiggy(out, rand(ctx.rng, 0.58, 0.9))
  }
}

/**
 * Guarantee at least one reachable piggy (the generator's core promise). Under
 * normal gravity every in-zone perch is already inside the ballistic envelope,
 * so this only fires for pathological combos — it drops the front piggy onto
 * the ground where a full-power shot always lands.
 */
function ensureReachable(out: Accumulator, gravityScale: number): void {
  if (out.piggies.length === 0) return
  if (out.piggies.some((p) => isReachable(p.x, p.y, gravityScale))) return
  out.piggies[0] = piggyOn(0.6, GROUND_Y)
}

/**
 * Generate a full, deterministic level. Seed the RNG with the level number for
 * replayable, testable levels (the scene passes `mulberry32(level)`).
 */
export function generateLevel(level: number, rng: Rng = Math.random): LevelSpec {
  const lvl = Math.max(1, Math.floor(level))
  const theme = themeFor(lvl)
  const gravityScale = gravityScaleFor(lvl, theme, rng)
  // Placeholder queue: normal play substitutes the active bird; the editor uses
  // it verbatim. Kept valid (non-empty, known kind) so the parser round-trips.
  const birds: BirdKind[] = ['green']

  const ctx: BuildCtx = {
    level: lvl,
    rng,
    nBlocks: targetBlockCount(lvl),
    nPiggies: piggyCountFor(lvl),
  }
  const out: Accumulator = { blocks: [], piggies: [], props: [] }
  buildStructures(lvl, theme, out, ctx)
  balancePiggies(out, ctx)
  ensureReachable(out, gravityScale)

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
