import { describe, expect, it } from 'vitest'
import {
  ASSIST_AFTER_MISSES,
  BALL,
  BASE_GRAVITY_NORM,
  BIG_BIRD_EVERY,
  BIG_BIRD_FROM_LEVEL,
  GROUND_Y,
  MATERIALS,
  MAX_LAUNCH_SPEED_NORM,
  MOON_GRAVITY_SCALE,
  PIGGY,
  RIGHT_ZONE_MIN,
  SLING,
  THEME_CYCLE,
  assistStrength,
  birdCycleFor,
  generateLevel,
  gravityScaleFor,
  hasReachablePiggy,
  isReachable,
  mulberry32,
  piggyCountFor,
  targetBlockCount,
  themeFor,
} from './logic'
import type { BlockMaterial, LevelSpec, Theme } from './logic'

/** Every generated level, regenerated deterministically from its seed. */
function level(n: number): LevelSpec {
  return generateLevel(n, mulberry32(n))
}

const EARLY_LEVELS = Array.from({ length: 14 }, (_, i) => i + 1)
const RAMP_LEVELS = Array.from({ length: 30 }, (_, i) => i + 1)

describe('determinism', () => {
  it('regenerates an identical spec for the same seed', () => {
    for (const n of RAMP_LEVELS) {
      expect(generateLevel(n, mulberry32(n))).toEqual(generateLevel(n, mulberry32(n)))
    }
  })

  it('mulberry32 is reproducible and in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) {
      const v = a()
      expect(v).toBe(b())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('theme schedule', () => {
  it('walks the doc table two levels each for levels 1..14', () => {
    const expected: [number, Theme][] = [
      [1, 'towers'],
      [2, 'towers'],
      [3, 'dominos'],
      [4, 'dominos'],
      [5, 'materials'],
      [6, 'materials'],
      [7, 'trampoline'],
      [8, 'trampoline'],
      [9, 'balls'],
      [10, 'balls'],
      [11, 'seesaw'],
      [12, 'seesaw'],
      [13, 'moon'],
      [14, 'moon'],
    ]
    for (const [lvl, theme] of expected) {
      expect(themeFor(lvl)).toBe(theme)
      expect(level(lvl).theme).toBe(theme)
    }
  })

  it('rotates the full cycle from level 15 onward', () => {
    for (let lvl = 15; lvl < 15 + THEME_CYCLE.length * 3; lvl++) {
      expect(themeFor(lvl)).toBe(THEME_CYCLE[(lvl - 15) % THEME_CYCLE.length])
    }
    expect(themeFor(15)).toBe('towers')
    expect(themeFor(21)).toBe('moon')
    expect(themeFor(22)).toBe('towers')
  })
})

describe('gravity', () => {
  it('floats only on moon levels for the scheduled range', () => {
    for (const lvl of [1, 3, 5, 7, 9, 11]) {
      expect(level(lvl).gravityScale).toBe(1)
    }
    for (const lvl of [13, 14]) {
      expect(level(lvl).gravityScale).toBe(MOON_GRAVITY_SCALE)
    }
  })

  it('every level uses either full or moon gravity', () => {
    for (const lvl of RAMP_LEVELS) {
      expect([1, MOON_GRAVITY_SCALE]).toContain(level(lvl).gravityScale)
    }
  })

  it('gravityScaleFor is deterministic for a fixed rng', () => {
    expect(gravityScaleFor(13, 'moon', mulberry32(13))).toBe(MOON_GRAVITY_SCALE)
    expect(gravityScaleFor(3, 'dominos', mulberry32(3))).toBe(1)
  })
})

describe('difficulty ramp caps', () => {
  it('block count is monotone non-decreasing and capped 2..10', () => {
    let last = 0
    for (const lvl of RAMP_LEVELS) {
      const count = targetBlockCount(lvl)
      expect(count).toBeGreaterThanOrEqual(2)
      expect(count).toBeLessThanOrEqual(10)
      expect(count).toBeGreaterThanOrEqual(last)
      last = count
    }
    expect(targetBlockCount(1)).toBe(2)
    expect(targetBlockCount(1000)).toBe(10)
  })

  it('piggy count is monotone non-decreasing and capped 1..3', () => {
    let last = 0
    for (const lvl of RAMP_LEVELS) {
      const count = piggyCountFor(lvl)
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(3)
      expect(count).toBeGreaterThanOrEqual(last)
      last = count
    }
    expect(piggyCountFor(1)).toBe(1)
    expect(piggyCountFor(15)).toBe(3)
  })

  it('generated levels honor the caps in the actual spec', () => {
    for (const lvl of RAMP_LEVELS) {
      const spec = level(lvl)
      expect(spec.blocks.length).toBeGreaterThanOrEqual(2)
      expect(spec.blocks.length).toBeLessThanOrEqual(10)
      expect(spec.piggies.length).toBe(piggyCountFor(lvl))
      expect(spec.piggies.length).toBeGreaterThanOrEqual(1)
      expect(spec.piggies.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('placement bounds and right zone', () => {
  it('keeps every block fully inside [0,1] and in the right zone', () => {
    for (const lvl of RAMP_LEVELS) {
      for (const b of level(lvl).blocks) {
        expect(b.x - b.w / 2).toBeGreaterThanOrEqual(0)
        expect(b.x + b.w / 2).toBeLessThanOrEqual(1)
        expect(b.y - b.h / 2).toBeGreaterThanOrEqual(0)
        expect(b.y + b.h / 2).toBeLessThanOrEqual(1)
        expect(b.x).toBeGreaterThanOrEqual(RIGHT_ZONE_MIN)
      }
    }
  })

  it('keeps every piggy inside [0,1] and in the right zone', () => {
    for (const lvl of RAMP_LEVELS) {
      for (const p of level(lvl).piggies) {
        expect(p.x).toBeGreaterThanOrEqual(RIGHT_ZONE_MIN)
        expect(p.x + PIGGY.radius).toBeLessThanOrEqual(1)
        expect(p.x - PIGGY.radius).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(GROUND_Y)
      }
    }
  })

  it('keeps props inside the field', () => {
    for (const lvl of RAMP_LEVELS) {
      for (const prop of level(lvl).props) {
        expect(prop.x).toBeGreaterThanOrEqual(0)
        expect(prop.x).toBeLessThanOrEqual(1)
        expect(prop.y).toBeGreaterThanOrEqual(0)
        expect(prop.y).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('ballistic reachability', () => {
  it('closed-form envelope: low/near reachable, high/far not', () => {
    // A point at launch height, moderately to the right — clearly reachable.
    expect(isReachable(SLING.x + 0.4, SLING.y)).toBe(true)
    // Straight up, just under the max height v0²/(2g) — reachable.
    const maxHeight = (MAX_LAUNCH_SPEED_NORM * MAX_LAUNCH_SPEED_NORM) / (2 * BASE_GRAVITY_NORM)
    expect(isReachable(SLING.x, SLING.y - (maxHeight - 0.02))).toBe(true)
    // Above the max height — unreachable at any angle.
    expect(isReachable(SLING.x, SLING.y - (maxHeight + 0.2))).toBe(false)
    // Beyond the max range v0²/g at launch height — unreachable.
    const maxRange = (MAX_LAUNCH_SPEED_NORM * MAX_LAUNCH_SPEED_NORM) / BASE_GRAVITY_NORM
    expect(isReachable(SLING.x + maxRange + 0.2, SLING.y)).toBe(false)
  })

  it('lower moon gravity enlarges the reachable envelope', () => {
    const highTarget =
      SLING.y - (MAX_LAUNCH_SPEED_NORM * MAX_LAUNCH_SPEED_NORM) / (2 * BASE_GRAVITY_NORM) - 0.1
    expect(isReachable(SLING.x, highTarget, 1)).toBe(false)
    expect(isReachable(SLING.x, highTarget, MOON_GRAVITY_SCALE)).toBe(true)
  })

  it('every generated level has at least one reachable piggy', () => {
    for (const lvl of RAMP_LEVELS) {
      expect(hasReachablePiggy(level(lvl))).toBe(true)
    }
  })
})

describe('bird queue', () => {
  it('serves normal birds only before level 5', () => {
    for (let lvl = 1; lvl < BIG_BIRD_FROM_LEVEL; lvl++) {
      expect(birdCycleFor(lvl)).toEqual(['normal'])
      expect(level(lvl).birds.every((b) => b === 'normal')).toBe(true)
    }
  })

  it('serves a Big Bird every third launch from level 5', () => {
    for (const lvl of [5, 8, 12, 20]) {
      const cycle = birdCycleFor(lvl)
      expect(cycle).toHaveLength(BIG_BIRD_EVERY)
      expect(cycle.filter((b) => b === 'big')).toHaveLength(1)
      expect(cycle[BIG_BIRD_EVERY - 1]).toBe('big')
    }
  })
})

describe('assist ramp', () => {
  it('is silent below the miss threshold, then ramps to a capped 1.0', () => {
    for (let m = 0; m < ASSIST_AFTER_MISSES; m++) {
      expect(assistStrength(m)).toBe(0)
    }
    let last = -1
    for (let m = ASSIST_AFTER_MISSES; m <= ASSIST_AFTER_MISSES + 10; m++) {
      const s = assistStrength(m)
      expect(s).toBeGreaterThan(0)
      expect(s).toBeLessThanOrEqual(1)
      expect(s).toBeGreaterThanOrEqual(last)
      last = s
    }
    expect(assistStrength(ASSIST_AFTER_MISSES)).toBeCloseTo(0.25)
    expect(assistStrength(1000)).toBe(1)
  })
})

describe('materials table', () => {
  it('matches the doc: stone dense, ice slippery, wood in between', () => {
    expect(MATERIALS.stone.density).toBeGreaterThan(MATERIALS.wood.density)
    expect(MATERIALS.wood.density).toBeGreaterThan(MATERIALS.ice.density)
    expect(MATERIALS.ice.friction).toBeLessThan(MATERIALS.wood.friction)
    expect(MATERIALS.stone.friction).toBeGreaterThan(MATERIALS.wood.friction)
    expect(MATERIALS.wood.density).toBe(1)
    expect(BALL.restitution).toBeGreaterThan(0)
  })

  it('materials levels include at least one stone and one ice block', () => {
    for (const lvl of [5, 6, 17]) {
      const mats = level(lvl).blocks.map((b) => b.material)
      const set = new Set<BlockMaterial>(mats)
      expect(set.has('stone')).toBe(true)
      expect(set.has('ice')).toBe(true)
    }
  })
})

describe('theme props appear on schedule', () => {
  function propKinds(lvl: number): Set<string> {
    return new Set(level(lvl).props.map((p) => p.kind))
  }

  it('introduces trampolines, balls, and seesaws at their levels', () => {
    expect(propKinds(7).has('trampoline')).toBe(true)
    expect(propKinds(8).has('trampoline')).toBe(true)
    expect(propKinds(9).has('ball')).toBe(true)
    expect(propKinds(10).has('ball')).toBe(true)
    expect(propKinds(11).has('seesaw')).toBe(true)
    expect(propKinds(12).has('seesaw')).toBe(true)
  })

  it('plain tower/domino levels carry no props', () => {
    for (const lvl of [1, 2, 3, 4]) {
      expect(level(lvl).props).toHaveLength(0)
    }
  })

  it('every scheduled early level has a reachable piggy and legal counts', () => {
    for (const lvl of EARLY_LEVELS) {
      const spec = level(lvl)
      expect(hasReachablePiggy(spec)).toBe(true)
      expect(spec.blocks.length).toBeGreaterThanOrEqual(2)
    }
  })
})
