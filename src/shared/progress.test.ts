import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addStars,
  getStars,
  loadProgress,
  resetProgressMemory,
  saveData,
  saveSkill,
  sessionStart,
  subscribeProgress,
  WARMUP_DROP,
} from './progress'

const DAY_MS = 24 * 60 * 60 * 1000

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  resetProgressMemory()
})

describe('sessionStart', () => {
  it('starts WARMUP_DROP below the saved meter', () => {
    expect(sessionStart(8, { max: 12, lastPlayedAt: null })).toBe(8 - WARMUP_DROP)
  })

  it('never goes below the floor', () => {
    expect(sessionStart(1, { max: 12, lastPlayedAt: null })).toBe(0)
    expect(sessionStart(2, { max: 5, min: 1, lastPlayedAt: null, warmupDrop: 1 })).toBe(1)
  })

  it('never exceeds the ceiling even for inflated saves', () => {
    expect(sessionStart(99, { max: 12, lastPlayedAt: null })).toBe(12)
  })

  it('decays one extra step per full week away', () => {
    const now = 1_700_000_000_000
    const twoWeeksAgo = now - 15 * DAY_MS
    expect(sessionStart(10, { max: 12, lastPlayedAt: twoWeeksAgo, now })).toBe(10 - WARMUP_DROP - 2)
  })

  it('applies no decay for a same-week return', () => {
    const now = 1_700_000_000_000
    expect(sessionStart(10, { max: 12, lastPlayedAt: now - 3 * DAY_MS, now })).toBe(
      10 - WARMUP_DROP,
    )
  })

  it('honours a custom warm-up drop (small-scale meters)', () => {
    expect(sessionStart(4, { max: 5, min: 1, lastPlayedAt: null, warmupDrop: 1 })).toBe(3)
  })
})

describe('progress storage', () => {
  it('returns an empty record for an unknown game', () => {
    expect(loadProgress('nope')).toEqual({ stars: 0, skill: {}, data: {}, lastPlayedAt: null })
  })

  it('round-trips skill axes and stamps lastPlayedAt', () => {
    saveSkill('g', { motor: 5, cognitive: 7 })
    const progress = loadProgress('g')
    expect(progress.skill).toEqual({ motor: 5, cognitive: 7 })
    expect(progress.lastPlayedAt).not.toBeNull()
  })

  it('merges new axes over existing ones', () => {
    saveSkill('g', { motor: 5, cognitive: 7 })
    saveSkill('g', { cognitive: 8 })
    expect(loadProgress('g').skill).toEqual({ motor: 5, cognitive: 8 })
  })

  it('accumulates stars and keeps them independent of skill saves', () => {
    expect(addStars('g')).toBe(1)
    expect(addStars('g', 2)).toBe(3)
    saveSkill('g', { motor: 1 })
    expect(getStars('g')).toBe(3)
  })

  it('ignores non-positive star additions', () => {
    addStars('g')
    expect(addStars('g', 0)).toBe(1)
    expect(addStars('g', -5)).toBe(1)
  })

  it('keeps games separate', () => {
    addStars('a')
    expect(getStars('b')).toBe(0)
  })

  it('recovers from corrupt storage', () => {
    localStorage.setItem('ro-games:progress:g', '{not json')
    expect(loadProgress('g')).toEqual({ stars: 0, skill: {}, data: {}, lastPlayedAt: null })
    localStorage.setItem('ro-games:progress:g', JSON.stringify({ stars: 'many', skill: 3 }))
    expect(loadProgress('g')).toEqual({ stars: 0, skill: {}, data: {}, lastPlayedAt: null })
  })

  it('drops non-finite skill values on load', () => {
    localStorage.setItem(
      'ro-games:progress:g',
      JSON.stringify({ stars: 2.9, skill: { motor: 4, broken: 'x' }, lastPlayedAt: 5 }),
    )
    expect(loadProgress('g')).toEqual({ stars: 2, skill: { motor: 4 }, data: {}, lastPlayedAt: 5 })
  })

  it('round-trips game data, merging patches and staying separate from skill', () => {
    saveData('g', { episode: 1, friendsFed: 3 })
    saveData('g', { friendsFed: 4, growthStep: 2 })
    const progress = loadProgress('g')
    expect(progress.data).toEqual({ episode: 1, friendsFed: 4, growthStep: 2 })
    expect(progress.skill).toEqual({})
    saveSkill('g', { cognitive: 5 })
    expect(loadProgress('g').data).toEqual({ episode: 1, friendsFed: 4, growthStep: 2 })
  })

  it('drops non-finite data values on load', () => {
    localStorage.setItem(
      'ro-games:progress:g',
      JSON.stringify({ data: { episode: 2, broken: 'x', nan: null } }),
    )
    expect(loadProgress('g').data).toEqual({ episode: 2 })
  })

  it('falls back to memory when localStorage writes throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    addStars('g')
    addStars('g')
    expect(getStars('g')).toBe(2)
  })
})

describe('subscribeProgress', () => {
  it('notifies on a game save and stops after unsubscribe', () => {
    const seen = vi.fn()
    const unsubscribe = subscribeProgress('g', seen)

    addStars('g')
    saveSkill('g', { motor: 3 })
    saveData('g', { episode: 1 })
    expect(seen).toHaveBeenCalledTimes(3)

    unsubscribe()
    addStars('g')
    expect(seen).toHaveBeenCalledTimes(3)
  })

  it('only fires for the game that changed', () => {
    const seen = vi.fn()
    const unsubscribe = subscribeProgress('g', seen)

    addStars('other')
    expect(seen).not.toHaveBeenCalled()

    unsubscribe()
  })
})
