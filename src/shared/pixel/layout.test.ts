import { describe, expect, it } from 'vitest'
import {
  MIN_BUTTON_CSS,
  MIN_SWATCH_CSS,
  cellFromPoint,
  cellSize,
  padLayout,
  railFits,
} from './layout'
import { SWATCHES } from './palette'

/** The shapes every layout in this app must read on. */
const ASPECTS = [
  { name: 'iPad 4:3 portrait', vw: 834, vh: 1112 },
  { name: 'iPad 4:3 landscape', vw: 1112, vh: 834 },
  { name: 'iPhone landscape ~2.2:1', vw: 852, vh: 393 },
]

/** The studio's rail: 16/32/64 + gallery + eraser + undo + bin, and every colour. */
const STUDIO = { tools: 7, swatches: SWATCHES.length }
/** A commission overlay's rail: eraser + undo + bin only. */
const OVERLAY = { tools: 3, swatches: SWATCHES.length }
/** The shell pins home + level top-left, so the studio reserves that strip. */
const CHROME = 76

describe('padLayout', () => {
  for (const aspect of ASPECTS) {
    for (const [label, contents] of [
      ['studio rail', STUDIO],
      ['overlay rail', OVERLAY],
    ] as const) {
      describe(`${aspect.name} · ${label}`, () => {
        const layout = padLayout({ ...aspect, chromeTop: CHROME }, contents)

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

        it('EVERY rail item fits — a clipped rail hides undo, which is unforgivable', () => {
          expect(railFits(layout, contents)).toBe(true)
        })

        it('gives tools the full touch minimum and swatches their own', () => {
          expect(layout.button).toBeGreaterThanOrEqual(MIN_BUTTON_CSS)
          expect(layout.swatch).toBeGreaterThanOrEqual(MIN_SWATCH_CSS)
        })

        it('keeps the rail on screen and clear of the shell chrome', () => {
          expect(layout.railX + layout.railW).toBeLessThanOrEqual(aspect.vw)
          expect(layout.railY).toBeGreaterThanOrEqual(Math.min(CHROME, aspect.vh - layout.railH))
          expect(layout.railY + layout.railH).toBeLessThanOrEqual(aspect.vh + 0.5)
        })
      })
    }
  }

  it('spends more rail columns only when it has to', () => {
    // A tall viewport fits the studio rail in a couple of columns; a 393-tall
    // phone-landscape needs several, and that is the trade the canvas pays for.
    const tall = padLayout({ vw: 834, vh: 1112, chromeTop: CHROME }, STUDIO)
    const short = padLayout({ vw: 852, vh: 393, chromeTop: CHROME }, STUDIO)
    expect(short.toolColumns).toBeGreaterThan(tall.toolColumns)
    expect(short.swatchColumns).toBeGreaterThan(tall.swatchColumns)
  })

  it('makes the rail as wide as its WIDER zone, so neither can spill out', () => {
    for (const aspect of ASPECTS) {
      for (const contents of [STUDIO, OVERLAY]) {
        const layout = padLayout({ ...aspect, chromeTop: CHROME }, contents)
        const toolsW =
          Math.min(contents.tools, layout.toolColumns) * layout.button +
          (Math.min(contents.tools, layout.toolColumns) - 1) * layout.gap
        const swatchesW =
          Math.min(contents.swatches, layout.swatchColumns) * layout.swatch +
          (Math.min(contents.swatches, layout.swatchColumns) - 1) * layout.gap
        expect(layout.railW).toBeGreaterThanOrEqual(Math.max(toolsW, swatchesW))
      }
    }
  })

  it('a rail with fewer tools leaves more room for the canvas', () => {
    const studio = padLayout({ vw: 834, vh: 1112, chromeTop: CHROME }, STUDIO)
    const overlay = padLayout({ vw: 834, vh: 1112, chromeTop: CHROME }, OVERLAY)
    expect(overlay.side).toBeGreaterThanOrEqual(studio.side)
  })

  it('grows the canvas with the viewport (proportional, not pinned px)', () => {
    const small = padLayout({ vw: 834, vh: 1112 }, STUDIO)
    const big = padLayout({ vw: 1668, vh: 2224 }, STUDIO)
    expect(big.side).toBeGreaterThan(small.side)
  })

  it('survives a degenerate box without producing negatives', () => {
    const tiny = padLayout({ vw: 1, vh: 1 }, STUDIO)
    expect(tiny.side).toBeGreaterThan(0)
    expect(tiny.railW).toBeGreaterThan(0)
    expect(Number.isFinite(tiny.canvasX)).toBe(true)
  })

  it('keeps a 16-grid cell comfortably fat on an iPad, in both orientations', () => {
    // ~5.2 css px per mm on a 10.2" iPad. NN/g: 10 mm beats 7 mm and 4 mm is "a
    // disaster". 16×16 is the default precisely because it clears that on the
    // target device — ~9 mm held landscape, ~6.8 mm portrait, where the rail's
    // second column costs the canvas some width.
    const portrait = padLayout({ ...ASPECTS[0], chromeTop: CHROME }, STUDIO)
    const landscape = padLayout({ ...ASPECTS[1], chromeTop: CHROME }, STUDIO)
    expect(cellSize(portrait.side, 16) / 5.2).toBeGreaterThan(6)
    expect(cellSize(landscape.side, 16) / 5.2).toBeGreaterThan(8)
  })

  it('keeps a 16-grid cell above the disaster line even on a phone', () => {
    const layout = padLayout({ vw: 852, vh: 393, chromeTop: CHROME }, STUDIO)
    // ~5.9 css px per mm in iPhone-landscape. 64×64 there is a novelty, not a
    // workflow — but 16×16 must still be paintable.
    expect(cellSize(layout.side, 16) / 5.9).toBeGreaterThan(3)
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
