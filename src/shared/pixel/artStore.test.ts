import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_DRAWINGS,
  clearRole,
  deleteDrawing,
  drawingToGrid,
  findDrawings,
  getDrawing,
  gridToDrawing,
  listDrawings,
  makeDrawingId,
  newestDrawing,
  newestPerTag,
  resetArtMemory,
  saveDrawing,
  subscribeArt,
} from './artStore'
import type { Drawing } from './artStore'
import { createGrid, paintCell } from './grid'

const KEY = 'ro-games:art:drawings'

function drawing(at: number, extra: Partial<Drawing> = {}): Drawing {
  const grid = createGrid(16)
  paintCell(grid, 1, 1, 3)
  return { ...gridToDrawing(grid, { createdAt: at, id: makeDrawingId(at) }), ...extra }
}

beforeEach(() => {
  localStorage.clear()
  resetArtMemory()
})

describe('save / list / delete', () => {
  it('lists newest first', () => {
    saveDrawing(drawing(100, { id: 'a' }))
    saveDrawing(drawing(300, { id: 'c' }))
    saveDrawing(drawing(200, { id: 'b' }))
    expect(listDrawings().map((d) => d.id)).toEqual(['c', 'b', 'a'])
  })

  it('same-millisecond drawings keep newest-saved first', () => {
    saveDrawing(drawing(500, { id: 'first' }))
    saveDrawing(drawing(500, { id: 'second' }))
    expect(listDrawings().map((d) => d.id)).toEqual(['second', 'first'])
  })

  it('saving the same id replaces rather than duplicates', () => {
    saveDrawing(drawing(100, { id: 'x', tag: 'red' }))
    saveDrawing(drawing(150, { id: 'x', tag: 'green' }))
    const all = listDrawings()
    expect(all).toHaveLength(1)
    expect(all[0].tag).toBe('green')
  })

  it('deletes by id and reads a single drawing back', () => {
    saveDrawing(drawing(100, { id: 'keep' }))
    saveDrawing(drawing(200, { id: 'drop' }))
    expect(getDrawing('drop')).not.toBeNull()
    deleteDrawing('drop')
    expect(getDrawing('drop')).toBeNull()
    expect(listDrawings().map((d) => d.id)).toEqual(['keep'])
  })

  it('notifies subscribers on every write, and stops after unsubscribe', () => {
    const listener = vi.fn()
    const off = subscribeArt(listener)
    saveDrawing(drawing(100))
    expect(listener).toHaveBeenCalledTimes(1)
    deleteDrawing('nope')
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    saveDrawing(drawing(200))
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('commissioned art: newest per (role, tag) wins', () => {
  it('finds by role, and by role + tag', () => {
    saveDrawing(drawing(100, { id: 'red-old', role: 'ftm-food', tag: 'red' }))
    saveDrawing(drawing(200, { id: 'green', role: 'ftm-food', tag: 'green' }))
    saveDrawing(drawing(300, { id: 'red-new', role: 'ftm-food', tag: 'red' }))
    saveDrawing(drawing(400, { id: 'free' }))

    expect(findDrawings('ftm-food').map((d) => d.id)).toEqual(['red-new', 'green', 'red-old'])
    expect(findDrawings('ftm-food', 'red').map((d) => d.id)).toEqual(['red-new', 'red-old'])
    expect(newestDrawing('ftm-food', 'red')?.id).toBe('red-new')
    expect(newestDrawing('whack-critter')).toBeNull()
  })

  it('newestPerTag returns exactly one per ask — the retired one stays in the gallery', () => {
    saveDrawing(drawing(100, { id: 'red-old', role: 'ftm-food', tag: 'red' }))
    saveDrawing(drawing(200, { id: 'red-new', role: 'ftm-food', tag: 'red' }))
    saveDrawing(drawing(300, { id: 'brown', role: 'ftm-food', tag: 'brown' }))

    expect(newestPerTag('ftm-food').map((d) => d.id)).toEqual(['brown', 'red-new'])
    expect(
      listDrawings().map((d) => d.id),
      'nothing is destroyed',
    ).toEqual(['brown', 'red-new', 'red-old'])
  })

  it('clearRole wipes one slot and leaves free-play art alone', () => {
    saveDrawing(drawing(100, { id: 'food', role: 'ftm-food', tag: 'red' }))
    saveDrawing(drawing(200, { id: 'free' }))
    clearRole('ftm-food')
    expect(listDrawings().map((d) => d.id)).toEqual(['free'])
  })
})

describe('robustness', () => {
  it('skips a corrupt row instead of throwing', () => {
    localStorage.setItem(KEY, JSON.stringify([{ nope: true }, drawing(100, { id: 'ok' })]))
    expect(listDrawings().map((d) => d.id)).toEqual(['ok'])
  })

  it('treats unparseable JSON as an empty gallery', () => {
    localStorage.setItem(KEY, '{{{ not json')
    expect(listDrawings()).toEqual([])
  })

  it('treats a non-array document as an empty gallery', () => {
    localStorage.setItem(KEY, JSON.stringify({ drawings: [] }))
    expect(listDrawings()).toEqual([])
  })

  it('falls back to memory when the quota rejects a write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null)
    try {
      saveDrawing(drawing(100, { id: 'mem' }))
      expect(listDrawings().map((d) => d.id)).toEqual(['mem'])
    } finally {
      setItem.mockRestore()
      getItem.mockRestore()
    }
  })

  it('prunes past the cap but never the newest of a commissioned slot', () => {
    saveDrawing(drawing(1, { id: 'commissioned', role: 'ftm-food', tag: 'red' }))
    for (let i = 0; i < MAX_DRAWINGS + 5; i++) {
      saveDrawing(drawing(100 + i, { id: `free-${i}` }))
    }
    const all = listDrawings()
    expect(all).toHaveLength(MAX_DRAWINGS)
    expect(
      all.some((d) => d.id === 'commissioned'),
      'the food the monster is eating is never pruned',
    ).toBe(true)
    expect(
      all.some((d) => d.id === 'free-0'),
      'the oldest free page is',
    ).toBe(false)
  })
})

describe('grid ↔ drawing', () => {
  it('round-trips a painted grid', () => {
    const grid = createGrid(16)
    paintCell(grid, 0, 0, 3)
    paintCell(grid, 15, 15, 11)
    const back = drawingToGrid(gridToDrawing(grid))
    expect([...back.cells]).toEqual([...grid.cells])
    expect(back.w).toBe(16)
    expect(back.h).toBe(16)
  })

  it('carries its own palette copy so a later palette edit cannot repaint it', () => {
    const made = gridToDrawing(createGrid(16))
    expect(made.palette.length).toBeGreaterThan(1)
    made.palette[3] = '#000000'
    expect(gridToDrawing(createGrid(16)).palette[3]).not.toBe('#000000')
  })

  it('omits role and tag for free play', () => {
    const made = gridToDrawing(createGrid(16))
    expect('role' in made).toBe(false)
    expect('tag' in made).toBe(false)
  })

  it('mints unique ids inside one millisecond', () => {
    const ids = new Set(Array.from({ length: 200 }, () => makeDrawingId(1000)))
    expect(ids.size).toBe(200)
  })
})
