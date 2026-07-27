/**
 * Icon contract for the pixel pad's rail.
 *
 * Same shape as `games/feed-the-monster/art.ts` (the house pattern): sprites live
 * in `./art/*.png`, a Vite glob turns each one into a base-aware URL, and adding
 * art is just dropping a PNG in that folder. The difference is where they land —
 * the pad is a DOM component, so these become `<img>` faces inside the buttons
 * that already exist rather than Phaser textures. `PadIcon.tsx` draws them.
 *
 * Why art at all: the rail spoke in emoji (🧽 🗑️ 🖼️) and, worse, in TEXT — a
 * `↩︎` glyph for undo and printed digits 16 / 32 / 64 on the grid-size buttons.
 * The child cannot read, so the digits were not a weak label, they were no label.
 * The three `grid-*` apples say the same thing in the only vocabulary that works:
 * the SAME apple drawn at three block resolutions, coarse → medium → fine.
 *
 * Nothing here is required: a missing PNG resolves to undefined and every caller
 * falls back to the glyph it used before, so the pad stays fully usable with no
 * art at all (and during a half-finished art pass).
 */

const ICON_URLS = import.meta.glob('./art/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** Every icon the rail knows how to draw. */
export type PadIconName =
  | 'tool-eraser'
  | 'tool-undo'
  | 'tool-trash'
  | 'tool-gallery'
  | 'tool-done'
  | 'grid-coarse'
  | 'grid-medium'
  | 'grid-fine'

/** The icon that stands for a grid resolution — what replaced the printed digits. */
export function gridIcon(size: number): PadIconName {
  return size === 16 ? 'grid-coarse' : size === 32 ? 'grid-medium' : 'grid-fine'
}

/** Base-aware URL for an icon, or undefined when the PNG has not been shipped. */
export function padIconUrl(name: PadIconName): string | undefined {
  return ICON_URLS[`./art/${name}.png`]
}
