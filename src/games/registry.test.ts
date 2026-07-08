import { describe, expect, it } from 'vitest'
import { games } from './registry'

describe('game registry', () => {
  it('has unique ids and paths', () => {
    const ids = games.map((game) => game.id)
    const paths = games.map((game) => game.path)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('uses absolute route paths', () => {
    for (const game of games) {
      expect(game.path.startsWith('/')).toBe(true)
    }
  })

  it('includes the drawing game', () => {
    expect(games.some((game) => game.id === 'drawing')).toBe(true)
  })
})
