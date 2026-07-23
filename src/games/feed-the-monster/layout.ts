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
