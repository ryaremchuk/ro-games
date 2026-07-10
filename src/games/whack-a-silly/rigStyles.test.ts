import { describe, expect, it } from 'vitest'
import { CRITTERS } from './logic'
import { RIG_STYLES, everyCritterHasStyle, rigStyleFor } from './rigStyles'

describe('rig styles', () => {
  it('has a style for every critter id in the pool', () => {
    expect(everyCritterHasStyle()).toBe(true)
    for (const critter of CRITTERS) {
      expect(RIG_STYLES[critter.id]).toBeDefined()
    }
  })

  it('exposes numeric body/belly/paw colors for each style', () => {
    for (const critter of CRITTERS) {
      const style = rigStyleFor(critter.id)
      expect(typeof style.bodyColor).toBe('number')
      expect(typeof style.bellyColor).toBe('number')
      expect(typeof style.pawColor).toBe('number')
    }
  })

  it('throws on an unknown critter id', () => {
    expect(() => rigStyleFor('dragon')).toThrow()
  })
})
