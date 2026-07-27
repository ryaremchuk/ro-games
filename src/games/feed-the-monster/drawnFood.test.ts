/**
 * The pure half of "the food the child drew": how a drawing becomes a `Food`,
 * how it enters an episode pool without breaking the colour invariant every
 * round generator relies on, and when a commission is asked for.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACTIVE_POOL_SIZE,
  COLOR_HEX,
  FOODS,
  FOOD_COLORS,
  TRAY_SIZE,
  activePoolForRound,
  clearRuntimeFoods,
  dishResult,
  dominantColor,
  drawingIdOf,
  drawnFood,
  foodById,
  generateRound,
  isDishCooked,
  isRoundComplete,
  kindWantsNamedFood,
  potAccepts,
  poolWithFood,
  registerRuntimeFood,
  wantsFood,
  withDrawnFoods,
} from './logic'
import type { Food, FoodColor, FoodRequest, Rng } from './logic'
import { TASK_REGISTRY } from './logic'
import {
  COMMISSION_COLOR_MIN_SKILL,
  COMMISSION_MIN_EPISODE,
  EPISODES,
  FRIENDS_PER_EPISODE,
  COMMISSION_ANNOUNCE_MS,
  commissionColor,
  commissionGate,
} from './journey'
import { PALETTE } from '../../shared/pixel/palette'

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Greedily play a round to completion; true if it can be cleared at all.
 *
 * A KITCHEN round has a different completion path from every other kind: the
 * tray holds the PARTS, and the only feedable thing is the dish that comes out of
 * the pot once they are all in. So model the pot, then feed the result.
 */
function simulateFeed(request: FoodRequest, tray: readonly string[]): boolean {
  const remaining = [...tray]
  if (request.kind === 'dish') {
    const pot: string[] = []
    while (!isDishCooked(request, pot)) {
      const at = remaining.findIndex((id) => potAccepts(request, pot, id))
      if (at < 0) return false
      pot.push(remaining[at])
      remaining.splice(at, 1)
    }
    return wantsFood(request, [], dishResult(request))
  }
  const eaten: string[] = []
  while (!isRoundComplete(request, eaten)) {
    const index = remaining.findIndex((id) => wantsFood(request, eaten, id))
    if (index < 0) return false
    eaten.push(remaining[index])
    remaining.splice(index, 1)
  }
  return true
}

/** A drawn food per colour, registered so every pure rule can resolve its id. */
function drawnPerColor(colors: readonly FoodColor[]): Food[] {
  return colors.map((color, i) => {
    const food = drawnFood(`d${i}`, color)
    registerRuntimeFood(food)
    return food
  })
}

beforeEach(() => {
  clearRuntimeFoods()
})

describe('a drawing as a food', () => {
  it('carries its drawing id, the pencil fallback glyph, and the asked colour', () => {
    const food = drawnFood('abc123', 'brown')
    expect(food.id).toBe('drawn-abc123')
    expect(food.drawingId).toBe('abc123')
    expect(food.color).toBe('brown')
    expect(food.emoji).toBe('✏️')
  })

  it('round-trips the drawing id out of the food id, and ignores authored foods', () => {
    expect(drawingIdOf('drawn-abc123')).toBe('abc123')
    expect(drawingIdOf('apple')).toBeNull()
  })

  it('is resolvable by id only once registered', () => {
    const food = drawnFood('zz', 'red')
    expect(() => foodById(food.id)).toThrow()
    registerRuntimeFood(food)
    expect(foodById(food.id)).toEqual(food)
    clearRuntimeFoods()
    expect(() => foodById(food.id)).toThrow()
  })
})

describe('withDrawnFoods substitutes, never appends', () => {
  it('keeps the pool length and the per-colour census exactly', () => {
    const drawn = drawnPerColor(['red', 'brown'])
    const next = withDrawnFoods(FOODS, drawn)
    expect(next).toHaveLength(FOODS.length)
    for (const color of FOOD_COLORS) {
      expect(next.filter((f) => f.color === color)).toHaveLength(
        FOODS.filter((f) => f.color === color).length,
      )
    }
    expect(next.filter((f) => f.drawingId !== undefined)).toHaveLength(2)
  })

  it('takes the FIRST same-colour seat and leaves the rest of that colour alone', () => {
    const drawn = drawnPerColor(['red'])
    const next = withDrawnFoods(FOODS, drawn)
    const firstRed = FOODS.findIndex((f) => f.color === 'red')
    expect(next[firstRed].drawingId).toBe('d0')
    // The other reds survive, so the tray still has authored food to fall back on.
    expect(next.filter((f) => f.color === 'red' && f.drawingId === undefined).length).toBe(
      FOODS.filter((f) => f.color === 'red').length - 1,
    )
  })

  it('never doubles up: two drawings of one colour take two different seats', () => {
    const drawn = [drawnFood('a', 'red'), drawnFood('b', 'red')]
    for (const food of drawn) registerRuntimeFood(food)
    const next = withDrawnFoods(FOODS, drawn)
    expect(next.filter((f) => f.drawingId === 'a')).toHaveLength(1)
    expect(next.filter((f) => f.drawingId === 'b')).toHaveLength(1)
    expect(next).toHaveLength(FOODS.length)
  })

  it('holds the every-window-has-every-colour invariant for 1…6 drawn foods', () => {
    for (const episode of EPISODES) {
      for (let count = 1; count <= FOOD_COLORS.length; count++) {
        const drawn = drawnPerColor(FOOD_COLORS.slice(0, count))
        const pool = withDrawnFoods(episode.foods, drawn)
        expect(pool).toHaveLength(episode.foods.length)
        // Sweep every rotation the game can reach.
        for (let round = 1; round <= pool.length * 3; round++) {
          const window = activePoolForRound(round, pool)
          expect(window).toHaveLength(ACTIVE_POOL_SIZE)
          for (const color of FOOD_COLORS) {
            expect(
              window.some((f) => f.color === color),
              `episode ${episode.id}, ${count} drawn, round ${round} is missing ${color}`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('keeps every task kind satisfiable with a full six drawn foods', () => {
    const drawn = drawnPerColor(FOOD_COLORS)
    const pool = withDrawnFoods(EPISODES[0].foods, drawn)
    for (const def of TASK_REGISTRY) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const round = generateRound(
          { round: seed * 3, skill: def.maxSkill, foods: pool, forceKind: def.kind },
          mulberry32(seed * 31 + def.minSkill),
        )
        expect(round.tray).toHaveLength(TRAY_SIZE)
        expect(
          simulateFeed(round.request, round.tray),
          `${def.kind} unsatisfiable with drawn foods (seed ${seed})`,
        ).toBe(true)
      }
    }
  })

  it('lets a drawn food be picked by colour, count, mix and not', () => {
    const drawn = drawnPerColor(['purple'])
    const purple = drawn[0]
    expect(wantsFood({ kind: 'color', color: 'purple', count: 2 }, [], purple.id)).toBe(true)
    expect(
      wantsFood({ kind: 'count', entries: [{ foodId: purple.id, count: 2 }] }, [], purple.id),
    ).toBe(true)
    expect(
      wantsFood(
        { kind: 'mix', food: { foodId: 'apple', count: 1 }, color: 'purple', colorCount: 1 },
        [],
        purple.id,
      ),
    ).toBe(true)
    expect(wantsFood({ kind: 'not', bannedColor: 'purple', count: 2 }, [], purple.id)).toBe(false)
    expect(wantsFood({ kind: 'not', bannedColor: 'red', count: 2 }, [], purple.id)).toBe(true)
  })
})

describe('poolWithFood (the callback guarantee)', () => {
  it('leaves a window that already holds the food untouched', () => {
    const window = activePoolForRound(1, FOODS)
    expect(poolWithFood(window, window[3].id, FOODS)).toEqual(window)
  })

  it('splices a missing food in over a SAME-COLOUR member, so the census holds', () => {
    const drawn = drawnPerColor(['brown'])
    const catalog = withDrawnFoods(FOODS, drawn)
    // Sweep every rotation: wherever the window lands, the food ends up in it and
    // the colour census is unchanged.
    for (let round = 1; round <= catalog.length * 3; round++) {
      const before = activePoolForRound(round, catalog)
      const after = poolWithFood(before, drawn[0].id, catalog)
      expect(after.some((f) => f.id === drawn[0].id)).toBe(true)
      expect(after).toHaveLength(before.length)
      for (const color of FOOD_COLORS) {
        expect(after.filter((f) => f.color === color).length).toBe(
          before.filter((f) => f.color === color).length,
        )
      }
    }
  })

  it('is a no-op for an unknown food rather than corrupting the window', () => {
    const window = activePoolForRound(4, FOODS)
    expect(poolWithFood(window, 'drawn-nope', FOODS)).toEqual(window)
    expect(poolWithFood(window, undefined, FOODS)).toEqual(window)
  })

  it('makes a preferFoodId round genuinely about that food, tray included', () => {
    const drawn = drawnPerColor(['green'])
    const catalog = withDrawnFoods(EPISODES[0].foods, drawn)
    for (let round = 1; round <= 24; round++) {
      const built = generateRound(
        { round, skill: 5, foods: catalog, forceKind: 'count', preferFoodId: drawn[0].id },
        mulberry32(round),
      )
      expect(built.request.kind).toBe('count')
      if (built.request.kind !== 'count') continue
      expect(built.request.entries[0].foodId).toBe(drawn[0].id)
      expect(built.tray).toContain(drawn[0].id)
      expect(simulateFeed(built.request, built.tray)).toBe(true)
    }
  })

  it('is a total no-op for a kind that would not WANT the named food', () => {
    const drawn = drawnPerColor(['yellow'])
    const catalog = withDrawnFoods(EPISODES[0].foods, drawn)
    // `not` would BAN the drawing and `pattern`/`color` treat a named food as
    // context, so the nudge must change neither the request nor the pool there.
    for (const kind of ['not', 'pattern', 'color', 'combo', 'mix'] as const) {
      expect(kindWantsNamedFood(kind)).toBe(false)
      for (let round = 1; round <= 12; round++) {
        const nudged = generateRound(
          { round, skill: 12, foods: catalog, forceKind: kind, preferFoodId: drawn[0].id },
          mulberry32(round * 7),
        )
        const plain = generateRound(
          { round, skill: 12, foods: catalog, forceKind: kind },
          mulberry32(round * 7),
        )
        expect(nudged).toEqual(plain)
      }
    }
    for (const kind of ['single', 'count', 'dots'] as const) {
      expect(kindWantsNamedFood(kind)).toBe(true)
    }
  })
})

describe('dominantColor', () => {
  const cellsOf = (indices: number[]) => indices

  it('reads a single-colour grid as that colour', () => {
    const red = PALETTE.findIndex((hex) => hex === '#e5484d')
    expect(dominantColor(cellsOf([red, red, red]), PALETTE)).toBe('red')
  })

  it('ignores paper entirely', () => {
    const green = PALETTE.findIndex((hex) => hex === '#6bcb77')
    expect(dominantColor(cellsOf([0, 0, 0, green]), PALETTE)).toBe('green')
  })

  it('is null for a blank grid', () => {
    expect(dominantColor(cellsOf([0, 0, 0]), PALETTE)).toBeNull()
  })

  it('picks the most common bucket, not the first painted one', () => {
    const purple = PALETTE.findIndex((hex) => hex === '#9b5de5')
    const yellow = PALETTE.findIndex((hex) => hex === '#ffd93d')
    expect(dominantColor(cellsOf([purple, yellow, yellow, yellow]), PALETTE)).toBe('yellow')
  })

  it('breaks ties deterministically on FOOD_COLORS order', () => {
    const red = PALETTE.findIndex((hex) => hex === '#e5484d')
    const green = PALETTE.findIndex((hex) => hex === '#6bcb77')
    expect(dominantColor(cellsOf([green, red]), PALETTE)).toBe('red')
    expect(dominantColor(cellsOf([red, green]), PALETTE)).toBe('red')
  })

  it('snaps every palette swatch to one of the six food colours', () => {
    for (let i = 1; i < PALETTE.length; i++) {
      const color = dominantColor(cellsOf([i]), PALETTE)
      expect(color).not.toBeNull()
      expect(FOOD_COLORS).toContain(color!)
    }
  })

  it('maps each food accent onto its own colour', () => {
    for (const color of FOOD_COLORS) {
      const hex = `#${COLOR_HEX[color].toString(16).padStart(6, '0')}`
      expect(dominantColor([1], [PALETTE[0], hex])).toBe(color)
    }
  })

  it('skips an index the palette does not define', () => {
    expect(dominantColor([99], PALETTE)).toBeNull()
  })
})

describe('when a commission arrives', () => {
  const base = { lastCommissionEpisode: -1, ownedColors: [] as FoodColor[] }

  it('never in the first episode — five friends and a dance party come first', () => {
    expect(
      commissionColor({ ...base, journey: { episode: 0, friendsFed: 0, growthStep: 0 } }),
    ).toBeNull()
    expect(COMMISSION_MIN_EPISODE).toBe(1)
  })

  it('arrives with the FIRST friend of an episode, before it is fed anything', () => {
    expect(
      commissionColor({ ...base, journey: { episode: 1, friendsFed: 0, growthStep: 0 } }),
    ).toBe('red')
    expect(
      commissionColor({ ...base, journey: { episode: 1, friendsFed: 1, growthStep: 0 } }),
    ).toBeNull()
    expect(
      commissionColor({ ...base, journey: { episode: 1, friendsFed: 0, growthStep: 1 } }),
    ).toBeNull()
  })

  it('asks exactly once per episode', () => {
    const journey = { episode: 2, friendsFed: 0, growthStep: 0 }
    expect(commissionColor({ ...base, journey, lastCommissionEpisode: 2 })).toBeNull()
    expect(commissionColor({ ...base, journey, lastCommissionEpisode: 1 })).toBe('red')
  })

  it('asks for missing colours first, in FOOD_COLORS order', () => {
    const journey = { episode: 3, friendsFed: 0, growthStep: 0 }
    expect(commissionColor({ ...base, journey, ownedColors: ['red'] })).toBe('yellow')
    expect(commissionColor({ ...base, journey, ownedColors: ['yellow', 'red'] })).toBe('green')
    expect(
      commissionColor({ ...base, journey, ownedColors: ['green', 'yellow', 'red', 'orange'] }),
    ).toBe('purple')
  })

  it('refreshes the OLDEST slot once all six are owned', () => {
    const journey = { episode: 4, friendsFed: 0, growthStep: 0 }
    // Newest first, so the last entry is the oldest drawing.
    const owned: FoodColor[] = ['brown', 'purple', 'orange', 'green', 'yellow', 'red']
    expect(commissionColor({ ...base, journey, ownedColors: owned })).toBe('red')
  })

  it('collects one food of every colour over six episodes', () => {
    const owned: FoodColor[] = []
    for (let episode = 1; episode <= FOOD_COLORS.length; episode++) {
      const color = commissionColor({
        journey: { episode, friendsFed: 0, growthStep: 0 },
        lastCommissionEpisode: episode - 1,
        ownedColors: owned,
      })
      expect(color).not.toBeNull()
      owned.unshift(color!)
    }
    expect(new Set(owned).size).toBe(FOOD_COLORS.length)
  })

  it('names a colour only once colour rounds are in rotation', () => {
    // The ask upgrades from "draw anything" at exactly the meter value where the
    // child starts meeting colour as a concept — below it, "draw something red"
    // is a riddle rather than an ask.
    const colorUnlock = TASK_REGISTRY.find((def) => def.kind === 'color')!.minSkill
    expect(COMMISSION_COLOR_MIN_SKILL).toBe(colorUnlock)
  })

  it('cannot ask on a journey that has already filled the episode', () => {
    expect(
      commissionColor({
        ...base,
        journey: { episode: 1, friendsFed: FRIENDS_PER_EPISODE - 1, growthStep: 0 },
      }),
    ).toBeNull()
  })

  it('says WHICH rule refused, so an adult can read the answer off the device', () => {
    // The reason is part of the rule's own output rather than something the dev
    // panel re-derives: this beat fires once per episode, so "why has it never
    // happened?" is otherwise unanswerable without reading the source.
    expect(
      commissionGate({ ...base, journey: { episode: 0, friendsFed: 0, growthStep: 0 } }).blockedBy,
    ).toBe('episode')
    expect(
      commissionGate({
        ...base,
        journey: { episode: 2, friendsFed: 0, growthStep: 0 },
        lastCommissionEpisode: 2,
      }).blockedBy,
    ).toBe('already-this-episode')
    expect(
      commissionGate({ ...base, journey: { episode: 1, friendsFed: 2, growthStep: 0 } }).blockedBy,
    ).toBe('friend-in-progress')
    expect(
      commissionGate({ ...base, journey: { episode: 1, friendsFed: 0, growthStep: 1 } }).blockedBy,
    ).toBe('friend-in-progress')
  })

  it('reports no reason when one IS due, and the colour it would ask for', () => {
    const gate = commissionGate({ ...base, journey: { episode: 1, friendsFed: 0, growthStep: 0 } })
    expect(gate.blockedBy).toBeNull()
    expect(gate.color).toBe('red')
  })

  it('keeps commissionColor and commissionGate in lockstep on every input', () => {
    // Two entry points, ONE rule: the gate is the implementation and the colour
    // helper is a view of it, so they can never disagree about whether to ask.
    for (const episode of [0, 1, 2]) {
      for (const friendsFed of [0, 1]) {
        for (const growthStep of [0, 1]) {
          for (const lastCommissionEpisode of [-1, 1, 2]) {
            for (const ownedColors of [[], ['red'], ['red', 'yellow']] as FoodColor[][]) {
              const ctx = {
                journey: { episode, friendsFed, growthStep },
                lastCommissionEpisode,
                ownedColors,
              }
              expect(commissionColor(ctx)).toBe(commissionGate(ctx).color)
            }
          }
        }
      }
    }
  })

  it('announces before it opens the easel, with time to notice the ask', () => {
    // The pad used to appear on the same frame as the ask, which is exactly why
    // the beat read as arbitrary. Long enough to look at the friend and the
    // bubble, short enough not to read as a stall.
    expect(COMMISSION_ANNOUNCE_MS).toBeGreaterThanOrEqual(1000)
    expect(COMMISSION_ANNOUNCE_MS).toBeLessThanOrEqual(2500)
  })
})
