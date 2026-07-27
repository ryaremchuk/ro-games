/**
 * Pure proportional geometry for the pixel pad, in CSS px.
 *
 * The pad has to read equally on an iPad (4:3, portrait AND landscape) and an
 * iPhone in landscape (~2.2:1), and it appears both as a full route (the studio)
 * and as an overlay over a running game. So: a square canvas as large as the space
 * beside the rail allows, and ONE tool rail on the left — on both aspect ratios,
 * so muscle memory transfers.
 *
 * The load-bearing part is that **the rail must fit**. It carries the size
 * buttons, the gallery, the eraser, undo, the bin and every colour, and a rail
 * that overflows silently clips the tools at the bottom — which is how a child
 * ends up unable to undo. So the column count is DERIVED from how many items
 * there are and how tall the rail can be, and `railFits()` is asserted in
 * layout.test.ts at every device shape.
 *
 * Touch sizes follow NN/g's ~2 cm guidance for young children, split in two:
 *  • TOOLS (undo, eraser, bin, grid size) carry the full minimum — pressing the
 *    wrong tool changes the mode, which a 4-year-old cannot undo their way out of.
 *  • SWATCHES get a smaller minimum. A wrong colour costs exactly one cell, is
 *    visible instantly, and is undone by painting over it.
 */

/** Physical minimum for a TOOL button, CSS px (~1.5 cm on an iPad at 5.2 px/mm). */
export const MIN_BUTTON_CSS = 78
/** Physical minimum for a colour swatch, CSS px (~9 mm on an iPad). */
export const MIN_SWATCH_CSS = 46
/** Swatch side as a share of the tool button. */
const SWATCH_MUL = 0.62
/** Most rail columns we will spend on tools before giving up on the canvas. */
const MAX_TOOL_COLUMNS = 5
/** Most columns the swatch grid may pack into. */
const MAX_SWATCH_COLUMNS = 8
/** Share of the rail height the TOOL zone may claim; colours get the rest. */
const TOOL_HEIGHT_SHARE = 0.66

const CANVAS_H_FRAC = 0.9
const GAP_FRAC = 0.02

// ─── Easel ───────────────────────────────────────────────────────────────────
//
// The pad is dressed as an easel: a wooden frame around the paper, a ledge under
// it and, when the box is tall enough, splayed legs. That is not decoration for
// its own sake — the pad opens over a running game, and a bare white square over
// a live scene reads as a system dialog rather than as a thing in the world.
//
// The rule that keeps it honest: the easel is built from what is LEFT after the
// instrument has been sized, never by taking room from it. The frame's thickness
// is a share of the paper (so it looks the same on every device) and the legs are
// simply skipped when the leftover height cannot hold them.

/** Frame thickness as a share of the paper's side. */
const EASEL_BORDER_FRAC = 0.055
/** Frame thickness bounds, CSS px — thin enough to stay furniture, thick enough to read. */
const EASEL_BORDER_MIN = 12
const EASEL_BORDER_MAX = 30
/** Ledge depth, in frame thicknesses. */
const EASEL_LEDGE_MUL = 1.7
/**
 * Ledge depth floor, in tool-button sides. The done button (1.2 buttons across)
 * rests centred on the ledge, so this fixes how far it overhangs: at 0.9 it
 * overhangs 0.15 of a button top and bottom, which the frame's own thickness
 * covers above (EASEL_BORDER_MIN ≥ 0.15 × MIN_BUTTON_CSS).
 */
const LEDGE_BUTTON_MUL = 0.9
/** Leg length, in frame thicknesses. */
const EASEL_LEG_MUL = 2.2
/**
 * Smallest share of the box height the paper may shrink to in order to pay for
 * legs. Above it the easel gets its silhouette; below it the instrument wins and
 * the board just rests on its shelf.
 */
const EASEL_MIN_PAPER_FRAC = 0.62
/**
 * Smallest paper the easel may be worn on at all, CSS px: 16 cells × 18 css px,
 * which is ~3 mm a cell on a phone (5.9 css/mm) — NN/g's floor for this age, below
 * which a finger cannot reliably hit one cell. A box shorter than this gets a bare
 * pad instead of a frame.
 */
const EASEL_MIN_PAPER_CSS = 16 * 18

/** The easel chrome around the paper, CSS px. Zeroed when `legs` does not fit. */
export interface PadEasel {
  /** Wooden frame around the paper, all four sides. */
  border: number
  /** Ledge under the frame — the shelf the finish button rests on. */
  ledge: number
  /** Splayed legs below the ledge; 0 on a box too short for them. */
  legs: number
}

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

/** How many things the rail has to hold. */
export interface RailContents {
  /** Full-size buttons: grid sizes, gallery, eraser, undo, bin. */
  tools: number
  /** Colour swatches. */
  swatches: number
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
  /** Gap between rail items, CSS px. */
  gap: number
  /** Tool button side, CSS px. */
  button: number
  /** Swatch side, CSS px. */
  swatch: number
  /** Rail columns for tools. */
  toolColumns: number
  /** Rail columns for swatches (denser than tools). */
  swatchColumns: number
  /** Easel chrome, or null for a bare pad. */
  easel: PadEasel | null
}

/** Height one zone needs: `count` items of `side`, packed into `columns`. */
function zoneHeight(count: number, side: number, gap: number, columns: number): number {
  return Math.ceil(count / Math.max(1, columns)) * (side + gap)
}

/** Width one zone needs. */
function zoneWidth(count: number, side: number, gap: number, columns: number): number {
  const used = Math.min(count, Math.max(1, columns))
  return used * side + (used - 1) * gap
}

/** Does everything the rail carries actually fit inside it? */
export function railFits(layout: PadLayout, contents: RailContents): boolean {
  const tools = zoneHeight(contents.tools, layout.button, layout.gap, layout.toolColumns)
  const swatches = zoneHeight(contents.swatches, layout.swatch, layout.gap, layout.swatchColumns)
  const widest = Math.max(
    zoneWidth(contents.tools, layout.button, layout.gap, layout.toolColumns),
    zoneWidth(contents.swatches, layout.swatch, layout.gap, layout.swatchColumns),
  )
  return tools + swatches <= layout.railH + 0.5 && widest <= layout.railW - layout.gap * 2 + 0.5
}

/**
 * Where the canvas and the rail sit.
 *
 * The rail claims its space first — a tool the child cannot reach is worse than a
 * smaller canvas — then the canvas takes the largest square that fits what is
 * left. Column counts are the FEWEST that make each zone fit its share of the
 * height: tools spread sideways first (they are big), then the swatch grid packs
 * into as many columns as its remaining height needs. The rail is as wide as the
 * wider of the two zones, so neither can spill out of it.
 */
export function padLayout(
  m: PadMetrics,
  contents: RailContents = { tools: 7, swatches: 15 },
  framed = false,
): PadLayout {
  const gap = Math.max(8, Math.min(m.vw, m.vh) * GAP_FRAC)
  const chromeTop = Math.max(0, m.chromeTop ?? 0)
  const railH = Math.max(MIN_BUTTON_CSS, m.vh - chromeTop - gap)
  // Proportional to the shorter axis, never below the physical touch minimum.
  const button = Math.max(MIN_BUTTON_CSS, Math.min(m.vw, m.vh) * 0.11)
  const swatch = Math.max(MIN_SWATCH_CSS, button * SWATCH_MUL)

  // Tools first: the fewest columns whose rows fit their share of the rail.
  let toolColumns = MAX_TOOL_COLUMNS
  for (let columns = 1; columns <= MAX_TOOL_COLUMNS; columns++) {
    if (zoneHeight(contents.tools, button, gap, columns) <= railH * TOOL_HEIGHT_SHARE) {
      toolColumns = columns
      break
    }
  }
  const toolsH = zoneHeight(contents.tools, button, gap, toolColumns)

  // Then the colours, into whatever is left.
  let swatchColumns = MAX_SWATCH_COLUMNS
  for (let columns = 1; columns <= MAX_SWATCH_COLUMNS; columns++) {
    if (zoneHeight(contents.swatches, swatch, gap, columns) <= railH - toolsH) {
      swatchColumns = columns
      break
    }
  }

  const railW =
    Math.max(
      zoneWidth(contents.tools, button, gap, toolColumns),
      zoneWidth(contents.swatches, swatch, gap, swatchColumns),
    ) +
    gap * 2
  const railX = gap
  const railY = Math.min(chromeTop, Math.max(0, m.vh - railH))

  const availableW = Math.max(m.vw - railW - gap * 2, button)
  const bare = Math.max(Math.min(m.vh * CANVAS_H_FRAC, availableW, m.vh - gap * 2), button)

  // The frame is sized from the paper it would go around, then the paper is
  // re-sized to leave room for it. Two passes rather than one because each
  // depends on the other, and a fixed-px frame would be a different fraction of
  // the drawing on every device.
  const border = framed
    ? Math.round(Math.min(EASEL_BORDER_MAX, Math.max(EASEL_BORDER_MIN, bare * EASEL_BORDER_FRAC)))
    : 0
  // The ledge is also the shelf the finish button rests on, so it is never
  // shallower than that button — a button floating over a hairline shelf is what
  // makes a frame look pasted on rather than built.
  const ledge = framed
    ? Math.round(Math.max(border * EASEL_LEDGE_MUL, button * LEDGE_BUTTON_MUL))
    : 0
  /** The paper that fits once the frame, the ledge and (maybe) legs are paid for. */
  const paperWith = (legs: number): number =>
    Math.max(
      Math.min(
        availableW - border * 2,
        m.vh - gap * 2 - border * 2 - ledge - legs,
        m.vh * CANVAS_H_FRAC,
      ),
      button,
    )

  // Legs are RESERVED up front, not given the leftovers — height is always fully
  // spent, so waiting for a surplus means they never appear at all. They are then
  // dropped again if paying for them would shrink the paper below what is
  // comfortable to draw on, because a stubby leg reads as a bug.
  const wantLegs = Math.round(border * EASEL_LEG_MUL)
  const legs =
    framed && paperWith(wantLegs) >= Math.min(availableW - border * 2, m.vh * EASEL_MIN_PAPER_FRAC)
      ? wantLegs
      : 0
  const framedSide = paperWith(legs)
  // THE INSTRUMENT WINS. Below this the whole easel goes, not just its legs: on a
  // phone in landscape the box is short enough that a frame would push a 16-grid
  // cell under the size a 3-year-old can hit at all, and a prettier pad that
  // cannot be drawn on is not a trade — it is a regression.
  const dressed = framed && framedSide >= EASEL_MIN_PAPER_CSS
  const side = dressed ? framedSide : bare
  const easel: PadEasel | null = dressed ? { border, ledge, legs } : null

  // Centre the whole easel (paper + frame + ledge + legs) in the space right of
  // the rail, so the paper itself sits slightly high — which is where a board on a
  // real easel sits. Read the chrome back off `easel`, never off the provisional
  // border/ledge above: an undressed pad must land in EXACTLY the position it had
  // before the easel existed.
  const chrome = easel ?? { border: 0, ledge: 0, legs: 0 }
  const blockW = side + chrome.border * 2
  const blockH = side + chrome.border * 2 + chrome.ledge + chrome.legs
  const canvasX =
    railX + railW + gap + chrome.border + Math.max(0, (m.vw - railW - gap * 2 - blockW) / 2)
  const canvasY = Math.max(0, (m.vh - blockH) / 2) + chrome.border

  return {
    side,
    canvasX,
    canvasY,
    railX,
    railY,
    railW,
    railH,
    gap,
    button,
    swatch,
    toolColumns,
    swatchColumns,
    easel,
  }
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
