import { describe, expect, it } from 'vitest'
import { mulberry32 } from './logic'
import type { BirdKind } from './logic'
import {
  STAR_DROP_ODDS,
  STAR_DROP_TIERS,
  buildTapScript,
  rollStarDropTarget,
  shouldShowStarDrop,
  tierIndex,
} from './starDrop'
import type { StarDropOdd } from './starDrop'

const KINDS: BirdKind[] = ['green', 'blue', 'purple', 'red', 'yellow']

describe('tier ladder', () => {
  it('ascends green → blue → purple → red → yellow', () => {
    expect(STAR_DROP_TIERS).toEqual(['green', 'blue', 'purple', 'red', 'yellow'])
    KINDS.forEach((kind, i) => expect(tierIndex(kind)).toBe(i))
  })
})

describe('rollStarDropTarget', () => {
  /** Tally 20k seeded rolls into a per-kind frequency map. */
  function distribution(odds: readonly StarDropOdd[], seed = 1234): Record<string, number> {
    const rng = mulberry32(seed)
    const counts: Record<string, number> = {}
    const n = 20_000
    for (let i = 0; i < n; i++) {
      const kind = rollStarDropTarget(rng, odds)
      counts[kind] = (counts[kind] ?? 0) + 1
    }
    for (const k of Object.keys(counts)) counts[k] /= n
    return counts
  }

  it('reproduces the configured distribution within ±2%', () => {
    const freq = distribution(STAR_DROP_ODDS)
    const total = STAR_DROP_ODDS.reduce((s, o) => s + o.weight, 0)
    for (const odd of STAR_DROP_ODDS) {
      expect(freq[odd.kind] ?? 0).toBeCloseTo(odd.weight / total, 1)
      // toBeCloseTo(x, 1) ⇒ |diff| < 0.05; tighten to the promised ±2%.
      expect(Math.abs((freq[odd.kind] ?? 0) - odd.weight / total)).toBeLessThan(0.02)
    }
  })

  it('normalizes weights that do not sum to 100', () => {
    const odds: StarDropOdd[] = [
      { kind: 'green', weight: 1 },
      { kind: 'red', weight: 3 },
    ]
    const freq = distribution(odds)
    expect(freq.green ?? 0).toBeLessThan(0.02 + 0.25) // ≈ 1/4
    expect(Math.abs((freq.green ?? 0) - 0.25)).toBeLessThan(0.02)
    expect(Math.abs((freq.red ?? 0) - 0.75)).toBeLessThan(0.02)
    // Only the two configured kinds ever come up.
    expect(Object.keys(freq).sort()).toEqual(['green', 'red'])
  })

  it('always returns a configured kind (never undefined at the rng boundary)', () => {
    // A degenerate rng that returns values approaching 1 must still resolve.
    const near1: BirdKind = rollStarDropTarget(() => 0.999999999)
    expect(KINDS).toContain(near1)
    const zero: BirdKind = rollStarDropTarget(() => 0)
    expect(zero).toBe(STAR_DROP_ODDS[0].kind)
  })
})

describe('buildTapScript', () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7 + 1)

  it('is well-formed for every target × many seeds', () => {
    for (const target of KINDS) {
      const upgrades = tierIndex(target)
      for (const seed of SEEDS) {
        const script = buildTapScript(target, mulberry32(seed))

        // Ends with exactly one 'open', and nothing follows it.
        expect(script[script.length - 1]).toBe('open')
        expect(script.filter((e) => e === 'open')).toHaveLength(1)

        // Length is 4 or 5, unless the upgrade count forces more (gold = 5).
        expect(script.length).toBeGreaterThanOrEqual(upgrades + 1)
        expect(script.length).toBeGreaterThanOrEqual(4)
        expect(script.length).toBeLessThanOrEqual(5)

        // Upgrade count equals the target's tier index.
        expect(script.filter((e) => e === 'upgrade')).toHaveLength(upgrades)

        // All upgrades come before any fakeout (no upgrade after a fakeout).
        const firstFakeout = script.indexOf('fakeout')
        const lastUpgrade = script.lastIndexOf('upgrade')
        if (firstFakeout !== -1 && lastUpgrade !== -1) {
          expect(lastUpgrade).toBeLessThan(firstFakeout)
        }
      }
    }
  })

  it('gold always takes 5 taps: 4 upgrades then open', () => {
    for (const seed of SEEDS) {
      const script = buildTapScript('yellow', mulberry32(seed))
      expect(script).toEqual(['upgrade', 'upgrade', 'upgrade', 'upgrade', 'open'])
    }
  })

  it('green never upgrades (all fakeouts then open)', () => {
    for (const seed of SEEDS) {
      const script = buildTapScript('green', mulberry32(seed))
      expect(script).not.toContain('upgrade')
      expect(script[script.length - 1]).toBe('open')
    }
  })
})

describe('shouldShowStarDrop', () => {
  it('fires on every 3rd level in normal play', () => {
    for (const lvl of [3, 6, 9, 12, 30]) expect(shouldShowStarDrop(lvl, false)).toBe(true)
    for (const lvl of [1, 2, 4, 5, 7, 8, 10]) expect(shouldShowStarDrop(lvl, false)).toBe(false)
  })

  it('never fires in the editor, even on a multiple of 3', () => {
    for (const lvl of [3, 6, 9, 12]) expect(shouldShowStarDrop(lvl, true)).toBe(false)
  })

  it('never fires at or below level 0', () => {
    expect(shouldShowStarDrop(0, false)).toBe(false)
    expect(shouldShowStarDrop(-3, false)).toBe(false)
  })
})
