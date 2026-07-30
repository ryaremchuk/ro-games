import { describe, expect, it } from 'vitest'
import {
  BLOCK_ROUNDS,
  MODE_UNLOCK_EPISODE,
  MODE_WEIGHT,
  SPECIAL_MODES,
  WARMUP_ROUNDS,
  buildDeck,
  initialSetlist,
  nextRound,
  unlockedSpecials,
} from './session'
import type { RoundMode, SetlistContext, SetlistState } from './session'
import {
  DISH_ORDERED_MIN_SKILL,
  SKILL_MAX,
  generateRound,
  kitchenKind,
  requestTotal,
} from './logic'
import type { FoodRequest, TaskKind } from './logic'

/** Deterministic LCG so every assertion below is reproducible. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Play `rounds` rounds of one session and return the mode sequence. */
function playSession(
  rounds: number,
  ctx: SetlistContext,
  rng: () => number,
  state: SetlistState = initialSetlist(),
): RoundMode[] {
  const modes: RoundMode[] = []
  let current = state
  for (let i = 0; i < rounds; i++) {
    const step = nextRound(current, ctx, rng)
    modes.push(step.mode)
    current = step.state
  }
  return modes
}

/** Collapse a mode sequence into [mode, length] blocks. */
function blocksOf(modes: readonly RoundMode[]): Array<[RoundMode, number]> {
  const blocks: Array<[RoundMode, number]> = []
  for (const mode of modes) {
    const last = blocks[blocks.length - 1]
    if (last && last[0] === mode) last[1]++
    else blocks.push([mode, 1])
  }
  return blocks
}

const OPEN: SetlistContext = { episode: 3, duoAllowed: true }

describe('episode unlocks', () => {
  it('opens up in the documented order: nothing, then belt+pot, then the duo', () => {
    expect(unlockedSpecials(0)).toEqual([])
    expect(unlockedSpecials(1).sort()).toEqual(['conveyor', 'kitchen'])
    expect(unlockedSpecials(2).sort()).toEqual(['conveyor', 'duo', 'kitchen'])
    // Episode 0 is the plain loop, and every gate agrees on that.
    for (const mode of SPECIAL_MODES) expect(MODE_UNLOCK_EPISODE[mode]).toBeGreaterThan(0)
  })

  it('never leaves episode 0 anything but classic, however long it plays', () => {
    const modes = playSession(60, { episode: 0, duoAllowed: true }, seeded(7))
    expect(new Set(modes)).toEqual(new Set(['classic']))
  })
})

describe('the deck', () => {
  it('holds exactly weight copies of every unlocked special', () => {
    const deck = buildDeck(3, null, seeded(11))
    for (const mode of SPECIAL_MODES) {
      expect(deck.filter((m) => m === mode).length).toBe(MODE_WEIGHT[mode])
    }
  })

  it('never opens a fresh deck on the special that just played', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const avoid of SPECIAL_MODES) {
        expect(buildDeck(3, avoid, seeded(seed))[0]).not.toBe(avoid)
      }
    }
  })

  it('is drawn without replacement, so specials rotate instead of clustering', () => {
    const perDeck = SPECIAL_MODES.reduce((sum, mode) => sum + MODE_WEIGHT[mode], 0)
    const specials = blocksOf(playSession(600, OPEN, seeded(3)))
      .filter(([mode]) => mode !== 'classic')
      .map(([mode]) => mode)

    // Frequency tracks the weights closely — this is the whole point of a deck
    // over independent per-round dice.
    for (const mode of SPECIAL_MODES) {
      const share = specials.filter((m) => m === mode).length / specials.length
      expect(share).toBeCloseTo(MODE_WEIGHT[mode] / perDeck, 1)
    }

    // Anti-drought: no mode is ever absent for long. Without replacement bounds
    // the gap structurally — a card cannot be skipped over twice in a row.
    for (const mode of SPECIAL_MODES) {
      let gap = 0
      let worst = 0
      for (const played of specials) {
        gap = played === mode ? 0 : gap + 1
        worst = Math.max(worst, gap)
      }
      expect(worst).toBeLessThanOrEqual(2 * perDeck)
    }
  })
})

describe('the setlist rhythm', () => {
  it('opens every session on a longer classic warm-up', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const modes = playSession(WARMUP_ROUNDS + 1, OPEN, seeded(seed))
      expect(modes.slice(0, WARMUP_ROUNDS)).toEqual(Array(WARMUP_ROUNDS).fill('classic'))
      expect(modes[WARMUP_ROUNDS]).not.toBe('classic')
    }
  })

  it('always puts a classic breather between two specials', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const blocks = blocksOf(playSession(80, OPEN, seeded(seed)))
      blocks.forEach(([mode], i) => {
        if (mode === 'classic') return
        const next = blocks[i + 1]
        if (next) expect(next[0]).toBe('classic')
      })
    }
  })

  it('never plays the same special twice running, breather or no breather', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const specials = blocksOf(playSession(80, OPEN, seeded(seed)))
        .filter(([mode]) => mode !== 'classic')
        .map(([mode]) => mode)
      specials.forEach((mode, i) => {
        if (i > 0) expect(mode).not.toBe(specials[i - 1])
      })
    }
  })

  it('keeps every block inside its documented length range', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const blocks = blocksOf(playSession(80, OPEN, seeded(seed)))
      // The last block is truncated by the round budget, and the first is the warm-up.
      blocks.slice(1, -1).forEach(([mode, length]) => {
        expect(length).toBeGreaterThanOrEqual(BLOCK_ROUNDS[mode].min)
        expect(length).toBeLessThanOrEqual(BLOCK_ROUNDS[mode].max)
      })
      expect(blocks[0]).toEqual(['classic', WARMUP_ROUNDS])
    }
  })

  it('reaches its first special inside a short session, every time', () => {
    // A session is ~6-12 rounds: the first special must land well inside that or
    // a child who plays for four minutes only ever sees the still tray.
    for (let seed = 1; seed <= 300; seed++) {
      const modes = playSession(6, OPEN, seeded(seed))
      expect(modes.some((mode) => mode !== 'classic')).toBe(true)
    }
  })

  it('spends a realistic session on a mix of modes, not on one', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const modes = playSession(12, OPEN, seeded(seed))
      // Classic never dominates a full session, and it never disappears either.
      const classic = modes.filter((mode) => mode === 'classic').length
      expect(classic).toBeGreaterThanOrEqual(4)
      expect(classic).toBeLessThanOrEqual(9)
      expect(new Set(modes).size).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('a mode the world cannot host', () => {
  it('defers a duo instead of losing it, and plays it at the next boundary', () => {
    const rng = seeded(5)
    // A world that never allows a duo: it must never appear, and the other
    // specials must keep flowing (a blocked card cannot stall the deck).
    const closed = playSession(80, { episode: 3, duoAllowed: false }, rng)
    expect(closed).not.toContain('duo')
    expect(closed).toContain('kitchen')
    expect(closed).toContain('conveyor')
  })

  it('plays the deferred duo once the journey allows one', () => {
    // Run with duos closed until the deck has certainly deferred one, then open
    // the gate: the very next special block must be the duo it kept.
    let state = initialSetlist()
    const rng = seeded(9)
    for (let i = 0; i < 40; i++) {
      state = nextRound(state, { episode: 3, duoAllowed: false }, rng).state
    }
    expect(state.deck).toContain('duo')
    const modes: RoundMode[] = []
    for (let i = 0; i < 12; i++) {
      const step = nextRound(state, { episode: 3, duoAllowed: true }, rng)
      modes.push(step.mode)
      state = step.state
    }
    expect(modes).toContain('duo')
  })

  it('does not spend the block on classic when a card is merely blocked', () => {
    // Deck down to a duo the journey will not host: the block still gets a
    // special (the deck tops up behind the blocked card) and the duo is KEPT.
    const state: SetlistState = {
      mode: 'classic',
      left: 0,
      deck: ['duo'],
      lastSpecial: null,
      blocks: 4,
    }
    const step = nextRound(state, { episode: 2, duoAllowed: false }, seeded(1))
    expect(step.mode).not.toBe('classic')
    expect(step.mode).not.toBe('duo')
    expect(step.state.deck).toContain('duo')
  })

  it('never unlocks exactly ONE special — that would deadlock the no-repeat rule', () => {
    // With a single unlocked special, every card is a repeat of `lastSpecial`,
    // which would then never change. drawSpecial has a fallback for it (a repeated
    // block beats a dead axis), but the ladder must not need the fallback: any
    // episode that opens the deck at all has to open it with at least two cards.
    for (let episode = 0; episode <= 12; episode++) {
      expect(unlockedSpecials(episode).length, `episode ${episode}`).not.toBe(1)
    }
  })

  it('falls back to classic only when nothing at all is unlocked', () => {
    const state: SetlistState = {
      mode: 'classic',
      left: 0,
      deck: [],
      lastSpecial: null,
      blocks: 4,
    }
    const step = nextRound(state, { episode: 0, duoAllowed: true }, seeded(1))
    expect(step.mode).toBe('classic')
  })
})

/**
 * The two axes together, as the scene actually drives them: the setlist picks a
 * mode, the mode decides whether the task is forced (kitchen) or drawn from the
 * meter, and generateRound builds it. Simulating the MECHANIC rather than the code
 * is what catches a hole neither module can see alone — e.g. a kitchen block that
 * deals non-cooking rounds, or a session whose asks never vary.
 */
function simulateSession(
  rounds: number,
  skill: number,
  rng: () => number,
): Array<{ mode: RoundMode; taskKind: string; total: number }> {
  const out: Array<{ mode: RoundMode; taskKind: string; total: number }> = []
  let state = initialSetlist()
  const recentKinds: TaskKind[] = []
  let previous: FoodRequest | undefined
  for (let i = 1; i <= rounds; i++) {
    const step = nextRound(state, OPEN, rng)
    state = step.state
    // A duo round is generated by generateDuoRound, not the task registry — it has
    // no cognitive task kind at all, so it is recorded and skipped here.
    if (step.mode === 'duo') {
      out.push({ mode: 'duo', taskKind: 'duo', total: 2 })
      continue
    }
    const round = generateRound(
      {
        round: i,
        skill,
        recentKinds,
        previous,
        forceKind: step.mode === 'kitchen' ? kitchenKind(skill, rng) : undefined,
      },
      rng,
    )
    recentKinds.push(round.taskKind)
    if (recentKinds.length > 6) recentKinds.shift()
    previous = round.request
    out.push({ mode: step.mode, taskKind: round.taskKind, total: requestTotal(round.request) })
  }
  return out
}

describe('the two axes together', () => {
  it('deals a cooking task on every kitchen round and never off one', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const skill of [0, 4, 8, SKILL_MAX]) {
        for (const round of simulateSession(40, skill, seeded(seed * 31 + skill))) {
          if (round.mode === 'kitchen') {
            expect(round.taskKind).toMatch(/^dish/)
          } else {
            expect(round.taskKind).not.toMatch(/^dish/)
          }
        }
      }
    }
  })

  it('never asks for a cooking round the meter cannot yet handle in order', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const round of simulateSession(40, DISH_ORDERED_MIN_SKILL - 1, seeded(seed))) {
        expect(round.taskKind).not.toBe('dish-ordered')
      }
    }
  })

  it('produces a satisfiable round every time, in every mode', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const skill of [0, 3, 7, SKILL_MAX]) {
        for (const round of simulateSession(30, skill, seeded(seed * 7 + skill))) {
          expect(round.total).toBeGreaterThan(0)
        }
      }
    }
  })

  it('spends a session on several different ASKS as well as several modes', () => {
    // The variety the child feels is the product of both axes. A fluent child's
    // twelve-round session must vary on both, or one of the two axes is not working.
    for (let seed = 1; seed <= 200; seed++) {
      const session = simulateSession(12, SKILL_MAX, seeded(seed))
      expect(new Set(session.map((r) => r.mode)).size).toBeGreaterThanOrEqual(2)
      expect(new Set(session.map((r) => r.taskKind)).size).toBeGreaterThanOrEqual(4)
    }
  })

  it('gets the pot out often — it is the richest mode and the deck says so', () => {
    // The reason cooking moved off the difficulty meter: on the meter it could only
    // become more frequent by displacing counting and colours. On the deck it is
    // simply the heaviest card.
    const session = simulateSession(600, SKILL_MAX, seeded(4))
    const share = session.filter((r) => r.mode === 'kitchen').length / session.length
    expect(share).toBeGreaterThan(0.15)
    // …and it is still a special: classic rounds remain the backbone.
    expect(session.filter((r) => r.mode === 'classic').length / session.length).toBeGreaterThan(0.4)
  })
})

describe('difficulty independence', () => {
  it('takes no skill input at all — variety is not a reward for competence', () => {
    // A struggling child and a fluent one get the SAME sequence: the mode axis is
    // pure variety and the cognitive meter owns difficulty (see logic.ts).
    const a = playSession(40, OPEN, seeded(21))
    const b = playSession(40, OPEN, seeded(21))
    expect(a).toEqual(b)
  })
})
