import { describe, expect, it } from 'vitest'
import {
  ANIMALS,
  BAND_SIZE,
  FAILS_TO_DROP,
  MAX_LENGTH,
  PAD_COLORS,
  PAD_PITCHES,
  ROTATE_EVERY,
  STAR_LENGTH,
  START_LENGTH,
  applyFail,
  applySuccess,
  bandForRounds,
  celebrationTier,
  checkTap,
  extendSequence,
  initialBandState,
  newSequence,
  randomPad,
  stageBand,
} from './logic'
import type { BandState, Rng } from './logic'

/** Seeded RNG so every property below is reproducible. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1)

function stateWith(overrides: Partial<BandState>): BandState {
  return {
    sequence: [0, 1],
    failsAtLength: 0,
    hints: false,
    roundsCompleted: 0,
    ...overrides,
  }
}

describe('animal pool', () => {
  it('has 8 animals with unique ids, names and emoji', () => {
    expect(ANIMALS).toHaveLength(8)
    expect(new Set(ANIMALS.map((a) => a.id)).size).toBe(8)
    expect(new Set(ANIMALS.map((a) => a.name)).size).toBe(8)
    expect(new Set(ANIMALS.map((a) => a.emoji)).size).toBe(8)
  })

  it('ties pitch and pad color to the pool slot (i % 4)', () => {
    ANIMALS.forEach((animal, i) => {
      expect(animal.pitch).toBe(PAD_PITCHES[i % BAND_SIZE])
      expect(animal.color).toBe(PAD_COLORS[i % BAND_SIZE])
    })
  })

  it('uses the specified harmonious pitches C5 E5 G5 C6', () => {
    expect([...PAD_PITCHES]).toEqual([523, 659, 784, 1047])
  })
})

describe('stage rotation', () => {
  it('always fields 4 animals with pitch ascending by pad position', () => {
    for (let rotation = 0; rotation < 16; rotation++) {
      const band = stageBand(rotation)
      expect(band).toHaveLength(BAND_SIZE)
      band.forEach((animal, pad) => {
        expect(animal.pitch).toBe(PAD_PITCHES[pad])
        expect(animal.color).toBe(PAD_COLORS[pad])
      })
    }
  })

  it('keeps every animal on the same pitch in every line-up it joins', () => {
    const pitchById = new Map(ANIMALS.map((a) => [a.id, a.pitch]))
    for (let rotation = 0; rotation < 16; rotation++) {
      for (const animal of stageBand(rotation)) {
        expect(animal.pitch).toBe(pitchById.get(animal.id))
      }
    }
  })

  it('rotates through the whole pool of 8', () => {
    const seen = new Set<string>()
    for (let rotation = 0; rotation < ANIMALS.length; rotation++) {
      for (const animal of stageBand(rotation)) seen.add(animal.id)
    }
    expect(seen.size).toBe(ANIMALS.length)
  })

  it('changes the line-up between consecutive rotations', () => {
    for (let rotation = 0; rotation < 8; rotation++) {
      const ids = stageBand(rotation).map((a) => a.id)
      const nextIds = stageBand(rotation + 1).map((a) => a.id)
      expect(nextIds).not.toEqual(ids)
    }
  })

  it('swaps the band every ROTATE_EVERY successful rounds', () => {
    const ids = (rounds: number) => bandForRounds(rounds).map((a) => a.id)
    for (let r = 0; r < ROTATE_EVERY; r++) {
      expect(ids(r)).toEqual(ids(0))
    }
    expect(ids(ROTATE_EVERY)).not.toEqual(ids(0))
    expect(ids(ROTATE_EVERY * 2)).not.toEqual(ids(ROTATE_EVERY))
  })
})

describe('sequence generation', () => {
  it('generates sequences of the requested length within pad range', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (const length of [2, 3, 5, 8]) {
        const seq = newSequence(length, rng)
        expect(seq).toHaveLength(length)
        for (const pad of seq) {
          expect(pad).toBeGreaterThanOrEqual(0)
          expect(pad).toBeLessThan(BAND_SIZE)
          expect(Number.isInteger(pad)).toBe(true)
        }
      }
    }
  })

  it('never repeats the same pad twice in a row', () => {
    for (const seed of SEEDS) {
      const seq = newSequence(40, mulberry32(seed))
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).not.toBe(seq[i - 1])
      }
    }
  })

  it('eventually uses every pad', () => {
    const seq = newSequence(60, mulberry32(7))
    expect(new Set(seq).size).toBe(BAND_SIZE)
  })

  it('extends by exactly one step, preserving the known prefix', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      const seq = newSequence(4, rng)
      const extended = extendSequence(seq, rng)
      expect(extended).toHaveLength(5)
      expect(extended.slice(0, 4)).toEqual(seq)
      expect(extended[4]).not.toBe(seq[3])
    }
  })

  it('respects the exclusion in randomPad', () => {
    for (const seed of SEEDS) {
      const rng = mulberry32(seed)
      for (let exclude = 0; exclude < BAND_SIZE; exclude++) {
        for (let i = 0; i < 20; i++) {
          const pad = randomPad(rng, exclude)
          expect(pad).not.toBe(exclude)
          expect(pad).toBeGreaterThanOrEqual(0)
          expect(pad).toBeLessThan(BAND_SIZE)
        }
      }
    }
  })
})

describe('echo validation', () => {
  const sequence = [2, 0, 3, 1]

  it('accepts correct partial progress', () => {
    expect(checkTap(sequence, 0, 2)).toBe('correct')
    expect(checkTap(sequence, 1, 0)).toBe('correct')
    expect(checkTap(sequence, 2, 3)).toBe('correct')
  })

  it('reports completion on the final correct tap', () => {
    expect(checkTap(sequence, 3, 1)).toBe('complete')
    expect(checkTap([0, 1], 1, 1)).toBe('complete')
  })

  it('flags a wrong tap at any position', () => {
    expect(checkTap(sequence, 0, 1)).toBe('wrong')
    expect(checkTap(sequence, 2, 0)).toBe('wrong')
    expect(checkTap(sequence, 3, 3)).toBe('wrong')
  })
})

describe('adaptive difficulty', () => {
  it('starts at length 2 with hints off', () => {
    for (const seed of SEEDS) {
      const state = initialBandState(mulberry32(seed))
      expect(state.sequence).toHaveLength(START_LENGTH)
      expect(state.hints).toBe(false)
      expect(state.failsAtLength).toBe(0)
      expect(state.roundsCompleted).toBe(0)
    }
  })

  it('grows by one on success, keeping the prefix and clearing hints', () => {
    const state = stateWith({ sequence: [0, 1, 2], hints: true, failsAtLength: 1 })
    const next = applySuccess(state, mulberry32(3))
    expect(next.sequence).toHaveLength(4)
    expect(next.sequence.slice(0, 3)).toEqual([0, 1, 2])
    expect(next.hints).toBe(false)
    expect(next.failsAtLength).toBe(0)
    expect(next.roundsCompleted).toBe(1)
  })

  it('caps the length at MAX_LENGTH with a fresh sequence', () => {
    let state = stateWith({ sequence: newSequence(MAX_LENGTH, mulberry32(1)) })
    for (let i = 0; i < 3; i++) {
      const next = applySuccess(state, mulberry32(i + 10))
      expect(next.sequence).toHaveLength(MAX_LENGTH)
      expect(next.sequence).not.toEqual(state.sequence)
      state = next
    }
  })

  it('only counts the first fail — same length, no hints yet', () => {
    const state = stateWith({ sequence: [0, 1, 2] })
    const next = applyFail(state)
    expect(next.failsAtLength).toBe(1)
    expect(next.sequence).toEqual([0, 1, 2])
    expect(next.hints).toBe(false)
  })

  it(`drops back one and enables hints after ${FAILS_TO_DROP} consecutive fails`, () => {
    let state = stateWith({ sequence: [0, 1, 2, 3] })
    for (let i = 0; i < FAILS_TO_DROP; i++) state = applyFail(state)
    expect(state.sequence).toEqual([0, 1, 2])
    expect(state.hints).toBe(true)
    expect(state.failsAtLength).toBe(0)
    expect(state.roundsCompleted).toBe(0)
  })

  it('never shrinks below the start length', () => {
    let state = stateWith({ sequence: [0, 1] })
    for (let i = 0; i < 6; i++) state = applyFail(state)
    expect(state.sequence).toHaveLength(START_LENGTH)
    expect(state.hints).toBe(true)
  })

  it('requires a fresh fail streak after each drop-back', () => {
    let state = stateWith({ sequence: [0, 1, 2, 3] })
    state = applyFail(state)
    state = applyFail(state) // drop to 3, streak resets
    state = applyFail(state) // first fail at new length — no drop yet
    expect(state.sequence).toHaveLength(3)
    expect(state.failsAtLength).toBe(1)
  })

  it('keeps hints on through failures and only clears them on success', () => {
    let state = stateWith({ sequence: [0, 1, 2], hints: true })
    state = applyFail(state)
    expect(state.hints).toBe(true)
    state = applySuccess(state, mulberry32(5))
    expect(state.hints).toBe(false)
  })
})

describe('celebration tiers', () => {
  it('cheers for ordinary lengths and showers stars from 5 up', () => {
    expect(celebrationTier(2)).toBe('cheer')
    expect(celebrationTier(STAR_LENGTH - 1)).toBe('cheer')
    expect(celebrationTier(STAR_LENGTH)).toBe('stars')
    expect(celebrationTier(STAR_LENGTH + 2)).toBe('stars')
    expect(celebrationTier(MAX_LENGTH)).toBe('stars')
  })
})
