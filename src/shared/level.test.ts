import { afterEach, describe, expect, it, vi } from 'vitest'
import { levelFor, setLevelHidden, subscribeLevel, visibleLevel } from './level'
import { addStars, resetProgressMemory } from './progress'

afterEach(() => {
  setLevelHidden(false)
  resetProgressMemory()
  localStorage.clear()
})

describe('shared level', () => {
  it('is the single formula level = stars + 1 (fresh game is level 1)', () => {
    expect(levelFor('demo')).toBe(1)
    addStars('demo') // one level passed
    expect(levelFor('demo')).toBe(2)
    addStars('demo', 8) // eight more
    expect(levelFor('demo')).toBe(10)
  })

  it('is per-game — one game does not move another', () => {
    addStars('a', 3)
    expect(levelFor('a')).toBe(4)
    expect(levelFor('b')).toBe(1)
  })

  it('is the SAME number the launcher tile and the in-game badge read', () => {
    // Both surfaces derive from levelFor, so they can never disagree: whatever
    // the tile shows (levelFor) equals the visible badge (visibleLevel).
    addStars('demo', 89)
    expect(levelFor('demo')).toBe(90)
    expect(visibleLevel('demo')).toBe(90)
  })

  it('hides the badge when suppressed, and restores it', () => {
    addStars('demo', 4)
    expect(visibleLevel('demo')).toBe(5)
    setLevelHidden(true)
    expect(visibleLevel('demo')).toBeNull()
    setLevelHidden(false)
    expect(visibleLevel('demo')).toBe(5)
  })

  it('notifies subscribers when the game banks a star', () => {
    const seen = vi.fn()
    const unsubscribe = subscribeLevel('demo', seen)

    addStars('demo')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(visibleLevel('demo')).toBe(2)

    unsubscribe()
    addStars('demo')
    expect(seen).toHaveBeenCalledTimes(1) // no longer listening
  })

  it('notifies subscribers when the badge is hidden or shown', () => {
    const seen = vi.fn()
    const unsubscribe = subscribeLevel('demo', seen)

    setLevelHidden(true)
    setLevelHidden(true) // no-op, same value
    setLevelHidden(false)
    expect(seen).toHaveBeenCalledTimes(2)

    unsubscribe()
    setLevelHidden(true)
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('does not cross-notify between games', () => {
    const seenA = vi.fn()
    const unsubscribe = subscribeLevel('a', seenA)

    addStars('b') // a different game
    expect(seenA).not.toHaveBeenCalled()

    unsubscribe()
  })
})
