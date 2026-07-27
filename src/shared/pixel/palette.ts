/**
 * The pixel pad's fixed palette — shared, because every game that renders a
 * child-made sprite has to resolve the same colour indices.
 *
 * Index 0 is ALWAYS "paper": stored as transparent, drawn as a warm sheet colour
 * so the child never sees a checkerboard (see PixelPad). Every other index is an
 * opaque hex. The list is deliberately fixed and small: no colour picker, no
 * recents, nothing for a non-reader to get lost in.
 *
 * The 15 hues cover the six food accents (logic.COLOR_HEX in Feed the Monster)
 * so a commissioned "draw something red" lands unambiguously on the red bucket,
 * plus the pair that actually makes pixel art read — an ink outline and a
 * shadow-brown — and one skin tone.
 */

/** Stored value of an unpainted cell. Renders as PAPER_HEX, exports as alpha 0. */
export const PAPER = 0

/** What an unpainted cell LOOKS like (warm sheet, never white-on-white). */
export const PAPER_HEX = '#fdf6e8'

/**
 * Palette index → hex. Index 0 is paper (transparent on export); a `Drawing`
 * carries its own copy of this array so a saved sprite survives a palette edit.
 */
export const PALETTE: readonly string[] = [
  PAPER_HEX, // 0 — paper (transparent)
  '#3d3a4b', // 1 — ink (outlines; the app's shared INK)
  '#ffffff', // 2 — white
  '#e5484d', // 3 — red
  '#ff8fab', // 4 — pink
  '#ffa94d', // 5 — orange
  '#ffd93d', // 6 — yellow
  '#6bcb77', // 7 — green
  '#2f9e44', // 8 — deep green
  '#4d96ff', // 9 — blue
  '#00b4d8', // 10 — cyan
  '#9b5de5', // 11 — purple
  '#b08968', // 12 — brown
  '#6b4f3a', // 13 — shadow brown
  '#ffd8a8', // 14 — skin
  '#9aa0a6', // 15 — grey
]

/** Paintable swatches (everything but paper), in rail order. */
export const SWATCHES: readonly number[] = PALETTE.map((_, i) => i).slice(1)

/** `#rrggbb` → 0xrrggbb, for tinting and colour maths. */
export function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16)
}

/** A palette index's channels, 0..255 — for nearest-colour matching. */
export function rgbOf(index: number): { r: number; g: number; b: number } {
  const value = hexToInt(PALETTE[index] ?? PAPER_HEX)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}
