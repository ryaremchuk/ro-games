import { describe, expect, it } from 'vitest'
import { MIN_BUTTON_CSS, cellFromPoint, cellSize, padLayout } from './layout'

/** The two shapes every layout in this app must read on. */
const ASPECTS = [
  { name: 'iPad 4:3 portrait', vw: 834, vh: 1112 },
  { name: 'iPad 4:3 landscape', vw: 1112, vh: 834 },
  { name: 'iPhone landscape ~2.2:1', vw: 852, vh: 393 },
]

describe('padLayout', () => {
  for (const aspect of ASPECTS) {
    describe(aspect.name, () => {
      const layout = padLayout(aspect)

      it('keeps the canvas square and fully on screen', () => {
        expect(layout.side).toBeGreaterThan(0)
        expect(layout.canvasX).toBeGreaterThanOrEqual(0)
        expect(layout.canvasY).toBeGreaterThanOrEqual(0)
        expect(layout.canvasX + layout.side).toBeLessThanOrEqual(aspect.vw + 0.5)
        expect(layout.canvasY + layout.side).toBeLessThanOrEqual(aspect.vh + 0.5)
      })

      it('never overlaps the tool rail', () => {
        expect(layout.canvasX).toBeGreaterThanOrEqual(layout.railX + layout.railW)
      })

      it('gives rail buttons the physical touch minimum', () => {
        expect(layout.button).toBeGreaterThanOrEqual(MIN_BUTTON_CSS)
      })

      it('keeps the rail on screen', () => {
        expect(layout.railX + layout.railW).toBeLessThanOrEqual(aspect.vw)
        expect(layout.railY + layout.railH).toBeLessThanOrEqual(aspect.vh + 0.5)
      })

      it('clears the shell chrome pinned top-left when asked to', () => {
        const reserved = padLayout({ ...aspect, chromeTop: 76 })
        expect(reserved.railY).toBeGreaterThanOrEqual(Math.min(76, aspect.vh - reserved.railH))
        expect(reserved.railY + reserved.railH).toBeLessThanOrEqual(aspect.vh + 0.5)
      })
    })
  }

  it('packs the rail two-up only on a short viewport', () => {
    expect(padLayout({ vw: 834, vh: 1112 }).railColumns).toBe(1)
    expect(padLayout({ vw: 852, vh: 393 }).railColumns).toBe(2)
  })

  it('grows the canvas with the viewport (proportional, not pinned px)', () => {
    const small = padLayout({ vw: 834, vh: 1112 })
    const big = padLayout({ vw: 1668, vh: 2224 })
    expect(big.side).toBeGreaterThan(small.side)
  })

  it('survives a degenerate box without producing negatives', () => {
    const tiny = padLayout({ vw: 1, vh: 1 })
    expect(tiny.side).toBeGreaterThan(0)
    expect(tiny.railW).toBeGreaterThan(0)
    expect(Number.isFinite(tiny.canvasX)).toBe(true)
  })

  it('keeps a 16-grid cell comfortably fat on an iPad', () => {
    const layout = padLayout({ vw: 834, vh: 1112 })
    // ~5.2 css px per mm on a 10.2" iPad: this is the "8-9 mm cell" the design
    // relies on, and the reason 16×16 is the default everywhere.
    expect(cellSize(layout.side, 16) / 5.2).toBeGreaterThan(6)
  })
})

describe('cellFromPoint', () => {
  it('maps the corners and the centre of a 16 grid', () => {
    expect(cellFromPoint({ x: 0, y: 0 }, 320, 16)).toEqual({ x: 0, y: 0 })
    expect(cellFromPoint({ x: 319, y: 319 }, 320, 16)).toEqual({ x: 15, y: 15 })
    expect(cellFromPoint({ x: 160, y: 160 }, 320, 16)).toEqual({ x: 8, y: 8 })
  })

  it('reports out-of-canvas points as out-of-range cells (caller clamps)', () => {
    expect(cellFromPoint({ x: -4, y: 10 }, 320, 16).x).toBeLessThan(0)
    expect(cellFromPoint({ x: 340, y: 10 }, 320, 16).x).toBeGreaterThan(15)
  })
})
