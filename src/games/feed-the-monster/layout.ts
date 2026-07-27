/**
 * Pure responsive geometry for the Feed the Monster scene.
 *
 * Every vertical anchor is a FRACTION of the visible height and every
 * horizontal anchor a fraction of the width, so the composition scales with
 * the screen (reads equally on iPad 4:3 and phone-landscape ~2.2:1) instead of
 * being pinned by hard px offsets that eat a huge share of a short viewport.
 * Fixed px appears ONLY as physical safe-area minimums.
 *
 * These functions are deterministic given a `LayoutMetrics` snapshot (no Phaser
 * objects, no scene state) — that is what makes them unit-testable. The scene
 * builds `metrics()` from its live size/dpr/body-radius/growth and delegates.
 */
import { TRAY_SIZE } from './logic'

export interface XY {
  x: number
  y: number
}

// The task panel lives at the very top of the screen, in its own bar — detached
// from the friend. Exported: the scene draws the panel bar against these too.
export const PANEL_H_CSS = 96
export const PANEL_CENTER_Y_CSS = 58

// Tray (a fixed-size element) hugs the bottom this fraction up; the hero +
// friends stand a further fraction above the tray, so on every device the tray
// sits at ~81% and the monster at ~48% with matching breathing room.
const TRAY_BOTTOM_FRAC = 0.19
const HERO_GAP_FRAC = 0.26
// The tray never rides closer to the bottom than the home-indicator / notch
// strip plus a food-sprite half-height of clearance (drags that start on the
// very bottom edge trigger the iOS minimize gesture). CSS px, dpr-scaled.
const TRAY_MIN_CLEARANCE_CSS = 60

// The food row spreads its TRAY_SIZE plates across (1 − 2·SIDE) of the width so
// it uses the screen instead of huddling in the middle. Each plate is its slot
// minus a small GAP; a max width keeps plates from dwarfing the food on wide
// displays.
const TRAY_SIDE_FRAC = 0.045
const TRAY_GAP_FRAC = 0.16
const PLATE_MAX_W_CSS = 112

/** A live snapshot of everything the geometry depends on (backing px + dpr). */
export interface LayoutMetrics {
  /** scale.width in backing px. */
  w: number
  /** scale.height in backing px. */
  h: number
  dpr: number
  /** Base body radius in backing px. */
  bodyR: number
  /** Current friend growth multiplier. */
  growth: number
  /** iOS safe-area bottom inset in CSS px. */
  safeInsetBottom: number
}

/** CSS px → backing px. */
const px = (m: LayoutMetrics, css: number): number => css * m.dpr

/**
 * Gap between the food row and the screen bottom. Proportional (a share of the
 * height) so it scales with the screen, but floored by the physical safe-area
 * strip plus a food half-height so the tray always clears the home indicator.
 */
export function bottomMargin(m: LayoutMetrics): number {
  return Math.max(m.h * TRAY_BOTTOM_FRAC, m.safeInsetBottom * m.dpr + px(m, TRAY_MIN_CLEARANCE_CSS))
}

export function trayY(m: LayoutMetrics): number {
  return m.h - bottomMargin(m)
}

/**
 * The invisible line the hero + friends stand on. Anchored a fixed FRACTION of
 * the height ABOVE the tray, so the whole cluster tracks the tray
 * proportionally rather than collapsing into the top on a short screen.
 */
export function heroBaseline(m: LayoutMetrics): number {
  return trayY(m) - m.h * HERO_GAP_FRAC
}

/** Width of one tray slot (plate + gap), spreading the row across the width. */
export function traySlotWidth(m: LayoutMetrics): number {
  return (m.w * (1 - 2 * TRAY_SIDE_FRAC)) / TRAY_SIZE
}

/** Plate marker width: its slot minus a small gap, capped so it can't dwarf the
 * food (nor overlap its neighbour) on very wide screens. */
export function plateWidth(m: LayoutMetrics): number {
  return Math.min(traySlotWidth(m) * (1 - TRAY_GAP_FRAC), px(m, PLATE_MAX_W_CSS))
}

export function slotPos(m: LayoutMetrics, index: number): XY {
  // Spread the row evenly across the usable width (TRAY_SIDE_FRAC gutter on each
  // side), one plate per slot — so plates fill the screen with small gaps
  // instead of huddling, overlapped, in the middle third.
  const slot = traySlotWidth(m)
  const first = m.w * TRAY_SIDE_FRAC + slot / 2
  return { x: first + index * slot, y: trayY(m) }
}

export function monsterPos(m: LayoutMetrics): XY {
  const y = heroBaseline(m) - m.bodyR * m.growth * 0.55
  // Never let the head ride up under the top task panel.
  const headroom = px(m, PANEL_CENTER_Y_CSS + PANEL_H_CSS / 2) + m.bodyR * m.growth * 1.35
  return { x: m.w / 2, y: Math.max(y, headroom) }
}

// The two duo friends stand this fraction of the width to each side of centre —
// far enough apart that even at their (slightly smaller) full size the pair
// never overlaps on a narrow 4:3 iPad.
const DUO_X_FRAC = 0.24

/**
 * Home position for one of a duo's two side-by-side friends (`side` −1 = left,
 * +1 = right) at the given pair `scale`. Same vertical rules as monsterPos (feet
 * on heroBaseline, head kept clear of the top panel), mirrored left/right.
 */
export function duoMonsterPos(m: LayoutMetrics, side: -1 | 1, scale: number): XY {
  const y = heroBaseline(m) - m.bodyR * scale * 0.55
  const headroom = px(m, PANEL_CENTER_Y_CSS + PANEL_H_CSS / 2) + m.bodyR * scale * 1.35
  return { x: m.w / 2 + side * m.w * DUO_X_FRAC, y: Math.max(y, headroom) }
}

export function miniSlot(m: LayoutMetrics, index: number): XY {
  // dx/dy pile offsets (bodyR units): all friends huddle on one level, each
  // shifted out far enough to partially overlap its neighbour (index 3 sits
  // just right of index 1, index 4 mirrors on the left) — a snug cluster.
  const pile = [
    { dx: 0.0, dy: 0.0 },
    { dx: 0.4, dy: 0.03 },
    { dx: -0.36, dy: 0.05 },
    { dx: 0.72, dy: 0.02 },
    { dx: -0.72, dy: 0.04 },
  ]
  const p = pile[index % pile.length]
  // Extra friends beyond the five slots stack a further tier up (defensive; an
  // episode only ever fills the five slots above).
  const tier = Math.floor(index / pile.length)
  const baseX = Math.max(m.w * 0.1, m.bodyR)
  const baseY = heroBaseline(m) - m.bodyR * 0.28
  return {
    x: baseX + p.dx * m.bodyR,
    y: baseY + (p.dy - tier * 0.6) * m.bodyR,
  }
}

/**
 * Touch radius of a food sprite, CSS px — deliberately bigger than the art (a
 * ~64 css px emoji footprint) so a fingertip that lands near it counts.
 *
 * Exported because it is not only the tray's business: on the conveyor it is half
 * of the motor-fairness budget (belt.grabWindowMs divides it by the belt's speed
 * to get how long a passing dish stays under a finger), so the two numbers have to
 * be reasoned about together rather than drifting apart.
 */
export const FOOD_HIT_RADIUS_CSS = 50

/**
 * Generous feed drop zone, centered on the visible mouth. Slightly roomier than
 * a tight mouth radius so a 3–4yo who releases a touch above the open mouth
 * still lands the food.
 */
export function snapRadius(m: LayoutMetrics): number {
  return Math.max(m.bodyR * 0.9 * m.growth, px(m, 100))
}

// ─── Visitors (the thief, the butterfly) ─────────────────────────────────────

/** A visitor's tap circle: this share of a tray slot… */
const VISITOR_TAP_SLOT_FRAC = 0.6
/**
 * …never below this physical floor, in CSS px. ~52 css px make a centimetre on an
 * iPad, so 70 is ~1.3 cm of radius — a ~2.7 cm target, comfortably past the ~2 cm
 * a four-year-old's fingertip lands reliably. Exported so a spec can assert it.
 */
export const VISITOR_TAP_MIN_CSS = 70

/**
 * Tap radius for a visitor — the circle a finger has to land in to shoo it.
 *
 * Deliberately roomier than a food's ~50 css hit radius: the visitor is the only
 * target in the game that MOVES, and it is tappable from the moment it appears, so
 * most taps are aimed at something mid-flight. Proportional to the tray on a wide
 * screen, floored by the physical minimum above on a narrow one.
 *
 * On the narrowest viewport that circle reaches a little into the neighbouring
 * plate. That is the right way to lose the tie: a tap that shoos the bird instead
 * of starting a drag costs the child nothing (both are answered with delight),
 * while a bird missed by a hair costs them the food.
 */
export function visitorTapRadius(m: LayoutMetrics): number {
  return Math.max(traySlotWidth(m) * VISITOR_TAP_SLOT_FRAC, px(m, VISITOR_TAP_MIN_CSS))
}

// ─── Kitchen: the pot ────────────────────────────────────────────────────────
//
// The pot stands between the friend and the tray, well off to the right: the
// friend owns the centre (at FULL_SCALE it is wide) and the fed-friends pile owns
// the bottom-left, so the right of the middle band is the only free ground. It
// only exists during a kitchen round — a permanent pot would take that space every
// round for nothing.

/** How far right of centre the pot stands, as a fraction of the width. */
const POT_X_FRAC = 0.855
/**
 * How far the pot sits down the band between the hero baseline and the tray, as a
 * fraction of that BAND — not of the whole height. A share of the height reads
 * fine on a 4:3 iPad and pushes the pot straight through the plate row on a short
 * phone-landscape viewport, where the band is a third as tall.
 */
const POT_BAND_FRAC = 0.28
/** Pot width as a multiple of the base body radius (so it scales with the cast). */
const POT_W_MUL = 0.95

export function potWidth(m: LayoutMetrics): number {
  return Math.min(m.bodyR * POT_W_MUL, m.w * 0.2)
}

export function potPos(m: LayoutMetrics): XY {
  const w = potWidth(m)
  const baseline = heroBaseline(m)
  const natural = baseline + (trayY(m) - baseline) * POT_BAND_FRAC
  // Hard floor: the pot's foot must clear the top of a plate whatever the band
  // works out to, so it can never sit on the food row.
  const floor = trayY(m) - plateWidth(m) * 0.55 - w * 0.45
  return {
    // Never let the pot hang off the right edge on a narrow screen.
    x: Math.min(m.w * POT_X_FRAC, m.w - w * 0.6),
    y: Math.min(natural, floor),
  }
}

/**
 * Drop zone for the pot. Deliberately generous — at least as roomy as the mouth's
 * — because a 4-ingredient recipe means five drags in one round and children's
 * touch accuracy collapses on the final approach to a target.
 */
export function potSnapRadius(m: LayoutMetrics): number {
  return Math.max(potWidth(m) * 0.85, px(m, 100))
}

// ─── Kitchen: the pot's own RECIPE panel ─────────────────────────────────────
//
// The pot carries its own task panel — `ingredient + ingredient + … = dish` — and
// it hangs off the pot, not off the top of the screen: the friend's bubble says
// "bring me this", the pot's panel says "cook this", and each sits on the thing it
// is about so neither needs a word of explanation.
//
// The panel HUGS the pot, on whichever side of it has room: above it by default,
// below it when above cannot hold the equation at a legible size. Which side wins
// is decided per DEVICE SHAPE, not per round (the tile size the equation lands at
// is dominated by the friend's silhouette, which does not change with the recipe),
// so the child never has to hunt for the panel between rounds.

/**
 * Tile side one recipe cell aims for, CSS px — the size a food picture reads at
 * for a 3–4yo (the tray draws its foods at 64, the request bubble at 66). The
 * equation NEVER grows past this; it shrinks from here to fit the space.
 */
export const RECIPE_TILE_CSS = 48
/**
 * Absolute floor for a recipe tile, CSS px. Only a pathologically small viewport
 * reaches it — it exists so the panel degrades to "small" instead of "inverted".
 */
const RECIPE_TILE_FLOOR_CSS = 16
/** Operator glyph (+ / =) side, as a share of a tile. */
const RECIPE_OP_FRAC = 0.42
/** Gap between two adjacent cells, as a share of a tile. */
const RECIPE_GAP_FRAC = 0.06
/** Panel padding around the equation, as a share of a tile. */
const RECIPE_PAD_X_FRAC = 0.26
const RECIPE_PAD_Y_FRAC = 0.24
/** Panel height as a multiple of the tile (one row + padding). */
const RECIPE_H_RATIO = 1 + 2 * RECIPE_PAD_Y_FRAC
/** Screen-edge margin, and the clear air kept beside the friend — width shares. */
const RECIPE_EDGE_FRAC = 0.014
const RECIPE_FRIEND_GAP_FRAC = 0.02
/** Clearance from the pot / the plate row / the friend's bubble, as a share of
 * the pot's width (so it scales with the cast, like every other kitchen number). */
const RECIPE_POT_GAP_FRAC = 0.09
/** How far the fed-friends pile reaches out from its slot, in bodyR units (the
 * minis are drawn at 0.3 scale — this leaves margin on top of that). */
const PILE_HALF_MUL = 0.45

/** Total panel width as a multiple of the tile, for `n` ingredients. */
export function recipeWidthRatio(ingredients: number): number {
  const n = Math.max(1, ingredients)
  // n ingredient tiles + 1 result tile, n−1 pluses + 1 equals, 2n gaps, padding.
  return n + 1 + n * RECIPE_OP_FRAC + 2 * n * RECIPE_GAP_FRAC + 2 * RECIPE_PAD_X_FRAC
}

/** The pot's recipe panel, as solved geometry (backing px). */
export interface RecipeBox {
  /** Panel centre. */
  x: number
  y: number
  w: number
  h: number
  /** Ingredient / result tile side. */
  tile: number
  /** Operator glyph side. */
  op: number
  /** Gap between adjacent cells. */
  gap: number
  /** Does the panel sit BELOW the pot (else above it)? */
  below: boolean
  /** Where the panel's tail meets its pot-facing edge (absolute x). */
  tailX: number
}

/**
 * The friend's silhouette half-width over a vertical span — how far the panel's
 * left edge has to stay out of the friend's way.
 *
 * The body is a blob of radius bodyR × growth, so the widest point inside a span
 * is the one nearest the friend's centre; above the blob only the head and antenna
 * remain (a fifth of the radius), and past the feet the friend is gone.
 */
function friendHalfWidthIn(m: LayoutMetrics, yTop: number, yBottom: number): number {
  const at = monsterPos(m)
  const r = m.bodyR * m.growth
  if (yBottom < at.y - r * 1.35) return 0 // clear above the antenna
  if (yTop > at.y + r) return 0 // clear below the feet
  const dy =
    yTop <= at.y && at.y <= yBottom ? 0 : Math.min(Math.abs(yTop - at.y), Math.abs(yBottom - at.y))
  const body = dy >= r ? 0 : Math.sqrt(r * r - dy * dy)
  return Math.max(body, r * 0.2)
}

/** Right edge of the fed-friends pile (it owns the bottom-left corner). */
function pileRight(m: LayoutMetrics): number {
  return miniSlot(m, 3).x + m.bodyR * PILE_HALF_MUL
}

/**
 * Solve one candidate slot: the panel's pot-facing edge is pinned at `anchor` and
 * it grows away from the pot (up when `below` is false), never past `limit`.
 *
 * The tile size and the free width are mutually dependent (a bigger tile makes a
 * taller panel, which reaches further into the friend), so this relaxes from the
 * target size down — four passes are far more than the fixed point needs.
 */
function solveRecipeSlot(
  m: LayoutMetrics,
  ingredients: number,
  anchor: number,
  limit: number,
  below: boolean,
): RecipeBox {
  const ratio = recipeWidthRatio(ingredients)
  const edge = m.w * RECIPE_EDGE_FRAC
  const right = m.w - edge
  const roomY = below ? limit - anchor : anchor - limit
  let tile = px(m, RECIPE_TILE_CSS)
  let left = edge
  for (let pass = 0; pass < 4; pass++) {
    const h = tile * RECIPE_H_RATIO
    const yTop = below ? anchor : anchor - h
    const yBottom = below ? anchor + h : anchor
    left = Math.max(
      edge,
      monsterPos(m).x + friendHalfWidthIn(m, yTop, yBottom) + m.w * RECIPE_FRIEND_GAP_FRAC,
      pileRight(m) + m.w * RECIPE_FRIEND_GAP_FRAC,
    )
    tile = Math.min(px(m, RECIPE_TILE_CSS), (right - left) / ratio, roomY / RECIPE_H_RATIO)
    if (tile <= 0) break
  }
  if (tile <= 0) return { x: 0, y: 0, w: 0, h: 0, tile: 0, op: 0, gap: 0, below, tailX: 0 }

  const w = tile * ratio
  const h = tile * RECIPE_H_RATIO
  // Centred on the pot, then pulled inside the free band (the band is at least
  // `w` wide by construction, so the two clamps can never fight).
  const x = Math.max(left + w / 2, Math.min(potPos(m).x, right - w / 2))
  const y = below ? anchor + h / 2 : anchor - h / 2
  const corner = tile * 0.5
  return {
    x,
    y,
    w,
    h,
    tile,
    op: tile * RECIPE_OP_FRAC,
    gap: tile * RECIPE_GAP_FRAC,
    below,
    tailX: Math.max(x - w / 2 + corner, Math.min(potPos(m).x, x + w / 2 - corner)),
  }
}

/**
 * Geometry of the pot's recipe panel for a recipe of `ingredients` parts.
 *
 * Two candidate slots, both touching the pot; the one that can draw the equation
 * BIGGER wins, ties going to the slot above the pot (a task panel reads best over
 * the thing it belongs to — the same rule the friend's bubble follows).
 *
 * On a 4:3 portrait iPad the friend's equator sits level with the pot and squeezes
 * the band beside it, so the panel lands under the pot in the clear strip above the
 * plate row. On both landscape shapes that strip does not exist (the pot is already
 * hugging the plates) while the air above the pot is free, so the panel goes there.
 */
export function recipePanel(m: LayoutMetrics, ingredients: number): RecipeBox {
  const pot = potPos(m)
  const potH = potWidth(m) * 0.4 // the pot is drawn w × 0.8w
  const gap = potWidth(m) * RECIPE_POT_GAP_FRAC
  const above = solveRecipeSlot(
    m,
    ingredients,
    pot.y - potH - gap,
    px(m, PANEL_CENTER_Y_CSS + PANEL_H_CSS / 2) + gap,
    false,
  )
  const below = solveRecipeSlot(
    m,
    ingredients,
    pot.y + potH + gap,
    trayY(m) - plateWidth(m) * 0.55 - gap,
    true,
  )
  const best = below.tile > above.tile ? below : above
  // Both slots collapsed (a viewport far outside anything shipped): draw the panel
  // at the floor over the pot rather than returning a degenerate box.
  if (best.tile > 0) return best
  const floor = px(m, RECIPE_TILE_FLOOR_CSS)
  return solveRecipeSlot(m, ingredients, pot.y - potH - gap, pot.y - potH - gap - floor * 40, false)
}

/** What one cell of the equation is. */
export type RecipeCellKind = 'part' | 'plus' | 'equals' | 'result'

export interface RecipeCell {
  kind: RecipeCellKind
  /** Ingredient index for a `part` (0-based); −1 for everything else. */
  index: number
  /** Offset from the panel's centre. */
  dx: number
  /** Cell side (tile for pictures, op for the glyphs). */
  size: number
}

/**
 * The equation laid out left to right: part + part + … = result. One shared
 * function so the widget that draws it and the test that checks it can never
 * disagree about where a cell is.
 */
export function recipeCells(box: RecipeBox, ingredients: number): RecipeCell[] {
  const n = Math.max(1, ingredients)
  const cells: Array<{ kind: RecipeCellKind; index: number; size: number }> = []
  for (let i = 0; i < n; i++) {
    if (i > 0) cells.push({ kind: 'plus', index: -1, size: box.op })
    cells.push({ kind: 'part', index: i, size: box.tile })
  }
  cells.push({ kind: 'equals', index: -1, size: box.op })
  cells.push({ kind: 'result', index: -1, size: box.tile })

  const total =
    cells.reduce((sum, cell) => sum + cell.size, 0) + Math.max(0, cells.length - 1) * box.gap
  let cursor = -total / 2
  return cells.map((cell) => {
    const dx = cursor + cell.size / 2
    cursor += cell.size + box.gap
    return { ...cell, dx }
  })
}

// ─── Conveyor belt ───────────────────────────────────────────────────────────
//
// The belt occupies the same band the plate row uses (trayY), full width. Unlike
// the tray — a fixed EIGHT slots stretched to fit — the belt keeps a dish at a
// constant PHYSICAL size and derives how many fit, so an iPhone in landscape
// shows more dishes than a 4:3 iPad rather than the same eight squeezed.

/** One dish's slot along the belt, CSS px (fixed physical size, see above). */
const DISH_PITCH_CSS = 128
/** Fewest dishes that still read as a belt rather than a queue. */
const MIN_VISIBLE_DISHES = 4
/** Belt band height, CSS px (running surface + its darker front edge). */
const BELT_H_CSS = 74

/** The line the dishes ride along — the same one the plates stand on. */
export function beltY(m: LayoutMetrics): number {
  return trayY(m)
}

export function beltHeight(m: LayoutMetrics): number {
  return px(m, BELT_H_CSS)
}

/** How far below the dish line the belt band centres, as a share of its height. */
const BELT_DROP_FRAC = 0.34

/**
 * Centre of the belt BAND (the running surface plus its front edge), which sits a
 * little below the dishes so they read as standing ON it.
 *
 * Clamped so the band never reaches into the home-indicator strip: on a short
 * phone-landscape viewport the tray line is already close to the physical floor,
 * and a band hanging past it would put the belt's front edge under the system
 * gesture area.
 */
export function beltBandY(m: LayoutMetrics): number {
  const h = beltHeight(m)
  const floor = m.h - m.safeInsetBottom * m.dpr - h / 2
  return Math.min(beltY(m) + h * BELT_DROP_FRAC, floor)
}

/**
 * Dish pitch in backing px. Fixed physical size, except on a viewport too narrow
 * to fit MIN_VISIBLE_DISHES of them — there it shrinks to fit rather than showing
 * two plates and calling it a conveyor.
 */
export function dishPitch(m: LayoutMetrics): number {
  return Math.min(px(m, DISH_PITCH_CSS), m.w / MIN_VISIBLE_DISHES)
}

/** How many dishes are on screen at once — derived from the viewport, not fixed. */
export function visibleDishCount(m: LayoutMetrics): number {
  return Math.max(MIN_VISIBLE_DISHES, Math.floor(m.w / dishPitch(m)))
}

/** A dish's centre, given its position along the belt in pitches from the left. */
export function beltDishPos(m: LayoutMetrics, pitchX: number): XY {
  return { x: pitchX * dishPitch(m), y: beltY(m) }
}
