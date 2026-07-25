/**
 * The pixel pad's DATA — a grid of palette indices, and the pure operations on
 * it. No DOM, no Phaser: everything here is deterministic and unit-tested
 * (grid.test.ts), which is what lets the pad itself stay a thin render layer.
 *
 * The grid IS the bitmap: one byte per cell, `w × h` of them, upscaled with
 * nearest-neighbour when drawn. That is also why a saved drawing is reusable as
 * a sprite in any other game — see artStore.ts / drawingTexture.ts.
 */

import { PALETTE, PAPER } from './palette'

/** The three precision steps (cell size halves each way up the ladder). */
export type GridSize = 16 | 32 | 64

export const GRID_SIZES: readonly GridSize[] = [16, 32, 64]

/** The size a pad opens at unless a commission asks for another. */
export const DEFAULT_GRID_SIZE: GridSize = 16

export interface Grid {
  w: number
  h: number
  /** One palette index per cell, row-major. PAPER (0) = unpainted. */
  cells: Uint8Array
}

export function createGrid(size: number): Grid {
  return { w: size, h: size, cells: new Uint8Array(size * size) }
}

export function cloneGrid(grid: Grid): Grid {
  return { w: grid.w, h: grid.h, cells: new Uint8Array(grid.cells) }
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.w && y < grid.h
}

export function cellAt(grid: Grid, x: number, y: number): number {
  return inBounds(grid, x, y) ? grid.cells[y * grid.w + x] : PAPER
}

/** One reverted cell of a stroke — the undo stack is a list of these. */
export interface CellEdit {
  /** Flat cell index (`y * w + x`). */
  at: number
  /** What the cell held BEFORE the stroke touched it. */
  was: number
}

/**
 * Paint one cell, recording what it held so the stroke can be undone. Returns
 * false when nothing changed — out of bounds, or the cell already holds this
 * colour — so the caller can skip the tick sound and keep undo exact.
 */
export function paintCell(
  grid: Grid,
  x: number,
  y: number,
  color: number,
  into?: CellEdit[],
): boolean {
  if (!inBounds(grid, x, y)) return false
  const at = y * grid.w + x
  const was = grid.cells[at]
  if (was === color) return false
  grid.cells[at] = color
  into?.push({ at, was })
  return true
}

/** Undo a stroke: put every recorded cell back, newest edit first. */
export function revertEdits(grid: Grid, edits: readonly CellEdit[]): void {
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit = edits[i]
    if (edit.at >= 0 && edit.at < grid.cells.length) grid.cells[edit.at] = edit.was
  }
}

/**
 * Every cell on the line between two samples, endpoints included (Bresenham).
 * A fast drag across a 64 grid only reports a handful of pointer samples; without
 * this the stroke comes out as dotted, which is the single most common way a
 * pixel editor feels broken.
 */
export function linePoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = []
  let x = Math.round(x0)
  let y = Math.round(y0)
  const ex = Math.round(x1)
  const ey = Math.round(y1)
  const dx = Math.abs(ex - x)
  const dy = Math.abs(ey - y)
  const sx = x < ex ? 1 : -1
  const sy = y < ey ? 1 : -1
  let err = dx - dy
  for (;;) {
    points.push({ x, y })
    if (x === ex && y === ey) return points
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

/** Nothing painted at all — a blank page is never filed and never a food. */
export function isBlank(grid: Grid): boolean {
  return !grid.cells.some((cell) => cell !== PAPER)
}

/** How many cells carry paint (the precision meter's raw material). */
export function paintedCount(grid: Grid): number {
  let n = 0
  for (const cell of grid.cells) if (cell !== PAPER) n++
  return n
}

/** Painted cells per palette index, paper excluded. Deterministic order. */
export function colorCounts(grid: Grid): Map<number, number> {
  const counts = new Map<number, number>()
  for (const cell of grid.cells) {
    if (cell === PAPER) continue
    counts.set(cell, (counts.get(cell) ?? 0) + 1)
  }
  return new Map([...counts].sort((a, b) => a[0] - b[0]))
}

// ─── Serialization (base64 of one byte per cell) ──────────────────────────────

// btoa takes a string; a 64×64 grid is 4096 bytes, so chunk the fromCharCode
// spread rather than risk an argument-count limit on a bigger grid later.
const CHUNK = 1024

export function encodeCells(grid: Grid): string {
  let binary = ''
  for (let i = 0; i < grid.cells.length; i += CHUNK) {
    binary += String.fromCharCode(...grid.cells.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * Decode `w × h` cells. Tolerates a short/long/corrupt payload by padding or
 * truncating to the expected length — a garbled localStorage entry must degrade
 * to a partial drawing, never throw inside a render.
 */
export function decodeCells(encoded: string, w: number, h: number): Uint8Array {
  const expected = w * h
  const cells = new Uint8Array(expected)
  let binary: string
  try {
    binary = atob(encoded)
  } catch {
    return cells
  }
  const n = Math.min(binary.length, expected)
  for (let i = 0; i < n; i++) {
    const value = binary.charCodeAt(i)
    cells[i] = value < PALETTE.length ? value : PAPER
  }
  return cells
}
