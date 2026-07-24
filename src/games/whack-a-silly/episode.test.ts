import { describe, expect, it } from 'vitest'
import type { Rng } from './logic'
import {
  EPISODE_MAX_BOPS,
  EPISODE_MIN_BOPS,
  MAX_HOLES,
  MAX_SPATIAL,
  MIN_HOLES,
  SPATIAL_START,
  advanceSpatial,
  clampSpatial,
  episodeHoleCount,
  episodeLength,
  generateBoard,
  holeCountFor,
  spatialDelta,
} from './episode'
import type { BoardOptions, Spot } from './episode'

/** Seeded RNG so every property below is reproducible (mirrors logic.test.ts). */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1)

describe('hole-count range', () => {
  it('spans four holes (easiest) to nine (hardest)', () => {
    expect(MIN_HOLES).toBe(4)
    expect(MAX_HOLES).toBe(9)
    expect(MAX_SPATIAL).toBe(MAX_HOLES - MIN_HOLES)
    expect(holeCountFor(SPATIAL_START)).toBe(MIN_HOLES)
    expect(holeCountFor(MAX_SPATIAL)).toBe(MAX_HOLES)
  })

  it('clamps the spatial meter and hole count to their bounds', () => {
    expect(clampSpatial(-3)).toBe(SPATIAL_START)
    expect(clampSpatial(99)).toBe(MAX_SPATIAL)
    expect(holeCountFor(-10)).toBe(MIN_HOLES)
    expect(holeCountFor(100)).toBe(MAX_HOLES)
  })
})

describe('spatial adaptive step (gentle climb)', () => {
  it('climbs at most one hole per clean episode, eases faster when struggling', () => {
    expect(spatialDelta(0)).toBe(1)
    expect(spatialDelta(1)).toBe(1)
    expect(spatialDelta(2)).toBe(0)
    expect(spatialDelta(3)).toBe(0)
    expect(spatialDelta(4)).toBe(-1)
    expect(spatialDelta(5)).toBe(-2)
    expect(spatialDelta(20)).toBe(-2)
  })

  it('takes MAX_SPATIAL clean episodes to reach the ceiling, then holds (no runaway)', () => {
    let s = SPATIAL_START
    // The center climbs one hole at a time — no more 2-episode sprint to nine.
    for (let i = 1; i <= MAX_SPATIAL; i++) {
      s = advanceSpatial(s, 0)
      expect(s).toBe(i)
    }
    expect(s).toBe(MAX_SPATIAL)
    expect(holeCountFor(s)).toBe(MAX_HOLES)
    s = advanceSpatial(s, 0) // capped — never overshoots
    expect(s).toBe(MAX_SPATIAL)
  })

  it('never drops below the four-hole floor (no-fail)', () => {
    let s = SPATIAL_START
    for (let i = 0; i < 10; i++) s = advanceSpatial(s, 8)
    expect(s).toBe(SPATIAL_START)
    expect(holeCountFor(s)).toBe(MIN_HOLES)
  })

  it('stays within [0, MAX_SPATIAL] for any escape count', () => {
    for (let start = 0; start <= MAX_SPATIAL; start++) {
      for (let esc = 0; esc <= 30; esc++) {
        const next = advanceSpatial(start, esc)
        expect(next).toBeGreaterThanOrEqual(SPATIAL_START)
        expect(next).toBeLessThanOrEqual(MAX_SPATIAL)
      }
    }
  })
})

describe('per-episode hole count (center + jitter)', () => {
  it('always lands in the legal [MIN_HOLES, MAX_HOLES] band', () => {
    for (let spatial = -2; spatial <= MAX_SPATIAL + 2; spatial++) {
      for (const seed of SEEDS) {
        const rng = mulberry32(seed * 17 + spatial + 5)
        for (let i = 0; i < 50; i++) {
          const n = episodeHoleCount(spatial, null, rng)
          expect(n).toBeGreaterThanOrEqual(MIN_HOLES)
          expect(n).toBeLessThanOrEqual(MAX_HOLES)
          expect(Number.isInteger(n)).toBe(true)
        }
      }
    }
  })

  it('breathes ±1 around the meter — no longer pinned to a single count', () => {
    // A mid meter (center 6) must produce more than one distinct count over a
    // run: this is exactly the anti-monotony the jitter buys.
    const spatial = 2 // center = MIN_HOLES + 2 = 6
    const seen = new Set<number>()
    const rng = mulberry32(99)
    for (let i = 0; i < 200; i++) seen.add(episodeHoleCount(spatial, null, rng))
    expect(seen.size).toBeGreaterThan(1)
    for (const n of seen) expect(Math.abs(n - holeCountFor(spatial))).toBeLessThanOrEqual(1)
  })

  it('never repeats the previous episode count when an alternative exists', () => {
    // Walk a chain feeding each result back as prevCount; no two adjacent equal.
    for (let spatial = SPATIAL_START; spatial <= MAX_SPATIAL; spatial++) {
      for (const seed of SEEDS) {
        const rng = mulberry32(seed * 41 + spatial)
        let prev = episodeHoleCount(spatial, null, rng)
        for (let i = 0; i < 100; i++) {
          const next = episodeHoleCount(spatial, prev, rng)
          expect(next).not.toBe(prev)
          prev = next
        }
      }
    }
  })

  it('leans DOWN at the ceiling so nine is a spike, not the steady state', () => {
    // At the max meter the jitter offsets are {0,0,-1,-2} → counts {9,8,7}; the
    // densest board must never be the only thing the child ever sees.
    const seen = new Set<number>()
    const rng = mulberry32(7)
    for (let i = 0; i < 300; i++) seen.add(episodeHoleCount(MAX_SPATIAL, null, rng))
    expect(seen.has(MAX_HOLES)).toBe(true)
    expect(seen.has(MAX_HOLES - 1)).toBe(true)
    expect(seen.has(MAX_HOLES - 2)).toBe(true)
    expect(Math.max(...seen)).toBe(MAX_HOLES)
  })

  it('is deterministic for a given seed', () => {
    const a = Array.from({ length: 10 }, () => 0)
    const b = Array.from({ length: 10 }, () => 0)
    const ra = mulberry32(3)
    const rb = mulberry32(3)
    for (let i = 0; i < 10; i++) {
      a[i] = episodeHoleCount(3, null, ra)
      b[i] = episodeHoleCount(3, null, rb)
    }
    expect(a).toEqual(b)
  })
})

describe('episode length', () => {
  it('always falls in [EPISODE_MIN_BOPS, EPISODE_MAX_BOPS]', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let i = 0; i < 200; i++) {
        const n = episodeLength(rng)
        expect(n).toBeGreaterThanOrEqual(EPISODE_MIN_BOPS)
        expect(n).toBeLessThanOrEqual(EPISODE_MAX_BOPS)
        expect(Number.isInteger(n)).toBe(true)
      }
    }
  })

  it('exercises the whole 5..10 range across seeds', () => {
    const seen = new Set<number>()
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let i = 0; i < 100; i++) seen.add(episodeLength(rng))
    }
    for (let n = EPISODE_MIN_BOPS; n <= EPISODE_MAX_BOPS; n++) {
      expect(seen.has(n)).toBe(true)
    }
  })
})

describe('board generation', () => {
  /** Footprint fractions for the two target aspect ratios (see the layout: sky
   *  is 40% of height, holes live in the ~60% grass band). Values below what the
   *  shipping 3×3 grid already fits, so 9 holes always place on both. */
  const IPAD: BoardOptions = { minDistX: 0.3, minDistY: 0.3 } // ~4:3, squarish band
  const IPHONE: BoardOptions = { minDistX: 0.16, minDistY: 0.4 } // ~2.2:1, wide + short

  /** No two holes share a footprint: they clear on X OR on Y. */
  function noOverlap(spots: Spot[], opts: BoardOptions): boolean {
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const dx = Math.abs(spots[i].x - spots[j].x)
        const dy = Math.abs(spots[i].y - spots[j].y)
        if (dx < opts.minDistX - 1e-9 && dy < opts.minDistY - 1e-9) return false
      }
    }
    return true
  }

  for (const [name, opts] of [
    ['iPad 4:3', IPAD],
    ['iPhone landscape 2.2:1', IPHONE],
  ] as const) {
    it(`places every hole count 4..9 without overlap, inside the region (${name})`, () => {
      for (const count of [4, 5, 6, 7, 8, 9]) {
        for (const seed of SEEDS) {
          const rng = mulberry32(seed * 31 + count)
          const spots = generateBoard(count, opts, rng)
          expect(spots).toHaveLength(count)
          for (const s of spots) {
            expect(s.x).toBeGreaterThanOrEqual(0)
            expect(s.x).toBeLessThanOrEqual(1)
            expect(s.y).toBeGreaterThanOrEqual(0)
            expect(s.y).toBeLessThanOrEqual(1)
          }
          expect(noOverlap(spots, opts)).toBe(true)
        }
      }
    })
  }

  it('is deterministic for a given seed', () => {
    const a = generateBoard(6, IPAD, mulberry32(7))
    const b = generateBoard(6, IPAD, mulberry32(7))
    expect(a).toEqual(b)
  })

  it('produces different scatter for different seeds (not a fixed grid)', () => {
    const a = generateBoard(5, IPHONE, mulberry32(1))
    const b = generateBoard(5, IPHONE, mulberry32(2))
    expect(a).not.toEqual(b)
  })

  it('falls back to the lattice yet still fills a tight board', () => {
    // A near-worst-case tight packing (9 holes, minimal slack) must still yield
    // all nine with no overlap — the guaranteed-placement path.
    const tight: BoardOptions = { minDistX: 0.32, minDistY: 0.32, maxTries: 5 }
    for (const seed of SEEDS) {
      const spots = generateBoard(9, tight, mulberry32(seed))
      expect(spots).toHaveLength(9)
      expect(noOverlap(spots, tight)).toBe(true)
    }
  })

  it('returns nothing for a zero-hole board', () => {
    expect(generateBoard(0, IPAD, mulberry32(1))).toEqual([])
  })
})
