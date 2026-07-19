import { describe, expect, it } from 'vitest'
import {
  BASE_SCALE,
  DETAIL_POOL,
  EPISODES,
  FIRST_DETAIL_STEP,
  FRIENDS_PER_EPISODE,
  FULL_SCALE,
  GROW_STEPS,
  darken,
  detailsForFriend,
  episodeFor,
  feedStep,
  friendColor,
  initialJourney,
  journeyFromData,
  journeyToData,
  scaleForStep,
  shrinkStep,
  visibleDetails,
} from './journey'
import { ACTIVE_POOL_SIZE, COLOR_HEX, activePoolForRound, wantsFood, generateRound } from './logic'
import type { JourneyState } from './journey'

describe('growth scale', () => {
  it('starts small and visibly outgrows the old fixed monster', () => {
    expect(scaleForStep(0)).toBe(BASE_SCALE)
    expect(scaleForStep(GROW_STEPS)).toBe(FULL_SCALE)
    expect(FULL_SCALE - BASE_SCALE).toBeGreaterThanOrEqual(0.7) // clearly visible
  })

  it('grows strictly per step and clamps outside the range', () => {
    for (let step = 1; step <= GROW_STEPS; step++) {
      expect(scaleForStep(step)).toBeGreaterThan(scaleForStep(step - 1))
    }
    expect(scaleForStep(-3)).toBe(BASE_SCALE)
    expect(scaleForStep(GROW_STEPS + 5)).toBe(FULL_SCALE)
  })
})

describe('journey state machine', () => {
  it('grows step by step, then crowns the friend, then completes the episode', () => {
    let journey = initialJourney()
    // Grow one friend fully: GROW_STEPS fed rounds.
    for (let step = 1; step < GROW_STEPS; step++) {
      const { next, outcome } = feedStep(journey)
      expect(outcome).toBe('grew')
      expect(next.growthStep).toBe(step)
      journey = next
    }
    const grown = feedStep(journey)
    expect(grown.outcome).toBe('friend-grown')
    expect(grown.next).toEqual({ episode: 0, friendsFed: 1, growthStep: 0 })

    // Fast-forward to the 5th friend's final bite: the dance party.
    let last: JourneyState = {
      episode: 0,
      friendsFed: FRIENDS_PER_EPISODE - 1,
      growthStep: GROW_STEPS - 1,
    }
    const party = feedStep(last)
    expect(party.outcome).toBe('episode-complete')
    expect(party.next).toEqual({ episode: 1, friendsFed: 0, growthStep: 0 })
  })

  it('an episode takes exactly GROW_STEPS × FRIENDS_PER_EPISODE fed rounds', () => {
    let journey = initialJourney()
    let rounds = 0
    while (journey.episode === 0) {
      journey = feedStep(journey).next
      rounds++
    }
    expect(rounds).toBe(GROW_STEPS * FRIENDS_PER_EPISODE)
  })

  it('shrinks one step per wrong feed and never below the start', () => {
    const journey: JourneyState = { episode: 2, friendsFed: 3, growthStep: 2 }
    const once = shrinkStep(journey)
    expect(once.growthStep).toBe(1)
    expect(shrinkStep(shrinkStep(once)).growthStep).toBe(0) // floor, no-fail
    expect(once.episode).toBe(2)
    expect(once.friendsFed).toBe(3)
  })

  it('round-trips through the persisted data bag and survives garbage', () => {
    const journey: JourneyState = { episode: 7, friendsFed: 4, growthStep: 5 }
    expect(journeyFromData(journeyToData(journey))).toEqual(journey)
    expect(journeyFromData({})).toEqual(initialJourney())
    expect(journeyFromData({ episode: -3, friendsFed: 99, growthStep: Number.NaN })).toEqual({
      episode: 0,
      friendsFed: FRIENDS_PER_EPISODE - 1,
      growthStep: 0,
    })
  })
})

describe('friend looks', () => {
  it('gives consecutive friends different colors, stable across calls', () => {
    for (let episode = 0; episode < 4; episode++) {
      for (let i = 0; i < FRIENDS_PER_EPISODE - 1; i++) {
        expect(friendColor(episode, i)).not.toBe(friendColor(episode, i + 1))
        expect(friendColor(episode, i)).toBe(friendColor(episode, i))
      }
    }
  })

  it('darken produces a darker same-format color', () => {
    const dark = darken(0x9b5de5)
    expect(dark).toBeLessThan(0x9b5de5)
    expect(dark).toBeGreaterThan(0)
  })

  it('plans one detail per step from FIRST_DETAIL_STEP, crown always last', () => {
    for (let episode = 0; episode < 3; episode++) {
      for (let friend = 0; friend < FRIENDS_PER_EPISODE; friend++) {
        const plan = detailsForFriend(episode, friend)
        expect(plan).toHaveLength(GROW_STEPS - FIRST_DETAIL_STEP + 1)
        expect(plan[plan.length - 1]).toBe('crown')
        const beforeCrown = plan.slice(0, -1)
        expect(new Set(beforeCrown).size).toBe(beforeCrown.length) // no repeats
        for (const detail of beforeCrown) expect(DETAIL_POOL).toContain(detail)
        expect(detailsForFriend(episode, friend)).toEqual(plan) // deterministic
      }
    }
  })

  it('friends differ from each other in their detail plans', () => {
    const plans = new Set<string>()
    for (let friend = 0; friend < FRIENDS_PER_EPISODE; friend++) {
      plans.add(detailsForFriend(0, friend).join(','))
    }
    expect(plans.size).toBeGreaterThan(1)
  })

  it('reveals details as a prefix that tracks the growth step', () => {
    const plan = detailsForFriend(1, 2)
    expect(visibleDetails(plan, 0)).toEqual([])
    expect(visibleDetails(plan, FIRST_DETAIL_STEP - 1)).toEqual([])
    expect(visibleDetails(plan, FIRST_DETAIL_STEP)).toEqual(plan.slice(0, 1))
    expect(visibleDetails(plan, GROW_STEPS)).toEqual(plan)
  })
})

describe('episodes', () => {
  it('every episode pool is three full 6-color cycles (requests satisfiable)', () => {
    const colorCount = Object.keys(COLOR_HEX).length
    for (const episode of EPISODES) {
      expect(episode.foods).toHaveLength(colorCount * 3)
      for (let cycle = 0; cycle < 3; cycle++) {
        const window = episode.foods.slice(cycle * colorCount, (cycle + 1) * colorCount)
        expect(new Set(window.map((f) => f.color)).size).toBe(colorCount)
      }
      // No duplicate foods inside one episode.
      expect(new Set(episode.foods.map((f) => f.id)).size).toBe(episode.foods.length)
    }
  })

  it('keeps every color inside every rotation window of every episode', () => {
    for (const episode of EPISODES) {
      for (let round = 1; round <= 30; round++) {
        const pool = activePoolForRound(round, episode.foods)
        expect(pool).toHaveLength(ACTIVE_POOL_SIZE)
        expect(new Set(pool.map((f) => f.color)).size).toBe(Object.keys(COLOR_HEX).length)
      }
    }
  })

  it('generates satisfiable rounds from every episode pool', () => {
    for (const episode of EPISODES) {
      for (let round = 1; round <= 12; round++) {
        const seedRng = (() => {
          let a = round * 1000 + episode.foods.length
          return () => {
            a = (a * 16807) % 2147483647
            return (a - 1) / 2147483646
          }
        })()
        const { request, tray } = generateRound({ round, skill: 8, foods: episode.foods }, seedRng)
        const eaten: string[] = []
        const remaining = [...tray]
        for (;;) {
          const index = remaining.findIndex((id) => wantsFood(request, eaten, id))
          if (index < 0) break
          eaten.push(remaining[index])
          remaining.splice(index, 1)
        }
        expect(eaten.length).toBeGreaterThan(0)
      }
    }
  })

  it('themes wrap forever', () => {
    expect(episodeFor({ episode: 0, friendsFed: 0, growthStep: 0 }).id).toBe(EPISODES[0].id)
    expect(episodeFor({ episode: EPISODES.length, friendsFed: 0, growthStep: 0 }).id).toBe(
      EPISODES[0].id,
    )
    expect(episodeFor({ episode: EPISODES.length + 2, friendsFed: 0, growthStep: 0 }).id).toBe(
      EPISODES[2].id,
    )
  })

  it('episode palettes are distinct', () => {
    const tops = new Set(EPISODES.map((e) => e.palette.bgTop))
    expect(tops.size).toBe(EPISODES.length)
  })
})
