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

import { jitter, blobPoints, foodScale } from './textures'

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

  it('foodScale is 1 for unknown foods and the override for known ones', () => {
    expect(foodScale('apple')).toBe(1)
    expect(foodScale('nope')).toBe(1)
    expect(foodScale('lemon')).toBe(0.8)
  })
})
