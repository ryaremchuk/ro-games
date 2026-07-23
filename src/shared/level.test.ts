import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearLevel, getLevel, initLevel, reportLevel, subscribeLevel } from './level'
import { addStars, resetProgressMemory } from './progress'

afterEach(() => {
  clearLevel()
  resetProgressMemory()
  localStorage.clear()
})

describe('shared level store', () => {
  it('starts hidden and carries reported levels', () => {
    clearLevel()
    expect(getLevel()).toBeNull()
    reportLevel(1)
    expect(getLevel()).toBe(1)
    reportLevel(7)
    expect(getLevel()).toBe(7)
    clearLevel()
    expect(getLevel()).toBeNull()
  })

  it('normalizes bad input to a sane 1-based integer', () => {
    reportLevel(0)
    expect(getLevel()).toBe(1)
    reportLevel(-3)
    expect(getLevel()).toBe(1)
    reportLevel(2.9)
    expect(getLevel()).toBe(2)
  })

  it('notifies subscribers only on actual changes', () => {
    const seen = vi.fn()
    const unsubscribe = subscribeLevel(seen)

    reportLevel(2)
    reportLevel(2) // no-op
    reportLevel(3)
    clearLevel()
    clearLevel() // no-op

    expect(seen.mock.calls.map(([level]) => level)).toEqual([2, 3, null])
    unsubscribe()
    reportLevel(9)
    expect(seen).toHaveBeenCalledTimes(3)
  })

  it('resumes the badge from the saved star trophy (persists across sessions)', () => {
    // Prior sessions banked 10 stars = 10 levels passed.
    addStars('demo', 10)

    initLevel('demo')
    reportLevel(1) // fresh session starts at session-level 1
    expect(getLevel()).toBe(11) // 10 baseline + 1

    reportLevel(3) // passed two more levels this session
    expect(getLevel()).toBe(13)
  })

  it('snapshots the baseline so a star banked mid-session is not double-counted', () => {
    addStars('demo', 4)
    initLevel('demo')
    reportLevel(1)
    expect(getLevel()).toBe(5)

    // A star banked now (level passed) grows the trophy...
    addStars('demo')
    // ...but the badge tracks the SESSION level against the startup snapshot,
    // so the next reported level is 6, not 7.
    reportLevel(2)
    expect(getLevel()).toBe(6)
  })

  it('drops the baseline on clear so the next game starts clean', () => {
    addStars('demo', 5)
    initLevel('demo')
    reportLevel(1)
    expect(getLevel()).toBe(6)

    clearLevel() // game unmounts
    reportLevel(1) // a game that never called initLevel
    expect(getLevel()).toBe(1)
  })
})
