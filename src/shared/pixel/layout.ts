/**
 * Pure proportional geometry for the pixel pad, in CSS px.
 *
 * The pad has to read equally on an iPad (4:3) and an iPhone in landscape
 * (~2.2:1), and it appears both as a full route (the studio) and as an overlay
 * over a running game. So: a square canvas as large as the shorter axis allows,
 * and ONE tool rail on the long side — left on both aspect ratios so muscle
 * memory transfers.
 *
 * Everything is a fraction of the viewport (house rule), with fixed px appearing
 * only as the physical minimum for a touch target: NN/g recommends ~2 cm for
 * young children, and while no grid we can fit reaches 2 cm per CELL, the rail
 * BUTTONS must (painting is forgiving, pressing the wrong tool is not).
 */

/** Physical minimum for a rail button, CSS px (~1.5 cm on an iPad at 5.2 px/mm). */
export const MIN_BUTTON_CSS = 78
/** Below this the rail would eat the canvas — buttons pack two-up instead. */
export const RAIL_TWO_COLUMN_MAX_H = 620

const CANVAS_H_FRAC = 0.9
const CANVAS_W_FRAC = 0.62
const GAP_FRAC = 0.02

export interface PadMetrics {
  /** Visible viewport width in CSS px. */
  vw: number
  /** Visible viewport height in CSS px. */
  vh: number
  /**
   * Strip at the top-LEFT the rail must stay clear of, CSS px. The shell pins
   * the home button and the level badge there (GameFrame), and the rail is on
   * the left too — without this reserve the top swatch sits under the home
   * button. 0 for a surface that owns its whole box.
   */
  chromeTop?: number
}

export interface PadLayout {
  /** Side of the square painting canvas, CSS px. */
  side: number
  /** Canvas top-left, CSS px. */
  canvasX: number
  canvasY: number
  /** Tool rail box, CSS px. */
  railX: number
  railY: number
  railW: number
  railH: number
  /** Swatch/tool button side, CSS px. */
  button: number
  /** Swatch columns in the rail (2 on short screens so the rail stays short). */
  railColumns: number
}

/**
 * Where the canvas and the rail sit. The rail claims its minimum first (a tool
 * the child cannot hit is worse than a smaller canvas), then the canvas takes
 * the largest square that fits what is left.
 */
export function padLayout(m: PadMetrics): PadLayout {
  const gap = Math.max(8, Math.min(m.vw, m.vh) * GAP_FRAC)
  const railColumns = m.vh < RAIL_TWO_COLUMN_MAX_H ? 2 : 1
  // The rail is sized off the SHORTER axis so it stays proportional, but never
  // below the physical touch minimum.
  const button = Math.max(MIN_BUTTON_CSS, Math.min(m.vw, m.vh) * 0.11)
  const railW = button * railColumns + gap * (railColumns + 1)

  const availableW = Math.max(m.vw - railW - gap * 2, button)
  const side = Math.max(
    Math.min(m.vh * CANVAS_H_FRAC, m.vw * CANVAS_W_FRAC, availableW, m.vh - gap * 2),
    button,
  )

  const railX = gap
  const chromeTop = Math.max(0, m.chromeTop ?? 0)
  const railH = Math.max(button, m.vh - chromeTop - gap)
  const railY = Math.min(chromeTop, Math.max(0, m.vh - railH))
  // Centre the canvas in the space right of the rail.
  const canvasX = railX + railW + gap + Math.max(0, (m.vw - railW - gap * 2 - side) / 2)
  const canvasY = (m.vh - side) / 2

  return { side, canvasX, canvasY, railX, railY, railW, railH, button, railColumns }
}

/** Which grid cell a CSS-px point inside the canvas belongs to (may be OOB). */
export function cellFromPoint(
  point: { x: number; y: number },
  side: number,
  gridSize: number,
): { x: number; y: number } {
  const cell = side / gridSize
  return { x: Math.floor(point.x / cell), y: Math.floor(point.y / cell) }
}

/** Cell side in CSS px — how big one painted block actually is under a finger. */
export function cellSize(side: number, gridSize: number): number {
  return side / gridSize
}
