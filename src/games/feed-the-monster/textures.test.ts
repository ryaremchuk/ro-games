import { describe, it, expect, vi } from 'vitest'

// textures.ts imports Phaser for its canvas/graphics factories; the pure helpers
// under test only touch `Phaser.Math.Vector2`. Stub the module so importing it
// doesn't boot Phaser's real canvas/WebGL init (which crashes under jsdom).
vi.mock('phaser', () => ({
  default: {
    Math: {
      Vector2: class {
        x: number
        y: number
        constructor(x = 0, y = 0) {
          this.x = x
          this.y = y
        }
      },
    },
  },
}))

import {
  jitter,
  blobPoints,
  foodScale,
  markScale,
  BLOB_PAINT_FRAC,
  STAR_BOX_CSS,
  UI_MARKS,
} from './textures'

describe('feed-the-monster texture helpers (pure)', () => {
  it('jitter is deterministic and in [0, 1)', () => {
    // Same (i, seed) → same value, every call.
    expect(jitter(3, 7)).toBe(jitter(3, 7))
    expect(jitter(0, 0)).toBe(jitter(0, 0))
    // Different inputs generally differ.
    expect(jitter(3, 7)).not.toBe(jitter(4, 7))
    // Always a fraction in [0, 1).
    for (let i = 0; i < 32; i++) {
      for (const seed of [0, 7, 11, 99]) {
        const v = jitter(i, seed)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(1)
      }
    }
  })

  it('blobPoints is deterministic per seed, samples 80 finite points', () => {
    const a = blobPoints(50, 50, 20, 7)
    const b = blobPoints(50, 50, 20, 7)
    // 8 segments × 10 samples each.
    expect(a).toHaveLength(80)
    // Identical seed/geometry → identical samples.
    expect(a.map((p) => [p.x, p.y])).toEqual(b.map((p) => [p.x, p.y]))
    // A different seed reshapes the blob.
    const c = blobPoints(50, 50, 20, 8)
    expect(c.map((p) => [p.x, p.y])).not.toEqual(a.map((p) => [p.x, p.y]))
    // Every sample is a finite point.
    for (const p of a) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
  })

  it('BLOB_PAINT_FRAC is the share of its padded box a blob really paints', () => {
    // makeBlobTexture pads a radius-r blob into a ceil(2.4r) square. Art that
    // replaces a blob is trimmed tight to its own ink, so it is scaled by this
    // fraction to land on the same footprint — if the padding or the smoothing
    // ever changes, the constant has to move with it or every reskinned blob
    // silently jumps size. Checked across radii: the ratio is scale-free.
    for (const r of [26, 40, 120]) {
      // Measured against the unrounded 2.4r box: makeBlobTexture's ceil() adds
      // a sub-pixel of extra margin, which matters less the bigger the blob.
      const box = r * 2.4
      const pts = blobPoints(box / 2, box / 2, r, 11)
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const painted = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      expect(painted / box).toBeCloseTo(BLOB_PAINT_FRAC, 3)
    }
    // The blob never spills out of the box it is generated into.
    expect(BLOB_PAINT_FRAC).toBeLessThan(1)
  })

  it('foodScale is 1 for unknown foods and the override for known ones', () => {
    expect(foodScale('apple')).toBe(1)
    expect(foodScale('nope')).toBe(1)
    expect(foodScale('lemon')).toBe(0.8)
  })
})

describe('UI marks size the same whether art shipped or not', () => {
  // Every procedural mark texture is square and padded; every sliced sprite is
  // trimmed tight to its ink and arrives ~570px wide. markScale is the one place
  // the two are reconciled, so pin what it promises.

  it('reproduces setDisplaySize(box, box) for the procedural textures', () => {
    // The fallbacks are square canvases, so a plain box/width scale is exactly
    // the display size every consumer used before art existed.
    for (const mark of Object.values(UI_MARKS)) {
      const tex = { width: 84, height: 84 }
      expect(markScale(mark, tex, 42, false)).toBeCloseTo(0.5, 10)
    }
  })

  it('lands art ink on the same footprint the procedural ink covered', () => {
    // A 570px sprite in a 100px box must come out at 100 × the fallback's paint
    // fraction along its fitted axis — never at 100, and never at 570.
    for (const mark of Object.values(UI_MARKS)) {
      const tex = { width: 570, height: 400 }
      const scale = markScale(mark, tex, 100, true)
      const fitted = mark.along === 'width' ? scale * tex.width : scale * tex.height
      expect(fitted).toBeCloseTo(100 * mark.frac, 10)
      expect(scale).toBeLessThan(1)
    }
  })

  it('keeps every paint fraction a real fraction of the padded box', () => {
    // A frac above 1 would mean the procedural ink spilled out of its own
    // canvas; a tiny one would mean the art renders as a speck.
    for (const [name, mark] of Object.entries(UI_MARKS)) {
      expect(mark.frac, name).toBeGreaterThan(0.3)
      expect(mark.frac, name).toBeLessThanOrEqual(1)
    }
    // The ✓ disc is the only one that truly fills its canvas.
    expect(UI_MARKS.check.frac).toBe(1)
    // "?" is fitted by HEIGHT: it is far taller than wide, and stretching it
    // into the caller's square box would deform it.
    expect(UI_MARKS.q.along).toBe('height')
    // The two operators are one matched set — same arm, so same fraction.
    expect(UI_MARKS.plus.frac).toBe(UI_MARKS.equals.frac)
  })

  it('STAR_BOX_CSS is the box a celebration star filled at scale 1', () => {
    // The ⭐ emoji is drawn at 30 CSS px into a canvas padded 25% each side, and
    // the emitter used to run it at scale 1 — i.e. a 45 CSS px particle. Art
    // stars are scaled to that same box, so the burst does not change size.
    expect(STAR_BOX_CSS).toBeCloseTo(45, 10)
    // At scale 1 the procedural texture is exactly its own box.
    expect(markScale(UI_MARKS.star, { width: 45, height: 45 }, STAR_BOX_CSS, false)).toBe(1)
  })
})
