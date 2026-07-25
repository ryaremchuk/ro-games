import { describe, expect, it } from 'vitest'
import {
  cellAt,
  cloneGrid,
  colorCounts,
  createGrid,
  decodeCells,
  encodeCells,
  isBlank,
  linePoints,
  paintCell,
  paintedCount,
  revertEdits,
} from './grid'
import type { CellEdit } from './grid'
import { PAPER } from './palette'

/** Deterministic RNG so a failing sequence is reproducible from its seed. */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

describe('grid basics', () => {
  it('starts blank and every cell is paper', () => {
    const grid = createGrid(16)
    expect(grid.w).toBe(16)
    expect(grid.h).toBe(16)
    expect(isBlank(grid)).toBe(true)
    expect(paintedCount(grid)).toBe(0)
    expect(cellAt(grid, 0, 0)).toBe(PAPER)
  })

  it('reads out of bounds as paper instead of throwing', () => {
    const grid = createGrid(16)
    expect(cellAt(grid, -1, 3)).toBe(PAPER)
    expect(cellAt(grid, 3, 16)).toBe(PAPER)
  })

  it('paintCell reports whether anything actually changed', () => {
    const grid = createGrid(16)
    expect(paintCell(grid, 2, 3, 5)).toBe(true)
    expect(paintCell(grid, 2, 3, 5), 'repainting the same colour is a no-op').toBe(false)
    expect(paintCell(grid, -1, 0, 5), 'out of bounds is a no-op').toBe(false)
    expect(paintCell(grid, 16, 0, 5)).toBe(false)
    expect(cellAt(grid, 2, 3)).toBe(5)
    expect(isBlank(grid)).toBe(false)
  })

  it('cloneGrid is a deep copy', () => {
    const grid = createGrid(16)
    paintCell(grid, 1, 1, 4)
    const copy = cloneGrid(grid)
    paintCell(copy, 2, 2, 7)
    expect(cellAt(grid, 2, 2)).toBe(PAPER)
    expect(cellAt(copy, 1, 1)).toBe(4)
  })

  it('colorCounts tallies painted cells only, paper excluded', () => {
    const grid = createGrid(16)
    paintCell(grid, 0, 0, 3)
    paintCell(grid, 1, 0, 3)
    paintCell(grid, 2, 0, 9)
    expect([...colorCounts(grid)]).toEqual([
      [3, 2],
      [9, 1],
    ])
  })
})

describe('linePoints (Bresenham)', () => {
  const cases: Array<[number, number, number, number]> = [
    [0, 0, 0, 0], // a tap
    [0, 0, 15, 0], // horizontal
    [0, 0, 0, 15], // vertical
    [0, 0, 15, 15], // perfect diagonal
    [15, 15, 0, 0], // reversed
    [0, 0, 15, 3], // shallow
    [0, 0, 3, 15], // steep
    [12, 2, 1, 14], // steep, negative x
  ]

  for (const [x0, y0, x1, y1] of cases) {
    it(`covers ${x0},${y0} → ${x1},${y1} with no gaps and no duplicates`, () => {
      const points = linePoints(x0, y0, x1, y1)
      expect(points[0]).toEqual({ x: x0, y: y0 })
      expect(points[points.length - 1]).toEqual({ x: x1, y: y1 })

      const keys = points.map((p) => `${p.x},${p.y}`)
      expect(new Set(keys).size, 'no duplicate cells').toBe(keys.length)

      // Consecutive cells always touch (8-connected): no skipped cell, which is
      // exactly the failure that makes a fast drag come out dotted.
      for (let i = 1; i < points.length; i++) {
        const dx = Math.abs(points[i].x - points[i - 1].x)
        const dy = Math.abs(points[i].y - points[i - 1].y)
        expect(Math.max(dx, dy)).toBe(1)
      }
    })
  }

  it('never skips a cell on random fast drags across a 64 grid', () => {
    const random = rng(1234)
    for (let trial = 0; trial < 400; trial++) {
      const pick = () => Math.floor(random() * 64)
      const points = linePoints(pick(), pick(), pick(), pick())
      for (let i = 1; i < points.length; i++) {
        const dx = Math.abs(points[i].x - points[i - 1].x)
        const dy = Math.abs(points[i].y - points[i - 1].y)
        expect(Math.max(dx, dy)).toBe(1)
      }
    }
  })
})

describe('stroke undo', () => {
  it('restores exactly the pre-stroke grid across a random seeded sequence', () => {
    const random = rng(99)
    const grid = createGrid(32)
    for (let stroke = 0; stroke < 60; stroke++) {
      const before = cloneGrid(grid)
      const edits: CellEdit[] = []
      const touched = new Set<number>()
      const x0 = Math.floor(random() * 32)
      const y0 = Math.floor(random() * 32)
      const x1 = Math.floor(random() * 32)
      const y1 = Math.floor(random() * 32)
      const color = 1 + Math.floor(random() * 15)
      for (const point of linePoints(x0, y0, x1, y1)) {
        const flat = point.y * grid.w + point.x
        if (touched.has(flat)) continue
        touched.add(flat)
        paintCell(grid, point.x, point.y, color, edits)
      }
      revertEdits(grid, edits)
      expect([...grid.cells]).toEqual([...before.cells])
      // Then re-apply so the grid genuinely accumulates paint across strokes.
      for (const point of linePoints(x0, y0, x1, y1)) paintCell(grid, point.x, point.y, color)
    }
  })

  it('undoing a stroke that repainted a cell puts the older colour back', () => {
    const grid = createGrid(16)
    paintCell(grid, 5, 5, 3)
    const edits: CellEdit[] = []
    paintCell(grid, 5, 5, 9, edits)
    expect(cellAt(grid, 5, 5)).toBe(9)
    revertEdits(grid, edits)
    expect(cellAt(grid, 5, 5)).toBe(3)
  })

  it('ignores edits pointing outside the grid', () => {
    const grid = createGrid(16)
    revertEdits(grid, [
      { at: -1, was: 4 },
      { at: 9999, was: 4 },
    ])
    expect(isBlank(grid)).toBe(true)
  })
})

describe('encode / decode', () => {
  for (const size of [16, 32, 64]) {
    it(`round-trips a ${size}×${size} grid`, () => {
      const random = rng(size)
      const grid = createGrid(size)
      for (let i = 0; i < grid.cells.length; i++) {
        grid.cells[i] = Math.floor(random() * 16)
      }
      const decoded = decodeCells(encodeCells(grid), size, size)
      expect([...decoded]).toEqual([...grid.cells])
    })
  }

  it('pads a short payload rather than throwing', () => {
    const small = createGrid(16)
    small.cells[0] = 7
    const decoded = decodeCells(encodeCells(small), 32, 32)
    expect(decoded).toHaveLength(32 * 32)
    expect(decoded[0]).toBe(7)
  })

  it('truncates a long payload to the declared size', () => {
    const big = createGrid(32)
    big.cells.fill(5)
    const decoded = decodeCells(encodeCells(big), 16, 16)
    expect(decoded).toHaveLength(256)
    expect([...decoded].every((c) => c === 5)).toBe(true)
  })

  it('returns a blank grid for a corrupt payload', () => {
    const decoded = decodeCells('not base64 !!!', 16, 16)
    expect(decoded).toHaveLength(256)
    expect([...decoded].every((c) => c === PAPER)).toBe(true)
  })

  it('clamps an out-of-palette index to paper', () => {
    const grid = createGrid(16)
    grid.cells[0] = 200
    const decoded = decodeCells(encodeCells(grid), 16, 16)
    expect(decoded[0]).toBe(PAPER)
  })
})
