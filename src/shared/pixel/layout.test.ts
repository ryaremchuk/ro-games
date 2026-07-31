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

describe('the easel', () => {
  /** The FTM overlay is a slide-up panel, not the whole screen (PAD_TOP_FRAC). */
  const OVERLAY_SHAPES = [
    { name: 'iPad landscape overlay', vw: 1112, vh: Math.round(834 * 0.8) },
    { name: 'iPhone landscape overlay', vw: 852, vh: Math.round(393 * 0.8) },
  ]
  const SHAPES = [...ASPECTS, ...OVERLAY_SHAPES]

  /** Shapes roomy enough to wear the easel at all (see EASEL_MIN_PAPER_CSS). */
  const DRESSED = SHAPES.filter(
    (aspect) => padLayout({ ...aspect, chromeTop: CHROME }, OVERLAY, true).easel !== null,
  )

  it('dresses the iPad in every orientation, and never a phone in landscape', () => {
    // Not a preference: on a 393-tall box a frame would push a 16-grid cell under
    // the ~3 mm a 3-year-old can hit, so the instrument keeps the room.
    expect(DRESSED.map((a) => a.name)).toEqual([
      'iPad 4:3 portrait',
      'iPad 4:3 landscape',
      'iPad landscape overlay',
    ])
  })

  for (const aspect of DRESSED) {
    describe(aspect.name, () => {
      const framed = padLayout({ ...aspect, chromeTop: CHROME }, OVERLAY, true)
      const bare = padLayout({ ...aspect, chromeTop: CHROME }, OVERLAY, false)
      const easel = framed.easel!

      it('is there at all, with a frame and a ledge', () => {
        expect(easel).not.toBeNull()
        expect(easel.border).toBeGreaterThanOrEqual(12)
        expect(easel.ledge).toBeGreaterThan(easel.border)
      })

      it('fits the WHOLE easel on screen — frame, ledge and legs', () => {
        // The chrome is what gets clipped first if the geometry is wrong, and a
        // half-drawn leg is the most obvious "broken" a parent will ever see.
        expect(framed.canvasX - easel.border).toBeGreaterThanOrEqual(0)
        expect(framed.canvasY - easel.border).toBeGreaterThanOrEqual(0)
        expect(framed.canvasX + framed.side + easel.border).toBeLessThanOrEqual(aspect.vw + 0.5)
        const bottom = framed.canvasY + framed.side + easel.border + easel.ledge + easel.legs
        expect(bottom).toBeLessThanOrEqual(aspect.vh + 0.5)
      })

      it('never lets the frame reach into the tool rail', () => {
        // The canvas alone clearing the rail is not enough once it wears a frame.
        expect(framed.canvasX - easel.border).toBeGreaterThanOrEqual(framed.railX + framed.railW)
      })

      it('EVERY rail item still fits — the frame may not cost the child undo', () => {
        expect(railFits(framed, OVERLAY)).toBe(true)
        expect(framed.button).toBeGreaterThanOrEqual(MIN_BUTTON_CSS)
        expect(framed.swatch).toBeGreaterThanOrEqual(MIN_SWATCH_CSS)
      })

      it('charges the paper for the frame, but not ruinously', () => {
        // It must cost something (else it is drawn over the drawing) and it must
        // not cost much (the paper IS the instrument).
        expect(framed.side).toBeLessThan(bare.side)
        expect(framed.side).toBeGreaterThan(bare.side * 0.6)
      })

      it('keeps a 16-grid cell paintable with the frame on', () => {
        // Same disaster line as the bare pad: ~4 mm is unusable at this age.
        expect(cellSize(framed.side, 16) / 5.9).toBeGreaterThan(3)
      })
    })
  }

  it('gives the roomy shapes their legs, all-or-nothing', () => {
    // Legs are paid for up front where the paper can afford it and dropped
    // entirely where it cannot — a stubby leg reads as a rendering bug.
    const ipad = padLayout({ vw: 1112, vh: 834, chromeTop: CHROME }, OVERLAY, true)
    expect(ipad.easel!.legs).toBeGreaterThan(0)
  })

  it('leaves a phone in landscape EXACTLY as it was before the easel existed', () => {
    // The fallback must be the old pad, not a squeezed one.
    const phone = { vw: 852, vh: 393, chromeTop: CHROME }
    const framed = padLayout(phone, OVERLAY, true)
    const bare = padLayout(phone, OVERLAY, false)
    expect(framed.easel).toBeNull()
    expect(framed.side).toBe(bare.side)
    expect(framed.canvasX).toBe(bare.canvasX)
    expect(framed.canvasY).toBe(bare.canvasY)
  })

  it('is absent, and costs nothing, when the pad is asked for plain', () => {
    for (const aspect of SHAPES) {
      const plain = padLayout({ ...aspect, chromeTop: CHROME }, OVERLAY, false)
      expect(plain.easel).toBeNull()
    }
  })

  it('keeps the ledge deep enough for the finish button to rest on', () => {
    // The done button is 1.2 tool buttons across and sits centred on the ledge;
    // the frame above it absorbs the overhang only while this holds.
    for (const aspect of DRESSED) {
      const layout = padLayout({ ...aspect, chromeTop: CHROME }, OVERLAY, true)
      expect(layout.easel!.ledge).toBeGreaterThanOrEqual(layout.button * 0.9 - 0.5)
      expect(layout.easel!.border).toBeGreaterThanOrEqual(layout.button * 0.15 - 0.5)
    }
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
