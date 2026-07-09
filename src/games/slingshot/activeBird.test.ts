import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getActiveBird, setActiveBird } from './activeBird'
import type { BirdKind } from './logic'

const KEY = 'ro-games:slingshot-bird'
const ALL_KINDS: BirdKind[] = ['green', 'blue', 'purple', 'red', 'yellow']

describe('slingshot active bird', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('defaults to green when nothing is stored', () => {
    expect(getActiveBird()).toBe('green')
  })

  it('persists a kind and reads it back', () => {
    setActiveBird('purple')
    expect(localStorage.getItem(KEY)).toBe('purple')
    expect(getActiveBird()).toBe('purple')
    setActiveBird('yellow')
    expect(getActiveBird()).toBe('yellow')
  })

  it('round-trips every one of the five kinds', () => {
    for (const kind of ALL_KINDS) {
      setActiveBird(kind)
      expect(getActiveBird()).toBe(kind)
    }
  })

  it('falls back to green on garbage in storage (incl. legacy strings)', () => {
    for (const junk of ['big', 'normal', 'rainbow', '', '{}', 'constructor', '123']) {
      localStorage.setItem(KEY, junk)
      expect(getActiveBird(), `"${junk}" must fall back`).toBe('green')
    }
  })
})
