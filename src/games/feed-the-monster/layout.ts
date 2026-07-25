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
 * Generous feed drop zone, centered on the visible mouth. Slightly roomier than
 * a tight mouth radius so a 3–4yo who releases a touch above the open mouth
 * still lands the food.
 */
export function snapRadius(m: LayoutMetrics): number {
  return Math.max(m.bodyR * 0.9 * m.growth, px(m, 100))
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
