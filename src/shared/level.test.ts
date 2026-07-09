import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearLevel, getLevel, reportLevel, subscribeLevel } from './level'

afterEach(() => clearLevel())

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
})
