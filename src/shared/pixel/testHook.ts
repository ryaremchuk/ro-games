/**
 * Dev/e2e hook for the pixel pad.
 *
 * The pad is DOM, so a spec CAN drive it with real pointer drags (and one spec
 * does exactly that, to prove Bresenham paints a contiguous run). But a
 * commission spec that only wants "a drawing exists and the monster eats it"
 * should not have to paint 40 cells by hand — hence `paint()`.
 *
 * Installed only when the mounting surface passes `exposeTestApi` (dev builds or
 * `?e2e` / `?dev`), never in normal play. Mirrors the other games' test hooks.
 */

export interface PixelPadState {
  size: number
  /** Active palette index. */
  color: number
  eraser: boolean
  /** Cells carrying paint. */
  painted: number
  blank: boolean
  /** Strokes currently undoable. */
  undoDepth: number
  /** The commissioned colour as a hex, when the pad was asked for one. */
  askColor: string | null
  /** Canvas box in CSS px, for real-pointer drags. */
  canvasCss: { x: number; y: number; side: number }
  /** One cell's side in CSS px — how big a block is under a finger. */
  cellCss: number
}

export interface PixelPadTestApi {
  state: () => PixelPadState
  /** Paint cells directly (one undo step), bypassing pointer input. */
  paint: (cells: Array<{ x: number; y: number; color: number }>) => void
  /** Press done: files a non-blank page and hands it to the consumer. */
  done: () => void
}

declare global {
  interface Window {
    /** Dev/e2e-only handle to the mounted pixel pad. */
    __pixelPad?: PixelPadTestApi
  }
}
